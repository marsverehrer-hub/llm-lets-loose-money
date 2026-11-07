// v19 "Living Field": rival labs are simulated companies. This module owns their state (s.rivals) and runs them on
// their own random stream, so the player's stream (events, incidents) is not shifted by how many labs exist.
import type { CompetitorDef, GameState, RivalLab } from '../../types';
import { COMPETITORS } from '../../data/competitors';
import { makeRng } from '../../rng';
import type { Rng } from '../../types';
import { RIVAL_TUNING } from './tuning';
import { brainWeek } from './brain';
import { lifecycleDay, newRivalLab } from './lifecycle';
import { plansYear } from './plans';
import { dayToDate } from '../../util';

export { RIVAL_TUNING } from './tuning';
export { rivalBase, onRivalRelease, rivalReleaseName } from './brain';
export { canActivate } from './lifecycle';
export { planMods, PLAN_NAME } from './plans';

/** The lab records, created on first use (old saves and new games alike). */
export function rivalLabs(s: GameState): RivalLab[] {
  if (!s.rivals) s.rivals = [];
  for (const def of COMPETITORS) if (!s.rivals.some((l) => l.id === def.id)) s.rivals.push(newRivalLab(def));
  return s.rivals;
}

export function rivalLab(s: GameState, id: string): RivalLab | undefined {
  return rivalLabs(s).find((l) => l.id === id);
}

export function rivalDef(id: string): CompetitorDef | undefined {
  return COMPETITORS.find((d) => d.id === id);
}

/** Run `fn` with the rival stream; its state lives in s.flags so saves and multiplayer snapshots carry it. */
function withRivalRng(s: GameState, fn: (rng: Rng) => void): void {
  const holder = { rngState: (s.flags['rivalRng'] ?? (s.seed ^ 0x51ed5eed)) | 0 };
  fn(makeRng(holder));
  s.flags['rivalRng'] = holder.rngState;
}

/** Daily step, called at the top of competitorsTick on the host (or solo). */
export function rivalsTick(s: GameState): void {
  const labs = rivalLabs(s);
  withRivalRng(s, (rng) => {
    // Plans: everyone on 1 January, and a lab founded mid-year announces within the week.
    const d = dayToDate(s.day);
    if ((d.getUTCMonth() === 0 && d.getUTCDate() === 1) || s.day % RIVAL_TUNING.BRAIN_EVERY_DAYS === 0) plansYear(s, rng);
    lifecycleDay(s, rng);
    if (s.day % RIVAL_TUNING.BRAIN_EVERY_DAYS !== 0) return;
    for (const lab of labs) {
      if (lab.status !== 'active') continue;
      const def = rivalDef(lab.id);
      if (def) brainWeek(s, lab, def, rng);
    }
  });
}
