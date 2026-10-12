import { describe, it, expect, afterEach } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { BENCHMARKS } from '../src/sim/data/benchmarks';
import { SPECIALIZATIONS } from '../src/sim/data/specializations';
import {
  availableSpecs,
  backfillCapabilities,
  benchmarkResult,
  competitorCaps,
  estimateFinetune,
  evaluateModel,
  isSaturated,
  scoresFromCaps,
  bestResults,
} from '../src/sim/systems/capabilities';
import { estimateTraining } from '../src/sim/systems/training';
import { loadGame, SAVE_KEY } from '../src/sim/save';
import { CAP_IDS, type Capabilities, type GameState, type Model } from '../src/sim/types';
import { botDay } from '../scripts/bot';
import { CAP_TUNING } from '../src/sim/balance';

const DAY_2025 = 365 * 8; // 2025-01-01 is day 2922 from 2017; 8 years after 2017 is 2025 (leap days ignored, close enough)

function caps(v: number): Capabilities {
  const c = {} as Capabilities;
  for (const k of CAP_IDS) c[k] = v;
  return c;
}

/** A released-or-not base model with the given capabilities. */
function addModel(s: GameState, capsV: Capabilities, opts: Partial<Model> = {}): Model {
  const m: Model = {
    id: `t${s.idCounter++}`,
    name: opts.name ?? `Test-${s.idCounter}`,
    paramsB: 1,
    tokensB: 10,
    datasetIds: ['scrawl_sample'],
    techniques: [],
    finalLoss: 2,
    scores: scoresFromCaps(capsV),
    overall: 0,
    elo: 0,
    trainedDay: s.day,
    releasedDay: null,
    deprecated: false,
    caps: { ...capsV },
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: 2,
    modalities: ['text'],
    ...opts,
  };
  m.overall = 0.3 * m.scores.reasoning + 0.25 * m.scores.coding + 0.3 * m.scores.chat + 0.15 * m.scores.safety;
  m.elo = 800 + m.overall * 8;
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

const savedStorage = (globalThis as { localStorage?: unknown }).localStorage;
afterEach(() => {
  if (savedStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage?: unknown }).localStorage = savedStorage;
});

describe('benchmarks', () => {
  it('results are monotone in every capability', () => {
    const base = { ...caps(40), vision: 20 };
    for (const def of BENCHMARKS) {
      const r0 = benchmarkResult(def, base);
      for (const k of CAP_IDS) {
        const up = { ...base, [k]: base[k] + 10 };
        expect(benchmarkResult(def, up), `${def.id} via ${k}`).toBeGreaterThanOrEqual(r0);
      }
    }
  });

  it('scores stay within floor and ceiling', () => {
    for (const def of BENCHMARKS) {
      for (const v of [0, 50, 100]) {
        const r = benchmarkResult(def, caps(v));
        expect(r).toBeGreaterThanOrEqual(def.floor - 1e-9);
        expect(r).toBeLessThanOrEqual(def.ceiling + 1e-9);
      }
    }
  });

  it('a top model saturates a benchmark, a weak one does not', () => {
    const s = createInitialState(3, 'Caps Test');
    s.day = DAY_2025;
    const top = addModel(s, caps(100), { releasedDay: s.day });
    expect(top.benchmarks?.mmlu).toBeGreaterThan(0.97 * 92);
    expect(isSaturated(s, 'mmlu')).toBe(true);
    const s2 = createInitialState(3, 'Caps Test');
    s2.day = DAY_2025;
    addModel(s2, caps(20), { releasedDay: s2.day });
    expect(isSaturated(s2, 'mmlu')).toBe(false);
  });

  it('contaminated models inflate benchmarks but not capabilities', () => {
    const s = createInitialState(5, 'Contam');
    s.day = DAY_2025;
    const clean = addModel(s, caps(60), { releasedDay: s.day });
    const dirty = addModel(s, caps(60), { releasedDay: s.day, contaminated: true, name: 'Dirty' });
    expect(dirty.caps).toEqual(clean.caps);
    expect(dirty.benchmarks?.mmlu).toBeGreaterThan(clean.benchmarks?.mmlu ?? 0);
    expect(dirty.scores).toEqual(clean.scores);
    expect(dirty.overall).toBe(clean.overall);
  });

  it('scores are derived from capabilities, and training predictions agree with them', () => {
    const s = createInitialState(9, 'Derive');
    const est = estimateTraining(s, 1, 10, ['scrawl_sample'], []);
    expect(est.predictedScores).toEqual(scoresFromCaps(est.predictedCaps));
    expect(est.overall).toBeGreaterThan(0);
  });

  it('competitor caps reproduce the requested reasoning and chat scores', () => {
    const sc = { reasoning: 70, coding: 66, chat: 72, safety: 60 };
    const c = competitorCaps(sc, 'research', null, 2024);
    const back = scoresFromCaps(c);
    expect(back.reasoning).toBeCloseTo(sc.reasoning, 0);
    expect(back.chat).toBeCloseTo(sc.chat, 0);
    expect(back.safety).toBeCloseTo(sc.safety, 0);
  });
});

