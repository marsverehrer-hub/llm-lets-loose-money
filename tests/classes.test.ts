// v8 playstyles (GAME_DESIGN §19.2): weight classes, rival small lines, efficiency benchmarks, class crowns,
// the class arena and bench tuning.
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Aha moments are covered in moments.test.ts. Here they would pause the sim mid-test, so they are stubbed out.
vi.mock('../src/sim/systems/moments', () => ({ momentsTick: () => {}, handlers: {} }));
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import { BENCHMARKS } from '../src/sim/data/benchmarks';
import { quirkById } from '../src/sim/data/quirks';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, GameState, Model } from '../src/sim/types';
import {
  activeBenchmarks,
  benchmarkById,
  benchmarkResult,
  competitorModelCaps,
  efficiencyFactor,
  evaluateModel,
  overallScore,
  rivalFlagshipActiveB,
  scoresFromCaps,
} from '../src/sim/systems/capabilities';
import {
  WEIGHT_CLASSES,
  benchTuneQuote,
  classArena,
  classOf,
  classThresholds,
  classesTick,
  frontierActiveParamsB,
  playerCrownCounts,
  playerHoldsCrown,
  rivalLines,
} from '../src/sim/systems/classes';

/** Day number for 1 January of a calendar year (day 0 = 2017-01-01). */
function dayOf(year: number): number {
  return Math.round((Date.UTC(year, 0, 1) - Date.UTC(2017, 0, 1)) / 86_400_000);
}

/** Clears what blocks the sim (events, reveals, moments) so ticks advance. */
function clearBlockers(s: GameState): void {
  if (s.events.pending && s.events.pending.result === undefined) {
    dispatch(s, { type: 'resolveEvent', choice: 0 });
    dispatch(s, { type: 'clearEventResult' });
  }
  if (s.pendingReveal) dispatch(s, { type: 'dismissReveal' });
  if (s.pendingMoment) dispatch(s, { type: 'dismissMoment' });
}

function advanceTo(s: GameState, day: number): void {
  let stuck = 0;
  while (s.day < day && !s.gameOver && stuck < 50) {
    const before = s.day;
    clearBlockers(s);
    tick(s);
    stuck = s.day === before ? stuck + 1 : 0;
  }
}

function world(year: number, seed = 5): GameState {
  const s = createInitialState(seed, 'Classes');
  s.finance.cash = 1e13;
  s.tutorialStep = -1;
  advanceTo(s, dayOf(year));
  return s;
}

function all(v: number): Capabilities {
  const c = {} as Capabilities;
  for (const k of CAP_IDS) c[k] = v;
  return c;
}

