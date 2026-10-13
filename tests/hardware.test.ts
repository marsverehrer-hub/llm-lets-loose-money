// v14 (GAME_DESIGN §24): owned GPUs cost money to run (cooling, hardware ops), wear out and lose resale value.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import {
  COMPUTE_TUNING,
  annualFailureRate,
  computeTick,
  dailyComputeCost,
  gpuById,
  ownedCostPerGpuDay,
  resaleFraction,
} from '../src/sim/systems/compute';
import { makeRng } from '../src/sim/rng';
import { GPUS } from '../src/sim/data/gpus';

function withColo(n = 400, gpuId = 'p100'): GameState {
  const s = createInitialState(4, 'Hw');
  s.finance.cash = 1e9;
  s.compute.rented = {};
  s.compute.datacenters.push({ id: 'dc1', name: 'Colo', tierId: 'colo', gpus: {}, buildDaysLeft: 0 });
  dispatch(s, { type: 'buyGpus', datacenterId: 'dc1', gpuId, count: n });
  return s;
}

describe('owning GPUs costs money every day', () => {
  it('books hardware ops at the yearly rate of the buy price', () => {
    const s = withColo(400);
    const cost = dailyComputeCost(s);
    expect(cost.hardware).toBeCloseTo((400 * gpuById('p100')!.buyPrice * COMPUTE_TUNING.OPS_RATE_PER_YEAR) / 365);
    s.finance.today = { revenue: {}, expenses: {} };
    computeTick(s, makeRng(s));
    expect(s.finance.today.expenses['hardware']).toBeCloseTo(cost.hardware);
  });

  it('power includes cooling (PUE)', () => {
    const s = withColo(100);
    const g = gpuById('p100')!;
    expect(dailyComputeCost(s).power).toBeCloseTo(100 * g.powerKw * 24 * 0.1 * COMPUTE_TUNING.PUE.colo);
  });

  it('every GPU generation pays itself back in roughly a year, not weeks', () => {
    for (const g of GPUS) {
      const payback = g.buyPrice / (g.rentPerDay - ownedCostPerGpuDay(g, 'hyperscale'));
      expect(payback).toBeGreaterThan(300);
      expect(payback).toBeLessThan(420);
    }
  });

  it('owning is cheaper than renting, but not almost free', () => {
    const h100 = gpuById('h100')!;
    const own = ownedCostPerGpuDay(h100, 'hyperscale');
    expect(own).toBeLessThan(h100.rentPerDay);
    expect(own).toBeGreaterThan(h100.rentPerDay * 0.05);
  });
});

describe('GPUs age', () => {
  it('fail more often and resell for less as they age', () => {
    expect(annualFailureRate(0)).toBeCloseTo(COMPUTE_TUNING.FAIL_BASE);
    expect(annualFailureRate(3)).toBeGreaterThan(annualFailureRate(1));
    expect(annualFailureRate(100)).toBe(COMPUTE_TUNING.FAIL_MAX);
    expect(resaleFraction(0)).toBe(COMPUTE_TUNING.SELL_REFUND);
    expect(resaleFraction(2)).toBeLessThan(resaleFraction(1));
    expect(resaleFraction(50)).toBe(COMPUTE_TUNING.RESALE_FLOOR);
  });

  it('a fleet loses GPUs over the years, faster as it gets older', () => {
    const s = withColo(500);
    const dc = s.compute.datacenters[0];
    const lostIn = (days: number) => {
      const before = dc.gpus['p100'] ?? 0;
      for (let i = 0; i < days; i++) {
        s.day += 1;
        s.finance.today = { revenue: {}, expenses: {} };
        computeTick(s, makeRng(s));
      }
      return before - (dc.gpus['p100'] ?? 0);
    };
    const year1 = lostIn(365);
    expect(year1).toBeGreaterThan(5);
    const left = dc.gpus['p100'];
    for (let i = 0; i < 365 * 2; i++) {
      s.day += 1;
      s.finance.today = { revenue: {}, expenses: {} };
      computeTick(s, makeRng(s));
    }
    const year4 = lostIn(365);
    expect(year4 / (dc.gpus['p100'] + year4)).toBeGreaterThan(year1 / left);
    expect(s.notifications.some((n) => /GPU.*failed/.test(n.text))).toBe(true);
  });

  it('new purchases make the batch younger and selling old GPUs pays less', () => {
    const s = withColo(100);
    const dc = s.compute.datacenters[0];
    s.day += 730;
    dispatch(s, { type: 'buyGpus', datacenterId: 'dc1', gpuId: 'p100', count: 100 });
    expect(dc.bought!['p100']).toBeCloseTo(s.day - 365);
    const cash = s.finance.cash;
    dispatch(s, { type: 'sellGpus', datacenterId: 'dc1', gpuId: 'p100', count: 10 });
    const got = s.finance.cash - cash;
    expect(got).toBeCloseTo(10 * gpuById('p100')!.buyPrice * resaleFraction(1));
    expect(got).toBeLessThan(10 * gpuById('p100')!.buyPrice * COMPUTE_TUNING.SELL_REFUND);
  });

  it('old saves without purchase days count their fleet as new', () => {
    const s = createInitialState(9, 'Old');
    s.day = 2000;
    s.compute.datacenters.push({ id: 'dcx', name: 'Old', tierId: 'colo', gpus: { v1000: 300 }, buildDaysLeft: 0 });
    tick(s);
    expect(s.compute.datacenters[0].bought?.['v1000']).toBe(s.day);
  });
});
