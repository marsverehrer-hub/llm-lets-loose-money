// OWNER: Agent MP-NET. localStorage for 1v1 matches. Separate keys: the single-player save (sim/save.ts) is never touched.
// v12: every match is an explicit, named save. The player names it in the multiplayer screen before hosting or
// joining; the match autosaves into that slot, survives leaving, and can be resumed from the list later.
import type { GameState } from '../sim/types';
import { SAVE_VERSION } from '../sim/state';
import { mpSetConnected } from '../sim/systems/multiplayer';

/** Pre-v12 single slot. Migrated into the list on first load, then removed. */
export const MP_SAVE_KEY = 'llm-lets-loose-money/mp-save';
export const MP_RELAY_KEY = 'llm-lets-loose-money/mp-relay';
const INDEX_KEY = 'llm-lets-loose-money/mp-saves';
const ACTIVE_KEY = 'llm-lets-loose-money/mp-active';
const stateKey = (id: string) => `llm-lets-loose-money/mp-save:${id}`;

export const MAX_MP_SAVES = 12;

/** What the saved-matches list shows without parsing the whole game. */
export interface MpSaveMeta {
  id: string;
  /** The name the player gave the save. */
  name: string;
  role: 'host' | 'guest';
  room: string;
  companyName: string;
  myColor: string;
  rivalName: string | null;
  rivalColor: string | null;
  lengthYears: number | null;
  day: number;
  valuation: number;
  rivalValuation: number | null;
  result: null | { winner: 'me' | 'rival' | 'draw'; reason: string };
  /** Relay URL the match runs through; null = PeerJS cloud. */
  relay: string | null;
  createdAt: number;
  updatedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readIndex(): MpSaveMeta[] {
  const ls = storage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as MpSaveMeta[]) : [];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(list: MpSaveMeta[]): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(INDEX_KEY, JSON.stringify(list));
    emit();
    return true;
  } catch {
    return false;
  }
}

// --- change listeners (the saved-matches list re-renders on writes) -------------------------------------------
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
export function onMpSavesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// --- the match that is in the store right now ---------------------------------------------------------------
let activeId: string | null = (() => {
  try {
    return storage()?.getItem(ACTIVE_KEY) ?? null;
  } catch {
    return null;
  }
})();

export function activeMpSaveId(): string | null {
  return activeId;
}

function setActive(id: string | null): void {
  activeId = id;
  const ls = storage();
  if (!ls) return;
  try {
    if (id) ls.setItem(ACTIVE_KEY, id);
    else ls.removeItem(ACTIVE_KEY);
  } catch {
    // ignore
  }
}

/** Name and relay for the next match that starts (set by the lobby before hosting or joining). */
let pending: { name: string; relay: string | null } | null = null;

