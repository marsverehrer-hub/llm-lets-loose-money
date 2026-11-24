// Shares: who owns what, trading with price impact, dividends, and the rival tycoons who trade against you.
import type { Actor, GameState, Id } from './types';
import { clamp, rand } from './rand';
import { fairValue } from './books';
import { money } from './run';

export const TRADE_LIMIT = 0.05; // of a company's shares, per owner, per week

export const sharesOf = (s: GameState, owner: Id, co: Id): number => s.holdings.find((h) => h.owner === owner && h.company === co)?.shares ?? 0;
export const heldOf = (s: GameState, co: Id): number => s.holdings.reduce((a, h) => a + (h.company === co ? h.shares : 0), 0);
export const floatOf = (s: GameState, co: Id): number => Math.max(0, s.companies[co].shares - heldOf(s, co));
export const stake = (s: GameState, owner: Id, co: Id): number => sharesOf(s, owner, co) / s.companies[co].shares;

/** Whoever holds half or more. */
export function controller(s: GameState, co: Id): Id | null {
  const h = s.holdings.find((x) => x.company === co && x.shares >= 0.5 * s.companies[co].shares);
  return h?.owner ?? null;
}

export function addShares(s: GameState, owner: Id, co: Id, n: number): void {
  const h = s.holdings.find((x) => x.owner === owner && x.company === co);
  if (h) h.shares += n; else s.holdings.push({ owner, company: co, shares: n });
  s.holdings = s.holdings.filter((x) => x.shares > 0.5);
}

export const netWorth = (s: GameState, actor: Id): number =>
  s.actors[actor].cash + s.holdings.reduce((a, h) => a + (h.owner === actor ? h.shares * s.companies[h.company].price : 0), 0);
export const richList = (s: GameState): { id: Id; name: string; worth: number }[] =>
  Object.values(s.actors).map((a) => ({ id: a.id, name: a.name, worth: netWorth(s, a.id) })).sort((a, b) => b.worth - a.worth);

/** Price impact of moving n shares through the float. */
const impact = (s: GameState, co: Id, n: number): number => 0.5 * Math.sqrt(Math.abs(n) / Math.max(1, floatOf(s, co) + (n < 0 ? -n : 0)));
/** What buying (n > 0) or selling (n < 0) costs or yields right now, including the price you move against yourself. */
export const quote = (s: GameState, co: Id, n: number): number => n * s.companies[co].price * (1 + (Math.sign(n) * impact(s, co, n)) / 2);
const pending = (s: GameState, owner: Id, co: Id): number => s.orders.reduce((a, o) => a + (o.owner === owner && o.company === co ? o.shares : 0), 0);

export function tradeCheck(s: GameState, owner: Id, co: Id, n: number): string | null {
  const c = s.companies[co];
  if (!c || !n) return 'Nothing to trade.';
  const used = Math.abs(s.traded[owner + '|' + co] ?? 0);
  if (used + Math.abs(n) > TRADE_LIMIT * c.shares + 1) return 'You can move at most 5% of a company a week. Use a tender offer for more.';
  if (n > 0) {
    if (n > floatOf(s, co)) return 'Not enough shares on the market.';
    if (quote(s, co, n) > s.actors[owner].cash) return 'Not enough cash.';
  } else if (-n > sharesOf(s, owner, co) + Math.min(0, pending(s, owner, co))) return 'You do not own that many.';
  return null;
}

/** Fill a trade now. The company itself as owner means a buyback: the shares are cancelled. */
export function fill(s: GameState, owner: Id, co: Id, n: number): void {
  const c = s.companies[co];
  n = n > 0 ? Math.min(n, floatOf(s, co)) : -Math.min(-n, owner === co ? 0 : sharesOf(s, owner, co));
  if (!n) return;
  const cost = quote(s, co, n);
  const i = impact(s, co, n);
  if (owner === co) { c.cash -= cost; c.shares -= n; }
  else {
    const before = stake(s, owner, co);
    s.actors[owner].cash -= cost;
    addShares(s, owner, co, n);
    const after = stake(s, owner, co);
    for (const mark of [0.05, 0.1, 0.25, 0.5]) if (before < mark && after >= mark) s.log.push({ week: s.week, co, tone: owner === s.playerId ? 'good' : 'info', text: `${s.actors[owner].name} now ${mark === 0.5 ? 'controls' : `owns ${Math.round(mark * 100)}% of`} ${c.name}.` });
  }
  c.price *= 1 + Math.sign(n) * i;
  s.traded[owner + '|' + co] = (s.traded[owner + '|' + co] ?? 0) + n;
}

