// v19: AGI endings. When the player (or a rival lab) finishes AGI, the game offers the endings the state allows; the
// chosen one is scored and shown, and the game can carry on as a sandbox. Package E1 fills this in.
import type { ActionHandlers, EndingId, GameState, Id } from '../types';

export interface EndingDef {
  id: EndingId;
  name: string;
  /** One paragraph of what happens next (dry satire). */
  text: string;
  /** Whether this ending is on the table, and why not when it isn't. */
  available: (s: GameState) => { ok: boolean; why: string };
}

export const ENDINGS: EndingDef[] = [];

/** Called when AGI is completed. `by` is 'player' or the rival lab id. E1 fills this in. */
export function reachAgi(s: GameState, by: 'player' | Id): void {
  if (s.pendingEnding || s.ending) return;
  s.pendingEnding = { day: s.day, by };
}

export function endingScore(_s: GameState, _id: EndingId): number {
  return 0;
}

export const handlers: ActionHandlers = {};
