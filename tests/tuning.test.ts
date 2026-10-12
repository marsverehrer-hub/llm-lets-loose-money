import { describe, it, expect, vi } from 'vitest';

// Aha moments are covered in moments.test.ts. Here they would pause the sim mid-test, so they are stubbed out.
vi.mock('../src/sim/systems/moments', () => ({ momentsTick: () => {}, handlers: {} }));
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { EVENTS } from '../src/sim/data/events';
import { canSecondary, valuationFloor, SECONDARY_TUNING } from '../src/sim/systems/finance';
import type { GameState } from '../src/sim/types';

/** A listed company with a known share count and price, for the secondary-offering tests. */
function listed(seed = 42): GameState {
  const s = createInitialState(seed, 'Listed Labs');
  s.company.isPublic = true;
  s.company.sharesOutstanding = 1000;
  s.company.stockPrice = 10;
  s.company.founderEquity = 0.5;
  // $10B valuation over 1000M shares keeps the stock price anchored near $10.
  s.finance.valuation = 10_000_000_000;
  s.finance.lastPostMoney = 10_000_000_000;
  s.finance.cash = 1_000_000_000;
  return s;
}

/** Advance the sim, clearing any choice event so the clock keeps moving. */
function advance(s: GameState, days: number): void {
  for (let d = 0; d < days && !s.gameOver; d++) {
    tick(s);
    if (s.events.pending) s.events.pending = null;
  }
}

describe('secondary offering', () => {
  it('is refused for a private company', () => {
    const s = createInitialState(3);
    const check = canSecondary(s);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/listed/i);
    const cash = s.finance.cash;
    dispatch(s, { type: 'secondaryOffering' });
    expect(s.finance.cash).toBe(cash);
    expect(s.company.sharesOutstanding).toBe(0);
  });

  it('sells 5% new shares at a 5% discount, dilutes founders, and dips the stock', () => {
    const s = listed();
    const cash0 = s.finance.cash;
    expect(canSecondary(s).ok).toBe(true);

    dispatch(s, { type: 'secondaryOffering' });

    // 5% of 1000M shares = 50M new shares at $9.50 = $475M.
    expect(s.company.sharesOutstanding).toBeCloseTo(1050, 6);
    expect(s.finance.cash).toBeCloseTo(cash0 + 475_000_000, 0);
    expect(s.finance.totalRaised).toBeGreaterThanOrEqual(475_000_000);
    expect(s.company.founderEquity).toBeCloseTo(0.5 / 1.05, 9);
    expect(s.company.stockPrice).toBeCloseTo(10 * (1 - SECONDARY_TUNING.PRICE_DIP), 9);
    expect(s.finance.valuation).toBeCloseTo(s.company.stockPrice * s.company.sharesOutstanding * 1e6, -3);
  });

  it('starts a 180-day cooldown', () => {
    const s = listed();
    dispatch(s, { type: 'secondaryOffering' });
    const check = canSecondary(s);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/\d+ more days/);

    const sharesAfterFirst = s.company.sharesOutstanding;
    dispatch(s, { type: 'secondaryOffering' });
    expect(s.company.sharesOutstanding).toBe(sharesAfterFirst);

    advance(s, SECONDARY_TUNING.COOLDOWN_DAYS);
    expect(canSecondary(s).ok).toBe(true);
  });

  it('does not run without a share price', () => {
    const s = listed();
    s.company.stockPrice = 0;
    expect(canSecondary(s).ok).toBe(false);
  });
});

describe('valuation floor', () => {
  it('starts at the last round price and decays linearly toward 60% over a year', () => {
    const s = createInitialState(1);
    expect(valuationFloor(s)).toBeCloseTo(8_000_000, 0);
    s.day = 60;
    expect(valuationFloor(s)).toBeGreaterThan(7_400_000);
    s.day = 180;
    expect(valuationFloor(s)).toBeCloseTo(8_000_000 * (1 - 0.4 * (180 / 365)), 0);
    s.day = 365;
    expect(valuationFloor(s)).toBeCloseTo(4_800_000, 0);
  });

  it('keeps the starting valuation near $8M for the first two months of a fresh game', () => {
    const s = createInitialState(1);
    advance(s, 60);
    expect(s.finance.valuation).toBeGreaterThan(7_500_000);
  });

  it('restarts the decay when a round closes', () => {
    const s = createInitialState(1);
    s.day = 400;
    s.finance.lastPostMoney = 20_000_000;
    s.finance.pendingOffer = { roundName: 'Seed+', amount: 1_000_000, preMoney: 20_000_000, investor: 'Sequoya Capital', expiresDay: 430 };
    dispatch(s, { type: 'acceptOffer' });
    // The round closed today, so the floor is the full post-money again.
    expect(valuationFloor(s)).toBeCloseTo(21_000_000, 0);
  });
});

