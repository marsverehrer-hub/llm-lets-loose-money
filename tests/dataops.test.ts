import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { dispatch, tick } from '../src/sim/engine';
import { DATASETS } from '../src/sim/data/datasets';
import { DATA_EVENTS } from '../src/sim/data/dataEvents';
import { DATA_ACHIEVEMENTS } from '../src/sim/data/dataAchievements';
import { datasetById } from '../src/sim/systems/data';
import {
  ARCHIVE_DEFS,
  CRAWLER_TIERS,
  DATAOPS_TUNING,
  REFINE_LEVELS,
  applyTosStrike,
  archiveClaimTarget,
  archiveSetId,
  bountyQuote,
  costEra,
  crawlSetId,
  crawlYieldPerDayB,
  dataOpsTick,
  distillQuote,
  listingValue,
  refineQuote,
  saleChance,
  startupAskPrice,
  valueEra,
  yieldEra,
} from '../src/sim/systems/dataOps';
import type { CompetitorModel, CustomDataset, GameState, Rng } from '../src/sim/types';

/** Day number of January 1st of `year` (day 0 = 2017-01-01). */
function dayOf(year: number): number {
  let d = 0;
  for (let y = 2017; y < year; y++) d += y % 4 === 0 ? 366 : 365;
  return d;
}

function fresh(day = 0): GameState {
  const s = createInitialState(4242, 'Ops Co');
  s.day = day;
  s.finance.cash = 1e12;
  s.company.reputation = 100;
  return s;
}

/** Advance the data-ops system one day at a time, the way the engine does (day first, then systems). */
function step(s: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    s.day += 1;
    dataOpsTick(s, makeRng(s));
  }
}

function activateRivals(s: GameState): void {
  for (const c of s.competitors) if (!c.human) c.active = true;
}

function setRivalModel(s: GameState, id: string, overall: number): void {
  const rival = s.competitors.find((c) => c.id === id);
  if (!rival) throw new Error(`no competitor ${id}`);
  rival.active = true;
  const model: CompetitorModel = {
    name: `${id}-1`,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 1200,
    releasedDay: 0,
  };
  rival.model = model;
}

function customSet(id: string, over: Partial<CustomDataset> = {}): CustomDataset {
  return {
    id,
    name: `Test ${id}`,
    kind: 'web',
    domain: 'general',
    acquisition: 'scrape',
    tokensB: 100,
    quality: 0.6,
    cost: 0,
    legalRisk: 0.05,
    unlockYear: 2017,
    flavor: 'test',
    source: 'crawl',
    createdDay: 0,
    ...over,
  };
}

function owned(s: GameState, ds: CustomDataset): void {
  s.data.custom = [...(s.data.custom ?? []), ds];
  if (!s.data.owned.includes(ds.id)) s.data.owned.push(ds.id);
}

function eventChoice(id: string, index: number) {
  const ev = DATA_EVENTS.find((e) => e.id === id);
  if (!ev) throw new Error(`no event ${id}`);
  return ev.choices[index];
}

// ---------------------------------------------------------------------------
// Era scaling
// ---------------------------------------------------------------------------

describe('dataops era scaling', () => {
  it('yields double every few years, costs and values grow by year', () => {
    expect(yieldEra(2017)).toBe(1);
    expect(yieldEra(2021)).toBeCloseTo(2);
    expect(yieldEra(2025)).toBeCloseTo(4);
    expect(costEra(2017)).toBe(1);
    expect(costEra(2030)).toBeCloseTo(1 + DATAOPS_TUNING.COST_GROWTH_PER_YEAR * 13);
    expect(valueEra(2030)).toBeGreaterThan(valueEra(2020));
    // Years before the start clamp to 2017 instead of shrinking the economy.
    expect(yieldEra(2010)).toBe(1);
    expect(costEra(2010)).toBe(1);
  });

  it('crawler yield in 2025 is four times the 2017 yield for the same tier', () => {
    const s = fresh(0);
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    step(s, 7);
    const y2017 = crawlYieldPerDayB(s);
    s.day = dayOf(2025);
    const y2025 = crawlYieldPerDayB(s);
    expect(y2017).toBeCloseTo(CRAWLER_TIERS[0].tokensPerDayB);
    expect(y2025 / y2017).toBeCloseTo(4);
  });

  it('crawler capex and upkeep grow with the year', () => {
    const s = fresh(0);
    const cash0 = s.finance.cash;
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    expect(cash0 - s.finance.cash).toBeCloseTo(CRAWLER_TIERS[0].capex);
    const late = fresh(dayOf(2030));
    const cash1 = late.finance.cash;
    dispatch(late, { type: 'buildCrawler', tier: 'scrappy' });
    expect(cash1 - late.finance.cash).toBeCloseTo(CRAWLER_TIERS[0].capex * costEra(2030));
  });
});

// ---------------------------------------------------------------------------
// 1. Own crawler
// ---------------------------------------------------------------------------

