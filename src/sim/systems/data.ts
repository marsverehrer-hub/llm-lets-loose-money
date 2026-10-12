// OWNER: data agent. Dataset lookup (static + runtime-created), shop status, licences, contested deals,
// commissions, synthetic generation, user-data harvesting and collapse helpers. See GAME_DESIGN.md §14.
import type {
  ActionHandlers,
  Capabilities,
  CustomDataset,
  DataDomain,
  DataAcquisition,
  DataKind,
  DatasetDef,
  GameState,
  Id,
  Model,
  ProductKind,
  Rng,
} from '../types';
import { DATA_KINDS } from '../types';
import { DATASETS } from '../data/datasets';
import { GPUS } from '../data/gpus';
import { RESEARCH } from '../data/research';
import { BALANCE } from '../balance';
import { frontierQuality } from './market';
import { isResearched } from './research';
import { labName } from './labs';
import { addExpense, calendarYear, clamp, formatMoney, newId, notify, pushNews, trySpend, yearOf } from '../util';

export const DATA_TUNING = {
  /** A licence's first year is paid up front; daily accrual starts once this many days have passed. */
  LICENCE_TERM_DAYS: 365,
  COMMISSION_MIN: 25_000,
  COMMISSION_MAX: 25_000_000,
  /** $ per billion human-labelled tokens in 2017. Labour gets dearer by LABOUR_GROWTH per year. */
  LABOUR_PER_B_2017: 1_500_000,
  LABOUR_GROWTH: 0.08,
  /** Commissions and synthetic runs in flight at once (shared pending list). */
  PENDING_MAX: 4,
  SYNTH_MIN_TOKENS_B: 0.5,
  SYNTH_MAX_TOKENS_B: 5_000,
  SYNTH_MIN_DAYS: 2,
  SYNTH_MAX_DAYS: 180,
  /** Share of total cluster PFLOPS a synthetic run can borrow. */
  SYNTH_CLUSTER_SHARE: 0.5,
  /** Filtering, rejection and retries: days of pipeline per raw generation day. */
  SYNTH_PIPELINE_OVERHEAD: 3,
  /** Daily chance per contested rival, once a partnership set is on the shop shelf. */
  CONTEST_DAILY_CHANCE: 0.003,
  /** Knowledge points a rival loses per exclusive set you hold that it was contesting. */
  RIVAL_MALUS_PER_SET: 1.5,
  RIVAL_MALUS_CAP: 4,
  USER_CHATS_ID: 'user_chats_yours',
  USER_CHATS_QUALITY: 0.55,
  /** Billion tokens harvested per active chat user per day, and per active API account per day. */
  USER_CHAT_B_PER_USER_DAY: 2e-7,
  USER_API_B_PER_ACCOUNT_DAY: 5e-6,
  /** Privacy heat (0..100, flags['data.privacyHeat']): base growth per day while harvesting, plus growth at 1M users. */
  PRIVACY_HEAT_KEY: 'data.privacyHeat',
  PRIVACY_BASE_PER_DAY: 0.05,
  PRIVACY_USERS_PER_DAY: 0.25,
  PRIVACY_DECAY_PER_DAY: 0.1,
  PRIVACY_HEAT_MAX: 100,
  /** The synthetic share at which model collapse starts to bite. */
  COLLAPSE_SHARE_START: 0.4,
  /** Years before unlock at which a locked set stops appearing in the shop. */
  SHOP_PREVIEW_YEARS: 2,
};

