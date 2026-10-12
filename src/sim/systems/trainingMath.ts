// OWNER: training agent. Pure run physics: turns a run sheet, a dataset list and the researched tech into the
// numbers a run uses (FLOPs, data quality, loss, quality and cap multipliers, speed, instability, incident rate,
// uncertainty). Used by estimates (the UI), run start and finish, incidents and ablations. No state is mutated.
import type { Capabilities, DataKind, DatasetDef, GameState, Id, TrainingConfig, TrainingRun } from '../types';
import { BALANCE } from '../balance';
import { getBonuses } from '../bonuses';
import { clamp } from '../util';
import { DATA_KIND_CAPS, RUN_TUNING, TrainingOption, configSignature, legacyConfig, optionById, speedMultiplier } from '../data/trainingOptions';
import { isResearched } from './research';
import { roleStrength } from './staff';
import { clusterEfficiency } from './compute';
import { believedQualityOf, collapsePenalty, datasetById, hashNormal, trueQualityOf } from './data';
import { trainingRatePerDay } from './capabilities';

/**
 * 'true' is what the run really does (hidden truths). 'belief' is what the lab knows: claimed data quality until
 * verified, and learning-rate quality from its sweeps. Estimates and forecasts use 'belief'; runs use 'true'.
 */
export type PhysicsMode = 'true' | 'belief';

/** Quality the given mode assigns to a dataset. */
export function qualityIn(s: GameState, def: DatasetDef, mode: PhysicsMode): number {
  return mode === 'true' ? trueQualityOf(s, def) : believedQualityOf(s, def);
}

/** Chinchilla-style loss L = E + A/N^alpha + B/D_eff^beta. `tokensB` is the effective token count in billions. */
export function chinchillaLoss(paramsB: number, tokensB: number, quality: number): number {
  const N = Math.max(1, paramsB * 1e9);
  const D = Math.max(1, tokensB * 1e9 * (0.5 + clamp(quality, 0, 1)));
  return BALANCE.LOSS_E + BALANCE.LOSS_A / N ** BALANCE.LOSS_ALPHA + BALANCE.LOSS_B / D ** BALANCE.LOSS_BETA;
}

/** Unique tokens are used first. Tokens beyond that are repeats worth half. */
export function effectiveTokens(tokensB: number, uniqueTokensB: number): number {
  const unique = Math.min(tokensB, uniqueTokensB);
  const repeated = Math.max(0, tokensB - uniqueTokensB);
  return unique + 0.5 * repeated;
}

/**
 * Data scaling (the tokens-per-parameter rule). Effective tokens per effective parameter is the ratio the loss sees.
 * Below OPTIMAL_RATIO a run is undertrained: it loses UNDER_K quality points per doubling of the gap, capped at
 * UNDER_MAX. Above it there is no penalty (overtrained runs cost compute but stay good value to serve).
 * OVERHEAD: every pretrain spends fixed days on setup, warm-up and evals before any FLOPs land.
 */
export const SCALE_TUNING = {
  OPTIMAL_RATIO: 20,
  UNDER_K: 3.5,
  UNDER_MAX: 25,
  /** Below this ratio the wizard calls a run undertrained. Between it and OPTIMAL_RATIO the line is milder. */
  UNDER_STRONG_RATIO: 12,
  /** Above this ratio the wizard calls a run overtrained. */
  OVER_RATIO: 40,
  OVERHEAD_DAYS_BASE: 2,
  OVERHEAD_PER_LOG_PARAMS: 1.5,
};

/** Loss added per quality point taken off (lossToQuality maps the loss range onto 0..100). */
export const LOSS_PER_QUALITY_POINT = (BALANCE.LOSS_WORST - BALANCE.LOSS_BEST) / 100;

