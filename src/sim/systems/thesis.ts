// v20: thesis goals. Each lab focus (doctrine) has three goals of its own (data/theses.ts); meeting them is how a
// path wins, and endings and scores count them. Done goals stay done if the focus changes.
import type { GameState } from '../types';
import { THESES, type ThesisGoalDef } from '../data/theses';
import { notify, pushNews, yearOf } from '../util';

const YEAR = 'thesis.year';
const YR_REV = 'thesis.yrRev';
const YR_EXP = 'thesis.yrExp';
const PROFIT_YEARS = 'thesis.profitYears';
/** Goal checks run weekly to keep the daily tick light. The yearly books run every day. */
const CHECK_EVERY_DAYS = 7;

function goalsOf(s: GameState): ThesisGoalDef[] {
  const d = s.company.doctrine;
  return d ? THESES[d] : [];
}

/** A calendar year in profit is one where revenue beat expenses; counted on 1 Jan for the year just closed. */
function yearBooks(s: GameState): void {
  const y = Math.floor(yearOf(s.day));
  if (s.flags[YEAR] === undefined) s.flags[YEAR] = y;
  if (y !== s.flags[YEAR]) {
    if ((s.flags[YR_REV] ?? 0) > (s.flags[YR_EXP] ?? 0)) s.flags[PROFIT_YEARS] = (s.flags[PROFIT_YEARS] ?? 0) + 1;
    s.flags[YR_REV] = 0;
    s.flags[YR_EXP] = 0;
    s.flags[YEAR] = y;
  }
  s.flags[YR_REV] = (s.flags[YR_REV] ?? 0) + s.finance.dailyRevenue;
  s.flags[YR_EXP] = (s.flags[YR_EXP] ?? 0) + s.finance.dailyExpenses;
}

/** Daily: marks thesis goals of the current focus that are met. */
export function thesisTick(s: GameState): void {
  yearBooks(s);
  if (s.day % CHECK_EVERY_DAYS !== 0) return;
  s.thesis ??= { done: {} };
  for (const g of goalsOf(s)) {
    if (s.thesis.done[g.id] !== undefined || !g.check(s)) continue;
    s.thesis.done[g.id] = s.day;
    notify(s, `Thesis: ${g.text}.`, 'good');
    pushNews(s, `Thesis met: ${g.text}.`, 'milestone');
  }
}

/** Goals of the current focus, with the day each was met (null = open) and a progress figure for the UI. */
export function thesisGoals(s: GameState): { def: ThesisGoalDef; done: number | null; progress: { value: number; target: number } | null }[] {
  return goalsOf(s).map((def) => ({ def, done: s.thesis?.done[def.id] ?? null, progress: def.progress?.(s) ?? null }));
}

/** Thesis goals met for the lab's current focus (0-3). */
export function thesisMet(s: GameState): number {
  return goalsOf(s).filter((g) => s.thesis?.done[g.id] !== undefined).length;
}
