// v18 mid-run decision calls (GAME_DESIGN 31): planned at launch, raised at a progress point, resolved like incidents.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import type { GameState, TrainingRun } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { RUN_CALLS } from '../src/sim/data/runCalls';
import { planRunCalls } from '../src/sim/systems/training';

const DATA = ['scrawl_sample', 'common_scrawl_full'];

/** A lab with a big rented fleet and enough cash and data for a mid-sized run. */
function fleet(seed: number, research: string[] = []): GameState {
  const s = createInitialState(seed, 'Calls');
  s.research.completed.push(...research);
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  s.data.owned = [...DATA];
  return s;
}

/** Start a pretraining run with the default sheet, return it. */
function startRun(s: GameState, paramsB: number, tokensB: number, patch: Partial<NonNullable<TrainingRun['config']>> = {}): TrainingRun {
  const config = { ...defaultConfig(s), ...patch };
  dispatch(s, { type: 'startTraining', name: 'Calls run', paramsB, tokensB, datasetIds: DATA, techniques: [], config });
  expect(s.training).not.toBeNull();
  return s.training!;
}

/** Play the run to the end answering every decision with choice 0, the way a passive player does. */
function playOut(s: GameState, maxDays = 2000): void {
  let days = 0;
  while (s.training && days < maxDays) {
    if (s.training.pendingIncident && s.training.pendingIncident.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    if (s.events.pending) {
      dispatch(s, { type: 'resolveEvent', choice: 0 });
      dispatch(s, { type: 'clearEventResult' });
    }
    tick(s);
    days += 1;
  }
}

describe('planning', () => {
  it('plans no calls for a short run and up to three for a long one', () => {
    const s = fleet(1);
    const run = startRun(s, 5, 100);
    expect(planRunCalls(s, run, 5)).toEqual([]);
    expect(planRunCalls(s, run, Infinity)).toEqual([]);
    expect(planRunCalls(s, run, 200).length).toBeLessThanOrEqual(3);
  });

  it('the same seed plans the same calls', () => {
    const plan = (seed: number) => {
      const s = fleet(seed);
      return startRun(s, 30, 300).calls;
    };
    expect(plan(7)).toEqual(plan(7));
    expect(plan(7)).not.toBeUndefined();
  });

  it('calls are sorted by progress point and every id is a known call', () => {
    const s = fleet(3);
    const calls = startRun(s, 30, 300).calls ?? [];
    for (let i = 1; i < calls.length; i++) expect(calls[i].at).toBeGreaterThanOrEqual(calls[i - 1].at);
    for (const c of calls) expect(RUN_CALLS.some((d) => d.id === c.id)).toBe(true);
  });
});

describe('raising and resolving', () => {
  it('a 60-day run raises its planned calls and they block the sim until decided', () => {
    const s = fleet(2);
    const run = startRun(s, 30, 300);
    // The sheet is sized to about 60 days on this fleet, so the planner gives it two calls.
    expect(run.calls?.length).toBe(2);
    let raised = 0;
    let blocked = false;
    let guard = 0;
    while (s.training && guard++ < 2000) {
      const pending = s.training.pendingIncident;
      if (pending && pending.call && pending.result === undefined) {
        raised += 1;
        blocked = blocked || isBlocked(s);
        dispatch(s, { type: 'resolveRunIncident', choice: 0 });
        dispatch(s, { type: 'clearRunIncident' });
      }
      if (s.events.pending) {
        dispatch(s, { type: 'resolveEvent', choice: 0 });
        dispatch(s, { type: 'clearEventResult' });
      }
      tick(s);
    }
    expect(raised).toBeGreaterThanOrEqual(1);
    expect(blocked).toBe(true);
    expect(s.flags['callsRaised']).toBe(raised);
  });

  it('a raised call is not counted as a survived incident', () => {
    const s = fleet(4);
    const run = startRun(s, 30, 300);
    const first = run.calls?.[0];
    expect(first).toBeDefined();
    run.calls = [{ id: first!.id, at: 0 }];
    const before = s.flags['incidentsSurvived'] ?? 0;
    for (let day = 0; day < 60 && !s.training?.pendingIncident; day++) tick(s); // the setup days come first
    expect(s.training?.pendingIncident?.call).toBe(true);
    dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    expect(s.flags['incidentsSurvived'] ?? 0).toBe(before);
  });

  it('choice 0 leaves the hidden true overall unchanged', () => {
    for (const def of RUN_CALLS) {
      const s = fleet(5);
      const run = startRun(s, 30, 300);
      run.pendingIncident = { defId: def.id, day: s.day, call: true };
      const before = run.hidden!.trueOverall;
      const qualityBefore = run.qualityMult;
      dispatch(s, { type: 'resolveRunIncident', choice: 0 });
      expect(run.pendingIncident?.result, `${def.id} choice 0 resolves`).toBeDefined();
      expect(run.hidden!.trueOverall, `${def.id} trueOverall`).toBeCloseTo(before, 9);
      expect(run.qualityMult, `${def.id} qualityMult`).toBe(qualityBefore);
    }
  });

  it('a spike policy stops loss spikes from pausing the run', () => {
    // Unstable sheets (fp8, high LR) throw loss spikes; with a standing policy none of them may pause the run.
    let spikesSeen = 0;
    for (let seed = 1; seed <= 25 && spikesSeen === 0; seed++) {
      const s = fleet(seed, ['transformers', 'bf16_training', 'fp8_training']);
      const run = startRun(s, 30, 300, { precision: 'fp8', lr: 0.7 });
      run.spikePolicy = 0;
      run.calls = [];
      let guard = 0;
      while (s.training && guard++ < 2000) {
        const live = s.training;
        spikesSeen = Math.max(spikesSeen, live.incidents?.filter((id) => id === 'loss_spike').length ?? 0);
        if (live.pendingIncident && live.pendingIncident.result === undefined) {
          expect(live.pendingIncident.defId).not.toBe('loss_spike');
          dispatch(s, { type: 'resolveRunIncident', choice: 0 });
        }
        if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
        if (s.events.pending) {
          dispatch(s, { type: 'resolveEvent', choice: 0 });
          dispatch(s, { type: 'clearEventResult' });
        }
        tick(s);
      }
    }
    expect(spikesSeen).toBeGreaterThan(0);
  });

  it('the spike policy and calls never leave a run blocked after the run finishes', () => {
    const s = fleet(9);
    startRun(s, 10, 100);
    playOut(s);
    expect(s.training).toBeNull();
    expect(s.models.length).toBeGreaterThan(0);
  });
});

describe('call effects', () => {
  it('stopping a run now finishes it on the next tick', () => {
    const s = fleet(11);
    const run = startRun(s, 30, 300);
    run.calls = [];
    run.overheadLeft = 0;
    run.doneFlops = run.totalFlops * 0.5;
    run.pendingIncident = { defId: 'call_checkpoint_verdict', day: s.day, call: true };
    dispatch(s, { type: 'resolveRunIncident', choice: 1 });
    expect(run.totalFlops).toBeCloseTo(run.doneFlops, 0);
    dispatch(s, { type: 'clearRunIncident' });
    tick(s);
    expect(s.training).toBeNull();
    expect(s.models.length).toBeGreaterThan(0);
  });

  it('an LR review that lowers the rate keeps the change on the run sheet', () => {
    const s = fleet(12);
    const run = startRun(s, 30, 300, { lr: 0.5, schedule: 'cosine' });
    run.calls = [];
    run.pendingIncident = { defId: 'call_lr_review', day: s.day, call: true };
    dispatch(s, { type: 'resolveRunIncident', choice: 1 });
    expect(run.config?.lr).toBeCloseTo(0.4, 6);
  });
});
