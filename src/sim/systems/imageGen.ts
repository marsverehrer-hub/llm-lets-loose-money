// v16 (GAME_DESIGN §28.2): image and video generation models. A self-contained line of business beside the language
// models: its own run sheet and physics, data, arena, rival lines, products and market. Media models live in
// s.media.models (never in s.models), so the language-model systems are untouched. A media run shares the training
// compute with a language-model run (MEDIA_TUNING.SHARED_COMPUTE_SHARE) and takes all of it when it runs alone.
import type {
  ActionHandlers,
  GameState,
  Id,
  MediaCapId,
  MediaCaps,
  MediaChannel,
  MediaKind,
  MediaModel,
  MediaProduct,
  MediaRunConfig,
  MediaState,
  Rng,
} from '../types';
import {
  MEDIA_ARCHS,
  MEDIA_BENCHMARKS,
  MEDIA_CAP_IDS,
  MEDIA_DATASETS,
  MEDIA_DEMAND,
  MEDIA_OVERALL,
  MEDIA_PRESETS,
  MEDIA_QUIRKS,
  MEDIA_REF_PRICE,
  MEDIA_STYLES,
  MEDIA_TUNING as T,
  curveAt,
  mediaArchById,
  mediaDatasetById,
  mediaQuirkById,
  mediaStyleById,
  type MediaArchDef,
  type MediaDatasetDef,
} from '../data/imageModels';
import { MEDIA_RIVALS, type MediaRelease, type MediaRivalDef } from '../data/imageRivals';
import { addExpense, addRevenue, clamp, formatMoney, newId, notify, pushNews, trySpend, yearOf } from '../util';
import { isResearched } from './research';
import { rawTrainingRate } from './capabilities';
import { cheapestCloudCostPerFlop } from './training';
import { labName } from './labs';

export const MEDIA_KIND_NAME: Record<MediaKind, string> = { image: 'image', video: 'video' };
export const MEDIA_CHANNEL_NAME: Record<MediaChannel, string> = { app: 'app', api: 'API' };
const RES_FLOPS: Record<number, number> = { 256: 0.35, 512: 1, 1024: 2.6 };
const OVERHEAD_DAYS = 2;
const MAX_EPOCHS = 4;
/** Below this overall a media model is a toy: buyers mostly pass. */
const USABLE_FROM = 10;
const USABLE_SPAN = 25;
/** Weight of "nobody buys" in every market. */
const OUTSIDE_WEIGHT = 0.3;

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/** The media book, created on first use. Rival lines start "seen" up to today, so no backlog of news. */
export function mediaOf(s: GameState): MediaState {
  if (!s.media) {
    const rivalSeen: Record<Id, number> = {};
    for (const r of MEDIA_RIVALS) rivalSeen[r.id] = latestIndex(s, r);
    s.media = { models: [], run: null, owned: [], products: [], rivalSeen, suedDay: {} };
  }
  const m = s.media;
  m.models ??= [];
  m.run ??= null;
  m.owned ??= [];
  m.products ??= [];
  m.rivalSeen ??= {};
  m.suedDay ??= {};
  return m;
}

const year = (s: GameState) => yearOf(s.day);

export function mediaArchLock(s: GameState, a: MediaArchDef): string | null {
  if (year(s) + 1 < a.minYear) return `Not until ${a.minYear}.`;
  if (a.requiresResearch && !isResearched(s, a.requiresResearch)) return 'Needs research first.';
  return null;
}

export function mediaArchsFor(s: GameState, kind: MediaKind): { arch: MediaArchDef; lock: string | null }[] {
  return MEDIA_ARCHS.filter((a) => a.kind === kind).map((arch) => ({ arch, lock: mediaArchLock(s, arch) }));
}

/** Best unlocked architecture for a kind (the newest), or null when none is open yet. */
export function bestMediaArch(s: GameState, kind: MediaKind): MediaArchDef | null {
  const open = mediaArchsFor(s, kind).filter((x) => !x.lock);
  return open.length ? open[open.length - 1].arch : null;
}

/** Can the lab train this kind at all yet? Null when it can; otherwise why not. */
export function mediaKindLock(s: GameState, kind: MediaKind): string | null {
  if (bestMediaArch(s, kind)) return null;
  const first = MEDIA_ARCHS.find((a) => a.kind === kind)!;
  return kind === 'video' ? `Video models need video research and ${first.minYear}.` : 'Image models need research first.';
}

export function mediaDatasetsFor(s: GameState, kind: MediaKind): { def: MediaDatasetDef; owned: boolean; available: boolean }[] {
  const owned = new Set(s.media?.owned ?? []);
  return MEDIA_DATASETS.filter((d) => d.kind === kind).map((def) => ({ def, owned: owned.has(def.id), available: year(s) >= def.year }));
}

