// v19 D1: GPU supply. Pre-orders against the vendor's next allocation, the price index, the used market and sales.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import type { GameState, Rng } from '../src/sim/types';
import { GPUS } from '../src/sim/data/gpus';
import { gpuAgeYears } from '../src/sim/systems/compute';
import { SUPPLY_TUNING, gpuAllocationLeft, gpuAllocationQuota } from '../src/sim/systems/scaleLimits';
import { SUPPLY_PRICE, gpuPriceMult, nextAllocationDay, supplyTick, usedMarket } from '../src/sim/systems/supply';

const h100 = GPUS.find((g) => g.id === 'h100')!;
const Q = SUPPLY_TUNING.QUARTER_DAYS;
const rng = {} as Rng; // supplyTick draws no random numbers

// tests/setup.ts turns the allocation off for the old suites; these cases need it on.
beforeAll(() => {
  SUPPLY_TUNING.ENFORCE = true;
});
afterAll(() => {
  SUPPLY_TUNING.ENFORCE = false;
});

/** 2022, the launch year of the H-1OO, with a cathedral that has room for everything. */
function world(): GameState {
  const s = createInitialState(2, 'Supply');
  s.day = 5 * 365 + 10;
  s.finance.cash = 1e12;
  s.compute.datacenters.push({ id: 'dc-big', name: 'Big', tierId: 'cathedral', gpus: {}, buildDaysLeft: 0 } as any);
  return s;
}

describe('GPU pre-orders', () => {
  it('pre-orders deliver on the quarter day and consume that quarter allocation', () => {
    const s = world();
    const day = nextAllocationDay(s);
    expect(day % Q).toBe(0);
    const mult = gpuPriceMult(s, 'h100');
    const cash0 = s.finance.cash;
    dispatch(s, { type: 'preorderGpus', gpuId: 'h100', count: 10, datacenterId: 'dc-big' });
    expect(s.preorders).toHaveLength(1);
    const po = s.preorders![0];
    expect(po.deliverDay).toBe(day);
    expect(po.deposit).toBeCloseTo(10 * h100.buyPrice * mult * SUPPLY_PRICE.DEPOSIT_SHARE);
    expect(s.finance.cash).toBeCloseTo(cash0 - po.deposit);

    s.day = day - 1;
    supplyTick(s, rng);
    expect(s.preorders).toHaveLength(1);
    expect(s.compute.datacenters[0].gpus.h100 ?? 0).toBe(0);

    s.day = day;
    const left = gpuAllocationLeft(s, 'h100');
    supplyTick(s, rng);
    expect(s.preorders).toHaveLength(0);
    expect(s.compute.datacenters[0].gpus.h100).toBe(10);
    expect(s.flags[`alloc.h100.${day / Q}`]).toBe(10);
    expect(gpuAllocationLeft(s, 'h100')).toBe(left - 10);
    // The rest of the price is paid on delivery.
    expect(s.finance.cash).toBeCloseTo(cash0 - po.deposit - 10 * h100.buyPrice * mult * (1 - SUPPLY_PRICE.DEPOSIT_SHARE));
  });

  it('refuses a pre-order past next quarter allocation, or past the free slots of a hall', () => {
    const s = world();
    const quota = gpuAllocationQuota(s, 'h100', nextAllocationDay(s));
    dispatch(s, { type: 'preorderGpus', gpuId: 'h100', count: Math.floor(quota) + 1, datacenterId: 'dc-big' });
    expect(s.preorders ?? []).toHaveLength(0);

    s.compute.datacenters.push({ id: 'dc-small', name: 'Small', tierId: 'closet', gpus: {}, buildDaysLeft: 0 } as any);
    dispatch(s, { type: 'preorderGpus', gpuId: 'h100', count: 65, datacenterId: 'dc-small' });
    expect(s.preorders ?? []).toHaveLength(0);
    dispatch(s, { type: 'preorderGpus', gpuId: 'h100', count: 60, datacenterId: 'dc-small' });
    expect(s.preorders).toHaveLength(1);
  });

  it('cancelling a pre-order refunds half the deposit', () => {
    const s = world();
    dispatch(s, { type: 'preorderGpus', gpuId: 'h100', count: 10, datacenterId: 'dc-big' });
    const po = s.preorders![0];
    const cash = s.finance.cash;
    dispatch(s, { type: 'cancelPreorder', id: po.id });
    expect(s.preorders).toHaveLength(0);
    expect(s.finance.cash).toBeCloseTo(cash + po.deposit / 2);
  });
});

describe('GPU price index', () => {
  it('rises with demand over supply, starts at list, and is capped', () => {
    const s = world();
    const key = `alloc.h100.${Math.floor(s.day / Q)}`;
    const q = gpuAllocationQuota(s, 'h100');
    expect(gpuPriceMult(s, 'h100')).toBe(1);
    s.flags[key] = q * 0.5;
    const low = gpuPriceMult(s, 'h100');
    s.flags[key] = q;
    const mid = gpuPriceMult(s, 'h100');
    s.flags[key] = q * 3;
    const high = gpuPriceMult(s, 'h100');
    expect(low).toBe(1);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeCloseTo(SUPPLY_PRICE.CAP);
    s.flags[key] = q * 1000;
    expect(gpuPriceMult(s, 'h100')).toBeCloseTo(SUPPLY_PRICE.CAP);
    s.flags['rentMult'] = 2; // an event shock multiplies the capped index
    expect(gpuPriceMult(s, 'h100')).toBeCloseTo(2 * SUPPLY_PRICE.CAP);
  });
});

describe('used GPU market', () => {
  it('used GPUs are cheaper than new and two years old when they arrive', () => {
    const s = world();
    s.flags['usedGpus.h100'] = 20;
    const m = usedMarket(s, 'h100');
    expect(m.count).toBe(20);
    expect(m.price).toBeLessThan(h100.buyPrice * gpuPriceMult(s, 'h100'));
    const cash0 = s.finance.cash;
    dispatch(s, { type: 'buyUsedGpus', datacenterId: 'dc-big', gpuId: 'h100', count: 5 });
    const dc = s.compute.datacenters[0];
    expect(dc.gpus.h100).toBe(5);
    expect(gpuAgeYears(s, dc, 'h100')).toBeCloseTo(2);
    expect(s.flags['usedGpus.h100']).toBe(15);
    expect(s.finance.cash).toBeCloseTo(cash0 - 5 * m.price);
    expect(s.flags[`alloc.h100.${Math.floor(s.day / Q)}`] ?? 0).toBe(0); // the vendor allocation is not touched
    dispatch(s, { type: 'buyUsedGpus', datacenterId: 'dc-big', gpuId: 'h100', count: 16 });
    expect(dc.gpus.h100).toBe(5);
  });

  it('sales feed the used market, and the market decays 2% a week', () => {
    const s = world();
    s.compute.datacenters[0].gpus.h100 = 15;
    supplyTick(s, rng); // the fleet as of today
    dispatch(s, { type: 'sellGpus', datacenterId: 'dc-big', gpuId: 'h100', count: 4 });
    supplyTick(s, rng);
    expect(usedMarket(s, 'h100').count).toBe(4);

    s.flags['usedGpus.h100'] = 100;
    for (let i = 0; i < 7; i++) {
      s.day += 1;
      supplyTick(s, rng);
    }
    expect(s.flags['usedGpus.h100']).toBeCloseTo(98, 6);
  });
});