/** Quality points lost to undertraining at a given effective tokens-per-parameter ratio. Zero at or above the optimum. */
export function undertrainPenalty(tokensPerParam: number): number {
  if (!(tokensPerParam > 0)) return SCALE_TUNING.UNDER_MAX;
  if (tokensPerParam >= SCALE_TUNING.OPTIMAL_RATIO) return 0;
  return Math.min(SCALE_TUNING.UNDER_MAX, SCALE_TUNING.UNDER_K * Math.log2(SCALE_TUNING.OPTIMAL_RATIO / tokensPerParam));
}

/** Fixed days a pretrain of this size spends before its FLOPs start to count. */
export function runOverheadDays(paramsB: number): number {
  return SCALE_TUNING.OVERHEAD_DAYS_BASE + SCALE_TUNING.OVERHEAD_PER_LOG_PARAMS * Math.log10(Math.max(1, paramsB));
}

/** Tokens trained per unique token: 1 is one epoch, 3.1 means the data is seen 3.1 times on average. */
export function repeatFactor(tokensB: number, uniqueTokensB: number): number {
  return uniqueTokensB > 0 ? tokensB / uniqueTokensB : 1;
}

/** Distinct unique tokens (billions) across dataset ids, static and custom. */
export function uniqueTokensOf(s: GameState, ids: readonly Id[]): number {
  let total = 0;
  for (const id of new Set(ids)) total += datasetById(s, id)?.tokensB ?? 0;
  return total;
}

/** Run sheet of a run, falling back to the legacy sheet for runs that predate it. */
export function runConfig(s: GameState, run: TrainingRun): TrainingConfig {
  return run.config ?? legacyConfig(s, run.datasetIds);
}

export function expertsOf(cfg: TrainingConfig): number {
  return cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS;
}

/** FLOP-active parameters (billions): the total for dense models, the active experts for MoE. */
export function activeParamsFor(paramsB: number, cfg: TrainingConfig): number {
  if (cfg.arch !== 'moe') return paramsB;
  return paramsB * (RUN_TUNING.MOE_ACTIVE_FRACTION[expertsOf(cfg)] ?? RUN_TUNING.MOE_ACTIVE_FRACTION[RUN_TUNING.MOE_DEFAULT_EXPERTS]);
}

/** Parameters the loss sees (billions). MoE: N_eff = N_act^a x N_tot^(1-a). */
export function effParamsFor(paramsB: number, cfg: TrainingConfig): number {
  if (cfg.arch !== 'moe') return paramsB;
  const active = activeParamsFor(paramsB, cfg);
  const a = RUN_TUNING.MOE_ACTIVE_EXPONENT;
  return active ** a * paramsB ** (1 - a);
}

/** Every option a run sheet selects, in group order. */
export function configOptions(cfg: TrainingConfig): TrainingOption[] {
  const ids = [cfg.arch, cfg.tokenizer, cfg.context, cfg.optimizer, cfg.precision, cfg.schedule, ...cfg.filters];
  return ids.map((id) => optionById(id)).filter((o): o is TrainingOption => !!o);
}

/** Key under which an ablation of this run sheet is recorded in s.flags. */
export function ablationFlag(cfg: TrainingConfig): string {
  return `ablation.${configSignature(cfg)}`;
}

/** One data kind in a run's mix: its share of the mix, and the token-weighted quality of its datasets. */
export interface MixRow {
  kind: DataKind;
  share: number;
  quality: number;
}

/**
 * Mix rows for the datasets in a run. Missing kinds in the mix weigh 1. All-zero weights fall back to an equal split.
 * Quality is the true one in 'true' mode, the believed one otherwise.
 */
export function mixRows(s: GameState, datasetIds: readonly Id[], cfg: TrainingConfig, mode: PhysicsMode = 'belief'): MixRow[] {
  const acc = new Map<DataKind, { tokens: number; weighted: number }>();
  for (const id of new Set(datasetIds)) {
    const d = datasetById(s, id);
    if (!d) continue;
    const a = acc.get(d.kind) ?? { tokens: 0, weighted: 0 };
    a.tokens += d.tokensB;
    a.weighted += d.tokensB * qualityIn(s, d, mode);
    acc.set(d.kind, a);
  }
  const kinds = [...acc.keys()];
  if (kinds.length === 0) return [];
  let weights = kinds.map((k) => Math.max(0, cfg.dataMix[k] ?? 1));
  let sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    weights = kinds.map(() => 1);
    sum = kinds.length;
  }
  return kinds.map((kind, i) => {
    const a = acc.get(kind)!;
    return { kind, share: weights[i] / sum, quality: a.tokens > 0 ? a.weighted / a.tokens : 0 };
  });
}

