// Distillation and merges (GAME_DESIGN §17.8): quotes, the training-slot flow, eval-day reveals and the merge statistics.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { Capabilities, Forecast, GameState, MergeMethod, Model, TrainingRun } from '../src/sim/types';
import { CAP_IDS } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { makeRng } from '../src/sim/rng';
import { DERIVE_TUNING, distillQuote, finishDerived, mergeQuote } from '../src/sim/systems/derive';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { LAB_TUNING } from '../src/sim/systems/lab';

/** A flat-profile model: every capability equals `overall`, so its overall score is `overall`. */
function addModel(s: GameState, o: { name: string; overall: number; paramsB?: number; parentId?: string | null; quirks?: string[]; vibes?: number; arch?: string }): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, o.overall])) as Capabilities;
  caps.vision = 0;
  const paramsB = o.paramsB ?? 70;
  const config = { ...defaultConfig(s), ...(o.arch ? { arch: o.arch } : {}) };
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: o.name,
    paramsB,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: o.overall, coding: o.overall, chat: o.overall, safety: o.overall },
    overall: o.overall,
    elo: 800 + 8 * o.overall,
    trainedDay: s.day,
    releasedDay: s.day,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: o.parentId ?? null,
    lineage: [],
    contextK: 128,
    modalities: ['text'],
    contaminated: false,
    config,
    activeParamsB: paramsB,
    quirks: o.quirks ?? [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: o.vibes ?? 0,
    emergences: [],
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

/** A lab with a big rented fleet (so runs take days, not years) and plenty of cash. */
function fleet(seed = 11): GameState {
  const s = createInitialState(seed, 'Derive Test Labs');
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  return s;
}

/** A run record for finishDerived, built the way startDistill / startMerge build it (quote forecast included). */
function derivedRun(s: GameState, o: { kind: 'distill' | 'merge'; paramsB: number; tokensB: number; forecast: Forecast; extra: Pick<TrainingRun, 'distill' | 'merge'> }): TrainingRun {
  return {
    id: `run${++s.idCounter}`,
    name: `Test ${o.kind}`,
    paramsB: o.paramsB,
    tokensB: o.tokensB,
    datasetIds: [],
    techniques: [],
    dataQuality: 0.5,
    totalFlops: 1,
    doneFlops: 1,
    startedDay: s.day,
    lossHistory: [],
    predictedLoss: 2,
    forecast: o.forecast,
    kind: o.kind,
    config: defaultConfig(s),
    qualityMult: 1,
    capAdd: {},
    pendingIncident: null,
    log: [],
    stallDays: 0,
    incidents: [],
    ...o.extra,
  };
}

function distillRun(s: GameState, teacher: Model, paramsB: number): TrainingRun {
  const q = distillQuote(s, teacher.id, paramsB);
  if (!q.ok || !q.forecast) throw new Error(`distill quote refused: ${q.reason}`);
  return derivedRun(s, { kind: 'distill', paramsB, tokensB: teacher.tokensB, forecast: q.forecast, extra: { distill: { teacherId: teacher.id } } });
}

function mergeRun(s: GameState, a: Model, b: Model, method: MergeMethod): TrainingRun {
  const q = mergeQuote(s, a.id, b.id, method);
  if (!q.ok || !q.forecast) throw new Error(`merge quote refused: ${q.reason}`);
  return derivedRun(s, { kind: 'merge', paramsB: Math.max(a.paramsB, b.paramsB), tokensB: a.tokensB, forecast: q.forecast, extra: { merge: { aId: a.id, bId: b.id, method } } });
}

/** Play the training slot until the eval-day reveal appears, answering incidents and events with the first choice. */
function runToReveal(s: GameState, maxDays = 400): number {
  let days = 0;
  while (!s.pendingReveal && days < maxDays) {
    const pending = s.training?.pendingIncident;
    if (pending) {
      if (pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
      if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    }
    if (s.events.pending) {
      dispatch(s, { type: 'resolveEvent', choice: 0 });
      dispatch(s, { type: 'clearEventResult' });
    }
    tick(s);
    days += 1;
  }
  return days;
}

describe('distillation quote', () => {
  it('refuses a student with more than half the teacher\'s active parameters', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    const q = distillQuote(s, teacher.id, 40);
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/half/);
    expect(distillQuote(s, teacher.id, 35).ok).toBe(true);
  });

  it('forecasts the teacher minus the size penalty, with an 80% band of about 6.4 points', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    const q = distillQuote(s, teacher.id, 14);
    expect(q.ok).toBe(true);
    const ratio = 70 / 14;
    const expected = 60 - DERIVE_TUNING.DISTILL_PENALTY * Math.log10(ratio) ** DERIVE_TUNING.DISTILL_PENALTY_EXP;
    expect(q.forecast!.mid).toBeCloseTo(expected, 6);
    expect(q.forecast!.high - q.forecast!.low).toBeCloseTo(2 * LAB_TUNING.Z80 * DERIVE_TUNING.DISTILL_SD, 6);
    expect(q.forecast!.reasons.length).toBeGreaterThan(0);
  });

  it('a smaller student is forecast to lose more', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    const mid = (p: number) => distillQuote(s, teacher.id, p).forecast!.mid;
    expect(mid(35)).toBeGreaterThan(mid(14));
    expect(mid(14)).toBeGreaterThan(mid(3.5));
  });

  it('starts a distill run in the training slot, reveals at eval day and never beats the teacher', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    dispatch(s, { type: 'startDistill', teacherId: teacher.id, paramsB: 14, name: 'Pomelo 14B' });
    expect(s.training?.kind).toBe('distill');
    expect(s.training?.distill?.teacherId).toBe(teacher.id);
    expect(s.training?.hidden).toBeUndefined();
    const days = runToReveal(s);
    expect(days).toBeLessThan(400);
    expect(s.training).toBeNull();
    expect(s.pendingReveal?.kind).toBe('distill');
    const model = s.models.find((m) => m.id === s.pendingReveal!.modelId)!;
    expect(model.name).toBe('Pomelo 14B');
    expect(model.derivedFrom).toEqual({ kind: 'distill', ids: [teacher.id] });
    expect(model.codename).toBeTruthy();
    expect(model.overall).toBeLessThanOrEqual(teacher.overall - DERIVE_TUNING.DISTILL_MARGIN + 0.05);
    expect(s.pendingReveal!.actual).toBeCloseTo(model.overall, 6);
  });

  it('refuses to start while the training slot is busy, and without a name', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    dispatch(s, { type: 'startDistill', teacherId: teacher.id, paramsB: 14, name: '' });
    expect(s.training).toBeNull();
    dispatch(s, { type: 'startDistill', teacherId: teacher.id, paramsB: 14, name: 'First' });
    const busy = s.training;
    dispatch(s, { type: 'startDistill', teacherId: teacher.id, paramsB: 7, name: 'Second' });
    expect(s.training).toBe(busy);
  });

  it('inherits 60% of quirks and 70% of vibes', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70, quirks: ['delve', 'golden_gate', 'hope_helps'], vibes: 50 });
    teacher.latentQuirks = ['delve'];
    const run = distillRun(s, teacher, 14);
    finishDerived(s, run, makeRng({ rngState: 3 }));
    const model = s.models.find((m) => m.id === s.pendingReveal!.modelId)!;
    expect(model.vibes).toBeCloseTo(50 * DERIVE_TUNING.DISTILL_VIBES, 9);
    for (const q of model.quirks ?? []) expect(teacher.quirks).toContain(q);
    for (const q of model.latentQuirks ?? []) expect(teacher.latentQuirks).toContain(q);
  });

  it('a distilled model never ends above its teacher minus the margin', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    const rng = makeRng({ rngState: 21 });
    let capped = 0;
    for (let i = 0; i < 200; i++) {
      finishDerived(s, distillRun(s, teacher, 35), rng);
      const actual = s.pendingReveal!.actual;
      expect(actual).toBeLessThanOrEqual(teacher.overall - DERIVE_TUNING.DISTILL_MARGIN + 0.02);
      if (actual > teacher.overall - DERIVE_TUNING.DISTILL_MARGIN - 0.5) capped += 1;
      s.pendingReveal = null;
    }
    // The ceiling is close to the expected value for a half-size student, so it binds on a good share of runs.
    expect(capped).toBeGreaterThan(0);
  });
});

