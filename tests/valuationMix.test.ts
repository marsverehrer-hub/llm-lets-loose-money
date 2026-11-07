import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { ROLE_IDS } from '../src/sim/types';
import { headcount } from '../src/sim/systems/staff';
import { ecosystemPremium, leanPremium, revenueMixMult, valuationParts, VALUATION_TUNING } from '../src/sim/systems/finance';

describe('valuation mix', () => {
  it('weights revenue by category: only contracts gives 1.3, only chat gives 0.9', () => {
    const s = createInitialState(1, 'Mix Labs');
    expect(revenueMixMult(s)).toBe(1); // no revenue yet
    s.finance.revenueBreakdown = { contracts: 500 };
    expect(revenueMixMult(s)).toBeCloseTo(1.3, 9);
    s.finance.revenueBreakdown = { chat: 500 };
    expect(revenueMixMult(s)).toBeCloseTo(0.9, 9);
  });

  it('counts grant revenue as zero in the mix and unknown categories as other', () => {
    const s = createInitialState(1, 'Mix Labs');
    s.finance.revenueBreakdown = { grant: 100, api: 100 };
    expect(revenueMixMult(s)).toBeCloseTo(0.5, 9);
    s.finance.revenueBreakdown = { mystery: 100 };
    expect(revenueMixMult(s)).toBeCloseTo(VALUATION_TUNING.MIX_MULT.other, 9);
  });

  it('lean premium reaches 1.5 at $10M revenue per head and is 1 with no staff', () => {
    const s = createInitialState(1, 'Lean Labs');
    const hc = headcount(s);
    expect(hc).toBeGreaterThan(0);
    s.finance.dailyRevenue = (10e6 * hc) / 365;
    expect(leanPremium(s)).toBeCloseTo(1.5, 9);
    for (const r of ROLE_IDS) s.staff.roles[r].count = 0;
    s.staff.stars = [];
    expect(leanPremium(s)).toBe(1);
  });

  it('ecosystem premium grows with derivatives and caps at 1.4', () => {
    const s = createInitialState(1, 'Eco Labs');
    expect(ecosystemPremium(s)).toBe(1);
    s.ecosystem = { derivatives: 5, byLab: {}, lastDay: 0 };
    expect(ecosystemPremium(s)).toBeCloseTo(1.04, 9);
    s.ecosystem.derivatives = 1000;
    expect(ecosystemPremium(s)).toBe(1.4);
  });

  it('valuation parts carry the mix and the base multiple', () => {
    const s = createInitialState(1, 'Parts Labs');
    s.finance.revenueBreakdown = { contracts: 300, chat: 100 };
    const p = valuationParts(s);
    expect(p.mix).toBeCloseTo((300 * 1.3 + 100 * 0.9) / 400, 9);
    expect(p.base).toBeCloseTo(4 + s.market.aiHype / 8, 9);
  });
});
