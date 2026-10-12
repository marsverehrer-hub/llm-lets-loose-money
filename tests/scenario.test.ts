import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import { botDay } from '../scripts/bot';
import { DIFFICULTIES, SCENARIOS, scenarioById } from '../src/sim/data/scenarios';
import { RESEARCH } from '../src/sim/data/research';
import { GPUS } from '../src/sim/data/gpus';
import { DATASETS } from '../src/sim/data/datasets';
import { canIpo, runwayDays } from '../src/sim/systems/finance';
import { arenaLeaderboard } from '../src/sim/systems/competitors';
import { frontierQuality } from '../src/sim/systems/market';
import { scenarioTick, scenarioRule, rivalQualityOffset, eventWeightMult, trainingLockedNotice, startDayOf, scenarioScore } from '../src/sim/systems/scenario';
import { calendarYear, yearOf } from '../src/sim/util';
import { BALANCE } from '../src/sim/balance';
import { makeRng } from '../src/sim/rng';
import type { GameSetup, GameState, Model } from '../src/sim/types';

const SEED = 4242;
const NAME = 'Test Labs';

function setupFor(scenarioId: string, over: Partial<GameSetup> = {}): GameSetup {
  const sc = scenarioById(scenarioId);
  return { scenarioId: sc.id, difficulty: 'founder', sandbox: false, skipTutorial: false, startYear: sc.startYear, ...over };
}

function withoutSetup(s: GameState): Omit<GameState, 'setup'> {
  const { setup: _setup, ...rest } = s;
  return rest;
}

describe('default setup', () => {
  it('equals the classic createInitialState (only the setup record differs)', () => {
    const classic = createInitialState(SEED, NAME);
    const withDefault = createInitialState(SEED, NAME, setupFor('garage'));
    expect(withDefault.setup).toEqual({ scenarioId: 'garage', difficulty: 'founder', sandbox: false, skipTutorial: false, startYear: 2017 });
    expect(classic.setup).toBeUndefined();
    expect(withoutSetup(withDefault)).toEqual(withoutSetup(classic));
  });

  it('skip tutorial and sandbox are recorded and applied', () => {
    const s = createInitialState(SEED, NAME, setupFor('garage', { skipTutorial: true, sandbox: true }));
    expect(s.tutorialStep).toBe(-1);
    expect(s.setup).toMatchObject({ skipTutorial: true, sandbox: true });
    expect(s.goals).toBeUndefined();
    const plain = createInitialState(SEED, NAME, setupFor('garage'));
    expect(plain.tutorialStep).toBe(0);
  });

  it('keeps the old signature working', () => {
    const s = createInitialState(7, 'Old Signature');
    expect(s.company.name).toBe('Old Signature');
    expect(s.finance.cash).toBe(BALANCE.START_CASH);
    expect(s.tutorialStep).toBe(0);
  });
});

describe('scenario definitions', () => {
  it('has the eight scenarios from the spec, with valid GPUs and datasets', () => {
    expect(SCENARIOS.map((x) => x.id).sort()).toEqual(
      ['agi_speedrun', 'bootstrapped', 'big_tech_spinout', 'data_broker', 'garage', 'late_2022', 'open_collective', 'sovereign'].sort(),
    );
    for (const sc of SCENARIOS) {
      for (const gpu of Object.keys(sc.fleet ?? {})) {
        const def = GPUS.find((g) => g.id === gpu);
        expect(def, `${sc.id} fleet ${gpu}`).toBeDefined();
        expect(def!.unlockYear).toBeLessThanOrEqual(sc.startYear);
      }
      expect(sc.goals.length).toBeLessThanOrEqual(3);
      for (const g of sc.goals) expect(g.progress(createInitialState(SEED, NAME, setupFor(sc.id)))).toEqual(expect.any(String));
    }
    expect(DATASETS.length).toBeGreaterThan(0);
  });

  it('difficulty table matches the spec', () => {
    const d = Object.fromEntries(DIFFICULTIES.map((x) => [x.id, x]));
    expect(d.intern).toMatchObject({ startCash: 2, rivalOffset: -4, eventWeight: 0.6, marketGrowth: 1.15, vcGenerosity: 1.3 });
    expect(d.founder).toMatchObject({ startCash: 1, rivalOffset: 0, eventWeight: 1, marketGrowth: 1, vcGenerosity: 1 });
    expect(d.unicorn).toMatchObject({ startCash: 0.75, rivalOffset: 3, eventWeight: 1.3, marketGrowth: 0.95, vcGenerosity: 0.85 });
    expect(d.doomer).toMatchObject({ startCash: 0.5, rivalOffset: 6, eventWeight: 1.6, marketGrowth: 0.9, vcGenerosity: 0.7 });
  });
});

