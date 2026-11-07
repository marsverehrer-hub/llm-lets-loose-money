// Run modifiers: a chosen modifier scales one existing rule. Unchosen (or an old save) is 1.
import type { GameState, ModifierId } from '../types';
import { MODIFIERS } from '../data/modifiers';

export function modifierMult(s: GameState, id: ModifierId): number {
  if (!s.setup?.modifiers?.includes(id)) return 1;
  return MODIFIERS.find((m) => m.id === id)?.mult ?? 1;
}

/** Names of the modifiers this run was started with, for the HQ header. */
export function modifierNames(s: GameState): string[] {
  return MODIFIERS.filter((m) => s.setup?.modifiers?.includes(m.id)).map((m) => m.name);
}
