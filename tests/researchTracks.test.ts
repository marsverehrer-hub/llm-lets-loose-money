// v17.3 research for small labs: tracks, a recommended next topic, adopting published papers, auto-pick, and no lost
// progress when switching.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { RESEARCH, RESEARCH_TRACKS } from '../src/sim/data/research';
import { adoptQuote, isResearched, recommendedResearch } from '../src/sim/systems/research';

const node = (id: string) => RESEARCH.find((n) => n.id === id)!;
/** Advance a day, answering anything that would block the sim. */
function day(s: ReturnType<typeof createInitialState>): void {
  if (s.events.pending && s.events.pending.result === undefined) dispatch(s, { type: 'resolveEvent', choice: 0 });
  if (s.events.pending?.result !== undefined) dispatch(s, { type: 'clearEventResult' });
  if (s.pendingMoment) dispatch(s, { type: 'dismissMoment' });
  const d = s.day;
  tick(s);
  if (s.day === d) tick(s);
}
const dayOfYear = (y: number) => Math.round((y - 2017) * 365.25) + 10;

describe('research tracks', () => {
  it('every track step is a real topic, and no topic is in two tracks', () => {
    const ids = RESEARCH_TRACKS.flatMap((t) => t.steps.map((st) => st.id));
    for (const id of ids) expect(RESEARCH.some((n) => n.id === id), id).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a new lab is told to research Transformers first, then the next track step', () => {
    const s = createInitialState(1, 'R');
    expect(recommendedResearch(s)?.node.id).toBe('transformers');
    s.research.completed.push('transformers');
    expect(recommendedResearch(s)?.node.id).toBe('mixed_precision');
  });
});

describe('adopting published papers', () => {
  it('is closed before publication, then costs cash and lands in parallel with your own topic', () => {
    const s = createInitialState(2, 'R');
    s.research.completed.push('transformers', 'scaling_laws');
    s.day = dayOfYear(2019);
    expect(adoptQuote(s, node('instruction_tuning')).ok).toBe(false); // minYear 2019: published in 2020
    s.day = dayOfYear(2020);
    s.finance.cash = 1e7;
    const q = adoptQuote(s, node('instruction_tuning'));
    expect(q.ok).toBe(true);
    expect(q.price).toBeGreaterThan(150_000);
    expect(q.price).toBeLessThan(260_000);
    dispatch(s, { type: 'setResearch', nodeId: 'code_models' });
    dispatch(s, { type: 'adoptPaper', nodeId: 'instruction_tuning' });
    expect(s.finance.cash).toBeCloseTo(1e7 - q.price, 0);
    const until = s.day + q.days;
    for (let i = 0; i < 200 && s.day < until; i++) day(s);
    expect(isResearched(s, 'instruction_tuning')).toBe(true);
    expect(s.research.current).toBe('code_models'); // own research kept going
  });
});

describe('no lost research', () => {
  it('switching shelves progress and coming back restores it', () => {
    const s = createInitialState(3, 'R');
    s.research.completed.push('transformers');
    dispatch(s, { type: 'setResearch', nodeId: 'code_models' });
    s.research.progress = 100;
    dispatch(s, { type: 'setResearch', nodeId: 'kv_cache' });
    expect(s.research.progress).toBe(0);
    dispatch(s, { type: 'setResearch', nodeId: 'code_models' });
    expect(s.research.progress).toBe(100);
  });

  it('an idle lab with auto-pick on starts the recommended topic; off leaves it idle', () => {
    const on = createInitialState(4, 'R');
    on.research.current = null;
    tick(on);
    expect(on.research.current).toBe('transformers');
    const off = createInitialState(4, 'R');
    off.research.current = null;
    dispatch(off, { type: 'setResearchAutoPick', on: false });
    day(off);
    expect(off.research.current).toBeNull();
  });
});
