// Deep training (GAME_DESIGN 13): run sheet gating, MoE cost, incidents, early stop, ablations, quirks, save migration.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import type { GameState, TrainingConfig } from '../src/sim/types';
import { estimateTraining, backfillTraining } from '../src/sim/systems/training';
import { defaultConfig, optionsByGroup, optionById, validateConfig, configSignature, legacyConfig } from '../src/sim/data/trainingOptions';
import { RUN_INCIDENTS, runIncidentById } from '../src/sim/data/runIncidents';
import { QUIRKS, rollQuirks } from '../src/sim/data/quirks';
import { makeRng } from '../src/sim/rng';
import { loadGame, SAVE_KEY } from '../src/sim/save';
import { botDay } from '../scripts/bot';
import { clusterEfficiency, computeCapacity } from '../src/sim/systems/compute';

const DATA = ['scrawl_sample', 'common_scrawl_full'];

/** A lab with a big rented fleet, a lot of cash and the given research, and enough data for big runs. */
function fleet(seed: number, research: string[] = []): GameState {
  const s = createInitialState(seed, 'Deep');
  s.research.completed.push(...research);
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  s.data.owned = [...DATA];
  return s;
}

function cfgWith(s: GameState, patch: Partial<TrainingConfig>): TrainingConfig {
  return { ...defaultConfig(s), ...patch };
}