/** Mix-weighted dataset quality (0..1, before the dataQuality bonus). */
export function mixedQuality(rows: readonly MixRow[]): number {
  return rows.reduce((t, r) => t + r.share * r.quality, 0);
}

/**
 * Capability swings from the data mix: relative to an equal split of the kinds in use, each kind pushes its
 * capabilities by up to MIX_SWING at the extreme (one kind takes everything).
 */
export function mixCapAdd(rows: readonly MixRow[]): Partial<Capabilities> {
  const used = rows.filter((r) => r.share > 0);
  const k = used.length;
  const out: Partial<Capabilities> = {};
  if (k < 2) return out;
  for (const r of used) {
    const delta = (r.share - 1 / k) / (1 - 1 / k);
    for (const [cap, factor] of Object.entries(DATA_KIND_CAPS[r.kind]) as [keyof Capabilities, number][]) {
      out[cap] = (out[cap] ?? 0) + RUN_TUNING.MIX_SWING * factor * delta;
    }
  }
  return out;
}

/** Instability of a run sheet (see GAME_DESIGN 13.1): option terms, the learning rate, and the stability research. */
export function instabilityFor(s: GameState, cfg: TrainingConfig): number {
  let x = 0;
  for (const o of configOptions(cfg)) x += o.instability ?? 0;
  if (cfg.arch === 'moe') {
    if (isResearched(s, 'moe_load_balancing')) x += RUN_TUNING.MOE_LOAD_BALANCING_INSTAB;
    if (isResearched(s, 'aux_free_balancing')) x += RUN_TUNING.AUX_FREE_BALANCING_INSTAB;
  }
  const lr = clamp(cfg.lr, 0, 1);
  x += RUN_TUNING.LR_INSTAB * lr * lr * (isResearched(s, 'mup_transfer') ? RUN_TUNING.MUP_LR_INSTAB_MULT : 1);
  if (isResearched(s, 'qk_norm')) x += RUN_TUNING.QK_NORM_INSTAB;
  if (isResearched(s, 'z_loss')) x += RUN_TUNING.Z_LOSS_INSTAB;
  return Math.max(RUN_TUNING.MIN_INSTABILITY, x);
}

/** Expected incidents per day for a run: instability, hardware failures, scaled by safety and engineers. */
export function incidentRateFor(s: GameState, instability: number, usedGpus: number): number {
  const hardwareFactor = isResearched(s, 'fault_tolerant_training') ? RUN_TUNING.FAULT_TOLERANT_HARDWARE_LEFT : 1;
  const hardware = RUN_TUNING.HARDWARE_COEF * Math.sqrt(Math.max(0, usedGpus) / 1000) * hardwareFactor;
  const base = RUN_TUNING.INCIDENT_BASE + RUN_TUNING.INCIDENT_PER_INSTAB * instability + hardware;
  const safety = Math.max(0.2, getBonuses(s).safety);
  const engineers = 1 + RUN_TUNING.ENGINEER_INCIDENT_COEF * Math.sqrt(roleStrength(s, 'engineer'));
  return Math.max(RUN_TUNING.MIN_INCIDENT_RATE, base / safety / engineers);
}

/**
 * SD of the predicted overall score (points). Scaling laws and mup_transfer tighten it; a fresh ablation of this
 * run sheet halves it for a year.
 */
