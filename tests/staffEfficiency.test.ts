// v20 package D: researchers past the knee count less, and the bot moves to a bigger office before a hire batch overflows it.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { botDay } from '../scripts/bot';
import { effectiveResearchers, researchPointsPerDay, RESEARCH_TUNING } from '../src/sim/systems/research';
import { headcount } from '../src/sim/systems/staff';

describe('effective researchers', () => {
  it('is linear up to the knee and n^0.75 past it', () => {
    const k = RESEARCH_TUNING.RESEARCHER_KNEE;
    expect(effectiveResearchers(0)).toBe(0);
    expect(effectiveResearchers(k)).toBe(k);
    expect(effectiveResearchers(k * 4)).toBeCloseTo(k * Math.pow(4, 0.75), 6);
  });

  it('research points grow sub-linearly with researchers past the knee, and stay linear before it', () => {
    const s = createInitialState(11, 'EffCo');
    const rpAt = (n: number) => {
      s.staff.roles.researcher.count = n;
      return researchPointsPerDay(s);
    };
    // Affine check: the star-researcher term is a fixed offset, so equal steps add equal output below the knee.
    const r0 = rpAt(0);
    const r60 = rpAt(60);
    const r120 = rpAt(120);
    expect(r120 - r60).toBeCloseTo(r60 - r0, 6);
    // Doubling past the knee gives less than double the output.
    expect(rpAt(600) - r0).toBeLessThan(2 * (rpAt(300) - r0));
    expect(rpAt(600)).toBeGreaterThan(rpAt(300));
  });
});

describe('bot office upgrade', () => {
  it('upgrades the office when the whole hire batch would not fit, instead of overflowing it', () => {
    const s = createInitialState(11, 'OfficeCo');
    // Mission Bay holds 200. At 196 heads a 5% batch (9) overflows it, though two heads would still fit.
    s.company.officeTierId = 'missionbay';
    s.staff.roles.engineer.count += 196 - headcount(s);
    s.finance.cash = 1e9;
    s.day = 7 * 100; // staff steps run on multiples of 7
    botDay(s, false, 'frontier');
    expect(s.company.officeTierId).toBe('donut');
    expect(headcount(s)).toBe(196);
  });
});
