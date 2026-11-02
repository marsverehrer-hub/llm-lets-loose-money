// v16 (GAME_DESIGN §26): cloud providers (quotas, stock, reserved pricing, early exit, spot preemption), datacenter
// upgrades, the neocloud business (revenue, utilization, SLA, contracts) and old-save compatibility.
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import { CLOUD_PROVIDERS, DEFAULT_PROVIDER_ID, providerById } from '../src/sim/data/clouds';
import { GPUS } from '../src/sim/data/gpus';
import {
  CLOUD_TUNING,
  cloudLeaseRentPerDay,
  cloudTick,
  earlyExitPenalty,
  onDemandPrice,
  providerQuota,
  providerUsage,
  quotaLeft,
  reservedPrice,
} from '../src/sim/systems/cloudMarket';
import { COMPUTE_TUNING, dailyComputeCost, datacenterPue, ownGpuCount, ownPflops, pueOf } from '../src/sim/systems/compute';
import { NEOCLOUD_TUNING, ageFactor, marketGpuPrice, neocloudDay, neocloudTick } from '../src/sim/systems/neocloud';
import { startDayOf } from '../src/sim/systems/scenario';
import { loadGame, saveGame } from '../src/sim/save';
import { yearOf } from '../src/sim/util';

const gpu = (id: string) => GPUS.find((g) => g.id === id)!;
const prov = (id: string) => providerById(id)!;

function at(year: number, seed = 3): GameState {
  const s = createInitialState(seed, 'Cloudy');
  s.day = startDayOf(year) + 180; // mid-year: every generation of `year` is past its scarce first months
  s.finance.cash = 1e12;
  s.compute.rented = {};
  return s;
}

describe('provider quotas and stock', () => {
  it('quota grows every year, so 50k GPUs in 2019 is impossible', () => {
    const s19 = at(2019);
    const s25 = at(2025);
    for (const p of CLOUD_PROVIDERS) {
      if (p.openYear <= 2019) expect(providerQuota(s25, p)).toBeGreaterThan(providerQuota(s19, p));
    }
    const total2019 = CLOUD_PROVIDERS.reduce((a, p) => a + providerQuota(s19, p), 0);
    expect(total2019).toBeLessThan(50_000);
    dispatch(s19, { type: 'rentGpus', gpuId: 'v1000', count: 50_000 });
    const got = s19.compute.rented['v1000'] ?? 0;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(providerQuota(s19, prov(DEFAULT_PROVIDER_ID)));
    expect(quotaLeft(s19, prov(DEFAULT_PROVIDER_ID), gpu('v1000'))).toBe(0);
  });

  it('the legacy rentGpus action rents from the default provider at list price', () => {
    const s = at(2018);
    dispatch(s, { type: 'rentGpus', gpuId: 'p100', count: 10 });
    expect(s.compute.rented.p100).toBe(10);
    expect(providerUsage(s, DEFAULT_PROVIDER_ID)).toBe(10);
    expect(dailyComputeCost(s).rent).toBeCloseTo(10 * gpu('p100').rentPerDay);
    dispatch(s, { type: 'rentGpus', gpuId: 'p100', count: -4 });
    expect(s.compute.rented.p100).toBe(6);
  });

  it('a new generation is scarce in its first months, and lagging providers do not stock it yet', () => {
    const s = createInitialState(3, 'Gen');
    s.finance.cash = 1e12;
    s.day = startDayOf(2022) + 1;
    const p = prov(DEFAULT_PROVIDER_ID);
    expect(quotaLeft(s, p, gpu('h100'))).toBeLessThanOrEqual(providerQuota(s, p) * (CLOUD_TUNING.NEW_GEN_SHARE + 0.01));
    expect(quotaLeft(s, prov('eurostack'), gpu('h100'))).toBe(0); // one-year lag
    dispatch(s, { type: 'rentCloud', providerId: 'eurostack', gpuId: 'h100', count: 1 });
    expect(providerUsage(s, 'eurostack')).toBe(0);
  });

  it('neoclouds retire old generations and open late', () => {
    expect(quotaLeft(at(2018), prov('corewheeze'), gpu('v1000'))).toBe(0); // opens 2019
    expect(quotaLeft(at(2026), prov('corewheeze'), gpu('a100'))).toBe(0); // retired after 4 years
    expect(quotaLeft(at(2026), prov('corewheeze'), gpu('b200'))).toBeGreaterThan(0);
  });
});

