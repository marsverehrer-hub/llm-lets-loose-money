// v19: GPU supply. Pre-orders, a waitlist when the vendor runs dry, price spikes from demand, a used market fed by
// bankrupt labs and sellers. The vendor allocation (scaleLimits.ts) is shared with the rival labs. Package D1.
import type { ActionHandlers, Datacenter, GameState, GpuPreorder, Rng } from '../types';
import { GPUS } from '../data/gpus';
import { addRevenue, calendarYear, clamp, formatMoney, newId, notify, trySpend } from '../util';
import { datacenterTierById, gpuById, resaleFraction } from './compute';
import {
  consumeGpuAllocation,
  gpuAllocationBooked,
  gpuAllocationLeft,
  gpuAllocationQuota,
  isAllocationExempt,
  SUPPLY_TUNING,
} from './scaleLimits';

export const SUPPLY_PRICE = {
  /** Demand over supply below this ratio leaves the list price alone. */
  KNEE: 0.7,
  /** How hard the excess demand lifts the price, and the top of the excess term (before the cap). */
  SLOPE: 0.6,
  HEAT_CAP: 1.5,
  /** Launch-year cards read demand this much hotter: newer generations spike more. */
  LAUNCH_HEAT: 1.3,
  /** The price index never rises past this (event shocks multiply on top). */
  CAP: 1.9,
  /** Pre-order deposit, share of the unit price locked at order time. */
  DEPOSIT_SHARE: 0.3,
  /** Share of the deposit a cancelled pre-order gets back. */
  CANCEL_REFUND_SHARE: 0.5,
  /** Used GPUs sell at this premium over their resale value. */
  USED_PREMIUM: 1.1,
  /** Used GPUs are bought as this old (years). */
  USED_AGE_YEARS: 2,
  /** The used market loses this share per week (miners and hobbyists take it). Applied daily. */
  USED_WEEKLY_DECAY: 0.02,
};

const DAY_PER_YEAR = 365;

function usedKey(gpuId: string): string {
  return `usedGpus.${gpuId}`;
}
const SEEN = 'supply.seen.'; // per-model installed count at the last supplyTick, to read sales from
const FAILED_SEEN = 'supply.failedSeen'; // stat.gpusFailed at the last supplyTick

/** The first day of the next allocation quarter: when a pre-order is delivered. */
export function nextAllocationDay(s: GameState): number {
  const q = SUPPLY_TUNING.QUARTER_DAYS;
  return (Math.floor(s.day / q) + 1) * q;
}

/** Multiplier on a GPU's buy price from demand over supply (1 = list price). Rent shocks multiply it. */
export function gpuPriceMult(s: GameState, gpuId: string): number {
  let index = 1;
  const g = gpuById(gpuId);
  const quota = gpuAllocationQuota(s, gpuId);
  if (g && Number.isFinite(quota) && quota > 0) {
    const demand = gpuAllocationBooked(s, gpuId) + pendingFor(s, gpuId);
    let ratio = demand / quota;
    if (calendarYear(s.day) === g.unlockYear) ratio *= SUPPLY_PRICE.LAUNCH_HEAT;
    const P = SUPPLY_PRICE;
    index = Math.min(P.CAP, 1 + P.SLOPE * clamp(ratio - P.KNEE, 0, P.HEAT_CAP));
  }
  return index * (s.flags['rentMult'] ?? 1);
}

/** Used GPUs on the market for a model, and their price per GPU. */
export function usedMarket(s: GameState, gpuId: string): { count: number; price: number } {
  const g = gpuById(gpuId);
  if (!g) return { count: 0, price: 0 };
  const count = Math.floor(s.flags[usedKey(gpuId)] ?? 0);
  const price = g.buyPrice * gpuPriceMult(s, gpuId) * resaleFraction(SUPPLY_PRICE.USED_AGE_YEARS) * SUPPLY_PRICE.USED_PREMIUM;
  return { count, price };
}

