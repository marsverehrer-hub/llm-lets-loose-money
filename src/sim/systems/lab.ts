// OWNER: Agent FOG-SIM. Fog of training: forecasts, hidden truths, the lab notebook. See GAME_DESIGN.md §16.
// Public API (used by the UI): keep the exported names and signatures stable. Run-side helpers (rolls, true caps,
// watching a run, verification bookkeeping) are exported too, for systems/training.ts.
import type {
  ActionHandlers,
  Capabilities,
  CapId,
  DataKind,
  DatasetDef,
  EmergenceDef,
  Forecast,
  GameState,
  Id,
  LabKnowledge,
  Model,
  Persona,
  Rng,
  RunHidden,
  SweepJob,
  SweepPoint,
  TrainingConfig,
  TrainingRun,
} from '../types';
import { CAP_IDS } from '../types';
import { RUN_TUNING, configSignature, optionById, validateConfig } from '../data/trainingOptions';
import { EMERGENCES, emergenceById } from '../data/emergences';
import { quirkById } from '../data/quirks';
import { CHECKPOINT_NOTES, DATA_SURPRISE_COPY, LATENT_DISCOVERY_COPY, VERDICT_NEWS, pickCopy, type Verdict } from '../data/evalCopy';
import { calendarYear, clamp, notify, pushNews, trySpend } from '../util';
import { CAP_TUNING } from '../balance';
import { isResearched } from './research';
import { availableGpus } from './compute';
import { believedQualityOf, datasetById, hashNormal, hashUniform, isVerifiedData, trueQualityOf } from './data';
import {
  LOSS_PER_QUALITY_POINT,
  SCALE_TUNING,
  ablationFlag,
  beliefLrQuality,
  mixRows,
  repeatFactor,
  resolveRun,
  runConfig,
  trueLrQuality,
  uniqueTokensOf,
  type RunPhysics,
} from './trainingMath';
import {
  addCapDeltas,
  capsFromTraining,
  clampCaps,
  emptyCaps,
  estimateFinetune,
  modelCaps,
  overallScore,
  personaCapAdd,
  scoresFromCaps,
  specById,

} from './capabilities';

export type { Verdict };

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const LAB_TUNING = {
  /**
   * v1.0 tuning (GAME_DESIGN §18.2): every emergence adds its capAdd scaled by this. Nine emergences used to stack the
   * caps to the top of the scale by 2021. Applied wherever an emergence adds to a run.
   */
  EMERGENCE_CAP_SCALE: 0.5,
  /** Base SD (overall points) of a pre-training forecast, before the factors in GAME_DESIGN 16.2. */
  BAND_BASE_SD: 3.6,
  /** ~80% band: mid ± Z80 × SD. */
  Z80: 1.28,
  NOVELTY_PER_DECADE: 0.35,
  UNVERIFIED_PER_SHARE: 0.6,
  NO_SWEEP_FACTOR: 1.3,
  SCALING_LAWS_FACTOR: 0.8,
  MUP_FACTOR: 0.85,
  ABLATION_FACTOR: RUN_TUNING.ABLATION_UNCERTAINTY_MULT,
  TRACK_RECORD_MIN: 0.7,
  TRACK_RECORD_MAX: 1.3,
  FORECAST_ERRORS_KEEP: 20,
  /** Fine-tune forecasts: base SD, plus this when nobody has tried the spec yet. */
  FINETUNE_BASE_SD: 2.0,
  FINETUNE_NEW_SD: 1.0,
  /** Seed luck (overall points): usually N(0, 3.5), golden 6% (+8 ± 2), cursed 5% (-9 ± 2), never beyond ±16. */
  LUCK_SD: 3.5,
  GOLDEN_CHANCE: 0.06,
  GOLDEN_MEAN: 8,
  GOLDEN_SD: 2,
  CURSED_CHANCE: 0.05,
  CURSED_MEAN: -9,
  CURSED_SD: 2,
  LUCK_CAP: 16,
  /** Grokking plateau: share of runs. */
  GROK_CHANCE: 0.08,
  GROK_FROM: [0.3, 0.45] as [number, number],
  GROK_LENGTH: [0.05, 0.1] as [number, number],
  GROK_END_MAX: 0.55,
  /** Checkpoint readings (SD, overall points), at 25 / 50 / 75 %. */
  CHECKPOINT_STEPS: [0.25, 0.5, 0.75] as const,
  CHECKPOINT_BAND: { 0.25: 5, 0.5: 3, 0.75: 1.5 } as Record<number, number>,
  /** Latent quirks: share rolled latent at eval, and the daily chance each surfaces after release. */
  LATENT_CHANCE: 0.4,
  LATENT_SURFACE_PER_DAY: 0.02,
  BAD_QUIRK_REP: -3,
  BAD_QUIRK_HYPE: -2,
  GOOD_QUIRK_HYPE: 5,
  /** Arena vibes: N(0, 45) Elo per model; fine-tunes inherit half and add N(0, 20). */
  VIBES_SD: 45,
  VIBES_INHERIT: 0.5,
  VIBES_NEW_SD: 20,
  /** Provisional arena window after release. */
  ELO_SETTLE_DAYS: 21,
  /** Fine-tune: how well the spec took, N(1, 0.3) clamped to [0.4, 1.6]; forgetting 20% for 2–5 points. */
  SPEC_TAKE_SD: 0.3,
  SPEC_TAKE_MIN: 0.4,
  SPEC_TAKE_MAX: 1.6,
  FORGET_CHANCE: 0.2,
  FORGET_MIN: 2,
  FORGET_MAX: 5,
  /** At most this many never-seen emergences can appear in one run (known ones are unlimited). */
  MAX_NEW_EMERGENCES_PER_RUN: 2,
  /** Effective compute: log10(6e18 · effParamsB · effTokensB · dataQuality). */
  EFF_COMPUTE_LOG10_CONST: Math.log10(6e18),
  /** Data audits. */
  AUDIT_DAYS: 10,
  AUDIT_FRACTION: 0.02,
  AUDIT_MIN: 20_000,
  /** Red-teaming. */
  REDTEAM_DAYS: 14,
  REDTEAM_SAFETY_FACTOR: 0.7,
  REDTEAM_FRACTION: 0.005,
  REDTEAM_MIN: 50_000,
  /** LR sweeps: proxy runs at 1/200 of the planned compute, 2 to 6 learning rates. */
  SWEEP_PROXY_COMPUTE_DIVISOR: 200,
  SWEEP_FRACTION: 1 / 200,
  SWEEP_MIN_COST: 10_000,
  SWEEP_DAYS: RUN_TUNING.ABLATION_DAYS,
  SWEEP_MIN_LRS: 2,
  SWEEP_MAX_LRS: 6,
  SWEEP_NOISE_SD: RUN_TUNING.LR_SWEEP_NOISE_SD,
  /** Data surprises smaller than this are called "same" in the copy. */
  DATA_SURPRISE_EPS: 0.03,
  /** Hint window: an undiscovered emergence this close (log10) to a known one gets a vague hint. */
  HINT_WINDOW: 1.5,
  /** Elo = 800 + 8 × overall (see GAME_DESIGN §3). */
  ELO_BASE: 800,
  ELO_PER_POINT: 8,
} as const;

