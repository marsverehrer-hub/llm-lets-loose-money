// OWNER: Agent C. localStorage saves with version check + migration hook.
// Several games live side by side as slots. A slot is an index entry (SlotMeta) plus its JSON under its own key.
// The active slot is the game autosave writes to. Every write reports its outcome instead of throwing.
import type { GameState } from './types';
import { SAVE_VERSION, createInitialState } from './state';
import { backfillCapabilities } from './systems/capabilities';
import { backfillTraining } from './systems/training';
import { dayToDate } from './util';

/** The single save from before slots existed. Moved into a slot on first use, then removed. */
export const SAVE_KEY = 'llm-lets-loose-money/save';
export const SLOTS_KEY = 'llm-lets-loose-money/slots';
export const ACTIVE_SLOT_KEY = 'llm-lets-loose-money/active-slot';
export const SLOT_KEY_PREFIX = 'llm-lets-loose-money/slot/';
/** Most slots a player can keep. Snapshots count too. */
export const MAX_SLOTS = 12;
/** Marks a file as an export from this game. */
export const EXPORT_FORMAT = 'llm-lets-loose-money-save';

export interface SlotMeta {
  id: string;
  /** The name shown in the saves list. Starts as the company name; the player can rename it. */
  name: string;
  company: string;
  day: number;
  /** In-game date, "14 Mar 2019". */
  dateLabel: string;
  scenarioId?: string;
  difficulty?: string;
  valuation: number;
  cash: number;
  /** Real time of the last write (ms since the epoch). */
  savedAt: number;
  /** True for a game's own slot. False for a manual snapshot or an import. */
  auto: boolean;
}

export type SaveError = 'quota' | 'blocked' | 'full';
export type SaveResult = { ok: true } | { ok: false; error: SaveError };
export type CreateResult = { ok: true; id: string } | { ok: false; error: SaveError };
export type ImportResult = { ok: true; id: string } | { ok: false; error: 'invalid' | 'newer' | SaveError };

/** Paths whose saved value replaces the default wholesale (maps where missing keys mean "gone", not "default"). */
const RECORD_PATHS = new Set([
  'compute.rented',
  'finance.today.revenue',
  'finance.today.expenses',
  'finance.revenueBreakdown',
  'finance.expenseBreakdown',
  'events.lastFired',
  'achievements',
  'flags',
]);

/** Save-format migrations, keyed by the version they upgrade FROM. Add entries when SAVE_VERSION bumps. */
const MIGRATIONS: Record<number, (saved: any) => any> = {
  // v2 -> v3: models gain a run sheet (filled in by backfillTraining), FLOP-active params, quirks and an inference
  // multiplier. In-flight runs get their v3 fields from backfillTraining, which needs the loaded state.
  2: (saved) => {
    if (Array.isArray(saved.models)) {
      for (const m of saved.models) {
        if (typeof m !== 'object' || m === null) continue;
        if (m.activeParamsB === undefined) m.activeParamsB = m.paramsB;
        if (m.quirks === undefined) m.quirks = [];
        if (m.inferenceMult === undefined) m.inferenceMult = 1;
      }
    }
    return saved;
  },
  // v3 -> v4: the lab notebook (fog of training). Filled from the existing models so the record is not empty.
  // Old models keep no latent quirks and no vibes: they predate the fog.
  3: (saved) => {
    const models: any[] = Array.isArray(saved.models) ? saved.models : [];
    const runsByArch: Record<string, number> = {};
    let largestFlops = 0;
    for (const m of models) {
      if (typeof m !== "object" || m === null || m.specId) continue;
      const arch = m.config?.arch ?? "dense";
      runsByArch[arch] = (runsByArch[arch] ?? 0) + 1;
      largestFlops = Math.max(largestFlops, 6 * (m.activeParamsB ?? m.paramsB ?? 0) * 1e9 * (m.tokensB ?? 0) * 1e9);
    }
    saved.lab ??= { runsByArch, largestFlops, sweeps: {}, discoveries: {}, verifiedData: [], lrOffsets: {}, emergenceJitter: {}, forecastErrors: [] };
    return saved;
  },
};

// ---------------------------------------------------------------------------
// Storage plumbing
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // blocked storage, private windows, node tests
  }
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Fill fields missing from `saved` with defaults from `base`; saved values win everywhere else. */
function merge(base: any, saved: any, path: string): any {
  if (saved === undefined || saved === null) return base;
  if (!isObj(base) || !isObj(saved) || RECORD_PATHS.has(path)) return saved;
  const out: Record<string, any> = {};
  for (const k of Object.keys(base)) out[k] = merge(base[k], saved[k], path ? `${path}.${k}` : k);
  for (const k of Object.keys(saved)) if (!(k in out)) out[k] = saved[k];
  return out;
}

