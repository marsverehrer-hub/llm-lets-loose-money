// Shared state helpers: the writable ops view, logging, owned sets, and the data ops random stream.
import type { CustomDataset, DataJob, DataListing, DataOpsState, GameState, Id, Rng, StartupStream } from '../../types';
import { makeRng } from '../../rng';
import { DATAOPS_TUNING } from './tuning';

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export type Ops = DataOpsState & {
  jobs: DataJob[];
  listings: DataListing[];
  streams: StartupStream[];
  log: { day: number; text: string }[];
  claimedArchives: Id[];
  crawledB: number;
  soldTotal: number;
  tosExposure: number;
  nextStartupDay: number;
};

/** Writable view of the data ops state. Creates it, and fills in the array defaults, on first use. */
export function ops(s: GameState): Ops {
  const o = (s.dataOps ??= {}) as Ops;
  o.jobs ??= [];
  o.listings ??= [];
  o.streams ??= [];
  o.log ??= [];
  o.claimedArchives ??= [];
  o.crawledB ??= 0;
  o.soldTotal ??= 0;
  o.tosExposure ??= 0;
  o.nextStartupDay ??= 0;
  o.crawler ??= null;
  o.startup ??= null;
  return o;
}

export function logOp(s: GameState, text: string): void {
  const o = ops(s);
  o.log.push({ day: s.day, text });
  if (o.log.length > T.LOG_CAP) o.log.splice(0, o.log.length - T.LOG_CAP);
}

export function ensureCustom(s: GameState): CustomDataset[] {
  s.data.custom ??= [];
  return s.data.custom;
}

export function ownDataset(s: GameState, ds: CustomDataset): void {
  ensureCustom(s).push(ds);
  if (!s.data.owned.includes(ds.id)) s.data.owned.push(ds.id);
}

/** Take a set off the owned list (no refund). Used by claims and lawsuits. */
export function dropOwned(s: GameState, id: Id): void {
  s.data.owned = s.data.owned.filter((x) => x !== id);
  if (s.data.licenses) delete s.data.licenses[id];
}

/** Random stream for everything in this module. Same pattern as contracts.ts. */
const RNG_FLAG = 'dataops.rng';
export function withOpsRng<R>(s: GameState, fn: (rng: Rng) => R): R {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x5f3a9c1) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

/** True while the crawler is blocked by a Cloudflare-ish wall. */
export function crawlBlocked(s: GameState): boolean {
  return (s.dataOps?.blockedUntil ?? 0) > s.day;
}
