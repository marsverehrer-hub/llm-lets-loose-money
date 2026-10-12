import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import { botDay } from '../scripts/bot';
import {
  ATTACKS,
  applyRivalAttack,
  applyRivalSnapshot,
  attackCost,
  attackStatus,
  buildSnapshot,
  crownTable,
  handlers,
  matchDaysLeft,
  mpReceiveChat,
  mpSetConnected,
  mpTick,
  startMpState,
} from '../src/sim/systems/multiplayer';
import { arenaLeaderboard } from '../src/sim/systems/competitors';
import { segmentShares } from '../src/sim/systems/market';
import { MP_RIVAL_ID, type CompetitorModel, type GameState, type RivalAttack, type RivalSnapshot, type TrainingRun } from '../src/sim/types';

const ROOM = 'ABCDEF';
// v7 (COMP): seed 2024 now hits the bot's day-60 cash cliff (see the balance notes). Seed 2025 survives two years, and
// these tests check snapshots and the rival, not the economy.
const SEED = 2025;

function newMatch(role: 'host' | 'guest', lengthYears: number | null, seed = SEED): GameState {
  const s = createInitialState(seed, role === 'host' ? 'Host Labs' : 'Guest Labs');
  startMpState(s, { role, room: ROOM, settings: { lengthYears }, myColor: role === 'host' ? '#3fb6a8' : '#e0a040' });
  mpSetConnected(s, true);
  return s;
}

function fakeModel(name: string, overall: number): CompetitorModel {
  return {
    name,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + overall * 8,
    releasedDay: 0,
  };
}

/** Route everything a side queued in its outbox to the other side. */
function route(from: GameState, to: GameState): void {
  const mp = from.mp!;
  for (const msg of mp.outbox) {
    if (msg.t === 'attack') applyRivalAttack(to, msg.attack);
    else mpReceiveChat(to, msg.text);
  }
  mp.outbox.length = 0;
}

/** Both sims advance one day, the bot plays both, messages are routed, snapshots exchanged every 3 days. */
function playDays(h: GameState, g: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    if (h.mp!.result || g.mp!.result) break;
    botDay(h);
    botDay(g);
    tick(h);
    tick(g);
    mpTick(h, makeRng(h));
    mpTick(g, makeRng(g));
    route(h, g);
    route(g, h);
    if (h.day % 3 === 0) {
      applyRivalSnapshot(g, buildSnapshot(h));
      applyRivalSnapshot(h, buildSnapshot(g));
    }
  }
}

function attack(s: GameState, kind: 'poach' | 'smear' | 'leak' | 'undercut'): void {
  handlers.mpAttack!(s, { type: 'mpAttack', kind }, makeRng(s));
}

describe('two bot-driven sims over the network', () => {
  it('exchange snapshots for about two years and each side sees the rival', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    playDays(h, g, 2 * 365);

    expect(h.mp!.result).toBeNull();
    expect(g.mp!.result).toBeNull();
    expect(h.mp!.rival).not.toBeNull();
    expect(g.mp!.rival).not.toBeNull();
    expect(h.mp!.rivalDay).toBeGreaterThanOrEqual(h.day - 2);
    expect(h.mp!.history.length).toBeGreaterThan(100);

    // Our rival entry mirrors their snapshot, and it's excluded from AI release logic (no def in COMPETITORS).
    const entry = h.competitors.find((c) => c.id === MP_RIVAL_ID)!;
    expect(entry.human).toBe(true);
    expect(entry.active).toBe(true);
    expect(entry.model?.name).toBe(h.mp!.rival!.model?.name);

    // The rival appears in the arena and in market shares once it has a released model and an API product.
    expect(h.mp!.rival!.model).not.toBeNull();
    expect(h.mp!.rival!.prices.api).toBeDefined();
    const arena = arenaLeaderboard(h);
    expect(arena.some((r) => r.id === MP_RIVAL_ID && r.name === 'Guest Labs' && r.color === '#e0a040')).toBe(true);
    const dev = segmentShares(h, 'developer');
    expect(dev.some((r) => r.id === MP_RIVAL_ID && !r.isPlayer)).toBe(true);

    // Crown table covers every benchmark introduced so far, with valid leaders.
    const crowns = crownTable(h);
    expect(crowns.length).toBeGreaterThan(0);
    for (const row of crowns) expect(['me', 'rival', 'tie', 'none']).toContain(row.leader);
  }, 120_000);
});

