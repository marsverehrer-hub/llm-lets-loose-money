// Forecasts: the belief-side bands for pre-training runs, fine-tunes and the live run.

import type { Capabilities, DataKind, Forecast, GameState, Id, Persona, TrainingConfig } from '../../types';
import { EMERGENCES } from '../../data/emergences';
import { optionById } from '../../data/trainingOptions';
import { RUN_TUNING } from '../../data/runTuning';
import { clamp } from '../../util';
import { isResearched } from '../research';
import { datasetById, isVerifiedData } from '../data';
import { SCALE_TUNING, ablationFlag, LOSS_PER_QUALITY_POINT, mixRows, repeatFactor, resolveRun, uniqueTokensOf, type MixRow, type RunPhysics } from '../trainingMath';
import { capsFromTraining, emptyCaps, estimateFinetune, modelCaps, overallScore, scoresFromCaps, specById } from '../capabilities';
import { LAB_TUNING } from './tuning';
import { effLog10, requirementsMet, scaleCapAdd, shareMap, sumCapAdd } from './notebook';

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
  // A touchy optimizer (high lrCurveMult) is riskier at a size nobody has swept.
  const opt = optionById(cfg.optimizer);
  const curve = opt?.lrCurveMult ?? 1;
  if (!near && curve !== 1) {
    factors.push({ v: 1 + 0.1 * (curve - 1), why: `${opt?.name ?? cfg.optimizer} is touchy about the learning rate and this size is unswept.` });
  }

  // v16: each post-training stage can break through or fizzle, and untried recipe interactions hide in the mix.
  const stages = cfg.post?.length ?? 0;
  if (stages > 0) factors.push({ v: 1 + 0.08 * stages, why: `${stages} post-training stage${stages === 1 ? '' : 's'}: each can break through or fizzle.` });

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
function scaleReasons(s: GameState, phys: RunPhysics, tokensB: number, datasetIds: readonly Id[], drop: number, rows: readonly MixRow[]): string[] {
  const out: string[] = [];
  if (phys.underPenalty >= 0.5) {
    const lead = phys.tokensPerParam < SCALE_TUNING.UNDER_STRONG_RATIO ? 'Undertrained' : 'Slightly undertrained';
    // Quality cannot fall below zero, so a very weak model may not show the cost in overall points at all.
    const cost = drop > 0.05 ? `Expect −${fmtScaleNumber(drop)}.` : 'The quality floor hides the cost at this size.';
    out.push(`${lead}: ${fmtScaleNumber(phys.tokensPerParam)} tokens per parameter. Compute-optimal is about ${SCALE_TUNING.OPTIMAL_RATIO}. ${cost}`);
  }
  const repeats = repeatFactor(tokensB, uniqueTokensOf(s, datasetIds));
  if (repeats > 1.001) out.push(`Data repeated ${fmtScaleNumber(repeats)}×. Repeats count half.`);
  for (const r of rows) {
    const epochs = r.epochs ?? 1;
    if (epochs > RUN_TUNING.OVER_REPEAT_EPOCHS) {
      const name = r.kind.charAt(0).toUpperCase() + r.kind.slice(1);
      out.push(`${name} repeated ${fmtScaleNumber(epochs)}×: past four passes the model memorises.`);
    }
  }
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
  const reasons = [...scaleReasons(s, phys, tokensB, datasetIds, drop, mixRows(s, datasetIds, config, 'belief', tokensB)), ...bandReasons];
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