/** Trades in a company you run are filed and fill next week, so you cannot front-run your own news. */
export function trade(s: GameState, owner: Id, co: Id, n: number): 'filled' | 'filed' {
  const insider = owner === co || controller(s, co) === owner || (owner === s.playerId && co === s.labId && s.helm);
  if (insider) { s.orders.push({ owner, company: co, shares: n }); s.traded[owner + '|' + co] = (s.traded[owner + '|' + co] ?? 0) + n; return 'filed'; }
  fill(s, owner, co, n);
  return 'filled';
}

export function ordersTick(s: GameState): void {
  const orders = s.orders;
  s.orders = [];
  s.traded = {};
  for (const o of orders) {
    if (!s.companies[o.company]) continue;
    if (o.shares > 0 && o.owner !== o.company && quote(s, o.company, o.shares) > s.actors[o.owner].cash) continue;
    fill(s, o.owner, o.company, o.shares);
    if (o.owner === s.playerId || o.owner === s.labId) s.log.push({ week: s.week, co: o.company, tone: 'info', text: `Your filed order filled: ${o.shares > 0 ? 'bought' : 'sold'} ${Math.round(Math.abs(o.shares) / 1e4) / 100}M ${s.companies[o.company].name} shares.` });
  }
  s.traded = {};
}

/** Pay each company's dividend: a share of smoothed profit, to every shareholder pro rata. */
export function dividends(s: GameState): void {
  for (const c of Object.values(s.companies)) {
    const pay = Math.min(Math.max(0, c.cash), c.payout * Math.max(0, c.ni8));
    if (pay <= 0) continue;
    c.cash -= pay;
    for (const h of s.holdings) if (h.company === c.id) { const to = s.actors[h.owner] ?? s.companies[h.owner]; if (to) to.cash += (pay * h.shares) / c.shares; }
  }
}

/** One trade a week per tycoon: buy what looks cheap, sell what looks dear. Greedy ones chase momentum. */
export function tycoonTick(s: GameState, a: Actor): void {
  const p = a.persona!;
  let best: { co: Id; v: number } | null = null, worst: { co: Id; v: number } | null = null;
  for (const c of Object.values(s.companies)) {
    const mom = c.price / (c.hist[Math.max(0, c.hist.length - 5)] ?? c.price) - 1;
    const v = fairValue(s, c) / c.shares / c.price + 0.6 * p.greed * mom + 0.1 * (rand(s.seed, s.week, a.id, c.id) - 0.5);
    if (!best || v > best.v) best = { co: c.id, v };
    if (sharesOf(s, a.id, c.id) > 0 && (!worst || v < worst.v)) worst = { co: c.id, v };
  }
  if (worst && worst.v < 0.8 && controller(s, worst.co) !== a.id) {
    const n = Math.min(sharesOf(s, a.id, worst.co), 0.02 * s.companies[worst.co].shares);
    fill(s, a.id, worst.co, -n);
  } else if (best && best.v > 1.25 && a.cash > 1e6) {
    const c = s.companies[best.co];
    const n = Math.floor(clamp((0.1 * a.cash) / c.price, 0, Math.min(0.02 * c.shares, floatOf(s, c.id))));
    if (n > 0 && quote(s, c.id, n) <= a.cash) fill(s, a.id, c.id, n);
  }
}

export const describeStake = (s: GameState, owner: Id, co: Id): string => `${Math.round(stake(s, owner, co) * 1000) / 10}% (${money(sharesOf(s, owner, co) * s.companies[co].price)})`;