const FORGET_COPY: Record<CapId, string> = {
  knowledge: 'it forgot the capital of Australia again',
  reasoning: 'it forgot how to argue a point',
  math: 'it forgot long division',
  coding: 'it forgot how semicolons work',
  agentic: 'it forgot how to click a button',
  chat: 'it forgot how to make small talk',
  vision: 'it forgot what a cat looks like',
  safety: 'it forgot to be polite about it',
  multilingual: 'it forgot French',
  longContext: 'it forgot the first page of the conversation',
};

/** Architectures the hidden LR offsets are rolled for. */
const LR_ARCHS = Object.keys(RUN_TUNING.LR_OPT_BASE);

// ---------------------------------------------------------------------------
// The lab notebook and the hidden world
// ---------------------------------------------------------------------------

/** The lab notebook, created on first use. Also fills the hidden per-game offsets (seeded, so the same save always rolls the same world). */
export function labOf(s: GameState): LabKnowledge {
  s.lab ??= { runsByArch: {}, largestFlops: 0, sweeps: {}, discoveries: {}, verifiedData: [], lrOffsets: {}, emergenceJitter: {}, forecastErrors: [] };
  const lab = s.lab;
  lab.runsByArch ??= {};
  lab.sweeps ??= {};
  lab.discoveries ??= {};
  lab.verifiedData ??= [];
  lab.lrOffsets ??= {};
  lab.emergenceJitter ??= {};
  lab.forecastErrors ??= [];
  for (const arch of LR_ARCHS) lab.lrOffsets[arch] ??= hashNormal(s.seed, `lr:${arch}`, RUN_TUNING.LR_OPT_OFFSET_SD);
  for (const def of EMERGENCES) lab.emergenceJitter[def.id] ??= (2 * hashUniform(s.seed, `em:${def.id}`) - 1) * def.jitter;
  return lab;
}

/** Per-game threshold jitter of an emergence (log10). */
function jitterOf(s: GameState, def: EmergenceDef): number {
  return s.lab?.emergenceJitter?.[def.id] ?? (2 * hashUniform(s.seed, `em:${def.id}`) - 1) * def.jitter;
}

/** The true threshold for an emergence in this game, in log10 effective compute. */
export function emergenceThresholdOf(s: GameState, def: EmergenceDef): number {
  return def.threshold + jitterOf(s, def);
}

/** log10 of effective training compute for resolved physics: 6 · effParams · effTokens · dataQuality (billions). */
export function effLog10(p: Pick<RunPhysics, 'effParamsB' | 'effTokens' | 'dataQuality'>): number {
  return LAB_TUNING.EFF_COMPUTE_LOG10_CONST + Math.log10(Math.max(1e-12, p.effParamsB)) + Math.log10(Math.max(1e-12, p.effTokens)) + Math.log10(Math.max(1e-12, p.dataQuality));
}

/** Share of each data kind in a mix, from mixRows. */
function shareMap(rows: ReturnType<typeof mixRows>): Partial<Record<DataKind, number>> {
  const out: Partial<Record<DataKind, number>> = {};
  for (const r of rows) out[r.kind] = r.share;
  return out;
}

/** Whether an emergence's non-compute requirements (year, research, data share) hold for this run. */
function requirementsMet(s: GameState, def: EmergenceDef, shares: Partial<Record<DataKind, number>>): boolean {
  if (def.minYear !== undefined && calendarYear(s.day) < def.minYear) return false;
  if (def.requiresResearch && !isResearched(s, def.requiresResearch)) return false;
  if (def.requiresKind && (shares[def.requiresKind.kind] ?? 0) < def.requiresKind.minShare) return false;
  return true;
}

export function sumCapAdd(a: Partial<Capabilities>, b: Partial<Capabilities>): Partial<Capabilities> {
  const out: Partial<Capabilities> = { ...a };
  for (const k of CAP_IDS) if (b[k] !== undefined) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
}

function scaleCapAdd(a: Partial<Capabilities>, f: number): Partial<Capabilities> {
  const out: Partial<Capabilities> = {};
  for (const k of CAP_IDS) if (a[k] !== undefined) out[k] = (a[k] ?? 0) * f;
  return out;
}

// ---------------------------------------------------------------------------
// Learning-rate sweeps (belief side in trainingMath)
// ---------------------------------------------------------------------------

/** Known sweep points for an architecture (all scales), oldest first. */
export function sweepPointsFor(s: GameState, arch: Id): SweepPoint[] {
  return [...(s.lab?.sweeps?.[arch] ?? [])];
}

/** Cheapest cloud $ per FLOP among GPUs on sale now, with the rent market multiplier. */
function cloudCostPerFlop(s: GameState): number {
  const rentMult = s.flags['rentMult'] ?? 1;
  let best = Infinity;
  for (const g of availableGpus(s)) best = Math.min(best, g.rentPerDay / (g.pflops * 1e15 * 86_400));
  return best * rentMult;
}

export function sweepQuote(s: GameState, paramsB: number, tokensB: number, datasetIds: Id[], config: TrainingConfig, lrs: number[]): { cost: number; days: number } {
  const count = lrs.length;
  if (count === 0) return { cost: 0, days: 0 };
  const phys = resolveRun(s, paramsB, tokensB, datasetIds, [], config, 'belief');
  const perLr = Math.max(LAB_TUNING.SWEEP_MIN_COST, LAB_TUNING.SWEEP_FRACTION * phys.totalFlops * cloudCostPerFlop(s));
  const cost = Number.isFinite(perLr) ? Math.round(count * perLr) : Infinity;
  return { cost, days: LAB_TUNING.SWEEP_DAYS };
}

/** True if a sweep for this arch is running right now. */
export function sweepRunning(s: GameState, arch: Id): boolean {
  return (s.lab?.sweepJobs ?? []).some((j) => j.arch === arch);
}

// ---------------------------------------------------------------------------
// Data verification
// ---------------------------------------------------------------------------

/** Quality the lab believes: claimed until verified, then the true value. */
export function believedQuality(s: GameState, def: DatasetDef): number {
  return believedQualityOf(s, def);
}

export function isVerified(s: GameState, datasetId: Id): boolean {
  return isVerifiedData(s, datasetId);
}