export function uncertaintyFor(s: GameState, cfg: TrainingConfig): number {
  let u = RUN_TUNING.UNCERTAINTY_BASE;
  if (isResearched(s, 'scaling_laws')) u *= RUN_TUNING.UNCERTAINTY_SCALING_LAWS;
  if (isResearched(s, 'mup_transfer')) u *= RUN_TUNING.UNCERTAINTY_MUP;
  const doneDay = s.flags[ablationFlag(cfg)];
  if (doneDay !== undefined && s.day - doneDay <= RUN_TUNING.ABLATION_WINDOW_DAYS) u *= RUN_TUNING.ABLATION_UNCERTAINTY_MULT;
  return u;
}

// ---------------------------------------------------------------------------
// Learning-rate quality (GAME_DESIGN 16.1 and 16.2)
// ---------------------------------------------------------------------------

/** Per-game offset of an architecture's optimal LR. Stored in lab.lrOffsets once the lab exists; the same hash otherwise. */
export function lrOffsetOf(s: GameState, arch: Id): number {
  return s.lab?.lrOffsets?.[arch] ?? hashNormal(s.seed, `lr:${arch}`, RUN_TUNING.LR_OPT_OFFSET_SD);
}

/** The true optimal learning rate for an architecture at a given active size. mup_transfer removes the scale drift. */
export function lrOptimumOf(s: GameState, arch: Id, activeParamsB: number, mup: boolean): number {
  const base = RUN_TUNING.LR_OPT_BASE[arch] ?? RUN_TUNING.LR_OPT_DEFAULT_BASE;
  const drift = mup ? 0 : RUN_TUNING.LR_OPT_SCALE_SLOPE * Math.log10(Math.max(1e-6, activeParamsB));
  return clamp(base - drift + lrOffsetOf(s, arch), RUN_TUNING.LR_OPT_MIN, RUN_TUNING.LR_OPT_MAX);
}

/** The true learning-rate quality factor: a peak at the optimum, falling off quadratically. */
export function trueLrQuality(s: GameState, arch: Id, activeParamsB: number, lr: number, mup: boolean): number {
  const opt = lrOptimumOf(s, arch, activeParamsB, mup);
  const q = RUN_TUNING.LR_PEAK - RUN_TUNING.LR_CURVE * (clamp(lr, 0, 1) - opt) ** 2;
  return clamp(q, RUN_TUNING.LR_QUALITY_MIN, RUN_TUNING.LR_PEAK);
}

/**
 * Least-squares fit of y = a + b x + c x^2 evaluated at x0. With fewer than three distinct x it fits a line, and with
 * one point it returns that reading.
 */
export function fitCurveAt(points: readonly { x: number; y: number }[], x0: number): number {
  if (points.length === 0) return NaN;
  const n = points.length;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;
  const distinct = new Set(points.map((p) => p.x.toFixed(6))).size;
  if (n === 1 || distinct < 2) return my;
  if (distinct < 3) {
    let sxx = 0;
    let sxy = 0;
    for (const p of points) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    return sxx < 1e-12 ? my : my + (sxy / sxx) * (x0 - mx);
  }
  // Normal equations for (a, b, c), solved by Cramer's rule.
  let S1 = 0;
  let S2 = 0;
  let S3 = 0;
  let S4 = 0;
  let T1 = 0;
  let T2 = 0;
  for (const p of points) {
    const x = p.x;
    S1 += x;
    S2 += x * x;
    S3 += x ** 3;
    S4 += x ** 4;
    T1 += p.y * x;
    T2 += p.y * x * x;
  }
  const M = [
    [n, S1, S2],
    [S1, S2, S3],
    [S2, S3, S4],
  ];
  const T = [sy, T1, T2];
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M);
  if (Math.abs(D) < 1e-12) return my;
  const coef = [0, 1, 2].map((col) => {
    const m = M.map((row, r) => row.map((v, c) => (c === col ? T[r] : v)));
    return det3(m) / D;
  });
  return coef[0] + coef[1] * x0 + coef[2] * x0 * x0;
}

/**
 * The lab's believed learning-rate factor. From the sweeps for this architecture: the nearest scale only (all scales
 * with mup_transfer), drift-corrected to this run's size, fitted as a curve and read at this run's LR. With no sweeps
 * the lab assumes 1.0 and does not know it is off.
 */
