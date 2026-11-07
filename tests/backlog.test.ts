// v18 WP5 (research backlog): an idle lab banks output for its next topic, up to a cap; overflow carries over.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import { RESEARCH } from '../src/sim/data/research';
import type { GameState } from '../src/sim/types';
import { backlogCap, effectiveResearchCost, isResearched, researchPointsPerDay, RESEARCH_TUNING } from '../src/sim/systems/research';

const NODE = RESEARCH.find((n) => n.id === 'transformers')!;

/** Dismisses the events, reveals and moments that stop the sim from advancing. */
function clearBlockers(s: GameState): void {
  if (s.events.pending && s.events.pending.result === undefined) {
    dispatch(s, { type: 'resolveEvent', choice: 0 });
    dispatch(s, { type: 'clearEventResult' });
  }
  if (s.pendingReveal) dispatch(s, { type: 'dismissReveal' });
  if (s.pendingMoment) dispatch(s, { type: 'dismissMoment' });
}

describe('research backlog', () => {
  it('an idle lab banks part of its output, up to the cap', () => {
    const s = createInitialState(42);
    s.research.autoPick = false; // auto-pick would start a topic before the idle branch runs
    s.research.current = null;
    s.research.banked = 0;
    expect(researchPointsPerDay(s)).toBeGreaterThan(0);
    tick(s);
    // The tick refreshes research.pointsPerDay before banking, so that is the rate the bank saw.
    expect(s.research.banked).toBeCloseTo(RESEARCH_TUNING.BACKLOG_RATE * s.research.pointsPerDay, 6);
    const day0 = s.day;
    for (let i = 0; i < 400; i++) {
      if (isBlocked(s)) clearBlockers(s);
      tick(s);
    }
    expect(s.day - day0).toBe(400);
    expect(s.research.banked).toBeLessThanOrEqual(backlogCap(s) + 1e-6);
    // The cap follows today's research output, which drifts as the field poaches and events land, so the bank sits
    // at or just under it rather than exactly on it.
    expect(s.research.banked).toBeGreaterThan(0.85 * backlogCap(s));
    expect(backlogCap(s)).toBeCloseTo(RESEARCH_TUNING.BACKLOG_CAP_DAYS * researchPointsPerDay(s), 6);
  });

  it('setResearch starts the next topic with the bank and empties it', () => {
    const s = createInitialState(42);
    s.research.current = null;
    s.research.banked = 50;
    dispatch(s, { type: 'setResearch', nodeId: 'transformers' });
    expect(s.research.progress).toBe(50);
    expect(s.research.banked).toBe(0);
  });

  it('overflow from a finished topic carries over to the bank', () => {
    const s = createInitialState(42);
    s.research.autoPick = false;
    dispatch(s, { type: 'setResearch', nodeId: 'transformers' });
    s.research.banked = 0;
    const cost = effectiveResearchCost(s, NODE);
    s.research.progress = cost + 100;
    tick(s);
    expect(isResearched(s, 'transformers')).toBe(true);
    // The overflow is the 100 we added plus the day's output the tick added before the check.
    expect(s.research.banked).toBeCloseTo(Math.min(backlogCap(s), 100 + s.research.pointsPerDay), 6);
  });
});