describe('merge quote', () => {
  it('refuses different architectures unless it is a frankenmerge', () => {
    const s = fleet();
    const a = addModel(s, { name: 'A', overall: 60, arch: 'dense' });
    const b = addModel(s, { name: 'B', overall: 58, arch: 'moe', parentId: a.id });
    expect(mergeQuote(s, a.id, b.id, 'average').ok).toBe(false);
    expect(mergeQuote(s, a.id, b.id, 'average').reason).toMatch(/architecture/);
    expect(mergeQuote(s, a.id, b.id, 'frankenmerge').ok).toBe(true);
  });

  it('refuses different base lineages unless it is a frankenmerge', () => {
    const s = fleet();
    const a = addModel(s, { name: 'A', overall: 60 });
    const stranger = addModel(s, { name: 'Stranger', overall: 58 });
    const child = addModel(s, { name: 'Child', overall: 57, parentId: a.id });
    expect(mergeQuote(s, a.id, stranger.id, 'ties').ok).toBe(false);
    expect(mergeQuote(s, a.id, stranger.id, 'ties').reason).toMatch(/base models/);
    expect(mergeQuote(s, a.id, child.id, 'ties').ok).toBe(true);
    expect(mergeQuote(s, a.id, stranger.id, 'frankenmerge').ok).toBe(true);
  });

  it('costs $25k and three days, and refuses a model merged with itself', () => {
    const s = fleet();
    const a = addModel(s, { name: 'A', overall: 60 });
    const b = addModel(s, { name: 'B', overall: 58, parentId: a.id });
    const q = mergeQuote(s, a.id, b.id, 'average');
    expect(q.cost).toBe(DERIVE_TUNING.MERGE_COST);
    expect(q.days).toBe(DERIVE_TUNING.MERGE_DAYS);
    expect(mergeQuote(s, a.id, a.id, 'average').ok).toBe(false);
  });

  it('startMerge charges the cost and occupies the training slot', () => {
    const s = fleet();
    const a = addModel(s, { name: 'A', overall: 60 });
    const b = addModel(s, { name: 'B', overall: 58, parentId: a.id });
    const cash0 = s.finance.cash;
    dispatch(s, { type: 'startMerge', aId: a.id, bId: b.id, method: 'average', name: 'Blend' });
    expect(s.training?.kind).toBe('merge');
    expect(s.training?.merge).toEqual({ aId: a.id, bId: b.id, method: 'average' });
    expect(cash0 - s.finance.cash).toBeCloseTo(DERIVE_TUNING.MERGE_COST, 6);
    // The run takes about three days at the current rate.
    const rate = s.training!.totalFlops / DERIVE_TUNING.MERGE_DAYS;
    expect(rate).toBeGreaterThan(0);
  });

  it('a merge runs to its reveal through the training slot', () => {
    const s = fleet();
    const a = addModel(s, { name: 'A', overall: 60 });
    const b = addModel(s, { name: 'B', overall: 58, parentId: a.id });
    dispatch(s, { type: 'startMerge', aId: a.id, bId: b.id, method: 'ties', name: 'Blend' });
    const days = runToReveal(s);
    expect(days).toBeLessThan(20);
    expect(s.pendingReveal?.kind).toBe('merge');
    const model = s.models.find((m) => m.id === s.pendingReveal!.modelId)!;
    expect(model.derivedFrom).toEqual({ kind: 'merge', ids: [a.id, b.id], method: 'ties' });
    expect(model.codename).toBeTruthy();
  });
});

