// Own crawler: tier build, fresh token yield, daily upkeep and crawl dataset growth.
import type { GameState, Rng } from '../../types';
import { isResearched } from '../research';
import { addExpense, calendarYear, clamp } from '../../util';
import { DATAOPS_TUNING } from './tuning';
import { costEra, yieldEra } from './era';
import { crawlerTierById, type CrawlerTier } from './catalogue';
import { crawlBlocked, ensureCustom, logOp, ops, ownDataset } from './state';

const T = DATAOPS_TUNING;

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

export function crawlDay(s: GameState, rng: Rng): void {
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
