// Shared helpers for choice events (base, dataset, v2 and run incidents). No event content lives here.
// Money goes through addExpense/addRevenue only. Temporary multipliers use flags: bonus.<key> + bonusUntil.<key>.
// Chains use flags: chain.<key> holds the day a follow-up becomes due.
import type { Bonuses, GameState, Model, Product, ProductKind, RoleId, Rng, Star } from '../types';
import { ROLE_IDS } from '../types';
import { addExpense, addRevenue, clamp } from '../util';
import { BALANCE } from '../balance';
import { datasetById } from '../systems/data';
import { quirkById } from './quirks';
import { GPUS } from './gpus';
import { OFFICE_TIERS } from './roles';
import { scandalRiskFor } from '../systems/capabilities';

// ---------------------------------------------------------------------------
// money and size
// ---------------------------------------------------------------------------

export const spend = (s: GameState, amount: number) => addExpense(s, 'events', amount);
export const earn = (s: GameState, amount: number) => addRevenue(s, 'other', amount);

/** Company size in dollars: the largest of cash, valuation and a year of revenue. Floored at $100k. */
export function companySize(s: GameState): number {
  return Math.max(100_000, s.finance.cash, s.finance.valuation ?? 0, s.finance.dailyRevenue * 365);
}

/** Round to two significant figures, so scaled amounts read as "$1.4M" rather than "$1,387,412". */
export function roundMoney(v: number): number {
  if (v <= 0) return 0;
  const e = Math.floor(Math.log10(v));
  const f = 10 ** (e - 1);
  return Math.round(v / f) * f;
}

/**
 * A money amount that grows with company size. `base` is what a company with the starting cash pays.
 * Scales with the square root of size, clamped to 0.1x..80x, so a garage and a $50B company both feel it.
 */
export function scaledCost(s: GameState, base: number): number {
  const factor = clamp(Math.sqrt(companySize(s) / BALANCE.START_CASH), 0.1, 80);
  return roundMoney(base * factor);
}

/** Caps an amount at a share of current cash (default 25%). Safest options use this, so they never sink a company. */
export function capAtCash(s: GameState, amount: number, share = 0.25): number {
  return Math.max(0, Math.min(amount, Math.floor(Math.max(0, s.finance.cash) * share)));
}

/** scaledCost capped at 25% of cash. The shape every safest option's cost should take. */
export function safeCost(s: GameState, base: number): number {
  return capAtCash(s, scaledCost(s, base));
}

/** Money with a random spread: base * rng.range(lo, hi), rounded. Use for variance inside a choice. */
export function spreadCost(s: GameState, rng: Rng, base: number, lo = 0.7, hi = 1.4): number {
  return roundMoney(scaledCost(s, base) * (lo + rng.next() * (hi - lo)));
}

// ---------------------------------------------------------------------------
// stat helpers (these move the hidden stats; the UI never prints the numbers)
// ---------------------------------------------------------------------------

export const bump = (s: GameState, key: 'brand' | 'hype' | 'reputation', d: number) => {
  s.company[key] = clamp(s.company[key] + d, 0, 100);
};
export const morale = (s: GameState, d: number) => {
  s.staff.morale = clamp(s.staff.morale + d, 0, 100);
};
export const cutStaff = (s: GameState, role: RoleId, n: number) => {
  s.staff.roles[role].count = Math.max(0, s.staff.roles[role].count - n);
};
export const headcount = (s: GameState) => ROLE_IDS.reduce((sum, id) => sum + s.staff.roles[id].count, 0);

// ---------------------------------------------------------------------------
// product and model helpers
// ---------------------------------------------------------------------------

export const liveProducts = (s: GameState): Product[] => s.products.filter((p) => p.active);
export const hasKind = (s: GameState, kind: ProductKind) => liveProducts(s).some((p) => p.kind === kind);
/** Models currently serving a live product. */
export const liveModels = (s: GameState): Model[] =>
  liveProducts(s)
    .map((p) => s.models.find((m) => m.id === p.modelId))
    .filter((m): m is Model => !!m);
export const liveChatModels = (s: GameState): Model[] =>
  liveProducts(s)
    .filter((p) => p.kind === 'chat')
    .map((p) => s.models.find((m) => m.id === p.modelId))
    .filter((m): m is Model => !!m);
export const maxVirality = (m: Model) => Math.max(0, ...(m.quirks ?? []).map((q) => quirkById(q)?.virality ?? 0));
export const minVirality = (m: Model) => Math.min(0, ...(m.quirks ?? []).map((q) => quirkById(q)?.virality ?? 0));
/** The most viral (max) or most damaging (min) quirk on a live model. */
export function viralQuirk(s: GameState, mode: 'max' | 'min') {
  let best: { id: string; v: number } | null = null;
  for (const m of liveModels(s)) {
    for (const id of m.quirks ?? []) {
      const v = quirkById(id)?.virality ?? 0;
      if (best === null || (mode === 'max' ? v > best.v : v < best.v)) best = { id, v };
    }
  }
  return best ? quirkById(best.id) : undefined;
}
export const anyLive = (s: GameState) => liveProducts(s).length > 0;
export const scaleUsers = (s: GameState, kind: ProductKind, mult: number) => {
  for (const p of liveProducts(s)) if (p.kind === kind) p.users = Math.round(p.users * mult);
};
export const hurtSatisfaction = (s: GameState, d: number) => {
  for (const p of liveProducts(s)) p.satisfaction = clamp(p.satisfaction - d, 0, 100);
};
export const ownedLegalRisk = (s: GameState) =>
  s.data.owned.reduce((sum, id) => sum + (datasetById(s, id)?.legalRisk ?? 0), 0);
