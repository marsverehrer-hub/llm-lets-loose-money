import { describe, it, expect, vi } from 'vitest';

// The net layer is tested against the sim's multiplayer SIGNATURES only. This fake keeps the tests independent of
// how src/sim/systems/multiplayer.ts is implemented, so the net layer can be verified on its own.
vi.mock('../src/sim/systems/multiplayer', () => ({
  startMpState: (s: any, o: any) => {
    s.mp = {
      role: o.role,
      room: o.room,
      settings: o.settings,
      myColor: o.myColor,
      rival: null,
      rivalDay: 0,
      connected: false,
      outbox: [],
      cooldowns: {},
      log: [],
      history: [],
      result: null,
      seen: { snaps: 0, chats: [] as string[], attacks: [] as unknown[] },
    };
  },
  buildSnapshot: (s: any) => ({
    day: s.day,
    companyName: s.company.name,
    color: s.mp.myColor,
    model: null,
    prices: {},
    users: { consumer: 0, developer: 0, enterprise: 0 },
    brand: 10,
    hype: 0,
    reputation: 50,
    valuation: 0,
    cash: 0,
    revenuePerDay: 0,
    isPublic: false,
    modelsReleased: 0,
    researchDone: 0,
    exclusives: [],
    bankrupt: false,
  }),
  applyRivalSnapshot: (s: any, snap: any) => {
    s.mp.rival = snap;
    s.mp.rivalDay = snap.day;
    s.mp.seen.snaps++;
  },
  applyRivalAttack: (s: any, a: unknown) => {
    s.mp.seen.attacks.push(a);
  },
  mpSetConnected: (s: any, on: boolean) => {
    if (s.mp) s.mp.connected = on;
  },
  mpReceiveChat: (s: any, text: string) => {
    s.mp.seen.chats.push(text);
  },
}));

import { LOCKSTEP_DAYS, MpClient, type MpEvent } from '../src/net/client';
import { LoopbackTransport } from '../src/net/transport';
import { generateRoomCode, isRoomCode, decodeNetMsg, normalizeRoomCode, parseNetMsg, PROTOCOL_VERSION } from '../src/net/protocol';
import { createInitialState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

interface Side {
  client: MpClient;
  holder: { s: GameState | null };
  events: MpEvent[];
}

function side(role: 'host' | 'guest', name: string, color: string): Side {
  const holder = { s: null as GameState | null };
  const events: MpEvent[] = [];
  const client = new MpClient({
    role,
    room: 'ABCDEF',
    companyName: name,
    color,
    settings: { lengthYears: 5 },
    state: {
      get: () => holder.s,
      install: (s) => {
        holder.s = s;
      },
    },
    onEvent: (e) => events.push(e),
  });
  return { client, holder, events };
}

const seen = (s: GameState) => (s.mp as any).seen as { snaps: number; chats: string[]; attacks: unknown[] };

async function matchUp() {
  const host = side('host', 'Alpha', '#5fb3f0');
  const guest = side('guest', 'Beta', '#e46fd0');
  const [a, b] = LoopbackTransport.pair();
  host.client.attach(a);
  guest.client.attach(b);
  await settle();
  const hs = host.holder.s!;
  const gs = guest.holder.s!;
  return { host, guest, a, b, hs, gs };
}

describe('protocol', () => {
  it('room codes are 6 letters from A-Z without I and O', () => {
    for (let i = 0; i < 300; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-HJ-NP-Z]{6}$/);
      expect(isRoomCode(code)).toBe(true);
    }
    expect(isRoomCode('ABCDEI')).toBe(false);
    expect(isRoomCode('ABCDEO')).toBe(false);
    expect(normalizeRoomCode(' abc-def ')).toBe('ABCDEF');
  });

  it('parses known messages and rejects garbage', () => {
    expect(decodeNetMsg('{"t":"day","day":4,"speed":3}')).toEqual({ t: 'day', day: 4, speed: 3 });
    expect(decodeNetMsg('not json')).toBeNull();
    expect(decodeNetMsg('{"t":"nope"}')).toBeNull();
    expect(parseNetMsg({ t: 'chat' })).toBeNull(); // missing text
    expect(parseNetMsg({ t: 'bye' })).toEqual({ t: 'bye' });
  });
});

