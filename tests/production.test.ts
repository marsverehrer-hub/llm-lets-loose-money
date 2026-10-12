import { BALANCE } from '../src/sim/balance';
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import { chinchillaLoss, estimateTraining, lossToQuality } from '../src/sim/systems/training';
import { runOverheadDays } from '../src/sim/systems/trainingMath';
import { computeCapacity, inferenceCapacityMtok } from '../src/sim/systems/compute';
import { isResearched } from '../src/sim/systems/research';
import { headcount, officeCapacity } from '../src/sim/systems/staff';
import { DATASETS } from '../src/sim/data/datasets';
import { RESEARCH } from '../src/sim/data/research';
import { GPUS, DATACENTER_TIERS } from '../src/sim/data/gpus';
import { OFFICE_TIERS, ROLES, STAR_TEMPLATES } from '../src/sim/data/roles';

const MUST_HAVE = [
  'transformers', 'scaling_laws', 'instruction_tuning', 'rlhf', 'code_models', 'long_context', 'moe', 'multimodal',
  'chain_of_thought', 'reasoning_models', 'enterprise_ready', 'constitutional_ai', 'distillation', 'flash_attention',
  'synthetic_data', 'agents', 'nuclear_power', 'interpretability', 'agi',
];

function days(s: GameState, n: number) {
  for (let i = 0; i < n; i++) tick(s);
}

describe('data tables', () => {
  it('has the must-have research nodes, all with valid prereqs', () => {
    const ids = new Set(RESEARCH.map((r) => r.id));
    for (const id of MUST_HAVE) expect(ids.has(id), id).toBe(true);
    expect(RESEARCH.length).toBeGreaterThanOrEqual(28);
    for (const node of RESEARCH) {
      for (const p of node.prereqs) expect(ids.has(p), `${node.id} -> ${p}`).toBe(true);
      expect(node.tier).toBeGreaterThanOrEqual(0);
      expect(node.tier).toBeLessThanOrEqual(7);
    }
  });

  it('has at least 14 datasets and one free 2017 dataset with no research gate', () => {
    expect(DATASETS.length).toBeGreaterThanOrEqual(14);
    const free = DATASETS.filter((d) => d.cost === 0 && d.unlockYear <= 2017 && !d.requiresResearch);
    expect(free.length).toBeGreaterThanOrEqual(1);
  });

  it('has nine GPU generations with the starter GPU first, and four datacenter tiers', () => {
    expect(GPUS.length).toBe(9);
    expect(GPUS[0].unlockYear).toBe(2017);
    expect(DATACENTER_TIERS.length).toBe(4);
    expect(ROLES.map((r) => r.id).sort()).toEqual(['engineer', 'marketing', 'researcher', 'safety', 'sales']);
    expect(OFFICE_TIERS[0].name).toBe("Mom's Garage");
    expect(STAR_TEMPLATES.length).toBeGreaterThanOrEqual(12);
  });
});

describe('scaling laws', () => {
  it('chinchillaLoss decreases with more params and more tokens', () => {
    expect(chinchillaLoss(1, 10, 0.5)).toBeGreaterThan(chinchillaLoss(10, 10, 0.5));
    expect(chinchillaLoss(1, 10, 0.5)).toBeGreaterThan(chinchillaLoss(1, 100, 0.5));
    expect(chinchillaLoss(1, 10, 0.9)).toBeLessThan(chinchillaLoss(1, 10, 0.1));
  });

  it('lossToQuality maps the worst and best loss to 0 and 100', () => {
    expect(lossToQuality(BALANCE.LOSS_WORST)).toBeCloseTo(0);
    expect(lossToQuality(BALANCE.LOSS_BEST)).toBeCloseTo(100);
    expect(lossToQuality(5)).toBe(0);
  });

  it('a 350M / 7B run on the starter fleet takes about two days of compute, plus the fixed run overhead', () => {
    const s = createInitialState(42);
    const est = estimateTraining(s, 0.35, 7, ['scrawl_sample'], []);
    const computeDays = est.days - runOverheadDays(0.35);
    expect(computeDays).toBeGreaterThan(1);
    expect(computeDays).toBeLessThan(3);
  });
});

describe('training', () => {
  it('a starter run completes and produces an unreleased model with a plausible score', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'startTraining', name: 'Baby Llama', paramsB: 0.35, tokensB: 7, datasetIds: ['scrawl_sample'], techniques: [] });
    expect(s.training).not.toBeNull();
    days(s, 10);
    expect(s.training).toBeNull();
    expect(s.models.length).toBe(1);
    const m = s.models[0];
    expect(m.releasedDay).toBeNull();
    expect(m.overall).toBeGreaterThan(2); // seed 42 rolls an unlucky LR optimum (0.84 for lstm); a naive lr 0.5 costs ~10% here
    expect(m.overall).toBeLessThan(40);
    // Elo = eloFor(overall) + hidden arena vibes (fog), so only check it sits near the overall-implied value.
    expect(Math.abs(m.elo - (800 + m.overall * 8))).toBeLessThan(100);
    expect(s.stats.modelsTrained).toBe(1);
  });

  it('rejects a second run while one is training, and rejects too many epochs', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'startTraining', name: 'A', paramsB: 0.35, tokensB: 5, datasetIds: ['scrawl_sample'], techniques: [] });
    const first = s.training;
    dispatch(s, { type: 'startTraining', name: 'B', paramsB: 0.35, tokensB: 5, datasetIds: ['scrawl_sample'], techniques: [] });
    expect(s.training).toBe(first);
    s.training = null;
    dispatch(s, { type: 'startTraining', name: 'C', paramsB: 0.35, tokensB: 100, datasetIds: ['scrawl_sample'], techniques: [] });
    expect(s.training).toBeNull();
  });

  it('releasing a model sets releasedDay and updates stats', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'startTraining', name: 'Baby Llama', paramsB: 0.35, tokensB: 7, datasetIds: ['scrawl_sample'], techniques: [] });
    days(s, 10);
    const id = s.models[0].id;
    dispatch(s, { type: 'releaseModel', modelId: id });
    expect(s.models[0].releasedDay).toBe(s.day);
    expect(s.stats.modelsReleased).toBe(1);
    expect(s.stats.bestElo).toBeCloseTo(s.models[0].elo, 6);
  });

  it('cancelling discards progress', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'startTraining', name: 'Big', paramsB: 1.5, tokensB: 30, datasetIds: ['scrawl_sample'], techniques: [] });
    expect(s.training).toBeNull(); // only 5B unique, 30B needs 7.5B: rejected
    dispatch(s, { type: 'buyDataset', datasetId: 'wikipediaish' });
    dispatch(s, { type: 'startTraining', name: 'Big', paramsB: 1.5, tokensB: 30, datasetIds: ['scrawl_sample', 'wikipediaish'], techniques: [] });
    expect(s.training).not.toBeNull();
    days(s, 3);
    dispatch(s, { type: 'cancelTraining' });
    expect(s.training).toBeNull();
    expect(s.models.length).toBe(0);
  });
});

