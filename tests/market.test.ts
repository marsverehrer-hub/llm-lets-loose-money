import { describe, expect, it } from 'vitest';
import { play } from '../scripts/bot';
import { apply, check } from '../src/sim/apply';
import { endWeek } from '../src/sim/endWeek';
import { newGame } from '../src/sim/state';
import { floatOf, heldOf, netWorth, richList, sharesOf, stake } from '../src/sim/stock';
import type { GameState } from '../src/sim/types';

const weeks = (s: GameState, n: number): GameState => {
  for (let i = 0; i < n; i++) {
    while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
    const d = s.deals.find((x) => x.target === s.labId && x.playerTenders === null);
    if (d) s = apply(s, { t: 'defend', deal: d.id, choice: 'refuse' });
    s = endWeek(s);
  }
  return s;
};
const sane = (s: GameState): void => {
  for (const c of Object.values(s.companies)) {
    expect(Number.isFinite(c.price) && c.price > 0, `${c.id} price`).toBe(true);
    expect(heldOf(s, c.id), `${c.id} holdings`).toBeLessThanOrEqual(c.shares + 1);
  }
  for (const h of s.holdings) expect(s.companies[h.company], `holding in ${h.company}`).toBeTruthy();
  for (const a of Object.values(s.actors)) expect(Number.isFinite(netWorth(s, a.id))).toBe(true);
};

describe('trading', () => {
  it('moves cash and shares, and a round trip loses money', () => {
    const s0 = newGame(1);
    s0.actors.you.cash = 50e6;
    const n = Math.round(0.02 * s0.companies.openaye.shares);
    const s1 = apply(s0, { t: 'trade', company: 'openaye', shares: n });
    expect(sharesOf(s1, 'you', 'openaye')).toBe(n);
    expect(s1.actors.you.cash).toBeLessThan(s0.actors.you.cash);
    expect(s1.companies.openaye.price).toBeGreaterThan(s0.companies.openaye.price);
    const s3 = apply(s1, { t: 'trade', company: 'openaye', shares: -n });
    expect(sharesOf(s3, 'you', 'openaye')).toBe(0);
    expect(s3.actors.you.cash).toBeLessThan(s0.actors.you.cash);
  });

  it('caps a week at 5% of a company and refuses what you cannot pay for', () => {
    const s = newGame(1);
    expect(check(s, { t: 'trade', company: 'deepmined', shares: 0.01 * s.companies.deepmined.shares })).toMatch(/cash/);
    s.actors.you.cash = 1e12;
    expect(check(s, { t: 'trade', company: 'deepmined', shares: 0.06 * s.companies.deepmined.shares })).toMatch(/5%/);
  });

  it('files trades in the lab you run and fills them a week later', () => {
    const s0 = newGame(1);
    s0.actors.you.cash = 50e6;
    const n = Math.round(0.01 * s0.companies.lab.shares);
    const s1 = apply(s0, { t: 'trade', company: 'lab', shares: n });
    expect(sharesOf(s1, 'you', 'lab')).toBe(sharesOf(s0, 'you', 'lab'));
    expect(s1.orders).toHaveLength(1);
    const s2 = endWeek(s1);
    expect(sharesOf(s2, 'you', 'lab')).toBe(sharesOf(s0, 'you', 'lab') + n);
  });

  it('a buyback cancels shares and lifts the founder stake', () => {
    const s0 = newGame(1);
    const s1 = endWeek(apply(s0, { t: 'buyback' }));
    expect(s1.companies.lab.shares).toBeLessThan(s0.companies.lab.shares);
    expect(stake(s1, 'you', 'lab')).toBeGreaterThan(stake(s0, 'you', 'lab'));
  });
});

describe('takeovers', () => {
  it('a rich lab can buy and absorb a small rival', () => {
    const s0 = newGame(2);
    s0.companies.lab.cash = 5e9;
    expect(check(s0, { t: 'tender', target: 'mistrial', premium: 0.7, as: 'lab' })).toBeNull();
    let s = apply(s0, { t: 'tender', target: 'mistrial', premium: 0.7, as: 'lab' });
    expect(s.deals).toHaveLength(1);
    s = endWeek(endWeek(s));
    while (s.deals.length) s = endWeek(s);
    const m = s.moments.find((x) => x.kind === 'deal');
    expect(m?.kind === 'deal' && m.outcome).toBe('won');
    expect(s.companies.mistrial).toBeUndefined();
    expect(Object.values(s.models).some((x) => x.lab === 'lab')).toBe(true);
    expect(s.companies.lab.cash).toBeLessThan(5e9);
    sane(s);
  });

  it('a stingy bid falls short and costs a break fee', () => {
    const s0 = newGame(2);
    s0.companies.lab.cash = 5e9;
    let s = apply(s0, { t: 'tender', target: 'deepmined', premium: 0.15, as: 'lab' });
    while (s.deals.length) s = endWeek(s);
    const m = s.moments.find((x) => x.kind === 'deal');
    expect(m?.kind === 'deal' && m.outcome).toBe('short');
    expect(s.companies.deepmined).toBeTruthy();
  });

  it('buying control personally lets you take the helm of another lab', () => {
    const s0 = newGame(3);
    s0.actors.you.cash = 5e9;
    let s = apply(s0, { t: 'tender', target: 'mistrial', premium: 0.7, as: 'me' });
    while (s.deals.length) s = endWeek(s);
    while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
    expect(stake(s, 'you', 'mistrial')).toBeGreaterThanOrEqual(0.5);
    s = apply(s, { t: 'helm', company: 'mistrial' });
    expect(s.labId).toBe('mistrial');
    expect(s.helm).toBe(true);
    sane(weeks(s, 6));
  });

  it('a diluted founder with a crashed stock gets raided, and the game goes on after an ouster', () => {
    let s = newGame(4);
    s = weeks(s, 26);
    s.holdings.find((h) => h.owner === 'you' && h.company === 'lab')!.shares = 0.2 * s.companies.lab.shares;
    s.companies.lab.hist = s.companies.lab.hist.map(() => s.companies.lab.price * 3);
    for (const a of Object.values(s.actors)) if (a.persona) a.cash = 1e10;
    let raided = false;
    for (let i = 0; i < 40 && s.helm; i++) {
      const d = s.deals.find((x) => x.target === s.labId);
      if (d) raided = true;
      if (d && d.playerTenders === null) s = apply(s, { t: 'defend', deal: d.id, choice: 'tender' });
      while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
      s = endWeek(s);
      s.companies[s.labId].hist = s.companies[s.labId].hist.map(() => s.companies[s.labId].price * 3);
    }
    expect(raided).toBe(true);
    expect(s.helm).toBe(false);
    expect(check(s, { t: 'raise' })).toMatch(/no longer run/);
    expect(s.actors.you.cash).toBeGreaterThan(1e6);
    sane(weeks(s, 12));
  });
});

describe('long games stay sane', () => {
  it('prices stay positive and holdings never exceed shares over five bot-played years', () => {
    for (const seed of [1, 2]) {
      const r = play(seed, 'greedy', 240);
      sane(r.s);
      expect(floatOf(r.s, r.s.labId)).toBeGreaterThanOrEqual(0);
      expect(richList(r.s)).toHaveLength(6);
    }
  }, 60_000);
});
