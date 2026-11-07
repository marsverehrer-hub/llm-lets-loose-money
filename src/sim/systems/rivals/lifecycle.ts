// v19: labs are founded (at most RIVAL_TUNING.MAX_ACTIVE active), go bankrupt, or get acquired. Package B3.
import type { Competitor, CompetitorDef, GameState, GpuDef, Id, RivalKind, RivalLab, Rng } from '../../types';
import { COMPETITORS } from '../../data/competitors';
import { GPUS } from '../../data/gpus';
import { calendarYear, formatMoney, pushNews } from '../../util';
import { RIVAL_TUNING } from './tuning';

// B3 constants live here (tuning.ts belongs to the brain package).
const FOUNDING_STAFF: Record<RivalKind, [number, number]> = {
  frontier: [6, 12], open: [2, 4], startup: [4, 8], sovereign: [6, 12], chip: [6, 12], bigtech: [6, 12],
};
const FOUNDING_GPUS: Record<RivalKind, number> = {
  frontier: 64, open: 8, startup: 32, sovereign: 256, chip: 512, bigtech: 512,
};
const GPU_GROWTH = 1.6;
const GPU_CAP = 20_000;
const ACQUIRE_EVERY_DAYS = 30;
const ACQUIRE_ROLL = 0.12;
const ACQUIRE_PREMIUM = 1.3;
/** A lab worth under this share of an active acquirer is a takeover candidate even without fate 'target'. */
const TARGET_VALUATION_SHARE = 0.1;
const STAFF_KEYS = ['research', 'engineering', 'safety', 'sales'] as const;

/** Founding cash for a kind in a calendar year (used when the def does not give startCash). */
export function foundingCash(kind: RivalKind, year: number): number {
  switch (kind) {
    case 'frontier': return 40e6 * 1.35 ** (year - 2017);
    case 'open': return 2e6;
    case 'startup': return 15e6 * 1.3 ** (year - 2020);
    case 'sovereign': return 150e6;
    case 'chip': return 300e6;
    case 'bigtech': return 1e9 * 1.25 ** (year - 2017);
  }
}

/** The best (highest pflops) GPU unlocked by a year, or undefined. */
export function bestGpuOf(year: number): Id | undefined {
  let best: GpuDef | undefined;
  for (const g of GPUS) if (g.unlockYear <= year && (!best || g.pflops >= best.pflops)) best = g;
  return best?.id;
}

/** Founding GPU count for a kind in a year, capped. */
export function foundingGpus(kind: RivalKind, year: number): number {
  return Math.min(GPU_CAP, Math.floor(FOUNDING_GPUS[kind] * GPU_GROWTH ** (year - 2017)));
}

function labOf(s: GameState, id: Id): RivalLab | undefined {
  return s.rivals?.find((l) => l.id === id);
}

function compOf(s: GameState, id: Id): Competitor | undefined {
  return s.competitors.find((c) => c.id === id);
}

function isActive(s: GameState, def: CompetitorDef): boolean {
  const lab = labOf(s, def.id);
  const c = compOf(s, def.id);
  return !!lab && !!c && !c.human && lab.status === 'active' && c.active;
}

/** Whether a founded-by-year lab may open now (the active cap). */
export function canActivate(s: GameState, def: CompetitorDef): boolean {
  const status = labOf(s, def.id)?.status;
  if (status === 'acquired' || status === 'bankrupt') return false;
  return s.competitors.filter((c) => c.active && !c.human).length < RIVAL_TUNING.MAX_ACTIVE;
}

/** A fresh lab record for a definition (B3 sets starting cash, GPUs and staff from the def and the year). */
export function newRivalLab(def: CompetitorDef): RivalLab {
  return {
    id: def.id,
    status: 'unfounded',
    foundedDay: null,
    cash: def.startCash ?? 0,
    negativeDays: 0,
    totalRaised: 0,
    gpusRented: { ...(def.startGpus ?? {}) },
    gpusOwned: {},
    staff: { research: 2, engineering: 1, safety: 0, sales: 0 },
    research: [],
    researching: null,
    rp: 0,
    datasets: [],
    run: null,
    models: [],
    ready: null,
    publishedData: [],
    plan: null,
    planHistory: [],
    log: [],
  };
}

