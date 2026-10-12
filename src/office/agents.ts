// Walking/sitting people. Pure sim of positions in floor units; rendering lives in scene.ts.
import type { Role } from './draw/furniture';
import { CHAIR_DX, CHAIR_DY } from './draw/furniture';

export const MAX_PEOPLE = 60;
const SPEED = 2.4; // floor units per second

export interface DeskSlot {
  x: number; // desk top-left (floor units)
  y: number;
  role: Role;
  index: number;
}

export interface Stops {
  coffee: { x: number; y: number };   // stand point in front of the coffee machine
  corridorX: number;                  // free vertical walkway x
  /** Whiteboard stand points keyed by desk index (researchers only). */
  board: Map<number, { x: number; y: number }>;
}

export interface Person {
  role: Role;
  seed: number;
  desk: DeskSlot;
  x: number;
  y: number;
  /** Flat [x0,y0,x1,y1,...] waypoints still to visit. */
  path: number[];
  pi: number;
  goal: 'seat' | 'coffee' | 'board';
  state: 'sit' | 'walk' | 'idle';
  timer: number;
  walkPhase: number;
  /** Last projected screen position (set by renderer; used for hover). */
  sx: number;
  sy: number;
}

export function chairOf(d: DeskSlot): { x: number; y: number } {
  return { x: d.x + CHAIR_DX + 0.2, y: d.y + CHAIR_DY + 0.2 };
}

function aisleY(d: DeskSlot): number {
  return d.y + 1.7;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Waypoints from the seat out to a stop: down to aisle, along to corridor, then to the stop. */
function outbound(seat: { x: number; y: number }, d: DeskSlot, stop: { x: number; y: number }, corridorX: number): number[] {
  const ay = aisleY(d);
  return [seat.x, ay, corridorX, ay, corridorX, stop.y, stop.x, stop.y];
}

export class Crowd {
  people: Person[] = [];
  private sig = '';
  private stops: Stops | null = null;

  /** Reconcile people with the desk list. Keeps existing people when their desk survives. */
  sync(desks: DeskSlot[], stops: Stops): void {
    this.stops = stops;
    const n = Math.min(desks.length, MAX_PEOPLE);
    const next: Person[] = [];
    for (let i = 0; i < n; i++) {
      const d = desks[i];
      const seat = chairOf(d);
      const prev = this.people[i];
      if (prev && prev.role === d.role) {
        prev.desk = d;
        if (prev.goal === 'seat' && prev.state === 'sit') {
          prev.x = seat.x;
          prev.y = seat.y;
        }
        next.push(prev);
      } else {
        next.push({
          role: d.role,
          seed: (i * 2654435761) >>> 0,
          desk: d,
          x: seat.x,
          y: seat.y,
          path: [],
          pi: 0,
          goal: 'seat',
          state: 'sit',
          timer: rand(2, 12),
          walkPhase: 0,
          sx: 0,
          sy: 0,
        });
      }
    }
    this.people = next;
    this.sig = desks.length + ':' + n;
  }

  update(dt: number): void {
    const stops = this.stops;
    if (!stops) return;
    for (const p of this.people) {
      if (p.state === 'sit') {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = rand(10, 28);
          // Only sometimes get up: coffee most of the time, whiteboard if researcher.
          const roll = Math.random();
          const board = p.role === 'researcher' ? stops.board.get(p.desk.index) : undefined;
          if (roll < 0.25) {
            this.startWalk(p, stops.coffee, 'coffee', stops.corridorX);
          } else if (roll < 0.45 && board) {
            this.startWalk(p, board, 'board', stops.corridorX);
          }
        }
      } else if (p.state === 'walk') {
        this.stepWalk(p, dt);
      } else {
        // idle at the coffee machine / whiteboard
        p.timer -= dt;
        if (p.timer <= 0) {
          // Return route: stop -> corridor -> aisle -> seat.
          const seat = chairOf(p.desk);
          const ay = aisleY(p.desk);
          p.path = [stops.corridorX, p.y, stops.corridorX, ay, seat.x, ay, seat.x, seat.y];
          p.pi = 0;
          p.goal = 'seat';
          p.state = 'walk';
        }
      }
    }
  }

  private startWalk(p: Person, stop: { x: number; y: number }, goal: 'coffee' | 'board', corridorX: number): void {
    const seat = chairOf(p.desk);
    const jitter = (p.seed % 5) * 0.08 - 0.16;
    const target = { x: stop.x + jitter, y: stop.y };
    // from the seat (or current spot) out to the stop
    p.path = outbound(seat, p.desk, target, corridorX);
    p.x = seat.x;
    p.y = seat.y;
    p.pi = 0;
    p.goal = goal;
    p.state = 'walk';
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
        moved = true;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
        moved = true;
      }
    }
    if (moved) p.walkPhase += dt * 9;
    if (p.pi * 2 >= p.path.length) {
      if (p.goal === 'seat') {
        p.state = 'sit';
        p.walkPhase = 0;
        const seat = chairOf(p.desk);
        p.x = seat.x;
        p.y = seat.y;
        p.timer = rand(6, 20);
      } else {
        p.state = 'idle';
        p.walkPhase = 0;
        p.timer = rand(2.5, 6);
      }
    }
  }
}