describe('own crawler', () => {
  it('builds a tier, charges capex, and only yields once online', () => {
    const s = fresh(0);
    const cash0 = s.finance.cash;
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    expect(s.dataOps?.crawler?.tier).toBe('scrappy');
    expect(s.dataOps?.crawler?.onlineDay).toBe(CRAWLER_TIERS[0].buildDays);
    expect(cash0 - s.finance.cash).toBeCloseTo(CRAWLER_TIERS[0].capex);

    step(s, CRAWLER_TIERS[0].buildDays - 1);
    expect(s.data.custom ?? []).toHaveLength(0);

    step(s, 10);
    const set = (s.data.custom ?? []).find((c) => c.id === crawlSetId(2017));
    expect(set).toBeDefined();
    expect(set!.tokensB).toBeCloseTo(10 * CRAWLER_TIERS[0].tokensPerDayB, 5);
    expect(set!.source).toBe('crawl');
    expect(s.data.owned).toContain(crawlSetId(2017));
    expect(s.dataOps?.crawledB).toBeCloseTo(10 * CRAWLER_TIERS[0].tokensPerDayB, 5);
  });

  it('pays upkeep every online day', () => {
    const s = fresh(0);
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    step(s, CRAWLER_TIERS[0].buildDays);
    const before = s.finance.cash;
    step(s, 1);
    expect(before - s.finance.cash).toBeCloseTo(CRAWLER_TIERS[0].upkeepPerDay);
  });

  it('refuses a tier that is not yet unlocked, and refuses a downgrade or repeat', () => {
    const s = fresh(0);
    dispatch(s, { type: 'buildCrawler', tier: 'industrial' });
    expect(s.dataOps?.crawler ?? null).toBeNull();
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    const cash = s.finance.cash;
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    expect(s.finance.cash).toBe(cash);
    expect(s.dataOps?.crawler?.tier).toBe('scrappy');
  });

  it('upgrades to a higher tier once it is unlocked', () => {
    const s = fresh(dayOf(2021));
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    dispatch(s, { type: 'buildCrawler', tier: 'industrial' });
    expect(s.dataOps?.crawler?.tier).toBe('industrial');
  });

  it('rejects an unknown tier and a policy change without a crawler', () => {
    const s = fresh(0);
    const cash = s.finance.cash;
    dispatch(s, { type: 'buildCrawler', tier: 'nonsense' as never });
    expect(s.finance.cash).toBe(cash);
    dispatch(s, { type: 'setCrawlerPolicy', policy: 'aggressive' });
    expect(s.dataOps?.crawler ?? null).toBeNull();
  });

  it('aggressive policy doubles yield and adds legal risk to the crawl set', () => {
    const s = fresh(0);
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    step(s, CRAWLER_TIERS[0].buildDays);
    const polite = crawlYieldPerDayB(s);
    const risk0 = (s.data.custom ?? []).find((c) => c.id === crawlSetId(2017))?.legalRisk ?? 0;
    dispatch(s, { type: 'setCrawlerPolicy', policy: 'aggressive' });
    expect(crawlYieldPerDayB(s)).toBeCloseTo(polite * DATAOPS_TUNING.AGGRESSIVE_YIELD_MULT);
    step(s, 5);
    const set = (s.data.custom ?? []).find((c) => c.id === crawlSetId(2017))!;
    expect(set.legalRisk).toBeGreaterThan(risk0);
  });

  it('rejects a bad crawl policy', () => {
    const s = fresh(0);
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    dispatch(s, { type: 'setCrawlerPolicy', policy: 'reckless' as never });
    expect(s.dataOps?.crawler?.policy).toBe('polite');
  });

  it('a Cloudflare-ish block halves yield and is resolved by the event choices', () => {
    const s = fresh(0);
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    step(s, CRAWLER_TIERS[0].buildDays);
    const yieldClear = crawlYieldPerDayB(s);
    s.dataOps!.blockPending = true;
    s.dataOps!.blockedUntil = s.day + DATAOPS_TUNING.BLOCK_DAYS;
    expect(crawlYieldPerDayB(s)).toBeCloseTo(yieldClear * DATAOPS_TUNING.BLOCK_YIELD_MULT);

    const ev = DATA_EVENTS.find((e) => e.id === 'data_crawl_blocked')!;
    expect(ev.weight(s)).toBeGreaterThan(0);
    ev.choices[0].effect(s, makeRng(s));
    expect(crawlYieldPerDayB(s)).toBeCloseTo(yieldClear);
    expect(s.dataOps!.blockPending).toBe(false);
    expect(ev.weight(s)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Refinery
// ---------------------------------------------------------------------------

describe('refinery', () => {
  it('raises quality, shrinks tokens, and applies the override through datasetById', () => {
    const s = fresh(0);
    s.data.owned.push('wikipediaish');
    const base = DATASETS.find((d) => d.id === 'wikipediaish')!;
    const cash = s.finance.cash;
    dispatch(s, { type: 'refineDataset', datasetId: 'wikipediaish', level: 1 });
    expect(s.dataOps?.jobs).toHaveLength(1);
    expect(cash - s.finance.cash).toBeGreaterThan(0);
    // Not yet applied: the job is still in flight.
    expect(datasetById(s, 'wikipediaish')!.quality).toBeCloseTo(base.quality);

    step(s, REFINE_LEVELS[0].days);
    expect(s.data.refined?.wikipediaish?.passes).toBe(1);
    expect(datasetById(s, 'wikipediaish')!.quality).toBeCloseTo(base.quality + REFINE_LEVELS[0].gain);
    expect(datasetById(s, 'wikipediaish')!.tokensB).toBeCloseTo(base.tokensB * (1 - REFINE_LEVELS[0].shrink));
    // The catalogue itself is untouched.
    expect(DATASETS.find((d) => d.id === 'wikipediaish')!.quality).toBe(base.quality);
  });

  it('diminishing returns: each pass gains half of the one before', () => {
    const s = fresh(0);
    s.data.owned.push('wikipediaish');
    const gains: number[] = [];
    let quality = DATASETS.find((d) => d.id === 'wikipediaish')!.quality;
    s.data.refined = {};
    for (let pass = 0; pass < 3; pass++) {
      const q = refineQuote(s, 'wikipediaish', 1);
      expect(q.ok).toBe(true);
      if (!q.ok) return;
      gains.push(q.gain);
      quality += q.gain;
      s.data.refined!.wikipediaish = { quality, tokensB: 3, passes: pass + 1 };
    }
    expect(gains[1] / gains[0]).toBeCloseTo(DATAOPS_TUNING.REFINE_DIMINISH);
    expect(gains[2] / gains[1]).toBeCloseTo(DATAOPS_TUNING.REFINE_DIMINISH);
  });

  it('never goes past the cap, and refuses once a gain is too small to buy', () => {
    const s = fresh(0);
    s.data.owned.push('wikipediaish');
    s.data.refined = { wikipediaish: { quality: 0.94, tokensB: 3, passes: 9 } };
    const q = refineQuote(s, 'wikipediaish', 3);
    expect(q.ok).toBe(false);
    s.data.refined = { wikipediaish: { quality: 0.9, tokensB: 3, passes: 6 } };
    expect(refineQuote(s, 'wikipediaish', 1).ok).toBe(false);
    const fresh2 = refineQuote(fresh(0), 'wikipediaish', 1);
    expect(fresh2.ok).toBe(false); // not owned
  });

  it('validation: unowned sets, bad levels, growing sets, double queue and busy slots are refused', () => {
    const s = fresh(0);
    const cash = s.finance.cash;
    dispatch(s, { type: 'refineDataset', datasetId: 'wikipediaish', level: 1 });
    expect(s.dataOps?.jobs ?? []).toHaveLength(0);

    s.data.owned.push('wikipediaish', 'gov_portal_dump', 'edgar_sec');
    dispatch(s, { type: 'refineDataset', datasetId: 'wikipediaish', level: 7 as never });
    expect(s.dataOps?.jobs ?? []).toHaveLength(0);

    // This year's crawl is still growing, so it cannot be refined yet.
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    step(s, CRAWLER_TIERS[0].buildDays + 2);
    expect(s.data.owned).toContain(crawlSetId(2017));
    expect(refineQuote(s, crawlSetId(2017), 1).ok).toBe(false);

    dispatch(s, { type: 'refineDataset', datasetId: 'wikipediaish', level: 1 });
    dispatch(s, { type: 'refineDataset', datasetId: 'wikipediaish', level: 1 });
    expect(s.dataOps!.jobs!).toHaveLength(1);
    dispatch(s, { type: 'refineDataset', datasetId: 'gov_portal_dump', level: 1 });
    dispatch(s, { type: 'refineDataset', datasetId: 'edgar_sec', level: 1 });
    expect(s.dataOps!.jobs!.filter((j) => j.kind === 'refine')).toHaveLength(2);
    expect(s.finance.cash).toBeLessThan(cash);
  });

  it('a deeper pass costs more and takes longer', () => {
    const s = fresh(0);
    s.data.owned.push('wikipediaish');
    const light = refineQuote(s, 'wikipediaish', 1);
    const deep = refineQuote(s, 'wikipediaish', 3);
    expect(light.ok && deep.ok).toBe(true);
    if (!light.ok || !deep.ok) return;
    expect(deep.days).toBeGreaterThan(light.days);
    expect(deep.cost).toBeGreaterThan(light.cost);
    expect(deep.tokensB).toBeLessThan(light.tokensB);
  });
});

// ---------------------------------------------------------------------------
// 3. Marketplace
// ---------------------------------------------------------------------------

describe('marketplace', () => {
  it('lists a custom set and refuses bad prices, static sets and duplicates', () => {
    const s = fresh(0);
    activateRivals(s);
    const ds = customSet('crawl_test');
    owned(s, ds);
    const value = listingValue(s, ds);
    expect(value).toBeGreaterThan(0);

    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value * 0.1, exclusive: false });
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value * 10, exclusive: false });
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: Number.NaN, exclusive: false });
    expect(s.dataOps?.listings ?? []).toHaveLength(0);

    dispatch(s, { type: 'listDataset', datasetId: 'wikipediaish', price: 1, exclusive: false });
    expect(s.dataOps?.listings ?? []).toHaveLength(0);

    s.data.owned = s.data.owned.filter((id) => id !== 'crawl_test');
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value, exclusive: false });
    expect(s.dataOps?.listings ?? []).toHaveLength(0);

    s.data.owned.push('crawl_test');
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value, exclusive: false });
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value, exclusive: false });
    expect(s.dataOps!.listings!).toHaveLength(1);
  });

  it('rival sales generate revenue, leak knowledge, and each rival buys a set once', () => {
    const s = fresh(0);
    activateRivals(s);
    const ds = customSet('crawl_test');
    owned(s, ds);
    const value = listingValue(s, ds);
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value * 0.25, exclusive: false });

    step(s, 28);
    const listing = s.dataOps!.listings![0];
    const rivals = s.competitors.filter((c) => !c.human).length;
    expect(listing.sales).toBeGreaterThan(0);
    expect(listing.sales).toBeLessThanOrEqual(rivals);
    expect(new Set(listing.buyers).size).toBe(listing.buyers.length);
    expect(s.dataOps!.soldTotal).toBeCloseTo(listing.revenue, 5);
    expect(s.finance.today.revenue.data).toBeCloseTo(listing.revenue, 5);
    expect(s.flags.leakBoost).toBeCloseTo(listing.sales * DATAOPS_TUNING.SALE_LEAK, 5);
  });

  it('an exclusive sale pays three times the price once, then the listing closes', () => {
    const s = fresh(0);
    activateRivals(s);
    const ds = customSet('crawl_test');
    owned(s, ds);
    const value = listingValue(s, ds);
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: value * 0.25, exclusive: true });
    step(s, 70);
    const listing = s.dataOps!.listings![0];
    expect(listing.closed).toBe(true);
    expect(listing.sales).toBe(1);
    expect(listing.revenue).toBeCloseTo(value * 0.25 * DATAOPS_TUNING.EXCLUSIVE_MULT);
  });

  it('sale chance falls as the price rises above value, and exclusives are harder to close', () => {
    expect(saleChance(100, 100, false)).toBeCloseTo(DATAOPS_TUNING.SALE_BASE_CHANCE);
    expect(saleChance(100, 50, false)).toBeGreaterThan(saleChance(100, 100, false));
    expect(saleChance(100, 400, false)).toBeLessThan(saleChance(100, 100, false));
    expect(saleChance(100, 100, true)).toBeLessThan(saleChance(100, 100, false));
    expect(saleChance(100, 1, false)).toBeLessThanOrEqual(DATAOPS_TUNING.SALE_MAX_CHANCE);
  });

  it('unlisting takes a set off the market', () => {
    const s = fresh(0);
    const ds = customSet('crawl_test');
    owned(s, ds);
    dispatch(s, { type: 'listDataset', datasetId: 'crawl_test', price: listingValue(s, ds), exclusive: false });
    dispatch(s, { type: 'unlistDataset', datasetId: 'crawl_test' });
    expect(s.dataOps!.listings!.filter((l) => !l.closed)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Bounties
// ---------------------------------------------------------------------------

describe('bounties', () => {
  it('spend the budget, deliver tokens after the window, and refuse bad input', () => {
    const s = fresh(0);
    const cash = s.finance.cash;
    const quote = bountyQuote(s, 'code', 1_000_000, 30);
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;

    dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 1_000_000, days: 30 });
    expect(cash - s.finance.cash).toBeCloseTo(1_000_000);
    expect(s.dataOps!.jobs!).toHaveLength(1);

    step(s, 29);
    expect((s.data.custom ?? []).some((c) => c.source === 'bounty')).toBe(false);
    step(s, 1);
    const set = (s.data.custom ?? []).find((c) => c.source === 'bounty')!;
    expect(set).toBeDefined();
    expect(set.kind).toBe('code');
    expect(set.tokensB).toBeCloseTo(quote.tokensB, 5);
    expect(set.quality).toBeGreaterThanOrEqual(DATAOPS_TUNING.BOUNTY_QUALITY_MIN);
    expect(set.quality).toBeLessThanOrEqual(DATAOPS_TUNING.BOUNTY_QUALITY_MAX);
  });

  it('a fifth of the submissions are spam until data filtering is researched', () => {
    const s = fresh(0);
    const junk = bountyQuote(s, 'general', 500_000, 20);
    expect(junk.ok && junk.spamShare).toBe(DATAOPS_TUNING.BOUNTY_SPAM_NO_FILTER);
    s.research.completed.push('data_filtering');
    const clean = bountyQuote(s, 'general', 500_000, 20);
    expect(clean.ok && clean.spamShare).toBe(0);
    if (junk.ok && clean.ok) expect(clean.tokensB).toBeCloseTo(junk.tokensB / (1 - DATAOPS_TUNING.BOUNTY_SPAM_NO_FILTER));
  });

  it('tokens scale with budget and brand, and a longer window yields more', () => {
    const s = fresh(0);
    const a = bountyQuote(s, 'general', 500_000, 30);
    const b = bountyQuote(s, 'general', 1_000_000, 30);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.tokensB / a.tokensB).toBeCloseTo(2);
    s.company.brand = 100;
    const hi = bountyQuote(s, 'general', 500_000, 30);
    s.company.brand = 0;
    const lo = bountyQuote(s, 'general', 500_000, 30);
    if (hi.ok && lo.ok) expect(hi.tokensB / lo.tokensB).toBeCloseTo(3);
    const short = bountyQuote(s, 'general', 500_000, 14);
    const long = bountyQuote(s, 'general', 500_000, 45);
    if (short.ok && long.ok) expect(short.tokensB).toBeLessThan(long.tokensB);
  });

  it('refuses out-of-range budgets, windows, unknown domains and a full board', () => {
    const s = fresh(0);
    const cash = s.finance.cash;
    dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 1000, days: 30 });
    dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 99_000_000, days: 30 });
    dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 500_000, days: 10 });
    dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 500_000, days: 60 });
    dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 500_000, days: 20.5 });
    dispatch(s, { type: 'runDataBounty', domain: 'astrology' as never, budget: 500_000, days: 20 });
    expect(s.finance.cash).toBe(cash);
    expect(s.dataOps?.jobs ?? []).toHaveLength(0);
    for (let i = 0; i < DATAOPS_TUNING.BOUNTY_MAX_JOBS + 1; i++) {
      dispatch(s, { type: 'runDataBounty', domain: 'code', budget: 100_000, days: 20 });
    }
    expect(s.dataOps!.jobs!).toHaveLength(DATAOPS_TUNING.BOUNTY_MAX_JOBS);
  });
});

