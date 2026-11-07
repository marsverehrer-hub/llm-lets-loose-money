import { dayToDate, formatMoney } from '../../sim/util';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date: "14 Mar 2019". */
export function tdate(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Ticker date: "14 Mar 19". */
export function tdateShort(day: number): string {
  const d = dayToDate(day);
  return `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${pad2(d.getUTCFullYear() % 100)}`;
}

/** Money without the leading dollar sign, for dense readouts: "8.21M", "-1.2K". */
export function bareMoney(v: number, digits = 1): string {
  return formatMoney(v, digits).replace('$', '');
}

/** Days before a runway reading means anything (no costs or revenue have landed yet). */
export const RUNWAY_WARMUP_DAYS = 7;

/**
 * Runway in words: "14 days", "7 months", "2.3 years", "Profitable". v18: pass the game day and the first week reads
 * "—" instead of a reassuring "Profitable" built on zero revenue and zero costs.
 */
export function runwayLabel(days: number, gameDay?: number): string {
  if (gameDay !== undefined && gameDay < RUNWAY_WARMUP_DAYS) return '—';
  if (!isFinite(days)) return 'Profitable';
  const a = Math.abs(days);
  if (a < 60) return `${Math.max(0, Math.round(a))} days`;
  if (a < 730) return `${Math.round(a / 30.4)} months`;
  return `${(a / 365).toFixed(1)} years`;
}

/** v18: one colour rule for runway everywhere (HUD, HQ, finance scene, board goals). */
export function runwayTone(days: number, gameDay?: number): 'good' | 'warn' | 'bad' | 'muted' {
  if (gameDay !== undefined && gameDay < RUNWAY_WARMUP_DAYS) return 'muted';
  if (days < 180) return 'bad';
  if (days < 540) return 'warn';
  return 'good';
}

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F]/gu;

/**
 * Sim copy sometimes embeds icon emoji ("🏆 Achievement unlocked: ..."). The terminal
 * theme never renders them, so strip them from any dynamic text before it reaches the DOM.
 */
export function plain(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}