const DOMAIN_LABEL: Record<DataDomain, string> = {
  general: 'General', code: 'Code', math: 'Maths', science: 'Science', medical: 'Medical', legal: 'Legal',
  finance: 'Finance', multilingual: 'Multilingual', creative: 'Creative', dialogue: 'Dialogue', vision: 'Vision',
  audio: 'Audio', video: 'Video', gaming: 'Gaming', robotics: 'Robotics', safety: 'Safety', news: 'News',
};
const KIND_LABEL: Record<DataKind, string> = {
  web: 'web pages', books: 'prose', code: 'code reviews', science: 'lab write-ups', dialogue: 'dialogue pairs',
  synthetic: 'textbook passages', multimodal: 'captioned clips',
};
/** Capability nudges for commissioned sets, by kind (scaled like any dataset bonus). */
const COMMISSION_CAP: Record<DataKind, Partial<Capabilities>> = {
  web: { knowledge: 0.5 },
  books: { knowledge: 0.5, reasoning: 0.5 },
  code: { coding: 1, agentic: 0.5 },
  science: { math: 1, knowledge: 0.5 },
  dialogue: { chat: 2 },
  synthetic: { reasoning: 1, math: 0.5 },
  multimodal: { vision: 3 },
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Every dataset definition the player could hold: the static catalogue plus runtime-created ones. */
export function allDatasets(s: GameState): DatasetDef[] {
  const custom = s.data.custom ?? [];
  return custom.length ? [...DATASETS, ...custom] : DATASETS;
}

/** Look up any dataset (static or custom) by id. ALWAYS use this instead of DATASETS.find. Refinery overrides apply here (systems/dataOps.ts). */
export function datasetById(s: GameState, id: Id): DatasetDef | undefined {
  const base = DATASETS.find((d) => d.id === id) ?? s.data.custom?.find((d) => d.id === id);
  return base ? refinedView(s, base) : undefined;
}

/**
 * The definition with any refinery override applied. Cached per base object (keyed on the override values) so the
 * view's identity is stable, which the true-quality memo relies on.
 */
const REFINED_VIEWS = new WeakMap<DatasetDef, DatasetDef>();
function refinedView(s: GameState, base: DatasetDef): DatasetDef {
  const r = s.data.refined?.[base.id];
  if (!r) return base;
  const hit = REFINED_VIEWS.get(base);
  if (hit && hit.quality === r.quality && hit.tokensB === r.tokensB) return hit;
  const view: DatasetDef = { ...base, quality: r.quality, tokensB: r.tokensB };
  REFINED_VIEWS.set(base, view);
  return view;
}

// ---------------------------------------------------------------------------
// Hidden truths (GAME_DESIGN 16.1): seeded, so the same seed always gives the same world.
// ---------------------------------------------------------------------------

/** Uniform [0,1) from (seed, key). Pure: the same inputs always give the same number. */
export function hashUniform(seed: number, key: string): number {
  let h1 = 0xdeadbeef ^ (seed | 0);
  let h2 = 0x41c6ce57 ^ (seed | 0);
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const u = ((h2 >>> 0) + (h1 >>> 0) / 4294967296) / 4294967296;
  return Math.min(1 - 1e-12, Math.max(1e-12, u));
}

/** N(0, sd) from (seed, key), via Box-Muller on two independent hashed uniforms. */
export function hashNormal(seed: number, key: string, sd: number): number {
  const u1 = hashUniform(seed, `${key}#a`);
  const u2 = hashUniform(seed, `${key}#b`);
  return sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** How far a dataset's true quality can sit from its claimed quality (SD). Commissioned sets are nearly honest. */
const ACQUISITION_QUALITY_SD: Record<DataAcquisition, number> = {
  scrape: 0.12,
  crowdsource: 0.08,
  open: 0.07,
  purchase: 0.05,
  license: 0.03,
  partnership: 0.03,
  generate: 0.06,
  userdata: 0.1,
};
const COMMISSION_QUALITY_SD = 0.02;
/**
 * Claimed quality is optimistic for some sources: the true quality of scraped and crowd-sourced sets sits a little
 * below the card on average (SEO spam, rushed labels). Mean of the offset, before the seeded spread.
 */
const ACQUISITION_QUALITY_MEAN: Record<DataAcquisition, number> = {
  scrape: -0.05,
  crowdsource: -0.02,
  open: 0,
  purchase: 0,
  license: 0,
  partnership: 0,
  generate: -0.02,
  userdata: -0.03,
};

export function datasetQualityMean(d: DatasetDef): number {
  if ((d as CustomDataset).source === 'commission') return 0;
  return ACQUISITION_QUALITY_MEAN[d.acquisition ?? 'purchase'];
}

export function datasetQualitySd(d: DatasetDef): number {
  if ((d as CustomDataset).source === 'commission') return COMMISSION_QUALITY_SD;
  return ACQUISITION_QUALITY_SD[d.acquisition ?? 'purchase'];
}

/** The TRUE quality of a dataset (0..1): claimed plus a seeded offset. Only the sim reads this; the UI sees it after an audit or a run. */
/** Memo per dataset object: the true quality depends only on the seed and the definition, so it is computed once. */
const TRUE_QUALITY_MEMO = new WeakMap<DatasetDef, { seed: number; q: number }>();
export function trueQualityOf(s: GameState, d: DatasetDef): number {
  const hit = TRUE_QUALITY_MEMO.get(d);
  if (hit && hit.seed === s.seed) return hit.q;
  const offset = datasetQualityMean(d) + hashNormal(s.seed, `dq:${d.id}`, datasetQualitySd(d));
  const q = clamp(d.quality + offset, 0.05, 0.98);
  TRUE_QUALITY_MEMO.set(d, { seed: s.seed, q });
  return q;
}

/** True once the lab has measured the set (a finished run used it, or an audit). */
export function isVerifiedData(s: GameState, id: Id): boolean {
  const v = s.lab?.verifiedData;
  return !!v && v.includes(id);
}

/** The quality the lab believes: the claimed value until verified, then the true one. */
export function believedQualityOf(s: GameState, d: DatasetDef): number {
  return isVerifiedData(s, d.id) ? trueQualityOf(s, d) : d.quality;
}

function ensureData(s: GameState): void {
  if (!s.data.custom) s.data.custom = [];
  if (!s.data.licenses) s.data.licenses = {};
  if (!s.data.pending) s.data.pending = [];
  if (!s.data.lost) s.data.lost = [];
}

function researchName(id: Id): string {
  return RESEARCH.find((r) => r.id === id)?.name ?? id;
}

function liveUsers(s: GameState, kind: ProductKind): number {
  return s.products.reduce((sum, p) => (p.active && p.kind === kind ? sum + p.users : sum), 0);
}

function bestReleasedOverall(s: GameState): number {
  return s.models.reduce((best, m) => (m.releasedDay !== null && !m.deprecated ? Math.max(best, m.overall) : best), 0);
}

/** Why a static set can't be bought yet, or null when every gate is open. */
function gateReason(s: GameState, d: DatasetDef): string | null {
  const year = calendarYear(s.day);
  if (year < d.unlockYear) return `opens in ${d.unlockYear}`;
  if (d.requiresResearch && !isResearched(s, d.requiresResearch)) return `needs research: ${researchName(d.requiresResearch)}`;
  if (d.requiresProduct && !s.products.some((p) => p.active && p.kind === d.requiresProduct)) return `needs a live ${d.requiresProduct} product`;
  if (d.requiresModelOverall !== undefined && bestReleasedOverall(s) < d.requiresModelOverall) {
    return `needs a released model at ${d.requiresModelOverall} overall`;
  }
  return null;
}

function isRevealed(s: GameState, d: DatasetDef): boolean {
  return !d.secret || !!s.flags[`revealed.${d.id}`];
}

// ---------------------------------------------------------------------------
// Shop view
// ---------------------------------------------------------------------------

export type DatasetStatus = 'owned' | 'available' | 'locked' | 'lost' | 'pending';
export interface DatasetRow {
  def: DatasetDef;
  status: DatasetStatus;
  /** Why it's locked / lost, or when it lands for pending rows. */
  reason?: string;
}

/**
 * Shop rows: static catalogue sets within reach (secret sets only once revealed, not sets far in the future),
 * then pending commissions and generations, then player-made sets that are owned.
 */
export function availableDatasetsV2(s: GameState): DatasetRow[] {
  const year = calendarYear(s.day);
  const owned = new Set(s.data.owned);
  const lost = new Set(s.data.lost ?? []);
  const rows: DatasetRow[] = [];
  for (const catalogueDef of DATASETS) {
    if (!isRevealed(s, catalogueDef)) continue;
    if (catalogueDef.unlockYear - year > DATA_TUNING.SHOP_PREVIEW_YEARS) continue;
    const def = datasetById(s, catalogueDef.id) ?? catalogueDef;
    if (owned.has(def.id)) rows.push({ def, status: 'owned' });
    else if (lost.has(def.id)) rows.push({ def, status: 'lost', reason: 'Signed by a rival lab' });
    else {
      const reason = gateReason(s, def);
      rows.push(reason ? { def, status: 'locked', reason } : { def, status: 'available' });
    }
  }
  for (const p of s.data.pending ?? []) {
    rows.push({ def: p.dataset, status: 'pending', reason: `ready in ${Math.max(0, p.readyDay - s.day)} days` });
  }
  for (const c of s.data.custom ?? []) if (owned.has(c.id)) rows.push({ def: c, status: 'owned' });
  return rows;
}

// ---------------------------------------------------------------------------
// Buying and licences
// ---------------------------------------------------------------------------

/**
 * Buy a static set (or a visible partnership). Licence and partnership sets pay the signing fee plus the first year
 * up front and record `licenses[id] = day`; dataTick then charges annualFee/365 daily from the next year on.
 * Returns true when the set was added to owned. buyDataset in training.ts should route here.
 */
export function buyDatasetV2(s: GameState, id: Id): boolean {
  ensureData(s);
  const d = DATASETS.find((x) => x.id === id);
  if (!d || !isRevealed(s, d)) {
    notify(s, 'Unknown dataset.', 'bad');
    return false;
  }
  if (s.data.owned.includes(id)) {
    notify(s, `You already own ${d.name}.`, 'info');
    return false;
  }
  if (s.data.lost!.includes(id)) {
    notify(s, `${d.name} was signed by a rival lab.`, 'bad');
    return false;
  }
  if (s.data.pending!.some((p) => p.id === id)) {
    notify(s, `${d.name} is still being made.`, 'info');
    return false;
  }
  const reason = gateReason(s, d);
  if (reason) {
    notify(s, `${d.name} is not available yet: ${reason}.`, 'bad');
    return false;
  }
  const licensed = d.acquisition === 'license' || d.acquisition === 'partnership';
  const annual = licensed ? d.annualFee ?? 0 : 0;
  const upfront = d.cost + annual;
  if (upfront > 0 && !trySpend(s, 'data', upfront, d.name)) return false;
  s.data.owned.push(id);
  if (licensed) {
    s.data.licenses![id] = s.day;
    const after = annual > 0 ? ` First year paid. ${formatMoney(annual)}/yr from next year.` : '';
    const excl = d.exclusive ? ' Exclusive, so rivals will sulk.' : '';
    notify(s, `${d.acquisition === 'partnership' ? 'Signed' : 'Licensed'} ${d.name}.${after}${excl}`, 'good');
  } else {
    notify(s, `Bought ${d.name} (${d.tokensB.toLocaleString('en-US')}B tokens).`, 'good');
  }
  return true;
}

/** Stop a licence. The set leaves owned and the fee stops. Models already trained keep what they learned. */
export function cancelLicenceDeal(s: GameState, id: Id): boolean {
  ensureData(s);
  const d = datasetById(s, id);
  const name = d?.name ?? id;
  if (s.data.licenses![id] === undefined) {
    notify(s, `You don't hold a licence on ${name}.`, 'bad');
    return false;
  }
  s.data.owned = s.data.owned.filter((x) => x !== id);
  delete s.data.licenses![id];
  notify(s, `Cancelled ${name}. Models trained on it keep their homework.`, 'info');
  return true;
}

// ---------------------------------------------------------------------------
// Commissions (human labelers)
// ---------------------------------------------------------------------------

/** $ per billion tokens of human-written data this year (flags['data.labourCostMult'] from events scales it). */
export function commissionCostPerB(s: GameState): number {
  const labourMult = s.flags['data.labourCostMult'] ?? 1;
  return DATA_TUNING.LABOUR_PER_B_2017 * (1 + DATA_TUNING.LABOUR_GROWTH * Math.max(0, yearOf(s.day) - 2017)) * labourMult;
}

/** What a commission of this budget would yield (tokens, days, quality). Pure, for the UI and the handler. */
export function commissionQuote(s: GameState, budget: number): { tokensB: number; days: number; quality: number } {
  const tokensB = Math.round((budget / commissionCostPerB(s)) * 1000) / 1000;
  const days = Math.round(clamp(20 + 40 * clamp(budget / 5_000_000, 0, 1), 20, 60));
  const quality = clamp(0.85 + 0.1 * clamp(budget / 3_000_000, 0, 1), 0.85, 0.95);
  return { tokensB, days, quality };
}

// ---------------------------------------------------------------------------
// Synthetic generation
// ---------------------------------------------------------------------------

/** Cheapest $ per PFLOP-day among GPUs already on sale in `year`. */
function cheapestPfDayPrice(year: number): number {
  let best = Infinity;
  for (const g of GPUS) if (g.unlockYear <= year && g.pflops > 0) best = Math.min(best, g.rentPerDay / g.pflops);
  return Number.isFinite(best) ? best : 0;
}

export type SyntheticQuote =
  | { ok: true; days: number; cost: number; quality: number; collapseRisk: number; modelName: string }
  | { ok: false; reason: string };

/**
 * Price a synthetic run from a released model. Throughput comes from the cluster share, cost is that share's
 * rent for the run's days, quality = clamp(overall/100 x 0.95, 0.2, 0.92). Far-behind models risk collapse.
 */
export function syntheticQuote(s: GameState, modelId: Id, tokensB: number): SyntheticQuote {
  if (!isResearched(s, 'synthetic_data')) return { ok: false, reason: 'Needs the synthetic data research first.' };
  const model: Model | undefined = s.models.find((m) => m.id === modelId);
  if (!model || model.releasedDay === null) return { ok: false, reason: 'Only a released model can write synthetic data.' };
  if (!Number.isFinite(tokensB) || tokensB < DATA_TUNING.SYNTH_MIN_TOKENS_B || tokensB > DATA_TUNING.SYNTH_MAX_TOKENS_B) {
    return { ok: false, reason: `Synthetic runs make ${DATA_TUNING.SYNTH_MIN_TOKENS_B}B to ${DATA_TUNING.SYNTH_MAX_TOKENS_B}B tokens.` };
  }
  if ((s.data.pending ?? []).length >= DATA_TUNING.PENDING_MAX) return { ok: false, reason: 'Too many runs in flight. Let them finish.' };
  const clusterPf = s.compute.totalPflops * DATA_TUNING.SYNTH_CLUSTER_SHARE;
  if (!(clusterPf > 0)) return { ok: false, reason: 'No compute to generate with. Rent or buy GPUs first.' };
  const year = yearOf(s.day);
  const flopsPerDay = clusterPf * 1e15 * 86_400 * BALANCE.BASE_INFERENCE_EFFICIENCY;
  const flopsPerToken = 2 * (model.activeParamsB ?? model.paramsB) * 1e9;
  const tokensPerDayB = flopsPerDay / flopsPerToken / 1e9;
  const rawDays = tokensB / tokensPerDayB;
  const days = Math.max(DATA_TUNING.SYNTH_MIN_DAYS, Math.ceil(rawDays * DATA_TUNING.SYNTH_PIPELINE_OVERHEAD));
  if (days > DATA_TUNING.SYNTH_MAX_DAYS) {
    return { ok: false, reason: `That would take ${days} days on your cluster. Shrink the run or add GPUs.` };
  }
  const cost = days * clusterPf * cheapestPfDayPrice(Math.floor(year));
  const gap = frontierQuality(year) - model.overall;
  const collapseRisk = gap > 10
    ? clamp(0.6 + (gap - 10) / 50, 0.6, 0.95)
    : clamp(0.05 + Math.max(0, gap) / 60, 0.05, 0.25);
  let quality = clamp((model.overall / 100) * 0.95, 0.2, 0.92);
  if (isResearched(s, 'rejection_sampling')) quality += 0.02;
  if (isResearched(s, 'synthetic_textbooks')) quality += 0.02;
  return { ok: true, days, cost, quality: clamp(quality, 0.2, 0.95), collapseRisk, modelName: model.name };
}

// ---------------------------------------------------------------------------
// Your users' chats
// ---------------------------------------------------------------------------

function userChatsSet(s: GameState): CustomDataset | undefined {
  return (s.data.custom ?? []).find((c) => c.id === DATA_TUNING.USER_CHATS_ID);
}

function createUserChatsSet(s: GameState): CustomDataset {
  const year = calendarYear(s.day);
  const ds: CustomDataset = {
    id: DATA_TUNING.USER_CHATS_ID,
    name: "Your Users' Chats",
    kind: 'dialogue',
    domain: 'dialogue',
    acquisition: 'userdata',
    tokensB: 0,
    quality: DATA_TUNING.USER_CHATS_QUALITY,
    cost: 0,
    legalRisk: 0.35,
    reputationRisk: 0.25,
    unlockYear: year,
    freshnessYear: year,
    flavor: 'Everything your users typed, minus the parts they asked us to forget. We are still deciding which parts those are.',
    source: 'userdata',
    createdDay: s.day,
  };
  s.data.custom!.push(ds);
  return ds;
}

// ---------------------------------------------------------------------------
// Collapse and rivals (helpers for training and competitors)
// ---------------------------------------------------------------------------

/** Share of the token mass (across the given ids) that is synthetic-kind. 0 when empty. */
export function syntheticShare(datasetIds: readonly Id[], s: GameState): number {
  let total = 0;
  let synth = 0;
  for (const id of new Set(datasetIds)) {
    const d = datasetById(s, id);
    if (!d) continue;
    total += d.tokensB;
    if (d.kind === 'synthetic') synth += d.tokensB;
  }
  return total > 0 ? synth / total : 0;
}

/**
 * Quality multiplier for a training run on these datasets (1 = no collapse). Above a 40% synthetic share the
 * run loses up to ~40% of its quality, scaled by how collapse-prone the synthetic sets are. Training should
 * multiply its data quality by this.
 */
export function collapsePenalty(s: GameState, datasetIds: readonly Id[]): number {
  const share = syntheticShare(datasetIds, s);
  if (share <= DATA_TUNING.COLLAPSE_SHARE_START) return 1;
  let synthTokens = 0;
  let riskWeighted = 0;
  for (const id of new Set(datasetIds)) {
    const d = datasetById(s, id);
    if (!d || d.kind !== 'synthetic') continue;
    synthTokens += d.tokensB;
    riskWeighted += d.tokensB * ((d as CustomDataset).collapseRisk ?? 0);
  }
  const risk = synthTokens > 0 ? riskWeighted / synthTokens : 0;
  const ramp = clamp((share - DATA_TUNING.COLLAPSE_SHARE_START) / (1 - DATA_TUNING.COLLAPSE_SHARE_START), 0, 1);
  return clamp(1 - ramp * (0.05 + 0.35 * risk), 0.6, 1);
}

/**
 * Knowledge points a rival lab loses while you hold exclusive sets it was contesting. Competitors subtract this
 * from their knowledge capability. 0 when none.
 */
export function rivalExclusiveMalus(s: GameState, competitorId: Id): number {
  let malus = 0;
  for (const id of s.data.owned) {
    const d = DATASETS.find((x) => x.id === id) ?? s.data.custom?.find((x) => x.id === id);
    if (d?.exclusive && d.contestedBy?.includes(competitorId)) malus += DATA_TUNING.RIVAL_MALUS_PER_SET;
  }
  return Math.min(DATA_TUNING.RIVAL_MALUS_CAP, malus);
}

/** Summary numbers for the data screen. */
export function dataStats(s: GameState): {
  owned: number;
  totalTokensB: number;
  licences: number;
  licenceCostPerYear: number;
  pending: number;
  userChatsTokensB: number;
} {
  const licenses = s.data.licenses ?? {};
  let totalTokensB = 0;
  let licences = 0;
  let licenceCostPerYear = 0;
  for (const id of s.data.owned) {
    const d = datasetById(s, id);
    if (!d) continue;
    totalTokensB += d.tokensB;
    if (licenses[id] !== undefined) {
      licences += 1;
      licenceCostPerYear += d.annualFee ?? 0;
    }
  }
  return {
    owned: s.data.owned.length,
    totalTokensB,
    licences,
    licenceCostPerYear,
    pending: (s.data.pending ?? []).length,
    userChatsTokensB: userChatsSet(s)?.tokensB ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

export function dataTick(s: GameState, rng: Rng): void {
  ensureData(s);
  deliverPending(s);
  chargeLicences(s);
  contestDeals(s, rng);
  harvestUserData(s);
}

function deliverPending(s: GameState): void {
  const ready = s.data.pending!.filter((p) => p.readyDay <= s.day);
  if (!ready.length) return;
  s.data.pending = s.data.pending!.filter((p) => p.readyDay > s.day);
  for (const p of ready) {
    const ds = p.dataset;
    if (!s.data.custom!.some((c) => c.id === ds.id)) s.data.custom!.push(ds);
    if (!s.data.owned.includes(ds.id)) s.data.owned.push(ds.id);
    if (ds.source === 'synthetic') {
      const risky = (ds.collapseRisk ?? 0) > 0.5;
      notify(s, `Synthetic run finished: ${ds.name}, ${ds.tokensB.toLocaleString('en-US')}B tokens.${risky ? ' Some of it is quoting itself.' : ''}`, risky ? 'bad' : 'good');
    } else {
      notify(s, `Labelers finished ${ds.name}: ${ds.tokensB}B tokens at quality ${ds.quality.toFixed(2)}.`, 'good');
    }
  }
}

function chargeLicences(s: GameState): void {
  const licenses = s.data.licenses!;
  for (const [id, start] of Object.entries(licenses)) {
    const d = datasetById(s, id);
    if (!d || !s.data.owned.includes(id)) {
      delete licenses[id];
      continue;
    }
    if (s.day - start >= DATA_TUNING.LICENCE_TERM_DAYS && d.annualFee) addExpense(s, 'data', d.annualFee / 365);
  }
}

/** Partnership sets on the shelf can be signed by a rival, a small daily chance each. Those go into lost. */
function contestDeals(s: GameState, rng: Rng): void {
  for (const d of DATASETS) {
    if (d.acquisition !== 'partnership' || !d.contestedBy?.length) continue;
    if (s.data.owned.includes(d.id) || s.data.lost!.includes(d.id)) continue;
    if (!isRevealed(s, d) || gateReason(s, d)) continue;
    for (const rivalId of d.contestedBy) {
      const rival = s.competitors.find((c) => c.id === rivalId);
      if (!rival?.active) continue;
      if (!rng.chance(DATA_TUNING.CONTEST_DAILY_CHANCE)) continue;
      s.data.lost!.push(d.id);
      const name = labName(s, rivalId);
      pushNews(s, `${name} signs exclusive deal with ${d.name}. Your procurement team sends a passive-aggressive email.`, 'bad');
      break;
    }
  }
}

function harvestUserData(s: GameState): void {
  const heatKey = DATA_TUNING.PRIVACY_HEAT_KEY;
  if (!s.data.userDataOptIn) {
    s.flags[heatKey] = clamp((s.flags[heatKey] ?? 0) - DATA_TUNING.PRIVACY_DECAY_PER_DAY, 0, DATA_TUNING.PRIVACY_HEAT_MAX);
    return;
  }
  const chat = liveUsers(s, 'chat');
  const api = liveUsers(s, 'api');
  const users = chat + api;
  let ds = userChatsSet(s);
  if (!ds) ds = createUserChatsSet(s);
  if (!s.data.owned.includes(ds.id)) s.data.owned.push(ds.id);
  ds.tokensB += chat * DATA_TUNING.USER_CHAT_B_PER_USER_DAY + api * DATA_TUNING.USER_API_B_PER_ACCOUNT_DAY;
  s.flags['data.userChatsDays'] = (s.flags['data.userChatsDays'] ?? 0) + 1;
  if (users > 0) {
    const grow = DATA_TUNING.PRIVACY_BASE_PER_DAY + DATA_TUNING.PRIVACY_USERS_PER_DAY * clamp(users / 1_000_000, 0, 1);
    s.flags[heatKey] = clamp((s.flags[heatKey] ?? 0) + grow, 0, DATA_TUNING.PRIVACY_HEAT_MAX);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const MAX_NAME = 60;

export const handlers: ActionHandlers = {
  cancelLicense: (s, a) => {
    cancelLicenceDeal(s, a.datasetId);
  },

  commissionDataset: (s, a) => {
    ensureData(s);
    if (!DATA_KINDS.includes(a.kind) || !(a.domain in DOMAIN_LABEL)) {
      notify(s, 'Pick a real kind of data and domain.', 'bad');
      return;
    }
    if (!Number.isFinite(a.budget) || a.budget < DATA_TUNING.COMMISSION_MIN || a.budget > DATA_TUNING.COMMISSION_MAX) {
      notify(s, `Commissions run ${formatMoney(DATA_TUNING.COMMISSION_MIN, 0)} to ${formatMoney(DATA_TUNING.COMMISSION_MAX, 0)}.`, 'bad');
      return;
    }
    if (s.data.pending!.length >= DATA_TUNING.PENDING_MAX) {
      notify(s, 'Too many jobs in flight. Let the labelers finish.', 'bad');
      return;
    }
    const quote = commissionQuote(s, a.budget);
    if (!trySpend(s, 'data', a.budget, 'the labeling contract')) return;
    const id = newId(s, 'cmsn_');
    const year = calendarYear(s.day);
    const label = `${DOMAIN_LABEL[a.domain]} ${KIND_LABEL[a.kind]}`;
    const name = a.name?.trim().slice(0, MAX_NAME) || `Contractor ${label}, batch ${s.idCounter}`;
    const ds: CustomDataset = {
      id,
      name,
      kind: a.kind,
      domain: a.domain,
      acquisition: 'crowdsource',
      tokensB: quote.tokensB,
      quality: quote.quality,
      cost: a.budget,
      legalRisk: 0.02,
      unlockYear: year,
      freshnessYear: year,
      capBonus: COMMISSION_CAP[a.kind],
      flavor: `Written by hand, slowly, by people who were paid to care. ${label}.`,
      source: 'commission',
      createdDay: s.day,
    };
    s.data.pending!.push({ id, readyDay: s.day + quote.days, dataset: ds });
    notify(s, `Commissioned ${name}: about ${quote.tokensB}B tokens, ready in ${quote.days} days.`, 'info');
  },

  generateSynthetic: (s, a) => {
    ensureData(s);
    const q = syntheticQuote(s, a.modelId, a.tokensB);
    if (!q.ok) {
      notify(s, q.reason, 'bad');
      return;
    }
    if (!(a.domain in DOMAIN_LABEL)) {
      notify(s, 'Pick a real domain.', 'bad');
      return;
    }
    if (!trySpend(s, 'data', q.cost, 'synthetic data')) return;
    const id = newId(s, 'synth_');
    const year = calendarYear(s.day);
    const name = a.name?.trim().slice(0, MAX_NAME) || `Synthetic ${DOMAIN_LABEL[a.domain]} (${q.modelName})`;
    const ds: CustomDataset = {
      id,
      name,
      kind: 'synthetic',
      domain: a.domain,
      acquisition: 'generate',
      tokensB: a.tokensB,
      quality: q.quality,
      cost: q.cost,
      legalRisk: 0.02,
      reputationRisk: q.collapseRisk > 0.5 ? 0.15 : 0.02,
      unlockYear: year,
      freshnessYear: year,
      capBonus: { reasoning: 0.5, math: 1 },
      flavor: `Written by ${q.modelName} over ${q.days} days. Some of it is even true.`,
      source: 'synthetic',
      createdDay: s.day,
      collapseRisk: q.collapseRisk,
    };
    s.data.pending!.push({ id, readyDay: s.day + q.days, dataset: ds });
    notify(s, `Generating ${name}: ${a.tokensB}B tokens over ${q.days} days.`, 'info');
  },

  setUserDataOptIn: (s, a) => {
    ensureData(s);
    const on = !!a.on;
    if (on === !!s.data.userDataOptIn) {
      notify(s, on ? 'Already harvesting your users\' chats.' : 'Chat harvesting is already off.', 'info');
      return;
    }
    s.data.userDataOptIn = on;
    if (on) {
      let ds = userChatsSet(s);
      if (!ds) ds = createUserChatsSet(s);
      if (!s.data.owned.includes(ds.id)) s.data.owned.push(ds.id);
      s.flags[DATA_TUNING.PRIVACY_HEAT_KEY] = clamp((s.flags[DATA_TUNING.PRIVACY_HEAT_KEY] ?? 0) + 2, 0, DATA_TUNING.PRIVACY_HEAT_MAX);
      notify(s, 'Chats will be harvested for training. Terms updated. Users saw a banner that said "Okay".', 'info');
    } else {
      const got = userChatsSet(s)?.tokensB ?? 0;
      notify(s, `Chat harvesting off. The ${got.toLocaleString('en-US', { maximumFractionDigits: 1 })}B tokens gathered so far stay in the vault.`, 'info');
    }
  },
};