export function ownedMediaSets(s: GameState, kind: MediaKind): MediaDatasetDef[] {
  return (s.media?.owned ?? []).map((id) => mediaDatasetById(id)).filter((d): d is MediaDatasetDef => !!d && d.kind === kind);
}

// ---------------------------------------------------------------------------
// physics (GAME_DESIGN §28.2)
// ---------------------------------------------------------------------------

export interface MediaPhysics {
  totalFlops: number;
  uniqueSamplesM: number;
  dataQuality: number;
  /** log10 of effective compute. */
  effLog10: number;
  /** Base quality after undertraining and the arch ceiling. */
  quality: number;
  underPenalty: number;
  samplesPerParam: number;
  hitCeiling: boolean;
  caps: MediaCaps;
  overall: number;
  legalRisk: number;
}

export function emptyMediaCaps(): MediaCaps {
  return { adherence: 0, aesthetics: 0, realism: 0, text: 0, speed: 0, motion: 0 };
}

export function mediaOverall(caps: MediaCaps, kind: MediaKind): number {
  let o = 0;
  for (const [k, w] of Object.entries(MEDIA_OVERALL[kind])) o += (w ?? 0) * caps[k as MediaCapId];
  return clamp(o, 0, 100);
}

function addCaps(c: MediaCaps, add: Partial<MediaCaps> | undefined, f = 1): void {
  for (const [k, v] of Object.entries(add ?? {})) c[k as MediaCapId] += f * (v ?? 0);
}

function clampMediaCaps(c: MediaCaps, kind: MediaKind, ceiling: number): void {
  for (const k of MEDIA_CAP_IDS) c[k] = clamp(c[k], 0, k === 'speed' ? 100 : Math.min(100, ceiling + 5));
  if (kind === 'image') c.motion = 0;
}

/** The run sheet's physics: compute, data, quality and the noise-free capability profile. */
export function mediaPhysics(s: GameState, cfg: MediaRunConfig): MediaPhysics {
  const arch = mediaArchById(cfg.arch) ?? MEDIA_ARCHS[0];
  const sets = cfg.datasetIds.map((id) => mediaDatasetById(id)).filter((d): d is MediaDatasetDef => !!d && d.kind === cfg.kind);
  const unique = sets.reduce((t, d) => t + d.samplesM, 0);
  const dataQuality = unique > 0 ? sets.reduce((t, d) => t + d.samplesM * d.quality, 0) / unique : 0;
  const samples = Math.max(0, cfg.samplesM);
  const eff = Math.min(samples, unique) + 0.5 * Math.max(0, samples - unique);
  const perSample = T.SAMPLE_TOKENS * (RES_FLOPS[cfg.resolution] ?? 1) * (cfg.kind === 'video' ? T.VIDEO_SAMPLE_MULT : 1);
  const totalFlops = 6 * cfg.paramsB * 1e9 * samples * 1e6 * perSample;
  const effC = totalFlops * (samples > 0 ? eff / samples : 0) * arch.eff * (0.5 + dataQuality);
  const effLog10 = effC > 0 ? Math.log10(effC) : 0;
  let q = 100 * (1 - Math.exp(-Math.max(0, effLog10 - T.Q_C0) / T.Q_K));
  const samplesPerParam = cfg.paramsB > 0 ? (eff * 1e6) / (cfg.paramsB * 1e9) : 0;
  const underPenalty = samplesPerParam >= 1 ? 0 : samplesPerParam > 0 ? Math.min(T.UNDER_MAX, T.UNDER_K * Math.log2(1 / samplesPerParam)) : T.UNDER_MAX;
  q = Math.max(0, q - underPenalty);
  const hitCeiling = q > arch.ceiling;
  q = Math.min(q, arch.ceiling);

  const caps: MediaCaps = {
    adherence: q * arch.adherence,
    aesthetics: q * 0.95,
    realism: q * 0.9,
    text: q * arch.text,
    motion: cfg.kind === 'video' ? q * 0.85 : 0,
    speed: arch.speed - 12 * Math.log10(Math.max(0.1, cfg.paramsB)) + (cfg.resolution === 1024 ? -8 : cfg.resolution === 256 ? 8 : 0),
  };
  if (cfg.resolution === 256) addCaps(caps, { aesthetics: -8, realism: -10 });
  if (cfg.resolution === 1024) addCaps(caps, { aesthetics: 4, realism: 5 });
  // Each set's flavour counts in proportion to its share of the samples (full strength at half the mix or more).
  for (const d of sets) addCaps(caps, d.capAdd, unique > 0 ? Math.min(1, (2 * d.samplesM) / unique) : 0);
  addCaps(caps, mediaStyleById(cfg.style)?.capAdd);
  if (cfg.distill) {
    caps.speed += T.DISTILL_SPEED;
    addCaps(caps, T.DISTILL_COST);
  }
  const risky = sets.some((d) => d.legalRisk >= 0.5);
  if (cfg.optOut && risky) caps.aesthetics += T.OPT_OUT_AESTHETICS;
  clampMediaCaps(caps, cfg.kind, arch.ceiling);
  const legalRisk = sets.reduce((m, d) => Math.max(m, d.legalRisk), 0) * (cfg.optOut ? T.OPT_OUT_RISK : 1);
  return { totalFlops, uniqueSamplesM: unique, dataQuality, effLog10, quality: q, underPenalty, samplesPerParam, hitCeiling, caps, overall: mediaOverall(caps, cfg.kind), legalRisk };
}

