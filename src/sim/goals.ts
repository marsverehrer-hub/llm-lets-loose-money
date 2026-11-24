// What the player is chasing: one headline race per game year, and the final standings.
import type { GameState, Id, Model } from './types';
import { clamp } from './rand';
import { crowns, fitOf, segDef, shareOf } from './demand';
import { C0 } from './resolve';
import { money } from './run';
import { playerControls } from './supply';
import { richList } from './stock';
import { RACES, type EndingId, type RaceDef } from './content/flavor';

export const YEAR = 48;
export const CAMPAIGN_WEEKS = 10 * YEAR;
export const yearOf = (week: number): number => Math.floor(week / YEAR);
export const raceOf = (week: number): RaceDef => RACES[Math.min(RACES.length - 1, yearOf(week))];

export function raceScore(s: GameState, race: RaceDef, labId: Id): number {
  if (race.metric === 'revenue') return s.companies[labId].rev;
  if (race.metric === 'crowns') return crowns(s, labId).length;
  const live = Object.values(s.models).filter((m) => m.lab === labId && !m.retired);
  if (race.metric === 'share') return s.segments[race.seg!] ? shareOf(s, race.seg!)[labId] ?? 0 : 0;
  if (race.metric === 'trust') return live.filter((m) => m.cap.reduce((a, b) => a + b, 0) / 4 >= 60).reduce((b, m) => Math.max(b, m.attrs.trust), 0);
  const def = segDef(s, race.seg!);
  const fits = live.filter((m) => m.modality === def.modality);
  // Cheapness is scored as how many times cheaper than a normal model of the first year.
  if (race.metric === 'cheap') return fits.filter((m) => fitOf(def, m.cap) >= 70).reduce((b, m) => Math.max(b, C0 / m.attrs.cost), 0);
  return fits.reduce((b, m) => Math.max(b, fitOf(def, m.cap)), 0);
}

export function formatRace(race: RaceDef, x: number): string {
  if (race.metric === 'revenue') return money(x);
  if (race.metric === 'crowns') return `${x}`;
  if (race.metric === 'share') return `${Math.round(x * 100)}%`;
  if (race.metric === 'trust') return `${Math.round(x * 100)}`;
  if (race.metric === 'cheap') return x ? `×${x.toFixed(1)}` : '—';
  return x.toFixed(1);
}

// --- Endings ---------------------------------------------------------------------------------------------------

/** Average language skill a model needs to count as the thing everyone was racing for. */
export const AGI_AT = 90;
/** True if the player runs or controls this lab. */
export const playerLab = (s: GameState, labId: Id): boolean => (labId === s.labId && s.helm) || playerControls(s, labId);

function ending(s: GameState, id: EndingId): void {
  if (s.endings.includes(id)) return;
  s.endings.push(id);
  s.moments.push({ kind: 'end', ending: id, standings: richList(s) });
}

/** The first language model past AGI_AT ends the race, for better or worse. */
export function checkAgi(s: GameState, m: Model): void {
  if (m.modality !== 'lang' || s.endings.includes('agi') || s.endings.includes('agiLost')) return;
  if (m.cap.reduce((a, b) => a + b, 0) / 4 < AGI_AT) return;
  const mine = playerLab(s, m.lab);
  s.log.push({ week: s.week, co: m.lab, tone: mine ? 'good' : 'bad', text: `${s.companies[m.lab].name}'s ${m.name} crosses the line. Everyone has a take.` });
  ending(s, mine ? 'agi' : 'agiLost');
}

const LAYERS_ALL = ['lab', 'cloud', 'chips', 'fab', 'power'] as const;
export const stackHeld = (s: GameState): string[] => LAYERS_ALL.filter((l) => Object.values(s.companies).some((c) => c.layer === l && (l === 'lab' ? playerLab(s, c.id) : playerControls(s, c.id))));

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
    co.cash += race.prize;
    co.lab!.brand = clamp(co.lab!.brand + 0.1, 0, 1);
    co.lab!.raceWins++;
    s.log.push({ week: s.week, co: co.id, tone: co.id === s.labId ? 'good' : 'info', text: `${co.name} wins ${race.name}.` });
  }
  s.moments.push({ kind: 'race', race: race.id, year: yearOf(s.week - 1) + 1, standings, prize: race.prize });
  if (stackHeld(s).length === LAYERS_ALL.length) ending(s, 'stack');
  if (s.week === CAMPAIGN_WEEKS) ending(s, 'rich');
}
