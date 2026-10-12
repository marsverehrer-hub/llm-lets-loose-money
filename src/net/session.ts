// OWNER: Agent MP-NET. Public API of the multiplayer session (UI codes against this; keep signatures stable).
// One MpClient per match. This module wires it to the store (loop gate, speed, hooks) and runs the lobby flows.
import { useEffect, useState } from 'preact/hooks';
import type { MpRole, Speed } from '../sim/types';
import { createInitialState } from '../sim/state';
import { loadGame, saveGame } from '../sim/save';
import { dispatch, getState, onAfterDispatch, onAfterTick, replaceState, setEffectiveSpeed, setTickGate } from '../ui/store';
import { MpClient, type MpEvent, type SpeedVote, type StateAccess } from './client';
import { isRoomCode, normalizeRoomCode, generateRoomCode } from './protocol';
import { activateMpSave, clearMp, loadMpRelay, loadMpSave, saveMp, saveMpRelay, setPendingMpSave } from './mpSave';
import { dial, listen, type Listener, type Transport } from './transport';

export type NetStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'disconnected' | 'error';

export interface SessionInfo {
  status: NetStatus;
  role: MpRole | null;
  room: string | null;
  /** Human-readable error / status detail. */
  detail?: string;
  /** Round-trip latency in ms (connected only). */
  pingMs?: number;
  rivalName?: string;
  rivalColor?: string;
  /** True while our sim is held back by lockstep (we're ahead of the rival). */
  waitingForRival: boolean;
  /** The speed the rival has selected (effective speed = min of both). */
  rivalSpeed?: number;
  /** v12: speed request or resume countdown in progress. */
  speedVote?: SpeedVote | null;
}

export interface HostOptions {
  companyName: string;
  color: string;
  lengthYears: number | null;
  /** Optional ws:// or wss:// URL of server/relay.mjs; default = PeerJS cloud (WebRTC). */
  relayUrl?: string;
  /** v12: name of the multiplayer save this match is written to. */
  saveName?: string;
}
export interface JoinOptions {
  room: string;
  companyName: string;
  color: string;
  relayUrl?: string;
  saveName?: string;
}

/** Player colours offered in the lobby (not used by AI labs). */
export const MP_COLORS = ['#5fb3f0', '#e46fd0', '#5ed3b8', '#f08a5d', '#a98cf2', '#d6d65a'];

const DEFAULT_NAME = 'Lets Loose Labs';
const JOIN_TIMEOUT_MS = 15000;
const PING_EVERY_MS = 2000;

const FRESH: Partial<SessionInfo> = {
  status: 'idle',
  role: null,
  room: null,
  detail: undefined,
  pingMs: undefined,
  rivalName: undefined,
  rivalColor: undefined,
  rivalSpeed: undefined,
  waitingForRival: false,
};

let info: SessionInfo = { status: 'idle', role: null, room: null, waitingForRival: false };
const listeners = new Set<() => void>();
function set(patch: Partial<SessionInfo>) {
  info = { ...info, ...patch };
  for (const l of listeners) l();
}

