// Tuning numbers for the data ops mechanics. Imports nothing from its siblings.
export const DATAOPS_TUNING = {
  /** Era scaling. Yields double every YIELD_DOUBLING_YEARS, costs grow COST_GROWTH_PER_YEAR a year, value grows VALUE_GROWTH_PER_YEAR. */
  YIELD_DOUBLING_YEARS: 4,
  COST_GROWTH_PER_YEAR: 0.12,
  VALUE_GROWTH_PER_YEAR: 0.12,
  /** Market value of one billion tokens at quality 1, in 2017 dollars. */
  VALUE_PER_B_2017: 6_000,

  // Crawler
  CRAWL_BASE_QUALITY: 0.35,
  CRAWL_DEDUP_BONUS: 0.08,
  CRAWL_FILTER_BONUS: 0.07,
  CRAWL_LEGAL_BASE: 0.05,
  /** Aggressive crawling adds this much legal risk to the year's crawl set, every day, up to the cap. */
  AGGRESSIVE_LEGAL_PER_DAY: 0.004,
  AGGRESSIVE_LEGAL_CAP: 0.8,
  AGGRESSIVE_YIELD_MULT: 2,
  /** Daily chance, while aggressive, that the crawler gets blocked. */
  BLOCK_CHANCE_PER_DAY: 0.01,
  BLOCK_DAYS: 45,
  BLOCK_YIELD_MULT: 0.5,

  // Refinery
  REFINE_DIMINISH: 0.5,
  REFINE_CAP: 0.95,
  REFINE_MIN_GAIN: 0.005,
  REFINE_SLOTS: 2,
  /** Share of the cluster a refinery run borrows, priced at the cheapest cloud rent on sale. */
  REFINE_CLUSTER_SHARE: 0.1,
  /** Floor per refinery day (tooling and people), 2017 dollars. */
  REFINE_MIN_COST_PER_DAY: 2_000,

  // Marketplace
  LIST_MIN_X: 0.25,
  LIST_MAX_X: 4,
  /** Chance per rival per week when the price equals the value. Squared in the price ratio. */
  SALE_BASE_CHANCE: 0.35,
  SALE_MAX_CHANCE: 0.9,
  EXCLUSIVE_MULT: 3,
  EXCLUSIVE_CHANCE_MULT: 0.5,
  /** Flags.leakBoost gained per sale: rivals learn from what they buy. */
  SALE_LEAK: 0.5,
  USERDATA_SALE_HEAT: 8,
  USERDATA_SALE_REP: -1,

  // Bounties
  BOUNTY_MIN: 50_000,
  BOUNTY_MAX: 5_000_000,
  /** Community pay per billion tokens, 2017 dollars. */
  BOUNTY_COST_PER_B_2017: 25_000,
  BOUNTY_MIN_DAYS: 14,
  BOUNTY_MAX_DAYS: 45,
  /** Tokens delivered at the shortest window, as a share of the full window's yield. */
  BOUNTY_SHORT_WINDOW_MULT: 0.6,
  /** Share of submissions that are spam unless data_filtering is researched. */
  BOUNTY_SPAM_NO_FILTER: 0.2,
  BOUNTY_QUALITY_MIN: 0.3,
  BOUNTY_QUALITY_MAX: 0.8,
  BOUNTY_MAX_JOBS: 3,

  // Distillation
  DISTILL_MIN_B: 1,
  DISTILL_MAX_B: 500,
  /** Rival API output, per billion tokens, 2017 dollars. Cheap by design. */
  DISTILL_COST_PER_B_2017: 3_000,
  DISTILL_QUALITY_SCALE: 0.9,
  DISTILL_MAX_JOBS: 2,
  /** Weekly chance of a cease and desist per distillation order since the last letter, capped. */
  TOS_CHANCE_PER_ORDER: 0.08,
  TOS_CHANCE_CAP: 0.5,
  TOS_STRIKE_REP: -5,
  /** Every Nth strike is a lawsuit. */
  TOS_LAWSUIT_EVERY: 3,
  TOS_LAWSUIT_COST_2017: 2_500_000,
  DISTILL_BAN_DAYS: 90,

  // Archives
  ARCHIVE_QUALITY: 0.9,
  ARCHIVE_MAX_JOBS: 2,
  /** Owned archive sets at or above this legal risk can draw a copyright claim. */
  ARCHIVE_CLAIM_RISK: 0.4,
  ARCHIVE_SETTLE_2017: 2_000_000,
  ARCHIVE_FIGHT_LOSS_2017: 4_000_000,

  // Startups
  STARTUP_FIRST_YEAR: 2019,
  STARTUP_EVERY_MIN: 180,
  STARTUP_EVERY_MAX: 220,
  STARTUP_OFFER_DAYS: 30,
  STARTUP_CONTEST_CHANCE: 0.5,
  STARTUP_CONTEST_MIN_DAYS: 2,
  STARTUP_CONTEST_MAX_DAYS: 14,
  /** Days you have to answer a bidding war before the rival wins. */
  STARTUP_WAR_WINDOW_DAYS: 14,
  /** Price multiplier once a bidding war has started (buying during the war is the outbid). */
  STARTUP_WAR_PREMIUM: 1.5,
  STARTUP_PRICE_2017: 8_000_000,
  /** Tokens per day, billions, 2017 (scaled by yieldEra). */
  STARTUP_TOKENS_MIN_B: 0.05,
  STARTUP_TOKENS_MAX_B: 0.3,
  STARTUP_STREAM_DAYS: 730,
  STARTUP_ENGINEERS: 2,

  // Achievements (data/dataAchievements.ts)
  SPIDER_TOKENS_B: 1_000,
  REFINED_SETS_TARGET: 5,
  BROKER_REVENUE: 10_000_000,
  STRIKES_TARGET: 3,

  /** Recent deliveries kept for the panel. */
  LOG_CAP: 30,
};
