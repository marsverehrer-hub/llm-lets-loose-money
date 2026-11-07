// v19 C4: distil families, continued pretraining (version names, cheaper runs, lineage) and the release licence gate.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { Capabilities, GameState, Model } from '../src/sim/types';
import { CAP_IDS } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { nextVersionName } from '../src/sim/systems/derive';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { datasetTokensOf } from '../src/sim/systems/training';
import { resolveRun } from '../src/sim/systems/trainingMath';

/** A flat-profile base model, the way tests/derive.test.ts builds one. */
function addModel(s: GameState, o: { name: string; overall: number; paramsB?: number; tokensB?: number; datasetIds?: string[]; released?: boolean; origin?: Model['origin'] }): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, o.overall])) as Capabilities;
  caps.vision = 0;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: o.name,
    paramsB: o.paramsB ?? 70,
    tokensB: o.tokensB ?? 2000,
    datasetIds: o.datasetIds ?? [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: o.overall, coding: o.overall, chat: o.overall, safety: o.overall },
    overall: o.overall,
    elo: 800 + 8 * o.overall,
    trainedDay: s.day,
    releasedDay: o.released === false ? null : s.day,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: 128,
    modalities: ['text'],
    contaminated: false,
    config: defaultConfig(s),
    activeParamsB: o.paramsB ?? 70,
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
    ...(o.origin ? { origin: o.origin } : {}),
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

/** A lab with a big rented fleet (runs take days, not years) and plenty of cash. */
function fleet(seed = 21): GameState {
  const s = createInitialState(seed, 'Family Test Labs');
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  return s;
}

/** Play until an eval-day reveal appears, answering incidents and events with the first choice. */
function runToReveal(s: GameState, maxDays = 400): void {
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
}

describe('next version names', () => {
  it('bumps a trailing version number and appends v1.5 when there is none', () => {
    expect(nextVersionName('Pomelo 2')).toBe('Pomelo 2.5');
    expect(nextVersionName('Pomelo 2.5')).toBe('Pomelo 3');
    expect(nextVersionName('Pomelo v1.5')).toBe('Pomelo v2');
    expect(nextVersionName('Pomelo')).toBe('Pomelo v1.5');
  });
});

describe('distil family', () => {
  it('queues nano, mini and pro at 4%, 12% and 35% of the teacher, one after another', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    dispatch(s, { type: 'distilFamily', teacherId: teacher.id });
    expect(s.training?.name).toBe('Teacher nano');
    expect(s.training?.paramsB).toBeCloseTo(2.8, 6);
    expect(s.training?.distill?.teacherId).toBe(teacher.id);

    runToReveal(s);
    expect(s.pendingReveal?.kind).toBe('distill');
    // The next member starts when the first one finishes, before the reveal is dismissed.
    expect(s.training?.name).toBe('Teacher mini');
    expect(s.training?.paramsB).toBeCloseTo(8.4, 6);

    dispatch(s, { type: 'dismissReveal' });
    runToReveal(s);
    expect(s.training?.name).toBe('Teacher pro');
    expect(s.training?.paramsB).toBeCloseTo(24.5, 6);

    dispatch(s, { type: 'dismissReveal' });
    runToReveal(s);
    expect(s.training).toBeNull();
    expect(s.models.filter((m) => m.derivedFrom?.kind === 'distill').map((m) => m.name)).toEqual([
      'Teacher nano',
      'Teacher mini',
      'Teacher pro',
    ]);
  });

  it('refuses a second family while one is distilling, and for an unreleased teacher', () => {
    const s = fleet();
    const teacher = addModel(s, { name: 'Teacher', overall: 60, paramsB: 70 });
    const hidden = addModel(s, { name: 'Hidden', overall: 60, paramsB: 70, released: false });
    dispatch(s, { type: 'distilFamily', teacherId: hidden.id });
    expect(s.training).toBeNull();
    dispatch(s, { type: 'distilFamily', teacherId: teacher.id });
    const first = s.training;
    dispatch(s, { type: 'distilFamily', teacherId: teacher.id });
    expect(s.training).toBe(first);
  });
});

describe('continued pretraining', () => {
  it('costs fewer FLOPs than a fresh run of the same total tokens, and finishes as the next version', () => {
    const s = fleet();
    const datasetIds = [s.data.owned[0]];
    const unique = datasetTokensOf(s, datasetIds);
    const baseTokens = Math.min(2, unique * 0.5);
    const extra = Math.min(1, unique * 0.5);
    const base = addModel(s, { name: 'Pomelo 2', overall: 50, paramsB: 7, tokensB: baseTokens, datasetIds });

    const cfg = defaultConfig(s);
    const fresh = resolveRun(s, base.paramsB, baseTokens + extra, datasetIds, [], cfg, 'true');

    dispatch(s, {
      type: 'startTraining',
      name: nextVersionName(base.name),
      paramsB: base.paramsB,
      tokensB: extra,
      datasetIds,
      techniques: [],
      continueFrom: base.id,
    });
    expect(s.training).not.toBeNull();
    expect(s.training!.parentId).toBe(base.id);
    expect(s.training!.paramsB).toBe(base.paramsB);
    expect(s.training!.tokensB).toBeCloseTo(baseTokens + extra, 9);
    expect(s.training!.totalFlops).toBeLessThan(fresh.totalFlops);
    // The loss still sees the base's tokens, so it matches a fresh run on the same total.
    expect(s.training!.predictedLoss).toBeCloseTo(fresh.loss, 9);
    expect(s.training!.totalFlops).toBeCloseTo(6 * fresh.activeParamsB * 1e9 * extra * 1e9 * fresh.flopsMult, -3);

    runToReveal(s);
    const model = s.models.find((m) => m.id === s.pendingReveal?.modelId)!;
    expect(model.continuedFrom).toBe(base.id);
    expect(model.name).toBe('Pomelo 2.5');
    expect(model.paramsB).toBe(base.paramsB);
  });

  it('refuses a continuation from a hub download', () => {
    const s = fleet();
    const datasetIds = [s.data.owned[0]];
    const hub = addModel(s, { name: 'Hub 1', overall: 50, paramsB: 7, tokensB: 1, datasetIds, origin: { labId: 'x', modelId: 'y', license: 'permissive' } });
    dispatch(s, { type: 'startTraining', name: 'Nope', paramsB: 7, tokensB: 0.5, datasetIds, techniques: [], continueFrom: hub.id });
    expect(s.training).toBeNull();
  });
});

describe('release licence gate', () => {
  it('a research-licence model can not be released', () => {
    const s = fleet();
    const m = addModel(s, {
      name: 'Research Weights',
      overall: 50,
      released: false,
      origin: { labId: 'x', modelId: 'y', license: 'research' },
    });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full' });
    expect(m.releasedDay).toBeNull();
  });

  it('noncommercial weights may only be released as open weights', () => {
    const s = fleet();
    const m = addModel(s, {
      name: 'Noncommercial Weights',
      overall: 50,
      released: false,
      origin: { labId: 'x', modelId: 'y', license: 'noncommercial' },
    });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full' });
    expect(m.releasedDay).toBeNull();
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'open' });
    expect(m.releasedDay).not.toBeNull();
  });
});
