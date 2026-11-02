// Research lab scene: one lab island per research branch (a whiteboard that fills up as the branch is completed, an
// experiment rig that runs while the branch holds the current topic, benches with researchers), the projector with the
// current topic, the "next up" board, the star bay, and a coffee lounge that fills up when research is idle.
// Islands sit on the kit's lattice and the camera fits them to the canvas. Pieces are depth-sorted every frame.
import type { GameState } from '../../sim/types';
import { RESEARCH_BRANCHES } from '../../sim/types';
import { RESEARCH } from '../../sim/data/research';
import { effectiveResearchCost } from '../../sim/systems/research';
import { formatNumber } from '../../sim/util';
import { BRANCH_LABEL, NODE_BY_ID, branchOf, etaText } from '../../ui/panels/research/model';
import type { Scene, SceneHit } from '../types';
import {
  Tags,
  alpha,
  background,
  box,
  faceY,
  fitIso,
  flat,
  frac,
  hitBox,
  hud,
  iso,
  line3,
  mix,
  outline,
  palette,
  person,
  prand,
  slab,
  tri,
  TAG_FONT,
  type Box3,
  type Ctx,
  type Pal,
  type Proj,
  type Tri,
} from '../kit';
import {
  allocateResearchers,
  BOARD_Z0,
  BOARD_Z1,
  buildRoom,
  DESK_D,
  DESK_TOP,
  DESK_W,
  deskXY,
  ISLE,
  LOUNGE_SHOW,
  loungeSpot,
  type Pod,
  type Room,
  seatXY,
  SLOTS,
  STAR_MAX,
  starDeskXY,
  starSeatXY,
  TOPICS_PER_BRANCH,
  WALL_H,
} from './layout';

const BRANCH_INDEX = new Map<string, number>(RESEARCH_BRANCHES.map((b, i) => [b, i] as const));
const NODE_BRANCH = new Map<string, number>(RESEARCH.map((n) => [n.id, BRANCH_INDEX.get(branchOf(n)) ?? 0] as const));
const TOTAL_TOPICS = RESEARCH.length;
const POD_ACTORS = RESEARCH_BRANCHES.length * SLOTS;
const ACTOR_MAX = POD_ACTORS + STAR_MAX;
const QUEUE_SHOW = 6;
const SCRIBBLE_COLS = 8;
const SCRIBBLE_ROWS = 4;
const SCRIBBLE_CELLS = SCRIBBLE_COLS * SCRIBBLE_ROWS;
const LEAN = 0.12;
const SCREEN_Z0 = 8;
const SCREEN_Z1 = 34;

const K_WALL = 0;
const K_RIG = 1;
const K_DESK = 2;
const K_CHAIR = 3;
const K_ACTOR = 4;
const K_SDESK = 5;
const K_SCHAIR = 6;
const K_PROJ = 7;
const K_QUEUE = 8;
const K_LOUNGE = 9;
const K_COFFEE = 10;

interface Item {
  d: number;
  kind: number;
  a: number;
  b: number;
}

interface Actor {
  x: number;
  y: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  vis: boolean;
  seated: boolean;
  star: boolean;
  /** Pod index of a researcher, -1 for a star. */
  pod: number;
  /** Snap to the target on the next frame instead of walking in. */
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

/** Set the largest font (down from maxPx, not below minPx) at which `text` fits in maxW. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, maxPx: number, minPx: number, weight = 600): void {
  let px = maxPx;
  g.font = `${weight} ${px.toFixed(1)}px ${TAG_FONT}`;
  while (px > minPx && g.measureText(text).width > maxW) {
    px -= 0.5;
    g.font = `${weight} ${px.toFixed(1)}px ${TAG_FONT}`;
  }
}

/** Text lying on a +y face: sheared to the face's slope (half a pixel down per pixel right). */
function faceText(g: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  g.save();
  g.translate(x, y);
  g.transform(1, 0.5, 0, 1, 0, 0);
  g.fillText(text, 0, 0);
  g.restore();
}

interface Looks {
  desk: Tri;
  board: string;
  chair: Tri;
  rug: string;
}

let looksFor: Pal | null = null;
let looks: Looks | null = null;
function looksOf(pal: Pal): Looks {
  if (looks && looksFor === pal) return looks;
  looksFor = pal;
  looks = {
    desk: pal.light ? tri('#d2d5db', 0.86, 0.72) : tri('#5a5e67', 0.78, 0.6),
    board: pal.light ? '#fbfbfc' : mix('#e8eaee', '#000000', 0.22),
    chair: tri(pal.light ? '#3a3c42' : '#2c2e33'),
    rug: alpha(pal.hl, pal.light ? 0.16 : 0.08),
  };
  return looks;
}

export class ResearchScene implements Scene {
  private cssW = 1;
  private cssH = 1;
  private proj: Proj = { ox: 0, oy: 0, s: 1 };
  private time = 0;
  private room: Room = buildRoom(800, 320);
  private roomKey = '';
  private hover: string | null = null;
  private readonly tags = new Tags();