/** FLOP per day a media run gets: all of the training compute, or its share while a language model also trains. */
export function mediaRate(s: GameState): number {
  return rawTrainingRate(s) * (s.training ? T.SHARED_COMPUTE_SHARE : 1);
}

export interface MediaEstimate extends MediaPhysics {
  days: number;
  /** What the same compute would cost rented in the cloud today. */
  cloudCost: number;
  low: number;
  mid: number;
  high: number;
  /** Plain reasons the forecast is what it is. */
  reasons: string[];
}

function bandSd(s: GameState, cfg: MediaRunConfig): number {
  const tried = (s.media?.models ?? []).some((m) => m.config.arch === cfg.arch);
  return T.BAND_SD * (tried ? 1 : T.FIRST_ARCH_FACTOR);
}

export function estimateMediaRun(s: GameState, cfg: MediaRunConfig): MediaEstimate {
  const p = mediaPhysics(s, cfg);
  const rate = mediaRate(s);
  const days = rate > 0 ? p.totalFlops / rate + OVERHEAD_DAYS : Infinity;
  const half = T.Z80 * bandSd(s, cfg);
  const reasons: string[] = [];
  const arch = mediaArchById(cfg.arch);
  if (p.hitCeiling && arch) reasons.push(`${arch.name} tops out here. A newer architecture would go further.`);
  if (p.underPenalty >= 0.5) reasons.push(`Undertrained: ${p.samplesPerParam.toFixed(2)} samples per parameter. Expect −${Math.round(p.underPenalty)}.`);
  if (p.legalRisk >= 0.3) reasons.push(`Scraped data in the mix: legal risk ${Math.round(p.legalRisk * 100)}% once it is public.`);
  if (!(s.media?.models ?? []).some((m) => m.config.arch === cfg.arch)) reasons.push('First run on this architecture: a wide band.');
  return {
    ...p,
    days,
    cloudCost: p.totalFlops * cheapestCloudCostPerFlop(s),
    low: Math.max(0, p.overall - half),
    mid: p.overall,
    high: Math.min(100, p.overall + half),
    reasons,
  };
}

/** Why a media run sheet cannot start, or null. */
export function validateMediaRun(s: GameState, cfg: MediaRunConfig): string | null {
  const arch = mediaArchById(cfg.arch);
  if (!arch || arch.kind !== cfg.kind) return 'Unknown architecture.';
  const lock = mediaArchLock(s, arch);
  if (lock) return `${arch.name}: ${lock}`;
  if (!Number.isFinite(cfg.paramsB) || cfg.paramsB < T.MIN_PARAMS_B || cfg.paramsB > T.MAX_PARAMS_B) return `Size must be between ${T.MIN_PARAMS_B * 1000}M and ${T.MAX_PARAMS_B}B parameters.`;
  if (![256, 512, 1024].includes(cfg.resolution)) return 'Unknown resolution.';
  if (cfg.resolution === 1024 && year(s) < 2022) return '1024 px training is not practical before 2022.';
  const style = mediaStyleById(cfg.style);
  if (!style) return 'Unknown style.';
  if (style.minYear && year(s) < style.minYear) return `${style.name} is not available until ${style.minYear}.`;
  const ids = [...new Set(cfg.datasetIds)];
  if (ids.length === 0) return 'Pick at least one dataset you own.';
  let unique = 0;
  for (const id of ids) {
    const d = mediaDatasetById(id);
    if (!d || d.kind !== cfg.kind) return 'That dataset does not fit this model type.';
    if (!(s.media?.owned ?? []).includes(id)) return `You don't own ${d.name} yet.`;
    unique += d.samplesM;
  }
  if (!Number.isFinite(cfg.samplesM) || cfg.samplesM <= 0) return 'Train on at least some samples.';
  if (cfg.samplesM > unique * MAX_EPOCHS + 1e-9) return `At most ${MAX_EPOCHS} passes over the data (${Math.round(unique * MAX_EPOCHS)}M samples).`;
  return null;
}

/**
 * A complete run sheet from a preset: the unlocked architecture that does best on it, every owned set of the kind, and the largest size
 * (one sample per parameter at least, up to four passes) that finishes within the preset's days. Null without data.
 */
