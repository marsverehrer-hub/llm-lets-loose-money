// Catalogue: crawler tiers, refinery levels, archive defs, startup pools, and their lookups.
import type { CrawlerTierId, DataDomain, DataKind, Id, RefineLevel } from '../../types';

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
export const STARTUP_DOMAINS: DataDomain[] = ['code', 'medical', 'legal', 'finance', 'robotics', 'multilingual', 'gaming', 'creative'];
export const STARTUP_NAMES = [
  'Scrapeworks', 'Corpuslane', 'Shard and Hatch', 'Gutter Labs', 'Annotate Anything', 'Dataplum', 'Bulkbook',
  'Sweepstake Data', 'Labelbarn', 'Ferment Corpus', 'Nanonote', 'Tokenhaus',
];

export function crawlerTierById(id: string): CrawlerTier | undefined {
  return CRAWLER_TIERS.find((t) => t.id === id);
}
export function archiveById(id: string): ArchiveDef | undefined {
  return ARCHIVE_DEFS.find((a) => a.id === id);
}
export function refineLevelDef(level: number): RefineLevelDef | undefined {
  return REFINE_LEVELS.find((l) => l.level === level);
}

/** Kind of set a domain's data lands as. */
export function kindForDomain(domain: DataDomain): DataKind {
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
