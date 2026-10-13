import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameAction, GameSetup, GameState, Speed } from '../sim/types';
import { createInitialState } from '../sim/state';
import { dispatch as simDispatch, isBlocked, tick } from '../sim/engine';
import {
  createSlot,
  deleteSlot,
  getActiveSlotId,
  listSlots,
  loadGame,
  loadNewestReadable,
  loadSlot,
  renameSlot as renameSlotInSave,
  saveActive,
  setActiveSlotId,
  type CreateResult,
  type SaveError,
  type SaveResult,
} from '../sim/save';
import { loadMp, saveMp } from '../net/mpSave';
import { formatDate, notify } from '../sim/util';
import { autoPauseCheck } from './autopause';
import { navigate } from './nav';
import { saveMessage } from './saveText';

// ---------------------------------------------------------------------------
// Global game store. The sim mutates `state` in place; `version` bumps on every
// change so components re-render via useGame().
// ---------------------------------------------------------------------------

type Listener = () => void;

/** Reload into a live 1v1 match if one was saved (it comes back paused until the net layer reconnects). */
const mpAtStart = loadMp();
/** The game to open: the match, else the active save, else the newest save that still opens. */
let initial: GameState | null = mpAtStart ?? loadGame();
if (!initial && !mpAtStart) initial = loadNewestReadable();
/** True on a first visit (no saves at all), so the new-game setup screen opens first. */
export const FIRST_RUN = initial === null && listSlots().length === 0;
let state: GameState = initial ?? createInitialState();
// Saves exist but none opens (corrupt, or from a newer build). Leave them untouched: the next autosave starts a fresh slot.
if (initial === null && !FIRST_RUN) setActiveSlotId(null);
let version = 0;
const listeners = new Set<Listener>();
const AUTOSAVE_EVERY_DAYS = 15;
/** The storage error last reported to the player. Autosave only reports a change, not every day. */
let saveFault: SaveError | null = null;

function emit() {
  version++;
  for (const l of listeners) l();
}

/** Re-render subscribers without changing the state (e.g. after UI-only flags change). */
export function refresh(): void {
  emit();
}

/** Autosave target: the MP save while a match is live, otherwise the active slot. A new storage error is logged once. */
function persist(s: GameState): SaveResult | null {
  if (s.mp) {
    saveMp(s);
    return null;
  }
  const r = saveActive(s);
  if (r.ok) saveFault = null;
  else if (saveFault !== r.error) {
    saveFault = r.error;
    notify(s, saveMessage(r.error), 'bad');
  }
  return r;
}

// Each part of the UI that holds draft state for the current game registers here, so a different game starts clean.
const swapHooks = new Set<() => void>();

/** Run `cb` whenever a different game takes over (a new game or a loaded save). Returns the unsubscribe. */
export function onGameSwap(cb: () => void): () => void {
  swapHooks.add(cb);
  return () => {
    swapHooks.delete(cb);
  };
}

/** A different game is now live: reset what belonged to the old one and show HQ. */
function swapGame(): void {
  for (const h of swapHooks) h();
  navigate('dashboard');
}

/** Why a save, load or snapshot did not go through. */
export type StoreError = SaveError | 'match' | 'missing' | 'unreadable' | 'unsaved';
export type NewGameResult = { ok: true } | { ok: false; error: SaveError };
export type LoadResult = { ok: true } | { ok: false; error: StoreError };

export function getState(): GameState {
  return state;
}
export function getVersion(): number {
  return version;
}
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Send a player action into the sim. */
export function dispatch(action: GameAction): void {
  simDispatch(state, action);
  for (const h of afterDispatchHooks) h(state, action);
  emit();
}

/** Swap the live state (entering or leaving a multiplayer match). Does not persist anything. */
export function replaceState(next: GameState): void {
  state = next;
  acc = 0;
  last = performance.now();
  emit();
}

/**
 * A fresh game in a new slot, which becomes the active one. `setup` (v9) picks the scenario, difficulty, sandbox and
 * tutorial; omitted = the classic game. The game it replaces keeps its slot. When there is no room for another slot
 * or the write fails, the current game carries on and nothing changes.
 */