/** Play the current run to the end, answering incidents with the first choice and events with the first choice. */
function playRun(s: GameState, maxDays = 2000): { days: number; incidents: number } {
  let days = 0;
  let incidents = 0;
  while (s.training && days < maxDays) {
    incidents = Math.max(incidents, s.training.incidents?.length ?? 0);
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
  return { days, incidents };
}

describe('run sheet options', () => {
  it('gates options by research and reports the reason', () => {
    const s = fleet(1);
    const prec = optionsByGroup(s, 'precision');
    const fp8 = prec.find((r) => r.option.id === 'fp8')!;
    expect(fp8.unlocked).toBe(false);
    expect(fp8.reason).toMatch(/FP8|research/i);
    s.research.completed.push('fp8_training');
    expect(optionsByGroup(s, 'precision').find((r) => r.option.id === 'fp8')!.unlocked).toBe(true);
  });

  it('LSTM is the only arch before transformers, and is superseded after', () => {
    const s = fleet(2);
    expect(defaultConfig(s).arch).toBe('lstm');
    const lstm = optionsByGroup(s, 'arch').find((r) => r.option.id === 'lstm')!;
    expect(lstm.unlocked).toBe(true);
    s.research.completed.push('transformers');
    expect(defaultConfig(s).arch).toBe('dense');
    expect(optionsByGroup(s, 'arch').find((r) => r.option.id === 'lstm')!.unlocked).toBe(false);
  });

  it('defaults pick the best unlocked options', () => {
    const s = fleet(3, ['transformers', 'bf16_training', 'wsd_schedule', 'adamw', 'tokenizer_100k', 'rope']);
    const cfg = defaultConfig(s);
    expect(cfg.precision).toBe('bf16');
    expect(cfg.schedule).toBe('wsd');
    expect(cfg.optimizer).toBe('adamw');
    expect(cfg.tokenizer).toBe('bpe_100k');
    expect(cfg.context).toBe('ctx_8k');
    expect(cfg.checkpointing).toBe('normal');
    expect(cfg.lr).toBe(0.5);
  });

  it('rejects a locked option and runs with a valid sheet start', () => {
    const s = fleet(4, ['transformers']);
    const locked = cfgWith(s, { precision: 'fp8' });
    expect(validateConfig(s, locked)).toMatch(/locked/);
    dispatch(s, { type: 'startTraining', name: 'Locked', paramsB: 1, tokensB: 20, datasetIds: DATA, techniques: [], config: locked });
    expect(s.training).toBeNull();
  });

  it('config signatures differ when the run sheet differs, and not when only the data mix differs', () => {
    const s = fleet(5, ['transformers']);
    const a = defaultConfig(s);
    expect(configSignature({ ...a, lr: 0.9 })).not.toBe(configSignature(a));
    expect(configSignature({ ...a, dataMix: { web: 3 } })).toBe(configSignature(a));
  });
});

describe('mixture of experts', () => {
  it('a MoE run costs fewer FLOPs than a dense run of the same total parameters', () => {
    const s = fleet(6, ['transformers', 'moe']);
    const dense = estimateTraining(s, 20, 100, DATA, [], cfgWith(s, { arch: 'dense' }));
    const moe = estimateTraining(s, 20, 100, DATA, [], cfgWith(s, { arch: 'moe', moeExperts: 64 }));
    expect(moe.totalFlops).toBeLessThan(dense.totalFlops);
    expect(moe.activeParamsB).toBeCloseTo(20 * 0.08, 6);
    expect(moe.instability).toBeGreaterThan(dense.instability); // routers are unstable until balanced
  });

  it('load-balancing research lowers MoE instability', () => {
    const s = fleet(7, ['transformers', 'moe']);
    const cfg = cfgWith(s, { arch: 'moe' });
    const before = estimateTraining(s, 5, 50, DATA, [], cfg).instability;
    s.research.completed.push('moe_load_balancing');
    expect(estimateTraining(s, 5, 50, DATA, [], cfg).instability).toBeLessThan(before);
  });
});

describe('precision and speed', () => {
  it('fp8 trains faster than bf16 but is less stable', () => {
    const s = fleet(8, ['transformers', 'bf16_training', 'fp8_training']);
    const bf16 = estimateTraining(s, 2, 40, DATA, [], cfgWith(s, { precision: 'bf16' }));
    const fp8 = estimateTraining(s, 2, 40, DATA, [], cfgWith(s, { precision: 'fp8' }));
    expect(fp8.days).toBeLessThan(bf16.days);
    expect(fp8.incidentRate).toBeGreaterThan(bf16.incidentRate);
  });

  it('over many seeded runs, fp8 finishes sooner and has more incidents per simulated day than bf16', () => {
    let bf16Days = 0;
    let bf16Incidents = 0;
    let fp8Days = 0;
    let fp8Incidents = 0;
    for (let seed = 1; seed <= 100; seed++) {
      for (const precision of ['bf16', 'fp8'] as const) {
        const s = fleet(seed, ['transformers', 'bf16_training', 'fp8_training']);
        const cfg = cfgWith(s, { precision });
        dispatch(s, { type: 'startTraining', name: `R${seed}`, paramsB: 30, tokensB: 300, datasetIds: DATA, techniques: [], config: cfg });
        expect(s.training).not.toBeNull();
        const r = playRun(s);
        if (precision === 'bf16') {
          bf16Days += r.days;
          bf16Incidents += r.incidents;
        } else {
          fp8Days += r.days;
          fp8Incidents += r.incidents;
        }
      }
    }
    expect(fp8Days).toBeLessThan(bf16Days);
    expect(fp8Incidents / fp8Days).toBeGreaterThan(bf16Incidents / bf16Days);
  });
});

describe('cluster efficiency', () => {
  it('a base cluster is fully efficient up to 256 GPUs and loses most of the rest without research', () => {
    const s = fleet(9);
    s.compute.rented = { p100: 256 };
    expect(clusterEfficiency(s).efficiency).toBeCloseTo(1, 9);
    s.compute.rented = { p100: 2560 };
    const ce = clusterEfficiency(s);
    expect(ce.maxEfficientGpus).toBe(256);
    expect(ce.efficiency).toBeLessThan(0.3);
    const before = computeCapacity(s).training;
    s.research.completed.push('zero_sharding');
    expect(computeCapacity(s).training).toBeGreaterThan(before);
  });
});

describe('incidents', () => {
  it('has about 14 incidents, each with 2 to 3 choices', () => {
    expect(RUN_INCIDENTS.length).toBeGreaterThanOrEqual(13);
    for (const d of RUN_INCIDENTS) {
      expect(d.choices.length).toBeGreaterThanOrEqual(2);
      expect(d.choices.length).toBeLessThanOrEqual(3);
      expect(runIncidentById(d.id)).toBe(d);
    }
  });

  it('an unresolved incident pauses the sim until it is resolved', () => {
    const s = fleet(10, ['transformers']);
    dispatch(s, { type: 'startTraining', name: 'Pause', paramsB: 5, tokensB: 100, datasetIds: DATA, techniques: [], config: cfgWith(s, { precision: 'fp32', lr: 0.5 }) });
    expect(s.training).not.toBeNull();
    // Force an incident on the next roll by making every day an incident day.
    const run = s.training!;
    run.pendingIncident = { defId: 'loss_spike', day: s.day };
    expect(isBlocked(s)).toBe(true);
    const day = s.day;
    tick(s);
    expect(s.day).toBe(day);
    expect(run.doneFlops).toBe(0);
    dispatch(s, { type: 'resolveRunIncident', choice: 1 });
    expect(run.pendingIncident?.result).toBeDefined();
    expect(isBlocked(s)).toBe(false);
    dispatch(s, { type: 'clearRunIncident' });
    expect(run.pendingIncident).toBeNull();
    tick(s);
    expect(s.day).toBe(day + 1);
  });

  it('an incident with a money choice refuses when the cash is not there', () => {
    const s = fleet(11, ['transformers']);
    s.finance.cash = 0;
    dispatch(s, { type: 'startTraining', name: 'Broke', paramsB: 5, tokensB: 100, datasetIds: DATA, techniques: [], config: cfgWith(s, {}) });
    const run = s.training!;
    run.pendingIncident = { defId: 'power_cap', day: s.day };
    const choice = runIncidentById('power_cap')!.choices.findIndex((c) => c.available);
    dispatch(s, { type: 'resolveRunIncident', choice });
    expect(run.pendingIncident.result).toBeUndefined();
  });
});

describe('early stop and extend', () => {
  it('a WSD run stopped early keeps more quality than a cosine run stopped at the same point', () => {
    const results: Record<string, number> = {};
    for (const schedule of ['cosine', 'wsd']) {
      const s = fleet(12, ['transformers', 'wsd_schedule']);
      const cfg = cfgWith(s, { schedule, precision: 'fp32', lr: 0.5 });
      dispatch(s, { type: 'startTraining', name: schedule, paramsB: 10, tokensB: 100, datasetIds: DATA, techniques: [], config: cfg });
      const total = s.training!.totalFlops;
      while (s.training && s.training.doneFlops < total * 0.5) {
        const pending = s.training.pendingIncident;
        if (pending && pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
        if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
        tick(s);
      }
      if (!s.training) throw new Error('run finished before the stop point');
      dispatch(s, { type: 'earlyStopTraining' });
      expect(s.training).toBeNull();
      results[schedule] = s.models[s.models.length - 1].overall;
    }
    expect(results.wsd).toBeGreaterThan(results.cosine);
  });

  it('extending a run adds tokens up to the data headroom', () => {
    const s = fleet(13, ['transformers']);
    dispatch(s, { type: 'startTraining', name: 'Ext', paramsB: 5, tokensB: 100, datasetIds: DATA, techniques: [], config: cfgWith(s, {}) });
    const before = s.training!.totalFlops;
    dispatch(s, { type: 'extendTraining', fraction: 0.2 });
    expect(s.training!.totalFlops).toBeGreaterThan(before);
    expect(s.training!.tokensB).toBeCloseTo(120, 6);
    const tooMuch = s.training!.tokensB;
    dispatch(s, { type: 'extendTraining', fraction: 0.5 }); // 180B is fine, 4 epochs of 185B is not exceeded
    expect(s.training!.tokensB).toBeGreaterThanOrEqual(tooMuch);
  });
});

describe('ablations', () => {
  it('costs money, finishes after five days, and halves the uncertainty for that run sheet', () => {
    const s = fleet(14, ['transformers', 'scaling_laws']);
    const cfg = cfgWith(s, { precision: 'fp32' });
    const sig = configSignature(cfg);
    const before = estimateTraining(s, 10, 100, DATA, [], cfg);
    const cash = s.finance.cash;
    dispatch(s, { type: 'runAblation', paramsB: 10, tokensB: 100, datasetIds: DATA, config: cfg });
    expect(s.finance.cash).toBeLessThan(cash);
    expect(s.flags[`ablationDone.${sig}`]).toBe(s.day + 5);
    expect(estimateTraining(s, 10, 100, DATA, [], cfg).ablated).toBe(false);
    for (let i = 0; i < 5; i++) tick(s);
    expect(s.flags[`ablation.${sig}`]).toBe(s.day);
    const after = estimateTraining(s, 10, 100, DATA, [], cfg);
    expect(after.ablated).toBe(true);
    expect(after.uncertainty).toBeCloseTo(before.uncertainty / 2, 9);
  });

  it('does not block the main run', () => {
    const s = fleet(15, ['transformers']);
    dispatch(s, { type: 'runAblation', paramsB: 2, tokensB: 40, datasetIds: DATA, config: cfgWith(s, {}) });
    dispatch(s, { type: 'startTraining', name: 'Main', paramsB: 2, tokensB: 40, datasetIds: DATA, techniques: [], config: cfgWith(s, {}) });
    expect(s.training).not.toBeNull();
  });
});

describe('quirks', () => {
  it('are rolled deterministically per seed, from the run only', () => {
    const s = fleet(16, ['transformers']);
    const run = {
      id: 'r', name: 'Q', paramsB: 1, tokensB: 1, datasetIds: DATA, techniques: [], dataQuality: 0.5, totalFlops: 1,
      doneFlops: 0, startedDay: 0, lossHistory: [], predictedLoss: 2, config: cfgWith(s, {}),
    };
    const a = rollQuirks(run as never, makeRng({ rngState: 99 }));
    const b = rollQuirks(run as never, makeRng({ rngState: 99 }));
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(2);
    expect(new Set(a).size).toBe(a.length);
  });

  it('has about thirty quirks with unique ids', () => {
    expect(QUIRKS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(QUIRKS.map((q) => q.id)).size).toBe(QUIRKS.length);
  });

  it('a finished pretrain stores its quirks on the model and they are reproducible', () => {
    const run = (seed: number) => {
      const s = fleet(seed, ['transformers']);
      dispatch(s, { type: 'startTraining', name: 'Quirky', paramsB: 0.5, tokensB: 10, datasetIds: DATA, techniques: [], config: cfgWith(s, {}) });
      playRun(s);
      return s.models[0].quirks;
    };
    expect(run(21)).toEqual(run(21));
  });
});

describe('legacy saves', () => {
  it('a v2 save loads with run sheets, active params, quirks and an inference multiplier', () => {
    const s = createInitialState(31, 'Old');
    dispatch(s, { type: 'startTraining', name: 'Old', paramsB: 0.35, tokensB: 7, datasetIds: ['scrawl_sample'], techniques: [] });
    for (let i = 0; i < 10; i++) tick(s);
    const v2 = JSON.parse(JSON.stringify(s));
    v2.saveVersion = 2;
    for (const m of v2.models) {
      delete m.config;
      delete m.activeParamsB;
      delete m.quirks;
      delete m.inferenceMult;
    }
    if (v2.training) {
      delete v2.training.config;
      delete v2.training.qualityMult;
      delete v2.training.capAdd;
      delete v2.training.pendingIncident;
    }
    const store = new Map<string, string>([[SAVE_KEY, JSON.stringify(v2)]]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    const m = loaded!.models[0];
    expect(m.config).toBeDefined();
    expect(m.activeParamsB).toBe(m.paramsB);
    expect(m.quirks).toEqual([]);
    expect(m.inferenceMult).toBe(1);
    expect(loaded!.saveVersion).toBe(4);
  });

  it('backfillTraining gives an in-flight legacy run a legacy sheet and the v3 fields', () => {
    const s = createInitialState(32, 'Legacy');
    s.training = {
      id: 'r1', name: 'Legacy run', paramsB: 1, tokensB: 10, datasetIds: ['scrawl_sample'], techniques: [], dataQuality: 0.4,
      totalFlops: 1e20, doneFlops: 0, startedDay: 0, lossHistory: [], predictedLoss: 2.5,
    } as GameState['training'];
    backfillTraining(s);
    expect(s.training!.config).toEqual(legacyConfig(s, ['scrawl_sample']));
    expect(s.training!.stallDays).toBe(0);
    expect(s.training!.pendingIncident).toBeNull();
  });
});

describe('bot', () => {
  it('answers incidents and still starts runs with a sheet', () => {
    const s = fleet(41);
    for (let d = 0; d < 400; d++) {
      botDay(s);
      tick(s);
    }
    expect(s.gameOver).toBeNull();
    expect(s.stats.modelsTrained + (s.training ? 1 : 0)).toBeGreaterThan(0);
    expect(optionById('moe')?.group).toBe('arch');
  });
});
