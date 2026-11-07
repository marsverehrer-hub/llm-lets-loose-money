// Lab tuning constants: every number the lab, sweeps, audits, forecasts and hidden truths read (no logic).

import type { CapId } from '../../types';
import { RUN_TUNING } from '../../data/runTuning';

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

export const FORGET_COPY: Record<CapId, string> = {
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
export const LR_ARCHS = Object.keys(RUN_TUNING.LR_OPT_BASE);