describe('leases, reserved terms and prices', () => {
  it('rents from another provider at its price and adds the GPUs to the fleet', () => {
    const s = at(2021);
    dispatch(s, { type: 'rentCloud', providerId: 'corewheeze', gpuId: 'a100', count: 100 });
    expect(ownGpuCount(s)).toBe(100);
    expect(ownPflops(s)).toBeCloseTo(100 * gpu('a100').pflops);
    expect(dailyComputeCost(s).rent).toBeCloseTo(100 * gpu('a100').rentPerDay * prov('corewheeze').priceMult);
  });

  it('reserved terms are cheaper than on-demand, longer is cheaper still, and the price is locked', () => {
    const s = at(2023);
    const p = prov('amazomb');
    const g = gpu('h100');
    expect(reservedPrice(s, p, g, 12)).toBeLessThan(onDemandPrice(s, p, g));
    expect(reservedPrice(s, p, g, 36)).toBeLessThan(reservedPrice(s, p, g, 12));
    expect(reservedPrice(s, prov('lambada'), g, 36)).toBe(Infinity);
    dispatch(s, { type: 'commitCloud', providerId: 'amazomb', gpuId: 'h100', count: 50, months: 36 });
    const l = s.compute.cloud!.leases[0];
    expect(l.kind).toBe('reserved');
    expect(l.pricePerDay).toBeCloseTo(onDemandPrice(s, p, g) * (1 - p.reserved[36]!));
    s.flags.rentMult = 2; // a rent shock moves on-demand, not a signed term
    expect(cloudLeaseRentPerDay(s)).toBeCloseTo(50 * l.pricePerDay!);
  });

  it('ending a term early costs half of what is left; a finished term just ends', () => {
    const s = at(2023);
    dispatch(s, { type: 'commitCloud', providerId: 'amazomb', gpuId: 'h100', count: 10, months: 12 });
    const l = s.compute.cloud!.leases[0];
    const left = l.endDay! - s.day;
    expect(earlyExitPenalty(s, l)).toBeCloseTo(CLOUD_TUNING.EARLY_EXIT_SHARE * left * 10 * l.pricePerDay!);
    const cash = s.finance.cash;
    dispatch(s, { type: 'endCloudCommit', leaseId: l.id });
    expect(s.compute.cloud!.leases).toHaveLength(0);
    expect(cash - s.finance.cash).toBeCloseTo(CLOUD_TUNING.EARLY_EXIT_SHARE * left * 10 * l.pricePerDay!);

    dispatch(s, { type: 'commitCloud', providerId: 'amazomb', gpuId: 'h100', count: 10, months: 12 });
    s.day = s.compute.cloud!.leases[0].endDay!;
    cloudTick(s);
    expect(s.compute.cloud!.leases).toHaveLength(0);
  });

  it('a term needs quota for the whole order', () => {
    const s = at(2019);
    const p = prov('lambada');
    const left = quotaLeft(s, p, gpu('v1000'));
    dispatch(s, { type: 'commitCloud', providerId: 'lambada', gpuId: 'v1000', count: left + 1, months: 12 });
    expect(providerUsage(s, 'lambada')).toBe(0);
  });
});

