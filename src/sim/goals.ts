// What the player is chasing: one headline race per game year, and the final standings.
import type { GameState, Id } from './types';
import { clamp } from './rand';
import { crowns, fitOf } from './demand';
import { richList } from './stock';
import { SEGMENTS } from './content/modalities';
import { RACES, type RaceDef } from './content/flavor';

export const YEAR = 48;
export const CAMPAIGN_WEEKS = 10 * YEAR;
export const yearOf = (week: number): number => Math.floor(week / YEAR);
export const raceOf = (week: number): RaceDef => RACES[yearOf(week) % RACES.length];

export function raceScore(s: GameState, race: RaceDef, labId: Id): number {
  if (race.metric === 'revenue') return s.companies[labId].rev;
  if (race.metric === 'crowns') return crowns(s, labId).length;
  const def = SEGMENTS[race.seg!];
  return Object.values(s.models).filter((m) => m.lab === labId && !m.retired && m.modality === def.modality)
    .reduce((b, m) => Math.max(b, fitOf(def, m.cap)), 0);
}

export function raceStandings(s: GameState, race = raceOf(s.week)): { co: Id; score: number }[] {
  return Object.values(s.companies).filter((c) => c.lab).map((c) => ({ co: c.id, score: raceScore(s, race, c.id) }))
    .sort((a, b) => b.score - a.score);
}

/** Called when a year has just ended (s.week is the first week of the new year). */
export function yearEnd(s: GameState): void {
  const race = raceOf(s.week - 1);
  const standings = raceStandings(s, race);
  const win = standings[0];
  if (win && win.score > 0) {
    const co = s.companies[win.co];
    co.cash += race.prize * Math.pow(2, Math.floor(yearOf(s.week - 1) / RACES.length));
    co.lab!.brand = clamp(co.lab!.brand + 0.1, 0, 1);
    co.lab!.raceWins++;
    s.log.push({ week: s.week, co: co.id, tone: co.id === s.labId ? 'good' : 'info', text: `${co.name} wins ${race.name}.` });
  }
  s.moments.push({ kind: 'race', race: race.id, year: yearOf(s.week - 1) + 1, standings, prize: race.prize });
  if (s.week === CAMPAIGN_WEEKS) s.moments.push({ kind: 'end', standings: richList(s) });
}
