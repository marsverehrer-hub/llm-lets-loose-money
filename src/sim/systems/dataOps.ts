// OWNER: DATAOPS. Ways to get data beyond the §14 shop (GAME_DESIGN.md §20.2): an own crawler, a refinery, a
// marketplace for your data, community bounties, rival API distillation, archive digitising and data startups.
// Every mechanic draws from its own random stream (s.flags['dataops.rng']) so it never shifts the rest of the sim.
// Dataset lookups go through datasetById, which applies the refinery overrides in s.data.refined.
import type {
  ActionHandlers,
  CrawlerState,
  CrawlerTierId,
  CrawlPolicy,
  CustomDataset,
  DataDomain,
  DataJob,
  DataKind,
  DataListing,
  DataOpsState,
  DatasetDef,
  GameState,
  Id,
  RefineLevel,
  Rng,
  StartupOffer,
  StartupStream,
} from '../types';
import { makeRng } from '../rng';
import { GPUS } from '../data/gpus';
import { BALANCE } from '../balance';
import { datasetById, DATA_TUNING } from './data';
import { isResearched } from './research';
import { frontierQuality } from './market';
import { labName } from './labs';
import { addExpense, addRevenue, calendarYear, clamp, formatMoney, newId, notify, pushNews, trySpend } from '../util';

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

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// Catalogue: crawler tiers, refinery levels, archives, startup pools
// ---------------------------------------------------------------------------

export interface CrawlerTier {
  id: CrawlerTierId;
  name: string;
  /** One-off build cost, 2017 dollars (scaled by costEra). Upgrades pay the full price of the new tier. */
  capex: number;
  /** Daily upkeep, 2017 dollars (scaled by costEra), charged once online. */
  upkeepPerDay: number;
  /** Fresh web tokens per day, billions, in 2017 (scaled by yieldEra). */
  tokensPerDayB: number;
  unlockYear: number;
  buildDays: number;
  /** Higher is better. Buying a tier at or below the current rank is refused. */
  rank: number;
  flavor: string;
}

export const CRAWLER_TIERS: CrawlerTier[] = [
  { id: 'scrappy', name: 'Scrappy', capex: 150_000, upkeepPerDay: 1_500, tokensPerDayB: 0.4, unlockYear: 2017, buildDays: 7, rank: 0, flavor: 'One server in a rented closet, politely ignoring robots.txt.' },
  { id: 'industrial', name: 'Industrial', capex: 2_500_000, upkeepPerDay: 12_000, tokensPerDayB: 2.5, unlockYear: 2021, buildDays: 21, rank: 1, flavor: 'A rack of machines that reads every page twice, just in case.' },
  { id: 'planetary', name: 'Planetary', capex: 30_000_000, upkeepPerDay: 90_000, tokensPerDayB: 12, unlockYear: 2026, buildDays: 45, rank: 2, flavor: 'A fleet of crawlers with its own opinion about the internet.' },
];

export interface RefineLevelDef {
  level: RefineLevel;
  label: string;
  /** Quality gain before diminishing returns. */
  gain: number;
  days: number;
  /** Share of the tokens removed by dedupe. */
  shrink: number;
}

export const REFINE_LEVELS: RefineLevelDef[] = [
  { level: 1, label: 'Light', gain: 0.05, days: 14, shrink: 0.1 },
  { level: 2, label: 'Standard', gain: 0.1, days: 30, shrink: 0.2 },
  { level: 3, label: 'Deep', gain: 0.15, days: 60, shrink: 0.3 },
];

export interface ArchiveDef {
  id: Id;
  name: string;
  domain: DataDomain;
  kind: DataKind;
  unlockYear: number;
  /** One-off cost, 2017 dollars (scaled by costEra). */
  cost: number;
  tokensB: number;
  days: number;
  legalRisk: number;
  flavor: string;
}

export const ARCHIVE_DEFS: ArchiveDef[] = [
  { id: 'county_courts', name: 'County court records', domain: 'legal', kind: 'books', unlockYear: 2017, cost: 400_000, tokensB: 15, days: 120, legalRisk: 0.25, flavor: 'Every small claim since 1974, with the judges\' handwriting read by a committee.' },
  { id: 'regional_papers', name: 'Regional newspaper morgue', domain: 'news', kind: 'books', unlockYear: 2018, cost: 1_200_000, tokensB: 60, days: 180, legalRisk: 0.1, flavor: 'Local news from before anyone asked whether it was local. The bingo results are included.' },
  { id: 'hospital_journals', name: 'Scanned hospital journals', domain: 'medical', kind: 'science', unlockYear: 2020, cost: 4_000_000, tokensB: 150, days: 240, legalRisk: 0.2, flavor: 'Clinical notes from a dozen hospitals, with the names redacted by a very tired intern.' },
  { id: 'pulp_library', name: 'Lost pulp library', domain: 'creative', kind: 'books', unlockYear: 2021, cost: 8_000_000, tokensB: 400, days: 200, legalRisk: 0.45, flavor: 'Four thousand novels nobody has read since 1962. Some are still in copyright, and their estates know.' },
  { id: 'weather_logs', name: 'National weather service logs', domain: 'science', kind: 'science', unlockYear: 2023, cost: 15_000_000, tokensB: 1_500, days: 240, legalRisk: 0.05, flavor: 'Sixty years of readings, one per minute, in a format last used by a fax machine.' },
];

export const DATA_DOMAIN_KEYS: DataDomain[] = [
  'general', 'code', 'math', 'science', 'medical', 'legal', 'finance', 'multilingual', 'creative', 'dialogue',
  'vision', 'audio', 'video', 'gaming', 'robotics', 'safety', 'news',
];
const STARTUP_DOMAINS: DataDomain[] = ['code', 'medical', 'legal', 'finance', 'robotics', 'multilingual', 'gaming', 'creative'];
const STARTUP_NAMES = [
  'Scrapeworks', 'Corpuslane', 'Shard and Hatch', 'Gutter Labs', 'Annotate Anything', 'Dataplum', 'Bulkbook',
  'Sweepstake Data', 'Labelbarn', 'Ferment Corpus', 'Nanonote', 'Tokenhaus',
];