export function setPendingMpSave(name: string, relay: string | null): void {
  pending = { name: name.trim().slice(0, 40), relay };
  setActive(null); // the next install creates a fresh slot
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function metaFrom(s: GameState, base: Pick<MpSaveMeta, 'id' | 'name' | 'relay' | 'createdAt'>): MpSaveMeta {
  const mp = s.mp!;
  return {
    ...base,
    role: mp.role,
    room: mp.room,
    companyName: s.company.name,
    myColor: mp.myColor,
    rivalName: mp.rival?.companyName ?? null,
    rivalColor: mp.rival?.color ?? null,
    lengthYears: mp.settings.lengthYears,
    day: s.day,
    valuation: s.finance.valuation,
    rivalValuation: mp.rival?.valuation ?? null,
    result: mp.result ? { winner: mp.result.winner, reason: mp.result.reason } : null,
    updatedAt: Date.now(),
  };
}

/**
 * Write the live match into its slot, creating the slot (with the pending name) the first time.
 * Returns false when storage refused it. States without `mp` are ignored.
 */
export function saveMp(s: GameState): boolean {
  const ls = storage();
  if (!ls || !s.mp) return false;
  const list = readIndex();
  let meta = activeId ? list.find((m) => m.id === activeId) : undefined;
  if (!meta) {
    const rival = s.mp.rival?.companyName;
    const name = pending?.name || (rival ? `${s.company.name} vs ${rival}` : `Match ${s.mp.room}`);
    meta = metaFrom(s, { id: newId(), name, relay: pending?.relay ?? null, createdAt: Date.now() });
    pending = null;
    // Make room: drop the oldest finished matches first, then the oldest overall.
    while (list.length >= MAX_MP_SAVES) {
      const sorted = [...list].sort((a, b) => Number(!!b.result) - Number(!!a.result) || a.updatedAt - b.updatedAt);
      const drop = sorted[0];
      list.splice(list.indexOf(drop), 1);
      try {
        ls.removeItem(stateKey(drop.id));
      } catch {
        // ignore
      }
    }
    list.push(meta);
    setActive(meta.id);
  } else {
    Object.assign(meta, metaFrom(s, meta));
  }
  try {
    ls.setItem(stateKey(meta.id), JSON.stringify(s));
  } catch {
    return false; // quota or blocked storage: the match keeps running, it just won't survive a reload
  }
  return writeIndex(list);
}

function parse(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<GameState> | null;
    if (!saved || typeof saved !== 'object' || !saved.mp) return null;
    if (typeof saved.saveVersion !== 'number' || saved.saveVersion > SAVE_VERSION) return null;
    const s = saved as GameState;
    // Always comes back disconnected: the page cannot know whether the peer is still there.
    mpSetConnected(s, false);
    return s;
  } catch {
    return null; // corrupt save
  }
}

/** Move a pre-v12 single-slot match into the list. */
function migrateLegacy(): void {
  const ls = storage();
  if (!ls) return;
  let raw: string | null = null;
  let relay: string | null = null;
  try {
    raw = ls.getItem(MP_SAVE_KEY);
    relay = ls.getItem(MP_RELAY_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  const s = parse(raw);
  if (s) {
    const rival = s.mp!.rival?.companyName;
    const meta = metaFrom(s, { id: newId(), name: rival ? `${s.company.name} vs ${rival}` : `Match ${s.mp!.room}`, relay, createdAt: Date.now() });
    try {
      ls.setItem(stateKey(meta.id), raw);
      writeIndex([...readIndex(), meta]);
      setActive(meta.id);
    } catch {
      return;
    }
  }
  try {
    ls.removeItem(MP_SAVE_KEY);
    ls.removeItem(MP_RELAY_KEY);
  } catch {
    // ignore
  }
}

/** The match that was in play when the page closed (comes back disconnected), or null. */
export function loadMp(): GameState | null {
  migrateLegacy();
  if (!activeId) return null;
  const s = loadMpSave(activeId);
  if (!s) setActive(null);
  return s;
}

/** One saved match by id, or null when it is missing, corrupt or from a newer build. */
export function loadMpSave(id: string): GameState | null {
  try {
    return parse(storage()?.getItem(stateKey(id)) ?? null);
  } catch {
    return null;
  }
}

/** All saved matches, most recently played first. */
export function listMpSaves(): MpSaveMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Make `id` the match in play (after its state was installed in the store). */
export function activateMpSave(id: string): void {
  setActive(id);
}

export function renameMpSave(id: string, name: string): void {
  const list = readIndex();
  const m = list.find((x) => x.id === id);
  const clean = name.trim().slice(0, 40);
  if (!m || !clean) return;
  m.name = clean;
  writeIndex(list);
}

export function deleteMpSave(id: string): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(stateKey(id));
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter((m) => m.id !== id));
  if (activeId === id) setActive(null);
}

/** The relay of the match in play (null = PeerJS cloud). */
export function loadMpRelay(): string | null {
  if (!activeId) return pending?.relay ?? null;
  return readIndex().find((m) => m.id === activeId)?.relay ?? null;
}

/** Kept for the session API: the relay is stored with the slot when it is created. */
export function saveMpRelay(url: string | null): void {
  if (pending) pending.relay = url;
}

/** Leave the match in play. Its save is kept in the list; only the "in play" marker is cleared. */
export function clearMp(): void {
  setActive(null);
}
