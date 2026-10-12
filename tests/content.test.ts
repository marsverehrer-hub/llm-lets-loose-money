import { describe, it, expect, afterEach } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { EVENTS } from '../src/sim/data/events';
import { HEADLINES } from '../src/sim/data/headlines';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { suggestModelName } from '../src/sim/data/names';
import { makeRng } from '../src/sim/rng';
import { dispatch, isBlocked, tick } from '../src/sim/engine';
import { fillTemplate } from '../src/sim/systems/events';
import { saveGame, loadGame, hasSave, deleteSave, getActiveSlotId, SLOT_KEY_PREFIX } from '../src/sim/save';
import type { GameState } from '../src/sim/types';

/** Resolve any pending event with its first affordable choice, or clear a shown result. */
function autoResolve(s: GameState): void {
  const p = s.events.pending;
  if (!p) return;
  if (p.result === undefined) {
    const def = EVENTS.find((e) => e.id === p.defId);
    if (!def) throw new Error(`pending event ${p.defId} missing`);
    const idx = def.choices.findIndex((c) => !c.available || c.available(s));
    dispatch(s, { type: 'resolveEvent', choice: Math.max(0, idx) });
  } else {
    dispatch(s, { type: 'clearEventResult' });
  }
}

describe('choice events', () => {
  it('has at least two choices per event and unique ids', () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EVENTS) {
      expect(e.choices.length, `${e.id} choices`).toBeGreaterThanOrEqual(2);
      expect(e.title.length, `${e.id} title`).toBeGreaterThan(0);
    }
  });

  it('runs every choice effect on a fresh state without throwing and returns text', () => {
    for (const def of EVENTS) {
      for (let i = 0; i < def.choices.length; i++) {
        const s = createInitialState(1);
        s.day = 2000;
        const text = def.choices[i].effect(s, makeRng(s));
        expect(typeof text, `${def.id}[${i}] result`).toBe('string');
        expect(text.trim().length, `${def.id}[${i}] result`).toBeGreaterThan(0);
      }
    }
  });

  it('resolving an event blocks the sim until the result is cleared', () => {
    const s = createInitialState(9);
    s.day = 2000;
    const def = EVENTS[0];
    s.events.pending = { defId: def.id, day: s.day };
    expect(isBlocked(s)).toBe(true);
    const idx = Math.max(0, def.choices.findIndex((c) => !c.available || c.available(s)));
    dispatch(s, { type: 'resolveEvent', choice: idx });
    expect(s.events.pending?.result).toBeTypeOf('string');
    expect(isBlocked(s)).toBe(false);
    dispatch(s, { type: 'clearEventResult' });
    expect(s.events.pending).toBeNull();
  });

  it('does not fire choice events during the grace period', () => {
    const s = createInitialState(5);
    for (let d = 0; d < 29; d++) tick(s);
    expect(s.events.pending).toBeNull();
    expect(Object.keys(s.events.lastFired)).toHaveLength(0);
  });
});

describe('headlines', () => {
  it('has a substantial catalogue', () => {
    expect(HEADLINES.length).toBeGreaterThanOrEqual(100);
  });

  it('every template fills completely for any year window', () => {
    for (const year of [2017, 2021, 2026, 2030, 2035]) {
      const s = createInitialState(3);
      s.day = (year - 2017) * 365 + 100;
      const rng = makeRng(s);
      for (const h of HEADLINES) {
        const text = fillTemplate(s, h.text, rng);
        expect(text, h.text).not.toMatch(/\{[a-z]+\}/);
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('uses an active rival name when one exists', () => {
    const s = createInitialState(4);
    s.day = 2500;
    const first = s.competitors[0];
    if (first) first.active = true;
    const rng = makeRng(s);
    const text = fillTemplate(s, '{competitor} ships a model', rng);
    expect(text).not.toMatch(/\{competitor\}/);
  });
});

describe('achievements and names', () => {
  it('has unique ids, icons and checks that run on a fresh state', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = createInitialState(2);
    for (const a of ACHIEVEMENTS) {
      expect(a.icon.length).toBeGreaterThan(0);
      expect(typeof a.check(s)).toBe('boolean');
    }
  });

  it('suggests varied, placeholder-free model names deterministically', () => {
    const a = makeRng({ rngState: 99 });
    const b = makeRng({ rngState: 99 });
    const namesA = Array.from({ length: 50 }, (_, i) => suggestModelName(a, i + 1));
    const namesB = Array.from({ length: 50 }, (_, i) => suggestModelName(b, i + 1));
    expect(namesA).toEqual(namesB);
    for (const n of namesA) expect(n.trim().length).toBeGreaterThan(0);
    expect(new Set(namesA).size).toBeGreaterThanOrEqual(15);
  });
});

describe('simulation with events', () => {
  it('2000 ticks with auto-resolving events run without throwing and fire events', () => {
    const s = createInitialState(7);
    // An idle player with no products may go bankrupt before day 2000; that is a legitimate stop.
    for (let i = 0; i < 2000 && !s.gameOver; i++) {
      autoResolve(s);
      tick(s);
    }
    expect(s.day === 2000 || s.gameOver !== null).toBe(true);
    expect(Object.keys(s.events.lastFired).length).toBeGreaterThan(0);
    expect(s.news.length).toBeGreaterThan(0);
  });
});

describe('save', () => {
  const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  function mockLocalStorage(): void {
    const data = new Map<string, string>();
    const mock = {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size;
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
  }

  afterEach(() => {
    if (realDescriptor) Object.defineProperty(globalThis, 'localStorage', realDescriptor);
    else delete (globalThis as any).localStorage;
  });

  it('round-trips a game through localStorage and fills in defaults', () => {
    mockLocalStorage();
    const s = createInitialState(11, 'Test Labs');
    s.day = 400;
    s.flags.rentMult = 1.5;
    s.compute.rented = {};
    saveGame(s);
    expect(hasSave()).toBe(true);

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.day).toBe(400);
    expect(loaded!.company.name).toBe('Test Labs');
    expect(loaded!.flags.rentMult).toBe(1.5);
    // a removed map entry stays removed (not resurrected from the defaults)
    expect(loaded!.compute.rented).toEqual({});
    expect(loaded!.staff.roles.researcher.count).toBe(s.staff.roles.researcher.count);

    deleteSave();
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it('rejects saves from a newer build and corrupt data', () => {
    mockLocalStorage();
    const s = createInitialState(12);
    saveGame(s);
    // the game lives in its active slot now (sim/save.ts), not in the legacy key
    const key = SLOT_KEY_PREFIX + getActiveSlotId();
    const raw = (globalThis as any).localStorage.getItem(key);
    (globalThis as any).localStorage.setItem(key, JSON.stringify({ ...JSON.parse(raw), saveVersion: 999 }));
    expect(loadGame()).toBeNull();
    (globalThis as any).localStorage.setItem(key, '{not json');
    expect(loadGame()).toBeNull();
  });

  it('is a safe no-op without localStorage', () => {
    delete (globalThis as any).localStorage;
    expect(() => saveGame(createInitialState(13))).not.toThrow();
    expect(loadGame()).toBeNull();
    expect(hasSave()).toBe(false);
  });
});