function migrate(saved: any): any {
  let v = typeof saved.saveVersion === 'number' ? saved.saveVersion : 0;
  while (v < SAVE_VERSION && MIGRATIONS[v]) {
    saved = MIGRATIONS[v](saved);
    v += 1;
  }
  saved.saveVersion = SAVE_VERSION;
  return saved;
}

/** Quota exhaustion is reported as 'quota'; anything else (blocked storage, a broken browser) as 'blocked'. */
function classify(e: unknown): 'quota' | 'blocked' {
  const name = (e as { name?: unknown } | null)?.name;
  const code = (e as { code?: unknown } | null)?.code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014 ? 'quota' : 'blocked';
}

/** Write one value. Returns the error kind, or null on success. */
function put(ls: Storage, key: string, value: string): SaveError | null {
  try {
    ls.setItem(key, value);
    return null;
  } catch (e) {
    return classify(e);
  }
}

function read(ls: Storage, key: string): string | null {
  try {
    return ls.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(ls: Storage, key: string): void {
  try {
    ls.removeItem(key);
  } catch {
    // ignore
  }
}

function slotKey(id: string): string {
  return SLOT_KEY_PREFIX + id;
}

function newSlotId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar 2019" for the in-game day. */
function dateLabelOf(day: number): string {
  const d = dayToDate(day);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const MAX_NAME = 40;
function cleanName(name: string | undefined, fallback: string): string {
  const t = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  return t || fallback;
}

// ---------------------------------------------------------------------------
// Reading and turning saved JSON into a live state
// ---------------------------------------------------------------------------

/** Version gate, migrations, defaults and backfills. Null when the data is unusable or from a newer build. */
function toState(saved: unknown): GameState | null {
  if (!isObj(saved)) return null;
  if (typeof saved.saveVersion === 'number' && saved.saveVersion > SAVE_VERSION) return null; // from a newer build
  try {
    const seed = typeof saved.seed === 'number' ? saved.seed : undefined;
    const name = typeof saved.company?.name === 'string' ? saved.company.name : undefined;
    const base = createInitialState(seed, name);
    const out = merge(base, migrate(saved), '') as GameState;
    backfillCapabilities(out); // v1 saves: caps, lineage, context window and benchmark results from scores
    backfillTraining(out); // v2 saves: run sheets, active params, quirks, run incident fields
    return out;
  } catch {
    return null;
  }
}

function parseStored(raw: string): GameState | null {
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null; // corrupt save
  }
  return toState(saved);
}

/** Minimum shape of a game, so an export with an empty `state` is not taken for a save. */
function looksLikeState(v: unknown): boolean {
  return isObj(v) && isObj(v.company) && typeof v.company.name === 'string' && typeof v.day === 'number' && isObj(v.finance);
}

function normMeta(v: unknown): SlotMeta | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id === '') return null;
  const str = (x: unknown, d: string) => (typeof x === 'string' ? x : d);
  const num = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
  const meta: SlotMeta = {
    id: v.id,
    name: str(v.name, 'Saved game'),
    company: str(v.company, ''),
    day: num(v.day, 0),
    dateLabel: str(v.dateLabel, ''),
    valuation: num(v.valuation, 0),
    cash: num(v.cash, 0),
    savedAt: num(v.savedAt, 0),
    auto: v.auto !== false,
  };
  if (typeof v.scenarioId === 'string') meta.scenarioId = v.scenarioId;
  if (typeof v.difficulty === 'string') meta.difficulty = v.difficulty;
  return meta;
}