export function mediaPresetConfig(s: GameState, kind: MediaKind, presetId: Id, days?: number, overrides: MediaOverrides = {}): MediaRunConfig | null {
  // Newer is not always better at a small budget (a GAN beats early autoregressive models), so try each open one.
  let best: MediaRunConfig | null = null;
  let bestOverall = -1;
  for (const { arch, lock } of mediaArchsFor(s, kind)) {
    if (lock || (overrides.arch && overrides.arch !== arch.id)) continue;
    const cfg = presetForArch(s, kind, presetId, arch, days, overrides);
    const o = cfg ? mediaPhysics(s, cfg).overall : -1;
    if (cfg && o >= bestOverall) {
      best = cfg;
      bestOverall = o;
    }
  }
  return best;
}

/** Expert overrides on a preset (the quick start's advanced section). Sizing is redone with them applied. */
export type MediaOverrides = Partial<Pick<MediaRunConfig, 'arch' | 'resolution' | 'style' | 'distill' | 'optOut' | 'datasetIds'>>;

function presetForArch(s: GameState, kind: MediaKind, presetId: Id, arch: MediaArchDef, days: number | undefined, overrides: MediaOverrides): MediaRunConfig | null {
  const preset = MEDIA_PRESETS.find((p) => p.id === presetId) ?? MEDIA_PRESETS[0];
  const pick = overrides.datasetIds;
  const sets = ownedMediaSets(s, kind).filter((d) => !pick || pick.includes(d.id));
  if (sets.length === 0) return null;
  const unique = sets.reduce((t, d) => t + d.samplesM, 0);
  const style = mediaStyleById(preset.style);
  const resolution = preset.resolution === 1024 && year(s) < 2022 ? 512 : preset.resolution;
  const base: MediaRunConfig = {
    kind,
    arch: arch.id,
    paramsB: 1,
    samplesM: unique,
    datasetIds: sets.map((d) => d.id),
    resolution,
    style: style && (!style.minYear || year(s) >= style.minYear) ? preset.style : 'balanced',
    distill: preset.distill,
    optOut: false,
  };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && k !== 'arch' && k !== 'datasetIds') (base as unknown as Record<string, unknown>)[k] = v;
  if (base.resolution === 1024 && year(s) < 2022) base.resolution = 512;
  const budget = days ?? preset.days;
  const rate = mediaRate(s);
  if (!(rate > 0)) return { ...base, paramsB: 0.1, samplesM: Math.min(unique * MAX_EPOCHS, Math.max(unique, 100)) };
  // Two samples per parameter is a good default; up to four passes over the data.
  const sheetAt = (paramsB: number): MediaRunConfig => {
    const samplesM = Math.min(unique * MAX_EPOCHS, Math.max(paramsB * 1000 * 2, Math.min(unique, 1)));
    return { ...base, paramsB: Number(paramsB.toPrecision(2)), samplesM: Number(samplesM.toPrecision(3)) };
  };
  const daysAt = (p: number) => mediaPhysics(s, sheetAt(p)).totalFlops / rate + OVERHEAD_DAYS;
  let lo = Math.log(T.MIN_PARAMS_B);
  let hi = Math.log(Math.min(T.MAX_PARAMS_B, Math.max(T.MIN_PARAMS_B, (unique * MAX_EPOCHS) / 1000)));
  if (daysAt(Math.exp(hi)) <= budget) lo = hi;
  for (let k = 0; k < 24 && lo < hi; k++) {
    const mid = (lo + hi) / 2;
    if (daysAt(Math.exp(mid)) <= budget) lo = mid;
    else hi = mid;
  }
  const cfg = sheetAt(Math.exp(lo));
  cfg.samplesM = Math.min(cfg.samplesM, unique * MAX_EPOCHS);
  return cfg;
}

// ---------------------------------------------------------------------------
// rivals and the arena
// ---------------------------------------------------------------------------

function lineLive(s: GameState, r: MediaRivalDef): boolean {
  if (!r.labId) return true;
  const c = s.competitors.find((x) => x.id === r.labId);
  return !!c && c.active && !c.human;
}

function latestIndex(s: GameState, r: MediaRivalDef): number {
  if (!lineLive(s, r)) return -1;
  const y = year(s);
  let i = -1;
  r.releases.forEach((rel, k) => {
    if (rel.year <= y) i = k;
  });
  return i;
}

export interface MediaRivalNow {
  def: MediaRivalDef;
  release: MediaRelease;
  lab: string;
  overall: number;
  caps: MediaCaps;
  elo: number;
  brand: number;
}

function rivalCaps(r: MediaRivalDef, overall: number): MediaCaps {
  const c: MediaCaps = { adherence: overall, aesthetics: overall, realism: overall, text: overall * 0.8, speed: 60, motion: r.kind === 'video' ? overall : 0 };
  addCaps(c, r.profile);
  clampMediaCaps(c, r.kind, 100);
  return c;
}

