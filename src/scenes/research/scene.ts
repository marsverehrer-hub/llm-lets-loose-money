// Research lab scene: an isometric lab with one desk pod per research branch, a central projector for the current topic,
// a "next up" board for the queue, a star bay, and a coffee lounge that fills up when research is idle.
import type { GameState } from '../../sim/types';
import { RESEARCH_BRANCHES } from '../../sim/types';
import { RESEARCH } from '../../sim/data/research';
import { effectiveResearchCost } from '../../sim/systems/research';
import { formatNumber } from '../../sim/util';
import { BRANCH_LABEL, NODE_BY_ID, branchOf, etaText } from '../../ui/panels/research/model';
import { TILE_H, TILE_W, project, prand, type Projector } from '../../office/iso';
import { C, mix, shade } from '../../office/palette';
import { Ctx, floorLine, floorTile, glow, isoBlock, planeX, planeY, poly, withAlpha } from '../../office/draw/prims';
import { drawCoffee, drawPlant } from '../../office/draw/furniture';
import { drawPerson } from '../../office/draw/person';
import { drawFloor, drawNeonStrip, drawWalls } from '../../office/draw/room';
import type { Scene, SceneHit } from '../types';
import {
  allocateResearchers,
  BOARD_Z0,
  BOARD_Z1,
  COFFEE,
  convexHull,
  DESK_D,
  DESK_TOP,
  DESK_W,
  deskXY,
  inHull,
  LOUNGE,
  LOUNGE_SHOW,
  loungeSpot,
  PLANT,
  type Pod,
  POD_D,
  POD_W,
  PODS,
  PROJ_X0,
  PROJ_X1,
  PROJ_Z0,
  PROJ_Z1,
  QUEUE_Y0,
  QUEUE_Y1,
  QUEUE_Z0,
  QUEUE_Z1,
  ROOM_D,
  ROOM_W,
  seatXY,
  SLOTS,
  STAR_BAY_X1,
  STAR_MAX,
  STAR_STEP,
  STAR_X0,
  STAR_Y,
  starDeskXY,
  starSeatXY,
  TOPICS_PER_BRANCH,
  WALL_H,
} from './layout';

const BRANCH_INDEX = new Map<string, number>(RESEARCH_BRANCHES.map((b, i) => [b, i] as const));
const NODE_BRANCH = new Map<string, number>(RESEARCH.map((n) => [n.id, BRANCH_INDEX.get(branchOf(n)) ?? 0] as const));
const TOTAL_TOPICS = RESEARCH.length;
const POD_ACTORS = PODS.length * SLOTS;
const ACTOR_MAX = POD_ACTORS + STAR_MAX;
const QUEUE_SHOW = 6;
const SCRIBBLE_COLS = 9;
const SCRIBBLE_ROWS = 4;
const SCRIBBLE_CELLS = SCRIBBLE_COLS * SCRIBBLE_ROWS;
const STICKY = [C.amber, C.blue, C.green, C.yellow, C.red];
const SKY = '#0b0a08';
const FONT = 'IBM Plex Mono, monospace';
const LEAN = 0.12;
// Whiteboards are dimmed so they read as lab furniture, not as the brightest thing in the room.
const BOARD_FACE = mix(C.whiteboard, '#000000', 0.4);

const K_BOARD = 0;
const K_DESK = 1;
const K_CHAIR = 2;
const K_ACTOR = 3;
const K_COFFEE = 4;
const K_PLANT = 5;
const K_SDESK = 6;
const K_SCHAIR = 7;

interface Item {
  d: number;
  kind: number;
  a: number;
  b: number;
}

interface Actor {
  /** Where the person is drawn now. */
  x: number;
  y: number;
  /** Where they are heading: a chair, or a spot in the lounge. */
  tx: number;
  ty: number;
  /** The chair itself (for seated people). */
  sx: number;
  sy: number;
  vis: boolean;
  seated: boolean;
  star: boolean;
  /** Pod index of a researcher, -1 for a star. */
  pod: number;
  /** Set on the first frame after appearing: snap to the target instead of walking in. */
  spawn: boolean;
  walkPhase: number;
  moving: boolean;
  seed: number;
}

/** Fixed scatter order for the whiteboard cells, so the scribbles fill in a stable pattern. */
const SCRIBBLE_RANK: number[] = (() => {
  const order = Array.from({ length: SCRIBBLE_CELLS }, (_, i) => i);
  order.sort((a, b) => prand(a * 13.7 + 7) - prand(b * 13.7 + 7));
  const rank = new Array<number>(SCRIBBLE_CELLS);
  order.forEach((cell, r) => (rank[cell] = r));
  return rank;
})();