  private st: GameState | null = null;
  private idle = true;
  private cur = -1;
  private curId: string | null = null;
  private researchers = 0;
  private stars: { name: string; title: string }[] = [];
  private done = new Array<number>(RESEARCH_BRANCHES.length).fill(0);
  private queued = new Array<number>(RESEARCH_BRANCHES.length).fill(0);
  private doneAll = 0;

  private podN: number[] = new Array(RESEARCH_BRANCHES.length).fill(0);
  private podSeated: number[] = new Array(RESEARCH_BRANCHES.length).fill(0);
  private starSeated = 0;
  private loungeTotal = 0;
  private seatKey = -1;
  private actors: Actor[] = [];

  private pool: Item[] = [];
  private order: Item[] = [];
  private hits: { id: string; box: Box3 }[] = [];
  /** Which pass the draw helpers are in: the static layer (cached while nobody walks) or the live parts over it. */
  private live = false;
  private staticCv: HTMLCanvasElement | null = null;
  private staticKey = '';

  constructor() {
    for (let i = 0; i < 320; i++) this.pool.push({ d: 0, kind: 0, a: 0, b: 0 });
    for (let i = 0; i < ACTOR_MAX; i++) {
      this.actors.push({ x: 0, y: 0, tx: 0, ty: 0, sx: 0, sy: 0, vis: false, seated: false, star: i >= POD_ACTORS, pod: -1, spawn: false, walkPhase: 0, moving: false, seed: i * 7 + 3 });
    }
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    const key = `${cssW}x${cssH}`;
    if (key === this.roomKey) return;
    this.roomKey = key;
    this.room = buildRoom(cssW, cssH);
    const R = this.room;
    const boxes: Box3[] = [];
    const isle = (x: number, y: number, z1: number): Box3 => ({ x0: x, y0: y, x1: x + ISLE, y1: y + ISLE, z0: -2, z1 });
    for (const p of R.pods) boxes.push(isle(p.px, p.py, WALL_H + 10));
    boxes.push(isle(R.proj.x, R.proj.y, SCREEN_Z1 + 10), isle(R.queue.x, R.queue.y, WALL_H + 10), isle(R.stars.x, R.stars.y, 30), isle(R.lounge.x, R.lounge.y, 30));
    fitIso(this.proj, boxes, cssW, cssH);
    const hits: { id: string; box: Box3; line: number }[] = [];
    hits.push({ id: 'current', box: { x0: R.proj.x, y0: R.proj.y, x1: R.proj.x + ISLE, y1: R.proj.y + ISLE, z0: 0, z1: SCREEN_Z1 + 2 }, line: R.proj.line });
    hits.push({ id: 'queue', box: { x0: R.queue.x, y0: R.queue.y, x1: R.queue.x + ISLE, y1: R.queue.y + ISLE, z0: 0, z1: WALL_H }, line: R.queue.line });
    hits.push({ id: 'stars', box: { x0: R.stars.x, y0: R.stars.y, x1: R.stars.x + ISLE, y1: R.stars.y + ISLE, z0: 0, z1: 24 }, line: R.stars.line });
    for (const p of R.pods) hits.push({ id: `branch:${p.branch}`, box: { x0: p.px, y0: p.py, x1: p.px + ISLE, y1: p.py + ISLE, z0: 0, z1: WALL_H }, line: p.line });
    hits.sort((a, b) => a.line - b.line);
    this.hits = hits;
    // New desks: everyone snaps to their new seat.
    this.seatKey = -1;
    for (const a of this.actors) a.vis = false;
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

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
    this.queued.fill(0);
    for (const id of s.research.queue ?? []) {
      const b = NODE_BRANCH.get(id);
      if (b !== undefined) this.queued[b]++;
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
    for (const pod of this.room.pods) {
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
        if (!act.vis) act.spawn = true;
        act.vis = true;
        act.pod = pod.i;
        act.star = false;
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
      const [sx, sy] = starSeatXY(this.room, j);
      if (!act.vis) act.spawn = true;
      act.vis = true;
      act.pod = -1;
      act.star = true;
      act.sx = sx;
      act.sy = sy;
    }
    // Targets: chairs while research runs (the active branch leans in), the lounge while idle.
    let lounge = 0;
    this.loungeTotal = this.idle ? this.researchers + this.stars.length : 0;
    for (const act of this.actors) {
      if (!act.vis) continue;
      if (this.idle) {
        if (lounge < LOUNGE_SHOW) {
          [act.tx, act.ty] = loungeSpot(this.room, lounge);
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
    const pal = palette();
    const L = looksOf(pal);
    const c: Ctx = { g, p: this.proj, pal };

    // Static layer: drawn straight to the canvas while people walk; cached as a bitmap once everyone has arrived.
    const walking = this.actors.some((a) => a.vis && a.moving);
    const dpr = g.getTransform().a || 1;
    if (walking) {
      this.staticKey = '';
      this.pieces(c, L, s, t, false);
    } else {
      const key = `${this.roomKey}@${dpr}|${pal.bg}|${this.seatKey}|${this.done.join(',')}|${this.queued.join(',')}|${(s.research.queue ?? []).join(',')}`;
      if (!this.staticCv || key !== this.staticKey) {
        const cv = this.staticCv ?? document.createElement('canvas');
        cv.width = Math.max(1, Math.round(this.cssW * dpr));
        cv.height = Math.max(1, Math.round(this.cssH * dpr));
        const sg = cv.getContext('2d');
        if (sg) {
          sg.setTransform(dpr, 0, 0, dpr, 0, 0);
          this.pieces({ g: sg, p: this.proj, pal }, L, s, t, false);
        }
        this.staticCv = cv;
        this.staticKey = key;
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(this.staticCv, 0, 0);
      g.restore();
    }
    this.pieces(c, L, s, t, true);
    this.overlays(c, s, t);
  }

  /** Floors and the depth-sorted pieces, in one pass: static (furniture, people) or live (screens, rigs, steam). */
  private pieces(c: Ctx, L: Looks, s: GameState, t: number, live: boolean): void {
    this.live = live;
    if (!live) {
      background(c, this.cssW, this.cssH);
      this.floors(c, L);
    }
    this.sorted(c, L, s, t);
  }

  private floors(c: Ctx, L: Looks): void {
    const { pal } = c;
    const R = this.room;
    // Floors first.
    for (let line = 0; line < R.lines; line++) {
      for (const pod of R.pods) {
        if (pod.line !== line) continue;
        slab(c, pod.px, pod.py, ISLE, ISLE, 2, 0.5);
        if (pod.i === this.cur && !this.idle) flat(c, pod.px + 0.1, pod.py + 0.2, ISLE - 0.2, ISLE - 0.3, 0.02, alpha(pal.hl, 0.08));
      }
      for (const sp of [R.proj, R.queue, R.stars, R.lounge]) if (sp.line === line) slab(c, sp.x, sp.y, ISLE, ISLE, 2, 0.5);
    }
    flat(c, R.stars.x + 0.2, R.stars.y + 0.6, ISLE - 0.4, ISLE - 0.8, 0.02, L.rug);
    flat(c, R.lounge.x + 0.9, R.lounge.y + 0.9, ISLE - 1.8, ISLE - 1.8, 0.02, alpha(pal.blue, pal.light ? 0.18 : 0.1));
  }

  private sorted(c: Ctx, L: Looks, s: GameState, t: number): void {
    const { pal } = c;
    const R = this.room;
    const live = this.live;
    // Depth-sorted pieces.
    const items = this.pool;
    let n = 0;
    const push = (d: number, kind: number, a: number, b: number) => {
      if (n >= items.length) items.push({ d: 0, kind: 0, a: 0, b: 0 });
      const it = items[n++];
      it.d = d;
      it.kind = kind;
      it.a = a;
      it.b = b;
    };
    for (const pod of R.pods) {
      push(pod.px + pod.py, K_WALL, pod.i, 0);
      push(pod.px + 3.3 + pod.py + 0.8, K_RIG, pod.i, 0);
      const desks = Math.max(1, Math.min(SLOTS, this.podN[pod.i]));
      for (let k = 0; k < desks; k++) {
        const [dx, dy] = deskXY(pod, k);
        push(dx + dy + DESK_D, K_DESK, pod.i, k);
        push(dx + dy + DESK_D + 0.75, K_CHAIR, pod.i, k);
      }
    }
    const starDesks = Math.max(2, this.starSeated);
    for (let j = 0; j < Math.min(STAR_MAX, starDesks); j++) {
      const [dx, dy] = starDeskXY(R, j);
      push(dx + dy + DESK_D, K_SDESK, j, 0);
      push(dx + dy + DESK_D + 0.75, K_SCHAIR, j, 0);
    }
    for (let i = 0; i < this.actors.length; i++) {
      const act = this.actors[i];
      if (act.vis) push(act.x + act.y + 0.02, K_ACTOR, i, 0);
    }
    push(R.proj.x + R.proj.y + 0.6, K_PROJ, 0, 0);
    push(R.queue.x + R.queue.y + 0.6, K_QUEUE, 0, 0);
    push(R.lounge.x + R.lounge.y + 0.8, K_LOUNGE, 0, 0);
    push(R.lounge.x + R.lounge.y + 1.4, K_COFFEE, 0, 0);

    const order = this.order;
    order.length = 0;
    for (let i = 0; i < n; i++) order.push(items[i]);
    order.sort((a, b) => a.d - b.d);

    for (const it of order) {
      switch (it.kind) {
        case K_WALL:
          this.drawWall(c, L, R.pods[it.a], t);
          break;
        case K_RIG:
          this.drawRig(c, R.pods[it.a], t);
          break;
        case K_DESK: {
          const pod = R.pods[it.a];
          const [dx, dy] = deskXY(pod, it.b);
          const occupied = it.b < this.podSeated[pod.i];
          const on = this.idle || !occupied ? 0 : pod.i === this.cur ? 1 : 0.55;
          this.drawDesk(c, L, dx, dy, on, frac(t * (0.5 + it.b * 0.13) + pod.i * 0.37), false);
          break;
        }
        case K_CHAIR: {
          if (live) break;
          const [dx, dy] = deskXY(R.pods[it.a], it.b);
          this.drawChair(c, L, dx, dy);
          break;
        }
        case K_SDESK: {
          const [dx, dy] = starDeskXY(R, it.a);
          const occupied = it.a < this.starSeated;
          this.drawDesk(c, L, dx, dy, this.idle || !occupied ? 0 : 1, frac(t * 0.7 + it.a * 0.3), true);
          break;
        }
        case K_SCHAIR: {
          if (live) break;
          const [dx, dy] = starDeskXY(R, it.a);
          this.drawChair(c, L, dx, dy);
          break;
        }
        case K_ACTOR: {
          if (live) break;
          const act = this.actors[it.a];
          const sitting = act.seated && !act.moving && !this.idle;
          person(c, act.x, act.y, act.star ? pal.hl : pal.silver, act.walkPhase, act.moving, act.star ? undefined : pal.fg3, sitting);
          break;
        }
        case K_PROJ:
          this.drawProjector(c, s, t);
          break;
        case K_QUEUE:
          if (!live) this.drawQueue(c, L, s);
          break;
        case K_LOUNGE:
          if (!live) this.drawLounge(c);
          break;
        case K_COFFEE:
          this.drawCoffee(c, t);
          break;
      }
    }

  }

  /** Star markers, chat, hover outline, tags and the HUD, over everything. */
  private overlays(c: Ctx, s: GameState, t: number): void {
    const { g, pal } = c;
    const R = this.room;
    // Star markers over occupied star desks.
    for (let j = 0; j < this.starSeated; j++) {
      const [dx, dy] = starDeskXY(R, j);
      const [mx, my] = iso(this.proj, dx + DESK_W / 2, dy + 0.3, DESK_TOP + 20);
      const r = 2.8 * this.proj.s + 1;
      g.fillStyle = pal.hl;
      g.beginPath();
      g.moveTo(mx, my - r);
      g.lineTo(mx + r * 0.7, my);
      g.lineTo(mx, my + r);
      g.lineTo(mx - r * 0.7, my);
      g.closePath();
      g.fill();
    }
    this.drawChat(c, t);

    if (this.hover) {
      const h = this.hits.find((x) => x.id === this.hover);
      if (h) outline(c, h.box);
    }

    // Tags.
    const p = this.proj;
    const small = p.s < 0.42;
    const tags = this.tags;
    {
      const a = iso(p, R.proj.x + 0.3, R.proj.y + 0.5, SCREEN_Z1);
      const b = iso(p, R.proj.x + ISLE - 0.3, R.proj.y + 0.5, SCREEN_Z0);
      tags.reserve(a[0], a[1], b[0], b[1]);
    }
    for (const pod of R.pods) {
      const [x, y] = iso(p, pod.px + 0.3, pod.py + 0.2, WALL_H + 2);
      const active = pod.i === this.cur && !this.idle;
      const nP = this.podN[pod.i];
      const sub = `${this.done[pod.i]}/${TOPICS_PER_BRANCH[pod.i]}${!this.idle && nP > SLOTS ? ` · ×${formatNumber(nP, 0)}` : ''}`;
      tags.add(x, y, BRANCH_LABEL[pod.branch], active ? { solid: true, sub, small, leader: 4 } : { tone: pal.blue, sub, small, leader: 4 }, active ? 12 : this.hover === `branch:${pod.branch}` ? 20 : 3);
    }
    {
      const [x, y] = iso(p, R.queue.x + 0.4, R.queue.y + 0.3, WALL_H + 2);
      const q = s.research.queue?.length ?? 0;
      tags.add(x, y, 'Next up', { tone: pal.fg2, sub: q ? `${q} queued` : 'empty', small, leader: 4 }, 6);
    }
    if (this.stars.length > 0) {
      const [x, y] = iso(p, R.stars.x + 0.4, R.stars.y + 0.4, 26);
      tags.add(x, y, 'Stars', { tone: pal.hl, sub: `${this.stars.length}`, small, leader: 4 }, 4);
    }
    if (this.idle) {
      const [x, y] = iso(p, R.lounge.x + 2.2, R.lounge.y + 2.2, 30);
      tags.add(x, y, 'Lounge', { tone: pal.warn, sub: `×${formatNumber(this.loungeTotal, 0)} chatting`, small }, 8);
    }
    tags.flush(g, pal, this.cssW, this.cssH);

    hud(g, pal, this.cssW, this.cssH, `${formatNumber(this.researchers)} researchers · ${this.doneAll}/${TOTAL_TOPICS} topics done`);
  }

  /** Back wall of a branch island: livery stripe, whiteboard with scribbles (completed share) and queued stickies. */
  private drawWall(c: Ctx, L: Looks, pod: Pod, t: number): void {
    const { g, p, pal } = c;
    const { px, py } = pod;
    if (this.live) {
      if (pod.i === this.cur && !this.idle) faceY(c, px + 0.3, px + 2.75, py + 0.145, BOARD_Z1 + 1, BOARD_Z1 + 1.8, alpha(pal.hl, 0.6 + 0.35 * Math.sin(t * 5)));
      return;
    }
    box(c, px, py, ISLE, 0.14, 0, WALL_H, pal.wall);
    line3(c, px, py, WALL_H, px + ISLE, py, WALL_H, alpha(pal.silver, 0.6), 1, 0.6);
    const active = pod.i === this.cur && !this.idle;
    faceY(c, px, px + ISLE, py + 0.14, 2.2, 3.4, active ? pal.hl : alpha(pal.blue, 0.8));
    const x0 = px + 0.3;
    const x1 = px + 2.75;
    const y = py + 0.141;
    faceY(c, x0 - 0.06, x1 + 0.06, y, BOARD_Z0 - 0.8, BOARD_Z1 + 0.8, alpha(pal.silver, 0.9));
    faceY(c, x0, x1, y + 0.001, BOARD_Z0, BOARD_Z1, L.board);
    const total = TOPICS_PER_BRANCH[pod.i] || 1;
    const lit = Math.round(Math.min(1, this.done[pod.i] / total) * SCRIBBLE_CELLS);
    if (lit > 0 && p.s > 0.3) {
      const cw = (x1 - x0) / SCRIBBLE_COLS;
      const ch = (BOARD_Z1 - BOARD_Z0 - 2) / SCRIBBLE_ROWS;
      g.lineWidth = Math.max(0.8, 0.9 * p.s);
      for (let cell = 0; cell < SCRIBBLE_CELLS; cell++) {
        if (SCRIBBLE_RANK[cell] >= lit) continue;
        const cc = cell % SCRIBBLE_COLS;
        const cr = Math.floor(cell / SCRIBBLE_COLS);
        const u0 = x0 + cc * cw + cw * 0.15;
        const u1 = u0 + cw * 0.7;
        const zc = BOARD_Z0 + 1 + cr * ch + ch * 0.5;
        const wob = (prand(cell * 3.1 + pod.i) - 0.5) * ch * 0.5;
        g.strokeStyle = cell % 4 === 0 ? (pal.light ? '#c0392b' : '#d64545') : pal.light ? '#2b2d33' : '#3a3d45';
        g.beginPath();
        for (let k = 0; k <= 3; k++) {
          const u = u0 + ((u1 - u0) * k) / 3;
          const [sx, sy] = iso(p, u, y + 0.002, zc + (k % 2 ? wob : -wob));
          if (k === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.stroke();
      }
    }
    // Queued topics in this branch: yellow stickies on the board's right edge.
    for (let k = 0; k < Math.min(3, this.queued[pod.i]); k++) {
      const z = BOARD_Z1 - 2.5 - k * 4.5;
      faceY(c, x1 - 0.42, x1 - 0.12, y + 0.003, z - 3.2, z, pal.hl);
    }
  }

  /** Experiment rig in the back right corner: a cabinet with a test chamber; it hums while its branch is researched. */
  private drawRig(c: Ctx, pod: Pod, t: number): void {
    const { g, p, pal } = c;
    const x = pod.px + 3.0;
    const y = pod.py + 0.35;
    const active = pod.i === this.cur && !this.idle;
    if (!this.live) {
      box(c, x, y, 0.75, 0.6, 0, 12, pal.metal, alpha(pal.silver, 0.5));
      // Glass chamber on top.
      const glass = active ? alpha(pal.hl, 0.4) : alpha(pal.blue, pal.light ? 0.3 : 0.18);
      box(c, x + 0.08, y + 0.08, 0.6, 0.45, 12, 20, { t: glass, l: glass, r: glass });
      line3(c, x + 0.08, y + 0.53, 20, x + 0.68, y + 0.53, 20, alpha(pal.silver, 0.8), 1, 0.6);
      return;
    }
    const [cx, cy] = iso(p, x + 0.38, y + 0.3, 16);
    const r = 5 * p.s;
    if (r > 1.5) {
      g.strokeStyle = active ? pal.hl : alpha(pal.fg3, 0.7);
      g.lineWidth = Math.max(1, 1.2 * p.s);
      g.beginPath();
      g.ellipse(cx, cy, r * Math.abs(Math.cos(active ? t * 2.2 : 0.6)) + 0.5, r * 0.55, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // Status lights on the cabinet front.
    for (let k = 0; k < 3; k++) {
      const [lx, ly] = iso(p, x + 0.15 + k * 0.18, y + 0.6, 8);
      g.fillStyle = active ? (frac(t * 3 + k * 0.3) < 0.6 ? pal.hl : alpha(pal.hl, 0.3)) : alpha(pal.up, 0.6);
      g.fillRect(lx, ly, Math.max(1.2, 1.6 * p.s), Math.max(1.2, 1.6 * p.s));
    }
  }

  /** A bench desk with a monitor; `on` is screen brightness 0..1. */
  private drawDesk(c: Ctx, L: Looks, dx: number, dy: number, on: number, flick: number, star: boolean): void {
    const { g, p, pal } = c;
    if (this.live) {
      if (on > 0.02 && p.s > 0.3) {
        const col = star || on >= 1 ? pal.hl : pal.blue;
        g.globalAlpha = on * 0.8;
        for (let k = 0; k < 3; k++) {
          const w = 0.25 + 0.25 * prand(k * 7 + Math.floor(flick * 6));
          faceY(c, dx + 0.25, dx + 0.25 + w, dy + 0.132, DESK_TOP + 8.6 - k * 1.8, DESK_TOP + 9.2 - k * 1.8, col);
        }
        g.globalAlpha = 1;
      }
      return;
    }
    box(c, dx + 0.05, dy + DESK_D - 0.1, 0.06, 0.06, 0, DESK_TOP - 1, pal.metal);
    box(c, dx + DESK_W - 0.11, dy + DESK_D - 0.1, 0.06, 0.06, 0, DESK_TOP - 1, pal.metal);
    box(c, dx, dy, DESK_W, DESK_D, DESK_TOP - 1, DESK_TOP, L.desk);
    if (star) faceY(c, dx, dx + DESK_W, dy + DESK_D, DESK_TOP - 1, DESK_TOP, pal.hl);
    // Monitor facing the chair (toward +y).
    box(c, dx + 0.42, dy + 0.12, 0.1, 0.06, DESK_TOP, DESK_TOP + 3, pal.metal);
    box(c, dx + 0.15, dy + 0.08, 0.65, 0.05, DESK_TOP + 3, DESK_TOP + 11, pal.metal);
    faceY(c, dx + 0.19, dx + 0.76, dy + 0.131, DESK_TOP + 3.8, DESK_TOP + 10.2, pal.light ? '#1b1c20' : '#0d0e10');
  }

  private drawChair(c: Ctx, L: Looks, dx: number, dy: number): void {
    const cx = dx + DESK_W / 2 - 0.18;
    const cy = dy + DESK_D + 0.2;
    box(c, cx, cy, 0.36, 0.36, 4, 6, L.chair);
    box(c, cx + 0.02, cy + 0.3, 0.32, 0.06, 6, 13, L.chair);
  }

  /** Projector island: a big screen on two legs with the topic, branch, progress, rate and ETA. Dark when idle. */
  private drawProjector(c: Ctx, s: GameState, t: number): void {
    const R = this.room.proj;
    const x0 = R.x + 0.3;
    const x1 = R.x + ISLE - 0.3;
    const sy = R.y + 0.5;
    if (!this.live) {
      this.projectorFrame(c, x0, x1, sy);
      return;
    }
    this.projectorText(c, s, t, x0, x1, sy);
  }

  private projectorFrame(c: Ctx, x0: number, x1: number, sy: number): void {
    const { pal } = c;
    const R = this.room.proj;
    box(c, x0 + 0.2, sy - 0.05, 0.1, 0.1, 0, SCREEN_Z0, pal.metal);
    box(c, x1 - 0.3, sy - 0.05, 0.1, 0.1, 0, SCREEN_Z0, pal.metal);
    box(c, x0, sy - 0.12, x1 - x0, 0.12, SCREEN_Z0, SCREEN_Z1, pal.metal, alpha(pal.silver, 0.7));
    faceY(c, x0 + 0.1, x1 - 0.1, sy + 0.001, SCREEN_Z0 + 1, SCREEN_Z1 - 1, pal.light ? '#16171a' : '#060607');
    // Stage edge and a lectern.
    flat(c, R.x + 0.2, R.y + 1.2, ISLE - 0.4, 0.06, 0.02, alpha(pal.hl, 0.6));
    box(c, R.x + 3.0, R.y + 2.4, 0.4, 0.35, 0, 9, pal.metal, alpha(pal.silver, 0.5));
  }

  private projectorText(c: Ctx, s: GameState, t: number, x0: number, x1: number, sy: number): void {
    const { g, p, pal } = c;
    const node = !this.idle && this.curId ? NODE_BY_ID.get(this.curId) : undefined;
    const mid = (x0 + x1) / 2;
    const w = (x1 - x0) * 20 * p.s * 0.86;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (!node) {
      const [tx, ty] = iso(p, mid, sy + 0.01, (SCREEN_Z0 + SCREEN_Z1) / 2);
      g.fillStyle = pal.fg4;
      fitFont(g, 'NO TOPIC RUNNING', w, Math.max(6, 10 * p.s), 5, 700);
      faceText(g, tx, ty, 'NO TOPIC RUNNING');
      g.restore();
      return;
    }
    const cost = Math.max(1, effectiveResearchCost(s, node));
    const progress = s.research.progress;
    const fr = Math.min(1, progress / cost);
    const perDay = s.research.pointsPerDay;
    const branchName = BRANCH_LABEL[branchOf(node)].toUpperCase();
    let [tx, ty] = iso(p, mid, sy + 0.01, SCREEN_Z1 - 5);
    g.fillStyle = pal.fg3;
    fitFont(g, branchName, w, Math.max(6, 8.5 * p.s), 5, 600);
    faceText(g, tx, ty, branchName);
    [tx, ty] = iso(p, mid, sy + 0.01, SCREEN_Z1 - 12);
    g.fillStyle = pal.hl;
    fitFont(g, node.name.toUpperCase(), w, Math.max(7, 13 * p.s), 5, 700);
    faceText(g, tx, ty, node.name.toUpperCase());
    g.restore();
    const u0 = x0 + 0.5;
    const u1 = x1 - 0.5;
    faceY(c, u0, u1, sy + 0.002, SCREEN_Z0 + 8, SCREEN_Z0 + 10, alpha(pal.fg4, 0.7));
    if (fr > 0) faceY(c, u0, u0 + (u1 - u0) * fr, sy + 0.003, SCREEN_Z0 + 8, SCREEN_Z0 + 10, pal.hl);
    const readout = `${Math.round(fr * 100)}%  ·  +${formatNumber(perDay)} RP/DAY  ·  ${etaText(Math.max(0, cost - progress), perDay).toUpperCase()}`;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    [tx, ty] = iso(p, mid, sy + 0.01, SCREEN_Z0 + 4.5);
    g.fillStyle = pal.fg2;
    fitFont(g, readout, w, Math.max(6, 8.5 * p.s), 4.5, 600);
    faceText(g, tx, ty, readout);
    const [ex, ey] = iso(p, x1 - 0.45, sy + 0.01, SCREEN_Z1 - 3);
    g.fillStyle = alpha(pal.down, 0.5 + 0.5 * Math.sin(t * 3));
    g.beginPath();
    g.arc(ex, ey, 1.4 * p.s + 0.8, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** "Next up" board: the queue as stickies in branch order, the first one in the team colour. */
  private drawQueue(c: Ctx, L: Looks, s: GameState): void {
    const { g, p, pal } = c;
    const R = this.room.queue;
    const x0 = R.x + 0.4;
    const x1 = R.x + ISLE - 0.4;
    const y = R.y + 0.5;
    box(c, R.x + 0.3, y - 0.14, ISLE - 0.6, 0.14, 0, WALL_H, pal.wall);
    faceY(c, x0, x1, y + 0.001, 6, WALL_H - 2, L.board);
    const queue = s.research.queue ?? [];
    const shown = Math.min(QUEUE_SHOW, queue.length);
    const cw = (x1 - x0 - 0.3) / 2;
    for (let i = 0; i < shown; i++) {
      const node = NODE_BY_ID.get(queue[i]);
      if (!node) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const u0 = x0 + 0.1 + col * (cw + 0.1);
      const zt = WALL_H - 4 - row * 7.5;
      faceY(c, u0, u0 + cw, y + 0.002, zt - 6, zt, i === 0 ? pal.hl : pal.light ? '#e8e2c4' : '#bdb59a');
      if (p.s > 0.45) {
        const code = BRANCH_LABEL[branchOf(node)].slice(0, 6).toUpperCase();
        const [cx, cy] = iso(p, u0 + cw / 2, y + 0.003, zt - 3);
        g.save();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#111111';
        fitFont(g, code, cw * 20 * p.s * 0.85, Math.max(6, 8 * p.s), 5, 700);
        faceText(g, cx, cy, code);
        g.restore();
      }
    }
    if (queue.length > QUEUE_SHOW && p.s > 0.35) {
      const [mx, my] = iso(p, (x0 + x1) / 2, y + 0.003, 8.5);
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#3a3d45';
      g.font = `700 ${Math.max(6, 8 * p.s)}px ${TAG_FONT}`;
      faceText(g, mx, my, `+${queue.length - QUEUE_SHOW} MORE`);
      g.restore();
    }
  }

  /** Lounge furniture: a sofa along the back and a plant. */
  private drawLounge(c: Ctx): void {
    const { pal } = c;
    const R = this.room.lounge;
    const sofa = pal.light ? tri('#5b636f') : tri('#3c4048');
    box(c, R.x + 1.0, R.y + 0.3, 2.4, 0.7, 0, 6, sofa);
    box(c, R.x + 1.0, R.y + 0.3, 2.4, 0.22, 6, 12, sofa);
    box(c, R.x + 3.6, R.y + 0.4, 0.3, 0.3, 0, 5, tri('#7a5a3a'));
    box(c, R.x + 3.5, R.y + 0.3, 0.5, 0.5, 5, 14, tri(pal.light ? '#3f8a55' : '#2f6a42'));
  }

  private drawCoffee(c: Ctx, t: number): void {
    const { g, p, pal } = c;
    const R = this.room.lounge;
    const x = R.x + 0.25;
    const y = R.y + 0.4;
    if (!this.live) {
      box(c, x, y, 0.6, 1.2, 0, 10, pal.metal);
      box(c, x + 0.05, y + 0.1, 0.5, 0.5, 10, 18, pal.steel, alpha(pal.silver, 0.6));
      faceY(c, x + 0.1, x + 0.5, y + 0.6, 12, 16, alpha(pal.hl, 0.7));
      return;
    }
    for (let k = 0; k < 3; k++) {
      const u = frac(t * 0.4 + k / 3);
      const [sx, sy] = iso(p, x + 0.3, y + 0.35, 19 + u * 10);
      g.fillStyle = alpha(pal.fg2, 0.3 * (1 - u));
      g.beginPath();
      g.arc(sx + Math.sin(t * 2 + k) * 1.5 * p.s, sy, (1.5 + u * 2.5) * p.s, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** Idle lounge: small chat dots over some of the standing people. */
  private drawChat(c: Ctx, t: number): void {
    if (!this.idle) return;
    const { g, p, pal } = c;
    for (let i = 0; i < this.actors.length; i++) {
      const act = this.actors[i];
      if (!act.vis || i % 3 !== 0) continue;
      const [bx, by] = iso(p, act.x, act.y, 22);
      const ph = (t * 1.6 + act.seed) % 3;
      g.fillStyle = pal.fg2;
      for (let k = 0; k < 3; k++) {
        g.globalAlpha = k <= ph ? 0.85 : 0.2;
        g.beginPath();
        g.arc(bx + (k - 1) * 3 * p.s, by - 2 * p.s, 1.1 * p.s + 0.4, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  hitTest(x: number, y: number): SceneHit | null {
    for (let k = this.hits.length - 1; k >= 0; k--) {
      const h = this.hits[k];
      if (!hitBox(this.proj, h.box, x, y)) continue;
      if (h.id === 'current') return { id: 'current', label: this.currentTip() };
      if (h.id === 'queue') return { id: 'queue', label: this.queueTip() };
      if (h.id === 'stars') return { id: 'stars', label: this.starsTip() };
      const i = BRANCH_INDEX.get(h.id.slice('branch:'.length)) ?? 0;
      return { id: h.id, label: this.branchTip(i) };
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
    if (this.queued[i] > 0) lines.push(`${this.queued[i]} queued (yellow stickies)`);
    const people = this.podN[i];
    lines.push(`${formatNumber(people, 0)} researcher${people === 1 ? '' : 's'} at these desks`);
    return lines.join('\n');
  }
}