describe('spot capacity', () => {
  it('is cheap, gets preempted, is unbilled while down, and rolls a training run back', () => {
    const s = at(2021);
    const g = gpu('a100');
    dispatch(s, { type: 'rentCloud', providerId: 'bazaar', gpuId: 'a100', count: 200, spot: true });
    const lease = s.compute.cloud!.leases[0];
    expect(lease.kind).toBe('spot');
    expect(cloudLeaseRentPerDay(s)).toBeLessThan(200 * g.rentPerDay * 0.5);
    s.compute.totalPflops = 200 * g.pflops;
    s.compute.trainingPflops = 200 * g.pflops;
    s.training = { doneFlops: 1e24, log: [] } as any;
    let days = 0;
    while ((lease.downUntil ?? -1) <= s.day && days < 2000) {
      s.day += 1;
      days += 1;
      cloudTick(s);
    }
    expect(lease.downUntil).toBeGreaterThan(s.day); // preempted at some point
    expect(ownGpuCount(s)).toBe(0);
    expect(cloudLeaseRentPerDay(s)).toBe(0);
    const lost = 200 * g.pflops * 1e15 * 86_400 * CLOUD_TUNING.ROLLBACK_DAYS;
    expect(s.training!.doneFlops).toBeCloseTo(1e24 - lost, -10);
  });

  it('only spot is sold by the marketplace', () => {
    const s = at(2021);
    dispatch(s, { type: 'rentCloud', providerId: 'bazaar', gpuId: 'a100', count: 10 });
    expect(providerUsage(s, 'bazaar')).toBe(0);
  });
});