/** Adds a model with the given caps and active size. Released models count in the contests; unreleased ones do not. */
function addModel(s: GameState, caps: Capabilities, activeParamsB: number, name: string, released = true): Model {
  const scores = scoresFromCaps(caps);
  const overall = overallScore(scores);
  const m: Model = {
    id: `cl${s.idCounter++}`,
    name,
    paramsB: activeParamsB,
    activeParamsB,
    tokensB: 10,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores,
    overall,
    elo: 800 + overall * 8,
    trainedDay: s.day - 30,
    releasedDay: released ? s.day - 5 : null,
    deprecated: false,
    caps: { ...caps },
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

/** Forces a crown pass by moving to a multiple of seven days. */
function crownPass(s: GameState): void {
  s.day = Math.ceil(s.day / 7) * 7;
  classesTick(s, makeRng(s));
}

let base2025: GameState;
beforeAll(() => {
  base2025 = world(2025);
}, 120_000);

const clone = (): GameState => structuredClone(base2025);

describe('weight classes', () => {
  it('classes follow the frontier thresholds, and a model competes in its own class and larger ones', () => {
    const y = 2024;
    const t = classThresholds(y);
    const f = frontierActiveParamsB(y);
    expect(t.nano).toBeCloseTo(f / 40);
    expect(t.small).toBeCloseTo(f / 8);
    expect(t.medium).toBeCloseTo(f / 3);
    expect(WEIGHT_CLASSES).toEqual(['nano', 'small', 'medium', 'open']);
    expect(classOf(y, 1)).toBe('nano');
    expect(classOf(y, t.nano)).toBe('nano');
    expect(classOf(y, t.nano * 1.01)).toBe('small');
    expect(classOf(y, t.small)).toBe('small');
    expect(classOf(y, t.small * 1.01)).toBe('medium');
    expect(classOf(y, t.medium * 1.01)).toBe('open');
    // The UI example: "Small: up to 23B active in 2024".
    expect(t.small).toBeGreaterThan(20);
    expect(t.small).toBeLessThan(26);
  });

  it('the frontier grows year on year, and the bot-sized 2021 MoE runs are open class', () => {
    expect(frontierActiveParamsB(2018)).toBeLessThan(frontierActiveParamsB(2024));
    expect(frontierActiveParamsB(2024)).toBeLessThan(frontierActiveParamsB(2030));
    expect(frontierActiveParamsB(2017)).toBeGreaterThanOrEqual(1);
    expect(classOf(2021, 425)).toBe('open');
    expect(classOf(2018, 66)).toBe('open');
  });
});

describe('rival lines', () => {
  it('labs ship their small and medium lines on schedule, with house-style names and a gap below the flagship', () => {
    const s = clone();
    const lines = rivalLines(s);
    const keys = Object.keys(s.classes?.rivalLines ?? {});
    expect(keys).toContain('metaverse_llama:small');
    expect(keys).toContain('mistrial:small');
    expect(keys).toContain('mistrial:medium');
    expect(keys).toContain('openaye:small');
    expect(keys).toContain('deepseekers:small');
    expect(keys.every((k) => /^[a-z_]+:(nano|small|medium)$/.test(k))).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(5);

    const byKey = (k: string) => s.classes!.rivalLines[k];
    expect(byKey('metaverse_llama:small').name).toMatch(/^Llamaish \d+(\.\d+)? \d+B$/);
    expect(byKey('mistrial:small').name).toMatch(/^Mistrial Small \d/);
    expect(byKey('openaye:small').name).toMatch(/ mini$/);
    expect(byKey('deepseekers:small').name).toMatch(/-Lite$/);

    for (const line of lines) {
      const flagship = s.competitors.find((c) => c.id === line.labId)?.model;
      expect(flagship, line.labId).toBeDefined();
      const gap = flagship!.overall - line.overall;
      expect(gap, `${line.name} gap`).toBeGreaterThan(0);
      expect(gap, `${line.name} gap`).toBeLessThan(20);
      expect(classOf(2025, line.activeParamsB), line.name).toBe(line.weightClass);
    }
  }, 120_000);

  it('rival flagships are scored at their estimated size, so their efficiency numbers match the estimate', () => {
    const s = clone();
    const lat = benchmarkById('latency_arena')!;
    for (const c of s.competitors) {
      if (!c.model?.benchmarks) continue;
      const expected = benchmarkResult(lat, competitorModelCaps(c), false, { activeParamsB: rivalFlagshipActiveB(c), year: 2025 });
      expect(c.model.benchmarks.latency_arena, c.id).toBeCloseTo(expected, 1);
    }
  }, 120_000);
});

describe('efficiency benchmarks', () => {
  it('five efficiency benchmarks with exponents between 0.25 and 0.5 are in the catalogue', () => {
    const eff = BENCHMARKS.filter((b) => b.efficiency !== undefined);
    expect(eff.map((b) => b.id).sort()).toEqual(['edgebench', 'latency_arena', 'mobile_mmlu', 'pocket_agent', 'tokens_per_watt'].sort());
    for (const b of eff) {
      expect(b.efficiency!, b.id).toBeGreaterThanOrEqual(0.25);
      expect(b.efficiency!, b.id).toBeLessThanOrEqual(0.5);
      expect(b.flavor.length, b.id).toBeGreaterThan(10);
    }
  });

  it('efficiency benchmarks favour small models: the same caps score higher at a small size than at a giant size', () => {
    const caps = all(70);
    const lat = benchmarkById('latency_arena')!;
    expect(efficiencyFactor(lat, 2, 2024)).toBeCloseTo(1.15);
    expect(efficiencyFactor(lat, 300, 2024)).toBeCloseTo(0.35);
    const small = benchmarkResult(lat, caps, false, { activeParamsB: 2, year: 2024 });
    const giant = benchmarkResult(lat, caps, false, { activeParamsB: 300, year: 2024 });
    expect(small).toBeGreaterThan(giant);
    // Ordinary benchmarks ignore size.
    const mmlu = benchmarkById('mmlu')!;
    expect(benchmarkResult(mmlu, caps, false, { activeParamsB: 300, year: 2024 })).toBe(benchmarkResult(mmlu, caps));
  });

  it('player models with a small active size are scored with the efficiency factor', () => {
    const s = clone();
    const m = addModel(s, all(70), 2, 'Tiny Efficient');
    const lat = benchmarkById('latency_arena')!;
    expect(m.benchmarks!.latency_arena).toBeCloseTo(benchmarkResult(lat, m.caps!, false, { activeParamsB: 2, year: 2025 }), 1);
    expect(activeBenchmarks(s).some((b) => b.id === 'latency_arena')).toBe(true);
  });
});

describe('class crowns and the class arena', () => {
  it('the player takes a class crown with a small strong model, and the first crown pays out once', () => {
    const s = clone();
    const m = addModel(s, all(100), 2, 'Pocket Ottr');
    const brandBefore = s.company.brand;
    const hypeBefore = s.company.hype;
    crownPass(s);
    const won = s.classes!.crowns.filter((c) => c.holder === 'player' && c.modelName === m.name);
    expect(won.length).toBeGreaterThan(0);
    expect(playerHoldsCrown(s, won.map((c) => c.benchId))).toBe(true);
    // Brand +1 and hype +1.5 for each first-time bench x class crown.
    const firsts = Object.keys(s.flags).filter((k) => k.startsWith('crownFirst.')).length;
    expect(firsts).toBeGreaterThan(0);
    expect(s.company.brand - brandBefore).toBeCloseTo(firsts);
    expect(s.company.hype - hypeBefore).toBeCloseTo(1.5 * firsts);
    expect(s.news.some((n) => n.text.startsWith('Your Pocket Ottr takes the'))).toBe(true);
    // A second pass with nothing new pays nothing more.
    crownPass(s);
    expect(s.company.brand - brandBefore).toBeCloseTo(firsts);
  }, 120_000);

  it('the crown counts by category count benchmarks the player holds, with efficiency kept apart', () => {
    const s = clone();
    addModel(s, all(100), 2, 'Pocket Ottr');
    crownPass(s);
    const counts = playerCrownCounts(s);
    const total = Object.values(counts).reduce((t, n) => t + (n ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    for (const v of Object.values(counts)) expect(v).toBeGreaterThan(0);
  }, 120_000);

  it('the class arena is sorted by Elo, and a class contains only the models that compete in it', () => {
    const s = clone();
    addModel(s, all(90), 2, 'Pocket Ottr');
    addModel(s, all(90), 400, 'Giant Ottr');
    const nano = classArena(s, 'nano');
    const open = classArena(s, 'open');
    expect(open.length).toBeGreaterThan(nano.length);
    for (let i = 0; i + 1 < nano.length; i++) expect(nano[i].elo).toBeGreaterThanOrEqual(nano[i + 1].elo);
    expect(nano.every((r) => r.weightClass === 'nano')).toBe(true);
    expect(nano.some((r) => r.name === 'Pocket Ottr')).toBe(true);
    expect(nano.some((r) => r.name === 'Giant Ottr')).toBe(false);
    expect(open.some((r) => r.name === 'Giant Ottr')).toBe(true);
  });
});

describe('bench tuning', () => {
  it('a tune raises the targeted benchmark after 12 days and gains diminish on repeats', () => {
    const s = clone();
    const m = addModel(s, all(55), 20, 'Unreleased Tune', false);
    const bench = 'gsm8k';
    const q1 = benchTuneQuote(s, m.id, bench);
    expect(q1.ok).toBe(true);
    expect(q1.days).toBe(12);
    expect(q1.cost).toBeGreaterThan(0);
    expect(q1.expectedGain).toBeGreaterThan(0);

    const before = m.benchmarks![bench];
    const cashBefore = s.finance.cash;
    dispatch(s, { type: 'benchTune', modelId: m.id, benchId: bench });
    expect(s.finance.cash).toBeCloseTo(cashBefore - q1.cost);
    expect(s.classes!.benchTunes).toHaveLength(1);
    expect(s.classes!.benchTunes[0].doneDay).toBe(s.day + 12);

    s.day += 12;
    classesTick(s, makeRng(s));
    expect(s.classes!.benchTunes).toHaveLength(0);
    expect(m.benchmarks![bench]).toBeGreaterThan(before);
    expect(m.benchRuns?.[bench]).toBeDefined();

    const q2 = benchTuneQuote(s, m.id, bench);
    expect(q2.ok).toBe(true);
    expect(q2.expectedGain).toBeGreaterThan(0);
    expect(q2.expectedGain).toBeLessThan(q1.expectedGain);
  }, 60_000);

  it('a tune is refused for public models, unknown benchmarks, and a second tune while one is running', () => {
    const s = clone();
    const hidden = addModel(s, all(55), 20, 'Hidden', false);
    const pub = addModel(s, all(55), 20, 'Public', true);
    expect(benchTuneQuote(s, pub.id, 'gsm8k').ok).toBe(false);
    expect(benchTuneQuote(s, hidden.id, 'no_such_bench').ok).toBe(false);
    expect(benchTuneQuote(s, hidden.id, 'gsm8k').ok).toBe(true);
    dispatch(s, { type: 'benchTune', modelId: hidden.id, benchId: 'gsm8k' });
    expect(benchTuneQuote(s, hidden.id, 'gsm8k').ok).toBe(false);
    s.finance.cash = 0;
    expect(benchTuneQuote(s, hidden.id, 'mmlu').ok).toBe(false);
  });

  it('the benchmark-shaped quirk is defined but never rolled by pretraining', () => {
    const q = quirkById('benchmark_shaped');
    expect(q).toBeDefined();
    expect(q!.weight({} as never)).toBe(0);
  });
});
