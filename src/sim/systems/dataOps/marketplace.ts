// Marketplace: listing value, weekly sale chance, and the open listing lookup.
import type { DataListing, DatasetDef, GameState, Id } from '../../types';
import { calendarYear, clamp } from '../../util';
import { DATAOPS_TUNING } from './tuning';
import { valueEra } from './era';

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// 3. Marketplace (your data for rivals)
// ---------------------------------------------------------------------------

/** What a set is worth to a buyer: tokens x quality x the market value per billion tokens this year. */
export function listingValue(s: GameState, d: DatasetDef): number {
  return d.tokensB * d.quality * T.VALUE_PER_B_2017 * valueEra(calendarYear(s.day));
}

/** Chance per rival per week that a listing sells. Falls off with the square of price over value. */
export function saleChance(value: number, price: number, exclusive: boolean): number {
  if (!(price > 0) || !(value > 0)) return 0;
  const base = T.SALE_BASE_CHANCE * (value / price) ** 2;
  return clamp(base * (exclusive ? T.EXCLUSIVE_CHANCE_MULT : 1), 0, T.SALE_MAX_CHANCE);
}

export function listingFor(s: GameState, datasetId: Id): DataListing | undefined {
  return (s.dataOps?.listings ?? []).find((l) => l.datasetId === datasetId && !l.closed);
}
