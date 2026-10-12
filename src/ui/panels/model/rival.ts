// OWNER: VIZ. The best rival model by Elo, with its capability shape, for the model page's Radar.
// Reads the sim through its public APIs only (competitors and labs). Never reads hidden model state.
import { competitorCaps } from '../../../sim/systems/capabilities';
import { labName } from '../../../sim/systems/labs';
import { CAP_IDS } from '../../../sim/types';
import type { Capabilities, GameState } from '../../../sim/types';
import { calendarYear } from '../../../sim/util';
import { CAP_LABEL } from '../train/model';

export interface RivalShape {
  /** The rival model's name, e.g. "Kestrel-3". */
  name: string;
  /** The lab that released it. */
  lab: string;
  elo: number;
  caps: Capabilities;
}

/** The strongest rival release by Elo, or null when no active rival has a model yet. */
export function bestRival(s: GameState): RivalShape | null {
  let best: RivalShape | null = null;
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    if (best && c.model.elo <= best.elo) continue;
    best = {
      name: c.model.name,
      lab: labName(s, c.id),
      elo: c.model.elo,
      caps: c.model.caps ?? competitorCaps(c.model.scores, null, null, calendarYear(c.model.releasedDay)),
    };
  }
  return best;
}

/** One radar axis per capability, in the sim's order. */
export const CAP_AXES = CAP_IDS.map((id) => ({ id, label: CAP_LABEL[id] }));