describe('snapshot and rival competitor', () => {
  it('startMpState adds a rival entry with no prices and no model', () => {
    const s = newMatch('host', 5);
    const entry = s.competitors.find((c) => c.id === MP_RIVAL_ID)!;
    expect(entry).toBeDefined();
    expect(entry.human).toBe(true);
    expect(entry.model).toBeNull();
    expect(entry.prices.api).toBe(Infinity);
    expect(entry.nextReleaseDay).toBeGreaterThan(1e8);
  });

  it('kinds the rival does not offer are skipped by the market', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    const snap: RivalSnapshot = { ...buildSnapshot(g), model: fakeModel('Rival-1', 70), prices: { chat: 20 } };
    applyRivalSnapshot(h, snap);
    expect(segmentShares(h, 'developer').some((r) => r.id === MP_RIVAL_ID)).toBe(false);
    expect(segmentShares(h, 'enterprise').some((r) => r.id === MP_RIVAL_ID)).toBe(false);
  });

  it('a rival without a model does not appear in shares or the arena', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    applyRivalSnapshot(h, buildSnapshot(g));
    expect(segmentShares(h, 'developer').some((r) => r.id === MP_RIVAL_ID)).toBe(false);
    expect(arenaLeaderboard(h).some((r) => r.id === MP_RIVAL_ID)).toBe(false);
  });

  it('a new model name logs a news line and a log line', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    applyRivalSnapshot(h, { ...buildSnapshot(g), model: fakeModel('Rival-1', 70) });
    expect(h.news.some((n) => n.text.includes('ships Rival-1 (overall 70)'))).toBe(true);
    expect(h.mp!.log.some((l) => l.kind === 'rival' && l.text.includes('ships Rival-1'))).toBe(true);
    // Same name again is not news.
    const before = h.news.length;
    applyRivalSnapshot(h, { ...buildSnapshot(g), model: fakeModel('Rival-1', 71) });
    expect(h.news.length).toBe(before);
  });

  it('crown lead changes are logged for each side', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    // Give the host a released model that scores well on SQuAD (introduced in 2016, so active in 2017).
    h.models.push({
      id: 'm1', name: 'Host-1', paramsB: 7, tokensB: 300, datasetIds: [], techniques: [], finalLoss: 2, overall: 95,
      scores: { reasoning: 95, coding: 95, chat: 95, safety: 95 }, elo: 1560, trainedDay: 0, releasedDay: 0, deprecated: false,
      benchmarks: { squad: 99 },
    });
    applyRivalSnapshot(h, { ...buildSnapshot(g), model: { ...fakeModel('Rival-1', 60), benchmarks: { squad: 10 } } });
    expect(h.flags['mpCrown:squad']).toBe(1);
    expect(h.mp!.log.some((l) => l.kind === 'me' && l.text === 'You take the crown on SQuAD.')).toBe(true);
    // The rival takes it back.
    applyRivalSnapshot(h, { ...buildSnapshot(g), model: { ...fakeModel('Rival-2', 80), benchmarks: { squad: 100 } } });
    expect(h.flags['mpCrown:squad']).toBe(-1);
    expect(h.mp!.log.some((l) => l.kind === 'rival' && l.text === 'Guest Labs takes the crown on SQuAD.')).toBe(true);
  });
});

