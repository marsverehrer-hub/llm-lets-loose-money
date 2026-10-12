// Lab lookup that also knows about the human rival in multiplayer. Use this instead of COMPETITORS.find.
import type { GameState, Id, Personality } from '../types';
import { MP_RIVAL_ID } from '../types';
import { COMPETITORS } from '../data/competitors';

export interface LabInfo {
  id: Id;
  name: string;
  color: string;
  tagline: string;
  personality: Personality;
  human: boolean;
}

export const HUMAN_RIVAL_TAGLINE = 'Another human. Worse: a founder.';

export function labInfo(s: GameState, id: Id): LabInfo | undefined {
  if (id === MP_RIVAL_ID) {
    const r = s.mp?.rival;
    return { id, name: r?.companyName ?? 'Rival', color: r?.color ?? '#e46fd0', tagline: HUMAN_RIVAL_TAGLINE, personality: 'chaos', human: true };
  }
  const d = COMPETITORS.find((c) => c.id === id);
  if (!d) return undefined;
  return { id, name: d.name, color: d.color, tagline: d.tagline, personality: d.personality, human: false };
}

export function labName(s: GameState, id: Id): string {
  return labInfo(s, id)?.name ?? id;
}
