// Global tunables. Per-item numbers live in src/sim/data/*.
export const BALANCE = {
  START_YEAR: 2017,
  START_CASH: 2_000_000,
  START_FOUNDER_EQUITY: 1,

  // Bankruptcy
  BANKRUPT_NEGATIVE_DAYS: 30,

  // Training: Chinchilla-style loss L = E + A/N^alpha + B/D^beta  (N params, D tokens)
  LOSS_E: 1.69,
  LOSS_A: 406.4,
  LOSS_B: 410.7,
  LOSS_ALPHA: 0.34,
  LOSS_BETA: 0.28,
  /** quality 0..100 = (LOSS_WORST - L) / (LOSS_WORST - LOSS_BEST) * 100 */
  LOSS_WORST: 2.856,
  LOSS_BEST: 1.537,
  /** Effective tokens D_eff = D * (0.5 + dataQuality) */
  SCORE_NOISE_SD: 3,

  // Inference: FLOPs per token = 2 * N (params). Tokens served/day = PFLOPS*1e15*86400 / (2N) * efficiency
  BASE_INFERENCE_EFFICIENCY: 0.35,

  // Market
  ATTR_QUALITY_EXP: 2.2,
  ATTR_PRICE_EXP: 1.3,
  USER_MIGRATION_PER_DAY: 0.03,

  // Finance
  LOAN_RATE_PER_YEAR: 0.09,
  HISTORY_SAMPLE_DAYS: 7,
  IPO_MIN_VALUATION: 5_000_000_000,
  /** v1.0 tuning (GAME_DESIGN §18.2): the IPO waits for a real business, not a hyped one. Was $300M. */
  IPO_MIN_ANNUAL_REVENUE: 1_500_000_000,
};

// v2 capabilities, benchmarks and specialisations (see GAME_DESIGN.md section 12, systems/capabilities.ts).
export const CAP_TUNING = {
  /** Before `transformers` is researched, base quality is multiplied by this ("LSTM era"). */
  PRE_TRANSFORMER_QUALITY_MULT: 0.6,
  /** Noise (SD, points) on each capability when a training run finishes. */
  RUN_NOISE_SD: 3,
  FINETUNE_NOISE_SD: 1.5,
  COMPETITOR_NOISE_SD: 1.5,
  // Base coefficients on base quality q (0..100). Retuned so derived scores match the pre-v2 curve.
  KNOWLEDGE_Q: 0.85,
  /** Knowledge also gains min(KNOWLEDGE_DATA_CAP, KNOWLEDGE_PER_LOG10 * log10(unique tokens B)). */
  KNOWLEDGE_PER_LOG10: 2,
  KNOWLEDGE_DATA_CAP: 8,
  REASONING_Q: 0.9,
  MATH_Q: 0.55,
  CODING_Q: 0.9,
  AGENTIC_Q: 0.25,
  CHAT_Q: 0.55,
  MULTILINGUAL_Q: 0.5,
  SAFETY_BASE: 30,
  SAFETY_Q: 0.2,
  SAFETY_STAFF_CAP: 20,
  SAFETY_STAFF_PER_SQRT: 2.5,
  LONG_CONTEXT_BASE: 20,
  LONG_CONTEXT_Q: 0.3,
  /** Technique and dataset bonuses scale with quality: BASE + Q * q/100 (same as the pre-v2 scoreBonus). */
  BONUS_SCALE_BASE: 0.35,
  BONUS_SCALE_Q: 0.65,
  /**
   * v1.0 soft ceiling (GAME_DESIGN §18.2 "v1.0 tuning"). Overall is the linear mix below, passed through
   * knee + (max - knee) * tanh((x - knee) / (max - knee)) above the knee. Identity below it. Overall approaches
   * max asymptotically, so 100 is out of reach. Rivals are built the other way round (see competitors.ts).
   */
  OVERALL_KNEE: 85,
  OVERALL_MAX: 100,
  /**
   * v1.0 tuning: a specialisation (fine-tune) adds its capAdd scaled by this. Each fine-tune used to add 3-4 overall points
   * on top of the last, so a lineage of two or three reached the top of the scale early.
   */
  SPEC_CAP_SCALE: 0.6,
  /** Overall = 0.3 reasoning + 0.25 coding + 0.3 chat + 0.15 safety, before the soft ceiling. */
  W_REASONING: 0.3,
  W_CODING: 0.25,
  W_CHAT: 0.3,
  W_SAFETY: 0.15,
  /** Training speed multiplier per sqrt(researcher strength). */
  RESEARCHER_TRAIN_BOOST: 0.03,
  // Context window (thousands of tokens)
  CONTEXT_BASE_K: 2,
  CONTEXT_LONG_K: 8,
  CONTEXT_STEP_MULT: 4,
  CONTEXT_MAX_K: 10_000,
  /** Research that multiplies the context window by CONTEXT_STEP_MULT once long_context is in. */
  CONTEXT_FOLLOWUPS: ["million_token", "infinite_context"] as string[],
  /** Vision counts as a modality above this level. */
  VISION_MODALITY_MIN: 30,
  // Benchmarks
  SATURATION_FRACTION: 0.97,
  /** Contaminated runs close this share of the gap to the ceiling on benchmarks that existed at training time. */
  CONTAMINATION_GAP_FRACTION: 0.4,
  /** SOTA on a headline benchmark at release: brand and hype per headline, capped in total. */
  SOTA_BRAND: 1.5,
  SOTA_HYPE: 2,
  SOTA_BRAND_CAP: 4.5,
  SOTA_HYPE_CAP: 6,
  // Competitor frontier caps (see competitorCaps): coding tracks the frontier, agents and vision ramp in over these years.
  COMPETITOR_CODING_MULT: 1.05,
  COMPETITOR_AGENTIC_BASE: 0.6,
  COMPETITOR_AGENTIC_GAIN: 0.35,
  COMPETITOR_VISION_MULT: 0.9,
  AGENTIC_RAMP_START: 2023,
  AGENTIC_RAMP_YEARS: 2,
  VISION_RAMP_START: 2022,
  VISION_RAMP_YEARS: 2,
};