export function beliefLrQuality(s: GameState, arch: Id, activeParamsB: number, lr: number, mup: boolean): number {
  const pts = s.lab?.sweeps?.[arch] ?? [];
  if (pts.length === 0) return 1;
  const logN = Math.log10(Math.max(1e-6, activeParamsB));
  let use = pts;
  if (!mup) {
    let best = Infinity;
    for (const p of pts) best = Math.min(best, Math.abs(p.scale - logN));
    use = pts.filter((p) => Math.abs(p.scale - logN) <= best + 1e-6);
  }
  const slope = mup ? 0 : RUN_TUNING.LR_OPT_SCALE_SLOPE;
  const data = use.map((p) => ({ x: p.lr + slope * (p.scale - logN), y: p.reading }));
  const q = fitCurveAt(data, clamp(lr, 0, 1));
  return Number.isFinite(q) ? clamp(q, RUN_TUNING.LR_QUALITY_MIN, RUN_TUNING.LR_PEAK) : 1;
}

/** Learning-rate quality factor for a run sheet at an active size, in the given mode. */
export function lrQualityIn(s: GameState, cfg: TrainingConfig, activeParamsB: number, mode: PhysicsMode): number {
  const mup = isResearched(s, 'mup_transfer');
  return mode === 'true' ? trueLrQuality(s, cfg.arch, activeParamsB, cfg.lr, mup) : beliefLrQuality(s, cfg.arch, activeParamsB, cfg.lr, mup);
}

/** Everything a run's numbers depend on, resolved against the current state. */
export interface RunPhysics {
  activeParamsB: number;
  effParamsB: number;
  flopsMult: number;
  /** Raw FLOPs for the whole run. */
  totalFlops: number;
  dataQuality: number;
  /** Tokens the loss sees (billions), after repeats and quality classifiers. */
  effTokens: number;
  /** effTokens / effParamsB: the tokens-per-parameter ratio the undertraining penalty reads. */
  tokensPerParam: number;
  /** Quality points lost to undertraining (0 at or above OPTIMAL_RATIO). Already inside `loss`. */
  underPenalty: number;
  /** Fixed run overhead in days. Already inside `days`; a live run spends it before its FLOPs count. */
  overheadDays: number;
  /** Chinchilla loss plus the undertraining penalty. */
  loss: number;
  /** Static quality multiplier from the run sheet (arch, tokenizer, optimizer, precision, schedule, lr). */
  qualityMult: number;
  /** The learning-rate part of qualityMult (true peak in 'true' mode, the lab's belief otherwise). */
  lrQuality: number;
  /** Which view of the world these numbers are. */
  mode: PhysicsMode;
  /** Static flat capability changes (options, long context, data mix). */
  capAdd: Partial<Capabilities>;
  speedMult: number;
  clusterEfficiency: number;
  usedGpus: number;
  /** FLOP per day at the current cluster and the run sheet's speed. */
  rate: number;
  /** Days to finish at the current rate (Infinity with no compute). */
  days: number;
  instability: number;
  /** Expected incidents per day. */
  incidentRate: number;
  /** Expected incidents over the whole run. */
  incidentRisk: number;
  uncertainty: number;
  ablated: boolean;
  inferenceMult: number;
  webShare: number;
  /** Chance that the run accidentally trains on benchmark test sets (0 with decontam). */
  contaminationChance: number;
}

/**
 * Resolve a run sheet with a data list and techniques against the current state. `mode` picks the true world
 * (what the run does) or the lab's belief (what estimates and forecasts use). FLOPs and capabilities' static parts
 * are the same in both.
 */