export function newGame(companyName?: string, seed?: number, setup?: GameSetup): NewGameResult {
  const next = createInitialState(seed, companyName, setup);
  // Keep the outgoing game's latest progress in its own slot. A game the player deleted is not saved again.
  if (!state.mp && getActiveSlotId()) saveActive(state);
  const r: CreateResult = createSlot(next);
  if (!r.ok && r.error !== 'blocked') return r;
  if (r.ok) {
    const a = setActiveSlotId(r.id);
    if (!a.ok) {
      deleteSlot(r.id); // not switched: the slot would not be found by autosave
      return a;
    }
  } else {
    // Storage blocked: play on without a slot, as before saves were slots.
    setActiveSlotId(null);
  }
  swapGame();
  replaceState(next);
  return { ok: true };
}

/** Save the live game now. A match saves to its own slot and always reports ok here. */
export function saveNow(): SaveResult {
  return persist(state) ?? { ok: true };
}

/** Keep a copy of the live game as its own slot. The active game does not change. */
export function saveAsNew(name?: string): { ok: true; id: string } | { ok: false; error: StoreError } {
  if (state.mp) return { ok: false, error: 'match' };
  return createSlot(state, name ?? `${state.company.name}, ${formatDate(state.day)}`, false);
}

/**
 * Make a saved game the live one. The current game is saved first. If that fails, the player has to confirm losing
 * its latest progress, which they do by passing `discardUnsaved`.
 */
export function loadSlotIntoGame(id: string, opts: { discardUnsaved?: boolean } = {}): LoadResult {
  if (state.mp) return { ok: false, error: 'match' };
  if (getActiveSlotId() === id) return { ok: true };
  const target = loadSlot(id);
  if (!target) return { ok: false, error: listSlots().some((m) => m.id === id) ? 'unreadable' : 'missing' };
  if (!opts.discardUnsaved) {
    const r = saveActive(state);
    if (!r.ok) return { ok: false, error: 'unsaved' };
  }
  const a = setActiveSlotId(id);
  if (!a.ok) return { ok: false, error: a.error };
  swapGame();
  replaceState(target);
  return { ok: true };
}

/** Rename a saved game. Does not touch the live state. */
export function renameSlot(id: string, name: string): boolean {
  return renameSlotInSave(id, name);
}

export function save(): void {
  persist(state);
}

/** Subscribe a component to the store; returns the live (mutable) state. Treat as read-only! */
export function useGame(): GameState {
  const [, setV] = useState(0);
  useEffect(() => subscribe(() => setV((v) => v + 1)), []);
  return state;
}

/**
 * Subscribe to a derived value. The component re-renders only when the selected value changes (by `eq`), not on
 * every simulated day. Use it for closed overlays and anything that only needs to know whether to show: the
 * component that uses it should not also call useGame(), or it will re-render every tick anyway.
 */
export function useGameSelect<T>(select: (s: GameState) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const selRef = useRef(select);
  const eqRef = useRef(eq);
  selRef.current = select;
  eqRef.current = eq;
  const [val, setVal] = useState<T>(() => select(state));
  const valRef = useRef(val);
  valRef.current = val;
  useEffect(() => {
    const check = () => {
      const next = selRef.current(state);
      if (!eqRef.current(valRef.current, next)) {
        valRef.current = next;
        setVal(() => next);
      }
    };
    check();
    return subscribe(check);
  }, []);
  return val;
}

/** Equality for selected arrays: same length and same element identity. */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Equality for small selected records: same keys with identical values. */
export function sameRecord<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Multiplayer hooks. The net layer (src/net/session.ts) plugs in here; the store knows nothing about the protocol.
// ---------------------------------------------------------------------------

type TickHook = (s: GameState) => void;
type DispatchHook = (s: GameState, a: GameAction) => void;
const afterTickHooks = new Set<TickHook>();
const afterDispatchHooks = new Set<DispatchHook>();
let tickGate: (() => boolean) | null = null;
let effectiveSpeedFn: ((s: GameState) => number) | null = null;

export function onAfterTick(cb: TickHook): () => void {
  afterTickHooks.add(cb);
  return () => {
    afterTickHooks.delete(cb);
  };
}
export function onAfterDispatch(cb: DispatchHook): () => void {
  afterDispatchHooks.add(cb);
  return () => {
    afterDispatchHooks.delete(cb);
  };
}
/** Extra permission to tick, checked before every day (lockstep, lobby). null = always allowed. */
export function setTickGate(fn: (() => boolean) | null): void {
  tickGate = fn;
}
/** Speed the loop should use instead of state.speed. null = state.speed. */
export function setEffectiveSpeed(fn: ((s: GameState) => number) | null): void {
  effectiveSpeedFn = fn;
}

