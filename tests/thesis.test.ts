// v20 thesis goals: three per focus with unique ids, a goal is marked done once its check passes, and only the
// current focus counts toward thesisMet.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { THESES } from '../src/sim/data/theses';
import { thesisGoals, thesisMet, thesisTick } from '../src/sim/systems/thesis';
import type { GameState } from '../src/sim/types';

function fresh(): GameState {
  return createInitialState(33, 'Thesis Labs');
}

describe('thesis goal definitions', () => {
  it('each focus has three goals and every id is unique', () => {
    const ids = Object.values(THESES).flat().map((g) => g.id);
    for (const defs of Object.values(THESES)) expect(defs).toHaveLength(3);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('thesis goal checks', () => {
  it('marks a goal done when its check passes, and only on a weekly check day', () => {
    const s = fresh();
    s.company.doctrine = 'efficient';
    s.achievements['garage_prodigy'] = 1;
    s.day = 365; // 365 is not a multiple of 7, so nothing is checked yet
    thesisTick(s);
    expect(s.thesis?.done['efficient.small_crowns']).toBeUndefined();
    s.day = 371;
    thesisTick(s);
    expect(s.thesis?.done['efficient.small_crowns']).toBe(371);
    expect(thesisMet(s)).toBe(1);
  });

  it('the arena goal needs a full year at #1', () => {
    const s = fresh();
    s.company.doctrine = 'frontier';
    s.flags['moments.arena1Since'] = 0;
    s.day = 364;
    thesisTick(s);
    expect(s.thesis?.done['frontier.arena_year']).toBeUndefined();
    s.day = 371;
    thesisTick(s);
    expect(s.thesis?.done['frontier.arena_year']).toBe(371);
  });
});

describe('thesisMet', () => {
  it('counts only the current focus, and done goals survive a focus change', () => {
    const s = fresh();
    s.company.doctrine = 'efficient';
    s.thesis = { done: { 'efficient.small_crowns': 7, 'open.crowns': 7 } };
    expect(thesisMet(s)).toBe(1);
    s.company.doctrine = 'open';
    expect(thesisMet(s)).toBe(1);
    expect(s.thesis.done['efficient.small_crowns']).toBe(7);
  });

  it('is zero with no focus, and thesisGoals lists the current focus only', () => {
    const s = fresh();
    expect(thesisMet(s)).toBe(0);
    expect(thesisGoals(s)).toEqual([]);
    s.company.doctrine = 'specialist';
    expect(thesisGoals(s).map((g) => g.def.id)).toEqual(THESES.specialist.map((g) => g.id));
  });
});
