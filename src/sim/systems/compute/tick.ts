// Daily compute tick: construction countdown, grid outages, the daily bills and GPU wear.
import { makeRng } from '../../rng';
import { SITES } from '../../data/sites'; // v19 sites
import { addExpense, notify, pushNews } from '../../util';
import { datacenterTierById } from './catalogue';
import { hallOffline, installedCount, isFinished, siteOf } from './sites';
import { computeCapacity } from './fleet';
import { dailyComputeCost } from './power';
import { wearTick } from './wear';
import type { GameState, Rng } from '../../types';

export function computeTick(s: GameState, _rng: Rng): void {
  // Construction countdown
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft <= 0) continue;
    dc.buildDaysLeft -= 1;
    if (dc.buildDaysLeft <= 0) {
      dc.buildDaysLeft = 0;
      const slots = datacenterTierById(dc.tierId)?.maxGpus ?? 0;
      notify(s, `${dc.name} is online with ${slots.toLocaleString('en-US')} GPU slots.`, 'good');
      pushNews(s, `${s.company.name} brings ${dc.name} online.`, 'good');
    }
  }

  // v19: grid outages. A hall with GPUs can go dark for 1-2 days, at its site's odds. The roll is seeded per day and
  // hall, so the sim's own rng sequence (and every saved game) is untouched.
  s.compute.datacenters.forEach((dc, i) => {
    if (!isFinished(dc) || hallOffline(s, dc) || installedCount(dc) <= 0) return;
    const odds = SITES[siteOf(dc)].outagePerDay;
    const roll = makeRng({ rngState: s.day * 1009 + i }).next();
    if (roll >= odds) return;
    const days = roll < odds / 2 ? 2 : 1;
    s.flags[`outage.${dc.id}`] = s.day + days;
    s.flags['stat.outages'] = (s.flags['stat.outages'] ?? 0) + 1;
    notify(s, `${dc.name} lost power for ${days} day${days === 1 ? '' : 's'}. Its GPUs are offline until the grid comes back.`, 'bad');
  });

  // Derived capacity for this day (the serving tick refreshes it again after the products have their demand)
  const cap = computeCapacity(s);
  s.compute.totalPflops = cap.total;
  s.compute.trainingPflops = cap.training;
  s.compute.inferencePflops = cap.inference;

  // Daily bills
  const cost = dailyComputeCost(s);
  addExpense(s, 'compute', cost.rent);
  addExpense(s, 'power', cost.power + cost.upkeep);
  addExpense(s, 'hardware', cost.hardware); // v14
  wearTick(s); // v14: GPUs fail more as they age
}