/** True quality minus claimed, only once verified (else null). */
export function dataSurprise(s: GameState, datasetId: Id): number | null {
  if (!isVerifiedData(s, datasetId)) return null;
  const d = datasetById(s, datasetId);
  return d ? trueQualityOf(s, d) - d.quality : null;
}

export function auditQuote(s: GameState, datasetId: Id): { cost: number; days: number } {
  const d = datasetById(s, datasetId);
  return { cost: Math.round(Math.max(LAB_TUNING.AUDIT_MIN, LAB_TUNING.AUDIT_FRACTION * (d?.cost ?? 0))), days: LAB_TUNING.AUDIT_DAYS };
}

/** Day an audit finishes, if one is running. */
export function auditDoneDay(s: GameState, datasetId: Id): number | null {
  return s.flags[`audit.${datasetId}`] ?? null;
}

/** Verify the sets a finished run used. Returns the sets that were newly verified, with their surprise. */
export function verifyRunDatasets(s: GameState, datasetIds: readonly Id[]): { id: Id; name: string; claimed: number; truth: number; surprise: number }[] {
  const lab = labOf(s);
  const out: { id: Id; name: string; claimed: number; truth: number; surprise: number }[] = [];
  for (const id of new Set(datasetIds)) {
    if (lab.verifiedData.includes(id)) continue;
    const d = datasetById(s, id);
    if (!d) continue;
    lab.verifiedData.push(id);
    const truth = trueQualityOf(s, d);
    out.push({ id, name: d.name, claimed: d.quality, truth, surprise: truth - d.quality });
  }
  return out;
}

/** The copy tone for a data surprise. */
export function surpriseTone(surprise: number): 'worse' | 'same' | 'better' {
  if (surprise < -LAB_TUNING.DATA_SURPRISE_EPS) return 'worse';
  if (surprise > LAB_TUNING.DATA_SURPRISE_EPS) return 'better';
  return 'same';
}

/** Lines for a verified set, picked deterministically from the state. */
export function dataSurpriseLine(s: GameState, key: string, item: { name: string; claimed: number; truth: number }): { text: string; kind: 'good' | 'bad' | 'info' } {
  const tone = surpriseTone(item.truth - item.claimed);
  const text = pickFrom(s, key, DATA_SURPRISE_COPY[tone], { name: item.name, true: item.truth.toFixed(2), claimed: item.claimed.toFixed(2) });
  return { text, kind: tone === 'worse' ? 'bad' : tone === 'better' ? 'good' : 'info' };
}

// ---------------------------------------------------------------------------
// Red-teaming and latent quirks
// ---------------------------------------------------------------------------

export function redTeamQuote(s: GameState, modelId: Id): { cost: number; days: number } {
  const m = s.models.find((x) => x.id === modelId);
  if (!m) return { cost: 0, days: 0 };
  const flops = 6 * (m.activeParamsB ?? m.paramsB) * 1e9 * m.tokensB * 1e9;
  const cost = Math.round(Math.max(LAB_TUNING.REDTEAM_MIN, LAB_TUNING.REDTEAM_FRACTION * flops * cloudCostPerFlop(s)));
  const safety = (s.staff.roles.safety?.count ?? 0) > 0;
  const days = Math.round(LAB_TUNING.REDTEAM_DAYS * (safety ? LAB_TUNING.REDTEAM_SAFETY_FACTOR : 1));
  return { cost: Number.isFinite(cost) ? cost : Infinity, days };
}

