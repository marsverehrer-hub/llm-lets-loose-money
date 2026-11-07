// v16 (GAME_DESIGN §26.1, §26.2): the cloud market. Several parody providers with their own prices, stock, quotas,
// reserved contracts, spot capacity that can be preempted, and availability crunches.
// `compute.rented` stays the default provider's on-demand pool (the legacy `rentGpus` action, events, tests and bots
// keep using it); every other lease lives in `compute.cloud.leases`. This module must not import compute.ts (compute.ts
// reads the lease totals from here), so it reads GPUs straight from the data table.
import type { ActionHandlers, CloudLease, CloudState, CloudTerm, GameState, GpuDef, Id, Rng } from '../types';
import { GPUS } from '../data/gpus';
import { CLOUD_PROVIDERS, DEFAULT_PROVIDER_ID, providerById, type CloudProviderDef } from '../data/clouds';
import { makeRng } from '../rng';
import { addExpense, clamp, formatMoney, newId, notify, yearOf } from '../util';

export const CLOUD_TUNING = {
  /** Crunch length in days. */
  CRUNCH_DAYS_MIN: 30,
  CRUNCH_DAYS_MAX: 90,
  /** During a crunch a provider's quota for new GPUs is this share of normal (existing leases are kept). */
  CRUNCH_QUOTA: 0.5,
  /** During a crunch spot costs this much more and is preempted this many times as often. */
  CRUNCH_SPOT_PRICE: 1.6,
  CRUNCH_PREEMPT: 3,
  /** A newly stocked GPU generation may take this share of the quota at first, rising to all of it over the ramp. */
  NEW_GEN_SHARE: 0.2,
  NEW_GEN_RAMP_YEARS: 1,
  /** A preempted spot lease is offline (and unbilled) for this many days. */
  PREEMPT_DOWN_MIN: 1,
  PREEMPT_DOWN_MAX: 3,
  /** A preemption during a training run loses this many days of the preempted GPUs' share of the run (since the last checkpoint). */
  ROLLBACK_DAYS: 0.5,
  /** Ending a reserved contract early costs this share of what is left on it. */
  EARLY_EXIT_SHARE: 0.5,
  /** Signing a reserved contract needs this many days of its bill in cash. */
  COMMIT_CASH_DAYS: 30,
  DAYS_PER_MONTH: 365 / 12,
  /** Preemption notices at most this often. */
  PREEMPT_NOTICE_DAYS: 7,
  MAX_ORDER: 1_000_000,
};
const T = CLOUD_TUNING;
export const CLOUD_TERMS: CloudTerm[] = [12, 36];

const EMPTY: CloudState = { leases: [], crunchUntil: {} };
const NO_GPUS: Record<Id, number> = Object.freeze({}) as Record<Id, number>;

/** The cloud state, read-only. Old saves have none. */
export function cloudOf(s: GameState): CloudState {
  return s.compute.cloud ?? EMPTY;
}
function ensureCloud(s: GameState): CloudState {
  const c = (s.compute.cloud ??= { leases: [], crunchUntil: {} });
  c.leases ??= [];
  c.crunchUntil ??= {};
  return c;
}
function gpuDef(id: Id): GpuDef | undefined {
  return GPUS.find((g) => g.id === id);
}
function rentMult(s: GameState): number {
  return s.flags['rentMult'] ?? 1;
}

// ---------------------------------------------------------------------------
// Stock, quota and prices (pure)
// ---------------------------------------------------------------------------