describe('attacks', () => {
  function pair(): { a: GameState; b: GameState } {
    const a = newMatch('host', null);
    const b = newMatch('guest', null);
    applyRivalSnapshot(a, buildSnapshot(b));
    applyRivalSnapshot(b, buildSnapshot(a));
    a.finance.cash = 1e10;
    b.finance.cash = 1e10;
    return { a, b };
  }

  it('costs scale with the year and the attacker must have the cash', () => {
    const { a } = pair();
    const c2017 = attackCost(a, 'poach');
    expect(c2017).toBeCloseTo(ATTACKS.poach.baseCost * 0.5, 0);
    a.day = 365 * 9;
    expect(attackCost(a, 'poach')).toBeGreaterThan(c2017 * 4);
    a.finance.cash = 1;
    expect(attackStatus(a, 'poach').ok).toBe(false);
  });

  it('poach removes about 8% of researchers and engineers (at least 1), morale -6, halved above 75', () => {
    const { a, b } = pair();
    b.staff.roles.researcher.count = 10;
    b.staff.roles.engineer.count = 5;
    b.staff.morale = 80;
    const cashBefore = a.finance.cash;
    attack(a, 'poach');
    expect(a.finance.cash).toBeCloseTo(cashBefore - attackCost(a, 'poach'), 0);
    const sent = a.mp!.outbox.at(-1)!;
    expect(sent.t).toBe('attack');
    const atk = (sent as { t: 'attack'; attack: RivalAttack }).attack;
    expect(atk.kind).toBe('poach');
    expect(atk.from).toBe('Host Labs');
    a.mp!.outbox.length = 0;

    applyRivalAttack(b, atk);
    // 15 people: 8% = 1.2, rounds to 1.
    expect(b.staff.roles.researcher.count + b.staff.roles.engineer.count).toBe(14);
    expect(b.staff.morale).toBeCloseTo(77, 5); // 80 is above 75, so the -6 is halved to -3
    expect(b.notifications.some((n) => n.kind === 'bad')).toBe(true);
    expect(b.mp!.log.some((l) => l.kind === 'rival')).toBe(true);
  });

  it('poach takes at least one person and the full -6 morale below 75', () => {
    const { b } = pair();
    b.staff.roles.researcher.count = 1;
    b.staff.roles.engineer.count = 0;
    b.staff.morale = 50;
    applyRivalAttack(b, { kind: 'poach', day: 0, from: 'Rival' });
    expect(b.staff.roles.researcher.count).toBe(0);
    expect(b.staff.morale).toBeCloseTo(44, 5);
  });

  it('smear drops hype by 15 and reputation by 4, and makes news', () => {
    const { a, b } = pair();
    b.company.hype = 50;
    b.company.reputation = 60;
    attack(a, 'smear');
    const sent = a.mp!.outbox.at(-1) as { t: 'attack'; attack: RivalAttack };
    expect(sent.t).toBe('attack');
    applyRivalAttack(b, sent.attack);
    expect(b.company.hype).toBe(35);
    expect(b.company.reputation).toBe(56);
    expect(b.news.some((n) => n.text.includes('trains on dolphins'))).toBe(true);
  });

  it('leak cuts the training run by 10% if there is one, else research progress by 25%, and reputation by 2', () => {
    const { b } = pair();
    b.company.reputation = 60;
    b.research.progress = 40;
    b.training = { doneFlops: 1000 } as unknown as TrainingRun;
    applyRivalAttack(b, { kind: 'leak', day: 0, from: 'Rival' });
    expect(b.training.doneFlops).toBeCloseTo(900, 5);
    expect(b.research.progress).toBe(40);
    expect(b.company.reputation).toBe(58);

    b.training = null;
    applyRivalAttack(b, { kind: 'leak', day: 0, from: 'Rival' });
    expect(b.research.progress).toBeCloseTo(30, 5);
  });

  it('undercut makes the rival 15% cheaper in our market for 30 days', () => {
    const { b, a } = pair();
    applyRivalSnapshot(b, { ...buildSnapshot(a), model: fakeModel('Rival-1', 70), prices: { api: 10, chat: 20, enterprise: 60 } });
    const priceOf = () => segmentShares(b, 'developer').find((r) => r.id === MP_RIVAL_ID)!.price;
    expect(priceOf()).toBeCloseTo(10, 5);
    applyRivalAttack(b, { kind: 'undercut', day: 0, from: 'Rival' });
    expect(b.flags['mpUndercutUntil']).toBe(b.day + 30);
    expect(priceOf()).toBeCloseTo(8.5, 5);
    b.day += 30;
    expect(priceOf()).toBeCloseTo(10, 5);
  });

  it('each attack goes on cooldown for its own length, and cooldown blocks a repeat', () => {
    const { a } = pair();
    attack(a, 'undercut');
    expect(a.mp!.cooldowns.undercut).toBe(a.day + ATTACKS.undercut.cooldownDays);
    const outboxLen = a.mp!.outbox.length;
    const cashAfter = a.finance.cash;
    const status = attackStatus(a, 'undercut');
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/cooldown/i);
    attack(a, 'undercut');
    expect(a.mp!.outbox.length).toBe(outboxLen);
    expect(a.finance.cash).toBe(cashAfter);

    // A different kind is still available.
    expect(attackStatus(a, 'smear').ok).toBe(true);

    a.day = a.mp!.cooldowns.undercut!;
    expect(attackStatus(a, 'undercut').ok).toBe(true);
  });

  it('attacks are refused until the rival is connected and has reported', () => {
    const a = newMatch('host', null);
    a.finance.cash = 1e10;
    expect(attackStatus(a, 'smear').ok).toBe(false);
    mpSetConnected(a, false);
    applyRivalSnapshot(a, buildSnapshot(newMatch('guest', null)));
    expect(attackStatus(a, 'smear').ok).toBe(false);
    mpSetConnected(a, true);
    expect(attackStatus(a, 'smear').ok).toBe(true);
  });
});

