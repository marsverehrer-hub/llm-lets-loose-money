// Fog of training (GAME_DESIGN 16): belief-based forecasts, hidden truths, checkpoints, eval-day reveals,
// latent quirks, LR sweeps, audits, seed luck and determinism.
import { describe, it, expect, vi } from 'vitest';

// Aha moments are covered in moments.test.ts. Here they would pause the sim mid-test, so they are stubbed out.
vi.mock('../src/sim/systems/moments', () => ({ momentsTick: () => {}, handlers: {} }));
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import type { GameState, TrainingConfig } from '../src/sim/types';
import { estimateTraining } from '../src/sim/systems/training';
import { defaultConfig, configSignature } from '../src/sim/data/trainingOptions';
import { EMERGENCES } from '../src/sim/data/emergences';
import { makeRng } from '../src/sim/rng';
import { resolveRun } from '../src/sim/systems/trainingMath';
import { datasetById, trueQualityOf } from '../src/sim/systems/data';
import {
  emergenceJournal,
  forecastTraining,
  labOf,
  planEmergences,
  provisionalElo,
  rollPretrainHidden,
  rollSeedLuck,
  LAB_TUNING,
  sweepPointsFor,
  sweepRunning,
} from '../src/sim/systems/lab';
import { loadGame, SAVE_KEY } from '../src/sim/save';

const DATA = ['scrawl_sample', 'common_scrawl_full'];

function fleet(seed: number, research: string[] = []): GameState {
  const s = createInitialState(seed, 'Fog');
  s.research.completed.push(...research);
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  s.data.owned = [...DATA];
  return s;
}

function cfgWith(s: GameState, patch: Partial<TrainingConfig>): TrainingConfig {
  return { ...defaultConfig(s), ...patch };
}