// ---------------------------------------------------------------------------
// Era scaling (pure). Years before 2017 clamp to 2017.
// ---------------------------------------------------------------------------

export function yieldEra(year: number): number {
  return 2 ** (Math.max(0, year - BALANCE.START_YEAR) / T.YIELD_DOUBLING_YEARS);
}
export function costEra(year: number): number {
  return 1 + T.COST_GROWTH_PER_YEAR * Math.max(0, year - BALANCE.START_YEAR);
}
export function valueEra(year: number): number {
  return (1 + T.VALUE_GROWTH_PER_YEAR) ** Math.max(0, year - BALANCE.START_YEAR);
}

export function crawlerTierById(id: string): CrawlerTier | undefined {
  return CRAWLER_TIERS.find((t) => t.id === id);
}
export function archiveById(id: string): ArchiveDef | undefined {
  return ARCHIVE_DEFS.find((a) => a.id === id);
}
export function refineLevelDef(level: number): RefineLevelDef | undefined {
  return REFINE_LEVELS.find((l) => l.level === level);
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

type Ops = DataOpsState & {
  jobs: DataJob[];
  listings: DataListing[];
  streams: StartupStream[];
  log: { day: number; text: string }[];
  claimedArchives: Id[];
  crawledB: number;
  soldTotal: number;
  tosExposure: number;
  nextStartupDay: number;
};

/** Writable view of the data ops state. Creates it, and fills in the array defaults, on first use. */
function ops(s: GameState): Ops {
  const o = (s.dataOps ??= {}) as Ops;
  o.jobs ??= [];
  o.listings ??= [];
  o.streams ??= [];
  o.log ??= [];
  o.claimedArchives ??= [];
  o.crawledB ??= 0;
  o.soldTotal ??= 0;
  o.tosExposure ??= 0;
  o.nextStartupDay ??= 0;
  o.crawler ??= null;
  o.startup ??= null;
  return o;
}

function logOp(s: GameState, text: string): void {
  const o = ops(s);
  o.log.push({ day: s.day, text });
  if (o.log.length > T.LOG_CAP) o.log.splice(0, o.log.length - T.LOG_CAP);
}

function ensureCustom(s: GameState): CustomDataset[] {
  s.data.custom ??= [];
  return s.data.custom;
}

function ownDataset(s: GameState, ds: CustomDataset): void {
  ensureCustom(s).push(ds);
  if (!s.data.owned.includes(ds.id)) s.data.owned.push(ds.id);
}

/** Take a set off the owned list (no refund). Used by claims and lawsuits. */
export function dropOwned(s: GameState, id: Id): void {
  s.data.owned = s.data.owned.filter((x) => x !== id);
  if (s.data.licenses) delete s.data.licenses[id];
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function usd(v: number): string {
  return formatMoney(v, 1).replace(/\.0(?=[KMBT]|$)/, '');
}
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Kind of set a domain's data lands as. */
function kindForDomain(domain: DataDomain): DataKind {
  switch (domain) {
    case 'code':
      return 'code';
    case 'math':
    case 'science':
    case 'medical':
      return 'science';
    case 'creative':
    case 'gaming':
      return 'books';
    case 'dialogue':
      return 'dialogue';
    case 'vision':
    case 'video':
    case 'audio':
      return 'multimodal';
    default:
      return 'web';
  }
}

function cheapestPfDayPrice(year: number): number {
  let best = Infinity;
  for (const g of GPUS) if (g.unlockYear <= year && g.pflops > 0) best = Math.min(best, g.rentPerDay / g.pflops);
  return Number.isFinite(best) ? best : 0;
}

/** Random stream for everything in this module. Same pattern as contracts.ts. */
const RNG_FLAG = 'dataops.rng';
function withOpsRng<R>(s: GameState, fn: (rng: Rng) => R): R {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x5f3a9c1) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

/** True while the crawler is blocked by a Cloudflare-ish wall. */
export function crawlBlocked(s: GameState): boolean {
  return (s.dataOps?.blockedUntil ?? 0) > s.day;
}

// ---------------------------------------------------------------------------
// 1. Own crawler
// ---------------------------------------------------------------------------

export function crawlSetId(year: number): string {
  return `crawl_${year}`;
}

export function crawlQuality(s: GameState): number {
  let q = T.CRAWL_BASE_QUALITY;
  if (isResearched(s, 'minhash_dedup')) q += T.CRAWL_DEDUP_BONUS;
  if (isResearched(s, 'data_filtering')) q += T.CRAWL_FILTER_BONUS;
  return clamp(q, 0, 0.95);
}

/** Fresh tokens per day (billions) the running crawler delivers today. 0 while building or with no crawler. */
export function crawlYieldPerDayB(s: GameState): number {
  const c = s.dataOps?.crawler;
  if (!c) return 0;
  const tier = crawlerTierById(c.tier);
  if (!tier || s.day < c.onlineDay) return 0;
  let y = tier.tokensPerDayB * yieldEra(calendarYear(s.day));
  if (c.policy === 'aggressive') y *= T.AGGRESSIVE_YIELD_MULT;
  if (crawlBlocked(s)) y *= T.BLOCK_YIELD_MULT;
  return y;
}

/** Upkeep per day for a tier in this year. */
export function crawlerUpkeep(s: GameState, tier: CrawlerTier): number {
  return tier.upkeepPerDay * costEra(calendarYear(s.day));
}
export function crawlerCapex(s: GameState, tier: CrawlerTier): number {
  return tier.capex * costEra(calendarYear(s.day));
}

function addCrawlTokens(s: GameState, tokensB: number): void {
  const year = calendarYear(s.day);
  const id = crawlSetId(year);
  let ds = ensureCustom(s).find((c) => c.id === id);
  if (!ds) {
    ds = {
      id,
      name: `Your Crawl ${year}`,
      kind: 'web',
      domain: 'general',
      acquisition: 'scrape',
      tokensB: 0,
      quality: crawlQuality(s),
      cost: 0,
      legalRisk: T.CRAWL_LEGAL_BASE,
      reputationRisk: 0.05,
      unlockYear: year,
      freshnessYear: year,
      flavor: 'Everything we could reach this year, deduplicated more or less. The robots.txt file was consulted and then respectfully ignored.',
      source: 'crawl',
      createdDay: s.day,
    };
    ownDataset(s, ds);
  }
  ds.tokensB += tokensB;
  ds.quality = crawlQuality(s);
  if (!s.data.owned.includes(id)) s.data.owned.push(id);
}

/** True while a set is still being fed, so refining it would freeze a moving target. */
function isGrowing(s: GameState, id: Id): boolean {
  if (id === crawlSetId(calendarYear(s.day))) return true;
  if (id === DATA_TUNING.USER_CHATS_ID && s.data.userDataOptIn) return true;
  return (s.dataOps?.streams ?? []).some((st) => st.datasetId === id && st.endDay > s.day);
}

function crawlDay(s: GameState, rng: Rng): void {
  const o = ops(s);
  const c = o.crawler;
  if (!c || s.day < c.onlineDay) return;
  const tier = crawlerTierById(c.tier);
  if (!tier) return;
  addExpense(s, 'data', crawlerUpkeep(s, tier));
  const y = crawlYieldPerDayB(s);
  if (y > 0) {
    addCrawlTokens(s, y);
    o.crawledB += y;
  }
  if (c.policy === 'aggressive') {
    const set = ensureCustom(s).find((d) => d.id === crawlSetId(calendarYear(s.day)));
    if (set) set.legalRisk = Math.min(T.AGGRESSIVE_LEGAL_CAP, set.legalRisk + T.AGGRESSIVE_LEGAL_PER_DAY);
    if (!o.blockPending && !crawlBlocked(s) && rng.chance(T.BLOCK_CHANCE_PER_DAY)) {
      o.blockPending = true;
      o.blockedUntil = s.day + T.BLOCK_DAYS;
      logOp(s, 'The crawler was blocked by a bot wall.');
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Refinery
// ---------------------------------------------------------------------------

export type RefineQuote =
  | { ok: true; level: RefineLevelDef; from: number; quality: number; gain: number; tokensB: number; days: number; cost: number; passes: number }
  | { ok: false; reason: string };

function refineCost(s: GameState, days: number): number {
  const year = calendarYear(s.day);
  const cloud = s.compute.totalPflops * T.REFINE_CLUSTER_SHARE * cheapestPfDayPrice(year) * days;
  return Math.max(cloud, days * T.REFINE_MIN_COST_PER_DAY * costEra(year));
}

/** What refining an owned set at this level would do. Diminishing returns: each pass gains half of the last. */
export function refineQuote(s: GameState, datasetId: Id, level: number): RefineQuote {
  const lvl = refineLevelDef(level);
  if (!lvl) return { ok: false, reason: 'Pick light, standard or deep.' };
  const d = datasetById(s, datasetId);
  if (!d) return { ok: false, reason: 'Unknown dataset.' };
  if (!s.data.owned.includes(datasetId)) return { ok: false, reason: `You don't own ${d.name} yet.` };
  if (isGrowing(s, datasetId)) return { ok: false, reason: `${d.name} is still growing. Refine it once its feed stops.` };
  const jobs = s.dataOps?.jobs ?? [];
  if (jobs.some((j) => j.kind === 'refine' && j.datasetId === datasetId)) return { ok: false, reason: `${d.name} is already in the refinery.` };
  if (jobs.filter((j) => j.kind === 'refine').length >= T.REFINE_SLOTS) return { ok: false, reason: 'Both refinery lines are busy.' };
  const passes = s.data.refined?.[datasetId]?.passes ?? 0;
  const quality = Math.min(T.REFINE_CAP, d.quality + lvl.gain * T.REFINE_DIMINISH ** passes);
  const gain = quality - d.quality;
  if (gain < T.REFINE_MIN_GAIN) return { ok: false, reason: `Nothing left to gain on ${d.name} at ${pct(d.quality)}.` };
  return {
    ok: true,
    level: lvl,
    from: d.quality,
    quality,
    gain,
    tokensB: d.tokensB * (1 - lvl.shrink),
    days: lvl.days,
    cost: refineCost(s, lvl.days),
    passes,
  };
}

// ---------------------------------------------------------------------------
// 3. Marketplace (your data for rivals)
// ---------------------------------------------------------------------------

/** What a set is worth to a buyer: tokens x quality x the market value per billion tokens this year. */
export function listingValue(s: GameState, d: DatasetDef): number {
  return d.tokensB * d.quality * T.VALUE_PER_B_2017 * valueEra(calendarYear(s.day));
}

/** Chance per rival per week that a listing sells. Falls off with the square of price over value. */
export function saleChance(value: number, price: number, exclusive: boolean): number {
  if (!(price > 0) || !(value > 0)) return 0;
  const base = T.SALE_BASE_CHANCE * (value / price) ** 2;
  return clamp(base * (exclusive ? T.EXCLUSIVE_CHANCE_MULT : 1), 0, T.SALE_MAX_CHANCE);
}

export function listingFor(s: GameState, datasetId: Id): DataListing | undefined {
  return (s.dataOps?.listings ?? []).find((l) => l.datasetId === datasetId && !l.closed);
}

// ---------------------------------------------------------------------------
// 4. Bounties
// ---------------------------------------------------------------------------

export type BountyQuote =
  | { ok: true; tokensB: number; grossB: number; spamShare: number; days: number; costPerB: number }
  | { ok: false; reason: string };

export function bountyQuote(s: GameState, domain: string, budget: number, days: number): BountyQuote {
  if (!DATA_DOMAIN_KEYS.includes(domain as DataDomain)) return { ok: false, reason: 'Pick a real domain.' };
  if (!Number.isFinite(budget) || budget < T.BOUNTY_MIN || budget > T.BOUNTY_MAX) {
    return { ok: false, reason: `Bounties run ${usd(T.BOUNTY_MIN)} to ${usd(T.BOUNTY_MAX)}.` };
  }
  if (!Number.isInteger(days) || days < T.BOUNTY_MIN_DAYS || days > T.BOUNTY_MAX_DAYS) {
    return { ok: false, reason: `Bounty windows run ${T.BOUNTY_MIN_DAYS} to ${T.BOUNTY_MAX_DAYS} days.` };
  }
  if ((s.dataOps?.jobs ?? []).filter((j) => j.kind === 'bounty').length >= T.BOUNTY_MAX_JOBS) {
    return { ok: false, reason: `All ${T.BOUNTY_MAX_JOBS} bounty slots are open. Wait for one to close.` };
  }
  const costPerB = T.BOUNTY_COST_PER_B_2017 * costEra(calendarYear(s.day));
  const brandMult = 0.5 + clamp(s.company.brand, 0, 100) / 100;
  const windowFrac = (days - T.BOUNTY_MIN_DAYS) / (T.BOUNTY_MAX_DAYS - T.BOUNTY_MIN_DAYS);
  const windowMult = T.BOUNTY_SHORT_WINDOW_MULT + (1 - T.BOUNTY_SHORT_WINDOW_MULT) * windowFrac;
  const grossB = (budget / costPerB) * brandMult * windowMult;
  const spamShare = isResearched(s, 'data_filtering') ? 0 : T.BOUNTY_SPAM_NO_FILTER;
  return { ok: true, tokensB: grossB * (1 - spamShare), grossB, spamShare, days, costPerB };
}

// ---------------------------------------------------------------------------
// 5. Distilling a rival's API
// ---------------------------------------------------------------------------

export type DistillQuote =
  | { ok: true; labId: Id; labName: string; modelName: string; overall: number; tokensB: number; quality: number; days: number; cost: number; collapseRisk: number }
  | { ok: false; reason: string };

/** Collapse risk of synthetic data from a model this far behind the frontier. Same curve as syntheticQuote. */
function collapseRiskFor(gap: number): number {
  return gap > 10 ? clamp(0.6 + (gap - 10) / 50, 0.6, 0.95) : clamp(0.05 + Math.max(0, gap) / 60, 0.05, 0.25);
}

export function distillQuote(s: GameState, labId: Id, tokensB: number): DistillQuote {
  const o = s.dataOps;
  if (s.day < (o?.distillBannedUntil ?? 0)) {
    return { ok: false, reason: `Distilling is banned for another ${(o?.distillBannedUntil ?? 0) - s.day} days after the last letter.` };
  }
  const rival = s.competitors.find((c) => c.id === labId && c.active && !c.human);
  if (!rival) return { ok: false, reason: 'That lab is not in the market yet.' };
  const name = labName(s, labId);
  if (!rival.model) return { ok: false, reason: `${name} has no released model worth copying.` };
  if (!Number.isFinite(tokensB) || tokensB < T.DISTILL_MIN_B || tokensB > T.DISTILL_MAX_B) {
    return { ok: false, reason: `Distilled batches run ${T.DISTILL_MIN_B}B to ${T.DISTILL_MAX_B}B tokens.` };
  }
  if ((o?.jobs ?? []).filter((j) => j.kind === 'distill').length >= T.DISTILL_MAX_JOBS) {
    return { ok: false, reason: 'Both distillation jobs are running. Wait for one to land.' };
  }
  const year = calendarYear(s.day);
  const overall = rival.model.overall;
  return {
    ok: true,
    labId,
    labName: name,
    modelName: rival.model.name,
    overall,
    tokensB,
    quality: clamp((overall / 100) * T.DISTILL_QUALITY_SCALE, 0.2, 0.9),
    days: clamp(Math.ceil(tokensB / 4), 3, 90),
    cost: tokensB * T.DISTILL_COST_PER_B_2017 * costEra(year),
    collapseRisk: collapseRiskFor(frontierQuality(year) - overall),
  };
}

/** Record one cease and desist strike. Every Nth strike is a lawsuit. Returns the new strike count. */
export function applyTosStrike(s: GameState): number {
  const o = ops(s);
  s.flags.tosStrikes = (s.flags.tosStrikes ?? 0) + 1;
  const n = s.flags.tosStrikes;
  s.company.reputation = clamp(s.company.reputation + T.TOS_STRIKE_REP, 0, 100);
  o.tosExposure = 0;
  o.tosPending = false;
  notify(s, `Strike ${n} on the terms of service. Word is getting around.`, 'bad');
  if (n % T.TOS_LAWSUIT_EVERY === 0) {
    const cost = T.TOS_LAWSUIT_COST_2017 * costEra(calendarYear(s.day));
    addExpense(s, 'legal', cost);
    s.stats.lawsuits += 1;
    pushNews(s, `A lab sues over the terms of service. Strike ${n} is now a lawsuit. Cost ${usd(cost)}.`, 'bad');
    notify(s, `Strike ${n} is a lawsuit: ${usd(cost)}.`, 'bad');
  }
  return n;
}

// ---------------------------------------------------------------------------
// 6. Archives
// ---------------------------------------------------------------------------

export function archiveSetId(id: string): string {
  return `archive_${id}`;
}

export type ArchiveQuote = { ok: true; def: ArchiveDef; cost: number; days: number } | { ok: false; reason: string };

export function archiveQuote(s: GameState, archiveId: string): ArchiveQuote {
  const def = archiveById(archiveId);
  if (!def) return { ok: false, reason: 'Pick a real archive.' };
  const year = calendarYear(s.day);
  if (year < def.unlockYear) return { ok: false, reason: `${def.name} opens for digitising in ${def.unlockYear}.` };
  if ((s.data.custom ?? []).some((c) => c.id === archiveSetId(def.id))) return { ok: false, reason: `${def.name} is already digitised.` };
  const jobs = s.dataOps?.jobs ?? [];
  if (jobs.some((j) => j.kind === 'archive' && j.archiveId === def.id)) return { ok: false, reason: `${def.name} is already being scanned.` };
  if (jobs.filter((j) => j.kind === 'archive').length >= T.ARCHIVE_MAX_JOBS) return { ok: false, reason: 'Both scanning rigs are busy.' };
  return { ok: true, def, cost: def.cost * costEra(year), days: def.days };
}

/** The first owned archive set that is risky enough to draw a copyright claim and has not had one yet. */
export function archiveClaimTarget(s: GameState): ArchiveDef | undefined {
  const claimed = s.dataOps?.claimedArchives ?? [];
  for (const id of s.data.owned) {
    const ds = s.data.custom?.find((c) => c.id === id);
    if (ds?.source !== 'archive' || ds.legalRisk < T.ARCHIVE_CLAIM_RISK) continue;
    const def = archiveById(id.replace(/^archive_/, ''));
    if (def && !claimed.includes(def.id)) return def;
  }
  return undefined;
}

export function markArchiveClaimed(s: GameState, archiveId: string): void {
  const o = ops(s);
  if (!o.claimedArchives.includes(archiveId)) o.claimedArchives.push(archiveId);
}

export function archiveSettleCost(s: GameState): number {
  return T.ARCHIVE_SETTLE_2017 * costEra(calendarYear(s.day));
}
export function archiveFightLossCost(s: GameState): number {
  return T.ARCHIVE_FIGHT_LOSS_2017 * costEra(calendarYear(s.day));
}

// ---------------------------------------------------------------------------
// 7. Data startups
// ---------------------------------------------------------------------------

/** What the startup costs to buy right now: the premium applies once a bidding war has started. */
export function startupAskPrice(offer: StartupOffer): number {
  return offer.war ? offer.price * T.STARTUP_WAR_PREMIUM : offer.price;
}

function makeStartupOffer(s: GameState, rng: Rng): StartupOffer {
  const year = calendarYear(s.day);
  const rivals = s.competitors.filter((c) => c.active && !c.human);
  const contested = rivals.length > 0 && rng.chance(T.STARTUP_CONTEST_CHANCE);
  return {
    id: newId(s, 'stp_'),
    name: rng.pick(STARTUP_NAMES),
    domain: rng.pick(STARTUP_DOMAINS),
    tokensPerDayB: rng.range(T.STARTUP_TOKENS_MIN_B, T.STARTUP_TOKENS_MAX_B) * yieldEra(year),
    quality: Math.round(rng.range(0.55, 0.8) * 100) / 100,
    price: T.STARTUP_PRICE_2017 * costEra(year) * rng.range(0.7, 1.3),
    offeredDay: s.day,
    expiresDay: s.day + T.STARTUP_OFFER_DAYS,
    contestDay: contested ? s.day + rng.int(T.STARTUP_CONTEST_MIN_DAYS, T.STARTUP_CONTEST_MAX_DAYS) : null,
    rivalId: contested ? rng.pick(rivals).id : null,
    war: false,
    warDeadline: null,
  };
}

/** Take the startup. Its tokens stream into a dataset for two years, and two engineers join. */
export function acquireStartup(s: GameState, offer: StartupOffer, paid: number): void {
  const o = ops(s);
  o.startup = null;
  const datasetId = `startup_${offer.id}`;
  const year = calendarYear(s.day);
  ownDataset(s, {
    id: datasetId,
    name: `${offer.name} corpus`,
    kind: kindForDomain(offer.domain),
    domain: offer.domain,
    acquisition: 'purchase',
    tokensB: 0,
    quality: offer.quality,
    cost: paid,
    legalRisk: 0.05,
    unlockYear: year,
    freshnessYear: year,
    flavor: `Streamed from ${offer.name}, a ${offer.domain} startup with a good pitch deck and a very long runway.`,
    source: 'startup',
    createdDay: s.day,
  });
  o.streams.push({
    id: offer.id,
    name: offer.name,
    domain: offer.domain,
    datasetId,
    tokensPerDayB: offer.tokensPerDayB,
    startDay: s.day,
    endDay: s.day + T.STARTUP_STREAM_DAYS,
  });
  s.staff.roles.engineer.count += T.STARTUP_ENGINEERS;
  notify(s, `Bought ${offer.name} for ${usd(paid)}. ${T.STARTUP_ENGINEERS} engineers joined. Tokens start streaming.`, 'good');
  pushNews(s, `You acquire ${offer.name}, a ${offer.domain} data startup. Its founders have been moved to a nicer office.`, 'info');
  logOp(s, `Acquired ${offer.name}: ${offer.tokensPerDayB.toFixed(2)}B tokens a day for two years.`);
}

/** The startup goes to someone else (a rival outbid, or the offer ran out). */
export function closeStartupOffer(s: GameState, outcome: 'rival' | 'expired'): void {
  const o = ops(s);
  const offer = o.startup;
  o.startup = null;
  if (!offer) return;
  if (outcome === 'rival' && offer.rivalId) {
    const name = labName(s, offer.rivalId);
    pushNews(s, `${name} buys ${offer.name}. Its founders post a photo of a whiteboard that says "Winning".`, 'bad');
    logOp(s, `${name} bought ${offer.name}.`);
  } else {
    pushNews(s, `${offer.name} finds another buyer. The offer letter is still on your desk.`, 'info');
    logOp(s, `${offer.name} offer expired.`);
  }
}

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

/** A job lands: it becomes a dataset, or a refined override, or a note. */
function finishJob(s: GameState, j: DataJob): void {
  if (j.kind === 'refine') {
    const passes = s.data.refined?.[j.datasetId]?.passes ?? 0;
    s.data.refined ??= {};
    s.data.refined[j.datasetId] = { quality: j.quality, tokensB: j.tokensB, passes: passes + 1 };
    const name = datasetById(s, j.datasetId)?.name ?? j.datasetId;
    notify(s, `Refined ${name}: quality ${pct(j.quality)}, ${j.tokensB.toFixed(1)}B tokens after dedupe.`, 'good');
    logOp(s, `Refined ${name} to ${pct(j.quality)}.`);
    return;
  }
  if (j.kind === 'bounty') {
    const num = j.id.replace(/^bty_/, '');
    const year = calendarYear(s.day);
    ownDataset(s, {
      id: `bounty_${num}`,
      name: `Community ${j.domain} submissions, batch ${num}`,
      kind: kindForDomain(j.domain),
      domain: j.domain,
      acquisition: 'crowdsource',
      tokensB: j.tokensB,
      quality: j.quality,
      cost: j.budget,
      legalRisk: 0.05,
      reputationRisk: 0.02,
      unlockYear: year,
      freshnessYear: year,
      flavor: 'Submitted by strangers who were promised a credit line. Some of it is excellent. Some of it is a recipe for a pie that does not exist.',
      source: 'bounty',
      createdDay: s.day,
    });
    notify(s, `Bounty landed: ${j.tokensB.toFixed(1)}B tokens at quality ${pct(j.quality)}.`, 'good');
    logOp(s, `Bounty landed: ${j.tokensB.toFixed(1)}B tokens.`);
    return;
  }
  if (j.kind === 'distill') {
    const num = j.id.replace(/^dst_/, '');
    const year = calendarYear(s.day);
    ownDataset(s, {
      id: `distill_${num}`,
      name: `Distilled from ${j.modelName}, batch ${num}`,
      kind: 'synthetic',
      domain: 'general',
      acquisition: 'generate',
      tokensB: j.tokensB,
      quality: j.quality,
      cost: j.cost,
      legalRisk: 0.1,
      reputationRisk: 0.2,
      unlockYear: year,
      freshnessYear: year,
      flavor: `Outputs from ${j.modelName}, copied by a model that asked nicely. Some of the answers are its own answers.`,
      source: 'distill',
      createdDay: s.day,
      collapseRisk: j.collapseRisk,
    });
    notify(s, `Distilled batch ready: ${j.tokensB}B tokens from ${j.modelName}.`, 'info');
    logOp(s, `Distilled ${j.tokensB}B tokens from ${j.modelName}.`);
    return;
  }
  // archive
  const def = archiveById(j.archiveId);
  if (!def) return;
  const year = calendarYear(s.day);
  ownDataset(s, {
    id: archiveSetId(def.id),
    name: def.name,
    kind: def.kind,
    domain: def.domain,
    acquisition: 'purchase',
    tokensB: def.tokensB,
    quality: T.ARCHIVE_QUALITY,
    cost: j.cost,
    legalRisk: def.legalRisk,
    unlockYear: year,
    flavor: def.flavor,
    source: 'archive',
    createdDay: s.day,
  });
  notify(s, `Digitised ${def.name}: ${def.tokensB}B tokens at quality ${pct(T.ARCHIVE_QUALITY)}.`, 'good');
  logOp(s, `Digitised ${def.name}.`);
}

function jobsDay(s: GameState): void {
  const o = ops(s);
  if (!o.jobs.some((j) => j.doneDay <= s.day)) return;
  const done = o.jobs.filter((j) => j.doneDay <= s.day);
  o.jobs = o.jobs.filter((j) => j.doneDay > s.day);
  for (const j of done) finishJob(s, j);
}

function streamsDay(s: GameState): void {
  const o = ops(s);
  for (const st of o.streams) {
    if (s.day < st.startDay || s.day >= st.endDay) continue;
    const ds = s.data.custom?.find((c) => c.id === st.datasetId);
    if (ds) ds.tokensB += st.tokensPerDayB;
  }
  o.streams = o.streams.filter((st) => st.endDay > s.day);
}

function startupDay(s: GameState, rng: Rng): void {
  const o = ops(s);
  const offer = o.startup;
  if (offer) {
    if (!offer.war && offer.contestDay !== null && s.day >= offer.contestDay) {
      offer.war = true;
      offer.warDeadline = s.day + T.STARTUP_WAR_WINDOW_DAYS;
      const name = offer.rivalId ? labName(s, offer.rivalId) : 'A rival';
      notify(s, `${name} is bidding for ${offer.name}. Answer within ${T.STARTUP_WAR_WINDOW_DAYS} days.`, 'bad');
      logOp(s, `Bidding war for ${offer.name}.`);
    }
    if (offer.war && offer.warDeadline !== null && s.day > offer.warDeadline) closeStartupOffer(s, 'rival');
    else if (s.day > offer.expiresDay) closeStartupOffer(s, 'expired');
    return;
  }
  if (calendarYear(s.day) < T.STARTUP_FIRST_YEAR || s.day < o.nextStartupDay) return;
  const fresh = makeStartupOffer(s, rng);
  o.startup = fresh;
  o.nextStartupDay = s.day + rng.int(T.STARTUP_EVERY_MIN, T.STARTUP_EVERY_MAX);
  notify(s, `${fresh.name}, a ${fresh.domain} data startup, is for sale at ${usd(fresh.price)}.`, 'info');
  logOp(s, `${fresh.name} put up for sale.`);
}

/** Weekly: rivals buy listings by chance. Each rival buys a given set at most once. */
function marketDay(s: GameState, rng: Rng): void {
  if (s.day % 7 !== 0) return;
  const o = ops(s);
  // Closed listings stay as a record of the sale. Only sets the player no longer owns come off the board.
  o.listings = o.listings.filter((l) => s.data.owned.includes(l.datasetId));
  for (const l of o.listings) {
    if (l.closed) continue;
    const d = datasetById(s, l.datasetId);
    if (!d) continue;
    const value = listingValue(s, d);
    for (const rival of s.competitors) {
      if (!rival.active || rival.human || l.buyers.includes(rival.id)) continue;
      if (!rng.chance(saleChance(value, l.price, l.exclusive))) continue;
      const amount = l.exclusive ? l.price * T.EXCLUSIVE_MULT : l.price;
      const name = labName(s, rival.id);
      addRevenue(s, 'data', amount);
      l.buyers.push(rival.id);
      l.sales += 1;
      l.revenue += amount;
      o.soldTotal += amount;
      s.flags.leakBoost = (s.flags.leakBoost ?? 0) + T.SALE_LEAK;
      const isUserData = (s.data.custom ?? []).find((c) => c.id === d.id)?.source === 'userdata';
      if (isUserData) {
        s.flags[DATA_TUNING.PRIVACY_HEAT_KEY] = clamp((s.flags[DATA_TUNING.PRIVACY_HEAT_KEY] ?? 0) + T.USERDATA_SALE_HEAT, 0, DATA_TUNING.PRIVACY_HEAT_MAX);
        s.company.reputation = clamp(s.company.reputation + T.USERDATA_SALE_REP, 0, 100);
        pushNews(s, `${name} bought your users' chats. Regulators would like a word about "your users".`, 'bad');
      } else {
        pushNews(s, l.exclusive ? `${name} signs an exclusive licence for ${d.name}: ${usd(amount)}.` : `${name} licenses ${d.name} for ${usd(amount)}.`, 'info');
      }
      logOp(s, `Sold ${d.name} to ${name} for ${usd(amount)}.`);
      notify(s, `Sold ${d.name} to ${name}: +${usd(amount)}.`, 'good');
      if (l.exclusive) {
        l.closed = true;
        break;
      }
    }
  }
}

/** Weekly: distillation orders carry a growing chance of a cease and desist letter. */
function tosDay(s: GameState, rng: Rng): void {
  if (s.day % 7 !== 0) return;
  const o = ops(s);
  if (o.tosPending || !(o.tosExposure > 0)) return;
  if (rng.chance(Math.min(T.TOS_CHANCE_CAP, T.TOS_CHANCE_PER_ORDER * o.tosExposure))) o.tosPending = true;
}

function runTick(s: GameState, rng: Rng): void {
  crawlDay(s, rng);
  jobsDay(s);
  streamsDay(s);
  startupDay(s, rng);
  marketDay(s, rng);
  tosDay(s, rng);
}

/** Runs right after dataTick. Draws only from its own stream. */
export function dataOpsTick(s: GameState, _rng: Rng): void {
  withOpsRng(s, (rng) => runTick(s, rng));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const handlers: ActionHandlers = {
  buildCrawler: (s, a) => {
    const tier = crawlerTierById(a.tier);
    if (!tier) {
      notify(s, 'Pick a real crawler tier.', 'bad');
      return;
    }
    const year = calendarYear(s.day);
    if (year < tier.unlockYear) {
      notify(s, `${tier.name} crawlers unlock in ${tier.unlockYear}.`, 'bad');
      return;
    }
    const cur = s.dataOps?.crawler ?? null;
    if (cur) {
      const curTier = crawlerTierById(cur.tier);
      if (curTier && curTier.rank >= tier.rank) {
        notify(s, `You already run ${curTier.name}. Crawler orders are upgrades only.`, 'bad');
        return;
      }
    }
    const cost = crawlerCapex(s, tier);
    if (!trySpend(s, 'data', cost, `a ${tier.name} crawler`)) return;
    const o = ops(s);
    const crawler: CrawlerState = {
      tier: tier.id,
      policy: cur?.policy ?? 'polite',
      builtDay: s.day,
      onlineDay: s.day + tier.buildDays,
    };
    o.crawler = crawler;
    const pause = cur ? ' The old crawler stops while the new one is racked.' : '';
    notify(s, `${tier.name} crawler ordered for ${usd(cost)}. Online in ${tier.buildDays} days.${pause}`, 'good');
    logOp(s, `${tier.name} crawler ordered.`);
  },

  setCrawlerPolicy: (s, a) => {
    const c = s.dataOps?.crawler;
    if (!c) {
      notify(s, 'Build a crawler first.', 'bad');
      return;
    }
    const policy: CrawlPolicy | undefined = a.policy === 'polite' || a.policy === 'aggressive' ? a.policy : undefined;
    if (!policy) {
      notify(s, 'Crawl policy is polite or aggressive.', 'bad');
      return;
    }
    if (c.policy === policy) {
      notify(s, `The crawler is already ${policy}.`, 'info');
      return;
    }
    c.policy = policy;
    notify(
      s,
      policy === 'aggressive'
        ? 'Crawler set to aggressive: double yield, rising legal risk, and bot walls.'
        : 'Crawler set to polite: normal yield, the lawyers sleep again.',
      policy === 'aggressive' ? 'info' : 'good',
    );
  },

  refineDataset: (s, a) => {
    const q = refineQuote(s, a.datasetId, a.level);
    if (!q.ok) {
      notify(s, q.reason, 'bad');
      return;
    }
    const name = datasetById(s, a.datasetId)?.name ?? a.datasetId;
    if (!trySpend(s, 'data', q.cost, `refining ${name}`)) return;
    ops(s).jobs.push({
      id: newId(s, 'ref_'),
      kind: 'refine',
      startDay: s.day,
      doneDay: s.day + q.days,
      cost: q.cost,
      datasetId: a.datasetId,
      level: q.level.level,
      quality: q.quality,
      tokensB: q.tokensB,
    });
    notify(s, `Refining ${name}: quality ${pct(q.from)} to ${pct(q.quality)}, ${q.days} days.`, 'info');
  },

  listDataset: (s, a) => {
    const d = datasetById(s, a.datasetId);
    const isOwnedCustom = !!s.data.custom?.some((c) => c.id === a.datasetId) && s.data.owned.includes(a.datasetId);
    if (!d || !isOwnedCustom) {
      notify(s, 'Only sets you own and made yourself can go on the marketplace.', 'bad');
      return;
    }
    if (listingFor(s, a.datasetId)) {
      notify(s, `${d.name} is already on the marketplace.`, 'info');
      return;
    }
    const value = listingValue(s, d);
    if (!(value > 0)) {
      notify(s, `${d.name} has nothing to sell yet.`, 'bad');
      return;
    }
    const lo = value * T.LIST_MIN_X;
    const hi = value * T.LIST_MAX_X;
    if (!Number.isFinite(a.price) || a.price < lo || a.price > hi) {
      notify(s, `Price ${d.name} between ${usd(lo)} and ${usd(hi)}.`, 'bad');
      return;
    }
    ops(s).listings.push({ datasetId: a.datasetId, price: a.price, exclusive: !!a.exclusive, listedDay: s.day, buyers: [], sales: 0, revenue: 0 });
    notify(s, `Listed ${d.name} at ${usd(a.price)}${a.exclusive ? ', exclusive' : ''}. Rivals will make offers over the coming weeks.`, 'info');
  },

  unlistDataset: (s, a) => {
    const o = ops(s);
    const before = o.listings.length;
    o.listings = o.listings.filter((l) => !(l.datasetId === a.datasetId && !l.closed));
    if (o.listings.length !== before) {
      const name = datasetById(s, a.datasetId)?.name ?? a.datasetId;
      notify(s, `Took ${name} off the marketplace.`, 'info');
    }
  },

  runDataBounty: (s, a) =>
    withOpsRng(s, (rng) => {
      const q = bountyQuote(s, a.domain, a.budget, a.days);
      if (!q.ok) {
        notify(s, q.reason, 'bad');
        return;
      }
      if (!trySpend(s, 'data', a.budget, 'the bounty pool')) return;
      const quality = Math.round(rng.range(T.BOUNTY_QUALITY_MIN, T.BOUNTY_QUALITY_MAX) * 100) / 100;
      ops(s).jobs.push({
        id: newId(s, 'bty_'),
        kind: 'bounty',
        startDay: s.day,
        doneDay: s.day + a.days,
        cost: a.budget,
        domain: a.domain,
        budget: a.budget,
        tokensB: q.tokensB,
        quality,
        spamShare: q.spamShare,
      });
      notify(s, `Bounty open for ${a.days} days: about ${q.tokensB.toFixed(1)}B usable tokens. Quality arrives with the delivery.`, 'info');
    }),

  distillRivalApi: (s, a) => {
    const q = distillQuote(s, a.labId, a.tokensB);
    if (!q.ok) {
      notify(s, q.reason, 'bad');
      return;
    }
    if (!trySpend(s, 'data', q.cost, `${q.labName}'s API`)) return;
    const o = ops(s);
    o.jobs.push({
      id: newId(s, 'dst_'),
      kind: 'distill',
      startDay: s.day,
      doneDay: s.day + q.days,
      cost: q.cost,
      labId: q.labId,
      modelName: q.modelName,
      tokensB: a.tokensB,
      quality: q.quality,
      collapseRisk: q.collapseRisk,
    });
    o.tosExposure += 1;
    notify(s, `Ordered ${a.tokensB}B tokens of ${q.labName} outputs, ${q.days} days. Their terms of service are, as ever, a suggestion.`, 'info');
  },

  digitizeArchive: (s, a) => {
    const q = archiveQuote(s, a.archiveId);
    if (!q.ok) {
      notify(s, q.reason, 'bad');
      return;
    }
    if (!trySpend(s, 'data', q.cost, q.def.name)) return;
    ops(s).jobs.push({ id: newId(s, 'arc_'), kind: 'archive', startDay: s.day, doneDay: s.day + q.days, cost: q.cost, archiveId: q.def.id });
    notify(s, `Scanning ${q.def.name}: ${q.days} days, ${q.def.tokensB}B tokens.`, 'info');
  },

  buyDataStartup: (s, a) => {
    const o = ops(s);
    const offer = o.startup;
    if (!offer || offer.id !== a.startupId) {
      notify(s, 'That startup has already been sold.', 'bad');
      return;
    }
    if (s.day > offer.expiresDay) {
      closeStartupOffer(s, 'expired');
      notify(s, 'That offer has expired.', 'bad');
      return;
    }
    const price = startupAskPrice(offer);
    if (!trySpend(s, 'data', price, offer.name)) return;
    acquireStartup(s, offer, price);
  },
};

// ---------------------------------------------------------------------------
// Summary numbers for the panel
// ---------------------------------------------------------------------------

export interface DataOpsSummary {
  crawledB: number;
  soldTotal: number;
  activeStreams: number;
  refinedSets: number;
  strikes: number;
}

export function dataOpsSummary(s: GameState): DataOpsSummary {
  const o = s.dataOps;
  return {
    crawledB: o?.crawledB ?? 0,
    soldTotal: o?.soldTotal ?? 0,
    activeStreams: (o?.streams ?? []).filter((st) => st.endDay > s.day).length,
    refinedSets: Object.keys(s.data.refined ?? {}).length,
    strikes: s.flags.tosStrikes ?? 0,
  };
}
