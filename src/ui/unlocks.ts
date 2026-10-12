// OWNER: ONBOARD (v10 agent 7). Progressive disclosure: which nav panels show (GAME_DESIGN §21.4).
//
// Each unlock is saved on the game as a flag, so it survives reloads and saves:
//   s.flags['ui.unlock.<panel>'] = the day the panel opened
//   s.flags['ui.seen.<panel>']   = the day the player first opened it (no nav dot after that)
// The sim never reads these keys. The sim has no action for them, so the UI writes them directly.
import type { PanelId } from './App';
import { BALANCE } from '../sim/balance';
import { scenarioById } from '../sim/data/scenarios';
import type { GameState } from '../sim/types';
import { notify } from '../sim/util';
import { getState, refresh } from './store';

/** Panels that open by rule. The VS panel is not here: it exists only while a multiplayer match does. */
export type GatedPanel = Exclude<PanelId, 'vs'>;

export const PANEL_INFO: Record<PanelId, { label: string; tagline: string }> = {
  dashboard: { label: 'Headquarters', tagline: '' },
  models: { label: 'Models', tagline: '' },
  products: { label: 'Products', tagline: 'Turn your models into products people pay for.' },
  compute: { label: 'Compute', tagline: '' },
  data: { label: 'Data', tagline: '' },
  research: { label: 'Research', tagline: '' },
  benchmarks: { label: 'Benchmarks', tagline: 'Score your models against the field.' },
  staff: { label: 'Staff', tagline: '' },
  market: { label: 'Market', tagline: 'See who is winning the market and what buyers want.' },
  marketing: { label: 'Marketing', tagline: 'Grow your brand and hype.' },
  contracts: { label: 'Contracts', tagline: 'Bid for paid work from clients.' },
  finance: { label: 'Finance', tagline: '' },
  vs: { label: 'Versus', tagline: 'Play a live match against another lab.' },
  achievements: { label: 'Trophies', tagline: 'Track the milestones you have hit.' },
};

interface Rule {
  id: GatedPanel;
  /** Open from the first day. */
  start?: boolean;
  /** Open once this holds. Unlocks stick: the flag is written and never removed. */
  open?: (s: GameState) => boolean;
}

const released = (s: GameState) => s.models.some((m) => m.releasedDay !== null);
/** A contract board that has ever had work on it (offers, active deals or past history). */
const contractBoardOpen = (s: GameState) => {
  const cs = s.contracts;
  return !!cs && (cs.offers.length > 0 || cs.active.length > 0 || cs.history.length > 0);
};

const RULES: Rule[] = [
  { id: 'dashboard', start: true },
  { id: 'models', start: true },
  { id: 'compute', start: true },
  { id: 'data', start: true },
  { id: 'research', start: true },
  { id: 'staff', start: true },
  { id: 'finance', start: true },
  { id: 'products', open: (s) => s.models.length > 0 },
  { id: 'market', open: (s) => s.products.length > 0 },
  { id: 'marketing', open: (s) => s.products.length > 0 },
  { id: 'benchmarks', open: released },
  { id: 'contracts', open: (s) => released(s) && contractBoardOpen(s) },
  { id: 'achievements', open: (s) => Object.keys(s.achievements).length > 0 },
];

const RULE_BY_ID = new Map<GatedPanel, Rule>(RULES.map((r) => [r.id, r]));
const LEGACY_DAY = 120;
const UNLOCK = 'ui.unlock.';
const SEEN = 'ui.seen.';
const gateKey = (id: GatedPanel) => UNLOCK + id;

