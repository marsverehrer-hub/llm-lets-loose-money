// OWNER: MODEL LIFE (v15, GAME_DESIGN §25.3). The Hall of Fame bonus, kept free of heavy imports because bonuses.ts
// (read by almost every system) depends on it.
import type { Bonuses, GameState, HallOfFameEntry } from '../types';

export const HALL_TUNING = {
  /** Only this many entries count for the bonus (the best ones). */
  CAP: 8,
  /** Per entry; a Legend (mastery 5) counts twice. */
  BRAND: 1.02,
  VALUATION: 1.01,
};

/** Hall of Fame entries that count for the bonus: the best CAP by mastery, then overall. */
export function countedHall(s: GameState): HallOfFameEntry[] {
  return [...(s.hallOfFame ?? [])].sort((a, b) => b.mastery - a.mastery || b.overall - a.overall).slice(0, HALL_TUNING.CAP);
}

/** Lasting bonuses from the Hall of Fame (folded into getBonuses). */
export function hallBonuses(s: GameState): Partial<Bonuses> {
  let w = 0;
  for (const e of countedHall(s)) w += e.mastery >= 5 ? 2 : 1;
  if (w === 0) return {};
  return { brand: HALL_TUNING.BRAND ** w, valuation: HALL_TUNING.VALUATION ** w };
}