describe('every scenario', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name} creates a valid state and runs a year with the frontier bot`, () => {
      const s = createInitialState(SEED, NAME, setupFor(sc.id));
      expect(Number.isFinite(s.finance.cash)).toBe(true);
      expect(s.setup?.scenarioId).toBe(sc.id);
      const start = s.day;
      for (let d = 0; d < 365; d++) {
        botDay(s);
        if (isBlocked(s) && !s.gameOver) botDay(s);
        expect(isBlocked(s) && !s.gameOver, `${sc.id} blocked on day ${d}`).toBe(false);
        tick(s);
        if (s.gameOver) break;
      }
      expect(s.day > start || s.gameOver !== null).toBe(true);
    });
  }
});

describe('mid-era start (2022)', () => {
  const t0 = Date.now();
  const s = createInitialState(SEED, NAME, setupFor('late_2022'));
  const elapsed = Date.now() - t0;

  it('builds in under two seconds', () => {
    expect(elapsed).toBeLessThan(2000);
  });

  it('starts on 1 January 2022 with the chosen cash, staff and brand', () => {
    expect(calendarYear(s.day)).toBe(2022);
    expect(s.day).toBe(startDayOf(2022));
    expect(s.finance.cash).toBe(40_000_000);
    const staff = Object.values(s.staff.roles).reduce((a, r) => a + r.count, 0);
    expect(staff).toBe(12);
    expect(s.company.brand).toBe(20);
  });

  it('has rivals near the 2022 frontier', () => {
    const frontier = frontierQuality(2022);
    const tops = s.competitors.filter((c) => c.active && c.model).map((c) => c.model!.overall);
    expect(tops.length).toBeGreaterThanOrEqual(2);
    const best = Math.max(...tops);
    expect(best).toBeGreaterThan(frontier - 8);
    expect(best).toBeLessThan(frontier + 6);
  });

  it('has the ChatMoment already done', () => {
    expect('chatMoment' in s.flags).toBe(true);
    expect(s.flags['moment.chat_moment']).toBeDefined();
    expect(s.pendingMoment).toBeFalsy();
  });

  it('grants the research finished before 2022', () => {
    const due = RESEARCH.filter((n) => n.minYear < 2022).map((n) => n.id);
    expect(due.length).toBeGreaterThan(0);
    for (const id of due) expect(s.research.completed).toContain(id);
    expect(s.research.completed).not.toContain('agi');
  });

  it('starts with one evaluated, unreleased starter model near frontier minus 12', () => {
    expect(s.models.length).toBe(1);
    const m = s.models[0];
    expect(m.releasedDay).toBeNull();
    expect(Object.keys(m.benchRuns ?? {}).length).toBeGreaterThan(0);
    expect(m.overall).toBeGreaterThan(frontierQuality(2022) - 14);
    expect(m.overall).toBeLessThan(frontierQuality(2022) - 10);
  });

  it('is tutorial-free and goal-tracked', () => {
    expect(s.tutorialStep).toBe(-1);
    expect(s.goals?.map((g) => g.id)).toEqual(['arena_1']);
    expect(s.events.pending).toBeNull();
    expect(s.gameOver).toBeNull();
  });

  it('is deterministic from the seed', () => {
    // News ids come from a process-wide counter (util.ts noticeSeq), so they are left out of the comparison.
    const strip = (st: GameState) => JSON.stringify({ ...withoutSetup(st), news: st.news.map(({ id: _id, ...n }) => n), notifications: [] });
    const again = createInitialState(SEED, NAME, setupFor('late_2022'));
    expect(strip(again)).toBe(strip(s));
  });
});

describe('rules', () => {
  it('noVc: the funding offer never arrives, where the same company would get one', () => {
    const vc = createInitialState(SEED, NAME, setupFor('garage'));
    const noVc = createInitialState(SEED, NAME, setupFor('bootstrapped'));
    for (const st of [vc, noVc]) {
      st.finance.cash = 1000;
    }
    for (let d = 0; d < 3; d++) {
      tick(vc);
      tick(noVc);
    }
    expect(vc.finance.pendingOffer).not.toBeNull();
    expect(noVc.finance.pendingOffer).toBeNull();
    expect(noVc.finance.roundsRaised).toEqual(['Pre-seed']);
  });

  it('noIpo: the exchange refuses the sovereign lab even with a valuation', () => {
    const s = createInitialState(SEED, NAME, setupFor('sovereign'));
    s.finance.valuation = 10_000_000_000;
    s.stats.totalRevenue = 1e9;
    s.finance.dailyRevenue = 2_000_000;
    expect(canIpo(s).ok).toBe(false);
    expect(scenarioRule(s, 'noIpo')).toBe(true);
  });

  it('openOnly: the doctrine is locked and every release ships open', () => {
    const s = createInitialState(SEED, NAME, setupFor('open_collective'));
    expect(s.company.doctrine).toBe('open');
    dispatch(s, { type: 'setDoctrine', doctrine: 'frontier' });
    expect(s.company.doctrine).toBe('open');

    const donor = createInitialState(SEED, NAME, setupFor('late_2022')).models[0];
    const m: Model = { ...donor, id: 'open-test', releasedDay: null, releaseMode: undefined, benchRuns: undefined };
    s.models.push(m);
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full' });
    expect(m.releasedDay).not.toBeNull();
    expect(m.releaseMode).toBe('open');
  });

  it('trainingLockedUntilYear: pretraining is refused before 2020 and allowed after', () => {
    const s = createInitialState(SEED, NAME, setupFor('data_broker'));
    expect(trainingLockedNotice(s)).toMatch(/locked until 2020/);
    dispatch(s, { type: 'startTraining', name: 'Too early', paramsB: 1, tokensB: 10, datasetIds: [], techniques: [] });
    expect(s.training).toBeNull();
    s.day = startDayOf(2020);
    expect(trainingLockedNotice(s)).toBeNull();
  });

  it('a sandbox has no goals and never goes bankrupt', () => {
    const sb = createInitialState(SEED, NAME, setupFor('late_2022', { sandbox: true }));
    expect(sb.goals).toBeUndefined();
    const garage = createInitialState(SEED, NAME, setupFor('garage', { sandbox: true }));
    garage.finance.cash = -1e9;
    for (let d = 0; d < 40; d++) tick(garage);
    expect(garage.gameOver).toBeNull();
    expect(garage.finance.negativeCashDays).toBe(0);
  });

  it('without a sandbox the same debt is bankruptcy after 30 days', () => {
    const s = createInitialState(SEED, NAME, setupFor('garage'));
    s.finance.cash = -1e9;
    for (let d = 0; d < 40 && !s.gameOver; d++) tick(s);
    expect(s.gameOver).not.toBeNull();
  });

  it('government grant pays while reputation holds', () => {
    const s = createInitialState(SEED, NAME, setupFor('sovereign'));
    const before = s.stats.totalRevenue;
    for (let d = 0; d < 30; d++) tick(s);
    expect(s.stats.totalRevenue - before).toBeGreaterThanOrEqual(2_900_000);
  });
});

describe('difficulty', () => {
  it('changes start cash', () => {
    const intern = createInitialState(SEED, NAME, setupFor('garage', { difficulty: 'intern' }));
    const founder = createInitialState(SEED, NAME, setupFor('garage'));
    const doomer = createInitialState(SEED, NAME, setupFor('garage', { difficulty: 'doomer' }));
    expect(intern.finance.cash).toBe(founder.finance.cash * 2);
    expect(doomer.finance.cash).toBe(founder.finance.cash * 0.5);
  });

  it('changes the rival quality offset and event weights', () => {
    const intern = createInitialState(SEED, NAME, setupFor('garage', { difficulty: 'intern' }));
    const doomer = createInitialState(SEED, NAME, setupFor('garage', { difficulty: 'doomer' }));
    expect(rivalQualityOffset(intern)).toBe(-4);
    expect(rivalQualityOffset(doomer)).toBe(6);
    expect(eventWeightMult(intern, 'any')).toBe(0.6);
    expect(eventWeightMult(doomer, 'any')).toBe(1.6);
  });

  it('a harder difficulty gives rivals a better release on average', () => {
    const mean = (diff: GameSetup['difficulty']) => {
      const s = createInitialState(SEED, NAME, setupFor('sovereign', { difficulty: diff }));
      for (let d = 0; d < 400; d++) tick(s);
      const overalls = s.competitors.filter((c) => c.active && c.model).map((c) => c.model!.overall);
      return overalls.reduce((a, b) => a + b, 0) / Math.max(1, overalls.length);
    };
    expect(mean('doomer')).toBeGreaterThan(mean('intern') + 3);
  });
});

describe('goals', () => {
  it('meeting every goal fires the victory takeover', () => {
    const s = createInitialState(SEED, NAME, setupFor('agi_speedrun'));
    expect(s.goals?.length).toBe(1);
    s.research.completed.push('agi');
    tick(s);
    expect(s.goals?.[0].doneDay).not.toBeNull();
    expect(s.pendingMoment?.id).toBe('scenario_won');
    expect(s.pendingMoment?.tone).toBe('triumph');
    expect(s.pendingMoment?.stats.find((x) => x.label === 'Score')).toBeDefined();
  });

  it('missing a deadline fires the loss takeover and turns the game into a sandbox', () => {
    const s = createInitialState(SEED, NAME, setupFor('agi_speedrun'));
    s.day = startDayOf(2032);
    tick(s);
    expect(s.goals?.[0].failedDay).not.toBeNull();
    expect(s.goals?.[0].missed).toBe(true);
    expect(s.pendingMoment?.id).toBe('scenario_lost');
    expect(s.pendingMoment?.title).toMatch(/^Goal missed: /);
    expect(s.flags['scenario.sandbox']).toBeDefined();
    // Once a sandbox, the game does not go bankrupt.
    s.pendingMoment = null;
    s.finance.cash = -1e9;
    for (let d = 0; d < 40; d++) tick(s);
    expect(s.gameOver).toBeNull();
  });

  it('data sales count towards the data broker goal', () => {
    const s = createInitialState(SEED, NAME, setupFor('data_broker'));
    s.finance.today.revenue.data = 12_000_000;
    scenarioTick(s, makeRng(s));
    expect(s.flags['scenario.dataSales']).toBe(12_000_000);
  });

  it('scores faster and harder wins higher', () => {
    const s = createInitialState(SEED, NAME, setupFor('agi_speedrun'));
    const fast = scenarioScore(s).score;
    s.day += 3000;
    expect(scenarioScore(s).score).toBeLessThan(fast);
    const hard = createInitialState(SEED, NAME, setupFor('agi_speedrun', { difficulty: 'doomer' }));
    expect(scenarioScore(hard).score).toBeGreaterThan(fast);
  });

  it('a 2022 arena goal reads the leaderboard', () => {
    const s = createInitialState(SEED, NAME, setupFor('late_2022'));
    expect(arenaLeaderboard(s).some((r) => r.isPlayer)).toBe(false);
    expect(yearOf(s.day)).toBeGreaterThan(2021);
  });
});
