// One global game state. The UI reads it with useGame() and changes it only through act / nextWeek / skip.
import { useEffect, useState } from 'preact/hooks';
import type { Action, GameState } from '../sim/types';
import { apply } from '../sim/apply';
import { endWeek, fastForward } from '../sim/endWeek';
import { newGame, SAVE_KEY, SAVE_VERSION } from '../sim/state';

let state: GameState | null = load();
const subs = new Set<() => void>();
/** How many weeks the last fast-forward covered, for the digest line. */
export let lastSkip = 0;

function load(): GameState | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as GameState | null;
    return s && s.v === SAVE_VERSION ? s : null; // older saves are dropped, not migrated
  } catch {
    return null;
  }
}

function set(next: GameState | null): void {
  if (next === state) return;
  state = next;
  try {
    if (next) localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    else localStorage.removeItem(SAVE_KEY);
  } catch { /* private mode or full disk: the game still plays, it just will not resume */ }
  subs.forEach((f) => f());
}

export function useGame(): GameState | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = (): void => bump((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return state;
}

export const getGame = (): GameState | null => state;
export const act = (a: Action): void => { if (state) set(apply(state, a)); };
export const nextWeek = (): void => { if (state) { lastSkip = 0; set(endWeek(state)); } };
export const skip = (): void => { if (state) { const r = fastForward(state); lastSkip = r.weeks; set(r.s); } };
export const start = (seed: number, name: string): void => set(newGame(seed, name));
export const quit = (): void => set(null);

// Dev and smoke-test hook.
if (typeof window !== 'undefined') (window as unknown as { __game: unknown }).__game = { get: getGame, act, nextWeek, skip, start };
