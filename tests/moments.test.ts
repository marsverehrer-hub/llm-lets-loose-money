import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import { momentsTick } from '../src/sim/systems/moments';
import { BENCHMARKS } from '../src/sim/data/benchmarks';
import { COMPETITORS } from '../src/sim/data/competitors';
import { botDay } from '../scripts/bot';
import type { CompetitorModel, GameState, Model, Moment, Product } from '../src/sim/types';

const RIVAL = COMPETITORS[0].id;

let seq = 0;
function model(overall: number, extra: Partial<Model> = {}): Model {
  seq += 1;
  return {
    id: `m${seq}`,
    name: `Test-${overall}`,
    paramsB: 7,
    tokensB: 300,
    datasetIds: [],
    techniques: [],
    finalLoss: 2.1,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + overall * 8,
    trainedDay: 0,
    releasedDay: 0,
    deprecated: false,
    ...extra,
  };
}

function rivalModel(overall: number, extra: Partial<CompetitorModel> = {}): CompetitorModel {
  return {
    name: `Rival-${overall}`,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + overall * 8,
    releasedDay: 0,
    ...extra,
  };
}

function product(s: GameState, extra: Partial<Product> = {}): Product {
  return {
    id: `p${s.products.length + 1}`,
    kind: 'api',
    name: 'Test API',
    modelId: null,
    price: 30,
    users: 10,
    launchedDay: s.day,
    satisfaction: 70,
    servedFraction: 1,
    mtokPerDay: 1,
    revenuePerDay: 100,
    active: true,
    ...extra,
  };
}

/** A game past its init tick. The first momentsTick seeds beats that are already true (none, at day 0). */
function freshState(): GameState {
  const s = createInitialState(42, 'Test Labs');
  momentsTick(s, makeRng(s));
  return s;
}

/** Runs momentsTick, dismisses each takeover it raises and jumps past the cooldown. Returns the moments shown. */
function drainMoments(s: GameState): Moment[] {
  const out: Moment[] = [];
  for (let i = 0; i < 30; i++) {
    s.day += 8;
    momentsTick(s, makeRng(s));
    if (!s.pendingMoment) break;
    out.push(s.pendingMoment);
    dispatch(s, { type: 'dismissMoment' });
  }
  return out;
}
const drain = (s: GameState): string[] => drainMoments(s).map((m) => m.id);

function setRival(s: GameState, id: string, m: CompetitorModel | null, human = false): void {
  const c = s.competitors.find((x) => x.id === id)!;
  c.active = true;
  c.model = m;
  if (human) c.human = true;
}

