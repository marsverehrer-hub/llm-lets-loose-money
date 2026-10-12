import type { GameState, NoticeKind, Bonuses, Id } from './types';
import { BALANCE } from './balance';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const START = Date.UTC(BALANCE.START_YEAR, 0, 1);

export function dayToDate(day: number): Date {
  return new Date(START + day * 86_400_000);
}
/** Fractional calendar year, e.g. 2019.5 */
export function yearOf(day: number): number {
  const d = dayToDate(day);
  return d.getUTCFullYear() + d.getUTCMonth() / 12 + (d.getUTCDate() - 1) / 365;
}
// Hot path (called per model per day by the class and leak checks): remember the last few days.
const yearMemo = new Map<number, number>();
export function calendarYear(day: number): number {
  let y = yearMemo.get(day);
  if (y === undefined) {
    if (yearMemo.size > 4096) yearMemo.clear();
    y = dayToDate(day).getUTCFullYear();
    yearMemo.set(day, y);
  }
  return y;
}
export function formatDate(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function newId(s: GameState, prefix: string): Id {
  s.idCounter += 1;
  return `${prefix}${s.idCounter}`;
}

/** Spend money today. Positive amount. Category shows up in the expense breakdown. */
export function addExpense(s: GameState, category: string, amount: number): void {
  if (!isFinite(amount) || amount === 0) return;
  s.finance.cash -= amount;
  s.finance.today.expenses[category] = (s.finance.today.expenses[category] ?? 0) + amount;
}
/** Earn money today. */
export function addRevenue(s: GameState, category: string, amount: number): void {
  if (!isFinite(amount) || amount === 0) return;
  s.finance.cash += amount;
  s.finance.today.revenue[category] = (s.finance.today.revenue[category] ?? 0) + amount;
  s.stats.totalRevenue += amount;
}
/** One-off purchase. Returns false (and toasts) if the player can't afford it. */
export function trySpend(s: GameState, category: string, amount: number, what = 'that'): boolean {
  if (s.finance.cash < amount) {
    notify(s, `Not enough cash for ${what} (need ${formatMoney(amount)}).`, 'bad');
    return false;
  }
  addExpense(s, category, amount);
  return true;
}

let noticeSeq = 1;
export function notify(s: GameState, text: string, kind: NoticeKind = 'info'): void {
  // Collapse repeats: drop any unread toast with the same text so the newest one shows once.
  s.notifications = s.notifications.filter((n) => n.text !== text);
  s.notifications.push({ id: noticeSeq++ + s.day * 1000, day: s.day, text, kind });
  if (s.notifications.length > 8) s.notifications.splice(0, s.notifications.length - 8);
  // Full history for the notification log (GAME_DESIGN §18.4). Not collapsed: the log keeps every line.
  if (!s.noticeLog) s.noticeLog = [];
  s.noticeLog.push({ day: s.day, text, kind });
  if (s.noticeLog.length > 300) s.noticeLog.splice(0, s.noticeLog.length - 300);
}
export function pushNews(s: GameState, text: string, kind: NoticeKind = 'info'): void {
  s.news.push({ id: noticeSeq++ + s.day * 1000, day: s.day, text, kind });
  if (s.news.length > 200) s.news.splice(0, s.news.length - 200);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function formatMoney(v: number, digits = 1): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
export function formatNumber(v: number, digits = 1): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(digits)}K`;
  return `${sign}${a.toFixed(a < 10 && a % 1 ? 1 : 0)}`;
}
/** 1.5e20 -> "1.5e20 FLOP" style compact scientific */
export function formatFlops(v: number): string {
  if (v <= 0) return '0 FLOP';
  const e = Math.floor(Math.log10(v));
  return `${(v / 10 ** e).toFixed(1)}e${e} FLOP`;
}
/** Params in billions -> "350M", "7B", "1.2T" */
export function formatParams(paramsB: number): string {
  if (paramsB >= 1000) return `${+(paramsB / 1000).toFixed(1)}T`;
  if (paramsB >= 1) return `${+paramsB.toFixed(1)}B`;
  return `${Math.round(paramsB * 1000)}M`;
}

export const NEUTRAL_BONUSES: Bonuses = {
  trainingSpeed: 1,
  inferenceEfficiency: 1,
  dataQuality: 1,
  researchSpeed: 1,
  safety: 1,
  brand: 1,
  sales: 1,
  releaseHype: 1,
  finetuneCost: 1,
  budgetAppeal: 1,
  crownValue: 1,
  openPenalty: 1,
  valuation: 1,
  contractFit: 1,
};
