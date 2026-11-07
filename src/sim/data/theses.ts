// OWNER: THESIS (v20 Phase 1). Each lab focus has three goals of its own. Ids are '<doctrine>.<goal>' and unique.
// check() decides; progress() only feeds the Thesis card, so it returns the figure a player would want to see.
import type { DoctrineId, GameState } from '../types';
import { annualRevenue } from '../systems/finance';
import { isResearched } from '../systems/research';
import { headcount } from '../systems/staff';
import { playerCrownCounts } from '../systems/classes';
import { contractRevenuePerDay } from '../systems/contracts';
import { segmentShares } from '../systems/market';
import { safetyCase } from '../systems/safetyCase';

export interface ThesisGoalDef {
  id: string;
  text: string;
  check: (s: GameState) => boolean;
  progress?: (s: GameState) => { value: number; target: number };
}

const TRILLION = 1e12;
const BILLION = 1e9;
const MILLION = 1e6;
/** Flag written by systems/moments.ts: the day the current Arena #1 reign began (absent when not #1). */
const ARENA_SINCE = 'moments.arena1Since';
const ARENA_YEAR_DAYS = 365;

const agiReached = (s: GameState) => isResearched(s, 'agi') || s.ending?.by === 'player' || s.pendingEnding?.by === 'player';
const playerCrowns = (s: GameState, pred: (cls: string) => boolean) =>
  (s.classes?.crowns ?? []).filter((c) => c.holder === 'player' && pred(c.weightClass)).length;
const openReleases = (s: GameState) => s.models.filter((m) => m.releasedDay !== null && m.releaseMode === 'open').length;
/** Annual revenue per staff head; 0 until the lab has five people, so a one-person garage does not qualify. */
const revenuePerHead = (s: GameState) => {
  const hc = headcount(s);
  return hc >= 5 ? annualRevenue(s) / hc : 0;
};
const enterpriseShare = (s: GameState) => segmentShares(s, 'enterprise').find((r) => r.isPlayer)?.share ?? 0;
const contractBook = (s: GameState) => contractRevenuePerDay(s) * 365;
const crownCategories = (s: GameState) => Object.keys(playerCrownCounts(s)).filter((k) => k !== 'efficiency').length;
const bestSafety = (s: GameState) => Math.max(0, ...s.models.filter((m) => m.releasedDay !== null).map((m) => safetyCase(s, m)));

export const THESES: Record<DoctrineId, ThesisGoalDef[]> = {
  frontier: [
    {
      id: 'frontier.arena_year',
      text: 'Arena #1 for a year without a break',
      check: (s) => s.flags[ARENA_SINCE] !== undefined && s.day - s.flags[ARENA_SINCE] >= ARENA_YEAR_DAYS,
      progress: (s) => ({ value: s.flags[ARENA_SINCE] !== undefined ? s.day - s.flags[ARENA_SINCE] : 0, target: ARENA_YEAR_DAYS }),
    },
    {
      id: 'frontier.trillion',
      text: 'Valued at $1T or more',
      check: (s) => s.finance.valuation >= TRILLION,
      progress: (s) => ({ value: s.finance.valuation, target: TRILLION }),
    },
    { id: 'frontier.agi', text: 'Reach AGI yourself', check: agiReached, progress: (s) => ({ value: agiReached(s) ? 1 : 0, target: 1 }) },
  ],
  efficient: [
    {
      id: 'efficient.revenue_per_head',
      text: 'Make $5M a year per head',
      check: (s) => revenuePerHead(s) >= 5 * MILLION,
      progress: (s) => ({ value: revenuePerHead(s), target: 5 * MILLION }),
    },
    {
      id: 'efficient.small_crowns',
      text: 'Garage Prodigy, or six small-class crowns at once',
      check: (s) => s.achievements['garage_prodigy'] !== undefined || playerCrowns(s, (c) => c === 'nano' || c === 'small') >= 6,
      progress: (s) => ({
        value: s.achievements['garage_prodigy'] !== undefined ? 6 : Math.min(6, playerCrowns(s, (c) => c === 'nano' || c === 'small')),
        target: 6,
      }),
    },
    {
      id: 'efficient.profit_years',
      text: 'Three calendar years in profit',
      check: (s) => (s.flags['thesis.profitYears'] ?? 0) >= 3,
      progress: (s) => ({ value: s.flags['thesis.profitYears'] ?? 0, target: 3 }),
    },
  ],
  open: [
    {
      id: 'open.derivatives',
      text: 'Fifty rival fine-tunes of your open weights',
      check: (s) => (s.ecosystem?.derivatives ?? 0) >= 50,
      progress: (s) => ({ value: s.ecosystem?.derivatives ?? 0, target: 50 }),
    },
    {
      id: 'open.releases',
      text: 'Ten open-weight releases',
      check: (s) => openReleases(s) >= 10,
      progress: (s) => ({ value: openReleases(s), target: 10 }),
    },
    {
      id: 'open.crowns',
      text: 'Five crowns in the open class',
      check: (s) => playerCrowns(s, (c) => c === 'open') >= 5,
      progress: (s) => ({ value: playerCrowns(s, (c) => c === 'open'), target: 5 }),
    },
  ],
  specialist: [
    {
      id: 'specialist.contract_book',
      text: 'A contract book of $1B a year',
      check: (s) => contractBook(s) >= BILLION,
      progress: (s) => ({ value: contractBook(s), target: BILLION }),
    },
    {
      id: 'specialist.crown_categories',
      text: 'Crowns in three benchmark categories',
      check: (s) => crownCategories(s) >= 3,
      progress: (s) => ({ value: crownCategories(s), target: 3 }),
    },
    {
      id: 'specialist.safety_case',
      text: 'A released model with an 80 safety case',
      check: (s) => bestSafety(s) >= 80,
      progress: (s) => ({ value: bestSafety(s), target: 80 }),
    },
  ],
  enterprise: [
    {
      id: 'enterprise.share',
      text: 'Forty percent of the enterprise segment',
      check: (s) => enterpriseShare(s) >= 0.4,
      progress: (s) => ({ value: enterpriseShare(s) * 100, target: 40 }),
    },
    {
      id: 'enterprise.contracts',
      text: 'Twenty active contracts',
      check: (s) => (s.contracts?.active.length ?? 0) >= 20,
      progress: (s) => ({ value: s.contracts?.active.length ?? 0, target: 20 }),
    },
    {
      id: 'enterprise.revenue',
      text: 'Five billion a year from enterprise sales',
      check: (s) => (s.finance.revenueBreakdown.enterprise ?? 0) * 365 >= 5 * BILLION,
      progress: (s) => ({ value: (s.finance.revenueBreakdown.enterprise ?? 0) * 365, target: 5 * BILLION }),
    },
  ],
};
