// Lifetime trophy cabinet: every achievement unlocked in any game on this device. At 10, 25 and 40 trophies a cosmetic
// title is shown. Nothing here touches the sim or the balance.
import type { GameState } from '../sim/types';

const KEY = 'llm-lets-loose-money/trophies';

export const TITLE_STEPS = [
  { at: 10, title: 'Founder' },
  { at: 25, title: 'Serial founder' },
  { at: 40, title: 'Industry veteran' },
];

export function titleFor(count: number): string | null {
  let title: string | null = null;
  for (const step of TITLE_STEPS) if (count >= step.at) title = step.title;
  return title;
}

export function nextStep(count: number): { at: number; title: string } | null {
  return TITLE_STEPS.find((step) => step.at > count) ?? null;
}

let cabinet: Set<string> | null = null;

function load(): Set<string> {
  if (!cabinet) {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      cabinet = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      cabinet = new Set();
    }
  }
  return cabinet;
}

/** Adds the game's unlocked achievements to the cabinet. Runs every tick; writes only when something is new. */
export function noteTrophies(s: GameState): void {
  const set = load();
  let added = false;
  for (const id of Object.keys(s.achievements)) {
    if (!set.has(id)) {
      set.add(id);
      added = true;
    }
  }
  if (!added) return;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Blocked storage: the cabinet still counts for this session.
  }
}

/** Lifetime trophies. The current game's achievements count too, so the number is right even when storage is blocked. */
export function lifetimeCount(achievements: Record<string, number> = {}): number {
  const ids = load();
  let n = ids.size;
  for (const id of Object.keys(achievements)) if (!ids.has(id)) n++;
  return n;
}