describe('exclusive data conflicts', () => {
  const SET = 'news_publisher_coalition'; // exclusive partnership, annual fee $15M

  it('the host keeps a contested exclusive, the guest loses it and gets the first-year fee back once', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    h.data.owned.push(SET);
    g.data.owned.push(SET);
    g.data.licenses = { [SET]: 0 };

    // Guest's snapshot reaches the host: the host keeps its copy.
    applyRivalSnapshot(h, buildSnapshot(g));
    expect(h.data.owned).toContain(SET);
    expect(h.data.lost).toContain(SET);

    // Host's snapshot reaches the guest: the guest loses the set and is refunded.
    const cashBefore = g.finance.cash;
    applyRivalSnapshot(g, buildSnapshot(h));
    expect(g.data.owned).not.toContain(SET);
    expect(g.data.lost).toContain(SET);
    expect(g.finance.cash - cashBefore).toBeCloseTo(15_000_000, 0);
    expect(g.data.licenses?.[SET]).toBeUndefined();

    // Another snapshot does not refund twice.
    const cashAfter = g.finance.cash;
    applyRivalSnapshot(g, buildSnapshot(h));
    expect(g.finance.cash).toBe(cashAfter);
  });

  it('a rival signing a set we never owned just marks it lost', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    g.data.owned.push(SET);
    const cash = h.finance.cash;
    applyRivalSnapshot(h, buildSnapshot(g));
    expect(h.data.lost).toContain(SET);
    expect(h.finance.cash).toBe(cash);
  });
});

