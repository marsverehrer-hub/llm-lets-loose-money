// v21 Annual Report. On each 1 January the year just ended is filed from what the sim already keeps. It only reads
// state and posts a notice, so it never blocks or pauses the game.
import type { AnnualLedger, AnnualReport, GameState } from '../types';
import { calendarYear, notify } from '../util';
import { STANDING_PLAYER_FLAG } from './competitors';
import { COMPETITORS } from '../data/competitors';
import { settlePlayerPlan } from './playerPlans';

const KEEP = 30;

function openLedger(s: GameState, year: number): AnnualLedger {
  return {
    year,
    from: s.day,
    revenueAt: s.stats.totalRevenue,
    releasedAt: s.stats.modelsReleased,
    valuationAt: s.finance.valuation,
    expenses: 0,
    crowns: 0,
    bestRank: null,
    headline: null,
    rivalMove: null,
  };
}

/** Folds yesterday, which is done by the time today's tick starts, into the open year. */
function readYesterday(s: GameState, L: AnnualLedger): void {
  const yesterday = s.day - 1;
  L.expenses += s.finance.dailyExpenses;
  for (const c of s.classes?.crowns ?? []) if (c.holder === 'player' && c.sinceDay === yesterday) L.crowns++;
  const rank = s.flags[STANDING_PLAYER_FLAG] as number | undefined;
  if (rank && (L.bestRank === null || rank < L.bestRank)) L.bestRank = rank;
  for (const n of s.news) {
    if (n.day !== yesterday) continue;
    if (n.kind === 'milestone') L.headline = n.text;
    // The news log has no rival tag, so a bad line that names a rival lab stands in for the rival move.
    else if (n.kind === 'bad' && COMPETITORS.some((d) => n.text.includes(d.name))) L.rivalMove = n.text;
  }
}

function fileReport(s: GameState, L: AnnualLedger): void {
  const report: AnnualReport = {
    year: L.year,
    from: L.from,
    to: s.day - 1,
    revenue: s.stats.totalRevenue - L.revenueAt,
    expenses: L.expenses,
    valuationStart: L.valuationAt,
    valuationEnd: s.finance.valuation,
    modelsReleased: s.stats.modelsReleased - L.releasedAt,
    crownsWon: L.crowns,
    bestRank: L.bestRank,
    headline: L.headline,
    rivalMove: L.rivalMove,
  };
  const list = (s.annualReports ??= []);
  list.push(report);
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
  notify(s, `Annual Report, ${L.year} is filed. Read it from the Inbox or Finance.`, 'milestone', { annual: L.year });
}

/** Runs first in the day, so the year's last day is still the finalised one when it closes. */
export function annualTick(s: GameState): void {
  const year = calendarYear(s.day);
  let L = s.annualLedger;
  if (L) {
    readYesterday(s, L);
    if (L.year !== year) {
      settlePlayerPlan(s, L);
      fileReport(s, L);
      L = undefined;
    }
  }
  if (!L) s.annualLedger = openLedger(s, year);
}
