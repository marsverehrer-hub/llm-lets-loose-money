// v16 deeper training (GAME_DESIGN §26.1): recipe presets, post-training stages, data annealing, stage takes
// (breakthroughs and duds), recipe × data synergies, and that sheets without the new fields behave as before.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState, TrainingConfig } from '../src/sim/types';
import { RESEARCH } from '../src/sim/data/research';
import { DATASETS } from '../src/sim/data/datasets';
import { RECIPES, STAGE_TAKE, SYNERGIES } from '../src/sim/data/recipes';
import { configSignature, defaultConfig, optionById, validateConfig } from '../src/sim/data/trainingOptions';
import { planRecipe } from '../src/sim/systems/recipes';
import { estimateTraining } from '../src/sim/systems/training';
import { mixRows, resolveRun, runSynergies } from '../src/sim/systems/trainingMath';

/** A lab in a given year with that year's research, a big fleet and every catalogue dataset. */
function lab(year: number): GameState {
  const s = createInitialState(11, 'Recipe');
  s.day = Math.round(365 * (year - 2017));
  s.research.completed = RESEARCH.filter((r) => r.minYear <= year).map((r) => r.id);
  s.compute.rented = { p100: 4000 };
  s.finance.cash = 1e13;
  s.data.owned = DATASETS.map((d) => d.id);
  return s;
}

