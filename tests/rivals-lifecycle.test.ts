// v19 B3: rival lab lifecycle (founding, the active cap, bankruptcy, acquisitions).
import { describe, it, expect, afterEach } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { COMPETITORS } from '../src/sim/data/competitors';
import { rivalLabs, rivalDef } from '../src/sim/systems/rivals';
import { canActivate, foundingCash, foundingGpus, lifecycleDay } from '../src/sim/systems/rivals/lifecycle';
import { RIVAL_TUNING } from '../src/sim/systems/rivals/tuning';
import type { CompetitorDef, GameState, Rng, RivalModel, RivalLab, Competitor } from '../src/sim/types';
import { calendarYear } from '../src/sim/util';

/** 1 January 2024. */
const DAY_2024 = 2556;

/** An rng whose chance() always succeeds, so acquisition rolls are forced. */
const FORCED: Rng = {
  next: () => 0.5,
  range: (min) => min,
  int: (min) => min,
  chance: () => true,
  pick: (arr) => arr[0],
  normal: () => 0,
};

/** A fresh game with every lab labs-created and inactive, so a test switches on only the labs it needs. */
function quiet(seed = 11, day = DAY_2024): GameState {
  const s = createInitialState(seed, 'Test Labs');
  s.day = day;
  rivalLabs(s);
  for (const c of s.competitors) if (!c.human) { c.active = false; c.nextReleaseDay = 1e9; }
  return s;
}

function comp(s: GameState, def: CompetitorDef): Competitor {
  return s.competitors.find((c) => c.id === def.id)!;
}

function lab(s: GameState, def: CompetitorDef): RivalLab {
  return rivalLabs(s).find((l) => l.id === def.id)!;
}

/** Switch a lab on as an active competitor (status active, cash given). */
function activate(s: GameState, def: CompetitorDef, cash = 1e8): void {
  const l = lab(s, def);
  l.status = 'active';
  l.foundedDay = s.day;
  l.cash = cash;
  comp(s, def).active = true;
}

function fakeModel(id: string): RivalModel {
  return { id, name: id, paramsB: 10, tokensB: 100, dataQuality: 0.5, arch: 'dense', caps: {} as RivalModel['caps'], overall: 50, elo: 1000, trainedDay: 0, releasedDay: 0, open: false, license: null } as unknown as RivalModel;
}

describe('canActivate and the active cap', () => {
  it('allows a lab only while fewer than MAX_ACTIVE labs are active', () => {
    const s = quiet();
    const defs = COMPETITORS.slice(0, RIVAL_TUNING.MAX_ACTIVE + 1);
    for (const d of defs.slice(0, RIVAL_TUNING.MAX_ACTIVE - 1)) activate(s, d);
    expect(canActivate(s, defs[RIVAL_TUNING.MAX_ACTIVE])).toBe(true);
    activate(s, defs[RIVAL_TUNING.MAX_ACTIVE - 1]);
    expect(canActivate(s, defs[RIVAL_TUNING.MAX_ACTIVE])).toBe(false);
  });

  it('never counts the human rival against the cap', () => {
    const s = quiet();
    const human = s.competitors.find((c) => c.human);
    if (human) human.active = true;
    expect(canActivate(s, COMPETITORS[0])).toBe(true);
  });
});

describe('founding', () => {
  it('seeds cash, GPUs and staff for a lab that just became active', () => {
    const s = quiet();
    const def = COMPETITORS[0];
    comp(s, def).active = true;
    lifecycleDay(s, makeRng({ rngState: 3 }));
    const l = lab(s, def);
    expect(l.status).toBe('active');
    expect(l.foundedDay).toBe(s.day);
    const staff = l.staff.research + l.staff.engineering + l.staff.safety + l.staff.sales;
    expect(staff).toBeGreaterThanOrEqual(2);
    if (def.startCash === undefined) expect(l.cash).toBe(foundingCash(def.kind ?? 'frontier', calendarYear(s.day)));
  });

  it('derives cash and GPU counts from kind and year', () => {
    expect(foundingCash('frontier', 2017)).toBe(40e6);
    expect(foundingCash('open', 2030)).toBe(2e6);
    expect(foundingCash('bigtech', 2017)).toBe(1e9);
    expect(foundingGpus('frontier', 2017)).toBe(64);
    expect(foundingGpus('open', 2017)).toBe(8);
    expect(foundingGpus('chip', 2050)).toBe(20_000);
  });

  it('does not found a lab whose competitor is still inactive', () => {
    const s = quiet();
    lifecycleDay(s, makeRng({ rngState: 3 }));
    expect(rivalLabs(s).every((l) => l.status === 'unfounded')).toBe(true);
  });
});