/** GPUs of a model pre-ordered for delivery on `day` (or any day when omitted). */
function pendingFor(s: GameState, gpuId: string, day?: number): number {
  let n = 0;
  for (const p of s.preorders ?? []) if (p.gpuId === gpuId && (day === undefined || p.deliverDay === day)) n += p.count;
  return n;
}
/** Hall slots already promised to pre-orders for a datacenter. */
function reservedSlots(s: GameState, dc: Datacenter): number {
  let n = 0;
  for (const p of s.preorders ?? []) if (p.datacenterId === dc.id) n += p.count;
  return n;
}
function installedCount(dc: Datacenter): number {
  let n = 0;
  for (const c of Object.values(dc.gpus)) n += c;
  return n;
}
/** Free slots in a finished hall once pre-orders take their share. */
function freeSlots(s: GameState, dc: Datacenter): number {
  const max = datacenterTierById(dc.tierId)?.maxGpus ?? 0;
  return max - installedCount(dc) - reservedSlots(s, dc);
}
/** Installs `n` GPUs bought on `day`, keeping the count-weighted purchase day (as buyGpus does). */
function installGpus(dc: Datacenter, gpuId: string, n: number, day: number): void {
  const had = dc.gpus[gpuId] ?? 0;
  dc.bought ??= {};
  const prev = dc.bought[gpuId] ?? day;
  dc.bought[gpuId] = (prev * had + day * n) / (had + n);
  dc.gpus[gpuId] = had + n;
}
function installedAll(s: GameState, gpuId: string): number {
  let n = 0;
  for (const dc of s.compute.datacenters) n += dc.gpus[gpuId] ?? 0;
  return n;
}

export const handlers: ActionHandlers = {
  preorderGpus: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    if (dc.buildDaysLeft > 0) {
      notify(s, `${dc.name} is still under construction.`, 'bad');
      return;
    }
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    if (isAllocationExempt(gpu)) {
      notify(s, `${gpu.name} is not rationed. Buy it outright.`, 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count < 1) {
      notify(s, 'Pre-order at least one GPU.', 'bad');
      return;
    }
    const day = nextAllocationDay(s);
    if (calendarYear(day) < gpu.unlockYear) {
      notify(s, `${gpu.name} is not on sale until ${gpu.unlockYear}.`, 'bad');
      return;
    }
    const free = freeSlots(s, dc);
    if (a.count > free) {
      notify(s, `Only ${Math.max(0, free).toLocaleString('en-US')} free slot${free === 1 ? '' : 's'} in ${dc.name} for a pre-order.`, 'bad');
      return;
    }
    const spare = gpuAllocationQuota(s, gpu.id, day) - pendingFor(s, gpu.id, day);
    if (a.count > spare) {
      notify(s, spare > 0
        ? `Only ${Math.floor(spare).toLocaleString('en-US')} ${gpu.name} are left to pre-order for next quarter.`
        : `The vendor's allocation of ${gpu.name} for next quarter is already pre-ordered.`, 'bad');
      return;
    }
    const deposit = a.count * gpu.buyPrice * gpuPriceMult(s, gpu.id) * SUPPLY_PRICE.DEPOSIT_SHARE;
    if (!trySpend(s, 'capex', deposit, `the ${gpu.name} deposit`)) return;
    s.preorders ??= [];
    s.preorders.push({ id: newId(s, 'po'), gpuId: gpu.id, count: a.count, datacenterId: dc.id, deliverDay: day, deposit });
    notify(s, `Pre-ordered ${a.count.toLocaleString('en-US')} × ${gpu.name} for ${dc.name}. Delivered on day ${day}; deposit ${formatMoney(deposit)}.`, 'good');
  },

  cancelPreorder: (s, a) => {
    const p = s.preorders?.find((x) => x.id === a.id);
    if (!p) {
      notify(s, 'No such pre-order.', 'bad');
      return;
    }
    s.preorders = (s.preorders ?? []).filter((x) => x !== p);
    const refund = p.deposit * SUPPLY_PRICE.CANCEL_REFUND_SHARE;
    addRevenue(s, 'other', refund);
    const name = gpuById(p.gpuId)?.name ?? p.gpuId;
    notify(s, `Cancelled the pre-order for ${p.count.toLocaleString('en-US')} × ${name}. Refunded ${formatMoney(refund)} of the deposit.`, 'info');
  },

  buyUsedGpus: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc || dc.buildDaysLeft > 0) {
      notify(s, dc ? `${dc.name} is still under construction.` : 'Unknown datacenter.', 'bad');
      return;
    }
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    if (calendarYear(s.day) < gpu.unlockYear) {
      notify(s, `${gpu.name} is not available until ${gpu.unlockYear}.`, 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count < 1) {
      notify(s, 'Buy at least one GPU.', 'bad');
      return;
    }
    const market = usedMarket(s, gpu.id);
    if (a.count > market.count) {
      notify(s, `Only ${market.count.toLocaleString('en-US')} used ${gpu.name} on the market.`, 'bad');
      return;
    }
    const free = freeSlots(s, dc);
    if (a.count > free) {
      notify(s, `Only ${Math.max(0, free).toLocaleString('en-US')} free slot${free === 1 ? '' : 's'} in ${dc.name}.`, 'bad');
      return;
    }
    if (!trySpend(s, 'capex', a.count * market.price, `${a.count} used ${gpu.name}`)) return;
    s.flags[usedKey(gpu.id)] -= a.count;
    installGpus(dc, gpu.id, a.count, s.day - SUPPLY_PRICE.USED_AGE_YEARS * DAY_PER_YEAR);
    notify(s, `Installed ${a.count} used ${gpu.name} in ${dc.name}. They are ${SUPPLY_PRICE.USED_AGE_YEARS} years old and will fail more often.`, 'good');
  },
};