/** Play the current run to the end (answering incidents and events with the first choice). Does not dismiss the reveal. */
function playRun(s: GameState, maxDays = 2000): number {
  let days = 0;
  while (s.training && days < maxDays) {
    const pending = s.training.pendingIncident;
    if (pending && pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    if (s.events.pending) {
      dispatch(s, { type: 'resolveEvent', choice: 0 });
      dispatch(s, { type: 'clearEventResult' });
    }
    tick(s);
    days += 1;
  }
  return days;
}

/** Tick n days, answering events and incidents as they come up, so the sim keeps moving. */
function advance(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (s.events.pending && s.events.pending.result === undefined) {
      dispatch(s, { type: 'resolveEvent', choice: 0 });
      dispatch(s, { type: 'clearEventResult' });
    }
    const pending = s.training?.pendingIncident;
    if (pending && pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    if (s.pendingReveal) dispatch(s, { type: 'dismissReveal' });
    tick(s);
  }
}

/** A finished pretrain with its reveal still pending. */
function finishedRun(seed: number): { s: GameState; run: NonNullable<GameState['training']> } {
  const s = fleet(seed, ['transformers']);
  const cfg = cfgWith(s, { precision: 'fp32', lr: 0.5 });
  dispatch(s, { type: 'startTraining', name: 'Fog run', paramsB: 30, tokensB: 300, datasetIds: DATA, techniques: [], config: cfg });
  const run = s.training!;
  playRun(s);
  return { s, run };
}

describe('hidden truths and the belief', () => {
  it('estimates report the belief: overall is the forecast mid', () => {
    const s = fleet(1, ['transformers']);
    const est = estimateTraining(s, 5, 100, DATA, []);
    expect(est.forecast).toBeDefined();
    expect(est.overall).toBe(est.forecast!.mid);
    expect(est.forecast!.reasons.length).toBeGreaterThan(0); // fresh lab: first run, no sweep, unaudited data
  });

  it('unverified data makes the believed quality differ from the true quality', () => {
    const s = fleet(2, ['transformers']);
    const cfg = cfgWith(s, {});
    const believed = resolveRun(s, 5, 100, DATA, [], cfg, 'belief').dataQuality;
    const truth = resolveRun(s, 5, 100, DATA, [], cfg, 'true').dataQuality;
    expect(Math.abs(believed - truth)).toBeGreaterThan(1e-6);
  });

  it('a run starts with a forecast that is not the hidden truth', () => {
    const s = fleet(3, ['transformers']);
    dispatch(s, { type: 'startTraining', name: 'Belief', paramsB: 5, tokensB: 100, datasetIds: DATA, techniques: [], config: cfgWith(s, {}) });
    const run = s.training!;
    expect(run.forecast).toBeDefined();
    expect(run.hidden).toBeDefined();
    expect(run.forecastLoss).toBeDefined();
    expect(run.forecast!.mid).not.toBeCloseTo(run.hidden!.trueOverall, 6);
  });

  it('verified data and a sweep narrow the forecast band', () => {
    const s = fleet(4, ['transformers']);
    const cfg = cfgWith(s, { precision: 'fp32' });
    const before = forecastTraining(s, 5, 100, DATA, [], cfg);
    const lab = labOf(s);
    lab.verifiedData.push(...DATA);
    lab.sweeps[cfg.arch] = [0.3, 0.5, 0.7].map((lr) => ({ lr, scale: Math.log10(5), reading: 1.0, day: 0 }));
    const after = forecastTraining(s, 5, 100, DATA, [], cfg);
    expect(after.high - after.low).toBeLessThan(before.high - before.low);
  });

  it('true dataset quality is a fixed, seeded offset of the claimed quality', () => {
    const a = fleet(5);
    const b = fleet(5);
    const c = fleet(6);
    const d = datasetById(a, 'common_scrawl_full')!;
    expect(trueQualityOf(a, d)).toBe(trueQualityOf(b, d));
    expect(trueQualityOf(a, d)).not.toBe(trueQualityOf(c, d));
    expect(trueQualityOf(a, d)).toBeGreaterThanOrEqual(0.05);
    expect(trueQualityOf(a, d)).toBeLessThanOrEqual(0.98);
  });

  it('a tiny run cannot reach any emergence threshold', () => {
    const s = fleet(7, ['transformers']);
    const cfg = cfgWith(s, {});
    const phys = resolveRun(s, 0.35, 7, ['scrawl_sample'], [], cfg, 'true');
    const plan = planEmergences(s, makeRng({ rngState: 7 }), cfg, ['scrawl_sample'], phys);
    expect(plan).toEqual([]);
    const h = rollPretrainHidden(s, makeRng({ rngState: 7 }), cfg, ['scrawl_sample'], phys);
    expect(h.emergencePlan).toEqual([]);
  });

  it('the emergence journal lists every emergence, with undiscovered rows hiding their details', () => {
    const s = fleet(8);
    const rows = emergenceJournal(s);
    expect(rows).toHaveLength(EMERGENCES.length);
    expect(rows.every((r) => r.found === null)).toBe(true);
  });
});

describe('runs', () => {
  it('checkpoints appear at 25, 50 and 75 percent', () => {
    const { run } = finishedRun(10);
    expect((run.checkpoints ?? []).map((c) => c.at)).toEqual([0.25, 0.5, 0.75]);
    for (const c of run.checkpoints ?? []) expect(c.band).toBeGreaterThan(0);
  });

  it('a finished run verifies the datasets it used', () => {
    const s = fleet(11, ['transformers']);
    expect(labOf(s).verifiedData).toEqual([]);
    dispatch(s, { type: 'startTraining', name: 'Verify', paramsB: 2, tokensB: 40, datasetIds: DATA, techniques: [], config: cfgWith(s, {}) });
    playRun(s);
    expect(labOf(s).verifiedData).toEqual(expect.arrayContaining(DATA));
    expect(s.pendingReveal?.dataSurprises[DATA[0]]).toBeDefined();
  });

  it('the eval reveal blocks the sim until dismissed', () => {
    const { s } = finishedRun(12);
    expect(s.training).toBeNull();
    expect(s.pendingReveal).not.toBeNull();
    expect(isBlocked(s)).toBe(true);
    const day = s.day;
    tick(s);
    tick(s);
    expect(s.day).toBe(day);
    dispatch(s, { type: 'dismissReveal' });
    expect(s.pendingReveal).toBeNull();
    expect(isBlocked(s)).toBe(false);
    tick(s);
    expect(s.day).toBe(day + 1);
  });

  it('the reveal carries the forecast, a verdict and the actual overall of the model', () => {
    const { s } = finishedRun(13);
    const rev = s.pendingReveal!;
    const m = s.models.find((x) => x.id === rev.modelId)!;
    expect(rev.kind).toBe('pretrain');
    expect(rev.actual).toBeCloseTo(m.overall, 9);
    expect(rev.forecast.mid).toBeGreaterThan(-50);
    expect(['banger', 'solid', 'as expected', 'mid', 'dud', 'cursed']).toContain(rev.verdict);
    expect(m.forecast).toEqual(rev.forecast);
  });

  it('the model is built from the true result: vibes are part of its Elo', () => {
    const { s } = finishedRun(14);
    const m = s.models[0];
    expect(m.vibes).toBeDefined();
    expect(m.elo - (800 + 8 * m.overall)).toBeCloseTo(m.vibes!, 6);
  });

  it('a finished run records its forecast loss beside the true one', () => {
    const { run } = finishedRun(15);
    expect(run.forecastLoss).toBeDefined();
    expect(run.predictedLoss).toBeDefined();
  });

  it('an audit verifies a dataset, costs at least $20k and takes ten days', () => {
    const s = fleet(16);
    const cash = s.finance.cash;
    dispatch(s, { type: 'auditDataset', datasetId: 'scrawl_sample' });
    expect(cash - s.finance.cash).toBeGreaterThanOrEqual(20_000);
    expect(s.flags['audit.scrawl_sample']).toBe(s.day + 10);
    advance(s, 10);
    expect(labOf(s).verifiedData).toContain('scrawl_sample');
  });
});

describe('after release', () => {
  it('latent quirks surface after release, one by one', () => {
    const { s } = finishedRun(20);
    dispatch(s, { type: 'dismissReveal' });
    const m = s.models[0];
    m.latentQuirks = ['delve', 'calls_friend'];
    m.quirks = [];
    dispatch(s, { type: 'releaseModel', modelId: m.id });
    expect(m.eloSettlesDay).toBe(m.releasedDay! + 21);
    advance(s, 400);
    expect(m.latentQuirks).toEqual([]);
    expect(m.quirks).toEqual(expect.arrayContaining(['delve', 'calls_friend']));
  });

  it('red-teaming reveals latent quirks privately, before release', () => {
    const { s } = finishedRun(21);
    dispatch(s, { type: 'dismissReveal' });
    const m = s.models[0];
    m.latentQuirks = ['delve', 'calls_friend'];
    m.quirks = [];
    const before = s.company.reputation;
    dispatch(s, { type: 'redTeamModel', modelId: m.id });
    expect(m.redTeam).toBeDefined();
    advance(s, 30);
    expect(m.redTeam).toBe(true);
    expect(m.latentQuirks).toEqual([]);
    expect(m.quirks).toEqual(expect.arrayContaining(['delve', 'calls_friend']));
    expect(s.company.reputation).toBe(before);
  });

  it('provisional Elo settles to the true Elo after the window', () => {
    const { s } = finishedRun(22);
    dispatch(s, { type: 'dismissReveal' });
    const m = s.models[0];
    dispatch(s, { type: 'releaseModel', modelId: m.id });
    const early = provisionalElo(s, m);
    expect(early.provisional).toBe(true);
    s.day = m.eloSettlesDay!;
    const late = provisionalElo(s, m);
    expect(late.provisional).toBe(false);
    expect(late.elo).toBeCloseTo(m.elo, 6);
  });
});

describe('sweeps', () => {
  it('an LR sweep adds one point per learning rate after a few days', () => {
    const s = fleet(30, ['transformers']);
    const cfg = cfgWith(s, {});
    const lrs = [0.3, 0.5, 0.7];
    dispatch(s, { type: 'runLrSweep', paramsB: 5, tokensB: 100, datasetIds: DATA, config: cfg, lrs });
    expect(sweepRunning(s, cfg.arch)).toBe(true);
    expect(sweepPointsFor(s, cfg.arch)).toHaveLength(0);
    advance(s, 6);
    expect(sweepPointsFor(s, cfg.arch)).toHaveLength(3);
    expect(sweepRunning(s, cfg.arch)).toBe(false);
  });

  it('a sweep needs two to six learning rates', () => {
    const s = fleet(31, ['transformers']);
    dispatch(s, { type: 'runLrSweep', paramsB: 5, tokensB: 100, datasetIds: DATA, config: cfgWith(s, {}), lrs: [0.5] });
    expect(sweepRunning(s, 'lstm')).toBe(false);
    expect(s.lab?.sweepJobs ?? []).toHaveLength(0);
  });
});

describe('seed luck', () => {
  it('golden and cursed tags occur at their tuned rates, and luck stays within bounds', () => {
    const rng = makeRng({ rngState: 424242 });
    let golden = 0;
    let cursed = 0;
    let min = Infinity;
    let max = -Infinity;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const r = rollSeedLuck(rng);
      if (r.seedTag === 'golden') golden += 1;
      if (r.seedTag === 'cursed') cursed += 1;
      min = Math.min(min, r.seedLuck);
      max = Math.max(max, r.seedLuck);
    }
    const T = LAB_TUNING;
    expect(golden / N).toBeGreaterThan(T.GOLDEN_CHANCE * 0.75);
    expect(golden / N).toBeLessThan(T.GOLDEN_CHANCE * 1.25);
    expect(cursed / N).toBeGreaterThan(T.CURSED_CHANCE * 0.75);
    expect(cursed / N).toBeLessThan(T.CURSED_CHANCE * 1.25);
    expect(min).toBeGreaterThanOrEqual(-T.LUCK_CAP);
    expect(max).toBeLessThanOrEqual(T.LUCK_CAP);
  });
});

