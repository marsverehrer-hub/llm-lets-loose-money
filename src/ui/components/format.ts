import { calendarYear, dayToDate, formatMoney, formatNumber } from '../../sim/util';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human duration from a day count: "5 days", "7 mo", "2.4 yr", "∞". */
export function formatDays(days: number): string {
  if (!isFinite(days)) return '∞';
  const a = Math.abs(days);
  if (a < 1) return '<1 day';
  if (a < 60) {
    const d = Math.round(a);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (a < 730) return `${Math.round(a / 30.4)} mo`;
  return `${(a / 365).toFixed(1)} yr`;
}

/** "Mar 2019" from a day number. */
export function monthYear(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2019" from a day number. */
export function yearLabel(day: number): string {
  return String(calendarYear(day));
}

/** Fraction (0..1) to a percent string. */
export function formatPct(v: number, digits = 0): string {
  if (!isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** Money with an explicit leading "+" for gains. Negatives keep their minus. */
export function signedMoney(v: number, digits = 1): string {
  if (!isFinite(v)) return '—';
  return v > 0 ? `+${formatMoney(v, digits)}` : formatMoney(v, digits);
}

/** Compact count: 1.2K, 3.4M. */
export function formatCount(v: number, digits = 1): string {
  if (!isFinite(v)) return '∞';
  return formatNumber(v, digits);
}

/** Whole number with thousands separators. */
export function formatInt(v: number): string {
  if (!isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** Words for the AI hype cycle value 0..100. */
export function hypeLabel(v: number): string {
  if (v >= 80) return 'Feverish';
  if (v >= 60) return 'Hot';
  if (v >= 40) return 'Warm';
  if (v >= 20) return 'Cooling';
  return 'Frozen';
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 'good' for positive, 'bad' for negative (flipped when invert), 'muted' for zero. */
export function toneOfDelta(v: number | null | undefined, invert = false): 'good' | 'bad' | 'muted' {
  if (v == null || !isFinite(v) || v === 0) return 'muted';
  return (v > 0) !== invert ? 'good' : 'bad';
}

/** Hex colour to rgba with alpha. Non-hex input is returned unchanged. */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** "Nice" axis ticks covering [min, max]. */
export function niceScale(min: number, max: number, target = 4): { lo: number; hi: number; step: number; ticks: number[] } {
  if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (max - min < 1e-12) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let i = 0, v = lo; v <= hi + step * 0.5 && i < 50; i++, v = lo + i * step) ticks.push(+v.toFixed(10));
  return { lo, hi, step, ticks };
}

/** Chart series colours as theme tokens, so they follow dark and light. LineChart resolves var() at draw time. */
export const SERIES = {
  amber: 'var(--amber)',
  fg: 'var(--fg-2)',
  blue: 'var(--blue)',
  up: 'var(--up)',
  down: 'var(--down)',
  dim: 'var(--fg-3)',
  yellow: 'var(--yellow)',
} as const;
export const SERIES_ORDER = [SERIES.amber, SERIES.fg, SERIES.blue, SERIES.up, SERIES.down, SERIES.yellow];