describe('bankruptcy', () => {
  it('goes bankrupt after BANKRUPT_DAYS days below zero cash and stops being active', () => {
    const s = quiet();
    const def = COMPETITORS[0];
    activate(s, def, -1);
    const rng = makeRng({ rngState: 9 });
    for (let i = 0; i < RIVAL_TUNING.BANKRUPT_DAYS - 1; i++) lifecycleDay(s, rng);
    expect(lab(s, def).status).toBe('active');
    lifecycleDay(s, rng);
    const l = lab(s, def);
    expect(l.status).toBe('bankrupt');
    expect(l.endedDay).toBe(s.day);
    expect(comp(s, def).active).toBe(false);
    expect(comp(s, def).model).toBeNull();
    expect(canActivate(s, def)).toBe(false);
    expect(s.news.some((n) => n.text.includes('runs out of money'))).toBe(true);
  });

  it('resets the count when cash recovers and sends owned GPUs to the used market', () => {
    const s = quiet();
    const def = COMPETITORS[0];
    activate(s, def, -1);
    lab(s, def).gpusOwned = { h100: 5 };
    const rng = makeRng({ rngState: 9 });
    for (let i = 0; i < 30; i++) lifecycleDay(s, rng);
    lab(s, def).cash = 1e6;
    lifecycleDay(s, rng);
    expect(lab(s, def).negativeDays).toBe(0);
    lab(s, def).cash = -1;
    for (let i = 0; i < RIVAL_TUNING.BANKRUPT_DAYS; i++) lifecycleDay(s, rng);
    expect(lab(s, def).status).toBe('bankrupt');
    expect(s.flags['usedGpus.h100']).toBe(5);
    expect(lab(s, def).gpusOwned).toEqual({});
  });
});

describe('acquisitions', () => {
  // Fates are set in the roster by B1; pin them here so the test does not depend on the data.
  const saved = [COMPETITORS[0].fate, COMPETITORS[1].fate];
  afterEach(() => { COMPETITORS[0].fate = saved[0]; COMPETITORS[1].fate = saved[1]; });

  function pair(s: GameState): { acq: CompetitorDef; tgt: CompetitorDef } {
    const acq = COMPETITORS[0];
    const tgt = COMPETITORS[1];
    acq.fate = 'acquirer';
    tgt.fate = 'target';
    return { acq, tgt };
  }

  it('moves GPUs, models and half the staff, charges the buyer and deactivates the target', () => {
    const s = quiet(12, 30);
    const { acq, tgt } = pair(s);
    activate(s, acq, 1e12);
    activate(s, tgt, 1e6);
    comp(s, acq).valuation = 1e9;
    comp(s, tgt).valuation = 1e6;
    const tl = lab(s, tgt);
    tl.gpusOwned = { h100: 10 };
    tl.gpusRented = { a100: 4 };
    tl.staff = { research: 6, engineering: 3, safety: 0, sales: 0 };
    tl.models = [fakeModel('m-target')];
    tl.research = ['moe'];
    lab(s, acq).research = ['transformers'];
    lab(s, acq).staff = { research: 0, engineering: 0, safety: 0, sales: 0 };

    lifecycleDay(s, FORCED);

    const al = lab(s, acq);
    expect(tl.status).toBe('acquired');
    expect(tl.acquiredBy).toBe(acq.id);
    expect(comp(s, tgt).active).toBe(false);
    expect(al.gpusOwned.h100).toBe(10);
    expect(al.gpusRented.a100).toBe(4);
    expect(al.staff.research).toBe(3);
    expect(al.staff.engineering).toBe(1);
    expect(tl.staff.research).toBe(3);
    expect(al.models.map((m) => m.id)).toContain('m-target');
    expect(al.research.sort()).toEqual(['moe', 'transformers']);
    expect(al.cash).toBeCloseTo(1e12 - 1e6 * 1.3, 0);
    expect(s.news.some((n) => n.text.includes('acquires'))).toBe(true);
    expect(canActivate(s, tgt)).toBe(false);
  });

  it('does not buy a lab the buyer cannot pay for', () => {
    const s = quiet(12, 30);
    const { acq, tgt } = pair(s);
    activate(s, acq, 1);
    activate(s, tgt, 1e6);
    comp(s, acq).valuation = 1e9;
    comp(s, tgt).valuation = 1e6;
    lifecycleDay(s, FORCED);
    expect(lab(s, tgt).status).toBe('active');
  });

  it('does not run on days that are not a 30-day multiple', () => {
    const s = quiet(12, 31);
    const { acq, tgt } = pair(s);
    activate(s, acq, 1e12);
    activate(s, tgt, 1e6);
    comp(s, tgt).valuation = 1e6;
    lifecycleDay(s, FORCED);
    expect(lab(s, tgt).status).toBe('active');
  });
});

describe('determinism', () => {
  function run(seed: number): string {
    const s = quiet(seed, 0);
    for (const def of COMPETITORS) {
      comp(s, def).active = true;
      lab(s, def).cash = def.fate === 'acquirer' ? 1e12 : 1e6;
    }
    const rng = makeRng({ rngState: seed });
    for (let d = 0; d < 90; d++) { lifecycleDay(s, rng); s.day++; }
    return JSON.stringify({ rivals: s.rivals, flags: s.flags, news: s.news });
  }

  it('gives the same result for the same seed', () => {
    expect(run(21)).toBe(run(21));
  });
});
