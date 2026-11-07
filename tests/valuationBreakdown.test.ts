import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { computeValuation, valuationBreakdown } from '../src/sim/systems/finance';

describe('valuation breakdown', () => {
  it('the pieces add up to the valuation the sim computes, in each regime', () => {
    const s = createInitialState(1, 'Parts Labs');
    const check = () => {
      const b = valuationBreakdown(s);
      expect(b.target).toBe(computeValuation(s));
      const sum = b.revenue + b.potential + b.floorTopUp + b.bonuses;
      expect(Math.abs(sum - b.target)).toBeLessThanOrEqual(1e-9 * Math.max(1, b.target));
      return b;
    };
    check();

    s.finance.dailyRevenue = 5e6;
    expect(check().revenue).toBeGreaterThan(0);

    // A recent round with a high post-money: the floor lifts the target above revenue plus potential.
    s.finance.lastPostMoney = 1e12;
    expect(check().floorTopUp).toBeGreaterThan(0);

    s.flags['bonus.valuation'] = 1.1;
    expect(check().bonuses).toBeGreaterThan(0);
  });
});
