// OWNER: Agent MP-NET. Transports carry NetMsg frames. Three implementations:
//   PeerTransport   WebRTC data channel via PeerJS (default, public cloud broker)
//   WsTransport     WebSocket to server/relay.mjs (lobby "Advanced" relay URL)
//   LoopbackTransport  in-memory pair for tests
// PeerJS is imported lazily so that tests and the sim never load WebRTC code.
import type { MpRole } from '../sim/types';
import { decodeNetMsg, encodeNetMsg, peerIdFor, type NetMsg } from './protocol';

export interface Transport {
  send(msg: NetMsg): void;
  onMessage(cb: (msg: NetMsg) => void): void;
  /** Fires exactly once per transport, whether the peer or we closed it. */
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

/** Listener for the host side. Closing it stops accepting new guests. */
export interface Listener {
  close(): void;
}

const OPEN_TIMEOUT_MS = 15000;

abstract class BaseTransport implements Transport {
  private msgCbs: Array<(m: NetMsg) => void> = [];
  private closeCbs: Array<(reason: string) => void> = [];
  // Frames and close events that arrive before anyone listens are held until the first listener registers.
  private pendingMsgs: NetMsg[] = [];
  private pendingClose: string | null = null;
  protected closed = false;

  abstract send(msg: NetMsg): void;
  abstract close(): void;

  onMessage(cb: (msg: NetMsg) => void): void {
    this.msgCbs.push(cb);
    if (this.pendingMsgs.length) {
      const queued = this.pendingMsgs.splice(0);
      for (const m of queued) cb(m);
    }
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCbs.push(cb);
    if (this.pendingClose !== null) {
      const r = this.pendingClose;
      this.pendingClose = null;
      cb(r);
    }
  }

  protected emitMessage(raw: unknown): void {
    if (this.closed) return;
    const m = decodeNetMsg(raw);
    if (!m) return;
    if (this.msgCbs.length === 0) this.pendingMsgs.push(m);
    else for (const cb of this.msgCbs) cb(m);
  }

  protected emitClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.closeCbs.length === 0) this.pendingClose = reason;
    else for (const cb of this.closeCbs) cb(reason);
  }
}

// ---------------------------------------------------------------------------
// PeerJS (WebRTC)
// ---------------------------------------------------------------------------

type PeerLike = { destroy(): void };
type ConnLike = {
  open: boolean;
  send(data: unknown): void;
  close(): void;
  on(event: string, cb: (...args: any[]) => void): unknown;
};

export class PeerTransport extends BaseTransport {
  constructor(
    private readonly conn: ConnLike,
    private readonly peer?: PeerLike,
  ) {
    super();
    conn.on('data', (d: unknown) => this.emitMessage(d));
    conn.on('close', () => this.finish('Connection closed'));
    conn.on('error', (e: unknown) => this.finish(`Connection error: ${errText(e)}`));
  }

  send(msg: NetMsg): void {
    if (this.closed || !this.conn.open) return;
    this.conn.send(encodeNetMsg(msg));
  }

  close(): void {
    if (this.closed) return;
    this.finish('Closed locally');
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.emitClose(reason);
    try {
      this.conn.close();
    } catch {
      // already gone
    }
    this.peer?.destroy();
  }
}

/** Host side: register the room's peer id and hand every opened guest connection to `onTransport`. */
export async function listenPeer(
  room: string,
  onTransport: (t: Transport) => void,
  onLost: (detail: string) => void,
): Promise<Listener> {
  const { default: Peer } = await import('peerjs');
  return new Promise<Listener>((resolve, reject) => {
    const peer = new Peer(peerIdFor(room));
    let listening = false;
    let settled = false;
    peer.on('open', () => {
      listening = true;
      settled = true;
      resolve({ close: () => peer.destroy() });
    });
    peer.on('connection', (conn: ConnLike) => {
      const hand = () => onTransport(new PeerTransport(conn, peer));
      if (conn.open) hand();
      else conn.on('open', hand);
    });
    peer.on('disconnected', () => {
      // The broker link dropped; the data channels may survive. Ask for the room id back.
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (!settled) {
        settled = true;
        peer.destroy();
        reject(new Error(err.type === 'unavailable-id' ? 'Room code in use' : `Could not open the room (${err.type ?? 'error'})`));
        return;
      }
      if (listening) onLost(`Room connection error (${err.type ?? 'error'})`);
    });
  });
}