function readIndexFrom(ls: Storage): SlotMeta[] {
  const raw = read(ls, SLOTS_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: SlotMeta[] = [];
    for (const item of v) {
      const m = normMeta(item);
      if (m) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

function metaFor(s: GameState, id: string, name: string, auto: boolean): SlotMeta {
  return {
    id,
    name,
    company: s.company.name,
    day: s.day,
    dateLabel: dateLabelOf(s.day),
    scenarioId: s.setup?.scenarioId,
    difficulty: s.setup?.difficulty,
    valuation: Math.round(s.finance.valuation),
    cash: Math.round(s.finance.cash),
    savedAt: Date.now(),
    auto,
  };
}

/**
 * One-time move from the single save into a slot that becomes active. Runs before every entry point, so no write
 * can create a slot next to a legacy save that would then be hidden. The legacy key is removed only after the
 * move reads back correctly. A corrupt or newer legacy save is left where it is.
 */
function migrateLegacy(ls: Storage): void {
  const raw = read(ls, SAVE_KEY);
  if (raw === null) return;
  if (readIndexFrom(ls).length > 0) return;
  const s = parseStored(raw);
  if (!s) return;
  const id = newSlotId();
  const meta = metaFor(s, id, cleanName(s.company.name, 'Lets Loose Labs'), true);
  const wrote =
    put(ls, slotKey(id), raw) === null && put(ls, SLOTS_KEY, JSON.stringify([meta])) === null && put(ls, ACTIVE_SLOT_KEY, id) === null;
  if (!wrote) {
    safeRemove(ls, slotKey(id));
    safeRemove(ls, SLOTS_KEY);
    safeRemove(ls, ACTIVE_SLOT_KEY);
    return;
  }
  const confirmed = read(ls, slotKey(id)) === raw && readIndexFrom(ls).some((m) => m.id === id) && read(ls, ACTIVE_SLOT_KEY) === id;
  if (confirmed) safeRemove(ls, SAVE_KEY);
}

/** Storage with the legacy save moved over, or null when storage is unavailable. */
function openStore(): Storage | null {
  const ls = storage();
  if (ls) migrateLegacy(ls);
  return ls;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** All saved games, in index order. */
export function listSlots(): SlotMeta[] {
  const ls = openStore();
  return ls ? readIndexFrom(ls) : [];
}

/** The id of the slot autosave writes to, or null. Only an id that is in the index counts. */
export function getActiveSlotId(): string | null {
  const ls = openStore();
  if (!ls) return null;
  const id = read(ls, ACTIVE_SLOT_KEY);
  if (!id) return null;
  return readIndexFrom(ls).some((m) => m.id === id) ? id : null;
}

/**
 * Point autosave at a slot (null = none). Callers switch games only after this succeeds: if the pointer is not
 * written, autosave would write one game's progress into another game's slot.
 */
export function setActiveSlotId(id: string | null): SaveResult {
  const ls = openStore();
  if (!ls) return { ok: false, error: 'blocked' };
  if (id === null) {
    safeRemove(ls, ACTIVE_SLOT_KEY);
    return { ok: true };
  }
  const err = put(ls, ACTIVE_SLOT_KEY, id);
  return err ? { ok: false, error: err } : { ok: true };
}

/** Write a game under `id`. A new id adds a slot (refused when all slots are used). Existing slots keep their name unless one is given. */
function commit(s: GameState, id: string, name: string | undefined, auto: boolean | undefined): SaveResult {
  const ls = openStore();
  if (!ls) return { ok: false, error: 'blocked' };
  const index = readIndexFrom(ls);
  const at = index.findIndex((m) => m.id === id);
  if (at < 0 && index.length >= MAX_SLOTS) return { ok: false, error: 'full' };
  const prev = at >= 0 ? index[at] : undefined;
  let json: string;
  try {
    json = JSON.stringify(s);
  } catch {
    return { ok: false, error: 'blocked' };
  }
  const meta = metaFor(s, id, cleanName(name ?? prev?.name, s.company.name), auto ?? prev?.auto ?? true);
  // Data first, then the index. If the index write fails, a new slot's data is removed again so nothing is orphaned.
  const dataErr = put(ls, slotKey(id), json);
  if (dataErr) return { ok: false, error: dataErr };
  const next = at >= 0 ? index.map((m, i) => (i === at ? meta : m)) : [...index, meta];
  const indexErr = put(ls, SLOTS_KEY, JSON.stringify(next));
  if (indexErr) {
    if (at < 0) safeRemove(ls, slotKey(id));
    return { ok: false, error: indexErr };
  }
  return { ok: true };
}

/** Write a game into an existing slot (or a new one with that id). */
export function saveToSlot(s: GameState, id: string, name?: string): SaveResult {
  return commit(s, id, name, undefined);
}

/**
 * Add a slot for a game. It does not become active: the caller decides. `auto` true marks a game's own slot,
 * false a manual snapshot or an import.
 */
export function createSlot(s: GameState, name?: string, auto = true): CreateResult {
  const id = newSlotId();
  const r = commit(s, id, name, auto);
  return r.ok ? { ok: true, id } : r;
}

/** Autosave target: write the game to the active slot, creating one when there is none. */
export function saveActive(s: GameState): SaveResult {
  const id = getActiveSlotId();
  if (id) return saveToSlot(s, id);
  const r = createSlot(s);
  if (!r.ok) return r;
  const a = setActiveSlotId(r.id);
  if (!a.ok) {
    deleteSlot(r.id); // a slot autosave cannot find would be duplicated on every save
    return a;
  }
  return { ok: true };
}

/** Load a slot through the migrate, merge and backfill path. Null when it is missing, corrupt or from a newer build. */
export function loadSlot(id: string): GameState | null {
  const ls = openStore();
  if (!ls) return null;
  const raw = read(ls, slotKey(id));
  if (!raw) return null;
  return parseStored(raw);
}

/** The newest slot that opens, made active. Used at startup when the active slot cannot be read. */
export function loadNewestReadable(): GameState | null {
  const newest = listSlots().sort((a, b) => b.savedAt - a.savedAt);
  for (const m of newest) {
    const s = loadSlot(m.id);
    if (s && setActiveSlotId(m.id).ok) return s;
  }
  return null;
}

/** Delete a slot. Deleting the active slot leaves the running game as it is; it is unsaved until the next autosave. */
export function deleteSlot(id: string): void {
  const ls = openStore();
  if (!ls) return;
  safeRemove(ls, slotKey(id));
  const index = readIndexFrom(ls);
  if (index.some((m) => m.id === id)) put(ls, SLOTS_KEY, JSON.stringify(index.filter((m) => m.id !== id)));
  if (read(ls, ACTIVE_SLOT_KEY) === id) safeRemove(ls, ACTIVE_SLOT_KEY);
}

/** Rename a slot. Returns false when the slot is missing or the write fails. */
export function renameSlot(id: string, name: string): boolean {
  const ls = openStore();
  if (!ls) return false;
  const index = readIndexFrom(ls);
  const at = index.findIndex((m) => m.id === id);
  if (at < 0) return false;
  const next = index.map((m, i) => (i === at ? { ...m, name: cleanName(name, m.company || 'Saved game') } : m));
  return put(ls, SLOTS_KEY, JSON.stringify(next)) === null;
}

/**
 * The slot as a downloadable file: a small header, then the state exactly as stored.
 * Null when the slot is missing or its data does not parse.
 */
export function exportSlot(id: string): string | null {
  const ls = openStore();
  if (!ls) return null;
  const meta = readIndexFrom(ls).find((m) => m.id === id);
  const raw = read(ls, slotKey(id));
  if (!meta || raw === null) return null;
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(raw);
  } catch {
    return null;
  }
  const version = typeof state.saveVersion === 'number' ? state.saveVersion : SAVE_VERSION;
  return `{"format":${JSON.stringify(EXPORT_FORMAT)},"version":${version},"meta":${JSON.stringify(meta)},"state":${raw}}`;
}

/**
 * Read an export back in as a new snapshot slot (it does not become active). Rejects files that are not saves from
 * this game, and saves from a newer build.
 */
export function importSave(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!isObj(doc) || doc.format !== EXPORT_FORMAT || !isObj(doc.state)) return { ok: false, error: 'invalid' };
  const headerVersion = typeof doc.version === 'number' ? doc.version : undefined;
  const stateVersion = typeof doc.state.saveVersion === 'number' ? doc.state.saveVersion : undefined;
  if ((headerVersion ?? 0) > SAVE_VERSION || (stateVersion ?? 0) > SAVE_VERSION) return { ok: false, error: 'newer' };
  if (!looksLikeState(doc.state)) return { ok: false, error: 'invalid' };
  const s = toState(doc.state);
  if (!s) return { ok: false, error: 'invalid' };
  const name = isObj(doc.meta) && typeof doc.meta.name === 'string' ? doc.meta.name : undefined;
  const r = createSlot(s, name, false);
  return r.ok ? { ok: true, id: r.id } : r;
}

/** Characters stored across the whole origin, counted at 2 bytes each (UTF-16). Compare with about 5 MB. */
export function storageBytes(): number {
  const ls = storage();
  if (!ls) return 0;
  let chars = 0;
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k === null) continue;
      chars += k.length + (ls.getItem(k)?.length ?? 0);
    }
  } catch {
    return 0;
  }
  return chars * 2;
}

// ---------------------------------------------------------------------------
// Single-save wrappers (the active slot)
// ---------------------------------------------------------------------------

export function saveGame(s: GameState): void {
  saveActive(s); // quota or storage disabled: the game keeps running without a save
}

export function loadGame(): GameState | null {
  const id = getActiveSlotId();
  return id ? loadSlot(id) : null;
}

export function hasSave(): boolean {
  return getActiveSlotId() !== null;
}

export function deleteSave(): void {
  const id = getActiveSlotId();
  if (id) deleteSlot(id);
}