/**
 * Hard rules for a multiplayer match, enforced even if the net layer is missing: no ticks while disconnected or
 * after a result. The tick gate adds lockstep on top.
 */
function mayTick(s: GameState): boolean {
  if (s.mp && (!s.mp.connected || s.mp.result)) return false;
  return tickGate ? tickGate() : true;
}

// ---------------------------------------------------------------------------
// Real-time loop. The speed setting (1 / 3 / 10, labelled 1× / 3× / 10×) maps to game days per real second.
// GAME_DESIGN §18.2 slowed the pace, and §23.4 (v13) slowed it again: 10× is 3 days a second, so a 20-year game is
// about 40 minutes at full speed instead of 24. Unlisted speeds fall back to speed × 0.33.
// ---------------------------------------------------------------------------
const DAYS_PER_SECOND: Partial<Record<Speed, number>> = { 1: 0.35, 3: 1, 10: 3 };
export function daysPerSecond(speed: number): number {
  return DAYS_PER_SECOND[speed as Speed] ?? speed * 0.33;
}

let acc = 0;
let last = performance.now();
const MAX_TICKS_PER_FRAME = 5;

/** Runs after each simulated day. If an enabled auto-pause trigger fired, logs why and stops the clock. True when it paused. */
function autoPauseAfterDay(s: GameState): boolean {
  const hit = autoPauseCheck(s);
  if (!hit) return false;
  notify(s, hit.text, hit.kind);
  dispatch({ type: 'setSpeed', speed: 0 });
  return true;
}

/** Last time an animation frame ran. A watchdog timer takes over when frames stop (hidden, minimised or occluded windows). */
let lastRaf = 0;
const WATCHDOG_MS = 200;
const STALL_MS = 400;

function rafLoop(now: number) {
  lastRaf = now;
  frame(now, 0.25);
  requestAnimationFrame(rafLoop);
}

/** Without frames the game would freeze, and in a match the rival would be left waiting. Timers are throttled to
 * ~1/s in the background, so the watchdog allows a bigger catch-up step. */
function watchdog() {
  const now = performance.now();
  if (now - lastRaf > STALL_MS) frame(now, 1.5);
}

function frame(now: number, maxDt: number) {
  const dt = Math.min(maxDt, Math.max(0, (now - last) / 1000));
  last = now;
  const speed = effectiveSpeedFn ? effectiveSpeedFn(state) : state.speed;
  if (speed > 0 && !isBlocked(state) && mayTick(state)) {
    acc += dt * daysPerSecond(speed);
    let n = 0;
    while (acc >= 1 && n < MAX_TICKS_PER_FRAME) {
      tick(state);
      acc -= 1;
      n++;
      for (const h of afterTickHooks) h(state);
      const paused = autoPauseAfterDay(state);
      if (state.day % AUTOSAVE_EVERY_DAYS === 0) persist(state);
      if (paused || isBlocked(state) || !mayTick(state)) {
        acc = 0;
        break;
      }
    }
    if (n > 0) emit();
  } else {
    acc = 0;
  }
}

let started = false;
export function startLoop(): void {
  if (started) return;
  started = true;
  last = performance.now();
  lastRaf = last;
  requestAnimationFrame(rafLoop);
  setInterval(watchdog, WATCHDOG_MS);
  window.addEventListener('beforeunload', () => persist(state));
}

// Debug handle for dev tools / automated testing. The net layer adds `mp` to it (session.ts).
(globalThis as any).__llm = { getState, dispatch, tick: (n = 1) => { for (let i = 0; i < n; i++) tick(state); emit(); },
  /** Like tick, but obeys the multiplayer gate and runs the after-tick hooks (sends day/snapshots). Returns days advanced. */
  step: (n = 1) => {
    let done = 0;
    for (; done < n && !isBlocked(state) && mayTick(state); done++) {
      tick(state);
      for (const h of afterTickHooks) h(state);
      if (autoPauseAfterDay(state)) {
        done++;
        break;
      }
    }
    emit();
    return done;
  },
  newGame,
  /** Save slots (ui/store.ts): list them, load one, save now, or keep a snapshot. */
  saves: { list: listSlots, load: loadSlotIntoGame, saveNow, saveAsNew } };