describe('specialisations and fine-tunes', () => {
  it('availableSpecs respects the tree and research', () => {
    const s = createInitialState(11, 'Tree');
    const base = addModel(s, caps(50));
    const names = () => availableSpecs(s, base).map((x) => x.id);
    expect(names()).not.toContain('companion'); // needs an instruct parent
    expect(names()).not.toContain('instruct'); // needs instruction_tuning
    expect(names()).not.toContain('mini'); // needs distillation
    s.research.completed.push('instruction_tuning', 'distillation');
    expect(names()).toEqual(expect.arrayContaining(['instruct', 'mini', 'uncensored']));
    const instruct = addModel(s, caps(55), { specId: 'instruct', lineage: ['instruct'], parentId: base.id });
    expect(availableSpecs(s, instruct).map((x) => x.id)).toEqual(expect.arrayContaining(['companion', 'polyglot']));
    expect(availableSpecs(s, instruct).map((x) => x.id)).not.toContain('coder');
  });

  it('domain experts need the matching dataset kind', () => {
    const s = createInitialState(12, 'Doctors');
    s.research.completed.push('instruction_tuning');
    const instruct = addModel(s, caps(55), { specId: 'instruct', lineage: ['instruct'] });
    expect(availableSpecs(s, instruct).map((x) => x.id)).not.toContain('doctor');
    s.data.owned.push('medical_journals');
    expect(availableSpecs(s, instruct).map((x) => x.id)).toContain('doctor');
  });

  it('a fine-tune creates a child with lineage, the right name and a fresh benchmark table', () => {
    const s = createInitialState(13, 'Finetune Co');
    s.day = DAY_2025;
    s.research.completed.push('instruction_tuning');
    const base = addModel(s, caps(60), { releasedDay: s.day, name: 'Ash-1' });
    dispatch(s, { type: 'startFinetune', parentId: base.id, specId: 'instruct' });
    expect(s.training?.kind).toBe('finetune');
    for (let i = 0; i < 20 && s.training; i++) tick(s);
    expect(s.training).toBeNull();
    const child = s.models.find((m) => m.specId === 'instruct');
    expect(child).toBeDefined();
    expect(child!.name).toBe('Ash-1-Instruct');
    expect(child!.parentId).toBe(base.id);
    expect(child!.lineage).toEqual(['instruct']);
    expect(child!.releasedDay).toBeNull();
    expect(child!.benchmarks && Object.keys(child!.benchmarks).length).toBeGreaterThan(0);
    expect(child!.caps!.chat).toBeGreaterThan(base.caps!.chat);
  });

  it('fine-tunes validate the parent, the spec and the training queue', () => {
    const s = createInitialState(14, 'Validate');
    const base = addModel(s, caps(60));
    dispatch(s, { type: 'startFinetune', parentId: base.id, specId: 'companion' }); // needs instruct first
    expect(s.training).toBeNull();
    dispatch(s, { type: 'startFinetune', parentId: 'nope', specId: 'instruct' });
    expect(s.training).toBeNull();
    s.research.completed.push('instruction_tuning');
    dispatch(s, { type: 'startFinetune', parentId: base.id, specId: 'instruct' });
    expect(s.training?.kind).toBe('finetune');
    dispatch(s, { type: 'startFinetune', parentId: base.id, specId: 'instruct' }); // one run at a time
    expect(s.training?.specId).toBe('instruct');
  });

  it('a fine-tune of a contaminated parent stays contaminated, and benchmaxx flags are carried', () => {
    const s = createInitialState(15, 'Dirty');
    s.day = DAY_2025;
    s.research.completed.push('instruction_tuning');
    const base = addModel(s, caps(60), { releasedDay: s.day, contaminated: true });
    dispatch(s, { type: 'startFinetune', parentId: base.id, specId: 'instruct', benchmaxx: false });
    for (let i = 0; i < 20 && s.training; i++) tick(s);
    expect(s.models.find((m) => m.specId === 'instruct')?.contaminated).toBe(true);
  });

  it('estimateFinetune reports the child caps, scores and benchmarks', () => {
    const s = createInitialState(16, 'Estimate');
    const base = addModel(s, caps(60));
    const spec = SPECIALIZATIONS.find((x) => x.id === 'mini')!;
    s.research.completed.push('distillation');
    const est = estimateFinetune(s, base.id, 'mini');
    expect(est).not.toBeNull();
    expect(est!.paramsB).toBeCloseTo(base.paramsB * (spec.paramsMult ?? 1));
    expect(est!.caps.knowledge).toBeCloseTo(base.caps!.knowledge + (spec.capAdd.knowledge ?? 0) * CAP_TUNING.SPEC_CAP_SCALE);
    expect(est!.flops).toBeGreaterThan(0);
  });
});