/** Set the largest font (down from maxPx, not below minPx) at which `text` fits in maxW. Leaves the font set on g. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, maxPx: number, minPx: number, weight = 600): void {
  let px = maxPx;
  g.font = `${weight} ${px.toFixed(1)}px ${FONT}`;
  while (px > minPx && g.measureText(text).width > maxW) {
    px -= 0.5;
    g.font = `${weight} ${px.toFixed(1)}px ${FONT}`;
  }
}

/** Terminal label in the office style: black box, hairline border. */
function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  g.save();
  g.font = `600 11px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = 20;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  g.fillStyle = C.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, px + w / 2, py + h / 2 - 0.5);
  g.restore();
}

/** Office chair: seat and back, kept to two blocks so a full room stays cheap to draw. */
function drawChairLite(c: Ctx, dx: number, dy: number): void {
  const cx = dx + 0.4;
  const cy = dy + 0.78;
  isoBlock(c, cx, cy, 0.4, 0.4, 5, 9, C.chairSeat, shade(C.chairSeat, 0.7), shade(C.chairSeat, 0.85));
  planeY(c, cx + 0.04, cx + 0.36, cy - 0.06, 9, 19, C.chairBack);
}

/** One desk: a slab on one front leg, keyboard and a monitor. `on` is screen brightness 0..1, `flick` a 0..1 ripple. */
function drawDesk(c: Ctx, dx: number, dy: number, on: number, flick: number, star: boolean): void {
  const { g } = c;
  isoBlock(c, dx + DESK_W - 0.12, dy + DESK_D - 0.12, 0.07, 0.07, 0, DESK_TOP - 3, C.deskLeg);
  isoBlock(c, dx, dy, DESK_W, DESK_D, DESK_TOP - 3, DESK_TOP, star ? mix(C.deskTop, C.amber, 0.4) : C.deskTop, C.deskSide, shade(C.deskSide, 0.85));
  floorTile(c, dx + 0.35, dy + 0.42, 0.42, 0.14, C.keyboard, DESK_TOP);
  planeY(c, dx + 0.3, dx + 0.9, dy + 0.12, DESK_TOP, DESK_TOP + 14, C.monitorBezel);
  const pts = planeY(c, dx + 0.33, dx + 0.87, dy + 0.12, DESK_TOP + 3.5, DESK_TOP + 12.5, C.monitorScreen);
  if (on > 0.02) {
    const w = Math.abs(pts[2] - pts[0]);
    const h = Math.abs(pts[5] - pts[1]);
    g.save();
    g.fillStyle = star ? C.yellow : C.amber;
    g.globalAlpha = on * (0.35 + 0.45 * flick);
    for (let k = 0; k < 4; k++) {
      const ly = pts[1] + ((k + 1) / 5) * (pts[5] - pts[1]);
      const lw = w * (0.35 + 0.5 * (((k * 37 + Math.floor(flick * 7)) % 7) / 7));
      g.fillRect(pts[0] + w * 0.08, ly - h * 0.05, lw, Math.max(1, h * 0.06));
    }
    g.restore();
  }
}

export class ResearchScene implements Scene {
  private cssW = 1;
  private cssH = 1;
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private time = 0;

  /** Latest state, set every frame; tips read it on hover. */
  private st: GameState | null = null;
  private idle = true;
  private cur = -1;
  private curId: string | null = null;
  private researchers = 0;
  private stars: { name: string; title: string }[] = [];
  private done = new Array<number>(RESEARCH_BRANCHES.length).fill(0);
  private doneAll = 0;

  /** Researchers per pod, and how many of them get a chair (the rest are only counted). */
  private podN: number[] = new Array(PODS.length).fill(0);
  private podSeated: number[] = new Array(PODS.length).fill(0);
  private starSeated = 0;
  /** While idle: how many people are in the lounge in total (drawn or not). */
  private loungeTotal = 0;
  private seatKey = -1;
  private actors: Actor[] = [];

  private pool: Item[] = [];
  private order: Item[] = [];
  private baseCanvas: HTMLCanvasElement | null = null;
  private baseKey = '';

  private hitPods: { i: number; hull: number[] }[] = [];
  private hitProj: number[] = [];
  private hitQueue: number[] = [];
  private hitStars: number[] = [];

  constructor() {
    for (let i = 0; i < 256; i++) this.pool.push({ d: 0, kind: 0, a: 0, b: 0 });
    for (let i = 0; i < ACTOR_MAX; i++) {
      this.actors.push({
        x: LOUNGE.x,
        y: LOUNGE.y,
        tx: LOUNGE.x,
        ty: LOUNGE.y,
        sx: LOUNGE.x,
        sy: LOUNGE.y,
        vis: false,
        seated: false,
        star: i >= POD_ACTORS,
        pod: -1,
        spawn: false,
        walkPhase: 0,
        moving: false,
        seed: i * 7 + 3,
      });
    }
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
    this.buildHits();
    this.baseKey = '';
  }

  /** Fit the room footprint into the canvas, the same way the HQ office does. */
  private fit(): void {
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const X = ROOM_W;
    const Y = ROOM_D;
    const s = Math.min(availW / (((X + Y) * TILE_W) / 2), availH / (((X + Y) * TILE_H) / 2 + WALL_H), 2.6);
    const sc = Math.max(0.35, s);
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - (((X - Y) * TILE_W) / 4) * sc;
    this.proj.oy = this.cssH / 2 - (((X + Y) * TILE_H) / 4 - WALL_H / 2) * sc;
  }

  private screen(x: number, y: number, z: number): [number, number] {
    return project(this.proj, x, y, z);
  }

  /** Convex screen-space hull of a floor box from z 0 up to z1. */
  private hullOf(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number[] {
    const flat: number[] = [];
    for (const x of [x0, x1])
      for (const y of [y0, y1])
        for (const z of [z0, z1]) {
          const [sx, sy] = this.screen(x, y, z);
          flat.push(sx, sy);
        }
    return convexHull(flat);
  }

  private buildHits(): void {
    this.hitPods = PODS.map((p) => ({ i: p.i, hull: this.hullOf(p.px, p.px + POD_W, p.py - 0.1, p.py + POD_D, 0, BOARD_Z1 + 8) }));
    this.hitProj = this.hullOf(PROJ_X0, PROJ_X1, 0, 0.1, PROJ_Z0 - 2, PROJ_Z1 + 2);
    this.hitQueue = this.hullOf(0, 0.1, QUEUE_Y0, QUEUE_Y1, QUEUE_Z0 - 2, QUEUE_Z1 + 2);
    this.hitStars = this.hullOf(STAR_X0 - 0.2, STAR_BAY_X1, STAR_Y - 0.3, STAR_Y + 1.8, 0, 30);
  }

  /** Read the state into plain numbers. Runs every frame. */
  private snapshot(s: GameState): void {
    this.st = s;
    this.researchers = Math.max(0, Math.floor(s.staff.roles.researcher?.count ?? 0));
    this.stars.length = 0;
    for (const st of s.staff.stars) if (st.role === 'researcher' && st.hiredDay !== null) this.stars.push({ name: st.name, title: st.title });
    this.curId = s.research.current;
    this.idle = !this.curId;
    const node = this.curId ? NODE_BY_ID.get(this.curId) : undefined;
    this.cur = node ? BRANCH_INDEX.get(branchOf(node)) ?? -1 : -1;
    this.done.fill(0);
    this.doneAll = 0;
    for (const id of s.research.completed) {
      const b = NODE_BRANCH.get(id);
      if (b !== undefined) this.done[b]++;
      this.doneAll++;
    }
  }

  private seatKeyOf(): number {
    const stars = Math.min(STAR_MAX, this.stars.length);
    return ((this.researchers * 16 + stars) * 2 + (this.idle ? 1 : 0)) * 16 + (this.cur + 1);
  }

  /** Give every visible person a chair (or a lounge spot while idle). Runs when the seating key changes. */
  private reseat(): void {
    const podN = allocateResearchers(this.researchers);
    let a = 0;
    for (const pod of PODS) {
      this.podN[pod.i] = podN[pod.i];
      const seated = Math.min(SLOTS, podN[pod.i]);
      this.podSeated[pod.i] = seated;
      for (let k = 0; k < SLOTS; k++) {
        const act = this.actors[a++];
        if (k >= seated) {
          act.vis = false;
          continue;
        }
        const [sx, sy] = seatXY(pod, k);
        this.show(act);
        act.pod = pod.i;
        act.star = false;
        act.seated = true;
        act.sx = sx;
        act.sy = sy;
      }
    }
    this.starSeated = Math.min(STAR_MAX, this.stars.length);
    for (let j = 0; j < STAR_MAX; j++) {
      const act = this.actors[POD_ACTORS + j];
      if (j >= this.starSeated) {
        act.vis = false;
        continue;
      }
      const [sx, sy] = starSeatXY(j);
      this.show(act);
      act.pod = -1;
      act.star = true;
      act.seated = true;
      act.sx = sx;
      act.sy = sy;
    }
    this.placeTargets();
  }

  private show(act: Actor): void {
    if (!act.vis) act.spawn = true;
    act.vis = true;
  }

  /** Targets for the current mode: chairs while research runs (the active branch leans in), the lounge while idle. */
  private placeTargets(): void {
    let lounge = 0;
    // Everyone counts as chatting while idle, including researchers past the desks and stars past the bay.
    this.loungeTotal = this.idle ? this.researchers + this.stars.length : 0;
    for (const act of this.actors) {
      if (!act.vis) continue;
      if (this.idle) {
        // Everyone is in the lounge; only the first few are drawn, the rest are counted in a pill.
        if (lounge < LOUNGE_SHOW) {
          [act.tx, act.ty] = loungeSpot(lounge);
          act.seated = false;
        } else {
          act.vis = false;
        }
        lounge++;
      } else {
        const lean = !act.star && act.pod === this.cur ? LEAN : 0;
        act.tx = act.sx;
        act.ty = act.sy - lean;
        act.seated = true;
      }
    }
  }

  /** Walk everyone toward their targets. */
  private update(dt: number): void {
    const k = 1 - Math.exp(-dt * 2.2);
    for (const act of this.actors) {
      if (!act.vis) continue;
      if (act.spawn) {
        act.x = act.tx;
        act.y = act.ty;
        act.spawn = false;
      }
      const dx = act.tx - act.x;
      const dy = act.ty - act.y;
      act.x += dx * k;
      act.y += dy * k;
      act.moving = dx * dx + dy * dy > 0.0036;
      if (act.moving) act.walkPhase += dt * 9;
      else act.walkPhase = 0;
    }
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.time += dt;
    const t = this.time;
    this.snapshot(s);
    const key = this.seatKeyOf();
    if (key !== this.seatKey) {
      this.seatKey = key;
      this.reseat();
    }
    this.update(dt);

    // Static shell: cached as a bitmap per canvas size.
    const dpr = this.cssW > 0 ? g.canvas.width / this.cssW : 1;
    const key2 = `${this.cssW}|${this.cssH}|${dpr}`;
    if (!this.baseCanvas || this.baseKey !== key2) this.buildBase(dpr);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.baseCanvas as HTMLCanvasElement, 0, 0);
    g.restore();

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    const s1 = this.proj.scale;

    // Things on the walls and floor under the people: queue board, projector, the topic beam, the active pod's glow.
    this.drawQueue(c, s);
    this.drawProjector(c, s, t);
    if (this.cur >= 0 && !this.idle) {
      const pod = PODS[this.cur];
      const [cx, cy] = this.screen(pod.px + POD_W / 2, pod.py + POD_D / 2, 0);
      glow(g, cx, cy, 70 * s1, C.amber, 0.12 + 0.04 * Math.sin(t * 2.4));
      const [u0, z0] = this.screen(PROJ_X0 + 0.6, 0.05, PROJ_Z0);
      const [u1] = this.screen(PROJ_X1 - 0.6, 0.05, PROJ_Z0);
      const [tx, ty] = this.screen(pod.px + POD_W / 2, pod.py, BOARD_Z1 + 4);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = withAlpha(C.amber, 0.05 + 0.015 * Math.sin(t * 3));
      g.beginPath();
      g.moveTo(u0, z0);
      g.lineTo(u1, z0);
      g.lineTo(tx, ty);
      g.closePath();
      g.fill();
      g.restore();
    }

    // Depth-sorted pieces.
    const items = this.pool;
    let n = 0;
    const push = (d: number, kind: number, a: number, b: number) => {
      const it = items[n++];
      it.d = d;
      it.kind = kind;
      it.a = a;
      it.b = b;
    };
    for (const pod of PODS) {
      push(pod.px + POD_W / 2 + pod.py, K_BOARD, pod.i, 0);
      const desks = Math.max(1, Math.min(SLOTS, this.podN[pod.i]));
      for (let k = 0; k < desks; k++) {
        const [dx, dy] = deskXY(pod, k);
        push(dx + dy + 0.95, K_DESK, pod.i, k);
        push(dx + dy + 1.3, K_CHAIR, pod.i, k);
      }
    }
    const starDesks = Math.max(2, this.starSeated);
    for (let j = 0; j < Math.min(STAR_MAX, starDesks); j++) {
      const [dx, dy] = starDeskXY(j);
      push(dx + dy + 0.95, K_SDESK, j, 0);
      push(dx + dy + 1.3, K_SCHAIR, j, 0);
    }
    for (let i = 0; i < this.actors.length; i++) {
      const act = this.actors[i];
      if (act.vis) push(act.x + act.y + 0.02, K_ACTOR, i, 0);
    }
    push(COFFEE.x + COFFEE.y + 0.9, K_COFFEE, 0, 0);
    push(PLANT.x + PLANT.y + 0.5, K_PLANT, 0, 0);

    const order = this.order;
    order.length = 0;
    for (let i = 0; i < n; i++) order.push(items[i]);
    order.sort((a, b) => a.d - b.d);

    for (const it of order) {
      switch (it.kind) {
        case K_BOARD:
          this.drawBoard(c, PODS[it.a], t);
          break;
        case K_DESK: {
          const pod = PODS[it.a];
          const [dx, dy] = deskXY(pod, it.b);
          const occupied = it.b < this.podSeated[pod.i];
          const on = this.idle || !occupied ? 0 : pod.i === this.cur ? 1 : 0.55;
          drawDesk(c, dx, dy, on, 0.5 + 0.5 * Math.sin(t * (3 + it.b) + pod.i * 1.7), false);
          break;
        }
        case K_CHAIR: {
          const [dx, dy] = deskXY(PODS[it.a], it.b);
          drawChairLite(c, dx, dy);
          break;
        }
        case K_SDESK: {
          const [dx, dy] = starDeskXY(it.a);
          const occupied = it.a < this.starSeated;
          const on = this.idle || !occupied ? 0 : 1;
          drawDesk(c, dx, dy, on, 0.5 + 0.5 * Math.sin(t * 4 + it.a), true);
          const [mx, my] = this.screen(dx + 0.6, dy + 0.3, DESK_TOP + 18);
          const r = 3.2 * s1 + 0.6;
          g.save();
          g.fillStyle = occupied ? C.amber : withAlpha(C.amber, 0.35);
          g.beginPath();
          g.moveTo(mx, my - r);
          g.lineTo(mx + r * 0.7, my);
          g.lineTo(mx, my + r);
          g.lineTo(mx - r * 0.7, my);
          g.closePath();
          g.fill();
          g.restore();
          if (occupied && !this.idle) {
            const [gx, gy] = this.screen(dx + 0.6, dy + 0.35, 0);
            glow(g, gx, gy, 22 * s1, C.amber, 0.14 + 0.05 * Math.sin(t * 2 + it.a));
          }
          break;
        }
        case K_SCHAIR: {
          const [dx, dy] = starDeskXY(it.a);
          drawChairLite(c, dx, dy);
          break;
        }
        case K_ACTOR:
          this.drawActor(c, this.actors[it.a], t);
          break;
        case K_COFFEE:
          drawCoffee(c, COFFEE.x, COFFEE.y, t);
          break;
        case K_PLANT:
          drawPlant(c, PLANT.x, PLANT.y, 1.1);
          break;
      }
    }

    // Overlays: crowd counts, idle chat, and the HUD line.
    for (const pod of PODS) {
      const nP = this.podN[pod.i];
      if (!this.idle && nP > SLOTS) {
        const [px, py] = this.screen(pod.px + POD_W / 2, pod.py + 0.2, BOARD_Z1 + 8);
        drawPill(g, px, py, `×${formatNumber(nP, 0)}`, C.amber);
      }
    }
    if (this.stars.length > STAR_MAX) {
      const [sx, sy] = this.screen(STAR_X0 + 1.5 * STAR_STEP, STAR_Y, 36);
      drawPill(g, sx, sy, `+${this.stars.length - STAR_MAX} stars`, C.amber);
    }
    if (this.idle && this.loungeTotal > LOUNGE_SHOW) {
      const [lx, ly] = this.screen(LOUNGE.x, LOUNGE.y, 40);
      drawPill(g, lx, ly, `×${formatNumber(this.loungeTotal, 0)} chatting`, C.amberDim);
    }
    this.drawChat(g, t);

    g.save();
    g.font = `10px ${FONT}`;
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(`${formatNumber(this.researchers)} RESEARCHERS · ${this.doneAll}/${TOTAL_TOPICS} TOPICS DONE`.toUpperCase(), this.cssW - 10, this.cssH - 8);
    g.restore();
  }

  /** Static room shell: floor, walls, pod mats, lounge rug, star bay, and the empty projector and board frames. */
  private buildBase(dpr: number): void {
    const cv = this.baseCanvas ?? document.createElement('canvas');
    cv.width = Math.max(1, Math.round(this.cssW * dpr));
    cv.height = Math.max(1, Math.round(this.cssH * dpr));
    this.baseCanvas = cv;
    this.baseKey = `${this.cssW}|${this.cssH}|${dpr}`;
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    const c: Ctx = { g, p: this.proj };
    drawFloor(c, ROOM_W, ROOM_D, 1, '#2b2824', '#26231f');
    drawWalls(c, ROOM_W, ROOM_D, WALL_H, '#34312c');
    drawNeonStrip(c, ROOM_W, ROOM_D, WALL_H, 0);

    for (const pod of PODS) {
      const x0 = pod.px - 0.12;
      const x1 = pod.px + POD_W + 0.12;
      const y0 = pod.py - 0.2;
      const y1 = pod.py + POD_D + 0.1;
      floorTile(c, x0, y0, x1 - x0, y1 - y0, '#24211d');
      floorLine(c, x0, y0, x1, y0, 0.2, 'rgba(110,106,99,0.35)', 1);
      floorLine(c, x1, y0, x1, y1, 0.2, 'rgba(110,106,99,0.2)', 1);
    }
    floorTile(c, LOUNGE.x - 2.3, LOUNGE.y - 2.0, 4.6, 4.0, '#2d2a25', 0.05);
    floorTile(c, STAR_X0 - 0.25, STAR_Y - 0.35, STAR_BAY_X1 - STAR_X0 + 0.3, 2.1, '#2a241b', 0.05);
    floorLine(c, STAR_X0 - 0.25, STAR_Y - 0.35, STAR_BAY_X1 + 0.05, STAR_Y - 0.35, 0.2, withAlpha(C.amberDim, 0.6), 1);

    planeY(c, PROJ_X0 - 0.3, PROJ_X1 + 0.3, 0.04, PROJ_Z0 - 2, PROJ_Z1 + 2, C.windowFrame);
    planeY(c, PROJ_X0, PROJ_X1, 0.05, PROJ_Z0, PROJ_Z1, SKY);
    planeX(c, 0.04, QUEUE_Y0 - 0.2, QUEUE_Y1 + 0.2, QUEUE_Z0 - 2, QUEUE_Z1 + 2, C.windowFrame);
    planeX(c, 0.05, QUEUE_Y0, QUEUE_Y1, QUEUE_Z0, QUEUE_Z1, '#1b1915');
  }

  /** Projector: topic, branch, progress bar, rate and ETA. Dark when idle. */
  private drawProjector(c: Ctx, s: GameState, t: number): void {
    const { g } = c;
    if (this.idle || !this.curId) return;
    const node = NODE_BY_ID.get(this.curId);
    if (!node) return;
    const cost = Math.max(1, effectiveResearchCost(s, node));
    const progress = s.research.progress;
    const frac = Math.min(1, progress / cost);
    const remaining = Math.max(0, cost - progress);
    const perDay = s.research.pointsPerDay;
    const s1 = this.proj.scale;
    const screenW = (PROJ_X1 - PROJ_X0) * (TILE_W / 2) * s1;
    const mid = (PROJ_X0 + PROJ_X1) / 2;
    const branchName = BRANCH_LABEL[branchOf(node)].toUpperCase();

    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let [tx, ty] = this.screen(mid, 0.06, PROJ_Z1 - 4);
    g.fillStyle = C.textDim;
    fitFont(g, branchName, screenW * 0.9, Math.max(6, 8 * s1), 5, 500);
    g.fillText(branchName, tx, ty);

    [tx, ty] = this.screen(mid, 0.06, PROJ_Z1 - 12);
    g.fillStyle = C.amber;
    fitFont(g, node.name, screenW * 0.9, Math.max(7, 13 * s1), 5, 600);
    g.fillText(node.name, tx, ty);

    const bz0 = PROJ_Z0 + 8;
    const bz1 = bz0 + 2.6;
    const u0 = PROJ_X0 + 1.1;
    const u1 = PROJ_X1 - 1.1;
    const bar = (ua: number, ub: number): number[] => {
      const a = this.screen(ua, 0.06, bz0);
      const b = this.screen(ub, 0.06, bz0);
      const cc = this.screen(ub, 0.06, bz1);
      const d = this.screen(ua, 0.06, bz1);
      return [a[0], a[1], b[0], b[1], cc[0], cc[1], d[0], d[1]];
    };
    poly(g, bar(u0, u1), '#2a2622');
    if (frac > 0) poly(g, bar(u0, u0 + (u1 - u0) * frac), C.amber);

    const readout = `${Math.round(frac * 100)}%  ·  +${formatNumber(perDay)} RP/day  ·  ${etaText(remaining, perDay)}`;
    [tx, ty] = this.screen(mid, 0.06, PROJ_Z0 + 3.5);
    g.fillStyle = C.fgDim;
    fitFont(g, readout, screenW * 0.92, Math.max(6, 8 * s1), 4.5, 500);
    g.fillText(readout, tx, ty);

    // A small live dot in the corner while the topic runs.
    g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3);
    const [ex, ey] = this.screen(PROJ_X1 - 0.5, 0.06, PROJ_Z1 - 1.5);
    g.fillStyle = C.amber;
    g.beginPath();
    g.arc(ex, ey, 1.6 * s1 + 0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** "Next up" board: the queue as sticky notes, the first one brightest. */
  private drawQueue(c: Ctx, s: GameState): void {
    const { g } = c;
    const queue = s.research.queue ?? [];
    const s1 = this.proj.scale;
    const boardPx = (QUEUE_Y1 - QUEUE_Y0) * (TILE_H / 2) * s1 * 2;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const [hx, hy] = this.screen(0.06, (QUEUE_Y0 + QUEUE_Y1) / 2, QUEUE_Z1 - 3);
    g.fillStyle = C.fgDim;
    fitFont(g, 'NEXT UP', boardPx * 0.9, Math.max(6, 8 * s1), 5, 600);
    g.fillText('NEXT UP', hx, hy);
    g.restore();

    const shown = Math.min(QUEUE_SHOW, queue.length);
    for (let i = 0; i < shown; i++) {
      const node = NODE_BY_ID.get(queue[i]);
      if (!node) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ya = QUEUE_Y0 + 0.3 + col * 2.8;
      const yb = ya + 2.4;
      const zt = QUEUE_Z1 - 6 - row * 9;
      const zb = zt - 7;
      const base = STICKY[(NODE_BRANCH.get(node.id) ?? 0) % STICKY.length];
      const fill = i === 0 ? base : mix(base, '#000000', 0.35);
      planeX(c, 0.08, ya, yb, zb, zt, fill);
      const code = BRANCH_LABEL[branchOf(node)].slice(0, 5).toUpperCase();
      const [cx, cy] = this.screen(0.1, (ya + yb) / 2, (zt + zb) / 2);
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#0a0a0a';
      fitFont(g, code, (yb - ya) * (TILE_H / 2) * s1 * 1.6, Math.max(6, 7 * s1), 5, 700);
      g.fillText(code, cx, cy);
      g.restore();
    }
    if (queue.length > QUEUE_SHOW) {
      const [mx, my] = this.screen(0.1, (QUEUE_Y0 + QUEUE_Y1) / 2, QUEUE_Z0 + 3);
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = C.fgDim;
      g.font = `500 ${Math.max(6, 7 * s1)}px ${FONT}`;
      g.fillText(`+${queue.length - QUEUE_SHOW} more`, mx, my);
      g.restore();
    }
  }

  /** Whiteboard for one branch. Scribbles fill in step with the share of that branch completed. */
  private drawBoard(c: Ctx, pod: Pod, t: number): void {
    const { g, p } = c;
    const x0 = pod.px + 0.3;
    const x1 = pod.px + POD_W - 0.3;
    const y = pod.py;
    const total = TOPICS_PER_BRANCH[pod.i] || 1;
    const done = this.done[pod.i];
    const frac = Math.min(1, done / total);
    planeY(c, x0, x1, y, BOARD_Z0, BOARD_Z1, C.whiteboardFrame);
    planeY(c, x0 + 0.05, x1 - 0.05, y, BOARD_Z0 + 1.5, BOARD_Z1 - 1.5, BOARD_FACE);

    const lit = Math.round(frac * SCRIBBLE_CELLS);
    if (lit > 0) {
      const cw = (x1 - x0 - 0.1) / SCRIBBLE_COLS;
      const ch = (BOARD_Z1 - BOARD_Z0 - 3) / SCRIBBLE_ROWS;
      g.save();
      g.lineWidth = Math.max(1, p.scale);
      g.globalAlpha = 0.85;
      for (let cell = 0; cell < SCRIBBLE_CELLS; cell++) {
        if (SCRIBBLE_RANK[cell] >= lit) continue;
        const cc = cell % SCRIBBLE_COLS;
        const cr = Math.floor(cell / SCRIBBLE_COLS);
        const u0 = x0 + 0.05 + cc * cw + cw * 0.12;
        const u1 = u0 + cw * 0.76;
        const zc = BOARD_Z0 + 3 + cr * ch + ch * 0.5;
        const wob = (prand(cell * 3.1 + pod.i) - 0.5) * ch * 0.5;
        g.strokeStyle = cell % 3 === 0 ? C.blue : C.amber;
        g.beginPath();
        for (let k = 0; k <= 3; k++) {
          const u = u0 + ((u1 - u0) * k) / 3;
          const z = zc + (k % 2 ? wob : -wob);
          const [sx, sy] = project(p, u, y + 0.01, z);
          if (k === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.stroke();
      }
      g.restore();
    }

    const [lx, ly] = project(p, pod.px + POD_W / 2, y + 0.02, BOARD_Z0 - 2);
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = C.textDim;
    g.font = `500 ${Math.max(6, 7 * p.scale)}px ${FONT}`;
    g.fillText(`${BRANCH_LABEL[pod.branch].slice(0, 6).toUpperCase()} ${done}/${total}`, lx, ly);
    g.restore();

    if (pod.i === this.cur && !this.idle) {
      planeY(c, x0, x1, y - 0.01, BOARD_Z1 + 0.5, BOARD_Z1 + 2.2, withAlpha(C.amber, 0.55 + 0.35 * Math.sin(t * 5)));
    }
  }

  private drawActor(c: Ctx, act: Actor, t: number): void {
    const sitting = act.seated && !act.moving && !this.idle;
    drawPerson(c, {
      x: act.x,
      y: act.y,
      role: 'researcher',
      seed: act.seed,
      sitting,
      typing: sitting,
      walkPhase: act.moving ? act.walkPhase : 0,
      highlight: act.star,
      t,
    });
  }

  /** Idle lounge: small chat bubbles over some of the standing people. */
  private drawChat(g: CanvasRenderingContext2D, t: number): void {
    if (!this.idle) return;
    const s1 = this.proj.scale;
    for (let i = 0; i < this.actors.length; i++) {
      const act = this.actors[i];
      if (!act.vis || i % 3 !== 0) continue;
      const [bx, by] = this.screen(act.x, act.y, 32);
      const ph = (t * 1.6 + act.seed) % 3;
      g.save();
      g.fillStyle = C.fgDim;
      for (let k = 0; k < 3; k++) {
        g.globalAlpha = k <= ph ? 0.85 : 0.2;
        g.beginPath();
        g.arc(bx + (k - 1) * 3 * s1, by - 2 * s1, 1.1 * s1 + 0.4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  hitTest(x: number, y: number): SceneHit | null {
    if (inHull(this.hitProj, x, y)) return { id: 'current', label: this.currentTip() };
    if (inHull(this.hitQueue, x, y)) return { id: 'queue', label: this.queueTip() };
    if (inHull(this.hitStars, x, y)) return { id: 'stars', label: this.starsTip() };
    for (let k = this.hitPods.length - 1; k >= 0; k--) {
      const hp = this.hitPods[k];
      if (inHull(hp.hull, x, y)) {
        const pod = PODS[hp.i];
        return { id: `branch:${pod.branch}`, label: this.branchTip(pod.i) };
      }
    }
    return null;
  }

  private currentTip(): string {
    const st = this.st;
    const node = this.curId ? NODE_BY_ID.get(this.curId) : undefined;
    if (!st || !node) return 'No topic running\nThe lab is idle. Pick a topic in Research.';
    const cost = Math.max(1, effectiveResearchCost(st, node));
    const progress = st.research.progress;
    const perDay = st.research.pointsPerDay;
    const pct = Math.round(Math.min(1, progress / cost) * 100);
    return [
      `Researching: ${node.name}`,
      `${BRANCH_LABEL[branchOf(node)]} · ${pct}% (${formatNumber(progress, 0)}/${formatNumber(cost, 0)} RP)`,
      `+${formatNumber(perDay)} RP/day · ${etaText(Math.max(0, cost - progress), perDay)} left`,
    ].join('\n');
  }

  private queueTip(): string {
    const q = this.st?.research.queue ?? [];
    if (q.length === 0) return 'Queue empty\nNothing lined up after the current topic.';
    const lines = [`Up next: ${q.length} topic${q.length === 1 ? '' : 's'} queued`];
    for (let i = 0; i < Math.min(5, q.length); i++) {
      const node = NODE_BY_ID.get(q[i]);
      if (node) lines.push(`${i + 1}. ${node.name} (${BRANCH_LABEL[branchOf(node)]})`);
    }
    if (q.length > 5) lines.push(`+${q.length - 5} more`);
    return lines.join('\n');
  }

  private starsTip(): string {
    if (this.stars.length === 0) return 'Star bay\nNo star researchers hired yet.';
    const lines = [`Star researchers: ${this.stars.length} hired`];
    for (let i = 0; i < Math.min(4, this.stars.length); i++) lines.push(this.stars[i].name);
    if (this.stars.length > 4) lines.push(`+${this.stars.length - 4} more`);
    return lines.join('\n');
  }

  private branchTip(i: number): string {
    const branch = RESEARCH_BRANCHES[i];
    const total = TOPICS_PER_BRANCH[i];
    const lines = [`${BRANCH_LABEL[branch]}: ${this.done[i]} of ${total} done`];
    const st = this.st;
    const node = this.curId ? NODE_BY_ID.get(this.curId) : undefined;
    if (st && node && branchOf(node) === branch) {
      const cost = Math.max(1, effectiveResearchCost(st, node));
      lines.push(`Now: ${node.name} (${Math.round(Math.min(1, st.research.progress / cost) * 100)}%)`);
    } else {
      lines.push('Not researching here right now');
    }
    const queued = (st?.research.queue ?? []).filter((id) => {
      const n = NODE_BY_ID.get(id);
      return !!n && branchOf(n) === branch;
    }).length;
    if (queued > 0) lines.push(`${queued} queued`);
    const people = this.podN[i];
    lines.push(`${formatNumber(people, 0)} researcher${people === 1 ? '' : 's'} at these desks`);
    return lines.join('\n');
  }
}