describe('match end', () => {
  it('ends at 1 Jan of the chosen year, higher valuation wins', () => {
    const h = newMatch('host', 1);
    const g = newMatch('guest', 1);
    expect(matchDaysLeft(h)).toBe(365);
    expect(matchDaysLeft(newMatch('host', null))).toBeNull();

    applyRivalSnapshot(h, { ...buildSnapshot(g), valuation: 1e9 });
    h.finance.valuation = 2e9;
    h.day = 364;
    mpTick(h, makeRng(h));
    expect(h.mp!.result).toBeNull();
    h.day = 365;
    mpTick(h, makeRng(h));
    expect(h.mp!.result?.winner).toBe('me');
    expect(h.mp!.result?.reason).toMatch(/Match length/);
    expect(matchDaysLeft(h)).toBe(0);
  });

  it('valuations within 1% are a draw', () => {
    const h = newMatch('host', 1);
    const g = newMatch('guest', 1);
    applyRivalSnapshot(h, { ...buildSnapshot(g), valuation: 1_000_000_000 });
    h.finance.valuation = 1_005_000_000;
    h.day = 365;
    mpTick(h, makeRng(h));
    expect(h.mp!.result?.winner).toBe('draw');
  });

  it('a disconnected sim does not end the match on length', () => {
    const h = newMatch('host', 1);
    mpSetConnected(h, false);
    h.day = 400;
    mpTick(h, makeRng(h));
    expect(h.mp!.result).toBeNull();
  });

  it('our own bankruptcy means the rival wins', () => {
    const h = newMatch('host', null);
    h.gameOver = { reason: 'Out of cash', day: 10 };
    mpTick(h, makeRng(h));
    expect(h.mp!.result?.winner).toBe('rival');
  });

  it('the rival going bankrupt means we win', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    applyRivalSnapshot(h, { ...buildSnapshot(g), bankrupt: true });
    mpTick(h, makeRng(h));
    expect(h.mp!.result).toMatchObject({ winner: 'me', reason: 'Rival went bankrupt' });
  });

  it('conceding makes the rival the winner, and the other side sees it too', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    handlers.mpConcede!(h, { type: 'mpConcede' }, makeRng(h));
    expect(h.mp!.result?.winner).toBe('rival');
    const msg = h.mp!.outbox.at(-1)!;
    expect(msg).toEqual({ t: 'chat', text: 'Host Labs concedes.' });
    route(h, g);
    expect(g.mp!.result?.winner).toBe('me');
    expect(g.mp!.result?.reason).toBe('Rival conceded');
    // Once the match is over, a second concede does nothing.
    const n = h.mp!.outbox.length;
    handlers.mpConcede!(h, { type: 'mpConcede' }, makeRng(h));
    expect(h.mp!.outbox.length).toBe(n);
  });

  it('the store is paused by result and attacks are refused after it', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    applyRivalSnapshot(h, buildSnapshot(g));
    handlers.mpConcede!(h, { type: 'mpConcede' }, makeRng(h));
    expect(attackStatus(h, 'smear').ok).toBe(false);
  });
});

describe('chat', () => {
  it('trims to 200 characters, goes to the outbox and the log, and is received on the other side', () => {
    const h = newMatch('host', null);
    const g = newMatch('guest', null);
    applyRivalSnapshot(g, buildSnapshot(h));
    handlers.mpChat!(h, { type: 'mpChat', text: `  ${'x'.repeat(250)}  ` }, makeRng(h));
    const msg = h.mp!.outbox.at(-1)!;
    expect(msg.t).toBe('chat');
    expect((msg as { text: string }).text.length).toBe(200);
    expect(h.mp!.log.at(-1)!.kind).toBe('chat');
    route(h, g);
    expect(g.mp!.log.at(-1)!.text.startsWith('Host Labs: xxx')).toBe(true);
  });

  it('empty chat is ignored and concession-shaped text cannot be typed', () => {
    const h = newMatch('host', null);
    const n = h.mp!.log.length;
    handlers.mpChat!(h, { type: 'mpChat', text: '   ' }, makeRng(h));
    expect(h.mp!.outbox.length).toBe(0);
    handlers.mpChat!(h, { type: 'mpChat', text: 'Host Labs concedes.' }, makeRng(h));
    expect(h.mp!.outbox.length).toBe(0);
    expect(h.mp!.log.length).toBe(n);
    expect(h.mp!.result).toBeNull();
  });

  it('handlers are no-ops outside a multiplayer match', () => {
    const s = createInitialState(5, 'Solo');
    const rng = makeRng(s);
    handlers.mpAttack!(s, { type: 'mpAttack', kind: 'smear' }, rng);
    handlers.mpChat!(s, { type: 'mpChat', text: 'hi' }, rng);
    handlers.mpConcede!(s, { type: 'mpConcede' }, rng);
    expect(s.mp).toBeUndefined();
    expect(s.competitors.some((c) => c.id === MP_RIVAL_ID)).toBe(false);
  });
});
