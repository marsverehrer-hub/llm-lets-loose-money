// Public face of the data ops folder: re-exports exactly the names systems/dataOps used to export.
// OWNER: DATAOPS. Ways to get data beyond the §14 shop (GAME_DESIGN.md §20.2): an own crawler, a refinery, a
// marketplace for your data, community bounties, rival API distillation, archive digitising and data startups.
// Every mechanic draws from its own random stream (s.flags['dataops.rng']) so it never shifts the rest of the sim.
// Dataset lookups go through datasetById, which applies the refinery overrides in s.data.refined.

export { DATAOPS_TUNING } from './tuning';
export { CRAWLER_TIERS, REFINE_LEVELS, ARCHIVE_DEFS, DATA_DOMAIN_KEYS, crawlerTierById, archiveById, refineLevelDef } from './catalogue';
export type { CrawlerTier, RefineLevelDef, ArchiveDef } from './catalogue';
export { yieldEra, costEra, valueEra } from './era';
export { dropOwned, crawlBlocked } from './state';
export { crawlSetId, crawlQuality, crawlYieldPerDayB, crawlerUpkeep, crawlerCapex } from './crawler';
export { refineQuote } from './refinery';
export type { RefineQuote } from './refinery';
export { listingValue, saleChance, listingFor } from './marketplace';
export { bountyQuote } from './bounties';
export type { BountyQuote } from './bounties';
export { distillQuote, applyTosStrike } from './distill';
export type { DistillQuote } from './distill';
export { archiveSetId, archiveQuote, archiveClaimTarget, markArchiveClaimed, archiveSettleCost, archiveFightLossCost } from './archives';
export type { ArchiveQuote } from './archives';
export { startupAskPrice, acquireStartup, closeStartupOffer } from './startups';
export { dataOpsTick } from './tick';
export { handlers } from './actions';
export { dataOpsSummary } from './summary';
export type { DataOpsSummary } from './summary';
