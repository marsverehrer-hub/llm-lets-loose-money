// Dataset, technique, curve and roll helpers shared by the training modules.
import type { Capabilities, DatasetDef, GameState, Id, ResearchNode, Rng, TrainingConfig } from '../../types';
import { CAP_IDS } from '../../types';
import { RESEARCH } from '../../data/research';
import { DATASETS } from '../../data/datasets';
import { clamp } from '../../util';
import { isResearched } from '../research';
import { availableDatasetsV2 } from '../data';
import { uniqueTokensOf } from '../trainingMath';
import { STAGE_TAKE } from '../../data/recipes';
import { TRAINING_TUNING } from './tuning';

/** Static datasets' tokens by id (legacy, catalogue only). Prefer datasetTokensOf(s, ids). */
export function datasetTokens(ids: string[]): number {
  let total = 0;
  for (const id of new Set(ids)) total += DATASETS.find((d) => d.id === id)?.tokensB ?? 0;
  return total;
}

/** Unique tokens (billions) across dataset ids, static and custom. */
export function datasetTokensOf(s: GameState, ids: string[]): number {
  return uniqueTokensOf(s, ids);
}

/**
 * Datasets the player can see in the shop, owned or not, in catalogue order (rivals' signed deals excluded).
 * Thin view over availableDatasetsV2 kept for the existing panels.
 */
export function availableDatasets(s: GameState): DatasetDef[] {
  return availableDatasetsV2(s)
    .filter((r) => r.status !== 'lost')
    .map((r) => r.def);
}

/** Researched technique nodes that can be toggled in the wizard. */
export function availableTechniques(s: GameState): ResearchNode[] {
  return RESEARCH.filter((r) => r.technique && isResearched(s, r.id));
}

/** Loss on the displayed curve at training progress f (0..1). Starts high, ends at finalLoss. */
export function lossCurve(finalLoss: number, progress: number): number {
  const start = Math.max(TRAINING_TUNING.LOSS_CURVE_START, finalLoss + 0.5);
  const k = TRAINING_TUNING.LOSS_CURVE_K;
  const f = clamp(progress, 0, 1);
  const h = (1 / (1 + k * f) - 1 / (1 + k)) / (1 - 1 / (1 + k));
  return finalLoss + (start - finalLoss) * h;
}

export function eloFor(overall: number): number {
  return TRAINING_TUNING.ELO_BASE + overall * TRAINING_TUNING.ELO_PER_POINT;
}

/** Shift every capability by the same amount (so the overall score moves by that amount). Vision stays 0 when 0. */
export function shiftCaps(c: Capabilities, delta: number): Capabilities {
  const out = { ...c };
  for (const k of CAP_IDS) if (!(k === 'vision' && c[k] === 0)) out[k] = c[k] + delta;
  return out;
}

/** v16: how well each post-training stage takes (mean 1). Only sheets with stages draw from the rng. */
export function rollStageTakes(rng: Rng, cfg: TrainingConfig): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const id of cfg.post ?? []) {
    const r = rng.next();
    out[id] = r < STAGE_TAKE.TAIL ? STAGE_TAKE.DUD : r < 2 * STAGE_TAKE.TAIL ? STAGE_TAKE.BREAKTHROUGH : clamp(rng.normal(1, STAGE_TAKE.SD), STAGE_TAKE.MIN, STAGE_TAKE.MAX);
  }
  return out;
}
