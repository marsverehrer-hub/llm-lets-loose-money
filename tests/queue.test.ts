// v7 QoL (GAME_DESIGN §18.4): research queue, training queue, product auto-upgrade.
import { describe, it, expect } from 'vitest';
import { RESEARCH } from '../src/sim/data/research';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { queueTick, researchPath } from '../src/sim/systems/queue';
import { researchCost } from '../src/sim/systems/research';
import type { GameState, Model, Product } from '../src/sim/types';

const DATA = ['scrawl_sample', 'common_scrawl_full'];
const BY_ID = new Map(RESEARCH.map((n) => [n.id, n] as const));

function lab(seed: number, research: string[] = []): GameState {
  const s = createInitialState(seed, 'Queue');
  s.research.completed.push(...research);
  s.finance.cash = 1e13;
  return s;
}

/** A lab with a rented fleet and owned data, so a training run can start. */
function fleet(seed: number, research: string[] = []): GameState {
  const s = lab(seed, research);
  s.compute.rented = { p100: 2000 };
  s.data.owned = [...DATA];
  return s;
}

/** Clears the things that block the sim (events, incidents, reveals, moments) so ticks advance. */
function clearBlockers(s: GameState): void {
  if (s.events.pending && s.events.pending.result === undefined) {
    dispatch(s, { type: 'resolveEvent', choice: 0 });
    dispatch(s, { type: 'clearEventResult' });
  }
  const pending = s.training?.pendingIncident;
  if (pending && pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
  if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
  if (s.pendingReveal) dispatch(s, { type: 'dismissReveal' });
  if (s.pendingMoment) dispatch(s, { type: 'dismissMoment' });
}

function advance(s: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    clearBlockers(s);
    tick(s);
  }
}

/** Finish the research node that is current by setting its progress to its cost, then tick once. */
function finishCurrent(s: GameState): void {
  const id = s.research.current;
  if (!id) throw new Error('nothing is researching');
  s.research.progress = researchCost(BY_ID.get(id)!);
  tick(s);
}

function trainingPayload(s: GameState, name: string) {
  return {
    type: 'startTraining' as const,
    name,
    paramsB: 5,
    tokensB: 100,
    datasetIds: DATA,
    techniques: [],
    config: defaultConfig(s),
  };
}

function notices(s: GameState, pattern: RegExp): string[] {
  return (s.noticeLog ?? []).map((n) => n.text).filter((t) => pattern.test(t));
}

