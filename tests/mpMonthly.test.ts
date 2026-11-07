import { describe, it, expect } from 'vitest';
import { isMonthStart, monthBoundaryHolds, monthHeld } from '../src/sim/monthly';
import { dispatch, tick } from '../src/sim/engine';
import { createInitialState } from '../src/sim/state';
import type { GameAction, GameState, MpSettings } from '../src/sim/types';
import { MpClient, type MpEvent } from '../src/net/client';
import { LoopbackTransport } from '../src/net/transport';
import { decodeNetMsg } from '../src/net/protocol';

// Day 31 is 1 February 2017 and day 59 is 1 March 2017 (day 0 is 1 January 2017).
const FEB = 31;
const MAR = 59;

describe('month boundaries (pure)', () => {
  it('a month starts on the 1st, except the first day of the match', () => {
    expect(isMonthStart(0)).toBe(false);
    expect(isMonthStart(FEB)).toBe(true);
    expect(isMonthStart(FEB - 1)).toBe(false);
    expect(isMonthStart(MAR)).toBe(true);
  });

  it('holds on a month start until both players are ready for that day', () => {
    expect(monthBoundaryHolds(FEB, 0, 0)).toBe(true);
    expect(monthBoundaryHolds(FEB, FEB, 0)).toBe(true);
    expect(monthBoundaryHolds(FEB, 0, FEB)).toBe(true);
    expect(monthBoundaryHolds(FEB, FEB, FEB)).toBe(false);
  });

  it('never holds mid-month, and a Ready from a later month also releases an earlier boundary', () => {
    expect(monthBoundaryHolds(FEB + 5, 0, 0)).toBe(false);
    expect(monthBoundaryHolds(FEB, MAR, MAR)).toBe(false);
  });

  it('only holds a match that is in month-by-month mode and has no result', () => {
    const s = createInitialState(7, 'Test');
    s.day = FEB;
    s.mp = {
      role: 'host',
      room: 'ABCDEF',
      settings: { lengthYears: null } as MpSettings,
      myColor: '#5fb3f0',
      rival: null,
      rivalDay: FEB,
      connected: true,
      outbox: [],
      cooldowns: {},
      log: [],
      history: [],
      result: null,
    };
    expect(monthHeld(s)).toBe(false);
    s.mp.settings.monthly = true;
    expect(monthHeld(s)).toBe(true);
    s.mp.result = { winner: 'draw', reason: 'test', day: FEB };
    expect(monthHeld(s)).toBe(false);
  });
});

describe('wire format', () => {
  it('the day message carries the Ready day, optionally', () => {
    expect(decodeNetMsg('{"t":"day","day":31,"speed":1,"ready":31}')).toEqual({ t: 'day', day: 31, speed: 1, ready: 31 });
    expect(decodeNetMsg('{"t":"day","day":31,"speed":1,"ready":"x"}')).toBeNull();
  });
});

// Two real sims (no mocks) connected by a loopback link. Both drive their own clock the way the frame loop does:
// tick while the client allows it, and let messages land in between.
interface Side {
  client: MpClient;
  holder: { s: GameState | null };
  events: MpEvent[];
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

function side(role: 'host' | 'guest', name: string, color: string, settings: MpSettings): Side {
  const holder = { s: null as GameState | null };
  const events: MpEvent[] = [];
  const client = new MpClient({
    role,
    room: 'ABCDEF',
    companyName: name,
    color,
    settings,
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

async function runUntilStuck(sides: Side[]) {
  for (let round = 0; round < 400; round++) {
    let moved = 0;
    for (const sd of sides) {
      const s = sd.holder.s!;
      while (sd.client.canTick(s)) {
        const before = s.day;
        tick(s);
        sd.client.afterTick(s);
        if (s.day === before) {
          // Only a pending event stops the sim here. The test has no player to answer it, so it dismisses it.
          if (!s.events.pending) break;
          s.events.pending = null;
          continue;
        }
        moved++;
      }
    }
    await settle();
    if (moved === 0) return;
  }
}

describe('month-by-month match over the link', () => {
  it('both sims stop on the same month start and resume only when both have pressed Ready', async () => {
    const host = side('host', 'Alpha', '#5fb3f0', { lengthYears: null, monthly: true });
    const guest = side('guest', 'Beta', '#e46fd0', { lengthYears: null });
    const [a, b] = LoopbackTransport.pair();
    host.client.attach(a);
    guest.client.attach(b);
    await settle();
    const hs = host.holder.s!;
    const gs = guest.holder.s!;
    expect(gs.mp!.settings.monthly).toBe(true); // the guest takes the host's settings

    await runUntilStuck([host, guest]);
    expect(hs.day).toBe(FEB);
    expect(gs.day).toBe(FEB);
    expect(host.events.filter((e) => e.kind === 'month').pop()).toEqual({ kind: 'month', held: true });

    const press = (sd: Side, action: GameAction) => {
      const s = sd.holder.s!;
      dispatch(s, action);
      sd.client.afterDispatch(s, action);
    };

    press(host, { type: 'mpMonthReady' });
    await runUntilStuck([host, guest]);
    expect(hs.day).toBe(FEB); // one Ready is not enough
    expect(gs.day).toBe(FEB);
    expect(gs.mp!.rivalMonthReady).toBe(FEB);

    press(guest, { type: 'mpMonthReady' });
    await runUntilStuck([host, guest]);
    expect(hs.day).toBe(MAR); // play went on through February and stopped at 1 March
    expect(gs.day).toBe(MAR);
    expect(host.events.filter((e) => e.kind === 'month').pop()).toEqual({ kind: 'month', held: true });
  });
});
