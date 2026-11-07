// v19 E1: AGI endings. Completing AGI blocks the sim, each ending's gate, choosing (with refusals), rivals reaching AGI,
// and the sim carrying on afterwards.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import { RESEARCH } from '../src/sim/data/research';
import { COMPETITORS } from '../src/sim/data/competitors';
import { SCENARIO_FLAGS } from '../src/sim/data/scenarios';
import { ENDINGS, endingScore, reachAgi } from '../src/sim/systems/endings';
import { researchTick } from '../src/sim/systems/research';
import { brainWeek } from '../src/sim/systems/rivals/brain';
import { rivalLabs } from '../src/sim/systems/rivals';
import { isSandbox } from '../src/sim/systems/scenario';
import type { EndingId, GameState, Model } from '../src/sim/types';

const DEF = (id: EndingId) => ENDINGS.find((e) => e.id === id)!;

function fresh(): GameState {
  return createInitialState(21, 'Ending Labs');
}

/** A released model with the given overall, safety score and release mode. */
function model(id: string, overall: number, safety = 50, mode: Model['releaseMode'] = 'full'): Model {
  return { id, name: id, paramsB: 1, tokensB: 1, datasetIds: [], techniques: [], finalLoss: 1, overall, elo: 1000, trainedDay: 0, scores: { reasoning: 50, coding: 50, chat: 50, safety }, releasedDay: 100, deprecated: false, releaseMode: mode } as unknown as Model;
}

/** Put the player at AGI: complete the agi node through the research tick, which is what the game does. */
function completeAgi(s: GameState): void {
  s.research.completed = s.research.completed.filter((id) => id !== 'agi');
  s.research.current = 'agi';
  s.research.progress = 1e15;
  researchTick(s, makeRng(s));
}

describe('AGI completion', () => {
  it('completing agi sets pendingEnding and blocks the sim', () => {
    const s = fresh();
    completeAgi(s);
    expect(s.research.completed).toContain('agi');
    expect(s.pendingEnding).toEqual({ day: s.day, by: 'player' });
    expect(isBlocked(s)).toBe(true);
    const day = s.day;
    tick(s);
    expect(s.day).toBe(day);
  });

  it('reachAgi does nothing once an ending is pending or chosen', () => {
    const s = fresh();
    reachAgi(s, 'player');
    const first = s.pendingEnding;
    reachAgi(s, COMPETITORS[0].id);
    expect(s.pendingEnding).toBe(first);
  });
});

describe('ending gates', () => {
  it('race needs the player to have reached AGI', () => {
    const s = fresh();
    expect(DEF('race').available(s).ok).toBe(false);
    s.research.completed.push('agi');
    s.pendingEnding = { day: s.day, by: 'player' };
    expect(DEF('race').available(s).ok).toBe(true);
  });

  it('safe_launch needs a safe model, reputation 60, and four safety nodes', () => {
    const s = fresh();
    // A strong safety case (systems/safetyCase.ts): a safe model, the safety branch researched, red-teamed and evaluated.
    const safetyNodes = RESEARCH.filter((n) => n.branch === 'safety').map((n) => n.id);
    const safeModel = () => Object.assign(model('m1', 80, 85), { redTeam: true, arena: { doneDay: 0, elo: 1500 } });
    s.models = [safeModel()];
    s.company.reputation = 70;
    s.research.completed = safetyNodes;
    s.pendingEnding = { day: s.day, by: 'player' };
    expect(DEF('safe_launch').available(s).ok).toBe(true);
    s.company.reputation = 50;
    expect(DEF('safe_launch').available(s)).toEqual({ ok: false, why: 'Nobody trusts you enough to believe it is safe.' });
    s.company.reputation = 70;
    s.research.completed = safetyNodes.slice(0, 3);
    expect(DEF('safe_launch').available(s).ok).toBe(false);
    s.research.completed = safetyNodes;
    s.models = [model('m1', 80, 60)]; // not red-teamed, never evaluated: the case is thin
    expect(DEF('safe_launch').available(s).ok).toBe(false);
  });

  it('nationalised needs two government contracts or a regulation event', () => {
    const s = fresh();
    expect(DEF('nationalised').available(s).ok).toBe(false);
    s.flags[SCENARIO_FLAGS.govContracts] = 2;
    expect(DEF('nationalised').available(s).ok).toBe(true);
    s.flags[SCENARIO_FLAGS.govContracts] = 0;
    s.events.fired.push('eu_regulator');
    expect(DEF('nationalised').available(s).ok).toBe(true);
  });

  it('merger needs an active marquee rival with rivalry 40+ and 30% of the player valuation', () => {
    const s = fresh();
    const core = COMPETITORS.find((d) => d.core)!;
    const lab = rivalLabs(s).find((l) => l.id === core.id)!;
    const c = s.competitors.find((x) => x.id === core.id)!;
    s.finance.valuation = 1e9;
    lab.status = 'active';
    c.rivalry = 50;
    c.valuation = 4e8;
    expect(DEF('merger').available(s).ok).toBe(true);
    c.valuation = 1e8;
    expect(DEF('merger').available(s).ok).toBe(false);
    c.valuation = 4e8;
    c.rivalry = 39;
    expect(DEF('merger').available(s).ok).toBe(false);
  });

  it('open_singularity needs three open-weight releases', () => {
    const s = fresh();
    s.models = [model('a', 60, 50, 'open'), model('b', 60, 50, 'open')];
    expect(DEF('open_singularity').available(s).ok).toBe(false);
    s.models.push(model('c', 60, 50, 'open'));
    expect(DEF('open_singularity').available(s).ok).toBe(true);
  });

  it('second_place only when a rival got there first', () => {
    const s = fresh();
    s.pendingEnding = { day: s.day, by: 'player' };
    expect(DEF('second_place').available(s).ok).toBe(false);
    s.pendingEnding = { day: s.day, by: COMPETITORS[0].id };
    expect(DEF('second_place').available(s).ok).toBe(true);
    expect(DEF('race').available(s).ok).toBe(false);
    expect(DEF('safe_launch').available(s).ok).toBe(false);
  });

  it('every ending has 60 to 120 words of text and a unique id', () => {
    expect(ENDINGS).toHaveLength(9);
    expect(new Set(ENDINGS.map((e) => e.id)).size).toBe(9);
    for (const e of ENDINGS) {
      const words = e.text.trim().split(/\s+/).length;
      expect(words, e.id).toBeGreaterThanOrEqual(60);
      expect(words, e.id).toBeLessThanOrEqual(120);
    }
  });
});

