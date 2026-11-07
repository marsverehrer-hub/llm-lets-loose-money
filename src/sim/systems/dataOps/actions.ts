// Action handlers the UI and engine call: build, set policy, refine, list, bounty, distill, digitise, buy.
import type { ActionHandlers, CrawlPolicy, CrawlerState } from '../../types';
import { calendarYear, newId, notify, trySpend } from '../../util';
import { datasetById } from '../data';
import { DATAOPS_TUNING } from './tuning';
import { crawlerTierById } from './catalogue';
import { crawlerCapex } from './crawler';
import { refineQuote } from './refinery';
import { listingFor, listingValue } from './marketplace';
import { bountyQuote } from './bounties';
import { distillQuote } from './distill';
import { archiveQuote } from './archives';
import { acquireStartup, closeStartupOffer, startupAskPrice } from './startups';
import { logOp, ops, withOpsRng } from './state';
import { pct, usd } from './format';

const T = DATAOPS_TUNING;

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