/** Fractional year from which a provider stocks a GPU. */
export function stockedFrom(p: CloudProviderDef, g: GpuDef): number {
  return Math.max(p.openYear, g.unlockYear + p.stockLag);
}
/** The provider has this GPU on its shelves in `year` (fractional). */
export function stocks(p: CloudProviderDef, g: GpuDef, year: number): boolean {
  return year >= stockedFrom(p, g) && (p.retireAfter === undefined || year < g.unlockYear + p.retireAfter);
}
export function inCrunch(s: GameState, providerId: Id): boolean {
  return (cloudOf(s).crunchUntil[providerId] ?? -1) > s.day;
}
/** The player's quota at a provider, in GPUs: quotaBase × quotaGrowth^(years open), halved in a crunch. */
export function providerQuota(s: GameState, p: CloudProviderDef): number {
  const y = yearOf(s.day);
  if (y < p.openYear) return 0;
  return Math.floor(p.quotaBase * p.quotaGrowth ** (y - p.openYear) * (inCrunch(s, p.id) ? T.CRUNCH_QUOTA : 1));
}
/** Share of the quota one generation may take: scarce right after the provider stocks it. */
export function generationShare(p: CloudProviderDef, g: GpuDef, year: number): number {
  return clamp(T.NEW_GEN_SHARE + ((1 - T.NEW_GEN_SHARE) * (year - stockedFrom(p, g))) / T.NEW_GEN_RAMP_YEARS, T.NEW_GEN_SHARE, 1);
}
/** GPUs the player holds at a provider (every kind, preempted spot included), optionally of one GPU. */
export function providerUsage(s: GameState, providerId: Id, gpuId?: Id): number {
  let n = 0;
  if (providerId === DEFAULT_PROVIDER_ID) {
    for (const [g, c] of Object.entries(s.compute.rented)) if (!gpuId || g === gpuId) n += c;
  }
  for (const l of cloudOf(s).leases) if (l.providerId === providerId && (!gpuId || l.gpuId === gpuId)) n += l.count;
  return n;
}
/** More GPUs of this kind the provider will lease the player today. */
export function quotaLeft(s: GameState, p: CloudProviderDef, g: GpuDef): number {
  const y = yearOf(s.day);
  if (!stocks(p, g, y)) return 0;
  const q = providerQuota(s, p);
  const gen = Math.floor(q * generationShare(p, g, y));
  return Math.max(0, Math.min(q - providerUsage(s, p.id), gen - providerUsage(s, p.id, g.id)));
}
/** On-demand $ per GPU-day. Rent shocks from events (`rentMult`) apply to every provider. */
export function onDemandPrice(s: GameState, p: CloudProviderDef, g: GpuDef): number {
  return g.rentPerDay * p.priceMult * rentMult(s);
}
/** Spot $ per GPU-day (Infinity where there is no spot). Up in a crunch. */
export function spotPrice(s: GameState, p: CloudProviderDef, g: GpuDef): number {
  if (!p.spot) return Infinity;
  return onDemandPrice(s, p, g) * p.spot.priceMult * (inCrunch(s, p.id) ? T.CRUNCH_SPOT_PRICE : 1);
}
/** Reserved $ per GPU-day for a term (Infinity where the term is not offered). */
export function reservedPrice(s: GameState, p: CloudProviderDef, g: GpuDef, months: CloudTerm): number {
  const d = p.reserved[months];
  return d === undefined ? Infinity : onDemandPrice(s, p, g) * (1 - d);
}
/** Spot chance per day of a preemption (0 without spot). */
export function preemptChance(s: GameState, p: CloudProviderDef): number {
  return p.spot ? p.spot.preemptPerDay * (inCrunch(s, p.id) ? T.CRUNCH_PREEMPT : 1) : 0;
}