/** Each rival line's current release of this kind. */
export function mediaRivalsNow(s: GameState, kind: MediaKind): MediaRivalNow[] {
  const out: MediaRivalNow[] = [];
  for (const r of MEDIA_RIVALS) {
    if (r.kind !== kind) continue;
    const i = latestIndex(s, r);
    if (i < 0) continue;
    const release = r.releases[i];
    const brand = r.labId ? (s.competitors.find((c) => c.id === r.labId)?.brand ?? r.brand) : r.brand;
    out.push({ def: r, release, lab: r.labId ? labName(s, r.labId) : r.name, overall: release.overall, caps: rivalCaps(r, release.overall), elo: T.ELO_BASE + T.ELO_PER_POINT * release.overall, brand });
  }
  return out;
}

export interface MediaArenaRow {
  name: string;
  lab: string;
  elo: number;
  overall: number;
  mine: boolean;
  open: boolean;
}

/** The media arena for a kind: released player models (best per kind first) and every rival line's current model. */
export function mediaArena(s: GameState, kind: MediaKind): MediaArenaRow[] {
  const rows: MediaArenaRow[] = mediaRivalsNow(s, kind).map((r) => ({ name: r.release.name, lab: r.lab, elo: r.elo, overall: r.overall, mine: false, open: !!r.def.open }));
  for (const m of s.media?.models ?? []) {
    if (m.kind !== kind || m.releasedDay === null) continue;
    rows.push({ name: m.name, lab: s.company.name, elo: m.elo, overall: m.overall, mine: true, open: !!m.openWeights });
  }
  return rows.sort((a, b) => b.elo - a.elo);
}

/** Benchmark results (%) for a media profile, for the benchmarks that exist this year. */
export function mediaBenchScores(s: GameState, caps: MediaCaps, kind: MediaKind): { id: Id; name: string; score: number }[] {
  const y = year(s);
  return MEDIA_BENCHMARKS.filter((b) => b.kind === kind && b.year <= y + 0.001).map((b) => {
    let x = 0;
    for (const [k, w] of Object.entries(b.weights)) x += (w ?? 0) * caps[k as MediaCapId];
    return { id: b.id, name: b.name, score: 100 / (1 + Math.exp(-(x - b.difficulty) / 8)) };
  });
}

// ---------------------------------------------------------------------------
// market
// ---------------------------------------------------------------------------

export function mediaRefPrice(s: GameState, kind: MediaKind, channel: MediaChannel): number {
  return curveAt(MEDIA_REF_PRICE[kind][channel], year(s));
}

export function mediaDemand(s: GameState, kind: MediaKind, channel: MediaChannel): number {
  return curveAt(MEDIA_DEMAND[kind][channel], year(s)) * (0.75 + s.market.aiHype / 200);
}

export function mediaLaunchFee(s: GameState, channel: MediaChannel): number {
  return Math.round(T.LAUNCH_FEE[channel] * 1.15 ** (year(s) - 2022));
}

/** $ per generation for a model (cloud inference), falling every year. */
export function mediaCostPerGen(s: GameState, m: MediaModel): number {
  const size = ((m.config.paramsB + 0.5) / 2.5) ** 0.7;
  const speed = 100 / (m.caps.speed + 30);
  return T.COST_PER_IMAGE_2022 * T.COST_DECLINE ** (year(s) - 2022) * size * speed * (m.kind === 'video' ? T.VIDEO_COST_MULT : 1);
}

const usable = (o: number) => clamp((o - USABLE_FROM) / USABLE_SPAN, 0.05, 1);

/** Share of the market a product would win today at this price (0..1), against every rival and doing nothing. */
export function mediaShare(s: GameState, kind: MediaKind, channel: MediaChannel, model: MediaModel, price: number): number {
  const ref = mediaRefPrice(s, kind, channel);
  const e = T.PRICE_ELASTICITY[channel];
  const rivals = mediaRivalsNow(s, kind).filter((r) => r.def.channels.includes(channel));
  const best = Math.max(model.overall, ...rivals.map((r) => r.overall));
  const appeal = (o: number, p: number, brand: number) => Math.exp((o - best) / T.MARKET_T) * (ref / Math.max(1e-9, p)) ** e * (0.5 + brand / 100) * usable(o);
  const mine = appeal(model.overall, price, s.company.brand) * (model.openWeights ? T.OPEN_OWN_APPEAL : 1);
  let others = 0;
  for (const r of rivals) others += appeal(r.overall, ref * r.def.priceMult, r.brand);
  let bestOpen = -Infinity;
  for (const r of mediaRivalsNow(s, kind)) if (r.def.open) bestOpen = Math.max(bestOpen, r.overall);
  for (const m of s.media?.models ?? []) if (m.kind === kind && m.openWeights && m.releasedDay !== null) bestOpen = Math.max(bestOpen, m.overall);
  // Commoditisation: good open weights mean many buyers just run it themselves (API buyers most of all).
  const diy = Number.isFinite(bestOpen) ? T.DIY_WEIGHT * Math.exp((bestOpen - best) / T.MARKET_T) * (channel === 'api' ? 2 : 1) : 0;
  return mine / (mine + others + OUTSIDE_WEIGHT + diy);
}

