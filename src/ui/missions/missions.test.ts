import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../sim/state';
import type { GameState, TrainingRun } from '../../sim/types';
import { MISSIONS, parseDone, snapshot, type MissionId } from './missions';

const done = (id: MissionId, i: number) => MISSIONS.find((m) => m.id === id)!.steps[i].done!;

describe('parseDone', () => {
  it('keeps known mission ids, in mission order, and drops the rest', () => {
    expect([...parseDone('["compute","retired",7,"training"]')]).toEqual(['training', 'compute']);
  });

  it('reads a missing or corrupt entry as nothing done', () => {
    expect(parseDone(null).size).toBe(0);
    expect(parseDone('{not json').size).toBe(0);
    expect(parseDone('"training"').size).toBe(0);
  });
});

describe('mission step predicates', () => {
  it('a run already going when the mission starts does not finish the start step', () => {
    const s = createInitialState(1);
    s.training = { id: 'old' } as TrainingRun;
    const base = snapshot(s);
    const started = done('training', 1);
    expect(started(s, base)).toBe(false);
    s.training = null; // the old run ends: still not a new start
    expect(started(s, base)).toBe(false);
    s.training = { id: 'new' } as TrainingRun;
    expect(started(s, base)).toBe(true);
  });

  it('the model step finishes once a new model appears', () => {
    const s = createInitialState(1);
    const base = snapshot(s);
    const finished = done('training', 3);
    expect(finished(s, base)).toBe(false);
    s.models.push({} as GameState['models'][number]);
    expect(finished(s, base)).toBe(true);
  });
});
