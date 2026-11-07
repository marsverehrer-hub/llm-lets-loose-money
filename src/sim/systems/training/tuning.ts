// Training tuning constants (TRAINING_TUNING); imports no sibling module.
import { CAP_TUNING } from '../../balance';
import { RUN_TUNING } from '../../data/trainingOptions';

export const TRAINING_TUNING = {
  MIN_PARAMS_B: 0.05,
  MAX_PARAMS_B: 10_000,
  MIN_TOKENS_B: 0.1,
  /** A run may repeat each unique token up to this many times in total. */
  MAX_EPOCHS: RUN_TUNING.MAX_EPOCHS,
  /** Before `transformers` is researched, base quality is multiplied by this ("LSTM era"). */
  PRE_TRANSFORMER_QUALITY_MULT: CAP_TUNING.PRE_TRANSFORMER_QUALITY_MULT,
  /** Starting loss of the displayed loss curve (never below final loss + 0.5). */
  LOSS_CURVE_START: 4.5,
  /** Shape of the loss curve: progress h(f) = (1/(1+k f) - 1/(1+k)) / (1 - 1/(1+k)). */
  LOSS_CURVE_K: 8,
  LOSS_NOISE_SD: 0.012,
  /** Training speed multiplier per sqrt(researcher strength). */
  RESEARCHER_TRAIN_BOOST: CAP_TUNING.RESEARCHER_TRAIN_BOOST,
  /** Elo = ELO_BASE + overall * ELO_PER_POINT. */
  ELO_BASE: 800,
  ELO_PER_POINT: 8,
};
