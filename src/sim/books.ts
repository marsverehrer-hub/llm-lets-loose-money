// Money: the compute price, every company's weekly P&L, and share prices.
import type { Company, GameState, Id } from './types';
import { clamp, randn } from './rand';

/** shortcut: one demand-over-capacity curve stands in for the supply chain. M3 replaces this body with the cascade. */
export function computePrice(week: number, demandCu: number): { price: number; scarcity: number } {
  const base = 10_000 * Math.pow(0.9885, week); // hardware gets ~43% cheaper a year
  const capacity = 420 * Math.pow(1.04, week);
  const scarcity = clamp(Math.pow(demandCu / capacity, 1.5), 0.5, 5);
  return { price: base * scarcity, scarcity };
}

export const opex = (s: GameState, co: Company): number => 100_000 * (1 + s.week / 96) + 0.12 * co.rev;
export const marketCap = (co: Company): number => co.price * co.shares;
export const stakeOf = (s: GameState, owner: Id, coId: Id): number =>
  (s.holdings.find((h) => h.owner === owner && h.company === coId)?.shares ?? 0) / s.companies[coId].shares;

/** Weeks of cash left at the current burn, counting the hands-on run's bill. Infinity when profitable. */
export function runway(s: GameState, co: Company): number {
  const burn = co.cost - co.rev;
  return burn <= 0 ? Infinity : Math.max(0, co.cash) / burn;
}

export function booksTick(s: GameState, flow: Record<Id, { rev: number; cogs: number; cu: number }>, trainSpend: Record<Id, number>): void {
  for (const co of Object.values(s.companies)) {
    const f = flow[co.id] ?? { rev: 0, cogs: 0, cu: 0 };
    const prev = co.rev8;
    co.rev = f.rev;
    const ox = opex(s, co);
    co.cash += f.rev - f.cogs - ox;
    co.cost = f.cogs + ox + (trainSpend[co.id] ?? 0);
    co.rev8 += 0.25 * (f.rev - co.rev8);
    co.ni8 += 0.25 * (f.rev - f.cogs - ox - co.ni8);
    co.revGrowth += 0.2 * ((prev > 1 ? co.rev8 / prev - 1 : 0) - co.revGrowth);
    co.negWeeks = co.cash < 0 ? co.negWeeks + 1 : 0;
  }
}

export function fairValue(s: GameState, co: Company): number {
  const margin = co.rev8 > 1 ? clamp(co.ni8 / co.rev8, -0.5, 0.6) : 0;
  const building = Object.values(s.runs).filter((r) => r.lab === co.id && r.status === 'running').reduce((a, r) => a + r.spent, 0);
  const story = co.lab ? 15e6 * (0.4 + co.lab.brand + co.lab.hype) * co.lab.talent : 0;
  const ops = 48 * co.rev8 * 8 * (0.5 + margin) * (1 + 3 * clamp(co.revGrowth, -0.1, 0.5));
  return Math.max(0, co.cash) - co.debt + (ops + story) * (1 + 0.5 * s.market.sentiment) + 0.5 * building;
}

/** Prices chase fair value with a lag, so reading the fundamentals is a skill. */
export function priceTick(s: GameState): void {
  for (const co of Object.values(s.companies)) {
    const target = Math.max(0.05 * co.price, fairValue(s, co) / co.shares);
    co.price = Math.max(0.01, co.price * (1 + 0.25 * (target / co.price - 1) + randn(s.seed, s.week, co.id, 'px') * 0.03));
    co.hist.push(co.price);
    if (co.hist.length > 96) co.hist.shift();
  }
}

/** Sell new shares worth 10% of the company at a 10% discount. Everyone, including the founder, is diluted. */
export const RAISE_COOLDOWN = 8;
export const canRaise = (s: GameState, co: Company): boolean => s.week - co.raisedAt >= RAISE_COOLDOWN;

export function raise(s: GameState, co: Company): number {
  const n = Math.round(co.shares * 0.1);
  const got = n * co.price * 0.9;
  co.shares += n;
  co.cash += got;
  co.price *= 0.92;
  co.negWeeks = 0;
  co.raisedAt = s.week;
  return got;
}