/** Daily lifecycle step for every lab (founding queue, bankruptcy, acquisitions). */
export function lifecycleDay(s: GameState, rng: Rng): void {
  const year = calendarYear(s.day);
  for (const def of COMPETITORS) {
    const lab = labOf(s, def.id);
    const c = compOf(s, def.id);
    if (!lab || !c || c.human) continue;
    if (lab.status === 'unfounded' && c.active) found(s, def, lab, rng, year);
  }
  for (const def of COMPETITORS) if (isActive(s, def)) checkBankruptcy(s, def);
  if (s.day % ACQUIRE_EVERY_DAYS === 0) acquisitions(s, rng);
}

function found(s: GameState, def: CompetitorDef, lab: RivalLab, rng: Rng, year: number): void {
  const kind: RivalKind = def.kind ?? 'frontier';
  lab.status = 'active';
  lab.foundedDay = s.day;
  if (def.startCash === undefined) lab.cash = foundingCash(kind, year);
  if (def.startGpus === undefined) {
    const gpu = bestGpuOf(year);
    lab.gpusRented = gpu ? { [gpu]: foundingGpus(kind, year) } : {};
  }
  const [lo, hi] = FOUNDING_STAFF[kind];
  const total = rng.int(lo, hi);
  const research = Math.ceil(total * 0.5);
  const safety = def.personality === 'safety' ? Math.floor(total * 0.2) : 0;
  lab.staff = { research, engineering: total - research - safety, safety, sales: 0 };
}

function checkBankruptcy(s: GameState, def: CompetitorDef): void {
  const lab = labOf(s, def.id)!;
  const c = compOf(s, def.id)!;
  lab.negativeDays = lab.cash < 0 ? lab.negativeDays + 1 : 0;
  if (lab.negativeDays < RIVAL_TUNING.BANKRUPT_DAYS) return;
  lab.status = 'bankrupt';
  lab.endedDay = s.day;
  c.active = false;
  c.model = null;
  for (const [gpu, n] of Object.entries(lab.gpusOwned)) {
    const key = `usedGpus.${gpu}`;
    s.flags[key] = (s.flags[key] ?? 0) + n;
  }
  lab.gpusOwned = {};
  lab.gpusRented = {};
  lab.run = null;
  lab.ready = null;
  lab.researching = null;
  pushNews(s, `${def.name} runs out of money. Its GPUs are on eBay by Friday.`, 'bad');
}

/** Every 30 days: each candidate rolls once; the biggest acquirer that can pay buys it. */
function acquisitions(s: GameState, rng: Rng): void {
  const acquirers = COMPETITORS.filter((d) => d.fate === 'acquirer' && isActive(s, d));
  if (acquirers.length === 0) return;
  const valOf = (id: Id) => compOf(s, id)?.valuation ?? 0;
  for (const def of COMPETITORS) {
    if (!isActive(s, def) || def.fate === 'acquirer') continue;
    const v = valOf(def.id);
    const candidate = def.fate === 'target' || acquirers.some((a) => v < TARGET_VALUATION_SHARE * valOf(a.id));
    if (!candidate || !rng.chance(ACQUIRE_ROLL)) continue;
    const price = v * ACQUIRE_PREMIUM;
    const buyer = acquirers
      .filter((a) => a.id !== def.id && labOf(s, a.id)!.cash >= price && isActive(s, a))
      .sort((a, b) => valOf(b.id) - valOf(a.id))[0];
    if (buyer) acquire(s, buyer, def, price);
  }
}

function acquire(s: GameState, buyer: CompetitorDef, target: CompetitorDef, price: number): void {
  const a = labOf(s, buyer.id)!;
  const t = labOf(s, target.id)!;
  const tc = compOf(s, target.id)!;
  for (const [gpu, n] of Object.entries(t.gpusRented)) a.gpusRented[gpu] = (a.gpusRented[gpu] ?? 0) + n;
  for (const [gpu, n] of Object.entries(t.gpusOwned)) a.gpusOwned[gpu] = (a.gpusOwned[gpu] ?? 0) + n;
  t.gpusRented = {};
  t.gpusOwned = {};
  for (const k of STAFF_KEYS) {
    const moved = Math.floor(t.staff[k] / 2);
    a.staff[k] += moved;
    t.staff[k] -= moved;
  }
  a.research = [...new Set([...a.research, ...t.research])];
  a.datasets = [...new Set([...a.datasets, ...t.datasets])];
  a.models.push(...t.models);
  t.models = [];
  a.cash -= price;
  t.status = 'acquired';
  t.acquiredBy = buyer.id;
  t.endedDay = s.day;
  t.run = null;
  t.ready = null;
  t.researching = null;
  tc.active = false;
  tc.model = null;
  pushNews(s, `${buyer.name} acquires ${target.name} for ${formatMoney(price)}.`, 'milestone');
}
