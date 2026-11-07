// Month-by-month matches (MpSettings.monthly). The clock holds on the first day of each month until both players have
// pressed Ready for that day. Both sims hold on the same day because the rule only looks at the day and at Ready
// values that only move forward, so the timing of the messages changes when play resumes, never where it stops.
import type { GameState } from './types';
import { dayToDate } from './util';

/** A new month has begun. Day 0 (1 January 2017) is the start of the match, not a month to review. */
export function isMonthStart(day: number): boolean {
  return day > 0 && dayToDate(day).getUTCDate() === 1;
}

/**
 * True while the clock must stop at `day`. Ready values are the last day each player pressed Ready on; a later Ready
 * also counts (`>=`), so a player who is a month ahead still releases the boundary the rival is on.
 */
export function monthBoundaryHolds(day: number, myReady: number, rivalReady: number): boolean {
  return isMonthStart(day) && !(myReady >= day && rivalReady >= day);
}

/** True when a match in month-by-month mode is waiting for Ready at its current day. */
export function monthHeld(s: GameState): boolean {
  const mp = s.mp;
  if (!mp?.settings.monthly || mp.result) return false;
  return monthBoundaryHolds(s.day, mp.monthReady ?? 0, mp.rivalMonthReady ?? 0);
}
