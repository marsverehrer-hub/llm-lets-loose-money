// v19: every number the rival-lab simulation uses. Single source of truth; balance tuning happens here.
export const RIVAL_TUNING = {
  /** The brain acts once every this many days. */
  BRAIN_EVERY_DAYS: 7,
  /** Most labs active at once; later foundings wait for a slot (marquee labs not yet founded hold theirs). */
  MAX_ACTIVE: 16,
  /** Days in a row below zero cash before a lab goes bankrupt. */
  BANKRUPT_DAYS: 60,
  /**
   * Release quality = lerp(physics, frontier curve + lab offset, ANCHOR). 0 = pure physics, 1 = the old fixed curve.
   * Keeps the balance targets while each lab's own compute, data and research move it.
   */
  ANCHOR: 0.5,
  /** Effective-compute multiplier for rivals (calibration knob). */
  EFFICIENCY: 1,
  /** Fraction of a lab's GPUs used for training (the rest serves its users). */
  TRAINING_SHARE: 0.6,
  /** Shortest a rival run can be (setup, evals, red-teaming), in days. */
  MIN_RUN_DAYS: 21,
  /** Share of a mixture-of-experts model active per token (for the "-A22B" part of a name). */
  MOE_ACTIVE_SHARE: 0.18,
  /** Weeks of burn a lab keeps in reserve before buying hardware. */
  COMPUTE_RESERVE_WEEKS: 104,
  /** B2 money: staff and owned-GPU costs, in $ per year or per GPU. */
  POWER_PRICE_PER_KWH: 0.1,
  /** Owned GPUs: ops and wear per year as a share of the buy price. */
  OPS_SHARE_PER_YEAR: 0.16,
  /** Raises: when runway is under this many weeks and the last raise is this many days old. */
  RAISE_RUNWAY_WEEKS: 26,
  RAISE_GAP_DAYS: 180,
  /** Frontier and startup equity: max(RAISE_MIN, valuation x RAISE_EQUITY_SHARE x aiHype / 50). */
  RAISE_MIN: 5e6,
  RAISE_EQUITY_SHARE: 0.15,
  /** Big-tech parent top-up: RAISE_BIGTECH_BASE x 1.3^(year - 2020). */
  RAISE_BIGTECH_BASE: 500e6,
  RAISE_SOVEREIGN: 50e6,
  RAISE_OPEN_MIN: 1e6,
  RAISE_OPEN_MAX: 3e6,
  /** Raises at or above this are announced in the news. */
  RAISE_NEWS_MIN: 100e6,
  /** Compute: share of cash spent on GPUs each week when runway is over COMPUTE_RUNWAY_WEEKS. */
  COMPUTE_SPEND_SHARE: 0.2,
  COMPUTE_RUNWAY_WEEKS: 52,
  /** Renting when the vendor's allocation is empty costs this much more per day. */
  RENT_MARKUP: 1.25,
  /** Open labs spend this share of cash a week on rented GPUs instead of buying. */
  OPEN_RENT_SHARE: 0.02,
  /** Hiring: runway over HIRE_RUNWAY_WEEKS, up to HIRE_MAX_PER_WEEK a week, ratios of GPUs per researcher / engineer. */
  HIRE_RUNWAY_WEEKS: 52,
  HIRE_MAX_PER_WEEK: 3,
  GPUS_PER_RESEARCHER: 64,
  GPUS_PER_ENGINEER: 128,
  /** B2: training physics: Chinchilla sizing D = TOKENS_PER_PARAM x N, FLOPs = 6 N D. */
  TOKENS_PER_PARAM: 20,
  FLOPS_PER_PARAM_TOKEN: 6,
  /** Training memory: this share of the cluster's HBM holds weights, at BYTES_PER_PARAM per parameter. */
  MEMORY_FRACTION: 0.6,
  BYTES_PER_PARAM: 16,
  /** Unique data cap: tokens trained <= this many times the unique tokens the lab holds. */
  MAX_REPEATS: 4,
  /** B2: target run length in days, by personality (chaos draws in [CHAOS_DAYS_MIN, CHAOS_DAYS_MAX]). */
  RUN_DAYS: { hype: 35, research: 90, safety: 70, price: 45, open: 50 } as Record<string, number>,
  CHAOS_DAYS_MIN: 30,
  CHAOS_DAYS_MAX: 90,
  /** LSTM runs lose this share of base quality. Research adds up to RESEARCH_BONUS_MAX quality points. */
  LSTM_MULT: 0.6,
  RESEARCH_BONUS_PER_TOPIC: 0.15,
  RESEARCH_BONUS_MAX: 12,
  /** Data: buy a catalogue set when its cost is under this share of cash, once a month. */
  DATA_BUY_SHARE: 0.05,
  /** Data publishing: once a year, a fraction in [PUBLISH_MIN, PUBLISH_MAX] of its unique tokens. */
  PUBLISH_MIN_SHARE: 0.05,
  PUBLISH_MAX_SHARE: 0.3,
  /** Smallest run worth starting (billions of parameters), and a delivery big enough for the news (GPUs). */
  MIN_PARAMS_B: 0.1,
  NEWS_DELIVERY_GPUS: 1000,
  /** Lab log and model catalogue caps. */
  LOG_CAP: 40,
  MODEL_CAP: 30,
};
