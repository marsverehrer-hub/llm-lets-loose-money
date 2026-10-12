// Staff scene people. Seated at their desks. With high morale they walk over to a colleague in the same zone and chat
// for a few seconds; with middling morale they chat rarely; with low morale they sit slumped and never get up.
// Positions are floor units, the same grid as the HQ office.
import { hashStr } from '../../office/iso';
import type { RoleId } from '../../sim/types';
import type { Band, DeskSpot, Layout, Zone } from './layout';

const SPEED = 2.2;

export interface Person {
  /** Same as the desk key: `star:<id>` or `<role>:<k>`. */
  key: string;
  role: RoleId;
  seed: number;
  star: boolean;
  zone: Zone;
  desk: DeskSpot;
  x: number;
  y: number;
  path: number[];
  pi: number;
  mode: 'sit' | 'walk' | 'chat';
  goal: 'seat' | 'chat';
  timer: number;
  chatTime: number;
  partner: Person | null;
  walkPhase: number;
  /** > 0 while the speech dots show. */
  talk: number;
  /** Head position on screen, set by the renderer (for hover). */
  sx: number;
  sy: number;
}

/** Chair position of a desk, floor units. */
export function seatOf(d: DeskSpot): { x: number; y: number } {
  return { x: d.x + 0.65, y: d.y + 1.15 };
}

/** Walkway below a desk row. */
function aisleOf(d: DeskSpot): number {
  return d.y + 2.0;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class Crowd {
  people: Person[] = [];
  private byKey = new Map<string, Person>();

  /** Reconcile people with the desks of a layout. Existing people keep their state and move to their new seat. */
  sync(L: Layout): void {
    const next = new Map<string, Person>();
    for (const z of L.zones) {
      for (const d of z.desks) {
        if (d.kind === 'empty') continue;
        const seat = seatOf(d);
        let p = this.byKey.get(d.key);
        if (!p) {
          p = {
            key: d.key,
            role: d.role ?? 'researcher',
            seed: Math.floor(hashStr(d.key) * 1000003),
            star: d.kind === 'star',
            zone: z,
            desk: d,
            x: seat.x,
            y: seat.y,
            path: [],
            pi: 0,
            mode: 'sit',
            goal: 'seat',
            timer: rand(2, 12),
            chatTime: 0,
            partner: null,
            walkPhase: 0,
            talk: 0,
            sx: 0,
            sy: 0,
          };
        } else {
          p.desk = d;
          p.zone = z;
          p.star = d.kind === 'star';
        }
        if (p.mode === 'sit') {
          p.x = seat.x;
          p.y = seat.y;
        }
        next.set(d.key, p);
      }
    }
    this.byKey = next;
    this.people = [...next.values()];
  }

  update(dt: number, band: Band): void {
    for (const p of this.people) {
      if (p.talk > 0) p.talk = Math.max(0, p.talk - dt);
      if (p.mode === 'sit') {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = rand(7, 16);
          const odds = band === 'high' ? 0.5 : band === 'mid' ? 0.12 : 0;
          if (odds > 0 && Math.random() < odds) this.startChat(p);
        }
      } else if (p.mode === 'walk') {
        this.stepWalk(p, dt);
      } else {
        p.timer -= dt;
        if (p.timer <= 0) this.startHome(p);
      }
    }
  }

  private startChat(p: Person): void {
    const mates = this.people.filter((q) => q !== p && q.zone.id === p.zone.id && q.mode === 'sit');
    if (mates.length === 0) return;
    const m = mates[Math.floor(Math.random() * mates.length)];
    const seat = seatOf(p.desk);
    const aisle = aisleOf(p.desk);
    const tAisle = aisleOf(m.desk);
    const corridor = p.zone.x + 0.25;
    // Out of the chair, down the aisle, along the zone's free left margin, then to the spot beside the colleague.
    p.path = [seat.x, aisle, corridor, aisle, corridor, tAisle, m.x + 0.5, tAisle];
    p.pi = 0;
    p.mode = 'walk';
    p.goal = 'chat';
    p.chatTime = rand(4, 7);
    p.partner = m;
  }

  private startHome(p: Person): void {
    const seat = seatOf(p.desk);
    const aisle = aisleOf(p.desk);
    const corridor = p.zone.x + 0.25;
    p.path = [corridor, p.y, corridor, aisle, seat.x, aisle, seat.x, seat.y];
    p.pi = 0;
    p.mode = 'walk';
    p.goal = 'seat';
    p.partner = null;
    p.talk = 0;
  }

  private stepWalk(p: Person, dt: number): void {
    let budget = SPEED * dt;
    let moved = false;
    while (budget > 0 && p.pi * 2 < p.path.length) {
      const tx = p.path[p.pi * 2];
      const ty = p.path[p.pi * 2 + 1];
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        p.x = tx;
        p.y = ty;
        budget -= d;
        p.pi++;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
      }
      moved = true;
    }
    if (moved) p.walkPhase += dt * 9;
    if (p.pi * 2 >= p.path.length) {
      p.walkPhase = 0;
      if (p.goal === 'chat') {
        p.mode = 'chat';
        p.timer = p.chatTime;
        p.talk = p.chatTime;
        if (p.partner) p.partner.talk = p.chatTime;
      } else {
        const seat = seatOf(p.desk);
        p.mode = 'sit';
        p.x = seat.x;
        p.y = seat.y;
        p.timer = rand(8, 20);
        p.talk = 0;
      }
    }
  }
}
