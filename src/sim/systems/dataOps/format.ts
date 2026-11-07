// Display helpers for data ops messages: percent, money and title case.
import { formatMoney } from '../../util';

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
export function usd(v: number): string {
  return formatMoney(v, 1).replace(/\.0(?=[KMBT]|$)/, '');
}
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