function marketDay(s: GameState, ms: MediaState): void {
  for (const p of ms.products) {
    if (!p.active) continue;
    const m = ms.models.find((x) => x.id === p.modelId);
    if (!m) {
      p.active = false;
      continue;
    }
    const target = mediaDemand(s, p.kind, p.channel) * mediaShare(s, p.kind, p.channel, m, p.price);
    p.users = Math.max(0, p.users + (target - p.users) * T.USER_DRIFT[p.channel]);
    const gens = p.channel === 'app' ? p.users * T.APP_GENERATIONS_PER_USER : p.users;
    p.revenuePerDay = p.channel === 'app' ? (p.users * p.price) / 30 : p.users * p.price;
    p.costPerDay = gens * mediaCostPerGen(s, m);
    addRevenue(s, 'media', p.revenuePerDay);
    addExpense(s, 'compute', p.costPerDay);
  }
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

function rollLuck(rng: Rng): { luck: number; tag: 'golden' | 'cursed' | null } {
  const r = rng.next();
  if (r < T.GOLDEN_CHANCE) return { luck: rng.normal(T.GOLDEN_MEAN, 1.5), tag: 'golden' };
  if (r < T.GOLDEN_CHANCE + T.CURSED_CHANCE) return { luck: rng.normal(T.CURSED_MEAN, 2), tag: 'cursed' };
  return { luck: clamp(rng.normal(0, T.LUCK_SD), -10, 10), tag: null };
}

function finishRun(s: GameState, ms: MediaState): void {
  const run = ms.run;
  if (!run) return;
  ms.run = null;
  const cfg = run.config;
  const p = mediaPhysics(s, cfg);
  const arch = mediaArchById(cfg.arch);
  const caps = { ...p.caps };
  const quirk = run.hidden.quirk ? mediaQuirkById(run.hidden.quirk) : undefined;
  addCaps(caps, quirk?.capAdd);
  for (const k of MEDIA_CAP_IDS) if (k !== 'speed' && !(k === 'motion' && cfg.kind === 'image')) caps[k] += run.hidden.luck;
  clampMediaCaps(caps, cfg.kind, arch?.ceiling ?? 100);
  const overall = mediaOverall(caps, cfg.kind);

  // The lab notebook: why it came out this way.
  const notes: string[] = [];
  if (p.hitCeiling && arch) notes.push(`${arch.name} hit its ceiling. More compute will not help; a newer architecture will.`);
  if (p.underPenalty >= 0.5) notes.push(`Undertrained: only ${p.samplesPerParam.toFixed(2)} samples per parameter cost about ${Math.round(p.underPenalty)} points.`);
  const flavour = cfg.datasetIds.map((id) => mediaDatasetById(id)).filter((d): d is MediaDatasetDef => !!d?.capAdd);
  for (const d of flavour.slice(0, 2)) {
    const [k, v] = Object.entries(d.capAdd ?? {}).sort((a, b) => Math.abs(b[1] ?? 0) - Math.abs(a[1] ?? 0))[0] ?? [];
    if (k) notes.push(`${d.name} shaped it: ${k} ${(v ?? 0) >= 0 ? 'up' : 'down'}.`);
  }
  if (run.hidden.tag === 'golden') notes.push('Golden seed: the noise schedule and the seed simply clicked.');
  if (run.hidden.tag === 'cursed') notes.push('Cursed seed: mode collapse in week two. The same sheet should do better next time.');
  if (quirk) notes.push(`Quirk: ${quirk.name.toLowerCase()}.`);
  if (p.legalRisk >= 0.3) notes.push(`Trained on scraped work: about ${Math.round(p.legalRisk * 100)}% legal risk once it is public.`);

  const model: MediaModel = {
    id: newId(s, 'mm'),
    name: run.name,
    kind: cfg.kind,
    config: cfg,
    caps,
    overall,
    elo: T.ELO_BASE + T.ELO_PER_POINT * overall + run.hidden.vibes,
    trainedDay: s.day,
    releasedDay: null,
    notes,
    forecastMid: run.forecast.mid,
    legalRisk: p.legalRisk,
    ...(quirk ? { quirk: quirk.id } : {}),
  };
  ms.models.push(model);
  const d = overall - run.forecast.mid;
  const how = d > 4 ? 'well above' : d < -4 ? 'well below' : 'about on';
  notify(s, `${run.name} finished: overall ${Math.round(overall)}, ${how} the forecast of ${Math.round(run.forecast.mid)}.`, d < -4 ? 'bad' : 'milestone');
  pushNews(s, `Internal memo: ${s.company.name} has a new ${MEDIA_KIND_NAME[cfg.kind]} model, ${run.name}. The office printer is full of cats.`, 'info');
}

function lawsuits(s: GameState, ms: MediaState, rng: Rng): void {
  for (const m of ms.models) {
    if (m.releasedDay === null || m.legalRisk <= 0) continue;
    const last = ms.suedDay[m.id];
    if (last !== undefined && s.day - last < T.LAWSUIT_COOLDOWN) continue;
    if (!rng.chance(m.legalRisk * T.LAWSUIT_RATE)) continue;
    ms.suedDay[m.id] = s.day;
    const cost = Math.round(T.LAWSUIT_BASE * 1.2 ** Math.max(0, year(s) - 2021));
    addExpense(s, 'events', cost);
    s.company.reputation = clamp(s.company.reputation - T.LAWSUIT_REP, 0, 100);
    s.company.hype = clamp(s.company.hype + 1, 0, 100);
    s.stats.lawsuits += 1;
    pushNews(s, `Artists sue ${s.company.name} over ${m.name}. Exhibit A is a watermark the model reproduced perfectly.`, 'bad');
    notify(s, `Lawsuit over ${m.name}: ${formatMoney(cost)} in settlements, reputation −${T.LAWSUIT_REP}. Opt-outs on the next run lower the risk.`, 'bad');
  }
}

function rivalNews(s: GameState, ms: MediaState): void {
  for (const r of MEDIA_RIVALS) {
    const i = latestIndex(s, r);
    const seen = ms.rivalSeen[r.id] ?? -1;
    if (i <= seen) continue;
    ms.rivalSeen[r.id] = i;
    const rel = r.releases[i];
    pushNews(s, rel.news ?? `${r.labId ? labName(s, r.labId) : r.name} releases ${rel.name}.`, 'info');
  }
}

/** Daily: the media run trains, products sell, rival lines ship, scraped data meets lawyers. Idle until first used. */
export function mediaTick(s: GameState, rng: Rng): void {
  if (!s.media) return;
  const ms = mediaOf(s);
  const run = ms.run;
  if (run) {
    run.doneFlops = Math.min(run.totalFlops, run.doneFlops + mediaRate(s));
    if (run.doneFlops >= run.totalFlops && s.day - run.startedDay >= OVERHEAD_DAYS) finishRun(s, ms);
  }
  marketDay(s, ms);
  rivalNews(s, ms);
  lawsuits(s, ms, rng);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

export const handlers: ActionHandlers = {
  buyMediaDataset: (s, a) => {
    const d = mediaDatasetById(a.datasetId);
    if (!d) return notify(s, 'Unknown dataset.', 'bad');
    if (year(s) < d.year) return notify(s, `${d.name} does not exist until ${d.year}.`, 'bad');
    const ms = mediaOf(s);
    if (ms.owned.includes(d.id)) return notify(s, `You already own ${d.name}.`, 'info');
    if (d.price > 0 && !trySpend(s, 'data', d.price, d.name)) return;
    ms.owned.push(d.id);
    notify(s, d.price > 0 ? `Bought ${d.name} for ${formatMoney(d.price)}.` : `Downloaded ${d.name}. It was free, legally speaking, probably.`, 'good');
  },

  startMediaRun: (s, a, rng) => {
    const ms = mediaOf(s);
    if (ms.run) return notify(s, `${ms.run.name} is still training.`, 'bad');
    const name = a.name.trim().slice(0, 40);
    if (!name) return notify(s, 'Give the model a name first.', 'bad');
    const cfg: MediaRunConfig = { ...a.config, datasetIds: [...new Set(a.config.datasetIds)] };
    const err = validateMediaRun(s, cfg);
    if (err) return notify(s, err, 'bad');
    if (!(mediaRate(s) > 0)) return notify(s, 'No compute is allocated to training. Rent GPUs or raise the training share.', 'bad');
    const est = estimateMediaRun(s, cfg);
    const luck = rollLuck(rng);
    const quirks = MEDIA_QUIRKS.filter((q) => !q.kind || q.kind === cfg.kind);
    const quirk = rng.chance(T.QUIRK_CHANCE) ? rng.pick(quirks).id : null;
    ms.run = {
      id: newId(s, 'mrun'),
      name,
      config: cfg,
      totalFlops: est.totalFlops,
      doneFlops: 0,
      startedDay: s.day,
      forecast: { low: est.low, mid: est.mid, high: est.high },
      hidden: { luck: luck.luck, tag: luck.tag, vibes: rng.normal(0, T.VIBES_SD), quirk },
    };
    notify(s, `Training ${name}, a ${MEDIA_KIND_NAME[cfg.kind]} model: about ${Math.ceil(est.days)} days.${s.training ? ' It shares the cluster with the language-model run.' : ''}`, 'info');
  },

  cancelMediaRun: (s) => {
    const ms = s.media;
    if (!ms?.run) return notify(s, 'No image or video run is training.', 'info');
    const pct = Math.floor((ms.run.doneFlops / Math.max(1, ms.run.totalFlops)) * 100);
    notify(s, `Cancelled ${ms.run.name} at ${pct}%. That compute is gone.`, 'bad');
    ms.run = null;
  },

  releaseMediaModel: (s, a) => {
    const ms = mediaOf(s);
    const m = ms.models.find((x) => x.id === a.modelId);
    if (!m) return notify(s, 'That model no longer exists.', 'bad');
    if (m.releasedDay !== null) return notify(s, `${m.name} is already public.`, 'info');
    const top = mediaArena(s, m.kind).find((r) => !r.mine);
    const beats = !top || m.elo > top.elo;
    const gain = beats ? T.RELEASE_TOP : T.RELEASE_OTHER;
    const viral = m.quirk ? (mediaQuirkById(m.quirk)?.virality ?? 0) : 0;
    s.company.brand = clamp(s.company.brand + gain.brand + (a.openWeights ? T.OPEN_RELEASE.brand : 0), 0, 100);
    s.company.hype = clamp(s.company.hype + gain.hype + viral, 0, 100);
    if (a.openWeights) s.company.reputation = clamp(s.company.reputation + T.OPEN_RELEASE.reputation, 0, 100);
    m.releasedDay = s.day;
    if (a.openWeights) m.openWeights = true;
    const kind = MEDIA_KIND_NAME[m.kind];
    pushNews(
      s,
      beats
        ? `${s.company.name} releases ${m.name} and tops the ${kind} arena (Elo ${Math.round(m.elo)}).${a.openWeights ? ' The weights are on the internet.' : ''}`
        : `${s.company.name} releases ${m.name}, a ${kind} model. ${top ? `${top.name} still leads the arena.` : ''}`,
      beats ? 'milestone' : 'good',
    );
    notify(s, `Released ${m.name}: brand +${gain.brand}, hype +${gain.hype + viral}.`, 'good');
  },

  launchMediaProduct: (s, a) => {
    const ms = mediaOf(s);
    const m = ms.models.find((x) => x.id === a.modelId);
    if (!m || m.releasedDay === null) return notify(s, 'Release the model before you sell it.', 'bad');
    if (m.kind !== a.kind) return notify(s, 'That model is the wrong type for this product.', 'bad');
    if (a.channel !== 'app' && a.channel !== 'api') return notify(s, 'Unknown product type.', 'bad');
    if (ms.products.some((p) => p.active && p.kind === a.kind && p.channel === a.channel)) {
      return notify(s, `You already sell a ${MEDIA_KIND_NAME[a.kind]} ${MEDIA_CHANNEL_NAME[a.channel]}. Swap its model instead.`, 'info');
    }
    const ref = mediaRefPrice(s, a.kind, a.channel);
    const price = a.price ?? ref;
    if (!Number.isFinite(price) || price < ref * 0.2 || price > ref * 5) return notify(s, 'That price is outside what the market will even consider.', 'bad');
    const fee = mediaLaunchFee(s, a.channel);
    if (!trySpend(s, 'marketing', fee, 'the launch')) return;
    const label = a.kind === 'image' ? (a.channel === 'app' ? 'Studio' : 'Image API') : a.channel === 'app' ? 'Motion' : 'Video API';
    const p: MediaProduct = {
      id: newId(s, 'mp'),
      kind: a.kind,
      channel: a.channel,
      name: `${s.company.name} ${label}`,
      modelId: m.id,
      price,
      users: 0,
      revenuePerDay: 0,
      costPerDay: 0,
      launchedDay: s.day,
      active: true,
    };
    ms.products.push(p);
    pushNews(s, `${s.company.name} launches ${p.name}, powered by ${m.name}.`, 'good');
    notify(s, `Launched ${p.name} for ${formatMoney(fee)}.`, 'good');
  },

  updateMediaProduct: (s, a) => {
    const ms = mediaOf(s);
    const p = ms.products.find((x) => x.id === a.productId && x.active);
    if (!p) return notify(s, 'That product is not running.', 'bad');
    if (a.modelId !== undefined) {
      const m = ms.models.find((x) => x.id === a.modelId);
      if (!m || m.releasedDay === null || m.kind !== p.kind) return notify(s, 'Pick a released model of the same type.', 'bad');
      p.modelId = m.id;
    }
    if (a.price !== undefined) {
      const ref = mediaRefPrice(s, p.kind, p.channel);
      if (!Number.isFinite(a.price) || a.price < ref * 0.2 || a.price > ref * 5) return notify(s, 'That price is outside what the market will even consider.', 'bad');
      p.price = a.price;
    }
  },

  shutdownMediaProduct: (s, a) => {
    const p = s.media?.products.find((x) => x.id === a.productId && x.active);
    if (!p) return notify(s, 'That product is not running.', 'info');
    p.active = false;
    p.users = 0;
    p.revenuePerDay = 0;
    p.costPerDay = 0;
    notify(s, `${p.name} is shut down.`, 'info');
  },
};

export { MEDIA_PRESETS, MEDIA_STYLES };
