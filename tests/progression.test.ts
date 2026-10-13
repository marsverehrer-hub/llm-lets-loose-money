// v13 progression (GAME_DESIGN §23): lab XP and levels, the perk tree, the hot streak, board objectives and run tempo.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { EvalReveal, GameState } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { PERKS, perkById } from '../src/sim/data/perks';
import { getBonuses, boardValuationMult } from '../src/sim/bonuses';
import {
  PROGRESS_TUNING,
  ensureProgress,
  eraXpMult,
  grantXp,
  levelForXp,
  momentumSpeedMult,
  perkBlocker,
  pointsForLevel,
  progressionTick,
  streakXpMult,
  xpAtLevel,
  xpToNext,
} from '../src/sim/systems/progression';
import { BOARD_TUNING, ensureBoard, nextQuarterStart, objectiveProgress, boardTick } from '../src/sim/systems/board';
import { TEMPO_TUNING, applyTempoDay, liveRunEta, tempoRisk, tempoSpeed } from '../src/sim/systems/tempo';
import { trainingRatePerDay } from '../src/sim/systems/capabilities';
import { createInitialState as fresh } from '../src/sim/state';

const DATA = ['scrawl_sample', 'common_scrawl_full'];

function lab(seed = 3): GameState {
  const s = createInitialState(seed, 'Prog', { scenarioId: 'garage', difficulty: 'founder', sandbox: true, skipTutorial: true, startYear: 2017 });
  s.finance.cash = 1e12;
  return s;
}

function reveal(s: GameState, verdict: EvalReveal['verdict'], id: string, kind: EvalReveal['kind'] = 'pretrain'): void {
  s.pendingReveal = { modelId: id, kind, forecast: { low: 0, mid: 0, high: 0, confidence: 'rough', reasons: [], caps: {} as any } as any, actual: 0, verdict, seedTag: null, emerged: [], quirks: [], dataSurprises: {}, benchmarks: {} };
}

describe('lab levels', () => {
  it('has a growing, consistent XP curve', () => {
    expect(xpToNext(2)).toBeGreaterThan(xpToNext(1));
    expect(xpAtLevel(1)).toBe(0);
    expect(xpAtLevel(3)).toBe(xpToNext(1) + xpToNext(2));
    for (const l of [1, 2, 5, 12, 30]) {
      expect(levelForXp(xpAtLevel(l))).toBe(l);
      expect(levelForXp(xpAtLevel(l) - 1)).toBe(Math.max(1, l - 1));
    }
    expect(levelForXp(1e15)).toBe(PROGRESS_TUNING.MAX_LEVEL);
  });

  it('levels up and pays perk points', () => {
    const s = lab();
    const p = ensureProgress(s);
    grantXp(s, xpAtLevel(4) / eraXpMult(s) + 1, 'test');
    expect(p.level).toBe(4);
    expect(p.perkPoints).toBe(pointsForLevel(4));
    expect(s.notifications.some((n) => /Lab level 4/.test(n.text))).toBe(true);
  });

  it('new and old saves start with no XP backlog', () => {
    const s = lab();
    s.research.completed.push('transformers', 'scaling_laws');
    s.stats.modelsReleased = 4;
    progressionTick(s); // first sight creates the record at today's counters
    expect(s.progress!.xp).toBe(0);
    s.research.completed.push('rlhf');
    progressionTick(s);
    expect(s.progress!.xp).toBe(Math.round(PROGRESS_TUNING.RESEARCH_XP * eraXpMult(s)));
  });
});

describe('hot streak', () => {
  it('counts runs at or above forecast and resets on a miss', () => {
    const s = lab();
    ensureProgress(s);
    reveal(s, 'solid', 'a');
    progressionTick(s);
    progressionTick(s); // the same reveal never pays twice
    expect(s.progress!.streak).toBe(1);
    reveal(s, 'banger', 'b');
    progressionTick(s);
    reveal(s, 'as expected', 'c');
    progressionTick(s);
    expect(s.progress!.streak).toBe(3);
    expect(s.progress!.bestStreak).toBe(3);
    const before = s.progress!.xp;
    reveal(s, 'dud', 'd');
    progressionTick(s);
    expect(s.progress!.streak).toBe(0);
    expect(s.progress!.bestStreak).toBe(3);
    expect(s.progress!.xp - before).toBe(Math.round(PROGRESS_TUNING.VERDICT_XP.dud * eraXpMult(s)));
  });

  it('fine-tunes pay less and do not touch the streak', () => {
    const s = lab();
    ensureProgress(s).streak = 2;
    reveal(s, 'banger', 'f', 'finetune');
    progressionTick(s);
    expect(s.progress!.streak).toBe(2);
    expect(s.progress!.xp).toBe(Math.round(PROGRESS_TUNING.VERDICT_XP.banger * PROGRESS_TUNING.DERIVED_SHARE * eraXpMult(s)));
  });

  it('streak multiplies run XP up to a cap', () => {
    expect(streakXpMult(0)).toBe(1);
    expect(streakXpMult(2)).toBeCloseTo(1 + 2 * PROGRESS_TUNING.STREAK_XP_STEP);
    expect(streakXpMult(50)).toBeCloseTo(1 + PROGRESS_TUNING.STREAK_XP_MAX_STEPS * PROGRESS_TUNING.STREAK_XP_STEP);
  });
});

