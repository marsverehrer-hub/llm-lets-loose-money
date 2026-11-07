// Era scaling: yield, cost and value multipliers by calendar year (pure).
import { BALANCE } from '../../balance';
import { DATAOPS_TUNING } from './tuning';

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// Era scaling (pure). Years before 2017 clamp to 2017.
// ---------------------------------------------------------------------------

export function yieldEra(year: number): number {
  return 2 ** (Math.max(0, year - BALANCE.START_YEAR) / T.YIELD_DOUBLING_YEARS);
}
export function costEra(year: number): number {
  return 1 + T.COST_GROWTH_PER_YEAR * Math.max(0, year - BALANCE.START_YEAR);
}
export function valueEra(year: number): number {
  return (1 + T.VALUE_GROWTH_PER_YEAR) ** Math.max(0, year - BALANCE.START_YEAR);
}