export function resolveRun(
  s: GameState,
  paramsB: number,
  tokensB: number,
  datasetIds: readonly Id[],
  _techniques: readonly Id[],
  cfg: TrainingConfig,
  mode: PhysicsMode = 'belief',
): RunPhysics {
  const opts = configOptions(cfg);
  const flopsMult = opts.reduce((p, o) => p * (o.flopsMult ?? 1), 1);
  const activeParamsB = activeParamsFor(paramsB, cfg);
  const effParamsB = effParamsFor(paramsB, cfg);
  const totalFlops = 6 * activeParamsB * 1e9 * tokensB * 1e9 * flopsMult;

  const rows = mixRows(s, datasetIds, cfg, mode);
  const dataAdd = opts.reduce((t, o) => t + (o.dataQualityAdd ?? 0), 0);
  const tokenMult = opts.reduce((p, o) => p * (o.tokenMult ?? 1), 1);
  const dataQuality = clamp(mixedQuality(rows) * getBonuses(s).dataQuality + dataAdd, 0, 1);
  const effTokens = effectiveTokens(tokensB, uniqueTokensOf(s, datasetIds)) * tokenMult;
  // Undertraining: the penalty is quality points, so it enters as the equivalent loss and flows into every cap.
  const tokensPerParam = effTokens / Math.max(1e-12, effParamsB);
  const underPenalty = undertrainPenalty(tokensPerParam);
  const loss = chinchillaLoss(effParamsB, effTokens, dataQuality) + underPenalty * LOSS_PER_QUALITY_POINT;
  const overheadDays = runOverheadDays(paramsB);

  const lrQuality = lrQualityIn(s, cfg, activeParamsB, mode);
  // Synthetic-heavy mixes lose quality (model collapse), GAME_DESIGN 14.
  const qualityMult = opts.reduce((p, o) => p * (o.qualityMult ?? 1), 1) * lrQuality * collapsePenalty(s, datasetIds);

  const capAdd: Partial<Capabilities> = {};
  const addCap = (k: keyof Capabilities, v: number) => {
    capAdd[k] = (capAdd[k] ?? 0) + v;
  };
  for (const o of opts) for (const [k, v] of Object.entries(o.capAdd ?? {})) addCap(k as keyof Capabilities, v ?? 0);
  const contextK = optionById(cfg.context)?.contextK ?? 2;
  if (contextK > 2) addCap('longContext', RUN_TUNING.CONTEXT_CAP_PER_DOUBLING * Math.log2(contextK / 2));
  for (const [k, v] of Object.entries(mixCapAdd(rows)) as [keyof Capabilities, number][]) addCap(k, v);

  const speedMult = speedMultiplier(s, cfg);
  const ce = clusterEfficiency(s);
  const rate = trainingRatePerDay(s, cfg);
  const days = rate > 0 ? totalFlops / rate + overheadDays : Infinity;
  const instability = instabilityFor(s, cfg);
  const incidentRate = incidentRateFor(s, instability, ce.usedGpus);
  const webShare = rows.find((r) => r.kind === 'web')?.share ?? 0;
  const decontam = cfg.filters.includes('decontam');
  return {
    activeParamsB,
    effParamsB,
    flopsMult,
    totalFlops,
    dataQuality,
    effTokens,
    tokensPerParam,
    underPenalty,
    overheadDays,
    loss,
    qualityMult,
    lrQuality,
    mode,
    capAdd,
    speedMult,
    clusterEfficiency: ce.efficiency,
    usedGpus: ce.usedGpus,
    rate,
    days,
    instability,
    incidentRate,
    incidentRisk: Number.isFinite(days) ? incidentRate * days : Infinity,
    uncertainty: uncertaintyFor(s, cfg),
    ablated: s.flags[ablationFlag(cfg)] !== undefined,
    inferenceMult: optionById(cfg.arch)?.inferenceMult ?? 1,
    webShare,
    contaminationChance: decontam ? 0 : webShare * RUN_TUNING.ACCIDENTAL_CONTAMINATION_PER_WEB,
  };
}

/** Physics of a live run in the true world, using its own sheet, data and techniques. */
export function runPhysics(s: GameState, run: TrainingRun): RunPhysics {
  return resolveRun(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, runConfig(s, run), 'true');
}