describe('perks', () => {
  it('every branch has tiers 1-4 and ids are unique', () => {
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
    for (const b of ['scale', 'craft', 'hype', 'data', 'trust'] as const) {
      for (const tier of [1, 2, 3, 4]) expect(PERKS.some((p) => p.branch === b && p.tier === tier)).toBe(true);
    }
  });

  it('gates by level, tier order, points and one capstone', () => {
    const s = lab();
    const p = ensureProgress(s);
    const t1 = perkById('cluster_energy')!;
    const t2 = perkById('crunch_culture')!;
    expect(perkBlocker(s, t1)).toMatch(/level/);
    p.level = 20;
    p.perkPoints = 20;
    expect(perkBlocker(s, t2)).toMatch(/tier 1/);
    dispatch(s, { type: 'buyPerk', perkId: 'cluster_energy' });
    expect(p.perks).toContain('cluster_energy');
    expect(p.perkPoints).toBe(19);
    expect(perkBlocker(s, t2)).toBeNull();
    for (const id of ['crunch_culture', 'scaling_believers', 'scale_lifestyle', 'kernel_nerds', 'distill_pipeline', 'pound_for_pound']) dispatch(s, { type: 'buyPerk', perkId: id });
    expect(p.perks).toContain('scale_lifestyle');
    expect(perkBlocker(s, perkById('tiny_titans')!)).toMatch(/capstone/);
    dispatch(s, { type: 'buyPerk', perkId: 'tiny_titans' });
    expect(p.perks).not.toContain('tiny_titans');
  });

  it('perk bonuses fold into getBonuses', () => {
    const s = lab();
    const base = getBonuses(s).trainingSpeed;
    ensureProgress(s).perks.push('cluster_energy');
    expect(getBonuses(s).trainingSpeed).toBeCloseTo(base * 1.08);
  });

  it('respec refunds every point once a year', () => {
    const s = lab();
    const p = ensureProgress(s);
    p.level = 10;
    p.perkPoints = 5;
    dispatch(s, { type: 'buyPerk', perkId: 'vibe_posting' });
    dispatch(s, { type: 'buyPerk', perkId: 'launch_theater' });
    expect(p.perkPoints).toBe(2);
    const cash = s.finance.cash;
    dispatch(s, { type: 'respecPerks' });
    expect(p.perks).toEqual([]);
    expect(p.perkPoints).toBe(5);
    expect(s.finance.cash).toBeLessThan(cash);
    dispatch(s, { type: 'buyPerk', perkId: 'vibe_posting' });
    dispatch(s, { type: 'respecPerks' });
    expect(p.perks).toEqual(['vibe_posting']); // cooldown
  });

  it('momentum turns the streak into training speed', () => {
    const s = lab();
    s.compute.rented = { p100: 50 };
    const p = ensureProgress(s);
    p.streak = 3;
    expect(momentumSpeedMult(s)).toBe(1);
    const before = trainingRatePerDay(s);
    p.perks.push('momentum');
    expect(momentumSpeedMult(s)).toBeCloseTo(1.06);
    expect(trainingRatePerDay(s)).toBeCloseTo(before * 1.06);
    p.streak = 99;
    expect(momentumSpeedMult(s)).toBeCloseTo(1 + PROGRESS_TUNING.MOMENTUM_MAX);
  });
});

