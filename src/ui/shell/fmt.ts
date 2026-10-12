import { dayToDate, formatMoney } from '../../sim/util';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Terminal date: "14 MAR 2019". */
export function tdate(day: number): string {
  const d = dayToDate(day);
  return `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Ticker date: "14 MAR 19". */
export function tdateShort(day: number): string {
  const d = dayToDate(day);
  return `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${pad2(d.getUTCFullYear() % 100)}`;
}

/** Money without the leading dollar sign, for dense readouts: "8.21M", "-1.2K". */
export function bareMoney(v: number, digits = 1): string {
  return formatMoney(v, digits).replace('$', '');
}

/** Runway in the terminal style: "14D", "7M", "2.3Y". */
export function runwayLabel(days: number): string {
  if (!isFinite(days)) return 'PROFIT';
  const a = Math.abs(days);
  if (a < 60) return `${Math.max(0, Math.round(a))}D`;
  if (a < 730) return `${Math.round(a / 30.4)}M`;
  return `${(a / 365).toFixed(1)}Y`;
}

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F]/gu;

/**
 * Sim copy sometimes embeds icon emoji ("🏆 Achievement unlocked: ..."). The terminal
 * theme never renders them, so strip them from any dynamic text before it reaches the DOM.
 */
export function plain(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}