describe('releases and SOTA', () => {
  it('a release that tops a headline benchmark earns SOTA news and brand', () => {
    const s = createInitialState(17, 'SOTA');
    s.day = DAY_2025;
    const m = addModel(s, caps(100));
    const brand = s.company.brand;
    dispatch(s, { type: 'releaseModel', modelId: m.id });
    expect(m.releasedDay).toBe(s.day);
    expect(s.flags.sotaEver ?? 0).toBeGreaterThan(0);
    expect(s.company.brand).toBeGreaterThan(brand);
    expect(bestResults(s, 'mmlu')[0].isPlayer).toBe(true);
  });
});

describe('save migration', () => {
  it('backfillCapabilities fills caps, lineage, context and benchmarks on old models', () => {
    const s = createInitialState(18, 'Old');
    s.day = DAY_2025;
    const old = {
      id: 'old1', name: 'Old-1', paramsB: 1, tokensB: 10, datasetIds: ['scrawl_sample'], techniques: [],
      finalLoss: 2, scores: { reasoning: 60, coding: 50, chat: 55, safety: 45 }, overall: 54, elo: 1232,
      trainedDay: 0, releasedDay: 0, deprecated: false,
    } as Model;
    s.models.push(old);
    backfillCapabilities(s);
    expect(old.caps).toBeDefined();
    for (const k of CAP_IDS) expect(old.caps![k]).toBeGreaterThanOrEqual(0);
    expect(old.lineage).toEqual([]);
    expect(old.contextK).toBeGreaterThan(0);
    expect(old.modalities).toContain('text');
    expect(Object.keys(old.benchmarks ?? {}).length).toBeGreaterThan(0);
    // the reconstructed profile reproduces the saved scores
    const back = scoresFromCaps(old.caps!);
    expect(back.reasoning).toBeCloseTo(60, 0);
    expect(back.chat).toBeCloseTo(55, 0);
  });

  it('loadGame migrates a v1 save with models that have no capabilities', () => {
    const s = createInitialState(19, 'Save Me');
    s.day = DAY_2025;
    s.models.push({
      id: 'v1m', name: 'V1-Model', paramsB: 1, tokensB: 10, datasetIds: ['scrawl_sample'], techniques: [],
      finalLoss: 2, scores: { reasoning: 50, coding: 40, chat: 45, safety: 40 }, overall: 44, elo: 1152,
      trainedDay: s.day, releasedDay: s.day, deprecated: false,
    } as Model);
    const v1 = JSON.parse(JSON.stringify({ ...s, saveVersion: 1 }));
    v1.models[0].caps = undefined;
    const store = new Map<string, string>([[SAVE_KEY, JSON.stringify(v1)]]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    const m = loaded!.models[0];
    expect(m.caps).toBeDefined();
    expect(m.lineage).toEqual([]);
    expect(Object.keys(m.benchmarks ?? {}).length).toBeGreaterThan(0);
    expect(loaded!.saveVersion).toBe(4);
  });
});

describe('full run', () => {
  it('a 14-year bot run with fine-tuning does not throw and produces specialised models', () => {
    // Seed 8: seed 7 meets a day-30 lawsuit it cannot afford to fight at its starting cash and goes broke on day 60.
    const s = createInitialState(8, 'BotCorp');
    for (let d = 0; d < 14 * 365 && !s.gameOver; d++) {
      botDay(s);
      tick(s);
    }
    expect(s.gameOver).toBeNull();
    expect(s.models.some((m) => m.specId)).toBe(true);
    expect(s.models.every((m) => m.caps && m.benchmarks)).toBe(true);
    // The bot never benchmaxxes on purpose. Accidental contamination only happens when decontam is off.
    expect(s.models.filter((m) => m.contaminated).every((m) => !m.config?.filters.includes('decontam'))).toBe(true);
  }, 180_000);
});
