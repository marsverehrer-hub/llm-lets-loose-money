// Save slots: migration from the single save, create/list/load/rename/delete, export and import, storage errors,
// the slot cap, and the store-level behaviour that a new game keeps the old one.
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, SAVE_VERSION } from '../src/sim/state';
import {
  ACTIVE_SLOT_KEY,
  EXPORT_FORMAT,
  MAX_SLOTS,
  SAVE_KEY,
  SLOT_KEY_PREFIX,
  createSlot,
  deleteSlot,
  exportSlot,
  getActiveSlotId,
  hasSave,
  importSave,
  listSlots,
  loadGame,
  loadSlot,
  renameSlot,
  saveActive,
  saveGame,
  saveToSlot,
  setActiveSlotId,
  storageBytes,
} from '../src/sim/save';

const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** In-memory localStorage. `quota` makes every write throw a quota error, as a full browser does. */
function installStorage(quota = false) {
  const data = new Map<string, string>();
  const mock = {
    quota,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem(k: string, v: string) {
      if (mock.quota) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      data.set(k, String(v));
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
  return { data, mock };
}

/** No localStorage at all, like a browser with storage blocked. */
function blockStorage() {
  delete (globalThis as any).localStorage;
}

afterEach(() => {
  if (realDescriptor) Object.defineProperty(globalThis, 'localStorage', realDescriptor);
  else delete (globalThis as any).localStorage;
});

describe('migration from the single save', () => {
  it('moves the legacy save into a slot named after the company, made active, and removes the legacy key', () => {
    const { data } = installStorage();
    const s = createInitialState(21, 'Legacy Labs');
    s.day = 412;
    data.set(SAVE_KEY, JSON.stringify(s));

    const slots = listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe('Legacy Labs');
    expect(slots[0].company).toBe('Legacy Labs');
    expect(slots[0].auto).toBe(true);
    expect(slots[0].day).toBe(412);
    expect(getActiveSlotId()).toBe(slots[0].id);
    expect(data.has(SAVE_KEY)).toBe(false);
    expect(loadGame()!.day).toBe(412);
    expect(hasSave()).toBe(true);
  });

  it('leaves a corrupt legacy save where it is', () => {
    const { data } = installStorage();
    data.set(SAVE_KEY, '{not json');
    expect(listSlots()).toEqual([]);
    expect(data.get(SAVE_KEY)).toBe('{not json');
  });

  it('does not migrate when slots already exist', () => {
    const { data } = installStorage();
    createSlot(createInitialState(3, 'Slotted'));
    data.set(SAVE_KEY, JSON.stringify(createInitialState(4, 'Legacy')));
    expect(listSlots().map((m) => m.name)).toEqual(['Slotted']);
    expect(data.has(SAVE_KEY)).toBe(true);
  });
});

describe('create, list, load, rename, delete', () => {
  it('creates slots that do not become active, then lists, loads, renames and deletes them', () => {
    installStorage();
    const a = createSlot(createInitialState(1, 'Alpha'));
    const b = createSlot(createInitialState(2, 'Beta'), undefined, false);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(listSlots().map((m) => m.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(getActiveSlotId()).toBeNull();
    expect(listSlots().find((m) => m.id === b.id)!.auto).toBe(false);

    setActiveSlotId(a.id);
    expect(getActiveSlotId()).toBe(a.id);
    expect(loadSlot(b.id)!.company.name).toBe('Beta');

    expect(renameSlot(b.id, '  Gamma   Two ')).toBe(true);
    expect(listSlots().find((m) => m.id === b.id)!.name).toBe('Gamma Two');
    renameSlot(b.id, '   ');
    expect(listSlots().find((m) => m.id === b.id)!.name).toBe('Beta');
    expect(renameSlot('nope', 'x')).toBe(false);

    deleteSlot(a.id);
    expect(listSlots().map((m) => m.id)).toEqual([b.id]);
    expect(loadSlot(a.id)).toBeNull();
    expect(getActiveSlotId()).toBeNull(); // the active slot was the one deleted
  });

  it('saveActive writes to the active slot and creates one when there is none', () => {
    installStorage();
    const first = createInitialState(7, 'Autosaved');
    expect(saveActive(first)).toEqual({ ok: true });
    expect(listSlots()).toHaveLength(1);
    const id = getActiveSlotId();
    expect(id).not.toBeNull();

    const later = createInitialState(7, 'Autosaved');
    later.day = 90;
    expect(saveActive(later)).toEqual({ ok: true });
    expect(listSlots()).toHaveLength(1);
    expect(getActiveSlotId()).toBe(id);
    expect(loadSlot(id!)!.day).toBe(90);
  });

  it('keeps the legacy wrappers working over the active slot', () => {
    installStorage();
    const s = createInitialState(9, 'Wrapped');
    s.day = 33;
    saveGame(s);
    expect(hasSave()).toBe(true);
    expect(loadGame()!.company.name).toBe('Wrapped');
    expect(loadSlot(getActiveSlotId()!)).toEqual(loadGame());
  });

  it('loads back the same state that was saved, with defaults filled in', () => {
    installStorage();
    const s = createInitialState(11, 'Round Trip');
    s.day = 640;
    const r = createSlot(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(loadSlot(r.id)).toEqual(JSON.parse(JSON.stringify(s)));
  });
});

describe('export and import', () => {
  it('a round trip through a file preserves the state, and the import is a snapshot that does not switch games', () => {
    installStorage();
    const s = createInitialState(33, 'Export Co');
    s.day = 500;
    const r = createSlot(s, 'Export Co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const text = exportSlot(r.id)!;
    const header = JSON.parse(text);
    expect(header.format).toBe(EXPORT_FORMAT);
    expect(header.meta.company).toBe('Export Co');

    const imported = importSave(text);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(loadSlot(imported.id)).toEqual(loadSlot(r.id));
    expect(loadSlot(imported.id)).toEqual(JSON.parse(JSON.stringify(s)));
    expect(listSlots().find((m) => m.id === imported.id)!.auto).toBe(false);
    expect(getActiveSlotId()).toBeNull();
  });

  it('exportSlot returns null for a missing slot', () => {
    installStorage();
    expect(exportSlot('missing')).toBeNull();
  });

  it('rejects garbage and leaves the slots alone', () => {
    installStorage();
    const r = createSlot(createInitialState(40, 'Only'));
    expect(r.ok).toBe(true);
    const before = listSlots().length;
    expect(importSave('not json')).toEqual({ ok: false, error: 'invalid' });
    expect(importSave('{"hello":1}')).toEqual({ ok: false, error: 'invalid' });
    expect(importSave(JSON.stringify({ format: EXPORT_FORMAT, version: 4, meta: {}, state: {} }))).toEqual({ ok: false, error: 'invalid' });
    expect(importSave(JSON.stringify({ format: 'something-else', state: createInitialState(1) }))).toEqual({ ok: false, error: 'invalid' });
    expect(listSlots()).toHaveLength(before);
  });

  it('rejects saves from a newer build, from the header or the state', () => {
    installStorage();
    const r = createSlot(createInitialState(41, 'Future'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = JSON.parse(exportSlot(r.id)!);

    const newerHeader = { ...doc, version: SAVE_VERSION + 1 };
    expect(importSave(JSON.stringify(newerHeader))).toEqual({ ok: false, error: 'newer' });

    const newerState = { ...doc, state: { ...doc.state, saveVersion: SAVE_VERSION + 1 } };
    expect(importSave(JSON.stringify(newerState))).toEqual({ ok: false, error: 'newer' });
  });
});

describe('storage errors', () => {
  it('quota errors are reported as results, never thrown, and the saved data survives', () => {
    const { mock } = installStorage();
    const kept = createSlot(createInitialState(50, 'Keep'));
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;

    mock.quota = true;
    const next = createInitialState(51, 'Changed');
    expect(() => saveToSlot(next, kept.id)).not.toThrow();
    expect(saveToSlot(next, kept.id)).toEqual({ ok: false, error: 'quota' });
    expect(createSlot(next)).toEqual({ ok: false, error: 'quota' });
    expect(saveActive(next)).toEqual({ ok: false, error: 'quota' });
    expect(() => saveGame(next)).not.toThrow();

    mock.quota = false;
    expect(loadSlot(kept.id)!.company.name).toBe('Keep');
    expect(listSlots()).toHaveLength(1);
  });

  it('reports blocked storage and keeps the game running without it', () => {
    blockStorage();
    const s = createInitialState(60, 'Nowhere');
    expect(saveToSlot(s, 'x')).toEqual({ ok: false, error: 'blocked' });
    expect(createSlot(s)).toEqual({ ok: false, error: 'blocked' });
    expect(() => saveGame(s)).not.toThrow();
    expect(listSlots()).toEqual([]);
    expect(loadGame()).toBeNull();
    expect(hasSave()).toBe(false);
    expect(storageBytes()).toBe(0);
  });

  it('counts the bytes stored across the origin', () => {
    const { data } = installStorage();
    data.set('abc', 'defg'); // 3 + 4 characters, two bytes each
    expect(storageBytes()).toBe(14);
  });
});

describe('the slot cap', () => {
  it(`allows ${MAX_SLOTS} slots and refuses a new one after that, but still updates an existing slot`, () => {
    installStorage();
    const ids: string[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const r = createSlot(createInitialState(100 + i, `Co ${i}`));
      expect(r.ok).toBe(true);
      if (r.ok) ids.push(r.id);
    }
    expect(listSlots()).toHaveLength(MAX_SLOTS);
    expect(createSlot(createInitialState(999))).toEqual({ ok: false, error: 'full' });
    expect(saveToSlot(createInitialState(101, 'Co 0 again'), ids[0])).toEqual({ ok: true });
    expect(loadSlot(ids[0])!.company.name).toBe('Co 0 again');
  });
});

describe('store: new game keeps the old one', () => {
  it('newGame creates a slot and makes it active; the previous game stays loadable', async () => {
    installStorage();
    const store = await import('../src/ui/store');

    expect(store.newGame('First Co', 5)).toEqual({ ok: true });
    const firstId = getActiveSlotId();
    expect(firstId).not.toBeNull();

    expect(store.newGame('Second Co', 6)).toEqual({ ok: true });
    const secondId = getActiveSlotId();
    expect(secondId).not.toBe(firstId);
    expect(listSlots()).toHaveLength(2);
    expect(loadSlot(firstId!)!.company.name).toBe('First Co');
    expect(store.getState().company.name).toBe('Second Co');

    // switch back to the first game: the second is saved first, so nothing is lost
    expect(store.loadSlotIntoGame(firstId!)).toEqual({ ok: true });
    expect(store.getState().company.name).toBe('First Co');
    expect(getActiveSlotId()).toBe(firstId);
    expect(loadSlot(secondId!)!.company.name).toBe('Second Co');

    // a snapshot keeps the live game without switching to it
    const snap = store.saveAsNew('Snapshot');
    expect(snap.ok).toBe(true);
    expect(getActiveSlotId()).toBe(firstId);
    expect(listSlots()).toHaveLength(3);
  });

  it('switching games with unsaved progress asks first, and never switches without the active pointer', async () => {
    const { mock } = installStorage();
    const store = await import('../src/ui/store');
    store.newGame('Keeper', 7);
    const keeperId = getActiveSlotId()!;
    store.newGame('Other', 8);
    const otherId = getActiveSlotId();

    mock.quota = true;
    // the current game cannot be saved, so the player has to confirm losing it
    expect(store.loadSlotIntoGame(keeperId)).toEqual({ ok: false, error: 'unsaved' });
    expect(store.getState().company.name).toBe('Other');
    // even when they confirm, the switch is refused if the active pointer cannot be written: autosave would
    // otherwise write this game into the other game's slot
    expect(store.loadSlotIntoGame(keeperId, { discardUnsaved: true })).toEqual({ ok: false, error: 'quota' });
    expect(store.getState().company.name).toBe('Other');
    expect(getActiveSlotId()).toBe(otherId);

    mock.quota = false;
    expect(store.loadSlotIntoGame(keeperId, { discardUnsaved: true })).toEqual({ ok: true });
    expect(store.getState().company.name).toBe('Keeper');
    expect(getActiveSlotId()).toBe(keeperId);
    expect(loadSlot(otherId!)!.company.name).toBe('Other');
    expect(store.loadSlotIntoGame('no-such-slot')).toEqual({ ok: false, error: 'missing' });
    expect((globalThis as any).__llm.saves.list).toBeTypeOf('function');
  });

  it('after deleting the active slot, the next autosave makes a fresh slot', async () => {
    installStorage();
    const store = await import('../src/ui/store');
    store.newGame('Doomed', 9);
    const id = getActiveSlotId()!;
    deleteSlot(id);
    expect(getActiveSlotId()).toBeNull();
    expect(store.saveNow()).toEqual({ ok: true });
    expect(getActiveSlotId()).not.toBeNull();
    expect(getActiveSlotId()).not.toBe(id);
    expect(listSlots().map((m) => m.name)).toEqual(['Doomed']);
  });
});