/** Guest side: connect to the host's room id. Resolves with an open data channel. */
export async function dialPeer(room: string): Promise<Transport> {
  const { default: Peer } = await import('peerjs');
  return new Promise<Transport>((resolve, reject) => {
    const peer = new Peer();
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('No answer from the room. Check the code.'), OPEN_TIMEOUT_MS);
    peer.on('error', (err: { type?: string }) => {
      if (err.type === 'peer-unavailable') fail('Room not found. Check the code.');
      else fail(`Could not reach the room (${err.type ?? 'error'})`);
    });
    peer.on('open', () => {
      const conn = peer.connect(peerIdFor(room), { reliable: true }) as unknown as ConnLike;
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new PeerTransport(conn, peer));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// WebSocket relay (server/relay.mjs)
// ---------------------------------------------------------------------------

export class WsTransport extends BaseTransport {
  constructor(private readonly ws: WebSocket) {
    super();
    ws.addEventListener('message', (ev) => this.emitMessage(ev.data));
    ws.addEventListener('close', (ev) => this.emitClose(ev.reason || `Relay closed (${ev.code})`));
    ws.addEventListener('error', () => {
      // a close event always follows
    });
  }

  send(msg: NetMsg): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeNetMsg(msg));
  }

  close(): void {
    if (this.closed) return;
    this.emitClose('Closed locally');
    this.ws.close();
  }

  /** Open a relay socket for `role` in `room`. Resolves once the socket is open. */
  static open(relayUrl: string, room: string, role: MpRole): Promise<WsTransport> {
    return new Promise<WsTransport>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relayAddress(relayUrl, room, role));
      } catch {
        reject(new Error('Relay URL is not valid. Use ws:// or wss://'));
        return;
      }
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          ws.close();
          reject(new Error('Relay did not answer'));
        }
      }, OPEN_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        opened = true;
        clearTimeout(timer);
        resolve(new WsTransport(ws));
      });
      ws.addEventListener('close', (ev) => {
        clearTimeout(timer);
        if (opened) return;
        if (ev.code === 4004) reject(new Error('Room not found. Check the code.'));
        else reject(new Error(`Could not reach the relay${ev.code ? ` (${ev.code})` : ''}`));
      });
    });
  }
}

export function relayAddress(base: string, room: string, role: MpRole): string {
  const u = new URL(base.trim());
  if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol === 'https:') u.protocol = 'wss:';
  u.searchParams.set('room', room);
  u.searchParams.set('role', role);
  return u.toString();
}

// ---------------------------------------------------------------------------
// Shared entry points used by session.ts
// ---------------------------------------------------------------------------

/** Host: make the room joinable. With a relay the host's own socket is the link; with PeerJS each guest is a new transport. */
export async function listen(
  room: string,
  opts: { relayUrl?: string | null; onTransport: (t: Transport) => void; onLost: (detail: string) => void },
): Promise<Listener> {
  if (opts.relayUrl) {
    const t = await WsTransport.open(opts.relayUrl, room, 'host');
    opts.onTransport(t);
    return { close: () => t.close() };
  }
  return listenPeer(room, opts.onTransport, opts.onLost);
}

/** Guest: open a transport to the room. */
export async function dial(room: string, opts: { relayUrl?: string | null }): Promise<Transport> {
  if (opts.relayUrl) return WsTransport.open(opts.relayUrl, room, 'guest');
  return dialPeer(room);
}

// ---------------------------------------------------------------------------
// In-memory pair for tests. Delivery is asynchronous (microtask) and ordered, like a data channel.
// ---------------------------------------------------------------------------

export class LoopbackTransport extends BaseTransport {
  private peerEnd: LoopbackTransport | null = null;

  static pair(): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a.peerEnd = b;
    b.peerEnd = a;
    return [a, b];
  }

  send(msg: NetMsg): void {
    if (this.closed || !this.peerEnd) return;
    const raw = encodeNetMsg(msg); // round-trip through JSON so tests see what the wire sees
    const target = this.peerEnd;
    queueMicrotask(() => target.emitMessage(raw));
  }

  close(): void {
    if (this.closed) return;
    this.emitClose('Closed locally');
    const target = this.peerEnd;
    if (target) queueMicrotask(() => target.emitClose('Closed by peer'));
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
