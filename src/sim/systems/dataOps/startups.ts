// Data startups: offers, bidding wars, acquisition and rival buyouts.
import type { GameState, Rng, StartupOffer } from '../../types';
import { calendarYear, newId, notify, pushNews } from '../../util';
import { labName } from '../labs';
import { DATAOPS_TUNING } from './tuning';
import { costEra, yieldEra } from './era';
import { STARTUP_DOMAINS, STARTUP_NAMES, kindForDomain } from './catalogue';
import { logOp, ops, ownDataset } from './state';
import { usd } from './format';

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// 7. Data startups
// ---------------------------------------------------------------------------

/** What the startup costs to buy right now: the premium applies once a bidding war has started. */
export function startupAskPrice(offer: StartupOffer): number {
  return offer.war ? offer.price * T.STARTUP_WAR_PREMIUM : offer.price;
}

export function makeStartupOffer(s: GameState, rng: Rng): StartupOffer {
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