describe('determinism and saves', () => {
  it('the same seed gives the same outcome: model, checkpoints and reveal', () => {
    const outcome = (seed: number) => {
      const { s, run } = finishedRun(seed);
      const m = s.models[0];
      return {
        overall: m.overall,
        elo: m.elo,
        quirks: m.quirks,
        latent: m.latentQuirks,
        checkpoints: (run.checkpoints ?? []).map((c) => c.reading),
        verdict: s.pendingReveal?.verdict,
      };
    };
    expect(outcome(77)).toEqual(outcome(77));
  });

  it('a v3 save gains a lab notebook, and its old models keep no latent quirks or vibes', () => {
    const s = createInitialState(90, 'Old');
    s.models.push({
      id: 'm1', name: 'Old model', paramsB: 1, tokensB: 10, datasetIds: ['scrawl_sample'], techniques: [], finalLoss: 2.4,
      scores: { reasoning: 40, coding: 40, chat: 40, safety: 40 }, overall: 40, elo: 1120, trainedDay: 0, releasedDay: 0,
      deprecated: false, config: cfgWith(s, {}),
    } as GameState['models'][number]);
    const v3 = JSON.parse(JSON.stringify(s));
    v3.saveVersion = 3;
    delete v3.lab;
    const store = new Map<string, string>([[SAVE_KEY, JSON.stringify(v3)]]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.saveVersion).toBe(4);
    expect(loaded!.lab).toBeDefined();
    expect(loaded!.lab!.runsByArch).toBeDefined();
    const m = loaded!.models[0];
    expect(m.latentQuirks).toBeUndefined();
    expect(m.vibes).toBeUndefined();
  });

  it('the config signature still distinguishes sheets used for ablations', () => {
    const s = fleet(91, ['transformers']);
    expect(configSignature(cfgWith(s, { lr: 0.2 }))).not.toBe(configSignature(cfgWith(s, { lr: 0.8 })));
  });
});