describe('datacenter upgrades', () => {
  it('liquid cooling lowers the PUE and the failures; InfiniBand is a one-off', () => {
    const s = at(2021);
    s.compute.datacenters.push({ id: 'dc1', name: 'Colo', tierId: 'colo', gpus: {}, buildDaysLeft: 0 });
    dispatch(s, { type: 'buyGpus', datacenterId: 'dc1', gpuId: 'a100', count: 400 });
    const power = dailyComputeCost(s).power;
    const cash = s.finance.cash;
    dispatch(s, { type: 'upgradeDatacenter', datacenterId: 'dc1', upgrade: 'liquid' });
    expect(cash - s.finance.cash).toBeCloseTo(2_000_000 * COMPUTE_TUNING.LIQUID_COST_SHARE);
    expect(datacenterPue(s.compute.datacenters[0])).toBeCloseTo(pueOf('colo') * COMPUTE_TUNING.LIQUID_PUE_MULT);
    expect(dailyComputeCost(s).power).toBeCloseTo(power * COMPUTE_TUNING.LIQUID_PUE_MULT);
    dispatch(s, { type: 'upgradeDatacenter', datacenterId: 'dc1', upgrade: 'infiniband' });
    const after = s.finance.cash;
    dispatch(s, { type: 'upgradeDatacenter', datacenterId: 'dc1', upgrade: 'infiniband' });
    expect(s.finance.cash).toBe(after);
    expect(s.compute.datacenters[0].infiniband).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Neocloud
// ---------------------------------------------------------------------------

function neoLab(year = 2021, n = 400, gpuId = 'a100'): GameState {
  const s = at(year);
  s.compute.datacenters.push({ id: 'dc1', name: 'Hall', tierId: 'colo', gpus: {}, buildDaysLeft: 0 });
  dispatch(s, { type: 'buyGpus', datacenterId: 'dc1', gpuId, count: n });
  dispatch(s, { type: 'setNeocloudHall', datacenterId: 'dc1', dedicated: true });
  return s;
}

describe('neocloud market price', () => {
  it('old GPUs lose price as new generations ship', () => {
    expect(ageFactor('a100', 2021)).toBe(1);
    expect(ageFactor('a100', 2021.9)).toBe(1); // the slower MI-250X (2021) is no successor
    expect(ageFactor('a100', 2022.5)).toBeLessThan(1);
    expect(ageFactor('a100', 2026)).toBeLessThan(ageFactor('a100', 2023));
    const s21 = at(2021);
    const s26 = at(2026);
    s26.market.aiHype = s21.market.aiHype;
    expect(marketGpuPrice(s26, 'a100')).toBeLessThan(marketGpuPrice(s21, 'a100') * 0.5);
  });

  it('demand follows AI hype', () => {
    const s = at(2021);
    s.market.aiHype = 10;
    const lo = marketGpuPrice(s, 'a100');
    s.market.aiHype = 90;
    expect(marketGpuPrice(s, 'a100')).toBeGreaterThan(lo);
  });
});

describe('neocloud business', () => {
  it('a dedicated hall leaves the own fleet but still pays to run', () => {
    const s = neoLab();
    expect(ownGpuCount(s)).toBe(0);
    expect(dailyComputeCost(s).hardware).toBeGreaterThan(0);
    expect(neocloudDay(s).dedicatedGpus).toBe(400);
    expect(neocloudDay(s).hallCostPerDay).toBeGreaterThan(0);
  });

  it('on-demand utilization drifts to a price-dependent target and books cloud revenue', () => {
    const cheap = neoLab();
    const dear = neoLab();
    dispatch(cheap, { type: 'setNeocloudPrice', mult: 0.7 });
    dispatch(dear, { type: 'setNeocloudPrice', mult: 1.5 });
    for (let i = 0; i < 60; i++) {
      for (const s of [cheap, dear]) {
        s.day += 1;
        s.finance.today = { revenue: {}, expenses: {} };
        neocloudTick(s);
      }
    }
    expect(cheap.neocloud!.utilization).toBeGreaterThan(dear.neocloud!.utilization);
    expect(cheap.neocloud!.utilization).toBeLessThanOrEqual(NEOCLOUD_TUNING.MAX_UTIL);
    const d = neocloudDay(cheap);
    expect(cheap.finance.today.revenue.cloud).toBeCloseTo(d.onDemandRevenue + d.contractRevenue + d.idleRevenue);
    expect(d.onDemandRevenue).toBeCloseTo(400 * marketGpuPrice(cheap, 'a100') * 0.7 * cheap.neocloud!.utilization);
  });

  it('a capacity deal pays every day, needs free dedicated GPUs, and breaks its SLA when the hall is taken back', () => {
    const s = neoLab();
    const n = s.neocloud!;
    const offer = {
      id: 'o1',
      customer: 'Test Customer',
      kind: 'enterprise' as const,
      gpuId: 'a100',
      count: 300,
      months: 12,
      price: 50,
      sla: 0.99,
      needsInfiniband: false,
      expiresDay: s.day + 10,
    };
    n.offers.push({ ...offer, id: 'big', count: 500 });
    dispatch(s, { type: 'acceptCapacityDeal', offerId: 'big' });
    expect(n.contracts).toHaveLength(0); // only 400 GPUs in the hall
    n.offers.push(offer);
    dispatch(s, { type: 'acceptCapacityDeal', offerId: 'o1' });
    expect(n.contracts).toHaveLength(1);
    expect(neocloudDay(s).onDemand.a100).toBe(100);

    s.finance.today = { revenue: {}, expenses: {} };
    neocloudTick(s);
    expect(s.finance.today.revenue.cloud).toBeGreaterThanOrEqual(300 * 50);
    expect(s.finance.today.expenses.sla ?? 0).toBe(0);

    const rep = n.reputation;
    dispatch(s, { type: 'setNeocloudHall', datacenterId: 'dc1', dedicated: false });
    expect(ownGpuCount(s)).toBe(400);
    s.finance.today = { revenue: {}, expenses: {} };
    neocloudTick(s);
    expect(s.finance.today.expenses.sla).toBeCloseTo(300 * 50 * NEOCLOUD_TUNING.SLA_CREDIT);
    expect(n.reputation).toBeLessThan(rep);
    for (let i = 1; i < NEOCLOUD_TUNING.BREACH_TERMINATE_DAYS; i++) neocloudTick(s);
    expect(n.contracts).toHaveLength(0); // the customer walked
  });

  it('InfiniBand deals only run on InfiniBand halls', () => {
    const s = neoLab(2021, 400);
    s.neocloud!.offers.push({ id: 'ib', customer: 'Lab', kind: 'lab', gpuId: 'a100', count: 300, months: 6, price: 60, sla: 0.97, needsInfiniband: true, expiresDay: s.day + 5 });
    dispatch(s, { type: 'acceptCapacityDeal', offerId: 'ib' });
    expect(s.neocloud!.contracts).toHaveLength(0);
    dispatch(s, { type: 'upgradeDatacenter', datacenterId: 'dc1', upgrade: 'infiniband' });
    dispatch(s, { type: 'acceptCapacityDeal', offerId: 'ib' });
    expect(s.neocloud!.contracts).toHaveLength(1);
  });

  it('customers make offers once a hall is dedicated; games without a neocloud draw nothing', () => {
    const s = neoLab();
    for (let i = 0; i < 120; i++) {
      s.day += 1;
      neocloudTick(s);
    }
    expect(s.neocloud!.offers.length + s.neocloud!.contracts.length).toBeGreaterThan(0);
    const plain = at(2021);
    neocloudTick(plain);
    expect(plain.neocloud).toBeUndefined();
    expect(plain.flags['neocloud.rng']).toBeUndefined();
  });

  it('the Neocloud scenario starts with a dedicated hall, debt and a goal, and earns cloud revenue', () => {
    const s = createInitialState(9, 'Neo', { scenarioId: 'neocloud', difficulty: 'founder', sandbox: false, skipTutorial: true, startYear: 2020 });
    expect(Math.floor(yearOf(s.day))).toBe(2020);
    expect(s.finance.debt).toBe(20_000_000);
    expect(s.compute.datacenters).toHaveLength(1);
    expect(s.neocloud!.dedicated).toEqual([s.compute.datacenters[0].id]);
    expect(s.goals?.map((g) => g.id)).toContain('cloud_100m');
    for (let i = 0; i < 30; i++) {
      if (s.pendingMoment) dispatch(s, { type: 'dismissMoment' });
      if (s.events.pending && s.events.pending.result === undefined) dispatch(s, { type: 'resolveEvent', choice: 0 });
      if (s.events.pending) dispatch(s, { type: 'clearEventResult' });
      tick(s);
    }
    expect(s.finance.revenueBreakdown.cloud ?? 0).toBeGreaterThan(0);
  });
});

describe('old saves', () => {
  const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (realDescriptor) Object.defineProperty(globalThis, 'localStorage', realDescriptor);
    else delete (globalThis as any).localStorage;
  });

  it('a save without cloud or neocloud state loads, ticks, and takes the new actions', () => {
    const data = new Map<string, string>();
    const mock = {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size;
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
    const old = createInitialState(21, 'Old');
    old.compute.datacenters.push({ id: 'dcx', name: 'Old hall', tierId: 'closet', gpus: { p100: 10 }, buildDaysLeft: 0 });
    delete (old.compute as any).cloud;
    delete (old as any).neocloud;
    saveGame(old);
    const s = loadGame()!;
    expect(s.compute.cloud).toBeUndefined();
    expect(s.neocloud).toBeUndefined();
    expect(s.compute.rented).toEqual(old.compute.rented);
    for (let i = 0; i < 10; i++) tick(s);
    expect(s.compute.cloud).toBeDefined();
    s.finance.cash = 1e9;
    dispatch(s, { type: 'rentCloud', providerId: 'amazomb', gpuId: 'p100', count: 5, spot: true });
    dispatch(s, { type: 'setNeocloudHall', datacenterId: 'dcx', dedicated: true });
    expect(s.neocloud?.dedicated).toEqual(['dcx']);
    for (let i = 0; i < 10; i++) tick(s);
    expect(Number.isFinite(s.finance.cash)).toBe(true);
  });
});