function finish(s: GameState, max = 3000): void {
  for (let i = 0; i < max && s.training; i++) {
    const run = s.training;
    if (run.pendingIncident && run.pendingIncident.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    s.events.pending = null;
    s.pendingMoment = null;
    tick(s);
  }
}

describe('recipe presets', () => {
  it('every recipe gives a valid, startable sheet in every era, sized to its time budget', () => {
    for (const y of [2017.5, 2021, 2025, 2029]) {
      const s = lab(y);
      for (const r of RECIPES) {
        const plan = planRecipe(s, r.id, `${r.id}-${y}`);
        expect(plan, `${r.id} ${y}`).not.toBeNull();
        expect(validateConfig(s, plan!.action.config!)).toBeNull();
        expect(plan!.days).toBeLessThanOrEqual(r.days * 1.15 + 3);
        const t = structuredClone(s);
        dispatch(t, plan!.action);
        expect(t.training?.name).toBe(`${r.id}-${y}`);
      }
    }
  });

  it('recipes have different shapes: reasoning beats chatty on math, chatty beats reasoning on chat', () => {
    const s = lab(2026);
    const est = (id: (typeof RECIPES)[number]['id']) => {
      const a = planRecipe(s, id, id, 21)!.action;
      return estimateTraining(s, a.paramsB, a.tokensB, a.datasetIds, a.techniques, a.config);
    };
    const reasoning = est('reasoning');
    const chatty = est('chatty');
    expect(reasoning.predictedCaps.math).toBeGreaterThan(chatty.predictedCaps.math);
    expect(chatty.predictedCaps.chat).toBeGreaterThan(reasoning.predictedCaps.chat);
  });

  it('cheap and fast is quicker and smaller than balanced', () => {
    const s = lab(2024);
    const cheap = planRecipe(s, 'cheap', 'c')!;
    const bal = planRecipe(s, 'balanced', 'b')!;
    expect(cheap.days).toBeLessThan(bal.days);
    expect(cheap.action.paramsB).toBeLessThan(bal.action.paramsB);
  });

  it('no data, no plan', () => {
    const s = lab(2024);
    s.data.owned = [];
    expect(planRecipe(s, 'balanced', 'x')).toBeNull();
  });
});

describe('post-training stages and annealing', () => {
  it('stages are gated by research and run once each', () => {
    const s = lab(2019);
    expect(validateConfig(s, { ...defaultConfig(s), post: ['rlvr_pass'] })).toMatch(/locked/);
    const late = lab(2026);
    expect(validateConfig(late, { ...defaultConfig(late), post: ['rlvr_pass'] })).toBeNull();
    expect(validateConfig(late, { ...defaultConfig(late), post: ['sft', 'sft'] })).toMatch(/once/);
    expect(validateConfig(late, { ...defaultConfig(late), post: ['bf16'] })).toMatch(/Unknown/);
    expect(validateConfig(late, { ...defaultConfig(late), anneal: 'sft' })).toMatch(/Unknown/);
  });

  it('a stage costs compute and reshapes the model; the overall moves only a little', () => {
    const s = lab(2026);
    const ids = s.data.owned;
    const base = defaultConfig(s);
    const b = estimateTraining(s, 100, 2000, ids, [], base);
    const rl = estimateTraining(s, 100, 2000, ids, [], { ...base, post: ['rlvr_pass'] });
    expect(rl.totalFlops).toBeGreaterThan(b.totalFlops * 1.2);
    expect(rl.predictedCaps.math).toBeGreaterThan(b.predictedCaps.math + 5);
    expect(rl.predictedCaps.chat).toBeLessThan(b.predictedCaps.chat);
    // Expected value stays near neutral on overall: the stage buys a shape, not a free upgrade.
    for (const opt of ['sft', 'rlhf_ppo', 'dpo_pass', 'constitution', 'reasoning_rl', 'rlvr_pass', 'agentic_rl', 'anneal_quality', 'anneal_code_math', 'anneal_long']) {
      const cfg: TrainingConfig = optionById(opt)!.group === 'post' ? { ...base, post: [opt] } : { ...base, anneal: opt };
      const d = estimateTraining(s, 100, 2000, ids, [], cfg).overall - b.overall;
      expect(Math.abs(d), opt).toBeLessThan(1.5);
    }
  });

  it('sheets without stages keep their old ablation key and draw no stage takes (bots unchanged)', () => {
    const s = lab(2024);
    const cfg = defaultConfig(s);
    expect(configSignature(cfg)).not.toMatch(/post|anneal/);
    expect(configSignature({ ...cfg, post: ['sft'] })).toMatch(/post:sft/);
    dispatch(s, { type: 'startTraining', name: 'Plain', paramsB: 1, tokensB: 20, datasetIds: s.data.owned, techniques: [], config: cfg });
    expect(s.training!.hidden!.postTake).toBeUndefined();
  });

  it('stage takes average about one, with breakthroughs and duds in the tails', () => {
    const s = lab(2026);
    const cfg: TrainingConfig = { ...defaultConfig(s), post: ['sft', 'rlhf_ppo', 'reasoning_rl'] };
    const takes: number[] = [];
    for (let seed = 0; seed < 120; seed++) {
      const t = structuredClone(s);
      t.rngState = seed * 7919 + 1;
      dispatch(t, { type: 'startTraining', name: 'Roll', paramsB: 1, tokensB: 20, datasetIds: t.data.owned, techniques: [], config: cfg });
      takes.push(...Object.values(t.training!.hidden!.postTake!));
    }
    const mean = takes.reduce((a, b) => a + b, 0) / takes.length;
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(1.15);
    expect(takes.some((x) => x === STAGE_TAKE.BREAKTHROUGH)).toBe(true);
    expect(takes.some((x) => x === STAGE_TAKE.DUD)).toBe(true);
  });
});

describe('recipe × data synergies', () => {
  it('the true world sees every synergy; the forecast only the ones the lab has found', () => {
    const s = lab(2026);
    const cfg: TrainingConfig = { ...defaultConfig(s), schedule: 'wsd', anneal: 'anneal_quality' };
    const rows = mixRows(s, s.data.owned, cfg, 'true');
    expect(runSynergies(s, cfg, rows, 'true').map((x) => x.id)).toContain('wsd_anneal');
    expect(runSynergies(s, cfg, rows, 'belief')).toEqual([]);
    const truth = resolveRun(s, 10, 200, s.data.owned, [], cfg, 'true');
    const belief = resolveRun(s, 10, 200, s.data.owned, [], cfg, 'belief');
    expect((truth.capAdd.reasoning ?? 0) - (belief.capAdd.reasoning ?? 0)).toBeCloseTo(2);
  });

  it('a finished run explains itself and records what it found; the next forecast knows', () => {
    const s = lab(2026);
    s.compute.rented = { p100: 20000 };
    const cfg: TrainingConfig = { ...defaultConfig(s), schedule: 'wsd', anneal: 'anneal_quality', post: ['sft'] };
    dispatch(s, { type: 'startTraining', name: 'Notebook', paramsB: 0.5, tokensB: 10, datasetIds: s.data.owned, techniques: [], config: cfg });
    expect(s.training).not.toBeNull();
    finish(s);
    const notes = s.pendingReveal?.notes ?? [];
    expect(notes.some((n) => n.includes('Free lunch decay'))).toBe(true);
    expect(s.lab!.synergies!['wsd_anneal']).toBeDefined();
    const rows = mixRows(s, s.data.owned, cfg, 'belief');
    expect(runSynergies(s, cfg, rows, 'belief').map((x) => x.id)).toContain('wsd_anneal');
  });

  it('good and bad synergies roughly balance', () => {
    const sum = (good: boolean) =>
      SYNERGIES.filter((x) => x.good === good).reduce((t, x) => t + Object.values(x.capAdd).reduce((a, v) => a + Math.abs(v ?? 0), 0), 0);
    const ratio = sum(true) / sum(false);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});
