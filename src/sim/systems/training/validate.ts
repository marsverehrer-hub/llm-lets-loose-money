// Spec validation for starting or ablating a run, and the save back-fill.
import { memoryWallError } from '../scaleLimits';
import type { GameState, TrainingConfig } from '../../types';
import { RESEARCH } from '../../data/research';
import { RUN_TUNING, legacyConfig, validateConfig } from '../../data/trainingOptions';
import { datasetById } from '../data';
import { activeParamsFor, resolveRun, uniqueTokensOf } from '../trainingMath';
import { forecastTraining, recomputeTrueOverall } from '../lab';
import { availableTechniques } from './helpers';
import { TRAINING_TUNING } from './tuning';

/** Why a pretraining spec is not valid, or null. Shared by starting a run and ablating one. */
export function validateSpec(
  s: GameState,
  paramsB: number,
  tokensB: number,
  datasetIds: string[],
  techniques: string[],
  cfg: TrainingConfig,
): string | null {
  const { MIN_PARAMS_B, MAX_PARAMS_B, MIN_TOKENS_B, MAX_EPOCHS } = TRAINING_TUNING;
  if (!Number.isFinite(paramsB) || paramsB < MIN_PARAMS_B || paramsB > MAX_PARAMS_B) {
    return `Parameters must be between ${MIN_PARAMS_B * 1000}M and ${(MAX_PARAMS_B / 1000).toFixed(0)}T.`;
  }
  if (!Number.isFinite(tokensB) || tokensB < MIN_TOKENS_B) return `Train on at least ${MIN_TOKENS_B}B tokens.`;
  const oom = memoryWallError(s, paramsB, cfg); // v16: the model has to fit in the cluster (v18: at this run's bytes per parameter)
  if (oom) return oom;
  const ids = [...new Set(datasetIds)];
  if (ids.length === 0) return 'Pick at least one dataset.';
  for (const id of ids) {
    if (!s.data.owned.includes(id)) return `You don't own ${datasetById(s, id)?.name ?? id} yet.`;
  }
  const unique = uniqueTokensOf(s, ids);
  if (tokensB > unique * MAX_EPOCHS + 1e-9) {
    return `${tokensB}B tokens is too many for ${unique.toFixed(1)}B unique (max ${MAX_EPOCHS} epochs). Add data or train on less.`;
  }
  const allowed = new Set(availableTechniques(s).map((t) => t.id));
  for (const id of new Set(techniques)) {
    if (!allowed.has(id)) return `Technique ${RESEARCH.find((r) => r.id === id)?.name ?? id} is not researched yet.`;
  }
  return validateConfig(s, cfg);
}

/**
 * Back-fill fields on a loaded state: old runs and models get the legacy run sheet and the v3 defaults.
 * Idempotent. Called by save.ts after loading.
 */
export function backfillTraining(s: GameState): void {
  for (const m of s.models) {
    if (!m.config) m.config = legacyConfig(s, m.datasetIds, m.contextK);
    if (m.activeParamsB === undefined) m.activeParamsB = activeParamsFor(m.paramsB, m.config);
    if (m.quirks === undefined) m.quirks = [];
    if (m.inferenceMult === undefined) m.inferenceMult = 1;
  }
  const run = s.training;
  if (!run) return;
  if (!run.config) run.config = legacyConfig(s, run.datasetIds);
  if (run.qualityMult === undefined || run.capAdd === undefined) {
    const phys = resolveRun(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, run.config, 'true');
    if (run.qualityMult === undefined) run.qualityMult = phys.qualityMult;
    if (run.capAdd === undefined) run.capAdd = phys.capAdd;
  }
  if (run.stallDays === undefined) run.stallDays = 0;
  if (run.pendingIncident === undefined) run.pendingIncident = null;
  if (run.log === undefined) run.log = [];
  if (run.incidents === undefined) run.incidents = [];
  if (run.accidentallyContaminated === undefined) run.accidentallyContaminated = false;
  if (run.uncertainty === undefined) run.uncertainty = RUN_TUNING.UNCERTAINTY_BASE;
  // v5 fog of training: an in-flight run from an older save gets a hidden record, a forecast and its belief loss.
  if (run.checkpoints === undefined) run.checkpoints = [];
  if (run.emerged === undefined) run.emerged = [];
  if (run.hidden === undefined) run.hidden = { seedLuck: 0, seedTag: null, trueOverall: 0, vibes: 0 };
  if (run.kind !== 'finetune') {
    if (run.forecast === undefined) run.forecast = forecastTraining(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, run.config);
    if (run.forecastLoss === undefined) run.forecastLoss = resolveRun(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, run.config, 'belief').loss;
    recomputeTrueOverall(s, run);
  }
}
