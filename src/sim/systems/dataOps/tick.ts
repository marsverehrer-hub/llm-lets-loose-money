// Daily tick: crawler, job landings, streams, startup offers, weekly sales and cease and desist letters.
import type { DataJob, GameState, Rng } from '../../types';
import { addRevenue, calendarYear, clamp, notify, pushNews } from '../../util';
import { datasetById, DATA_TUNING } from '../data';
import { labName } from '../labs';
import { DATAOPS_TUNING } from './tuning';
import { archiveById, kindForDomain } from './catalogue';
import { archiveSetId } from './archives';
import { crawlDay } from './crawler';
import { listingValue, saleChance } from './marketplace';
import { closeStartupOffer, makeStartupOffer } from './startups';
import { logOp, ops, ownDataset, withOpsRng } from './state';
import { pct, usd } from './format';

const T = DATAOPS_TUNING;

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