/** Delivers the pre-orders due today: they take this quarter's allocation first, before any walk-in or rival. */
function deliverPreorders(s: GameState): void {
  for (const p of s.preorders ?? []) {
    if (p.deliverDay > s.day) continue;
    deliver(s, p);
  }
  if (s.preorders) s.preorders = s.preorders.filter((p) => p.deliverDay > s.day);
}

function deliver(s: GameState, p: GpuPreorder): void {
  const gpu = gpuById(p.gpuId);
  const dc = s.compute.datacenters.find((d) => d.id === p.datacenterId);
  const unit = p.deposit / (SUPPLY_PRICE.DEPOSIT_SHARE * p.count);
  // Boxes this quarter: the order, the room left in the hall and what the vendor still sells.
  const room = dc ? (datacenterTierById(dc.tierId)?.maxGpus ?? 0) - installedCount(dc) : 0;
  const n = gpu && dc ? Math.floor(Math.min(p.count, Math.max(0, room), gpuAllocationLeft(s, gpu.id))) : 0;
  const name = gpu?.name ?? p.gpuId;
  const refundAll = () => addRevenue(s, 'other', p.deposit);
  if (!gpu || !dc || n <= 0) {
    refundAll();
    notify(s, `No ${name} boxes for your pre-order: the deposit of ${formatMoney(p.deposit)} is refunded.`, 'bad');
    return;
  }
  // The rest of the price is paid on delivery; the deposit already covered the share it was locked at.
  if (!trySpend(s, 'capex', n * unit * (1 - SUPPLY_PRICE.DEPOSIT_SHARE), `the ${name} delivery`)) {
    refundAll();
    notify(s, `Could not pay for the ${name} delivery: the deposit of ${formatMoney(p.deposit)} is refunded.`, 'bad');
    return;
  }
  consumeGpuAllocation(s, gpu.id, n);
  installGpus(dc, gpu.id, n, s.day);
  const short = p.count - n;
  if (short > 0) {
    addRevenue(s, 'other', (p.deposit * short) / p.count);
    notify(s, `${short.toLocaleString('en-US')} × ${name} from your pre-order did not fit (slots or allocation). Their deposit is refunded.`, 'bad');
  }
  notify(s, `${n.toLocaleString('en-US')} × ${name} delivered to ${dc.name}.`, 'good');
}

/** Daily: the used market decays, takes the day's sales, then the pre-orders due today land. */
export function supplyTick(s: GameState, _rng: Rng): void {
  decayUsed(s);
  takeSalesToUsed(s);
  deliverPreorders(s);
  snapshot(s);
}

function decayUsed(s: GameState): void {
  const daily = (1 - SUPPLY_PRICE.USED_WEEKLY_DECAY) ** (1 / 7);
  for (const g of GPUS) {
    const k = usedKey(g.id);
    if (s.flags[k] !== undefined) s.flags[k] *= daily;
  }
}

/**
 * Sales feed the used market. sellGpus (compute.ts) has no hook, so the GPUs each model lost since the last tick are
 * read from the fleet. GPUs that failed in between also leave the fleet, and the counters do not say which model they
 * were, so failures come off each model's drop in proportion. shortcut: a buy of the same model on the same day nets
 * off a sale; upgrade to a sale hook in compute.ts when that file is free.
 */
function takeSalesToUsed(s: GameState): void {
  const drops: [string, number][] = [];
  let total = 0;
  for (const g of GPUS) {
    const prev = s.flags[SEEN + g.id];
    const drop = prev === undefined ? 0 : prev - installedAll(s, g.id);
    if (drop > 0) {
      drops.push([g.id, drop]);
      total += drop;
    }
  }
  if (total <= 0) return;
  const failedNow = s.flags['stat.gpusFailed'] ?? 0;
  const failures = Math.min(total, Math.max(0, failedNow - (s.flags[FAILED_SEEN] ?? failedNow)));
  for (const [id, drop] of drops) {
    const sold = Math.round(drop - (failures * drop) / total);
    if (sold > 0) s.flags[usedKey(id)] = (s.flags[usedKey(id)] ?? 0) + sold;
  }
}

function snapshot(s: GameState): void {
  for (const g of GPUS) s.flags[SEEN + g.id] = installedAll(s, g.id);
  s.flags[FAILED_SEEN] = s.flags['stat.gpusFailed'] ?? 0;
}
