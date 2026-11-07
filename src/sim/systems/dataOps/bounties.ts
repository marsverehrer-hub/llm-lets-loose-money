// Community bounties: quote a crowd-sourced data batch from budget, window and brand.
import type { DataDomain, GameState } from '../../types';
import { isResearched } from '../research';
import { calendarYear, clamp } from '../../util';
import { DATAOPS_TUNING } from './tuning';
import { costEra } from './era';
import { DATA_DOMAIN_KEYS } from './catalogue';
import { usd } from './format';

const T = DATAOPS_TUNING;

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