describe('early game', () => {
  it('has a choice event eligible at day 40 in a fresh garage game with no products', () => {
    const s = createInitialState(9);
    s.day = 40;
    const eligible = EVENTS.filter((e) => e.weight(s) > 0);
    expect(s.products).toHaveLength(0);
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    expect(eligible.map((e) => e.id)).toContain('mom_invests');
  });

  it('fires a choice event by day 60 in a fresh game', () => {
    for (const seed of [1, 7, 23]) {
      const s = createInitialState(seed);
      let firstDay = -1;
      for (let d = 0; d < 60 && firstDay < 0; d++) {
        tick(s);
        if (s.events.pending) firstDay = s.day;
      }
      expect(firstDay, `seed ${seed}`).toBeGreaterThanOrEqual(30);
      expect(firstDay, `seed ${seed}`).toBeLessThanOrEqual(60);
    }
  });
});

describe('release news', () => {
  it('fills every placeholder and uses the DeepSeekers shock copy for its first release', () => {
    const s = createInitialState(7, 'Tuning Labs');
    // No player actions here, so keep the company solvent long enough to see DeepSeekers launch.
    s.finance.cash = 1e13;
    const shockLines = /sandwich|spare chips|electricity/;
    // The news list is capped, so collect release lines as they are published.
    const seen = new Set<number>();
    const releases: string[] = [];
    let shock: string | undefined;
    for (let d = 0; d < 9 * 365 && !s.gameOver && !shock; d++) {
      tick(s);
      if (s.events.pending) s.events.pending = null;
      for (const n of s.news) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        if (!n.text.includes('(overall')) continue;
        releases.push(n.text);
        if (n.text.startsWith('DeepSeekers') && shockLines.test(n.text)) shock = n.text;
      }
    }
    expect(releases.length).toBeGreaterThan(5);
    for (const t of releases) expect(t, t).not.toMatch(/\{[a-z]+\}/);
    expect(shock, 'DeepSeekers shock release').toBeDefined();
  });
});

// v1.0 tuning (GAME_DESIGN §18.2): soft overall ceiling, research cost curve, contract brand cap, capability premium.
describe('v1.0 tuning', () => {
  it('the soft ceiling is the identity below the knee and approaches 100 without reaching it', async () => {
    const { softCeiling, softCeilingInverse, overallScore } = await import('../src/sim/systems/capabilities');
    expect(softCeiling(70)).toBe(70);
    expect(softCeiling(85)).toBeCloseTo(85, 9);
    expect(softCeiling(100)).toBeGreaterThan(95);
    expect(softCeiling(100)).toBeLessThan(100);
    expect(softCeiling(150)).toBeLessThan(100);
    expect(softCeilingInverse(softCeiling(97))).toBeCloseTo(97, 6);
    const top = overallScore({ reasoning: 100, coding: 100, chat: 100, safety: 100 });
    expect(top).toBeLessThan(100);
    expect(top).toBeGreaterThan(95);
  });

  it('research cost is the base times 1.7 with a tier step on top', async () => {
    const { researchCost, RESEARCH_COST_TUNING } = await import('../src/sim/systems/research');
    const { RESEARCH } = await import('../src/sim/data/research');
    const t0 = RESEARCH.find((n) => n.tier === 0)!;
    expect(researchCost(t0)).toBe(Math.round(t0.cost * RESEARCH_COST_TUNING.MULT));
    const deep = RESEARCH.find((n) => n.tier === 7)!;
    expect(researchCost(deep)).toBe(Math.round(deep.cost * RESEARCH_COST_TUNING.MULT * (1 + RESEARCH_COST_TUNING.TIER_STEP * 7)));
  });

  it('a rival flagship brand is worth at most the brand cap in contract fit', async () => {
    const { CONTRACT_TUNING } = await import('../src/sim/systems/contracts');
    expect(CONTRACT_TUNING.BRAND_WEIGHT * 100).toBeGreaterThan(CONTRACT_TUNING.BRAND_TERM_CAP);
    expect(CONTRACT_TUNING.BRAND_TERM_CAP).toBeLessThanOrEqual(10);
  });

  it('the capability premium is 1 at the frontier and lower for a lab well behind it', async () => {
    const { frontierPremium, VALUATION_TUNING } = await import('../src/sim/systems/finance');
    const { frontierQuality } = await import('../src/sim/systems/market');
    const { yearOf } = await import('../src/sim/util');
    const s = createInitialState(42, 'Premium');
    const ref = frontierQuality(yearOf(s.day));
    expect(frontierPremium(s, ref)).toBeCloseTo(1, 9);
    expect(frontierPremium(s, ref * 0.8)).toBeLessThan(1);
    expect(frontierPremium(s, 0)).toBe(VALUATION_TUNING.PREMIUM_MIN);
    expect(frontierPremium(s, ref * 2)).toBe(VALUATION_TUNING.PREMIUM_MAX);
  });
});