/** A lease is working today (a preempted spot lease is not). */
export function leaseUp(s: GameState, l: CloudLease): boolean {
  return l.kind !== 'spot' || (l.downUntil ?? -Infinity) <= s.day;
}
/** Today's $ per GPU-day of a lease (0 while a spot lease is preempted). */
export function leasePrice(s: GameState, l: CloudLease): number {
  if (l.kind === 'reserved') return l.pricePerDay ?? 0;
  const p = providerById(l.providerId);
  const g = gpuDef(l.gpuId);
  if (!p || !g) return 0;
  if (l.kind === 'spot') return leaseUp(s, l) ? spotPrice(s, p, g) : 0;
  return onDemandPrice(s, p, g);
}
/** Working GPUs from provider leases (not the legacy pool), by GPU id. */
export function cloudLeaseGpus(s: GameState): Record<Id, number> {
  const leases = s.compute.cloud?.leases;
  if (!leases || leases.length === 0) return NO_GPUS; // hot path: the fleet readers call this many times a tick
  const out: Record<Id, number> = {};
  for (const l of cloudOf(s).leases) if (leaseUp(s, l)) out[l.gpuId] = (out[l.gpuId] ?? 0) + l.count;
  return out;
}
/** Every working cloud GPU by GPU id: the legacy pool plus the provider leases. For pictures and counts. */
export function cloudGpusByType(s: GameState): Record<Id, number> {
  const out: Record<Id, number> = { ...s.compute.rented };
  for (const [g, n] of Object.entries(cloudLeaseGpus(s))) out[g] = (out[g] ?? 0) + n;
  return out;
}
/** Today's bill for the provider leases (the legacy pool is billed by compute.ts). */
export function cloudLeaseRentPerDay(s: GameState): number {
  let rent = 0;
  for (const l of cloudOf(s).leases) rent += l.count * leasePrice(s, l);
  return rent;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function gpuCountLabel(n: number, g: GpuDef): string {
  return `${n.toLocaleString('en-US')} × ${g.name}`;
}

/**
 * Rent (count > 0) or return (count < 0) on-demand or spot GPUs at a provider. The default provider's on-demand pool is
 * `compute.rented`, so the legacy `rentGpus` action lands here too. A rental larger than the quota rents what is left.
 */
export function rentFromProvider(s: GameState, providerId: Id, gpuId: Id, count: number, spot = false): void {
  const p = providerById(providerId);
  const g = gpuDef(gpuId);
  if (!p) return notify(s, 'Unknown cloud provider.', 'bad');
  if (!g) return notify(s, 'Unknown GPU.', 'bad');
  if (g.class === 'custom') return notify(s, 'Nobody rents out your chips. You own the fab slot; buy them for your halls.', 'bad'); // v19
  if (!Number.isInteger(count) || count === 0 || Math.abs(count) > T.MAX_ORDER) {
    return notify(s, 'Rent a whole number of GPUs (negative to give them back).', 'bad');
  }
  const legacy = providerId === DEFAULT_PROVIDER_ID && !spot;
  const kind = spot ? 'spot' : 'ondemand';
  if (count < 0) {
    let back = -count;
    if (legacy) {
      const have = s.compute.rented[g.id] ?? 0;
      back = Math.min(back, have);
      if (back === 0) return notify(s, `You have no ${g.name} rentals to return.`, 'bad');
      if (have - back > 0) s.compute.rented[g.id] = have - back;
      else delete s.compute.rented[g.id];
    } else {
      const c = ensureCloud(s);
      let left = back;
      for (const l of c.leases) {
        if (left <= 0) break;
        if (l.providerId !== p.id || l.gpuId !== g.id || l.kind !== kind) continue;
        const k = Math.min(left, l.count);
        l.count -= k;
        left -= k;
      }
      back -= left;
      c.leases = c.leases.filter((l) => l.count > 0);
      if (back === 0) return notify(s, `You have no ${spot ? 'spot ' : ''}${g.name} at ${p.name} to return.`, 'bad');
    }
    return notify(s, `Returned ${gpuCountLabel(back, g)} to ${p.name}.`, 'info');
  }

  const year = yearOf(s.day);
  if (year < p.openYear) return notify(s, `${p.name} opens in ${p.openYear}.`, 'bad');
  if (spot ? !p.spot : !p.onDemand) return notify(s, `${p.name} does not sell ${spot ? 'spot' : 'on-demand'} capacity.`, 'bad');
  if (!stocks(p, g, year)) {
    const from = stockedFrom(p, g);
    return notify(s, year < from ? `${p.name} stocks ${g.name} from ${Math.ceil(from)}.` : `${p.name} no longer stocks ${g.name}.`, 'bad');
  }
  const left = quotaLeft(s, p, g);
  if (left <= 0) {
    const why = inCrunch(s, p.id) ? ' It is in a capacity crunch.' : '';
    return notify(s, `${p.name} quota reached for ${g.name} (${providerQuota(s, p).toLocaleString('en-US')} GPUs).${why} Try another provider.`, 'bad');
  }
  const n = Math.min(count, left);
  const price = spot ? spotPrice(s, p, g) : onDemandPrice(s, p, g);
  if (s.finance.cash < n * price) return notify(s, `Need ${formatMoney(n * price)} to cover a day of rent on ${gpuCountLabel(n, g)}.`, 'bad');
  if (legacy) s.compute.rented[g.id] = (s.compute.rented[g.id] ?? 0) + n;
  else {
    const c = ensureCloud(s);
    // Merge into a working lease of the same kind. A preempted spot lease stays separate so the new GPUs start up.
    const l = c.leases.find((x) => x.providerId === p.id && x.gpuId === g.id && x.kind === kind && leaseUp(s, x));
    if (l) l.count += n;
    else c.leases.push({ id: newId(s, 'cl'), providerId: p.id, gpuId: g.id, count: n, kind, startDay: s.day });
  }
  const capped = n < count ? ` The quota allows only ${n.toLocaleString('en-US')} more.` : '';
  notify(s, `Rented ${gpuCountLabel(n, g)} from ${p.name}${spot ? ' (spot)' : ''} (${formatMoney(n * price)}/day).${capped}`, n < count ? 'info' : 'good');
}

/** Sign a reserved contract: a discount for a fixed term, billed every day whether used or not. */
export function commitToProvider(s: GameState, providerId: Id, gpuId: Id, count: number, months: CloudTerm): void {
  const p = providerById(providerId);
  const g = gpuDef(gpuId);
  if (!p || !g) return notify(s, 'Unknown provider or GPU.', 'bad');
  if (!CLOUD_TERMS.includes(months) || p.reserved[months] === undefined) return notify(s, `${p.name} has no ${months}-month term.`, 'bad');
  if (!Number.isInteger(count) || count < 1 || count > T.MAX_ORDER) return notify(s, 'Reserve a whole number of GPUs.', 'bad');
  if (!stocks(p, g, yearOf(s.day))) return notify(s, `${p.name} does not stock ${g.name} now.`, 'bad');
  const left = quotaLeft(s, p, g);
  if (count > left) return notify(s, `${p.name} can reserve only ${left.toLocaleString('en-US')} more ${g.name} for you.`, 'bad');
  const price = reservedPrice(s, p, g, months);
  const upfront = count * price * T.COMMIT_CASH_DAYS;
  if (s.finance.cash < upfront) return notify(s, `Need ${formatMoney(upfront)} in cash (a month of the bill) to sign.`, 'bad');
  const c = ensureCloud(s);
  const endDay = s.day + Math.round(months * T.DAYS_PER_MONTH);
  c.leases.push({ id: newId(s, 'cl'), providerId: p.id, gpuId: g.id, count, kind: 'reserved', startDay: s.day, endDay, pricePerDay: price });
  notify(s, `Reserved ${gpuCountLabel(count, g)} at ${p.name} for ${months} months (${formatMoney(count * price)}/day).`, 'good');
}

/** What ending a reserved lease today costs: EARLY_EXIT_SHARE of the remaining bill. */
export function earlyExitPenalty(s: GameState, l: CloudLease): number {
  if (l.kind !== 'reserved') return 0;
  const days = Math.max(0, (l.endDay ?? s.day) - s.day);
  return T.EARLY_EXIT_SHARE * days * l.count * (l.pricePerDay ?? 0);
}

function endCommitment(s: GameState, leaseId: Id): void {
  const c = ensureCloud(s);
  const l = c.leases.find((x) => x.id === leaseId && x.kind === 'reserved');
  if (!l) return notify(s, 'No such reserved contract.', 'bad');
  const fee = earlyExitPenalty(s, l);
  if (s.finance.cash < fee) return notify(s, `Ending it early costs ${formatMoney(fee)}. Not enough cash.`, 'bad');
  addExpense(s, 'compute', fee);
  c.leases = c.leases.filter((x) => x !== l);
  const g = gpuDef(l.gpuId);
  notify(s, `Ended the ${g?.name ?? l.gpuId} reservation at ${providerById(l.providerId)?.name ?? l.providerId} early for ${formatMoney(fee)}.`, 'info');
}

export const handlers: ActionHandlers = {
  rentCloud: (s, a) => rentFromProvider(s, a.providerId, a.gpuId, a.count, !!a.spot),
  commitCloud: (s, a) => commitToProvider(s, a.providerId, a.gpuId, a.count, a.months),
  endCloudCommit: (s, a) => endCommitment(s, a.leaseId),
};

// ---------------------------------------------------------------------------
// Daily tick: crunches, preemptions, expiries. Runs before computeTick so today's bill sees today's leases.
// ---------------------------------------------------------------------------

const RNG_FLAG = 'cloud.rng';
/** The cloud market draws from its own random stream (like contracts) so it never shifts the rest of the sim's rolls. */
function withCloudRng<R>(s: GameState, fn: (rng: Rng) => R): R {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x6c0dc10d) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

export function cloudTick(s: GameState, _rng?: Rng): void {
  const c = ensureCloud(s);
  const year = yearOf(s.day);
  let preemptedPflops = 0;
  let preempted = 0;
  withCloudRng(s, (rng) => {
    for (const p of CLOUD_PROVIDERS) {
      const until = c.crunchUntil[p.id];
      if (until !== undefined && until <= s.day) delete c.crunchUntil[p.id];
      if (p.crunchPerDay <= 0 || year < p.openYear || inCrunch(s, p.id) || !rng.chance(p.crunchPerDay)) continue;
      const days = rng.int(T.CRUNCH_DAYS_MIN, T.CRUNCH_DAYS_MAX);
      c.crunchUntil[p.id] = s.day + days;
      // A toast, not a news line: news shifts the headline picker's rolls on the shared stream (events.ts).
      if (providerUsage(s, p.id) > 0) {
        notify(s, `${p.name} is out of GPUs for about ${Math.round(days / 30)} month${days >= 45 ? 's' : ''}: quotas halved, spot dearer and preempted more often.`, 'bad');
      }
    }
    for (const l of c.leases) {
      if (l.kind !== 'spot' || !leaseUp(s, l)) continue;
      const p = providerById(l.providerId);
      if (!p || !rng.chance(preemptChance(s, p))) continue;
      l.downUntil = s.day + rng.int(T.PREEMPT_DOWN_MIN, T.PREEMPT_DOWN_MAX);
      preempted += l.count;
      preemptedPflops += l.count * (gpuDef(l.gpuId)?.pflops ?? 0);
    }
  });

  // Reserved terms that ended today.
  const ended = c.leases.filter((l) => l.kind === 'reserved' && (l.endDay ?? Infinity) <= s.day);
  if (ended.length > 0) {
    c.leases = c.leases.filter((l) => !ended.includes(l));
    for (const l of ended) {
      notify(s, `Reserved ${gpuDef(l.gpuId)?.name ?? l.gpuId} × ${l.count.toLocaleString('en-US')} at ${providerById(l.providerId)?.name ?? l.providerId} ended. Renew or rent on-demand.`, 'info');
    }
  }

  if (preempted === 0) return;
  // A run loses the work its preempted GPUs did since the last checkpoint (yesterday's split, before today's refresh).
  const run = s.training;
  let lost = 0;
  if (run && s.compute.trainingPflops > 0) {
    const share = Math.min(1, preemptedPflops / Math.max(s.compute.totalPflops, preemptedPflops));
    lost = Math.min(run.doneFlops, share * s.compute.trainingPflops * 1e15 * 86_400 * T.ROLLBACK_DAYS);
    run.doneFlops -= lost;
    if (lost > 0) (run.log ??= []).push({ day: s.day, text: `Spot preemption: ${preempted.toLocaleString('en-US')} GPUs dropped; rolled back to the last checkpoint.`, kind: 'bad' });
  }
  const last = s.flags['cloud.preemptNoticeDay'] ?? -Infinity;
  if (s.day - last >= T.PREEMPT_NOTICE_DAYS) {
    s.flags['cloud.preemptNoticeDay'] = s.day;
    notify(s, `Spot: ${preempted.toLocaleString('en-US')} GPUs preempted for a day or three${lost > 0 ? ', and the training run rolled back to its last checkpoint' : ''}.`, 'bad');
  }
}
