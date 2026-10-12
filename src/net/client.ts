// OWNER: Agent MP-NET. The multiplayer link logic for one match. No store import: the state is injected,
// so the same class runs in the app (session.ts) and in tests (two clients over LoopbackTransport).
import type { GameAction, GameState, MpRole, MpSettings } from '../sim/types';
import { createInitialState } from '../sim/state';
import {
  applyRivalAttack,
  applyRivalSnapshot,
  buildSnapshot,
  mpReceiveChat,
  mpSetConnected,
  startMpState,
} from '../sim/systems/multiplayer';
import { PROTOCOL_VERSION, type NetMsg } from './protocol';
import type { Transport } from './transport';

/** We may run at most this many days ahead of the rival's last reported day. */
export const LOCKSTEP_DAYS = 2;
/** Send a snapshot at least this often. */
export const SNAP_EVERY_DAYS = 3;
/** Actions after which the rival needs fresh numbers right away. */
export const SNAP_ACTIONS: ReadonlySet<string> = new Set([
  'releaseModel',
  'launchProduct',
  'updateProduct',
  'shutdownProduct',
  'buyDataset',
]);

/** Where the match state lives. The app passes the store; tests pass a holder object. */
export interface StateAccess {
  get(): GameState | null;
  /** Make `s` the live state (the store's replaceState in the app). */
  install(s: GameState): void;
}

export type MpEvent =
  /** The match state exists (host: after the first hello; guest: after the welcome). */
  | { kind: 'started' }
  | { kind: 'connected'; rivalName?: string; rivalColor?: string }
  | { kind: 'disconnected'; detail: string }
  /** Fatal for this attempt: the join failed or the peers disagree. The client keeps its state but has no link. */
  | { kind: 'error'; detail: string }
  | { kind: 'ping'; ms: number }
  | { kind: 'rivalSpeed'; speed: number }
  | { kind: 'waiting'; waiting: boolean };

/** v12: a speed vote in progress, as the UI shows it. */
export type SpeedVote =
  | { kind: 'ask'; from: 'me' | 'rival'; speed: number; secondsLeft: number; total: number }
  | { kind: 'countdown'; from: 'me' | 'rival'; speed: number; secondsLeft: number; total: number; meReady: boolean; rivalReady: boolean }
  | { kind: 'note'; text: string };

/** A speed-up request answers itself (yes) after this long. */
export const SPEED_ASK_MS = 10_000;
/** Unpausing a match counts down this long, unless both players press Ready first. */
export const RESUME_COUNTDOWN_MS = 30_000;
const NOTE_MS = 3_500;

export interface MpClientOptions {
  role: MpRole;
  room: string;
  companyName: string;
  color: string;
  /** Host: lobby choice. Guest: ignored, the welcome carries the settings. */
  settings?: MpSettings;
  /** Rebuild from an existing match after a page reload. The state is already live. */
  resume?: { seed: number; rivalName?: string; rivalColor?: string };
  state: StateAccess;
  onEvent?: (e: MpEvent) => void;
  now?: () => number;
  /** Apply a speed to the local game (the store dispatches setSpeed). Default: write s.speed. */
  setSpeed?: (speed: number) => void;
}

export class MpClient {
  readonly role: MpRole;
  readonly room: string;
  private readonly name: string;
  private readonly color: string;
  private readonly state: StateAccess;
  private readonly emit: (e: MpEvent) => void;
  private readonly now: () => number;

  private settings: MpSettings;
  private seed: number | null;
  private started: boolean;

  private link: Transport | null = null;
  /** Bumped whenever the link changes, so late events from an old link are ignored. */
  private linkId = 0;
  /** A peer is present on the current link and has completed the handshake. */
  private peerConnected = false;
  private rivalName?: string;
  private rivalColor?: string;
  /** Last speed the rival reported; null until its first `day` message on this link. */
  private rivalSpeed: number | null = null;
  private rivalDone = false;
  private lastSentSpeed: number | null = null;
  private lastSnapDay = -Infinity;
  private waiting = false;
  private readonly applySpeedFn: (speed: number) => void;
  /** Speed-up request in flight. */
  private ask: { from: 'me' | 'rival'; speed: number; until: number } | null = null;
  /** Countdown out of a pause. */
  private countdown: { from: 'me' | 'rival'; speed: number; until: number; meReady: boolean; rivalReady: boolean } | null = null;
  private note: { text: string; until: number } | null = null;
  /** True between building a brand-new match and its first handshake: it starts at 1x on both sides, no countdown. */
  private freshStart = false;