describe('handshake', () => {
  it('the guest builds the same world from the host seed and both sides go connected', async () => {
    const { host, guest, hs, gs } = await matchUp();
    expect(hs).toBeTruthy();
    expect(gs).toBeTruthy();
    expect(gs.seed).toBe(hs.seed);
    expect(gs.company.name).toBe('Beta');
    expect(hs.company.name).toBe('Alpha');
    expect(hs.mp!.role).toBe('host');
    expect(gs.mp!.role).toBe('guest');
    expect(hs.mp!.connected).toBe(true);
    expect(gs.mp!.connected).toBe(true);
    expect(hs.speed).toBe(1);
    expect(gs.speed).toBe(1);
    expect(host.client.hasPeer).toBe(true);
    expect(guest.client.hasPeer).toBe(true);
    expect(guest.events).toContainEqual({ kind: 'connected', rivalName: 'Alpha', rivalColor: '#5fb3f0' });
    expect(host.events).toContainEqual({ kind: 'connected', rivalName: 'Beta', rivalColor: '#e46fd0' });
  });

  it('a reconnect keeps the same match and does not roll a new seed', async () => {
    const { host, guest, a, hs, gs } = await matchUp();
    const seed = hs.seed;
    a.close();
    await settle();
    expect(hs.mp!.connected).toBe(false);
    expect(gs.mp!.connected).toBe(false);

    const [a2, b2] = LoopbackTransport.pair();
    host.client.attach(a2);
    guest.client.attach(b2);
    await settle();
    expect(host.holder.s).toBe(hs);
    expect(guest.holder.s).toBe(gs);
    expect(gs.seed).toBe(seed);
    expect(hs.mp!.connected).toBe(true);
    expect(gs.mp!.connected).toBe(true);
  });

  it('a guest that gets bye before the welcome reports the room as full or closed', async () => {
    const g = side('guest', 'Beta', '#e46fd0');
    const [a, b] = LoopbackTransport.pair();
    g.client.attach(b);
    a.send({ t: 'bye' });
    await settle();
    expect(g.events).toContainEqual({ kind: 'error', detail: 'The room is full or the host left.' });
    expect(g.holder.s).toBeNull();
  });
});

describe('snapshots', () => {
  it('a snapshot arrives on connect, every 3 days on tick, and right after a release', async () => {
    const { host, guest, hs, gs } = await matchUp();
    expect(seen(gs).snaps).toBeGreaterThan(0);
    expect(seen(hs).snaps).toBeGreaterThan(0);

    const before = seen(gs).snaps;
    hs.day = 3;
    host.client.afterTick(hs);
    await settle();
    expect(seen(gs).snaps).toBe(before + 1);
    expect((gs.mp!.rival as any).day).toBe(3);
    expect(gs.mp!.rivalDay).toBe(3);

    // A tick inside the 3-day window sends no snapshot.
    hs.day = 4;
    host.client.afterTick(hs);
    await settle();
    expect(seen(gs).snaps).toBe(before + 1);

    // A release sends one straight away.
    host.client.afterDispatch(hs, { type: 'releaseModel' } as any);
    await settle();
    expect(seen(gs).snaps).toBe(before + 2);

    // An unrelated action does not.
    host.client.afterDispatch(hs, { type: 'setSpeed' } as any);
    await settle();
    expect(seen(gs).snaps).toBe(before + 2);
    expect(guest.client.hasPeer).toBe(true);
  });
});

describe('lockstep', () => {
  it('a client stops at rivalDay + LOCKSTEP_DAYS and resumes when the rival reports', async () => {
    const { host, guest, hs, gs } = await matchUp();
    expect(LOCKSTEP_DAYS).toBe(2);

    hs.day = 2;
    expect(host.client.canTick(hs)).toBe(false);
    expect(host.events).toContainEqual({ kind: 'waiting', waiting: true });

    gs.day = 1;
    guest.client.afterTick(gs);
    await settle();
    expect(hs.mp!.rivalDay).toBe(1);
    expect(host.client.canTick(hs)).toBe(true);
    expect(host.events).toContainEqual({ kind: 'waiting', waiting: false });
  });

  it('a rival that has finished no longer holds the other side back', async () => {
    const { host, guest, hs, gs } = await matchUp();
    gs.mp!.result = { winner: 'draw', reason: 'test', day: 0 };
    guest.client.afterTick(gs);
    await settle();
    hs.day = 10;
    expect(host.client.canTick(hs)).toBe(true);
  });
});