describe('choosing and scoring', () => {
  it('chooseEnding refuses an unavailable ending and accepts an available one', () => {
    const s = fresh();
    s.pendingEnding = { day: s.day, by: 'player' };
    dispatch(s, { type: 'chooseEnding', id: 'safe_launch' });
    expect(s.ending).toBeFalsy();
    expect(s.pendingEnding).not.toBeNull();
    s.models = [model('a', 60, 50, 'open'), model('b', 60, 50, 'open'), model('c', 60, 50, 'open')];
    dispatch(s, { type: 'chooseEnding', id: 'open_singularity' });
    expect(s.ending).toEqual({ id: 'open_singularity', day: s.day, score: endingScore(s, 'open_singularity'), by: 'player' });
    expect(s.ending!.score).toBeGreaterThan(0);
    expect(s.pendingEnding).toBeNull();
  });

  it('endingScore is higher for earlier years and scales with the valuation', () => {
    const s = fresh();
    s.day = 365 * 5; // 2022
    const early = endingScore(s, 'safe_launch');
    s.day = 365 * 15; // 2032
    expect(endingScore(s, 'safe_launch')).toBeLessThan(early);
    const rich = { ...s, finance: { ...s.finance, valuation: 1e12 } };
    expect(endingScore(rich, 'safe_launch')).toBeGreaterThan(endingScore(s, 'safe_launch'));
  });
});

describe('rivals and the sim afterwards', () => {
  it('a rival reaching AGI offers second_place', () => {
    const s = fresh();
    const def = COMPETITORS[0];
    const lab = rivalLabs(s).find((l) => l.id === def.id)!;
    lab.status = 'active';
    lab.researching = 'agi';
    lab.rp = 1e15;
    brainWeek(s, lab, def, makeRng(s));
    expect(lab.research).toContain('agi');
    expect(s.pendingEnding).toEqual({ day: s.day, by: def.id });
    expect(DEF('second_place').available(s).ok).toBe(true);
    expect(s.news.some((n) => n.text.endsWith('announces AGI. Probably.'))).toBe(true);
    expect(isBlocked(s)).toBe(true);
  });

  it('after a choice the sim unblocks and continues', () => {
    const s = fresh();
    completeAgi(s);
    s.models = [model('a', 60, 50, 'open'), model('b', 60, 50, 'open'), model('c', 60, 50, 'open')];
    dispatch(s, { type: 'chooseEnding', id: 'open_singularity' });
    expect(isBlocked(s)).toBe(false);
    const day = s.day;
    tick(s);
    expect(s.day).toBe(day + 1);
    dispatch(s, { type: 'continueAfterEnding' });
    expect(isSandbox(s)).toBe(true);
    expect(s.ending?.id).toBe('open_singularity');
  });

  it("keep going on second place clears the block and does not offer the ending again", () => {
    const s = fresh();
    const rival = COMPETITORS[0].id;
    reachAgi(s, rival);
    dispatch(s, { type: 'continueAfterEnding' });
    expect(s.pendingEnding).toBeNull();
    expect(isBlocked(s)).toBe(false);
    expect(isSandbox(s)).toBe(true);
    reachAgi(s, 'player');
    expect(s.pendingEnding).toBeNull();
  });

  it("continueAfterEnding cannot skip the player's own ending", () => {
    const s = fresh();
    reachAgi(s, 'player');
    dispatch(s, { type: 'continueAfterEnding' });
    expect(s.pendingEnding).toEqual({ day: s.day, by: 'player' });
    expect(isSandbox(s)).toBe(false);
  });
});