// Anything that changes which panels show (unlock, first visit, show all). App listens and re-renders the shell.
const listeners = new Set<() => void>();
export function subscribeUnlocks(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tell the shell that the nav changed: re-render the nav and let the toasts re-read the notification list. */
function announce(): void {
  for (const l of listeners) l();
  refresh();
}

/** Late starts (a scenario that begins after 2017) open every screen: they arrive with a whole company. */
export function isLateStart(s: GameState): boolean {
  const year = s.setup?.startYear ?? BALANCE.START_YEAR;
  return year > BALANCE.START_YEAR || scenarioById(s.setup?.scenarioId).startYear > BALANCE.START_YEAR;
}

/** The first-run marker: the HQ unlock flag is written on the first pass over any game. */
function hasMarker(s: GameState): boolean {
  return s.flags[gateKey('dashboard')] !== undefined;
}

/** Late starts, and saves from before v10 (no unlock flags, past day 120), open everything. */
function openAll(s: GameState): boolean {
  return isLateStart(s) || (!hasMarker(s) && s.day > LEGACY_DAY);
}

/** Whether the nav shows this panel right now. The VS panel is decided by App (it follows the match). */
export function isPanelVisible(s: GameState, id: PanelId): boolean {
  if (id === 'vs') return false;
  if (openAll(s) || s.flags[gateKey(id)] !== undefined) return true;
  const r = RULE_BY_ID.get(id);
  return !!r && !!(r.start || r.open?.(s));
}

/** Panels the player has not opened yet, by rule (for the menu: how many are still hidden). */
export function hiddenPanels(s: GameState): GatedPanel[] {
  return RULES.map((r) => r.id).filter((id) => !isPanelVisible(s, id));
}

/** Panels that just opened and have not been visited: they get the nav "new" dot. */
export function unseenPanels(s: GameState): PanelId[] {
  return RULES.map((r) => r.id).filter((id) => s.flags[gateKey(id)] !== undefined && s.flags[SEEN + id] === undefined);
}

/**
 * Writes every unlock whose rule now holds, and toasts the ones that happen during play. A game seen for the first
 * time (or a late start / old save) opens what already holds quietly, so nobody gets a wall of toasts on load.
 * Returns true when something was written.
 */
export function syncUnlocks(s: GameState): boolean {
  const first = !hasMarker(s);
  const all = openAll(s);
  let changed = false;
  const news: GatedPanel[] = [];
  for (const r of RULES) {
    if (s.flags[gateKey(r.id)] !== undefined) continue;
    if (!(all || r.start || r.open?.(s))) continue;
    s.flags[gateKey(r.id)] = s.day;
    changed = true;
    if (first || all) s.flags[SEEN + r.id] = s.day;
    else news.push(r.id);
  }
  for (const id of news) {
    const info = PANEL_INFO[id];
    notify(s, `New screen: ${info.label}. ${info.tagline}`, 'info');
  }
  if (changed) announce();
  return changed;
}

/** Opens a panel regardless of its rule. Used when the player navigates to it and by tutorial steps. */
export function unlockPanel(s: GameState, id: PanelId): void {
  if (id === 'vs' || !RULE_BY_ID.has(id) || s.flags[gateKey(id)] !== undefined) return;
  s.flags[gateKey(id)] = s.day;
  announce();
}

/** The player opened the panel: its "new" dot goes away. */
export function markSeen(s: GameState, id: PanelId): void {
  if (id === 'vs' || s.flags[gateKey(id)] === undefined || s.flags[SEEN + id] !== undefined) return;
  s.flags[SEEN + id] = s.day;
  announce();
}

/** Menu: open every screen at once. No unlock toasts, because the player asked for it. */
export function showAllScreens(): void {
  const s = getState();
  for (const r of RULES) {
    if (s.flags[gateKey(r.id)] === undefined) s.flags[gateKey(r.id)] = s.day;
    if (s.flags[SEEN + r.id] === undefined) s.flags[SEEN + r.id] = s.day;
  }
  notify(s, 'All screens are open.', 'info');
  announce();
}

/** A one-line toast from a UI action (the store does not announce UI-only writes, so this refreshes the toasts too). */
export function showNotice(text: string): void {
  notify(getState(), text, 'info');
  announce();
}
