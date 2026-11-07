// Daily challenge: one scenario, difficulty and seed per UTC date, chosen by a tiny hash so every player gets the same
// world today. The date is read here in the UI; the sim only keeps the date it is given.
import { DIFFICULTIES, SCENARIOS, difficultyDef, scenarioById } from '../../sim/data/scenarios';
import type { DifficultyId, GameState } from '../../sim/types';
import { formatMoney } from '../../sim/util';

/** A string hash (djb2 with xor), the same on every browser. */
export function hashText(t: string): number {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h;
}

/** Today's UTC date as YYYY-MM-DD. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export interface DailySetup {
  seed: number;
  scenarioId: string;
  difficulty: DifficultyId;
}

export function dailySetup(date: string): DailySetup {
  const h = hashText(date);
  const scenario = SCENARIOS[h % SCENARIOS.length];
  const difficulty = DIFFICULTIES[Math.floor(h / SCENARIOS.length) % DIFFICULTIES.length];
  return { seed: hashText(`seed ${date}`) % 2 ** 31, scenarioId: scenario.id, difficulty: difficulty.id };
}

/** The one-line result for a daily game that has ended (an ending or bankruptcy). */
export function shareLine(s: GameState): string {
  const result = s.ending ? `score ${s.ending.score}` : 'bankrupt';
  const scenario = scenarioById(s.setup?.scenarioId).name;
  const diff = difficultyDef(s.setup?.difficulty).name;
  return `LLM Lets Loose Money · daily ${s.setup?.daily ?? ''} · ${scenario} · ${diff} · ${result} · peak ${formatMoney(s.stats.peakValuation, 1)}`;
}