  constructor(o: MpClientOptions) {
    this.role = o.role;
    this.room = o.room;
    this.name = o.companyName;
    this.color = o.color;
    this.state = o.state;
    this.emit = o.onEvent ?? (() => {});
    this.now = o.now ?? (() => Date.now());
    this.settings = o.settings ?? { lengthYears: null };
    this.seed = o.resume?.seed ?? null;
    this.started = !!o.resume;
    this.rivalName = o.resume?.rivalName;
    this.rivalColor = o.resume?.rivalColor;
    this.applySpeedFn =
      o.setSpeed ??
      ((speed) => {
        const s = this.state.get();
        if (s) s.speed = speed as GameState['speed'];
      });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  get isStarted(): boolean {
    return this.started;
  }
  /** True while a peer is present and has shaken hands on the current link. */
  get hasPeer(): boolean {
    return this.peerConnected;
  }
  get rival(): { name?: string; color?: string } {
    return { name: this.rivalName, color: this.rivalColor };
  }

  /**
   * Gate for the store's frame loop. False while the lobby is open, while disconnected, while the match has a result,
   * and while we are LOCKSTEP_DAYS ahead of the rival.
   */
  canTick(s: GameState): boolean {
    if (!this.started || !this.peerConnected || !s.mp || s.mp.result) {
      this.setWaiting(false);
      return false;
    }
    const ok = this.rivalDone || s.day < s.mp.rivalDay + LOCKSTEP_DAYS;
    this.setWaiting(!ok);
    return ok;
  }

  /** min(our selected speed, rival's selected speed); 0 (paused) if either side is paused or unknown. */
  effectiveSpeed(s: GameState): number {
    if (!s.mp || !this.peerConnected) return 0;
    if (this.rivalDone) return s.speed; // the rival has finished; nothing to stay in step with
    if (this.rivalSpeed === null) return 0;
    return Math.min(s.speed, this.rivalSpeed);
  }

  // -------------------------------------------------------------------------
  // Shared match speed (v12). Both players always run at the same speed:
  // pausing and slowing down apply at once, speeding up asks the rival, unpausing counts down.
  // -------------------------------------------------------------------------

  /** True when the match is live and speed changes must go through the vote. */
  get speedShared(): boolean {
    const s = this.state.get();
    return this.started && this.peerConnected && !!s?.mp && !s.mp.result && !this.rivalDone;
  }

  /** The player picked `speed` (0 = pause). Returns false when the match is not live, so the caller applies it alone. */
  requestSpeed(speed: number): boolean {
    if (!this.speedShared) return false;
    const s = this.state.get()!;
    const cur = s.speed;
    if (speed === 0) {
      this.ask = null;
      this.countdown = null;
      this.applySpeedFn(0);
      this.send({ t: 'spd', op: 'set', speed: 0 });
      return true;
    }
    if (this.countdown) {
      // Already counting down: pressing play means ready, and the newest pick of speed wins.
      this.countdown.speed = speed;
      this.readyNow();
      return true;
    }
    if (cur === 0) {
      this.ask = null;
      this.countdown = { from: 'me', speed, until: this.now() + RESUME_COUNTDOWN_MS, meReady: true, rivalReady: false };
      this.send({ t: 'spd', op: 'resume', speed });
      return true;
    }
    if (speed === cur) return true;
    if (speed < cur) {
      this.ask = null;
      this.applySpeedFn(speed);
      this.send({ t: 'spd', op: 'set', speed });
      return true;
    }
    this.ask = { from: 'me', speed, until: this.now() + SPEED_ASK_MS };
    this.send({ t: 'spd', op: 'ask', speed });
    return true;
  }

  /** Answer the rival's speed-up request. */
  answerAsk(ok: boolean): void {
    const a = this.ask;
    if (!a || a.from !== 'rival') return;
    this.ask = null;
    this.send({ t: 'spd', op: ok ? 'yes' : 'no', speed: a.speed });
    if (ok) this.applySpeedFn(a.speed);
  }

  /** Countdown: this player is ready. Both ready starts the clock at once. */
  readyNow(): void {
    const c = this.countdown;
    if (!c) return;
    c.meReady = true;
    this.send({ t: 'spd', op: 'ready', speed: c.speed });
    if (c.rivalReady) this.finishCountdown();
  }

  /** Countdown: stay paused. */
  holdCountdown(): void {
    if (!this.countdown) return;
    this.countdown = null;
    this.send({ t: 'spd', op: 'hold' });
  }

  /** Called a few times a second: expire requests and countdowns. */
  pumpSpeed(): void {
    const now = this.now();
    if (this.ask && now >= this.ask.until) {
      // Nobody answered: the request goes through (the rival's side sends the yes).
      if (this.ask.from === 'rival') this.answerAsk(true);
      else this.ask = null;
    }
    if (this.countdown && now >= this.countdown.until) this.finishCountdown();
    if (this.note && now >= this.note.until) this.note = null;
  }

  speedView(): SpeedVote | null {
    const now = this.now();
    const secs = (until: number) => Math.max(0, Math.ceil((until - now) / 1000));
    if (this.countdown) {
      const c = this.countdown;
      return { kind: 'countdown', from: c.from, speed: c.speed, secondsLeft: secs(c.until), total: RESUME_COUNTDOWN_MS / 1000, meReady: c.meReady, rivalReady: c.rivalReady };
    }
    if (this.ask) return { kind: 'ask', from: this.ask.from, speed: this.ask.speed, secondsLeft: secs(this.ask.until), total: SPEED_ASK_MS / 1000 };
    if (this.note) return { kind: 'note', text: this.note.text };
    return null;
  }

  private finishCountdown(): void {
    const c = this.countdown;
    if (!c) return;
    this.countdown = null;
    this.applySpeedFn(c.speed);
  }

  private setNote(text: string): void {
    this.note = { text, until: this.now() + NOTE_MS };
  }

  private clearVotes(): void {
    this.ask = null;
    this.countdown = null;
  }

  private onSpeedMsg(op: string, speed: number | undefined): void {
    const rival = this.rivalName ?? 'Your rival';
    switch (op) {
      case 'set':
        this.clearVotes();
        if (speed !== undefined) this.applySpeedFn(speed);
        if (speed === 0) this.setNote(`${rival} paused the game.`);
        return;
      case 'ask':
        if (speed === undefined) return;
        this.countdown = null;
        this.ask = { from: 'rival', speed, until: this.now() + SPEED_ASK_MS };
        return;
      case 'yes':
        if (this.ask?.from === 'me') {
          this.applySpeedFn(this.ask.speed);
          this.ask = null;
        }
        return;
      case 'no':
        if (this.ask?.from === 'me') {
          this.ask = null;
          this.setNote(`${rival} kept the current speed.`);
        }
        return;
      case 'resume':
        if (speed === undefined) return;
        this.ask = null;
        if (this.countdown) {
          // Both pressed play at the same moment: count theirs as ready and keep the faster pick.
          this.countdown.rivalReady = true;
          this.countdown.speed = Math.max(this.countdown.speed, speed);
          if (this.countdown.meReady) this.finishCountdown();
          return;
        }
        this.countdown = { from: 'rival', speed, until: this.now() + RESUME_COUNTDOWN_MS, meReady: false, rivalReady: true };
        return;
      case 'ready':
        if (!this.countdown) return;
        this.countdown.rivalReady = true;
        if (speed !== undefined) this.countdown.speed = speed;
        if (this.countdown.meReady) this.finishCountdown();
        return;
      case 'hold':
        if (this.countdown) {
          this.countdown = null;
          this.setNote(`${rival} wants to stay paused.`);
        }
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Hooks called by the store (or by tests) after each tick and each dispatch
  // -------------------------------------------------------------------------

  afterTick(s: GameState): void {
    if (!s.mp || !this.peerConnected) return;
    this.sendDay(s);
    if (s.day - this.lastSnapDay >= SNAP_EVERY_DAYS) this.sendSnap(s);
    this.drainOutbox(s);
  }

  afterDispatch(s: GameState, action: Pick<GameAction, 'type'>): void {
    if (!s.mp || !this.peerConnected) return;
    if (SNAP_ACTIONS.has(action.type)) this.sendSnap(s);
    if (s.speed !== this.lastSentSpeed) this.sendDay(s);
    this.drainOutbox(s);
  }

  sendPing(): void {
    if (this.peerConnected) this.send({ t: 'ping', at: this.now() });
  }

  // -------------------------------------------------------------------------
  // Link management
  // -------------------------------------------------------------------------

  /** Use `t` as the link. Replaces any previous link. A guest says hello; the host answers with a welcome. */
  attach(t: Transport): void {
    if (this.peerConnected) this.peerGone('Connection replaced.');
    this.dropLink();
    const id = ++this.linkId;
    this.link = t;
    this.rivalSpeed = null;
    t.onMessage((m) => {
      if (id === this.linkId) this.onMessage(m);
    });
    t.onClose((reason) => {
      if (id === this.linkId) this.onLinkClosed(reason);
    });
    if (this.role === 'guest') this.send({ t: 'hello', name: this.name, color: this.color, version: PROTOCOL_VERSION });
  }

  /** Leave: tell the peer (bye), drop the link, and mark the sim disconnected. */
  detach(): void {
    if (this.link) this.send({ t: 'bye' });
    this.peerGone('Left the match.');
    this.dropLink();
  }

  private dropLink(): void {
    const t = this.link;
    this.link = null;
    this.linkId++;
    t?.close();
  }

  private onLinkClosed(reason: string): void {
    this.link = null;
    this.linkId++;
    if (!this.started) {
      this.emit({ kind: 'error', detail: this.role === 'guest' ? `Could not join the room (${reason}).` : reason });
      return;
    }
    this.peerGone('Connection lost.');
  }

  // -------------------------------------------------------------------------
  // Incoming messages
  // -------------------------------------------------------------------------

  private onMessage(m: NetMsg): void {
    switch (m.t) {
      case 'hello':
        return this.onHello(m);
      case 'welcome':
        return this.onWelcome(m);
      case 'bye':
        return this.onPeerBye();
      case 'ping':
        this.send({ t: 'pong', at: m.at });
        return;
      case 'pong':
        this.emit({ kind: 'ping', ms: Math.max(0, this.now() - m.at) });
        return;
    }
    const s = this.state.get();
    if (!s || !this.started) return;
    switch (m.t) {
      case 'snap':
        applyRivalSnapshot(s, m.snap);
        return;
      case 'day':
        return this.onRivalDay(s, m.day, m.speed, !!m.done);
      case 'attack':
        applyRivalAttack(s, m.attack);
        return;
      case 'chat':
        mpReceiveChat(s, m.text);
        return;
      case 'spd':
        return this.onSpeedMsg(m.op, m.speed);
    }
  }

  /** Host only: a guest introduced itself. Start the match on the first hello, and welcome every (re)connect. */
  private onHello(m: Extract<NetMsg, { t: 'hello' }>): void {
    if (this.role !== 'host') return;
    if (m.version !== PROTOCOL_VERSION) {
      this.send({ t: 'bye' });
      this.dropLink();
      this.emit({ kind: 'disconnected', detail: 'A guest on a different game version was turned away.' });
      return;
    }
    this.rivalName = m.name;
    this.rivalColor = m.color;
    if (!this.started) {
      const seed = randomSeed();
      const s = createInitialState(seed, this.name);
      startMpState(s, { role: 'host', room: this.room, settings: this.settings, myColor: this.color });
      s.speed = 1;
      this.seed = seed;
      this.started = true;
      this.freshStart = true;
      this.state.install(s);
      this.emit({ kind: 'started' });
    }
    this.send({
      t: 'welcome',
      seed: this.seed!,
      settings: this.settings,
      hostName: this.name,
      hostColor: this.color,
      protocol: PROTOCOL_VERSION,
    });
    this.peerUp();
  }

  /** Guest only: the host accepted us. Build the match on the first welcome; on a reconnect, check it is still the same match. */
  private onWelcome(m: Extract<NetMsg, { t: 'welcome' }>): void {
    if (this.role !== 'guest') return;
    if (m.protocol !== PROTOCOL_VERSION) {
      this.emit({ kind: 'error', detail: 'The host runs a different game version.' });
      this.dropLink();
      return;
    }
    if (this.started && m.seed !== this.seed) {
      this.emit({ kind: 'error', detail: 'The host is running a different match. Leave and join again.' });
      this.dropLink();
      return;
    }
    this.rivalName = m.hostName;
    this.rivalColor = m.hostColor;
    if (!this.started) {
      const s = createInitialState(m.seed, this.name);
      startMpState(s, { role: 'guest', room: this.room, settings: m.settings, myColor: this.color });
      s.speed = 1;
      this.seed = m.seed;
      this.settings = m.settings;
      this.started = true;
      this.freshStart = true;
      this.state.install(s);
      this.emit({ kind: 'started' });
    }
    this.peerUp();
  }

  private onPeerBye(): void {
    if (!this.started) {
      this.emit({ kind: 'error', detail: 'The room is full or the host left.' });
      this.dropLink();
      return;
    }
    this.peerGone(this.role === 'host' ? 'Rival left the match. Waiting for them to rejoin.' : 'Host left the match.');
    // A guest gives up its slot so the host can take a fresh connection. The host keeps its link to listen.
    if (this.role === 'guest') this.dropLink();
  }

  private onRivalDay(s: GameState, day: number, speed: number, done: boolean): void {
    if (s.mp) s.mp.rivalDay = Math.max(s.mp.rivalDay, day);
    this.rivalDone = done;
    if (speed !== this.rivalSpeed) {
      this.rivalSpeed = speed;
      this.emit({ kind: 'rivalSpeed', speed });
    }
  }

  // -------------------------------------------------------------------------
  // Connection state
  // -------------------------------------------------------------------------

  /** Both sides have shaken hands: mark the sim connected and say everything we know. */
  private peerUp(): void {
    const s = this.state.get();
    this.peerConnected = true;
    this.rivalDone = false;
    this.clearVotes();
    // A reconnect or a resumed save comes back paused on both sides; play starts with the countdown.
    if (!this.freshStart && s?.mp && !s.mp.result) this.applySpeedFn(0);
    this.freshStart = false;
    if (s) mpSetConnected(s, true);
    this.emit({ kind: 'connected', rivalName: this.rivalName, rivalColor: this.rivalColor });
    if (s?.mp) {
      this.sendSnap(s);
      this.sendDay(s);
      this.drainOutbox(s);
    }
  }

  private peerGone(detail: string): void {
    if (!this.peerConnected) return;
    this.peerConnected = false;
    this.rivalSpeed = null;
    this.rivalDone = false;
    this.clearVotes();
    this.setWaiting(false);
    const s = this.state.get();
    if (s) mpSetConnected(s, false);
    this.emit({ kind: 'disconnected', detail });
  }

  private setWaiting(w: boolean): void {
    if (w === this.waiting) return;
    this.waiting = w;
    this.emit({ kind: 'waiting', waiting: w });
  }

  // -------------------------------------------------------------------------
  // Outgoing messages
  // -------------------------------------------------------------------------

  private send(msg: NetMsg): void {
    this.link?.send(msg);
  }

  private sendSnap(s: GameState): void {
    this.send({ t: 'snap', snap: buildSnapshot(s) });
    this.lastSnapDay = s.day;
  }

  private sendDay(s: GameState): void {
    this.lastSentSpeed = s.speed;
    this.send(s.mp?.result ? { t: 'day', day: s.day, speed: s.speed, done: true } : { t: 'day', day: s.day, speed: s.speed });
  }

  /** Queued sim messages (attacks, chat) go out only while a peer is present; otherwise they wait in the outbox. */
  private drainOutbox(s: GameState): void {
    const mp = s.mp;
    if (!mp || !this.peerConnected || mp.outbox.length === 0) return;
    for (const o of mp.outbox.splice(0)) this.send(o);
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