export const bestReleasedOverall = (s: GameState) =>
  s.models.reduce((best, m) => (m.releasedDay !== null ? Math.max(best, m.overall) : best), 0);
export const hasReleasedModel = (s: GameState) => s.models.some((m) => m.releasedDay !== null);
export const gpusOwnedOrRented = (s: GameState) =>
  Object.values(s.compute.rented).reduce((a, b) => a + b, 0) +
  s.compute.datacenters.reduce((a, d) => a + Object.values(d.gpus).reduce((x, y) => x + y, 0), 0);
export const topHiredStar = (s: GameState): Star | undefined =>
  s.staff.stars.filter((x) => x.hiredDay !== null).sort((a, b) => a.loyalty - b.loyalty)[0];
export const firstOfficeId = () => OFFICE_TIERS[0]?.id ?? 'garage';
/** Weight for a PR incident tied to a specialisation: live products serving that spec, scaled by its scandalRisk. */
export const scandalWeight = (s: GameState, specId: string, base: number): number =>
  liveProducts(s).reduce((sum, p) => {
    const m = s.models.find((x) => x.id === p.modelId);
    if (!m || m.specId !== specId) return sum;
    return sum + base * scandalRiskFor(m);
  }, 0);
/** Point live products that run a given specialisation at the best released base model, if there is one. */
export const moveProductsOffSpec = (s: GameState, specId: string): void => {
  const base = s.models
    .filter((m) => m.releasedDay !== null && !m.deprecated && !m.specId)
    .sort((a, b) => b.overall - a.overall)[0];
  if (!base) return;
  for (const p of liveProducts(s)) {
    const m = s.models.find((x) => x.id === p.modelId);
    if (m && m.specId === specId) p.modelId = base.id;
  }
};
export const acquireOffer = (s: GameState) => Math.max(2_000_000, Math.round(s.finance.dailyRevenue * 60));

/**
 * Temporary (or permanent when days is undefined) multiplier on a passive bonus.
 * Stacks multiplicatively with an existing active multiplier on the same key.
 */
export function addBonus(s: GameState, key: keyof Bonuses, mult: number, days?: number): void {
  const k = `bonus.${key}`;
  const u = `bonusUntil.${key}`;
  const active = s.flags[u] === undefined || s.flags[u] >= s.day;
  const current = active ? (s.flags[k] ?? 1) : 1;
  s.flags[k] = current * mult;
  if (days === undefined) {
    delete s.flags[u];
  } else {
    s.flags[u] = Math.max(active ? (s.flags[u] ?? 0) : 0, s.day + days);
  }
}

// ---------------------------------------------------------------------------
// era gates
// ---------------------------------------------------------------------------

// Garage-era events: eligible from day 30 with no products, so the first choice lands early.
export const GARAGE_ERA_END_DAY = 900;
export const inGarageEra = (s: GameState) => s.day >= 30 && s.day < GARAGE_ERA_END_DAY;
export const starterGpuId = () => GPUS.find((g) => g.unlockYear <= 2017)?.id ?? 'p100';

// ---------------------------------------------------------------------------
// chains: a choice schedules a follow-up event N days later (flags only, no engine change)
// ---------------------------------------------------------------------------

const CHAIN = 'chain.';

/** Schedule a follow-up. The follow-up's weight should be `chainWeight(s, key, w)`, and its choices call `clearChain`. */
export function scheduleChain(s: GameState, key: string, rng: Rng, minDays = 30, maxDays = 120): void {
  s.flags[CHAIN + key] = s.day + rng.int(minDays, maxDays);
}
/** True once the scheduled day has arrived and the follow-up has not yet been consumed. */
export function chainDue(s: GameState, key: string): boolean {
  const d = s.flags[CHAIN + key];
  return d !== undefined && s.day >= d;
}
/** True while a follow-up is scheduled (due or not). */
export function chainScheduled(s: GameState, key: string): boolean {
  return s.flags[CHAIN + key] !== undefined;
}
/** Weight for a follow-up event: `w` once due, zero before. */
export function chainWeight(s: GameState, key: string, w: number): number {
  return chainDue(s, key) ? w : 0;
}
/** Consume a follow-up so it cannot fire again. Call from every choice of the follow-up. */
export function clearChain(s: GameState, key: string): void {
  delete s.flags[CHAIN + key];
}