describe('board objectives', () => {
  it('quarters follow the calendar', () => {
    expect(nextQuarterStart(0)).toBe(90); // 1 Jan 2017 -> 1 Apr 2017
    expect(nextQuarterStart(300)).toBe(365); // late Oct -> 1 Jan 2018
  });

  it('sets three distinct goals and pays a goal the day it is met', () => {
    const s = lab();
    const b = ensureBoard(s);
    expect(b.objectives.length).toBe(BOARD_TUNING.OBJECTIVES);
    expect(new Set(b.objectives.map((o) => o.kind)).size).toBe(b.objectives.length);
    expect(b.objectives.filter((o) => o.stretch).length).toBe(1);
    expect(b.quarterEnd - b.quarterStart).toBeGreaterThanOrEqual(BOARD_TUNING.MIN_QUARTER_DAYS);
    const research = b.objectives.find((o) => o.kind === 'research');
    if (research) {
      const xp = s.progress?.xp ?? 0;
      while (s.research.completed.length < research.target) s.research.completed.push(`fake${s.research.completed.length}`);
      boardTick(s);
      expect(research.doneDay).toBe(s.day);
      expect(objectiveProgress(research)).toBe(1);
      expect(s.progress!.xp).toBeGreaterThan(xp);
    }
  });

  it('closing a quarter moves confidence and starts the next', () => {
    const s = lab();
    const b = ensureBoard(s);
    const q = b.quarter;
    s.day = b.quarterEnd;
    boardTick(s);
    expect(b.quarter).toBe(q + 1);
    expect(b.history.length).toBe(1);
    expect(b.confidence).toBeLessThan(BOARD_TUNING.START_CONFIDENCE + 1);
  });

  it('reroll swaps an open goal once per quarter', () => {
    const s = lab();
    s.finance.cash = 1e6;
    s.finance.dailyExpenses = 10_000; // burning: a runway goal joins the pool, so there is something to swap in
    const b = ensureBoard(s);
    const first = b.objectives[0];
    dispatch(s, { type: 'rerollObjective', objectiveId: first.id });
    expect(b.rerolls).toBe(0);
    expect(b.objectives[0].kind).not.toBe(first.kind);
    const again = b.objectives[0];
    dispatch(s, { type: 'rerollObjective', objectiveId: again.id });
    expect(b.objectives[0]).toBe(again);
  });

  it('confidence nudges valuation a little either way', () => {
    expect(boardValuationMult(50)).toBe(1);
    expect(boardValuationMult(100)).toBeCloseTo(1.06);
    expect(boardValuationMult(0)).toBeCloseTo(0.94);
  });

  it('the board uses its own random stream', () => {
    const a = fresh(11, 'A');
    const b = fresh(11, 'B');
    ensureBoard(a);
    expect(a.rngState).toBe(b.rngState);
  });

  it('runs through years of play without breaking', () => {
    const s = lab(5);
    for (let i = 0; i < 800; i++) {
      if (s.events.pending) {
        dispatch(s, { type: 'resolveEvent', choice: 0 });
        dispatch(s, { type: 'clearEventResult' });
      }
      s.pendingMoment = null;
      tick(s);
    }
    expect(s.board!.quarter).toBeGreaterThan(7);
    for (const o of s.board!.objectives) expect(Number.isFinite(o.target)).toBe(true);
  });
});

describe('run tempo', () => {
  function running(): GameState {
    const s = lab(2);
    s.compute.rented = { p100: 2000 };
    s.data.owned = [...DATA];
    dispatch(s, { type: 'startTraining', name: 'Tempo', paramsB: 5, tokensB: 100, datasetIds: DATA, techniques: [], config: { ...defaultConfig(s), lr: 0.5 } });
    expect(s.training).not.toBeNull();
    return s;
  }

  it('crunch is faster and riskier, careful slower and safer', () => {
    const s = running();
    const run = s.training!;
    const std = liveRunEta(s, run, 'standard');
    expect(liveRunEta(s, run, 'crunch')).toBeLessThan(std);
    expect(liveRunEta(s, run, 'careful')).toBeGreaterThan(std);
    expect(tempoRisk(s, 'crunch')).toBeGreaterThan(1);
    expect(tempoRisk(s, 'careful')).toBeLessThan(1);
  });

  it('perks bend the tempo', () => {
    const s = running();
    const p = ensureProgress(s);
    p.perks.push('careful_science', 'crunch_culture');
    expect(tempoSpeed(s, 'careful')).toBe(TEMPO_TUNING.CAREFUL_SCIENCE_SPEED);
    expect(tempoRisk(s, 'crunch')).toBeCloseTo(TEMPO_TUNING.crunch.risk * TEMPO_TUNING.CRUNCH_CULTURE_RISK);
  });

  it('crunch drains morale and stops itself at the floor', () => {
    const s = running();
    s.flags['nextEventDay'] = Infinity;
    dispatch(s, { type: 'setRunTempo', tempo: 'crunch' });
    expect(s.training!.tempo).toBe('crunch');
    const m0 = s.staff.morale;
    applyTempoDay(s, s.training!);
    expect(s.staff.morale).toBeCloseTo(m0 - TEMPO_TUNING.crunch.moralePerDay);
    s.staff.morale = TEMPO_TUNING.CRUNCH_MORALE_FLOOR + 0.05;
    applyTempoDay(s, s.training!);
    expect(s.training?.tempo ?? 'standard').toBe('standard');
    dispatch(s, { type: 'setRunTempo', tempo: 'crunch' });
    expect(s.training?.tempo ?? 'standard').toBe('standard'); // refused at low morale
  });

  it('crunch finishes the same run in fewer days', () => {
    const days = (tempo: 'standard' | 'crunch') => {
      const s = running();
      s.flags['nextEventDay'] = Infinity;
      dispatch(s, { type: 'setRunTempo', tempo });
      let n = 0;
      while (s.training && n < 3000) {
        if (s.training.pendingIncident) s.training.pendingIncident = null;
        s.training.stallDays = 0;
        s.staff.morale = 80;
        tick(s);
        n++;
      }
      return n;
    };
    expect(days('crunch')).toBeLessThan(days('standard'));
  });
});