describe('moments: each beat fires once', () => {
  it('first model trained', () => {
    const s = freshState();
    s.stats.modelsTrained = 1;
    s.models.push(model(40, { trainedDay: s.day }));
    expect(drain(s)).toEqual(['first_model']);
    expect(s.flags['moment.first_model']).toBeDefined();
    expect(drain(s)).toEqual([]);
  });

  it('first product launch', () => {
    const s = freshState();
    s.products.push(product(s));
    expect(drain(s)).toEqual(['first_product']);
    expect(drain(s)).toEqual([]);
  });

  it('first time Arena #1 needs a rival on the board', () => {
    const s = freshState();
    s.models.push(model(70));
    expect(drain(s)).toEqual([]); // number one of one is not a contest
    setRival(s, RIVAL, rivalModel(40));
    const ids = drain(s);
    expect(ids.filter((x) => x === 'first_arena_1')).toHaveLength(1);
    expect(drain(s)).toEqual([]);
  });

  it('chatbot moment: a rival launches first, and it is a smaller beat', () => {
    const s = freshState();
    setRival(s, RIVAL, rivalModel(40));
    s.flags.chatMoment = s.day;
    const shown = drainMoments(s);
    expect(shown.map((m) => m.id)).toEqual(['chat_moment']);
    expect(shown[0].tone).toBe('milestone');
    expect(drain(s)).toEqual([]);
  });

  it('chatbot moment: yours is a triumph, with more hype', () => {
    const s = freshState();
    s.models.push(model(40));
    s.flags['moment.first_product'] = 0; // a product beat was shown earlier; isolate the chat beat
    s.flags.chatMoment = s.day;
    s.products.push(product(s, { kind: 'chat', price: 20, launchedDay: s.day }));
    s.company.hype = 20;
    momentsTick(s, makeRng(s));
    expect(s.pendingMoment?.id).toBe('chat_moment');
    expect(s.pendingMoment?.tone).toBe('triumph');
    expect(s.company.hype).toBe(30);
  });

  it('first $1M a year of revenue', () => {
    const s = freshState();
    s.finance.dailyRevenue = 3000; // 1.095M annualised
    expect(drain(s)).toEqual(['arr_1m']);
    expect(drain(s)).toEqual([]);
  });

  it('first unannounced SOTA, confirmed public at release', () => {
    const s = freshState();
    const bench = BENCHMARKS[0].id;
    setRival(s, RIVAL, rivalModel(30, { benchmarks: { [bench]: 50 } }));
    s.models.push(model(60, { benchmarks: { [bench]: 60 }, benchRuns: { [bench]: { day: s.day, score: 61 } } }));
    const ids = drain(s);
    expect(ids.filter((x) => x === 'first_sota')).toHaveLength(1);
    expect(drain(s)).toEqual([]);
  });

  it('no SOTA when the benchmark was never beaten in the vault', () => {
    const s = freshState();
    const bench = BENCHMARKS[0].id;
    setRival(s, RIVAL, rivalModel(30, { benchmarks: { [bench]: 50 } }));
    s.models.push(model(40, { benchmarks: { [bench]: 45 }, benchRuns: { [bench]: { day: s.day, score: 45 } } }));
    expect(drain(s)).not.toContain('first_sota');
  });

  it('beating a lab flagship fires once per lab', () => {
    const s = freshState();
    setRival(s, RIVAL, rivalModel(30));
    s.models.push(model(50));
    const ids = drain(s);
    expect(ids.filter((x) => x === `beat_lab.${RIVAL}`)).toHaveLength(1);
    expect(s.flags[`moment.beat_lab.${RIVAL}`]).toBeDefined();
    expect(drain(s)).toEqual([]);
  });

  it('beating a human rival does not count as a flagship beat', () => {
    const s = freshState();
    setRival(s, RIVAL, rivalModel(30), true);
    s.models.push(model(50));
    expect(drain(s)).not.toContain(`beat_lab.${RIVAL}`);
  });

  it('IPO', () => {
    const s = freshState();
    s.company.isPublic = true;
    expect(drain(s)).toEqual(['ipo']);
    expect(drain(s)).toEqual([]);
  });

  it('$1T valuation', () => {
    const s = freshState();
    s.finance.valuation = 1.2e12;
    expect(drain(s)).toEqual(['valuation_1t']);
    expect(drain(s)).toEqual([]);
  });

  it('losing #1 after 90+ days is a loss, and costs hype', () => {
    const s = freshState();
    setRival(s, RIVAL, rivalModel(30));
    s.models.push(model(70));
    // Arena #1 and the flagship beat both fire as we take the top.
    expect(drain(s)).toEqual(['first_arena_1', `beat_lab.${RIVAL}`]);
    // The reign runs 100 days, then the rival passes us.
    s.day += 100;
    momentsTick(s, makeRng(s));
    const rv = s.competitors.find((x) => x.id === RIVAL)!;
    rv.model = rivalModel(95, { elo: 2000 });
    s.company.hype = 50;
    s.day += 8;
    momentsTick(s, makeRng(s));
    expect(s.pendingMoment?.id).toBe('lost_arena_1');
    expect(s.pendingMoment?.tone).toBe('loss');
    expect(s.company.hype).toBe(45);
  });

  it('a short reign at #1 does not count as a loss', () => {
    const s = freshState();
    setRival(s, RIVAL, rivalModel(30));
    s.models.push(model(70));
    expect(drain(s)).toEqual(['first_arena_1', `beat_lab.${RIVAL}`]); // reign starts
    s.day += 30;
    const rv = s.competitors.find((x) => x.id === RIVAL)!;
    rv.model = rivalModel(95, { elo: 2000 });
    s.day += 8;
    momentsTick(s, makeRng(s));
    expect(s.pendingMoment).toBeNull();
    expect(drain(s)).not.toContain('lost_arena_1');
  });
});