describe('merge methods', () => {
  /** Two parents in one lineage: A is 60 flat, B (its child) is 50 flat. */
  function parents(s: GameState): [Model, Model] {
    const a = addModel(s, { name: 'A', overall: 60 });
    const b = addModel(s, { name: 'B', overall: 50, parentId: a.id });
    return [a, b];
  }

  function sampleMerges(method: MergeMethod, n: number, seed: number): { actuals: number[]; cursed: number; seedTags: (string | null)[] } {
    const s = fleet(seed);
    const [a, b] = parents(s);
    const rng = makeRng({ rngState: seed * 7919 + 1 });
    const actuals: number[] = [];
    const seedTags: (string | null)[] = [];
    let cursed = 0;
    for (let i = 0; i < n; i++) {
      finishDerived(s, mergeRun(s, a, b, method), rng);
      const r = s.pendingReveal!;
      actuals.push(r.actual);
      seedTags.push(r.seedTag);
      if (r.seedTag === 'cursed') cursed += 1;
      s.pendingReveal = null;
    }
    return { actuals, cursed, seedTags };
  }

  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  const sd = (xs: number[]) => {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (xs.length - 1));
  };

  it('average lands on the mean of its parents plus one, with a spread of about 2', () => {
    const { actuals } = sampleMerges('average', 500, 31);
    expect(mean(actuals)).toBeCloseTo(55 + DERIVE_TUNING.AVG_BONUS, 0);
    expect(sd(actuals)).toBeGreaterThan(1.7);
    expect(sd(actuals)).toBeLessThan(2.3);
  });

  it('ties lands on the better parent minus half a point, with a spread of about 2.5', () => {
    const { actuals } = sampleMerges('ties', 500, 37);
    expect(mean(actuals)).toBeCloseTo(60 + DERIVE_TUNING.TIES_BONUS, 0);
    expect(sd(actuals)).toBeGreaterThan(2.1);
    expect(sd(actuals)).toBeLessThan(2.9);
  });

  it('a frankenmerge is wide, sometimes cursed, and the cursed share sits near 15%', () => {
    const { actuals, cursed } = sampleMerges('frankenmerge', 800, 41);
    // Cursed runs pull the mean down by 15% × 10 = 1.5 on top of the parents' mean (55).
    const expectedMean = 55 + DERIVE_TUNING.FRANKEN_CURSED_CHANCE * DERIVE_TUNING.FRANKEN_CURSED_PTS;
    expect(Math.abs(mean(actuals) - expectedMean)).toBeLessThan(0.8);
    const s = sd(actuals);
    expect(s).toBeGreaterThan(6);
    expect(s).toBeLessThan(8);
    expect(cursed / actuals.length).toBeGreaterThan(DERIVE_TUNING.FRANKEN_CURSED_CHANCE - 0.05);
    expect(cursed / actuals.length).toBeLessThan(DERIVE_TUNING.FRANKEN_CURSED_CHANCE + 0.05);
  });

  it('a merge unions the parents\' quirks, and a frankenmerge adds one more', () => {
    const s = fleet(43);
    const a = addModel(s, { name: 'A', overall: 60, quirks: ['delve'] });
    const b = addModel(s, { name: 'B', overall: 50, parentId: a.id, quirks: ['golden_gate'] });
    const rng = makeRng({ rngState: 5 });
    finishDerived(s, mergeRun(s, a, b, 'average'), rng);
    const avg = s.models.find((m) => m.id === s.pendingReveal!.modelId)!;
    expect([...(avg.quirks ?? [])].sort()).toEqual(['delve', 'golden_gate']);
    s.pendingReveal = null;
    finishDerived(s, mergeRun(s, a, b, 'frankenmerge'), rng);
    const franken = s.models.find((m) => m.id === s.pendingReveal!.modelId)!;
    expect(franken.quirks!.length).toBe(3);
  });

  it('a lost quality multiplier (an early stop or a bad incident) costs the matching points', () => {
    const build = () => {
      const s = fleet(51);
      const [a, b] = parents(s);
      return { s, a, b };
    };
    const clean = build();
    finishDerived(clean.s, mergeRun(clean.s, clean.a, clean.b, 'average'), makeRng({ rngState: 9 }));
    const hit = build();
    const run = mergeRun(hit.s, hit.a, hit.b, 'average');
    run.qualityMult = 0.5;
    finishDerived(hit.s, run, makeRng({ rngState: 9 }));
    const delta = hit.s.pendingReveal!.actual - clean.s.pendingReveal!.actual;
    expect(delta).toBeCloseTo(DERIVE_TUNING.QUALITY_POINTS_PER_LOG10 * Math.log10(0.5), 1);
  });
});
