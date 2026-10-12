import type { PanelId } from './App';

// Tiny global navigation so any panel/toast/tutorial can switch tabs.
type L = (id: PanelId) => void;
const ls = new Set<L>();
export function navigate(id: PanelId): void {
  for (const l of ls) l(id);
}
export function onNavigate(l: L): () => void {
  ls.add(l);
  return () => ls.delete(l);
}