describe('speed', () => {
  it('the effective speed is the minimum, and either side paused pauses both', async () => {
    const { host, guest, hs, gs } = await matchUp();
    hs.speed = 3;
    host.client.afterDispatch(hs, { type: 'setSpeed' } as any);
    gs.speed = 1;
    guest.client.afterDispatch(gs, { type: 'setSpeed' } as any);
    await settle();
    expect(host.client.effectiveSpeed(hs)).toBe(1);
    expect(guest.client.effectiveSpeed(gs)).toBe(1);

    hs.speed = 10;
    host.client.afterDispatch(hs, { type: 'setSpeed' } as any);
    await settle();
    expect(host.client.effectiveSpeed(hs)).toBe(1);
    expect(guest.client.effectiveSpeed(gs)).toBe(1);

    gs.speed = 0;
    guest.client.afterDispatch(gs, { type: 'setSpeed' } as any);
    await settle();
    expect(host.client.effectiveSpeed(hs)).toBe(0);
    expect(guest.client.effectiveSpeed(gs)).toBe(0);
    expect(host.events).toContainEqual({ kind: 'rivalSpeed', speed: 0 });
  });
});

describe('outbox', () => {
  it('chat and attacks queued by the sim are delivered to the rival', async () => {
    const { host, guest, hs, gs } = await matchUp();
    hs.mp!.outbox.push({ t: 'chat', text: 'gl hf' });
    host.client.afterDispatch(hs, { type: 'mpChat' } as any);
    await settle();
    expect(seen(gs).chats).toEqual(['gl hf']);
    expect(hs.mp!.outbox).toHaveLength(0);

    const attack = { kind: 'smear' as const, day: hs.day, from: 'Alpha' };
    hs.mp!.outbox.push({ t: 'attack', attack });
    host.client.afterTick(hs);
    await settle();
    expect(seen(gs).attacks).toEqual([attack]);
    expect(guest.client.hasPeer).toBe(true);
  });

  it('messages queued while disconnected wait in the outbox and go out on reconnect', async () => {
    const { host, guest, a, hs, gs } = await matchUp();
    a.close();
    await settle();
    hs.mp!.outbox.push({ t: 'chat', text: 'back soon' });
    host.client.afterDispatch(hs, { type: 'mpChat' } as any);
    await settle();
    expect(hs.mp!.outbox).toHaveLength(1);

    const [a2, b2] = LoopbackTransport.pair();
    host.client.attach(a2);
    guest.client.attach(b2);
    await settle();
    expect(seen(gs).chats).toEqual(['back soon']);
    expect(hs.mp!.outbox).toHaveLength(0);
  });
});

describe('disconnects', () => {
  it('a closed link pauses both sides and reports disconnected', async () => {
    const { host, guest, a, hs, gs } = await matchUp();
    a.close();
    await settle();
    expect(hs.mp!.connected).toBe(false);
    expect(gs.mp!.connected).toBe(false);
    expect(host.events.at(-1)).toMatchObject({ kind: 'disconnected' });
    expect(guest.events.at(-1)).toMatchObject({ kind: 'disconnected' });
    expect(guest.client.canTick(gs)).toBe(false);
    expect(guest.client.effectiveSpeed(gs)).toBe(0);
    expect(host.client.effectiveSpeed(hs)).toBe(0);
  });

  it('a bye from the host drops the guest link and reports the host left', async () => {
    const { guest, a, gs } = await matchUp();
    a.send({ t: 'bye' });
    await settle();
    expect(gs.mp!.connected).toBe(false);
    expect(guest.client.hasPeer).toBe(false);
    expect(guest.events).toContainEqual({ kind: 'disconnected', detail: 'Host left the match.' });
  });

  it('a bye from the guest keeps the host listening: a new hello on the host link welcomes the rival back', async () => {
    const { host, b, hs } = await matchUp();
    b.send({ t: 'bye' });
    await settle();
    expect(hs.mp!.connected).toBe(false);
    expect(host.client.hasPeer).toBe(false);
    expect(host.events).toContainEqual({
      kind: 'disconnected',
      detail: 'Rival left the match. Waiting for them to rejoin.',
    });
    // The host's link is still open. A fresh hello arriving on it (the relay forwards guest frames) gets a welcome.
    b.send({ t: 'hello', name: 'Beta', color: '#e46fd0', version: PROTOCOL_VERSION });
    await settle();
    expect(hs.mp!.connected).toBe(true);
    expect(host.client.hasPeer).toBe(true);
  });
});