describe('moments: queueing and cooldown', () => {
  it('one takeover at a time: a second earned beat waits until the first is dismissed', () => {
    const s = freshState();
    s.stats.modelsTrained = 1;
    s.models.push(model(40, { trainedDay: s.day }));
    s.products.push(product(s));
    s.day += 8;
    momentsTick(s, makeRng(s));
    expect(s.pendingMoment?.id).toBe('first_model');
    // Still blocked: the second beat must not be set, and the first must not be replaced.
    momentsTick(s, makeRng(s));
    expect(s.pendingMoment?.id).toBe('first_model');
    expect(s.flags['moment.first_product']).toBeUndefined();
    expect(isBlocked(s)).toBe(true);
    dispatch(s, { type: 'dismissMoment' });
    expect(s.pendingMoment).toBeNull();
  });

  it('extra beats fire on later days, with a gap between takeovers', () => {
    const s = freshState();
    s.stats.modelsTrained = 1;
    s.models.push(model(40, { trainedDay: s.day }));
    s.products.push(product(s));
    const fireDays: number[] = [];
    for (let i = 0; i < 40 && fireDays.length < 2; i++) {
      s.day += 1;
      momentsTick(s, makeRng(s));
      if (s.pendingMoment) {
        fireDays.push(s.day);
        dispatch(s, { type: 'dismissMoment' });
      }
    }
    expect(fireDays).toHaveLength(2);
    expect(fireDays[1] - fireDays[0]).toBeGreaterThanOrEqual(7);
  });

  it('a pending takeover blocks the sim', () => {
    const s = freshState();
    s.pendingMoment = { id: 'x', title: 'x', subtitle: 'x', stats: [], tone: 'triumph', day: s.day };
    const before = s.day;
    tick(s);
    expect(s.day).toBe(before);
  });
});

describe('moments: init seeding for loaded saves', () => {
  it('beats already true in an old save are marked shown, without a takeover', () => {
    const s = createInitialState(42, 'Old Save');
    // An old save: models trained, a product live, a rival already beaten, public, $1T. None of it is shown.
    s.stats.modelsTrained = 3;
    s.models.push(model(70));
    s.products.push(product(s));
    setRival(s, RIVAL, rivalModel(30));
    s.company.isPublic = true;
    s.finance.valuation = 2e12;
    expect(s.flags['moments.init']).toBeUndefined();

    momentsTick(s, makeRng(s));
    expect(s.pendingMoment).toBeFalsy();
    expect(s.flags['moments.init']).toBeDefined();
    for (const id of ['first_model', 'first_product', 'first_arena_1', 'ipo', 'valuation_1t', `beat_lab.${RIVAL}`]) {
      expect(s.flags[`moment.${id}`]).toBeDefined();
    }
    // Nothing old fires later either.
    expect(drain(s)).toEqual([]);
    // New progress still fires.
    s.finance.dailyRevenue = 3000;
    expect(drain(s)).toEqual(['arr_1m']);
  });
});

describe('moments: bot run', () => {
  it('a 3-year bot run sees at least 4 moments and never stays blocked', () => {
    // Seed 8: seed 7 meets a day-30 lawsuit it cannot afford to fight at its starting cash and goes broke on day 60.
    const s = createInitialState(8, 'BotCorp');
    for (let d = 0; d < 3 * 365 && !s.gameOver; d++) {
      botDay(s);
      expect(isBlocked(s)).toBe(false);
      const before = s.day;
      tick(s);
      expect(s.day).toBe(before + 1);
    }
    const seen = Object.keys(s.flags).filter((k) => k.startsWith('moment.'));
    expect(seen.length).toBeGreaterThanOrEqual(4);
  }, 180_000);
});