describe('research', () => {
  it('transformers completes in roughly two to three weeks', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'setResearch', nodeId: 'transformers' });
    expect(s.research.current).toBe('transformers');
    let n = 0;
    while (!isResearched(s, 'transformers') && n < 30) {
      tick(s);
      n++;
    }
    expect(isResearched(s, 'transformers')).toBe(true);
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(18);
  });

  it('refuses a node whose prerequisites are missing', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'setResearch', nodeId: 'scaling_laws' });
    expect(s.research.current).toBeNull();
  });
});

describe('staff', () => {
  it('hiring charges recruiting fees and respects office capacity', () => {
    const s = createInitialState(42);
    expect(headcount(s)).toBe(3);
    expect(officeCapacity(s)).toBe(6);
    const cash = s.finance.cash;
    dispatch(s, { type: 'hire', role: 'researcher', count: 2 });
    expect(s.staff.roles.researcher.count).toBe(4);
    expect(s.finance.cash).toBeCloseTo(cash - 2 * 15_000, 2);
    expect(headcount(s)).toBe(5);
    // one seat left in Mom's Garage (capacity 6): two sales reps must be refused
    const beforeRefused = s.finance.cash;
    dispatch(s, { type: 'hire', role: 'sales', count: 2 });
    expect(s.staff.roles.sales.count).toBe(0);
    expect(s.finance.cash).toBe(beforeRefused);
    dispatch(s, { type: 'hire', role: 'sales', count: 1 });
    expect(s.staff.roles.sales.count).toBe(1);
    expect(headcount(s)).toBe(6);
    // office is now full: a further engineer is refused (the starting engineer is still the only one)
    const beforeFull = s.finance.cash;
    dispatch(s, { type: 'hire', role: 'engineer', count: 1 });
    expect(s.staff.roles.engineer.count).toBe(1);
    expect(s.finance.cash).toBe(beforeFull);
  });

  it('payroll and office rent are charged daily', () => {
    const s = createInitialState(42);
    tick(s);
    expect(s.finance.today.expenses.payroll).toBeGreaterThan(0);
    expect(s.finance.today.expenses.office).toBe(30);
  });
});

describe('compute', () => {
  it('renting GPUs raises total PFLOPS', () => {
    const s = createInitialState(42);
    const before = computeCapacity(s).total;
    expect(before).toBeCloseTo(8 * 0.012, 6);
    dispatch(s, { type: 'rentGpus', gpuId: 'p100', count: 8 });
    tick(s);
    expect(s.compute.totalPflops).toBeCloseTo(16 * 0.012, 6);
    expect(s.compute.rented.p100).toBe(16);
    expect(s.finance.today.expenses.compute).toBeCloseTo(16 * 30, 2);
  });

  it('a datacenter counts down, then accepts GPUs', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'buildDatacenter', tierId: 'closet', name: 'Closet One' });
    expect(s.compute.datacenters.length).toBe(1);
    const dcId = s.compute.datacenters[0].id;
    dispatch(s, { type: 'buyGpus', datacenterId: dcId, gpuId: 'p100', count: 4 });
    expect(s.compute.datacenters[0].gpus.p100 ?? 0).toBe(0); // still under construction
    days(s, 10);
    expect(s.compute.datacenters[0].buildDaysLeft).toBe(0);
    dispatch(s, { type: 'buyGpus', datacenterId: dcId, gpuId: 'p100', count: 4 });
    expect(s.compute.datacenters[0].gpus.p100).toBe(4);
    tick(s);
    expect(s.compute.totalPflops).toBeCloseTo(8 * 0.012 + 4 * 0.012, 6);
  });

  it('inference capacity scales inversely with model size', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'setTrainingShare', share: 0.5 });
    const small = inferenceCapacityMtok(s, 1);
    const big = inferenceCapacityMtok(s, 10);
    expect(small).toBeGreaterThan(0);
    expect(small / big).toBeCloseTo(10, 6);
  });
});

describe('state', () => {
  it('starter dataset is owned and the starting fleet is 8 Pascal GPUs', () => {
    const s = createInitialState(42);
    expect(s.data.owned).toContain('scrawl_sample');
    expect(s.compute.rented.p100).toBe(8);
  });

  it('isResearched and staff counts start where the design says', () => {
    const s = createInitialState(42);
    expect(isResearched(s, 'transformers')).toBe(false);
    expect(s.staff.roles.researcher.count).toBe(2);
    expect(s.staff.roles.engineer.count).toBe(1);
  });
});