// ---------------------------------------------------------------------------
// 5. Distilling a rival API, and the ToS strikes
// ---------------------------------------------------------------------------

describe('rival API distillation', () => {
  it('copies a rival model into a synthetic set after the delivery days', () => {
    const s = fresh(0);
    setRivalModel(s, 'openaye', 70);
    const cash = s.finance.cash;
    const q = distillQuote(s, 'openaye', 100);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.quality).toBeCloseTo(0.7 * DATAOPS_TUNING.DISTILL_QUALITY_SCALE);
    expect(q.cost).toBeCloseTo(100 * DATAOPS_TUNING.DISTILL_COST_PER_B_2017);

    dispatch(s, { type: 'distillRivalApi', labId: 'openaye', tokensB: 100 });
    expect(cash - s.finance.cash).toBeCloseTo(q.cost);
    expect(s.dataOps!.tosExposure).toBe(1);
    step(s, q.days);
    const set = (s.data.custom ?? []).find((c) => c.source === 'distill')!;
    expect(set.kind).toBe('synthetic');
    expect(set.tokensB).toBe(100);
    expect(set.id.startsWith('distill_')).toBe(true);
  });

  it('refuses unknown or inactive labs, labs with no model, and out-of-range batches', () => {
    const s = fresh(0);
    setRivalModel(s, 'openaye', 70);
    const inactive = s.competitors.find((c) => c.id === 'deepmined')!;
    inactive.active = false;
    inactive.model = null;
    expect(distillQuote(s, 'nobody', 10).ok).toBe(false);
    expect(distillQuote(s, 'deepmined', 10).ok).toBe(false);
    expect(distillQuote(s, 'openaye', 0.5).ok).toBe(false);
    expect(distillQuote(s, 'openaye', 600).ok).toBe(false);
    s.competitors.find((c) => c.id === 'openaye')!.model = null;
    expect(distillQuote(s, 'openaye', 10).ok).toBe(false);
  });

  it('a cease and desist letter comes with growing odds after each order', () => {
    const s = fresh(0);
    setRivalModel(s, 'openaye', 70);
    s.dataOps = { tosExposure: 10 };
    step(s, 70);
    expect(s.dataOps!.tosPending).toBe(true);
    expect(eventChoice('data_cease_and_desist', 0)).toBeDefined();
    expect(DATA_EVENTS.find((e) => e.id === 'data_cease_and_desist')!.weight(s)).toBeGreaterThan(0);
  });

  it('strikes escalate: each one costs reputation, and every third is a lawsuit', () => {
    const s = fresh(0);
    s.company.reputation = 100;
    const lawsuits0 = s.stats.lawsuits;
    const cash0 = s.finance.cash;

    applyTosStrike(s);
    expect(s.flags.tosStrikes).toBe(1);
    expect(s.company.reputation).toBe(100 + DATAOPS_TUNING.TOS_STRIKE_REP);
    expect(s.stats.lawsuits).toBe(lawsuits0);

    applyTosStrike(s);
    expect(s.flags.tosStrikes).toBe(2);
    expect(s.stats.lawsuits).toBe(lawsuits0);

    applyTosStrike(s);
    expect(s.flags.tosStrikes).toBe(3);
    expect(s.company.reputation).toBe(100 + 3 * DATAOPS_TUNING.TOS_STRIKE_REP);
    expect(s.stats.lawsuits).toBe(lawsuits0 + 1);
    expect(cash0 - s.finance.cash).toBeCloseTo(DATAOPS_TUNING.TOS_LAWSUIT_COST_2017);
  });

  it('stopping distillation for 90 days bans new orders and records the strike', () => {
    const s = fresh(0);
    setRivalModel(s, 'openaye', 70);
    s.dataOps = { tosPending: true, tosExposure: 2 };
    eventChoice('data_cease_and_desist', 0).effect(s, makeRng(s));
    expect(s.flags.tosStrikes).toBe(1);
    expect(s.dataOps!.tosPending).toBe(false);
    expect(s.dataOps!.distillBannedUntil).toBe(s.day + DATAOPS_TUNING.DISTILL_BAN_DAYS);
    const q = distillQuote(s, 'openaye', 10);
    expect(q.ok).toBe(false);
    step(s, DATAOPS_TUNING.DISTILL_BAN_DAYS);
    expect(distillQuote(s, 'openaye', 10).ok).toBe(true);
  });

  it('calling it inspiration is a coin flip: no strike, or a strike', () => {
    // A stub stream that always wins the coin flip (no strike), and one that always loses it (strike).
    const winsFlip: Rng = { next: () => 0, range: (a) => a, int: (a) => a, chance: () => true, pick: (a) => a[0], normal: () => 0 };
    const losesFlip: Rng = { ...winsFlip, chance: () => false };

    const lucky = fresh(0);
    lucky.dataOps = { tosPending: true, tosExposure: 2 };
    eventChoice('data_cease_and_desist', 1).effect(lucky, winsFlip);
    expect(lucky.flags.tosStrikes).toBeUndefined();
    expect(lucky.dataOps!.tosPending).toBe(false);
    expect(lucky.dataOps!.tosExposure).toBe(0);

    const unlucky = fresh(0);
    unlucky.dataOps = { tosPending: true, tosExposure: 2 };
    eventChoice('data_cease_and_desist', 1).effect(unlucky, losesFlip);
    expect(unlucky.flags.tosStrikes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Archives
// ---------------------------------------------------------------------------

describe('archives', () => {
  it('digitising takes its days, then lands a very good set', () => {
    const s = fresh(0);
    const def = ARCHIVE_DEFS.find((a) => a.id === 'county_courts')!;
    const cash = s.finance.cash;
    dispatch(s, { type: 'digitizeArchive', archiveId: 'county_courts' });
    expect(cash - s.finance.cash).toBeCloseTo(def.cost);
    step(s, def.days);
    const set = (s.data.custom ?? []).find((c) => c.id === archiveSetId('county_courts'))!;
    expect(set).toBeDefined();
    expect(set.tokensB).toBe(def.tokensB);
    expect(set.quality).toBe(DATAOPS_TUNING.ARCHIVE_QUALITY);
    expect(set.legalRisk).toBe(def.legalRisk);
    expect(s.data.owned).toContain(archiveSetId('county_courts'));
  });

  it('refuses locked archives, unknown ones, duplicates and a full scanning queue', () => {
    const s = fresh(dayOf(2021));
    const cash = s.finance.cash;
    dispatch(s, { type: 'digitizeArchive', archiveId: 'weather_logs' });
    dispatch(s, { type: 'digitizeArchive', archiveId: 'nope' });
    expect(s.finance.cash).toBe(cash);
    dispatch(s, { type: 'digitizeArchive', archiveId: 'county_courts' });
    dispatch(s, { type: 'digitizeArchive', archiveId: 'county_courts' });
    expect(s.dataOps!.jobs!).toHaveLength(1);
    dispatch(s, { type: 'digitizeArchive', archiveId: 'regional_papers' });
    expect(s.dataOps!.jobs!).toHaveLength(DATAOPS_TUNING.ARCHIVE_MAX_JOBS);
    dispatch(s, { type: 'digitizeArchive', archiveId: 'pulp_library' });
    expect(s.dataOps!.jobs!).toHaveLength(DATAOPS_TUNING.ARCHIVE_MAX_JOBS);
  });

  it('a risky owned archive draws a copyright claim, and removing the set settles it', () => {
    const s = fresh(0);
    const pulp = ARCHIVE_DEFS.find((a) => a.id === 'pulp_library')!;
    owned(s, customSet(archiveSetId(pulp.id), { source: 'archive', legalRisk: pulp.legalRisk, tokensB: pulp.tokensB }));
    expect(archiveClaimTarget(s)?.id).toBe('pulp_library');
    expect(DATA_EVENTS.find((e) => e.id === 'data_archive_copyright_claim')!.weight(s)).toBeGreaterThan(0);
    eventChoice('data_archive_copyright_claim', 1).effect(s, makeRng(s));
    expect(s.data.owned).not.toContain(archiveSetId(pulp.id));
    expect(archiveClaimTarget(s)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Data startups
// ---------------------------------------------------------------------------

describe('data startups', () => {
  it('a startup comes up for sale after 2019 and expires if nobody buys it', () => {
    const s = fresh(dayOf(2019));
    step(s, 1);
    const offer = s.dataOps!.startup!;
    expect(offer).toBeTruthy();
    expect(offer.price).toBeGreaterThan(0);
    expect(offer.expiresDay).toBe(offer.offeredDay + DATAOPS_TUNING.STARTUP_OFFER_DAYS);
    offer.contestDay = null;
    step(s, DATAOPS_TUNING.STARTUP_OFFER_DAYS + 1);
    expect(s.dataOps!.startup).toBeNull();
  });

  it('buying a startup streams tokens for two years and hires two engineers', () => {
    const s = fresh(dayOf(2019));
    step(s, 1);
    const offer = s.dataOps!.startup!;
    offer.contestDay = null;
    const engineers0 = s.staff.roles.engineer.count;
    const cash0 = s.finance.cash;
    dispatch(s, { type: 'buyDataStartup', startupId: 'stp_wrong' });
    expect(s.dataOps!.startup).toBeTruthy();
    dispatch(s, { type: 'buyDataStartup', startupId: offer.id });
    expect(cash0 - s.finance.cash).toBeCloseTo(offer.price);
    expect(s.dataOps!.startup).toBeNull();
    expect(s.staff.roles.engineer.count).toBe(engineers0 + DATAOPS_TUNING.STARTUP_ENGINEERS);
    const datasetId = `startup_${offer.id}`;
    expect(s.data.owned).toContain(datasetId);
    step(s, 10);
    const set = s.data.custom!.find((c) => c.id === datasetId)!;
    expect(set.tokensB).toBeCloseTo(10 * offer.tokensPerDayB, 5);
    step(s, DATAOPS_TUNING.STARTUP_STREAM_DAYS);
    const total = set.tokensB;
    step(s, 5);
    expect(set.tokensB).toBeCloseTo(total, 5);
  });

  it('a bidding war costs the premium to win, and the rival takes it after the window', () => {
    const s = fresh(dayOf(2019));
    step(s, 1);
    const offer = s.dataOps!.startup!;
    offer.contestDay = s.day + 2;
    offer.rivalId = 'openaye';
    step(s, 2);
    expect(s.dataOps!.startup!.war).toBe(true);
    expect(startupAskPrice(s.dataOps!.startup!)).toBeCloseTo(offer.price * DATAOPS_TUNING.STARTUP_WAR_PREMIUM);
    expect(DATA_EVENTS.find((e) => e.id === 'data_startup_bidding_war')!.weight(s)).toBeGreaterThan(0);

    const cash0 = s.finance.cash;
    dispatch(s, { type: 'buyDataStartup', startupId: offer.id });
    expect(cash0 - s.finance.cash).toBeCloseTo(offer.price * DATAOPS_TUNING.STARTUP_WAR_PREMIUM);

    const lost = fresh(dayOf(2019));
    step(lost, 1);
    const o2 = lost.dataOps!.startup!;
    o2.contestDay = lost.day + 1;
    o2.rivalId = 'openaye';
    step(lost, 1 + DATAOPS_TUNING.STARTUP_WAR_WINDOW_DAYS + 1);
    expect(lost.dataOps!.startup).toBeNull();
  });

  it('the bidding war event: matching buys the startup, letting go loses it', () => {
    const s = fresh(dayOf(2019));
    step(s, 1);
    s.dataOps!.startup!.war = true;
    s.dataOps!.startup!.warDeadline = s.day + 5;
    const offerId = s.dataOps!.startup!.id;
    expect(eventChoice('data_startup_bidding_war', 0).available!(s)).toBe(true);
    eventChoice('data_startup_bidding_war', 0).effect(s, makeRng(s));
    expect(s.data.owned).toContain(`startup_${offerId}`);

    const t = fresh(dayOf(2019));
    step(t, 1);
    t.dataOps!.startup!.war = true;
    t.dataOps!.startup!.warDeadline = t.day + 5;
    const brand0 = t.company.brand;
    eventChoice('data_startup_bidding_war', 1).effect(t, makeRng(t));
    expect(t.dataOps!.startup).toBeNull();
    expect(t.company.brand).toBe(Math.max(0, brand0 - 1));
  });
});

// ---------------------------------------------------------------------------
// Achievements, datasets, and integration
// ---------------------------------------------------------------------------

describe('dataops achievements and integration', () => {
  it('registers the four data operations achievements', () => {
    const ids = DATA_ACHIEVEMENTS.map((a) => a.id);
    for (const id of ['dataops_spiderman', 'dataops_refined_taste', 'dataops_broker', 'dataops_strike_three']) {
      expect(ids).toContain(id);
    }
  });

  it('the Strike three achievement needs three strikes; Broker needs $10M of sales', () => {
    const s = fresh(0);
    const strike3 = DATA_ACHIEVEMENTS.find((a) => a.id === 'dataops_strike_three')!;
    const broker = DATA_ACHIEVEMENTS.find((a) => a.id === 'dataops_broker')!;
    expect(strike3.check(s)).toBe(false);
    s.flags.tosStrikes = 3;
    expect(strike3.check(s)).toBe(true);
    expect(broker.check(s)).toBe(false);
    s.dataOps = { soldTotal: DATAOPS_TUNING.BROKER_REVENUE };
    expect(broker.check(s)).toBe(true);
  });

  it('the Refined taste achievement counts five distinct refined sets', () => {
    const s = fresh(0);
    const a = DATA_ACHIEVEMENTS.find((x) => x.id === 'dataops_refined_taste')!;
    s.data.refined = {};
    for (const id of ['a', 'b', 'c', 'd']) s.data.refined[id] = { quality: 0.9, tokensB: 1, passes: 1 };
    expect(a.check(s)).toBe(false);
    s.data.refined.e = { quality: 0.9, tokensB: 1, passes: 1 };
    expect(a.check(s)).toBe(true);
  });

  it('the Spider-man achievement counts a trillion crawled tokens', () => {
    const s = fresh(0);
    const a = DATA_ACHIEVEMENTS.find((x) => x.id === 'dataops_spiderman')!;
    s.dataOps = { crawledB: DATAOPS_TUNING.SPIDER_TOKENS_B - 1 };
    expect(a.check(s)).toBe(false);
    s.dataOps.crawledB = DATAOPS_TUNING.SPIDER_TOKENS_B;
    expect(a.check(s)).toBe(true);
  });

  it('a save without data operations still ticks cleanly, and the crawler tiers are ordered', () => {
    const s = fresh(0);
    for (let i = 0; i < 40; i++) tick(s);
    expect(s.dataOps?.crawler ?? null).toBeNull();
    expect(s.dataOps?.startup ?? null).toBeNull();
    expect(s.dataOps?.jobs ?? []).toHaveLength(0);
    expect(CRAWLER_TIERS.map((t) => t.rank)).toEqual([0, 1, 2]);
  });

  it('the engine runs the whole data-ops loop without throwing', () => {
    const s = fresh(0);
    activateRivals(s);
    setRivalModel(s, 'openaye', 70);
    dispatch(s, { type: 'buildCrawler', tier: 'scrappy' });
    dispatch(s, { type: 'setCrawlerPolicy', policy: 'aggressive' });
    dispatch(s, { type: 'runDataBounty', domain: 'general', budget: 200_000, days: 14 });
    dispatch(s, { type: 'distillRivalApi', labId: 'openaye', tokensB: 20 });
    dispatch(s, { type: 'digitizeArchive', archiveId: 'county_courts' });
    for (let i = 0; i < 200; i++) {
      tick(s);
      // Random events and moments block the sim until answered. This loop only checks the data plumbing, so dismiss them.
      if (s.events.pending && s.events.pending.result === undefined) s.events.pending = null;
      s.pendingMoment = null;
      s.pendingReveal = null;
    }
    expect(s.data.custom?.some((c) => c.source === 'crawl')).toBe(true);
    expect(s.data.custom?.some((c) => c.source === 'bounty')).toBe(true);
    expect(s.data.custom?.some((c) => c.source === 'distill')).toBe(true);
    expect(s.data.custom?.some((c) => c.source === 'archive')).toBe(true);
  });

  it('refinery overrides are visible through datasetById but leave other sets alone', () => {
    const s = fresh(0);
    s.data.refined = { wikipediaish: { quality: 0.91, tokensB: 2, passes: 1 } };
    expect(datasetById(s, 'wikipediaish')!.quality).toBe(0.91);
    expect(datasetById(s, 'scrawl_sample')!.quality).toBe(DATASETS.find((d) => d.id === 'scrawl_sample')!.quality);
  });

  it('REFINE levels and crawler tiers are ordered by strength', () => {
    expect(REFINE_LEVELS.map((l) => l.gain)).toEqual([...REFINE_LEVELS.map((l) => l.gain)].sort((a, b) => a - b));
    expect(CRAWLER_TIERS.map((t) => t.tokensPerDayB)).toEqual([...CRAWLER_TIERS.map((t) => t.tokensPerDayB)].sort((a, b) => a - b));
  });
});