describe('research queue', () => {
  it('researchPath lists prerequisites before the node, each once, and ends with the node', () => {
    const s = lab(1);
    const deep = RESEARCH.reduce((a, b) => (b.tier > a.tier ? b : a));
    const path = researchPath(s, deep.id);
    expect(path[path.length - 1]).toBe(deep.id);
    expect(new Set(path).size).toBe(path.length);
    expect(path.length).toBeGreaterThanOrEqual(deep.tier + 1);
    const seen = new Set<string>();
    for (const id of path) {
      for (const p of BY_ID.get(id)!.prereqs) expect(seen.has(p) || isDone(s, p), `${p} before ${id}`).toBe(true);
      seen.add(id);
    }
  });

  it('researchPath skips nodes already researched or queued', () => {
    const s = lab(2, ['transformers']);
    expect(researchPath(s, 'transformers')).toEqual([]);
    expect(researchPath(s, 'rmsnorm')).toEqual(['rmsnorm']);
    dispatch(s, { type: 'queueResearch', nodeId: 'rmsnorm' });
    expect(researchPath(s, 'rmsnorm')).toEqual([]);
  });

  it('queueResearch appends the missing prerequisite and says how many were added', () => {
    const s = lab(3);
    dispatch(s, { type: 'queueResearch', nodeId: 'rmsnorm' });
    expect(s.research.queue).toEqual(['transformers', 'rmsnorm']);
    expect(notices(s, /Queued RMSNorm \(\+1 prerequisite\)/).length).toBe(1);
  });

  it('a queued node starts when the slot frees, and completed nodes leave the queue', () => {
    const s = lab(4);
    dispatch(s, { type: 'queueResearch', nodeId: 'rmsnorm' });
    tick(s);
    expect(s.research.current).toBe('transformers');
    expect(s.research.queue).toEqual(['rmsnorm']);
    finishCurrent(s);
    expect(isDone(s, 'transformers')).toBe(true);
    // RMSNorm opens in 2019, so it waits for the year; the queue holds it until then.
    expect(s.research.current).toBeNull();
    expect(s.research.queue).toEqual(['rmsnorm']);
    for (let i = 0; i < 800 && !isDone(s, 'rmsnorm'); i++) {
      clearBlockers(s);
      if (s.research.current === 'rmsnorm') s.research.progress = researchCost(BY_ID.get('rmsnorm')!);
      tick(s);
    }
    expect(isDone(s, 'rmsnorm')).toBe(true);
    expect(s.research.queue).toEqual([]);
  });

  it('reorder is rejected when a node would move before its prerequisite', () => {
    const s = lab(5);
    dispatch(s, { type: 'queueResearch', nodeId: 'rmsnorm' });
    dispatch(s, { type: 'reorderResearch', nodeId: 'transformers', toIndex: 1 });
    expect(s.research.queue).toEqual(['transformers', 'rmsnorm']);
    dispatch(s, { type: 'reorderResearch', nodeId: 'rmsnorm', toIndex: 0 });
    expect(s.research.queue).toEqual(['transformers', 'rmsnorm']);
    expect(notices(s, /needs .* first/).length).toBeGreaterThanOrEqual(2);
  });

  it('reorder moves independent nodes', () => {
    const s = lab(6);
    const [a, b] = RESEARCH.filter((n) => n.prereqs.length === 0).map((n) => n.id);
    dispatch(s, { type: 'queueResearch', nodeId: a });
    dispatch(s, { type: 'queueResearch', nodeId: b });
    dispatch(s, { type: 'reorderResearch', nodeId: b, toIndex: 0 });
    expect(s.research.queue).toEqual([b, a]);
  });

  it('unqueue also removes queued nodes that needed the removed one', () => {
    const s = lab(7);
    dispatch(s, { type: 'queueResearch', nodeId: 'rmsnorm' });
    dispatch(s, { type: 'unqueueResearch', nodeId: 'transformers' });
    expect(s.research.queue).toEqual([]);
    expect(notices(s, /along with 1 that needed it/).length).toBe(1);
  });

  it('a stopped queue waits until resumed', () => {
    const s = lab(8);
    dispatch(s, { type: 'queueResearch', nodeId: 'transformers' });
    dispatch(s, { type: 'setResearchQueuePaused', paused: true });
    tick(s);
    expect(s.research.current).toBeNull();
    dispatch(s, { type: 'setResearchQueuePaused', paused: false });
    tick(s);
    expect(s.research.current).toBe('transformers');
  });
});