/** Number of latent quirks (UI may show "unknown" instead before red-teaming). */
export function latentCount(m: Model): number {
  return m.latentQuirks?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Arena Elo
// ---------------------------------------------------------------------------

/** Arena Elo as the public currently sees it. Vibes show up as the window closes; before that it is noise. */
export function provisionalElo(s: GameState, m: Model): { elo: number; provisional: boolean; band: number } {
  const base = LAB_TUNING.ELO_BASE + LAB_TUNING.ELO_PER_POINT * m.overall;
  // v6: a measured internal arena (GAME_DESIGN §17.3) replaces the guess as the starting point, pre-release and after.
  const measured = m.arena?.elo;
  const noise = hashNormal(s.seed, `elo:${m.id}`, LAB_TUNING.VIBES_SD);
  const start = measured ?? base + noise;
  const startBand = measured !== undefined ? (m.arena?.band ?? LAB_TUNING.VIBES_SD) : LAB_TUNING.VIBES_SD;
  if (m.releasedDay === null || m.eloSettlesDay === undefined) {
    return { elo: start, provisional: true, band: startBand };
  }
  const window = Math.max(1, m.eloSettlesDay - m.releasedDay);
  const p = clamp((s.day - m.releasedDay) / window, 0, 1);
  // Converges on the true arena rating (base + vibes) as the window closes.
  const elo = start + (base + (m.vibes ?? 0) - start) * p;
  return { elo, provisional: p < 1, band: startBand * (1 - p) };
}

// ---------------------------------------------------------------------------
// Journal and stats
// ---------------------------------------------------------------------------

export interface JournalRow {
  def: EmergenceDef;
  found: { day: number; modelId: Id; threshold: number } | null;
  /** Vague hint for undiscovered rows ("somewhere past 10^23 FLOP") or null. */
  hint: string | null;
}

/** All emergences: discovered ones with details, undiscovered as hidden rows (the UI shows "???" for those). */
export function emergenceJournal(s: GameState): JournalRow[] {
  const disc = s.lab?.discoveries ?? {};
  const knownThresholds = EMERGENCES.filter((d) => disc[d.id]).map((d) => disc[d.id].threshold);
  return EMERGENCES.map((def) => {
    const d = disc[def.id];
    if (d) return { def, found: { day: d.day, modelId: d.modelId, threshold: d.threshold }, hint: null };
    const near = knownThresholds.some((t) => Math.abs(t - def.threshold) <= LAB_TUNING.HINT_WINDOW);
    return { def, found: null, hint: near ? `somewhere past 10^${Math.floor(def.threshold)} effective FLOP` : null };
  });
}

export interface LabStats {
  runsByArch: Record<Id, number>;
  largestFlops: number;
  verified: number;
  discovered: number;
  undiscovered: number;
  /** Mean |actual - forecast| over the last runs, or null with no history. */
  forecastError: number | null;
}

export function labStats(s: GameState): LabStats {
  const lab = s.lab;
  const disc = lab?.discoveries ?? {};
  const discovered = EMERGENCES.filter((d) => disc[d.id]).length;
  const errs = lab?.forecastErrors ?? [];
  return {
    runsByArch: { ...(lab?.runsByArch ?? {}) },
    largestFlops: lab?.largestFlops ?? 0,
    verified: lab?.verifiedData.length ?? 0,
    discovered,
    undiscovered: EMERGENCES.length - discovered,
    forecastError: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
  };
}

// ---------------------------------------------------------------------------
// Forecasts (belief only)
// ---------------------------------------------------------------------------

function confidenceFor(sd: number): Forecast['confidence'] {
  if (sd < 2) return 'tight';
  if (sd < 3.5) return 'decent';
  if (sd < 6) return 'rough';
  return 'wild guess';
}

function fmtTimes(x: number): string {
  return x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`;
}

/** Emergences the lab has discovered, expected over their chance, for a run whose belief effective compute is L. */
function expectedDiscoveredCapAdd(s: GameState, L: number, getShares: () => Partial<Record<DataKind, number>>): Partial<Capabilities> {
  let out: Partial<Capabilities> = {};
  const disc = s.lab?.discoveries ?? {};
  for (const def of EMERGENCES) {
    const d = disc[def.id];
    if (!d || L < d.threshold) continue;
    if (!requirementsMet(s, def, getShares())) continue;
    out = sumCapAdd(out, scaleCapAdd(def.capAdd, def.chance * LAB_TUNING.EMERGENCE_CAP_SCALE));
  }
  return out;
}

/** The SD (overall points) of a pre-training forecast, with the reasons it is wide. */
function pretrainBand(s: GameState, cfg: TrainingConfig, phys: RunPhysics, datasetIds: readonly Id[]): { sd: number; reasons: string[] } {
  const lab = s.lab;
  const arch = cfg.arch;
  const archName = optionById(arch)?.name ?? arch;
  const runs = lab?.runsByArch?.[arch] ?? 0;
  const factors: { v: number; why: string | null }[] = [];

  // Scale novelty: the first run counts as ten times novelty.
  const largest = lab?.largestFlops ?? 0;
  const ref = largest > 0 ? largest : phys.totalFlops / 10;
  const ratio = Math.max(1, phys.totalFlops) / Math.max(1, ref);
  const dec = Math.log10(ratio);
  factors.push({
    v: 1 + LAB_TUNING.NOVELTY_PER_DECADE * Math.max(0, dec),
    why: largest > 0 ? (dec > 0.05 ? `Extrapolating ${fmtTimes(ratio)} beyond your largest run.` : null) : 'Your first run this size: no baseline yet.',
  });

  // Architecture inexperience.
  factors.push({
    v: runs === 0 ? 1.5 : runs === 1 ? 1.25 : runs <= 3 ? 1.1 : 1,
    why: runs === 0 ? `First ${archName} run.` : runs === 1 ? `Second ${archName} run, not much to go on.` : null,
  });

  // Unverified data, by token share.
  const unique = new Set(datasetIds);
  let totalTok = 0;
  let unverifiedTok = 0;
  for (const id of unique) {
    const d = datasetById(s, id);
    if (!d) continue;
    totalTok += d.tokensB;
    if (!isVerifiedData(s, id)) unverifiedTok += d.tokensB;
  }
  const unverifiedShare = totalTok > 0 ? unverifiedTok / totalTok : 0;
  factors.push({
    v: 1 + LAB_TUNING.UNVERIFIED_PER_SHARE * unverifiedShare,
    why: unverifiedShare > 0.05 ? `${Math.round(unverifiedShare * 100)}% of tokens come from unaudited data.` : null,
  });

  // A sweep near this architecture and scale.
  const logN = Math.log10(Math.max(1e-6, phys.activeParamsB));
  const mup = isResearched(s, 'mup_transfer');
  const near = (lab?.sweeps?.[arch] ?? []).some((p) => mup || Math.abs(p.scale - logN) <= RUN_TUNING.LR_SWEEP_NEAR_LOG10);
  factors.push({
    v: near ? 1 : LAB_TUNING.NO_SWEEP_FACTOR,
    why: near ? null : 'No learning-rate sweep for this architecture at this size.',
  });

  if (isResearched(s, 'scaling_laws')) factors.push({ v: LAB_TUNING.SCALING_LAWS_FACTOR, why: null });
  if (mup) factors.push({ v: LAB_TUNING.MUP_FACTOR, why: null });

  // A fresh ablation of this sheet narrows it for a year.
  const ablatedDay = s.flags[ablationFlag(cfg)];
  if (ablatedDay !== undefined && s.day - ablatedDay <= RUN_TUNING.ABLATION_WINDOW_DAYS) factors.push({ v: LAB_TUNING.ABLATION_FACTOR, why: null });

  // Track record: the lab's past misses.
  const errs = lab?.forecastErrors ?? [];
  if (errs.length) {
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    factors.push({ v: clamp(0.7 + mean / 10, LAB_TUNING.TRACK_RECORD_MIN, LAB_TUNING.TRACK_RECORD_MAX), why: null });
  }

  const sd = LAB_TUNING.BAND_BASE_SD * factors.reduce((p, f) => p * f.v, 1);
  const reasons = factors
    .filter((f) => f.why && f.v > 1.05)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((f) => f.why as string);
  return { sd, reasons };
}

/** Short number for a forecast line: whole numbers from 10 up, one decimal below, two decimals under 1 for ratios. */
function fmtScaleNumber(x: number): string {
  if (x >= 10) return String(Math.round(x));
  return String(+x.toFixed(x < 1 ? 2 : 1));
}

/**
 * Overall points a run loses to undertraining: the same run with the penalty taken back out, minus this run. Zero when
 * the run has enough tokens per parameter.
 */
function undertrainOverallOf(s: GameState, phys: RunPhysics, tokensB: number, datasetIds: readonly Id[], techniques: readonly Id[], capAdd: Partial<Capabilities>, mid: number): number {
  if (phys.underPenalty <= 0) return 0;
  const free = capsFromTraining(
    s,
    { loss: phys.loss - phys.underPenalty * LOSS_PER_QUALITY_POINT, tokensB, datasetIds, techniques, qualityMult: phys.qualityMult, capAdd },
    null,
  );
  return Math.max(0, overallScore(scoresFromCaps(free)) - mid);
}

/** Forecast lines about the data scale: undertraining (with the expected cost in overall points) and repeated data. */
function scaleReasons(s: GameState, phys: RunPhysics, tokensB: number, datasetIds: readonly Id[], drop: number): string[] {
  const out: string[] = [];
  if (phys.underPenalty >= 0.5) {
    const lead = phys.tokensPerParam < SCALE_TUNING.UNDER_STRONG_RATIO ? 'Undertrained' : 'Slightly undertrained';
    // Quality cannot fall below zero, so a very weak model may not show the cost in overall points at all.
    const cost = drop > 0.05 ? `Expect −${fmtScaleNumber(drop)}.` : 'The quality floor hides the cost at this size.';
    out.push(`${lead}: ${fmtScaleNumber(phys.tokensPerParam)} tokens per parameter. Compute-optimal is about ${SCALE_TUNING.OPTIMAL_RATIO}. ${cost}`);
  }
  const repeats = repeatFactor(tokensB, uniqueTokensOf(s, datasetIds));
  if (repeats > 1.001) out.push(`Data repeated ${fmtScaleNumber(repeats)}×. Repeats count half.`);
  return out;
}

/** Forecast band for a pre-training run, built only from what the lab knows. */
export function forecastTraining(
  s: GameState,
  paramsB: number,
  tokensB: number,
  datasetIds: Id[],
  techniques: Id[],
  config: TrainingConfig,
): Forecast {
  const phys = resolveRun(s, paramsB, tokensB, datasetIds, techniques, config, 'belief');
  return forecastFromPhys(s, phys, tokensB, datasetIds, techniques, config);
}

/** The forecast for a run whose belief physics are already resolved (estimates reuse them). */
export function forecastFromPhys(
  s: GameState,
  phys: RunPhysics,
  tokensB: number,
  datasetIds: readonly Id[],
  techniques: readonly Id[],
  config: TrainingConfig,
): Forecast {
  // Shares are only needed for emergence requirements, so they are computed lazily.
  let shares: Partial<Record<DataKind, number>> | null = null;
  const getShares = () => (shares ??= shareMap(mixRows(s, datasetIds, config, 'belief')));
  const extra = expectedDiscoveredCapAdd(s, effLog10(phys), getShares);
  const caps = capsFromTraining(
    s,
    { loss: phys.loss, tokensB, datasetIds, techniques, qualityMult: phys.qualityMult, capAdd: sumCapAdd(phys.capAdd, extra) },
    null,
  );
  const mid = overallScore(scoresFromCaps(caps));
  const { sd, reasons: bandReasons } = pretrainBand(s, config, phys, datasetIds);
  const half = LAB_TUNING.Z80 * sd;
  const drop = undertrainOverallOf(s, phys, tokensB, datasetIds, techniques, sumCapAdd(phys.capAdd, extra), mid);
  const reasons = [...scaleReasons(s, phys, tokensB, datasetIds, drop), ...bandReasons];
  return { low: Math.max(0, mid - half), mid, high: Math.min(100, mid + half), confidence: confidenceFor(sd), reasons, caps, undertrainPenalty: drop };
}

/** Forecast band for a fine-tune of `parentId` into `specId`. */
export function forecastFinetune(s: GameState, parentId: Id, specId: Id, persona?: Persona): Forecast {
  const parent = s.models.find((m) => m.id === parentId);
  const spec = specById(specId);
  if (!parent || !spec) return { low: 0, mid: 0, high: 0, confidence: 'wild guess', reasons: ['Unknown model or specialisation.'], caps: emptyCaps() };
  const est = estimateFinetune(s, parentId, specId, false, persona);
  const mid = est?.overall ?? parent.overall;
  const caps = est?.caps ?? modelCaps(parent, s);
  const fresh = !s.models.some((m) => m.specId === spec.id);
  const sd = LAB_TUNING.FINETUNE_BASE_SD + (fresh ? LAB_TUNING.FINETUNE_NEW_SD : 0);
  const half = LAB_TUNING.Z80 * sd;
  return {
    low: Math.max(0, mid - half),
    mid,
    high: mid + half,
    confidence: confidenceFor(sd),
    reasons: fresh ? [`Nobody in your lab has tried ${spec.name} yet.`] : [],
    caps,
  };
}

/** The live run's current band: the launch forecast, narrowed by the latest checkpoint reading. Null when idle. */
export function currentRunBand(s: GameState): { low: number; mid: number; high: number; source: 'forecast' | 'checkpoint' } | null {
  const run = s.training;
  if (!run?.forecast) return null;
  const cps = run.checkpoints ?? [];
  if (cps.length) {
    const c = cps[cps.length - 1];
    return { low: Math.max(0, c.reading - c.band), mid: c.reading, high: Math.min(100, c.reading + c.band), source: 'checkpoint' };
  }
  return { low: run.forecast.low, mid: run.forecast.mid, high: run.forecast.high, source: 'forecast' };
}

// ---------------------------------------------------------------------------
// True physics for runs (hidden truths, GAME_DESIGN 16.1 and 16.3)
// ---------------------------------------------------------------------------

/** Seed luck and tag for a pre-training run. */
export function rollSeedLuck(rng: Rng): { seedLuck: number; seedTag: 'golden' | 'cursed' | null } {
  const r = rng.next();
  const cap = (x: number) => clamp(x, -LAB_TUNING.LUCK_CAP, LAB_TUNING.LUCK_CAP);
  if (r < LAB_TUNING.GOLDEN_CHANCE) return { seedLuck: cap(rng.normal(LAB_TUNING.GOLDEN_MEAN, LAB_TUNING.GOLDEN_SD)), seedTag: 'golden' };
  if (r < LAB_TUNING.GOLDEN_CHANCE + LAB_TUNING.CURSED_CHANCE) {
    return { seedLuck: cap(rng.normal(LAB_TUNING.CURSED_MEAN, LAB_TUNING.CURSED_SD)), seedTag: 'cursed' };
  }
  return { seedLuck: cap(rng.normal(0, LAB_TUNING.LUCK_SD)), seedTag: null };
}

/**
 * Which rolled emergences this run can produce: those whose requirements hold and whose threshold the FULL run
 * reaches, each passing its chance roll once. Detection happens during the run.
 */
export function planEmergences(s: GameState, rng: Rng, cfg: TrainingConfig, datasetIds: readonly Id[], truePhys: RunPhysics): Id[] {
  const shares = shareMap(mixRows(s, datasetIds, cfg, 'true'));
  const L = effLog10(truePhys);
  const plan: Id[] = [];
  const known = labOf(s).discoveries;
  let fresh = 0;
  for (const def of EMERGENCES) {
    if (!requirementsMet(s, def, shares)) continue;
    if (L < emergenceThresholdOf(s, def)) continue;
    if (!rng.chance(def.chance)) continue;
    // Already-discovered abilities come along freely; brand-new discoveries are rationed so they keep coming
    // one or two at a time instead of all landing on the first big run.
    if (!known[def.id]) {
      if (fresh >= LAB_TUNING.MAX_NEW_EMERGENCES_PER_RUN) continue;
      fresh += 1;
    }
    plan.push(def.id);
  }
  return plan;
}

/** Hidden truths for a new pre-training run: luck, vibes, emergence plan and grokking. The true overall is set by recomputeTrueOverall. */
export function rollPretrainHidden(s: GameState, rng: Rng, cfg: TrainingConfig, datasetIds: readonly Id[], truePhys: RunPhysics): RunHidden {
  const luck = rollSeedLuck(rng);
  const emergencePlan = planEmergences(s, rng, cfg, datasetIds, truePhys);
  let grokking: [number, number] | undefined;
  if (rng.chance(LAB_TUNING.GROK_CHANCE)) {
    const from = rng.range(LAB_TUNING.GROK_FROM[0], LAB_TUNING.GROK_FROM[1]);
    const to = Math.min(LAB_TUNING.GROK_END_MAX, from + rng.range(LAB_TUNING.GROK_LENGTH[0], LAB_TUNING.GROK_LENGTH[1]));
    grokking = [from, to];
  }
  const vibes = rng.normal(0, LAB_TUNING.VIBES_SD);
  return {
    seedLuck: luck.seedLuck,
    seedTag: luck.seedTag,
    trueOverall: 0,
    vibes,
    emergencePlan,
    ...(grokking ? { grokking } : {}),
  };
}

/** Fine-tune: how well the specialisation took. */
export function rollSpecTake(rng: Rng): number {
  return clamp(rng.normal(1, LAB_TUNING.SPEC_TAKE_SD), LAB_TUNING.SPEC_TAKE_MIN, LAB_TUNING.SPEC_TAKE_MAX);
}

/** Planned emergences not yet detected in this run. */
function pendingPlan(run: TrainingRun): Id[] {
  const emerged = new Set(run.emerged ?? []);
  return (run.hidden?.emergencePlan ?? []).filter((id) => !emerged.has(id));
}

/** Capability changes of emergences planned for this run but not yet seen. */
export function pendingPlanCapAdd(run: TrainingRun): Partial<Capabilities> {
  let out: Partial<Capabilities> = {};
  for (const id of pendingPlan(run)) {
    const def = emergenceById(id);
    if (def) out = sumCapAdd(out, scaleCapAdd(def.capAdd, LAB_TUNING.EMERGENCE_CAP_SCALE));
  }
  return out;
}

/** The true capabilities of a run with the given capAdd. Noise-free; luck and vibes are applied separately. */
export function trueCapsOf(s: GameState, run: TrainingRun, capAdd: Partial<Capabilities>): Capabilities {
  return capsFromTraining(
    s,
    { loss: run.predictedLoss, tokensB: run.tokensB, datasetIds: run.datasetIds, techniques: run.techniques, qualityMult: run.qualityMult ?? 1, capAdd },
    null,
  );
}

/** Recompute hidden.trueOverall from the run's current true inputs (after incidents, early stop, extension, emergences). */
export function recomputeTrueOverall(s: GameState, run: TrainingRun): void {
  if (run.kind === 'finetune' || !run.hidden) return;
  const caps = trueCapsOf(s, run, sumCapAdd(run.capAdd ?? {}, pendingPlanCapAdd(run)));
  run.hidden.trueOverall = overallScore(scoresFromCaps(caps)) + run.hidden.seedLuck;
}

/** Progress-based effective compute of a run in the true world, at a fraction of its tokens. */
function runEffLog10(s: GameState, run: TrainingRun, fraction: number): number {
  const phys = resolveRun(s, run.paramsB, run.tokensB * fraction, run.datasetIds, run.techniques, runConfig(s, run), 'true');
  return effLog10(phys);
}

/** The loss display progress: flat through a grokking plateau, then the drop. */
export function plateauProgress(run: TrainingRun, progress: number): number {
  const g = run.hidden?.grokking;
  if (g && progress >= g[0] && progress < g[1]) return g[0];
  return progress;
}

function logRun(run: TrainingRun, s: GameState, text: string, kind: 'good' | 'bad' | 'info' | 'milestone'): void {
  run.log = [...(run.log ?? []), { day: s.day, text, kind }];
}

function doCheckpoint(s: GameState, run: TrainingRun, at: number, rng: Rng): void {
  const band = (LAB_TUNING.CHECKPOINT_BAND[at] ?? 3) * (isResearched(s, 'scaling_laws') ? LAB_TUNING.SCALING_LAWS_FACTOR : 1);
  const reading = (run.hidden?.trueOverall ?? 0) + rng.normal(0, band);
  const f = run.forecast;
  const where: 'above' | 'on' | 'below' = f ? (reading > f.high ? 'above' : reading < f.low ? 'below' : 'on') : 'on';
  const pct = Math.round(at * 100);
  const note = pickCopy(rng, CHECKPOINT_NOTES[where], { model: run.name, pct });
  run.checkpoints = [...(run.checkpoints ?? []), { at, day: s.day, reading, band, note }];
  const n = run.checkpoints.length;
  const kind = where === 'above' ? 'good' : where === 'below' ? 'bad' : 'info';
  const text = `Checkpoint ${n} evals (${pct}%): tracking ${reading.toFixed(0)} ± ${band.toFixed(0)}. ${note}`;
  notify(s, `${run.name}: ${text}`, kind);
  logRun(run, s, text, kind);
}

/**
 * Watch a live pre-training run: checkpoints at 25/50/75% and emergences as compute crosses their thresholds.
 * Called every day from the training tick, before the loss sample.
 */
export function watchRun(s: GameState, run: TrainingRun, rng: Rng): void {
  if (run.kind === 'finetune' || !run.hidden || run.totalFlops <= 0) return;
  const p = clamp(run.doneFlops / run.totalFlops, 0, 1);
  const done = new Set((run.checkpoints ?? []).map((c) => c.at));
  for (const at of LAB_TUNING.CHECKPOINT_STEPS) {
    if (p >= at && !done.has(at)) doCheckpoint(s, run, at, rng);
  }
  const pending = pendingPlan(run);
  if (pending.length === 0) return;
  const L = runEffLog10(s, run, p);
  for (const id of pending) {
    const def = emergenceById(id);
    if (!def || L < emergenceThresholdOf(s, def)) continue;
    run.emerged = [...(run.emerged ?? []), id];
    run.capAdd = sumCapAdd(run.capAdd ?? {}, scaleCapAdd(def.capAdd, LAB_TUNING.EMERGENCE_CAP_SCALE));
    const pct = Math.round(p * 100);
    const text = `At ${pct}%: ${def.name}. ${def.description}`;
    notify(s, `${run.name} ${text}`, def.good ? 'milestone' : 'bad');
    logRun(run, s, text, def.good ? 'good' : 'bad');
  }
  recomputeTrueOverall(s, run);
}

/** At the end of a run: emergences whose thresholds the finished run reached count, the rest never show. */
export function settleEmergences(s: GameState, run: TrainingRun): void {
  const pending = pendingPlan(run);
  if (pending.length === 0) return;
  const L = runEffLog10(s, run, 1);
  for (const id of pending) {
    const def = emergenceById(id);
    if (!def || L < emergenceThresholdOf(s, def)) continue;
    run.emerged = [...(run.emerged ?? []), id];
    run.capAdd = sumCapAdd(run.capAdd ?? {}, scaleCapAdd(def.capAdd, LAB_TUNING.EMERGENCE_CAP_SCALE));
  }
}

/** Verdict from the actual overall against the forecast band (GAME_DESIGN 16.4). */
export function verdictFor(actual: number, forecast: Forecast, seedTag: 'golden' | 'cursed' | null): Verdict {
  const d = actual - forecast.mid;
  const w = (forecast.high - forecast.low) / 2;
  if (seedTag === 'cursed' && d < -w) return 'cursed';
  if (d > 1.5 * w) return 'banger';
  if (d > 0.5 * w) return 'solid';
  if (Math.abs(d) <= 0.5 * w) return 'as expected';
  if (d < -1.5 * w) return 'dud';
  return 'mid';
}

/** Ticker line for an eval verdict. */
export function verdictNews(s: GameState, rng: Rng, verdict: Verdict, model: string, actual: number, mid: number): string {
  return pickCopy(rng, VERDICT_NEWS[verdict], { model, actual: actual.toFixed(1), mid: mid.toFixed(1), company: s.company.name });
}

/** Lab bookkeeping at eval day: runs per arch, largest run, forecast track record and discoveries. */
export function recordLabEval(
  s: GameState,
  o: { kind: 'pretrain' | 'finetune'; arch: Id; totalFlops: number; actual: number; forecastMid: number; modelId: Id; day: number; discovered: { id: Id; threshold: number }[] },
): void {
  const lab = labOf(s);
  if (o.kind === 'pretrain') {
    lab.runsByArch[o.arch] = (lab.runsByArch[o.arch] ?? 0) + 1;
    lab.largestFlops = Math.max(lab.largestFlops, o.totalFlops);
  }
  lab.forecastErrors = [...lab.forecastErrors, Math.abs(o.actual - o.forecastMid)].slice(-LAB_TUNING.FORECAST_ERRORS_KEEP);
  for (const d of o.discovered) {
    if (!lab.discoveries[d.id]) lab.discoveries[d.id] = { day: o.day, modelId: o.modelId, threshold: d.threshold };
  }
}

/** Emergences this run showed, as discoveries to record at eval day. */
export function discoveriesOf(s: GameState, run: TrainingRun): { id: Id; threshold: number }[] {
  return (run.emerged ?? []).map((id) => {
    const def = emergenceById(id);
    return { id, threshold: def ? emergenceThresholdOf(s, def) : 0 };
  });
}

/** Fine-tune caps in the true world: the parent's caps, the spec scaled by how well it took, persona and noise. */
export function trueFinetuneCaps(
  parentCaps: Capabilities,
  spec: { capAdd: Partial<Capabilities> },
  take: number,
  persona: Persona | undefined,
  rng: Rng | null,
  noiseSd: number,
): Capabilities {
  const out = { ...parentCaps };
  for (const k of CAP_IDS) out[k] = parentCaps[k] + take * CAP_TUNING.SPEC_CAP_SCALE * (spec.capAdd[k] ?? 0) + (rng && noiseSd > 0 ? rng.normal(0, noiseSd) : 0);
  return addCapDeltas(clampCaps(out), personaCapAdd(persona));
}

/** Catastrophic forgetting: with a chance, one capability the spec did not target drops by a few points. */
export function applyForgetting(caps: Capabilities, spec: { capAdd: Partial<Capabilities> }, rng: Rng): { caps: Capabilities; lost?: { cap: CapId; amount: number; text: string } } {
  if (!rng.chance(LAB_TUNING.FORGET_CHANCE)) return { caps };
  const targets = new Set(Object.keys(spec.capAdd));
  const pool = CAP_IDS.filter((k) => !targets.has(k) && caps[k] > 0);
  if (pool.length === 0) return { caps };
  const cap = rng.pick(pool);
  const amount = rng.range(LAB_TUNING.FORGET_MIN, LAB_TUNING.FORGET_MAX);
  const out = { ...caps, [cap]: clamp(caps[cap] - amount, 0, 100) } as Capabilities;
  return { caps: out, lost: { cap, amount, text: FORGET_COPY[cap] } };
}

/** Hidden-truth overall of a fine-tune at launch (no noise): parent + spec at the rolled take + persona. */
export function finetuneTrueOverall(s: GameState, parentId: Id, specId: Id, take: number, persona: Persona | undefined): number {
  const parent = s.models.find((m) => m.id === parentId);
  const spec = specById(specId);
  if (!parent || !spec) return 0;
  return overallScore(scoresFromCaps(trueFinetuneCaps(modelCaps(parent, s), spec, take, persona, null, 0)));
}


// ---------------------------------------------------------------------------
// Helpers for daily ticks and actions
// ---------------------------------------------------------------------------

/** A deterministic pick from copy lines, keyed on the state (labTick has no rng of its own). */
function pickFrom(s: GameState, key: string, lines: string[], vars: Record<string, string | number>): string {
  const rng = { pick: <T,>(arr: readonly T[]) => arr[Math.floor(hashUniform(s.seed, key) * arr.length)] } as unknown as Rng;
  return pickCopy(rng, lines, vars);
}

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

/** Sweeps, audits, red-teaming and latent quirks surfacing. Runs after the training tick. */
export function labTick(s: GameState): void {
  const lab = s.lab;
  if (lab) {
    const jobs = lab.sweepJobs ?? [];
    const done = jobs.filter((j: SweepJob) => j.doneDay <= s.day);
    if (done.length) {
      lab.sweepJobs = jobs.filter((j) => j.doneDay > s.day);
      for (const j of done) {
        lab.sweeps[j.arch] = [...(lab.sweeps[j.arch] ?? []), ...j.points];
        const best = j.points.reduce((b, p) => (p.reading > b.reading ? p : b), j.points[0]);
        const name = optionById(j.arch)?.name ?? j.arch;
        notify(s, `LR sweep for ${name} is in: the best learning rate was about ${best.lr.toFixed(2)}.`, 'good');
      }
    }
  }

  // Audits: flags 'audit.<datasetId>' hold the day they finish.
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith('audit.') || s.day < s.flags[key]) continue;
    const id = key.slice('audit.'.length);
    delete s.flags[key];
    const d = datasetById(s, id);
    if (!d) continue;
    const labNow = labOf(s);
    if (!labNow.verifiedData.includes(id)) labNow.verifiedData.push(id);
    const truth = trueQualityOf(s, d);
    const line = dataSurpriseLine(s, `audit:${id}:${s.day}`, { name: d.name, claimed: d.quality, truth });
    notify(s, line.text, line.kind);
  }

  // Red-team completions: the latent quirks become known to the lab, quietly.
  for (const m of s.models) {
    const rt = m.redTeam;
    if (!rt || rt === true || s.day < rt.doneDay) continue;
    m.redTeam = true;
    const found = m.latentQuirks ?? [];
    const known = new Set(m.quirks ?? []);
    m.quirks = [...(m.quirks ?? []), ...found.filter((q) => !known.has(q))];
    m.latentQuirks = [];
    const names = found.map((q) => quirkById(q)?.name ?? q);
    notify(s, found.length ? `Red team on ${m.name} is done: ${names.join('; ')}. Nobody outside the building knows.` : `Red team on ${m.name} is done and found nothing. Suspicious.`, found.length ? 'info' : 'info');
  }

  // Latent quirks surface after release, 2% a day each.
  for (const m of s.models) {
    if (m.releasedDay === null || !m.latentQuirks?.length) continue;
    for (const q of [...m.latentQuirks]) {
      if (hashUniform(s.seed, `surf:${m.id}:${q}:${s.day}`) >= LAB_TUNING.LATENT_SURFACE_PER_DAY) continue;
      m.latentQuirks = m.latentQuirks.filter((x) => x !== q);
      m.quirks = [...(m.quirks ?? []), q];
      const def = quirkById(q);
      const good = def?.good === true;
      const text = pickFrom(s, `surf:${m.id}:${q}:${s.day}:copy`, LATENT_DISCOVERY_COPY[good ? 'good' : 'bad'], { model: m.name, quirk: def?.name ?? q });
      if (good) {
        s.company.hype = clamp(s.company.hype + LAB_TUNING.GOOD_QUIRK_HYPE, 0, 100);
      } else {
        s.company.reputation = clamp(s.company.reputation + LAB_TUNING.BAD_QUIRK_REP, 0, 100);
        s.company.hype = clamp(s.company.hype + LAB_TUNING.BAD_QUIRK_HYPE, 0, 100);
      }
      pushNews(s, text, good ? 'good' : 'bad');
      notify(s, text, good ? 'good' : 'bad');
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const handlers: ActionHandlers = {
  runLrSweep: (s, a, rng) => {
    const cfg = a.config;
    const lrs = [...new Set((a.lrs ?? []).filter((x) => Number.isFinite(x)).map((x) => clamp(x, 0, 1)))];
    if (lrs.length < LAB_TUNING.SWEEP_MIN_LRS || lrs.length > LAB_TUNING.SWEEP_MAX_LRS) {
      notify(s, `Sweeps run ${LAB_TUNING.SWEEP_MIN_LRS} to ${LAB_TUNING.SWEEP_MAX_LRS} learning rates.`, 'bad');
      return;
    }
    if (!Number.isFinite(a.paramsB) || a.paramsB <= 0 || !Number.isFinite(a.tokensB) || a.tokensB <= 0) {
      notify(s, 'Size the planned run before sweeping it.', 'bad');
      return;
    }
    const err = validateConfig(s, cfg);
    if (err) {
      notify(s, err, 'bad');
      return;
    }
    const ids = [...new Set(a.datasetIds)];
    for (const id of ids) {
      if (!s.data.owned.includes(id)) {
        notify(s, `You don't own ${datasetById(s, id)?.name ?? id} yet.`, 'bad');
        return;
      }
    }
    if (a.tokensB > uniqueTokensOf(s, ids) * RUN_TUNING.MAX_EPOCHS + 1e-9) {
      notify(s, 'The planned run would need more data than you own for a sweep.', 'bad');
      return;
    }
    const quote = sweepQuote(s, a.paramsB, a.tokensB, ids, cfg, lrs);
    if (!Number.isFinite(quote.cost)) {
      notify(s, 'No cloud GPUs are available to run a sweep.', 'bad');
      return;
    }
    if (!trySpend(s, 'compute', quote.cost, 'the learning-rate sweep')) return;
    const phys = resolveRun(s, a.paramsB, a.tokensB, ids, [], cfg, 'belief');
    const proxyActive = phys.activeParamsB / Math.sqrt(LAB_TUNING.SWEEP_PROXY_COMPUTE_DIVISOR);
    const scale = Math.log10(Math.max(1e-6, proxyActive));
    const mup = isResearched(s, 'mup_transfer');
    const sigma = LAB_TUNING.SWEEP_NOISE_SD * (isResearched(s, 'scaling_laws') ? 0.5 : 1);
    const doneDay = s.day + quote.days;
    const points: SweepPoint[] = lrs.map((lr) => ({
      lr,
      scale,
      reading: trueLrQuality(s, cfg.arch, proxyActive, lr, mup) + rng.normal(0, sigma),
      day: doneDay,
    }));
    const lab = labOf(s);
    lab.sweepJobs = [...(lab.sweepJobs ?? []), { arch: cfg.arch, doneDay, points }];
    const name = optionById(cfg.arch)?.name ?? cfg.arch;
    notify(s, `LR sweep for ${name} started: ${lrs.length} proxy runs, results in ${quote.days} days.`, 'info');
  },

  auditDataset: (s, a) => {
    const d = datasetById(s, a.datasetId);
    if (!d) {
      notify(s, 'Unknown dataset.', 'bad');
      return;
    }
    if (!s.data.owned.includes(d.id)) {
      notify(s, `You need ${d.name} before you can audit it.`, 'bad');
      return;
    }
    if (isVerifiedData(s, d.id)) {
      notify(s, `${d.name} has already been audited by its own training runs.`, 'info');
      return;
    }
    if (s.flags[`audit.${d.id}`] !== undefined) {
      notify(s, `${d.name} is already under audit.`, 'info');
      return;
    }
    const q = auditQuote(s, d.id);
    if (!trySpend(s, 'data', q.cost, `the audit of ${d.name}`)) return;
    s.flags[`audit.${d.id}`] = s.day + q.days;
    notify(s, `Auditing ${d.name}: results in ${q.days} days.`, 'info');
  },

  redTeamModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is already public. Red teaming has to happen before release.`, 'bad');
      return;
    }
    if (m.redTeam) {
      notify(s, `${m.name} has already been red-teamed.`, 'info');
      return;
    }
    const q = redTeamQuote(s, m.id);
    if (!Number.isFinite(q.cost)) {
      notify(s, 'No cloud GPUs are available for red teaming.', 'bad');
      return;
    }
    if (!trySpend(s, 'research', q.cost, `red teaming ${m.name}`)) return;
    m.redTeam = { doneDay: s.day + q.days };
    notify(s, `Red teaming ${m.name}: ${q.days} days. Results stay in the building.`, 'info');
  },

  dismissReveal: (s) => {
    s.pendingReveal = null;
  },
};