export function getSession(): SessionInfo {
  return info;
}
export function useSession(): SessionInfo {
  const [, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((v) => v + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return info;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let client: MpClient | null = null;
let listener: Listener | null = null;
/** Relay URL in use; null = PeerJS cloud. */
let relay: string | null = null;
/** Bumped on every teardown so late async results from an old session are dropped. */
let generation = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let joinTimer: ReturnType<typeof setTimeout> | null = null;
let joinWaiter: { resolve(): void; reject(e: Error): void } | null = null;

const access: StateAccess = {
  get: () => getState(),
  install: (s) => {
    replaceState(s);
    saveMp(s);
  },
};

function makeClient(o: {
  role: MpRole;
  room: string;
  companyName: string;
  color: string;
  settings?: { lengthYears: number | null };
  resume?: { seed: number; rivalName?: string; rivalColor?: string };
}): MpClient {
  const c: MpClient = new MpClient({
    ...o,
    state: access,
    setSpeed: (speed) => dispatch({ type: 'setSpeed', speed: speed as Speed }),
    // Events from a client we already dropped must not touch the status.
    onEvent: (e) => {
      if (client === c) onEvent(e);
    },
  });
  return c;
}

function onEvent(e: MpEvent): void {
  switch (e.kind) {
    case 'started':
      return;
    case 'connected':
      clearJoinTimer();
      joinWaiter?.resolve();
      joinWaiter = null;
      set({ status: 'connected', rivalName: e.rivalName, rivalColor: e.rivalColor, detail: undefined, waitingForRival: false });
      startPing();
      return;
    case 'disconnected':
      stopPing();
      set({ status: 'disconnected', detail: e.detail, waitingForRival: false, pingMs: undefined, rivalSpeed: undefined });
      return;
    case 'error':
      stopPing();
      failJoin(e.detail);
      return;
    case 'ping':
      set({ pingMs: e.ms });
      return;
    case 'rivalSpeed':
      set({ rivalSpeed: e.speed });
      return;
    case 'waiting':
      set({ waitingForRival: e.waiting });
      return;
  }
}

function failJoin(detail: string): void {
  clearJoinTimer();
  const w = joinWaiter;
  joinWaiter = null;
  set({ status: 'error', detail, waitingForRival: false });
  w?.reject(new Error(detail));
}

function clearJoinTimer(): void {
  if (joinTimer) clearTimeout(joinTimer);
  joinTimer = null;
}

function startPing(): void {
  stopPing();
  pingTimer = setInterval(() => client?.sendPing(), PING_EVERY_MS);
}
function stopPing(): void {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

/** Stop everything network-side. Does not touch the store's state. */
function teardown(): void {
  generation++;
  stopPing();
  clearJoinTimer();
  const w = joinWaiter;
  joinWaiter = null;
  w?.reject(new Error('Cancelled'));
  const c = client;
  client = null;
  c?.detach();
  listener?.close();
  listener = null;
}

/** Before a match takes over the store: park any old match in its save, and put the single-player game back in place. */
function resetToSinglePlayer(): void {
  teardown();
  if (getState().mp) {
    saveMp(getState());
    clearMp();
    replaceState(loadGame() ?? createInitialState());
  } else {
    saveGame(getState());
  }
}

/** The client for the live match, rebuilt from the saved state if the page was reloaded mid-match. */
function ensureClient(): MpClient | null {
  if (client) return client;
  const s = getState();
  if (!s.mp) return null;
  relay = loadMpRelay();
  client = makeClient({
    role: s.mp.role,
    room: s.mp.room,
    companyName: s.company.name,
    color: s.mp.myColor,
    settings: s.mp.settings,
    resume: { seed: s.seed, rivalName: s.mp.rival?.companyName, rivalColor: s.mp.rival?.color },
  });
  return client;
}

function cleanName(n: string): string {
  return n.trim().replace(/\s+/g, ' ').slice(0, 32) || DEFAULT_NAME;
}
function cleanColor(c: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : MP_COLORS[0];
}
function cleanRelay(u?: string): string | null {
  const t = u?.trim();
  return t ? t : null;
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Host and guest flows
// ---------------------------------------------------------------------------

/** Create a room; resolves with the room code once the host is listening. Starts a fresh MP game when the guest joins. */
export async function hostGame(o: HostOptions): Promise<string> {
  resetToSinglePlayer();
  const gen = generation;
  const room = generateRoomCode();
  relay = cleanRelay(o.relayUrl);
  setPendingMpSave(o.saveName ?? '', relay);
  saveMpRelay(relay);
  const c = makeClient({
    role: 'host',
    room,
    companyName: cleanName(o.companyName),
    color: cleanColor(o.color),
    settings: { lengthYears: o.lengthYears },
  });
  client = c;
  set({ ...FRESH, status: 'waiting', role: 'host', room });
  try {
    await openHost(c, room, gen);
  } catch (e) {
    if (gen === generation) set({ status: 'error', detail: errText(e) });
    throw e;
  }
  return room;
}

/** Join a room; resolves once welcomed and the MP game has started. */
export async function joinGame(o: JoinOptions): Promise<void> {
  const room = normalizeRoomCode(o.room);
  if (!isRoomCode(room)) {
    const detail = 'Room codes are 6 letters.';
    set({ status: 'error', detail });
    throw new Error(detail);
  }
  resetToSinglePlayer();
  const gen = generation;
  relay = cleanRelay(o.relayUrl);
  setPendingMpSave(o.saveName ?? '', relay);
  saveMpRelay(relay);
  const c = makeClient({ role: 'guest', room, companyName: cleanName(o.companyName), color: cleanColor(o.color) });
  client = c;
  set({ ...FRESH, status: 'connecting', role: 'guest', room });

  const joined = new Promise<void>((resolve, reject) => {
    joinWaiter = { resolve: () => resolve(), reject };
  });
  joined.catch(() => {}); // only observed below; avoids an unhandled rejection if we bail early
  joinTimer = setTimeout(() => failJoin('No answer from the host.'), JOIN_TIMEOUT_MS);
  try {
    await dialInto(c, room, gen);
  } catch (e) {
    failJoin(errText(e));
    throw e;
  }
  await joined;
}

/** Leave the match (sends bye), restore the single-player save. The match stays in the saved-matches list. */
export function leaveGame(): void {
  resetToSinglePlayer();
  set({ ...FRESH, status: 'idle' });
}

/** Write the match in play to its save now. False when there is no match or storage refused it. */
export function saveMatchNow(): boolean {
  const s = getState();
  return s.mp ? saveMp(s) : false;
}

/**
 * Open a saved match and reconnect through its room code. The host listens again on the same code and the guest
 * dials it, so both players open the same save to carry on. A finished match just opens, for a look at the result.
 */
export async function resumeMatch(id: string): Promise<void> {
  const s = loadMpSave(id);
  if (!s || !s.mp) throw new Error('This save could not be opened.');
  resetToSinglePlayer();
  activateMpSave(id);
  replaceState(s);
  relay = loadMpRelay();
  // A host goes straight to "waiting" so the dropped-connection window does not flash while it re-listens.
  set({
    ...FRESH,
    status: s.mp.role === 'host' && !s.mp.result ? 'waiting' : 'disconnected',
    role: s.mp.role,
    room: s.mp.room,
    rivalName: s.mp.rival?.companyName,
    rivalColor: s.mp.rival?.color,
    detail: s.mp.result ? 'This match is over.' : undefined,
  });
  ensureClient();
  if (!s.mp.result) await reconnect();
}

/** Try to re-establish a dropped connection with the same room. */
export async function reconnect(): Promise<void> {
  const st = info.status;
  if (st === 'connected' || st === 'connecting') return;
  const c = ensureClient();
  if (!c) return;
  if (st === 'waiting' && c.role === 'host' && listener) return;
  const gen = generation;
  try {
    if (c.role === 'host') {
      listener?.close();
      listener = null;
      await openHost(c, c.room, gen);
    } else {
      set({ status: 'connecting', detail: undefined });
      joinTimer = setTimeout(() => failJoin('No answer from the host.'), JOIN_TIMEOUT_MS);
      await dialInto(c, c.room, gen);
    }
  } catch (e) {
    if (gen === generation) set({ status: 'error', detail: errText(e) });
  }
}

async function openHost(c: MpClient, room: string, gen: number): Promise<void> {
  const lst = await listen(room, {
    relayUrl: relay,
    onTransport: (t) => onHostTransport(c, gen, t),
    onLost: (detail) => {
      if (gen === generation && client === c) set({ status: 'disconnected', detail });
    },
  });
  if (gen !== generation || client !== c) {
    lst.close();
    return;
  }
  listener = lst;
  set({ status: 'waiting', detail: undefined });
}

/** A guest connected to our room. One rival per room: a second guest is turned away. */
function onHostTransport(c: MpClient, gen: number, t: Transport): void {
  if (gen !== generation || client !== c) {
    t.close();
    return;
  }
  if (c.hasPeer) {
    t.send({ t: 'bye' });
    t.close();
    return;
  }
  c.attach(t);
}

async function dialInto(c: MpClient, room: string, gen: number): Promise<void> {
  const t = await dial(room, { relayUrl: relay });
  if (gen !== generation || client !== c) {
    t.close();
    throw new Error('Cancelled');
  }
  c.attach(t);
}

// ---------------------------------------------------------------------------
// Shared match speed (v12)
// ---------------------------------------------------------------------------

/** The top bar's speed keys go through here. False = not in a live match, so the caller sets the speed alone. */
export function requestMatchSpeed(speed: number): boolean {
  const ok = client?.requestSpeed(speed) ?? false;
  if (ok) syncVote();
  return ok;
}
export function answerSpeedAsk(ok: boolean): void {
  client?.answerAsk(ok);
  syncVote();
}
export function readyToResume(): void {
  client?.readyNow();
  syncVote();
}
export function holdResume(): void {
  client?.holdCountdown();
  syncVote();
}

let lastVote = 'null';
function syncVote(): void {
  client?.pumpSpeed();
  const v = client?.speedView() ?? null;
  const key = JSON.stringify(v);
  if (key === lastVote) return;
  lastVote = key;
  set({ speedVote: v });
}
setInterval(syncVote, 250);

// ---------------------------------------------------------------------------
// Store integration. Registered once, at module load.
// ---------------------------------------------------------------------------

// Single-player never waits. In a match, the sim ticks only when the client says lockstep allows it.
// In the lobby (client exists but no match yet) the client refuses, so the single-player clock is frozen.
setTickGate(() => (client ? client.canTick(getState()) : true));
setEffectiveSpeed((s) => (client && s.mp ? client.effectiveSpeed(s) : s.speed));
onAfterTick((s) => client?.afterTick(s));
onAfterDispatch((s, a) => client?.afterDispatch(s, a));

// A match saved before a reload comes back paused: the store has the state, the page has no link yet.
(function resumeFromSave() {
  const s = getState();
  if (!s.mp) return;
  info = {
    status: 'disconnected',
    role: s.mp.role,
    room: s.mp.room,
    waitingForRival: false,
    detail: 'Match paused after a page reload. Reconnect to resume.',
    rivalName: s.mp.rival?.companyName,
    rivalColor: s.mp.rival?.color,
  };
})();

// Debug handle: __llm.mp.{getSession, hostGame, joinGame, leaveGame, reconnect} (store.ts owns the rest of __llm).
(globalThis as any).__llm = { ...((globalThis as any).__llm ?? {}), mp: { getSession, hostGame, joinGame, leaveGame, reconnect, resumeMatch, saveMatchNow } };
