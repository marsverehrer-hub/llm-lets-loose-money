import { useEffect } from 'preact/hooks';
import type { PanelId } from './App';
import type { Id, ProductKind, RoleId } from '../sim/types';

// Tiny global navigation so any panel/toast/tutorial can switch tabs.
// v17.2: a navigation can carry an intent, so a button lands on the control it names (the train sheet, the release
// wizard, a compute tab, the term sheet) instead of the top of a panel. The target panel consumes it once.
export type Intent =
  | { open: 'train' }
  | { open: 'run' }
  | { open: 'release'; modelId: Id }
  | { open: 'model'; modelId: Id }
  | { open: 'launch'; kind?: ProductKind }
  | { open: 'hire'; role?: RoleId }
  | { tab: 'rent' | 'cloud' | 'build' | 'neocloud' }
  | { focus: 'offer' | 'pitch' };

type L = (id: PanelId) => void;
const ls = new Set<L>();
let pending: { panel: PanelId; intent: Intent } | null = null;

export function navigate(id: PanelId, intent?: Intent): void {
  pending = intent ? { panel: id, intent } : null;
  for (const l of ls) l(id);
}
export function onNavigate(l: L): () => void {
  ls.add(l);
  return () => ls.delete(l);
}

/** The intent waiting for `panel`, once: it is cleared when taken. */
export function takeIntent(panel: PanelId): Intent | null {
  if (!pending || pending.panel !== panel) return null;
  const { intent } = pending;
  pending = null;
  return intent;
}

/**
 * Applies intents aimed at `panel`: the one waiting when the panel mounts, and any that arrive while it is already on
 * screen (switching to the current tab does not remount it).
 */
export function useIntent(panel: PanelId, apply: (i: Intent) => void): void {
  useEffect(() => {
    const run = () => {
      const i = takeIntent(panel);
      if (i) apply(i);
    };
    run();
    // After the App has switched tabs; a panel that is unmounting by then finds nothing for itself.
    return onNavigate(() => queueMicrotask(run));
  }, [panel]);
}