describe('training queue', () => {
  it('starts the queued run as soon as the slot frees', () => {
    const s = fleet(11, ['transformers']);
    dispatch(s, trainingPayload(s, 'Alpha'));
    expect(s.training?.name).toBe('Alpha');
    dispatch(s, { type: 'queueTraining', action: trainingPayload(s, 'Beta') });
    expect(s.trainingQueue?.length).toBe(1);
    tick(s);
    expect(s.training?.name).toBe('Alpha');
    expect(s.trainingQueue?.length).toBe(1);
    dispatch(s, { type: 'cancelTraining' });
    tick(s);
    expect(s.training?.name).toBe('Beta');
    expect(s.trainingQueue).toEqual([]);
  });

  it('waits with one notice while broke, then starts once cash is back', () => {
    const s = fleet(12, ['transformers']);
    dispatch(s, { type: 'queueTraining', action: trainingPayload(s, 'Gamma') });
    s.finance.cash = 0;
    for (let i = 0; i < 3; i++) {
      clearBlockers(s);
      tick(s);
    }
    expect(s.training).toBeNull();
    expect(s.trainingQueue?.length).toBe(1);
    expect(notices(s, /Queued run Gamma is waiting/).length).toBe(1);
    s.finance.cash = 1e13;
    tick(s);
    expect(s.training?.name).toBe('Gamma');
    expect(s.trainingQueue).toEqual([]);
  });

  it('a refused start stays queued, and the refusal is reported once instead of every day', () => {
    const s = fleet(13, ['transformers']);
    const bad = { ...trainingPayload(s, 'Delta'), datasetIds: ['no_such_dataset'] };
    dispatch(s, { type: 'queueTraining', action: bad });
    for (let i = 0; i < 4; i++) {
      clearBlockers(s);
      tick(s);
    }
    expect(s.training).toBeNull();
    expect(s.trainingQueue?.length).toBe(1);
    expect(notices(s, /Queued run Delta is waiting/).length).toBe(1);
    // The handler's own refusal is popped; only the single queue notice (which quotes the reason) remains.
    expect(notices(s, /^You don't own/).length).toBe(0);
    expect(notices(s, /you don't own/).length).toBe(1);
  });

  it('unqueueTraining removes the run', () => {
    const s = fleet(14);
    dispatch(s, { type: 'queueTraining', action: trainingPayload(s, 'Epsilon') });
    const id = s.trainingQueue![0].id;
    dispatch(s, { type: 'unqueueTraining', id });
    expect(s.trainingQueue).toEqual([]);
  });
});

describe('product auto-upgrade', () => {
  function fakeModel(id: string, overall: number, patch: Partial<Model> = {}): Model {
    return {
      id,
      name: id,
      paramsB: 10,
      tokensB: 100,
      datasetIds: [],
      techniques: [],
      finalLoss: 2,
      scores: {},
      overall,
      elo: 800 + overall * 8,
      trainedDay: 0,
      releasedDay: 5,
      deprecated: false,
      ...patch,
    } as unknown as Model;
  }

  function withProduct(models: Model[], current: string, on = true): { s: GameState; p: Product } {
    const s = lab(20);
    s.models = models;
    const p: Product = {
      id: 'prod1',
      kind: 'api',
      name: 'Test API',
      modelId: current,
      price: 1,
      users: 0,
      launchedDay: 0,
      satisfaction: 70,
      servedFraction: 1,
      mtokPerDay: 0,
      revenuePerDay: 0,
      active: true,
      autoUpgrade: on,
    };
    s.products = [p];
    return { s, p };
  }

  const run = (s: GameState) => queueTick(s, makeRng(s));

  it('switches to a released model that is clearly better', () => {
    const { s, p } = withProduct([fakeModel('old', 40), fakeModel('new', 41.5)], 'old');
    run(s);
    expect(p.modelId).toBe('new');
    expect(notices(s, /Test API now runs new/).length).toBe(1);
  });

  it('does not switch for a gain of one point or less', () => {
    const { s, p } = withProduct([fakeModel('old', 40), fakeModel('new', 41)], 'old');
    run(s);
    expect(p.modelId).toBe('old');
  });

  it('ignores unreleased, retired and capped preview models', () => {
    const { s, p } = withProduct(
      [
        fakeModel('old', 40),
        fakeModel('secret', 70, { releasedDay: null }),
        fakeModel('retired', 70, { deprecated: true }),
        fakeModel('preview', 70, { releaseMode: 'preview' }),
      ],
      'old',
    );
    run(s);
    expect(p.modelId).toBe('old');
  });

  it('does nothing when auto-upgrade is off', () => {
    const { s, p } = withProduct([fakeModel('old', 40), fakeModel('new', 60)], 'old', false);
    run(s);
    expect(p.modelId).toBe('old');
  });

  it('moves a product off a retired model even without a margin', () => {
    const { s, p } = withProduct([fakeModel('old', 50, { deprecated: true }), fakeModel('new', 30)], 'old');
    run(s);
    expect(p.modelId).toBe('new');
  });

  it('setProductAutoUpgrade toggles the flag on a live product', () => {
    const { s, p } = withProduct([fakeModel('old', 40)], 'old', false);
    dispatch(s, { type: 'setProductAutoUpgrade', productId: p.id, on: true });
    expect(p.autoUpgrade).toBe(true);
  });
});

function isDone(s: GameState, id: string): boolean {
  return s.research.completed.includes(id);
}
