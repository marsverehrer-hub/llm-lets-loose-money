// Pre-launch run estimate (estimateTraining) and the TrainingEstimate shape.
import type { Capabilities, GameState, Scores, TrainingConfig, Forecast } from '../../types';
import { defaultConfig } from '../../data/trainingOptions';
import { scoresFromCaps } from '../capabilities';
import { resolveRun } from '../trainingMath';
import { forecastFromPhys, LAB_TUNING } from '../lab';

export interface TrainingEstimate {
  totalFlops: number;
  /** Days at the current rate for this run sheet (Infinity if no compute). */
  days: number;
  dataQuality: number;
  predictedLoss: number;
  predictedScores: Scores;
  predictedCaps: Capabilities;
  /** The lab's belief: the forecast mid (what the player should expect). Never the hidden truth. */
  overall: number;
  /** The run sheet the estimate is for. */
  config: TrainingConfig;
  /** FLOP-active parameters (billions). */
  activeParamsB: number;
  /** Share of the training GPUs' PFLOPS that count (1 = fully efficient cluster). */
  clusterEfficiency: number;
  /** Instability of this run sheet. Show as a hidden estimate until `ablated`. */
  instability: number;
  /** Expected incidents over the whole run. Show as a hidden estimate until `ablated`. */
  incidentRisk: number;
  /** Expected incidents per day. */
  incidentRate: number;
  /** Effective tokens per effective parameter: the ratio the undertraining penalty reads (20 is compute-optimal). */
  tokensPerParam: number;
  /** Quality points lost to undertraining (0 when the run has enough tokens per parameter). */
  underPenalty: number;
  /** SD (overall points) of the forecast band. Equals (high - low) / (2 × 1.28). */
  uncertainty: number;
  /** True once this run sheet has been ablated (instability and incident risk are revealed). */
  ablated: boolean;
  qualityMult: number;
  speedMult: number;
  inferenceMult: number;
  /** v5: the forecast band the player sees for this run sheet. */
  forecast?: Forecast;
}

/**
 * Estimate a run before starting it. The run sheet defaults to the best unlocked sheet (defaultConfig). The
 * estimate carries the expected scores, the uncertainty band, and the (hidden until ablated) instability and risk.
 */
export function estimateTraining(
  s: GameState,
  paramsB: number,
  tokensB: number,
  datasetIds: string[],
  techniques: string[],
  config?: TrainingConfig,
): TrainingEstimate {
  const cfg = config ?? defaultConfig(s);
  // The belief: believed data quality and learning-rate quality, discovered emergences, no seed luck.
  const r = resolveRun(s, paramsB, tokensB, datasetIds, techniques, cfg, 'belief');
  const forecast = forecastFromPhys(s, r, tokensB, datasetIds, techniques, cfg);
  const predictedScores = scoresFromCaps(forecast.caps);
  return {
    totalFlops: r.totalFlops,
    days: r.days,
    dataQuality: r.dataQuality,
    predictedLoss: r.loss,
    predictedScores,
    predictedCaps: forecast.caps,
    overall: forecast.mid,
    config: cfg,
    activeParamsB: r.activeParamsB,
    clusterEfficiency: r.clusterEfficiency,
    instability: r.instability,
    incidentRisk: r.incidentRisk,
    incidentRate: r.incidentRate,
    tokensPerParam: r.tokensPerParam,
    underPenalty: r.underPenalty,
    uncertainty: (forecast.high - forecast.low) / (2 * LAB_TUNING.Z80),
    ablated: r.ablated,
    qualityMult: r.qualityMult,
    speedMult: r.speedMult,
    inferenceMult: r.inferenceMult,
    forecast,
  };
}
