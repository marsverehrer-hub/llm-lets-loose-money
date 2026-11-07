// v18: RUN_TUNING lives in its own leaf module (no imports) so modules that read it at load time (lab.ts) never hit
// an import cycle through trainingOptions -> hwFormats -> cloudMarket. trainingOptions re-exports it.
import type { CapId, DataKind } from '../types';
/** Tunables for runs, incidents, ablations and uncertainty. Numbers here are the single source of truth. */
export const RUN_TUNING = {
  /** Default expert count when the MoE arch is picked without one. */
  MOE_DEFAULT_EXPERTS: 16,
  /** Share of total parameters active per token, by expert count (GAME_DESIGN 13.1). */
  MOE_ACTIVE_FRACTION: { 8: 0.3, 16: 0.18, 64: 0.08, 256: 0.04 } as Record<number, number>,
  /** Quality exponent on active vs total params: N_eff = N_act^a * N_tot^(1-a). */
  MOE_ACTIVE_EXPONENT: 0.6,
  /**
   * Learning-rate quality (GAME_DESIGN 16.1): a peaked curve, LR_PEAK - LR_CURVE x (lr - lrOpt)^2, clamped to
   * [LR_QUALITY_MIN, LR_PEAK]. The optimum lrOpt depends on the architecture and (without mup_transfer) shrinks
   * with active parameters: lrOpt = LR_OPT_BASE[arch] - LR_OPT_SCALE_SLOPE x log10(activeParamsB) + offset.
   */
  LR_PEAK: 1.08,
  LR_CURVE: 2.0,
  LR_QUALITY_MIN: 0.8,
  LR_OPT_BASE: { lstm: 0.55, dense: 0.55, moe: 0.5, ssm_hybrid: 0.6, diffusion_lm: 0.45, recurrent_depth: 0.55 } as Record<string, number>,
  LR_OPT_DEFAULT_BASE: 0.55,
  LR_OPT_SCALE_SLOPE: 0.06,
  LR_OPT_OFFSET_SD: 0.12,
  LR_OPT_MIN: 0.1,
  LR_OPT_MAX: 0.9,
  /** Sweep readings: noise on each measured quality factor (halved with scaling_laws). */
  LR_SWEEP_NOISE_SD: 0.015,
  /** Sweeps this close (log10 active params) to the planned run inform its forecast. */
  LR_SWEEP_NEAR_LOG10: 0.5,
  /** Instability added by the learning rate: LR_INSTAB x lr^2 (mup_transfer halves it). */
  LR_INSTAB: 1.2,
  MUP_LR_INSTAB_MULT: 0.5,
  /** Stability research. */
  QK_NORM_INSTAB: -0.3,
  Z_LOSS_INSTAB: -0.2,
  /** MoE stability research. */
  MOE_LOAD_BALANCING_INSTAB: -0.3,
  AUX_FREE_BALANCING_INSTAB: -0.4,
  MIN_INSTABILITY: -0.5,
  /** Incidents: per-day chance = (INCIDENT_BASE + INCIDENT_PER_INSTAB x instability + hardware) / safety / engineers. */
  INCIDENT_BASE: 0.004,
  INCIDENT_PER_INSTAB: 0.01,
  HARDWARE_COEF: 0.002,
  FAULT_TOLERANT_HARDWARE_LEFT: 0.25,
  ENGINEER_INCIDENT_COEF: 0.05,
  MIN_INCIDENT_RATE: 0.0005,
  /** Quirk rolls at the end of a pretrain: P(0), P(1), rest is P(2). */
  QUIRK_ROLL_P0: 0.45,
  QUIRK_ROLL_P1: 0.4,
  /** Long context adds this much longContext per doubling above 2K. */
  CONTEXT_CAP_PER_DOUBLING: 0.8,
  /** Data mix: cap swing at the extreme of a mix (one kind gets everything). */
  MIX_SWING: 12,
  /** Repetition: past OVER_REPEAT_EPOCHS passes, each extra pass costs OVER_REPEAT_PER_EPOCH x the kind's share. */
  OVER_REPEAT_EPOCHS: 4,
  OVER_REPEAT_PER_EPOCH: 0.03,
  OVER_REPEAT_FLOOR: 0.85,
  /** Benchmark contamination per run, by data kind (share x rate), unless decontam is on. */
  CONTAM_RATE: { web: 0.25, science: 0.12, code: 0.1, synthetic: 0.3 } as Partial<Record<DataKind, number>>,
  /** Old flat rate (web share x this). Superseded by CONTAM_RATE; kept for old callers. */
  ACCIDENTAL_CONTAMINATION_PER_WEB: 0.25,
  /** MoE top-k: expert fraction step per extra expert chosen (MOE_TOPK_STEP x (k - 2) / experts). */
  MOE_TOPK_STEP: 0.95,
  /** MoE top-k: instability, capability and speed effects, relative to the default k = 2. */
  MOE_TOPK: {
    1: { instab: 0.25, speed: 1.05, capAdd: { knowledge: -2 } },
    2: { instab: 0, speed: 1, capAdd: {} },
    4: { instab: -0.1, speed: 0.95, capAdd: { reasoning: 2 } },
    8: { instab: -0.15, speed: 0.9, capAdd: { reasoning: 3, chat: 1 } },
  } as Record<number, { instab: number; speed: number; capAdd: Partial<Record<CapId, number>> }>,
  /** Model shape (-1 wide and shallow .. +1 deep and narrow): effects per unit of shape. */
  SHAPE: { reasoning: 4, math: 3, knowledge: -4, multilingual: -2, qualityPenalty: 0.03, speed: 0.1, instab: 0.3, serve: 0.1 },
  /** Uncertainty of predicted overall score (SD in points), before reductions. */
  UNCERTAINTY_BASE: 6,
  UNCERTAINTY_SCALING_LAWS: 0.6,
  UNCERTAINTY_MUP: 0.7,
  /** An ablation halves uncertainty for this many days after it finishes. */
  ABLATION_UNCERTAINTY_MULT: 0.5,
  ABLATION_WINDOW_DAYS: 365,
  ABLATION_FRACTION: 0.02,
  ABLATION_DAYS: 5,
  /** Data headroom for runs: each unique token may be used this many times. */
  MAX_EPOCHS: 4,
  /** Extend training by a fraction in this range. */
  EXTEND_MIN: 0.1,
  EXTEND_MAX: 0.5,
  /** Early stop keeps this share of the would-be quality: keep = base + slope x progress. */
  KEEP: {
    cosine: { base: 0.6, slope: 0.4 },
    constant: { base: 0.85, slope: 0.15 },
    wsd: { base: 0.95, slope: 0.05 },
  } as Record<string, { base: number; slope: number }>,
  /** Checkpointing: speed and how many days a rollback loses. */
  CHECKPOINT: {
    often: { speed: 0.96, rollbackDays: 2 },
    normal: { speed: 1, rollbackDays: 5 },
    rare: { speed: 1.02, rollbackDays: 12 },
  } as Record<'often' | 'normal' | 'rare', { speed: number; rollbackDays: number }>,
  /** Persona knobs (fine-tunes of instruct-style specs). */
  PERSONA_HELPFUL_CHAT: 8,
  PERSONA_HELPFUL_SAFETY: -8,
  PERSONA_VERBOSE_CHAT: 4,
  PERSONA_VERBOSE_INFERENCE: 0.25,
  PERSONA_SYCOPHANCY_ATTRACTION: 0.1,
  PERSONA_SYCOPHANCY_REP_PER_DAY: 0.012,
};
