// Model vault: the player's models as server-core monoliths on pedestals, in the office's isometric style.
// Reads GameState fresh every frame. The floor, walls, empty pedestals and storage boards are cached once per
// resize; everything else is drawn per frame from the state.
import type { Competitor, GameState, Model } from '../../sim/types';
import { COMPETITORS } from '../../sim/data/competitors';
import { provisionalElo } from '../../sim/systems/lab';
import { labName } from '../../sim/systems/labs';
import { tdate } from '../../ui/shell/fmt';
import { TILE_H, TILE_W, project, type Projector } from '../../office/iso';
import { C, shade } from '../../office/palette';
import { drawFloor, drawWalls } from '../../office/draw/room';
import { floorLine, floorTile, glow, isoBlock, planeX, planeY, withAlpha, type Ctx } from '../../office/draw/prims';
import type { Scene, SceneHit } from '../types';

// Layout (floor units). The 12 newest models sit on a fixed grid; each model keeps its slot (index mod 12).
const SLOTS = 12;
const COLS = 4;
const SLOT_X0 = 3.6;
const SLOT_DX = 2.7;
const SLOT_Y0 = 2.0;
const SLOT_DY = 2.6;
const PLINTH = 1.3;
const PLINTH_H = 4;
const FLOOR_W = 18.4;
const FLOOR_D = 9.8;
const ROPE_X = 14.6;
const ROPE_YS = [1.2, 3.0, 4.8, 6.6, 8.4];
const RIVAL_X = 15.9;
const RIVAL_Y = 4.2;
const RIVAL_SIZE = 1.5;
const RIVAL_PLINTH_H = 6;
const BAY = { x0: 0.4, x1: 3.3, y0: 2.1, y1: 7.4 };
const CRANE_X0 = 0.6;
const CRANE_X1 = 3.1;
const CRANE_Y = 4.7;
const CRANE_H = 100;
const STACK = { x: 1.5, y: 4.25, s: 0.9 };
// Storage rack in the front-left corner, in front of everything so it always reads.
const STORE = { x0: 0.15, x1: 0.95, y0: 7.7, y1: 9.5 };
const STORE_ANCHOR = { x: 0.6, y: 8.6 };
const SHELF_BOARDS = [9, 22, 35];
const SHELF_TOP = 46;
const BOXES_PER_ROW = 4;
const MAX_BOXES = 12;
const BAY_ID = SLOTS;
const ROPE_ID = SLOTS + 1;
const RIVAL_ID = SLOTS + 2;
const STORE_ID = SLOTS + 3;

const WALL_H = 40;
const FLOOR_TONE = '#2a2c2f';
const FLOOR_ALT = '#25272a';
const TRIM = '#34312c';
const PLINTH_TOP = '#3a3631';
const PLINTH_L = '#2b2824';
const PLINTH_R = '#302c27';

type Status = 'vault' | 'deprecated' | 'live' | 'released';
type Hit = { kind: 'model' | 'training' | 'rival' | 'shelf'; x0: number; y0: number; x1: number; y1: number; m?: Model };

interface Geom { x: number; y: number; size: number; z0: number; H: number; }
interface Rival { comp: Competitor; m: NonNullable<Competitor['model']>; }

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear blend of two #rrggbb colours, result as #rrggbb (keeps withAlpha and shade happy). */
function hexLerp(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** Overall quality as a band colour: red at 40, amber at 60, green at 90. */
function qualityColor(o: number): string {
  return o < 60 ? hexLerp(C.red, C.amber, (o - 40) / 20) : hexLerp(C.amber, C.green, (o - 60) / 30);
}

/** Tower height grows with log10 of parameter count (0.5B is the floor, 10T the ceiling). */
function heightFor(paramsB: number): number {
  const lp = Math.log10(Math.max(0.1, paramsB));
  return 18 + clamp01((lp + 0.5) / 4.5) * 60;
}

function rivalHeight(overall: number): number {
  return 22 + clamp01((overall - 40) / 60) * 60;
}

function fmtParams(b: number): string {
  if (b >= 1000) return `${(b / 1000).toFixed(2)}T`;
  if (b >= 10) return `${Math.round(b)}B`;
  return `${b.toFixed(1)}B`;
}

function isChild(m: Model): boolean {
  return !!m.parentId || !!m.derivedFrom;
}

function parentIdOf(m: Model): string | null {
  return m.parentId ?? m.derivedFrom?.ids[0] ?? null;
}

function statusOf(s: GameState, m: Model): Status {
  if (m.releasedDay === null) return 'vault';
  if (m.deprecated) return 'deprecated';
  return s.products.some((p) => p.active && p.modelId === m.id) ? 'live' : 'released';
}

function liveProducts(s: GameState, m: Model): string[] {
  return s.products.filter((p) => p.active && p.modelId === m.id).map((p) => p.name);
}

function progressOf(s: GameState): number {
  const tr = s.training;
  if (!tr || !(tr.totalFlops > 0)) return 0;
  return clamp01(tr.doneFlops / tr.totalFlops);
}

function kindWord(kind: string | undefined): string {
  if (kind === 'finetune') return 'Fine-tune';
  if (kind === 'distill') return 'Distill';
  if (kind === 'merge') return 'Merge';
  return 'Training';
}

function slotX(k: number): number {
  return SLOT_X0 + (k % COLS) * SLOT_DX;
}

function slotY(k: number): number {
  return SLOT_Y0 + Math.floor(k / COLS) * SLOT_DY;
}

/** Footprint and height of a model's core on slot k. Fine-tunes and distills stand on a smaller pedestal. */
function coreGeom(k: number, m: Model): Geom {
  const H = heightFor(m.paramsB);
  if (isChild(m)) {
    return { x: slotX(k) + (PLINTH - 0.5) / 2, y: slotY(k) + (PLINTH - 0.5) / 2, size: 0.5, z0: PLINTH_H + 2.5, H: H * 0.55 };
  }
  return { x: slotX(k) + (PLINTH - 0.85) / 2, y: slotY(k) + (PLINTH - 0.85) / 2, size: 0.85, z0: PLINTH_H, H };
}

/** Screen bounding box of a floor rectangle between heights z0 and z1. */
function bboxOf(p: Projector, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const xs = [x0, x1];
  const ys = [y0, y1];
  const zs = [z0, z1];
  for (const x of xs)
    for (const y of ys)
      for (const z of zs) {
        const [sx, sy] = project(p, x, y, z);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
  return [minX, minY, maxX, maxY];
}

/** Office pill: black box, hairline in colour, optional progress rule. Same as the HQ training label. */
function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, progress?: number, t = 0): void {
  g.save();
  g.font = '600 11px IBM Plex Mono, monospace';
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = 20;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.globalAlpha = 1;
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  if (progress !== undefined) {
    g.fillStyle = C.amber;
    g.fillRect(px + 1, py + h - 3, Math.max(0, (w - 2) * progress), 2);
  }
  g.fillStyle = C.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = 0.85 + 0.15 * Math.sin(t * 3);
  g.fillText(text, px + w / 2, py + h / 2 - 0.5);
  g.restore();
}

export class ModelsScene implements Scene {
  private cssW = 0;
  private cssH = 0;
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private staticCv: HTMLCanvasElement | null = null;
  private staticDirty = true;
  private time = 0;
  private s: GameState | null = null;
  /** Models currently on the grid, by slot (null = empty pedestal). Refilled every frame. */
  private bySlot: (Model | null)[] = new Array(SLOTS).fill(null);
  /** How many of the oldest models are on the storage shelf. */
  private shelfN = 0;
  private rival: Rival | null = null;
  private hitsModel: Hit[] = [];
  private hitsOther: Hit[] = [];
  /** Draw order of the depth-sorted parts (slots, bay, rope, rival). Fixed by the grid, so sorted once. */
  private order: number[];

  constructor() {
    const parts: { d: number; id: number }[] = [];
    for (let k = 0; k < SLOTS; k++) parts.push({ d: slotX(k) + slotY(k) + PLINTH, id: k });
    parts.push({ d: (STACK.x + STACK.y) + 1.5, id: BAY_ID });
    parts.push({ d: 22, id: ROPE_ID });
    parts.push({ d: 23, id: RIVAL_ID });
    parts.push({ d: (STORE.x0 + STORE.x1) / 2 + (STORE.y0 + STORE.y1) / 2, id: STORE_ID });
    parts.sort((a, b) => a.d - b.d);
    this.order = parts.map((p) => p.id);
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
    this.staticDirty = true;
  }

  /** Fit the room footprint and wall height into the canvas (CSS px). Same rule as the HQ office. */
  private fit(): void {
    const X = FLOOR_W;
    const Y = FLOOR_D;
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const s = Math.min(availW / (((X + Y) * TILE_W) / 2), availH / (((X + Y) * TILE_H) / 2 + WALL_H), 2.6);
    const sc = Math.max(0.35, s);
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - (((X - Y) * TILE_W) / 4) * sc;
    this.proj.oy = this.cssH / 2 - ((((X + Y) * TILE_H) / 4) - WALL_H / 2) * sc;
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.s = s;
    this.time += dt;
    const t = this.time;
    if (this.staticDirty || !this.staticCv) this.buildStatic(g);

    // Per-frame read of the state: which model sits in which slot, and the best rival.
    const n = s.models.length;
    const first = Math.max(0, n - SLOTS);
    this.shelfN = first;
    for (let k = 0; k < SLOTS; k++) this.bySlot[k] = null;
    for (let i = first; i < n; i++) this.bySlot[i % SLOTS] = s.models[i];
    this.rival = bestRival(s);

    const c: Ctx = { g, p: this.proj };
    if (this.staticCv) g.drawImage(this.staticCv, 0, 0, this.cssW, this.cssH);
    this.hitsModel.length = 0;
    this.hitsOther.length = 0;

    this.drawCables(c, t);
    for (const id of this.order) {
      if (id < SLOTS) {
        const m = this.bySlot[id];
        if (m) this.drawSlot(c, s, id, m, t);
      } else if (id === BAY_ID) {
        this.drawBay(c, s, t);
      } else if (id === ROPE_ID) {
        this.drawRope(c);
      } else if (id === STORE_ID) {
        this.drawShelf(c, s, first);
      } else {
        this.drawRival(c, t);
      }
    }
    this.drawOverlays(c, s, t);
  }

  /** Floor, walls, empty pedestals, bay and stage tint, shelf boards. Cached per resize. */
  private buildStatic(g: CanvasRenderingContext2D): void {
    const dpr = g.getTransform().a || 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(this.cssW * dpr));
    cv.height = Math.max(1, Math.round(this.cssH * dpr));
    const sg = cv.getContext('2d');
    if (!sg) {
      this.staticCv = null;
      return;
    }
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c: Ctx = { g: sg, p: this.proj };

    const bg = sg.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    sg.fillStyle = bg;
    sg.fillRect(0, 0, this.cssW, this.cssH);

    drawFloor(c, FLOOR_W, FLOOR_D, 1, FLOOR_TONE, FLOOR_ALT);
    drawWalls(c, FLOOR_W, FLOOR_D, WALL_H, TRIM);

    // Construction bay: a warm floor tint with amber edges.
    floorTile(c, BAY.x0, BAY.y0, BAY.x1 - BAY.x0, BAY.y1 - BAY.y0, withAlpha(C.amberDim, 0.12));
    floorLine(c, BAY.x0, BAY.y0, BAY.x1, BAY.y0, 0.05, C.amberDim, 1.2);
    floorLine(c, BAY.x0, BAY.y1, BAY.x1, BAY.y1, 0.05, C.amberDim, 1.2);
    floorLine(c, BAY.x0, BAY.y0, BAY.x0, BAY.y1, 0.05, C.amberDim, 1.2);
    floorLine(c, BAY.x1, BAY.y0, BAY.x1, BAY.y1, 0.05, C.amberDim, 1.2);

    // Rival stage: a faint lighter tile behind the rope.
    floorTile(c, RIVAL_X - 0.6, RIVAL_Y - 0.6, RIVAL_SIZE + 1.2, RIVAL_SIZE + 1.2, withAlpha(C.fgDim, 0.05));
    isoBlock(c, RIVAL_X, RIVAL_Y, RIVAL_SIZE, RIVAL_SIZE, 0, RIVAL_PLINTH_H, PLINTH_TOP, PLINTH_L, PLINTH_R);

    // Storage rack: back plate along y, three boards.
    const storeL = STORE.y1 - STORE.y0;
    isoBlock(c, STORE.x0 - 0.08, STORE.y0, 0.08, storeL, 0, SHELF_TOP, '#1d1c1a', '#171614', '#1a1917');
    for (const z of SHELF_BOARDS) isoBlock(c, STORE.x0, STORE.y0, STORE.x1 - STORE.x0, storeL, z, z + 1.2, '#5a4a38', '#41362a', '#4c3f30');

    // Pedestals for all 12 slots, with a floor marking so empty ones read as "free".
    for (let k = 0; k < SLOTS; k++) {
      const sx = slotX(k);
      const sy = slotY(k);
      isoBlock(c, sx, sy, PLINTH, PLINTH, 0, PLINTH_H, PLINTH_TOP, PLINTH_L, PLINTH_R);
      const e = 0.12;
      const mark = withAlpha(C.textDim, 0.45);
      floorLine(c, sx - e, sy - e, sx + PLINTH + e, sy - e, 0.02, mark, 1);
      floorLine(c, sx + PLINTH + e, sy - e, sx + PLINTH + e, sy + PLINTH + e, 0.02, mark, 1);
      floorLine(c, sx + PLINTH + e, sy + PLINTH + e, sx - e, sy + PLINTH + e, 0.02, mark, 1);
      floorLine(c, sx - e, sy + PLINTH + e, sx - e, sy - e, 0.02, mark, 1);
    }

    this.staticCv = cv;
    this.staticDirty = false;
  }

  /** Older models: a storage rack in the front-left corner, one case per model (newest first), up to 12 shown. */
  private drawShelf(c: Ctx, s: GameState, first: number): void {
    if (first <= 0) return;
    const count = Math.min(first, MAX_BOXES);
    for (let i = 0; i < count; i++) {
      const m = s.models[first - 1 - i];
      const row = Math.floor(i / BOXES_PER_ROW);
      const col = i % BOXES_PER_ROW;
      const bx = STORE.x0 + 0.1;
      const by = STORE.y0 + 0.1 + col * 0.42;
      const z = SHELF_BOARDS[row] + 1.2;
      const h = 6 + (i % 3) * 1.2;
      isoBlock(c, bx, by, 0.6, 0.36, z, z + h, '#3b3731', shade('#3b3731', 0.75), shade('#3b3731', 0.9));
      const dead = m.deprecated || m.releasedDay === null;
      const q = m.deprecated ? C.textDim : qualityColor(m.overall);
      planeX(c, bx + 0.6, by + 0.05, by + 0.31, z + h * 0.35, z + h * 0.35 + 1.1, withAlpha(q, dead ? 0.25 : 0.85));
    }
    const [x0, y0, x1, y1] = bboxOf(c.p, STORE.x0, STORE.y0, STORE.x1, STORE.y1, 0, SHELF_TOP);
    this.hitsOther.push({ kind: 'shelf', x0, y0, x1, y1 });
  }

  /** Cables link each fine-tune or distill to its parent, with a pulse running along them. */
  private drawCables(c: Ctx, t: number): void {
    const g = c.g;
    const p = c.p;
    for (let k = 0; k < SLOTS; k++) {
      const m = this.bySlot[k];
      if (!m || !isChild(m)) continue;
      const pid = parentIdOf(m);
      if (!pid) continue;
      const j = this.bySlot.findIndex((x) => x?.id === pid);
      const gm = coreGeom(k, m);
      const a = project(p, gm.x + gm.size / 2, gm.y + gm.size / 2, gm.z0);
      let b: [number, number];
      if (j >= 0) {
        b = project(p, slotX(j) + PLINTH / 2, slotY(j) + PLINTH / 2, PLINTH_H);
      } else {
        b = project(p, STORE_ANCHOR.x, STORE_ANCHOR.y, 0);
      }
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2 + 14 * p.scale;
      g.save();
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo(mx, my, b[0], b[1]);
      g.strokeStyle = withAlpha(C.amberDim, 0.75);
      g.lineWidth = Math.max(1, 1.4 * p.scale);
      g.stroke();
      g.restore();
      // A pulse travelling down the cable: data moving to the parent.
      const u = (t * 0.35 + k * 0.173) % 1;
      const v = 1 - u;
      const qx = v * v * a[0] + 2 * v * u * mx + u * u * b[0];
      const qy = v * v * a[1] + 2 * v * u * my + u * u * b[1];
      glow(g, qx, qy, 6 * p.scale, C.amber, 0.9);
    }
  }

  private drawSlot(c: Ctx, s: GameState, k: number, m: Model, t: number): void {
    if (isChild(m)) {
      const px = slotX(k) + (PLINTH - 0.8) / 2;
      const py = slotY(k) + (PLINTH - 0.8) / 2;
      isoBlock(c, px, py, 0.8, 0.8, PLINTH_H, PLINTH_H + 2.5, PLINTH_TOP, PLINTH_L, PLINTH_R);
    }
    const gm = coreGeom(k, m);
    this.drawCore(c, s, m, k, gm, t);
    const [x0, y0, x1, y1] = bboxOf(c.p, slotX(k), slotY(k), slotX(k) + PLINTH, slotY(k) + PLINTH, 0, gm.z0 + gm.H);
    this.hitsModel.push({ kind: 'model', x0, y0, x1, y1, m });
  }

  private drawCore(c: Ctx, s: GameState, m: Model, k: number, gm: Geom, t: number): void {
    const g = c.g;
    const p = c.p;
    const { x, y, size, z0, H } = gm;
    const st = statusOf(s, m);
    const dead = st === 'deprecated';
    const vault = st === 'vault';
    const live = st === 'live';
    const q = dead ? C.textDim : qualityColor(m.overall);
    const body = dead ? '#24221f' : '#171510';
    const top = dead ? '#302e2a' : vault ? '#1e1d1a' : '#2a2722';

    isoBlock(c, x, y, size, size, z0, z0 + H, top, shade(body, 0.8), shade(body, 0.95));

    // LED bands: quality colour on the front (+y) and right (+x) faces.
    const amt = vault ? 0.22 : dead ? 0.12 : live ? 1 : 0.8;
    const nb = Math.max(3, Math.floor(H / 9));
    const step = (H - 9) / nb;
    for (let b = 0; b < nb; b++) {
      const z = z0 + 4 + b * step;
      const pulse = live ? 0.8 + 0.2 * Math.sin(t * 3 + b * 0.9 + k) : 1;
      const a = Math.min(1, amt * pulse);
      planeY(c, x + 0.1, x + size - 0.1, y + size, z, z + 1.4, withAlpha(q, a));
      planeX(c, x + size, y + 0.1, y + size - 0.1, z, z + 1.4, withAlpha(q, a * 0.7));
    }

    if (!vault && !dead) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const [fx, fy] = project(p, x + size / 2, y + size / 2, 0);
      glow(g, fx, fy, 30 * p.scale, q, live ? 0.16 : 0.09);
      const [tx, ty] = project(p, x + size / 2, y + size / 2, z0 + H);
      glow(g, tx, ty, 22 * p.scale, live ? C.green : C.amber, live ? 0.35 : 0.18);
      g.restore();
    }

    if (dead) {
      // Dusty: a grey film on the top and a dirty lower band on the front.
      floorTile(c, x + 0.05, y + 0.05, size - 0.1, size - 0.1, withAlpha('#8a857c', 0.3), z0 + H);
      planeY(c, x + 0.1, x + size - 0.1, y + size, z0, z0 + H * 0.3, withAlpha('#8a857c', 0.14));
    }

    if (vault) {
      // Behind glass, with a lock on the front face.
      g.save();
      g.globalAlpha = 0.2;
      isoBlock(c, x - 0.12, y - 0.12, size + 0.24, size + 0.24, z0, z0 + H + 7, '#b5c6cf', '#8c9ea7', '#a3b4bd');
      g.restore();
      const zt = z0 + H + 7;
      const corners: [number, number][] = [
        [x - 0.12, y - 0.12],
        [x + size + 0.12, y - 0.12],
        [x + size + 0.12, y + size + 0.12],
        [x - 0.12, y + size + 0.12],
      ];
      g.save();
      g.beginPath();
      corners.forEach(([cx, cy], i) => {
        const [sx, sy] = project(p, cx, cy, zt);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      });
      g.closePath();
      g.strokeStyle = withAlpha(C.fgDim, 0.7);
      g.lineWidth = Math.max(1, p.scale);
      g.stroke();
      g.restore();
      const [lx, ly] = project(p, x + size / 2, y + size + 0.12, z0 + H * 0.4);
      const sc = Math.max(0.8, p.scale);
      g.save();
      g.fillStyle = C.amber;
      g.fillRect(lx - 3 * sc, ly - 2 * sc, 6 * sc, 5 * sc);
      g.beginPath();
      g.strokeStyle = C.amber;
      g.lineWidth = 1.2 * sc;
      g.arc(lx, ly - 2 * sc, 2.2 * sc, Math.PI, 0);
      g.stroke();
      g.restore();
    }
  }

  private drawBay(c: Ctx, s: GameState, t: number): void {
    const g = c.g;
    const p = c.p;
    const tr = s.training;
    const legT = '#4a463f';
    const legL = '#34312c';
    const legR = '#3d3a34';
    // Gantry: two legs and a beam running along x above the stack.
    isoBlock(c, CRANE_X0, CRANE_Y - 0.1, 0.18, 0.18, 0, CRANE_H, legT, legL, legR);
    isoBlock(c, CRANE_X1 - 0.18, CRANE_Y - 0.1, 0.18, 0.18, 0, CRANE_H, legT, legL, legR);
    isoBlock(c, CRANE_X0, CRANE_Y - 0.12, CRANE_X1 - CRANE_X0, 0.24, CRANE_H - 4, CRANE_H, legT, legL, legR);

    let tx = 0.9;
    let zb = 8;
    let blockCol = '#4f4334';
    if (tr) {
      const pct = progressOf(s);
      const Ht = heightFor(tr.paramsB);
      const hc = Math.max(2, pct * Ht);
      // Scaffold poles to the finished height.
      g.save();
      g.globalAlpha = 0.55;
      const sx0 = STACK.x - 0.05;
      const sx1 = STACK.x + STACK.s - 0.01;
      const sy0 = STACK.y - 0.05;
      const sy1 = STACK.y + STACK.s - 0.01;
      isoBlock(c, sx0, sy0, 0.06, 0.06, 0, Ht + 4, C.amberDim, shade(C.amberDim, 0.7), shade(C.amberDim, 0.85));
      isoBlock(c, sx1, sy0, 0.06, 0.06, 0, Ht + 4, C.amberDim, shade(C.amberDim, 0.7), shade(C.amberDim, 0.85));
      isoBlock(c, sx0, sy1, 0.06, 0.06, 0, Ht + 4, C.amberDim, shade(C.amberDim, 0.7), shade(C.amberDim, 0.85));
      isoBlock(c, sx1, sy1, 0.06, 0.06, 0, Ht + 4, C.amberDim, shade(C.amberDim, 0.7), shade(C.amberDim, 0.85));
      g.restore();
      // The part built so far.
      isoBlock(c, STACK.x, STACK.y, STACK.s, STACK.s, 0, hc, '#3a3530', '#2b2824', '#33302b');
      for (let z = 4; z < hc - 2; z += 8) {
        planeY(c, STACK.x + 0.1, STACK.x + STACK.s - 0.1, STACK.y + STACK.s, z, z + 1.2, withAlpha(C.amber, 0.35 + 0.35 * Math.sin(t * 4 + z * 0.3)));
      }
      const [gx, gy] = project(p, STACK.x + STACK.s / 2, STACK.y + STACK.s / 2, hc);
      g.save();
      g.globalCompositeOperation = 'lighter';
      glow(g, gx, gy, 22 * p.scale, C.amber, 0.2);
      g.restore();
      // The hook sweeps across the stack and lowers the next part onto it.
      tx = 1.95 + 0.7 * Math.sin(t * 0.35);
      zb = hc + 4 + 12 * (0.5 + 0.5 * Math.sin(t * 0.7));
      blockCol = C.amberDim;
    }

    // Trolley, rope and block.
    isoBlock(c, tx - 0.22, CRANE_Y - 0.14, 0.44, 0.3, CRANE_H - 7, CRANE_H - 4, '#5a5650', '#3f3c37', '#4c4943');
    const a = project(p, tx, CRANE_Y, CRANE_H - 7);
    const b = project(p, tx, CRANE_Y, zb + 6);
    g.save();
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.strokeStyle = C.fgDim;
    g.lineWidth = Math.max(1, p.scale);
    g.stroke();
    g.restore();
    isoBlock(c, tx - 0.35, CRANE_Y - 0.35, 0.7, 0.7, zb, zb + 6, blockCol, shade(blockCol, 0.7), shade(blockCol, 0.85));

    this.hitsOther.push({ kind: 'training', ...boxHit(c.p, BAY.x0, BAY.y0, BAY.x1, BAY.y1, 0, CRANE_H) });
  }

  private drawRope(c: Ctx): void {
    const g = c.g;
    const p = c.p;
    for (const y of ROPE_YS) isoBlock(c, ROPE_X - 0.06, y - 0.06, 0.12, 0.12, 0, 14, '#5a5650', '#3f3c37', '#4c4943');
    g.save();
    g.strokeStyle = '#8a4a3f';
    g.lineWidth = Math.max(1, 1.5 * p.scale);
    g.beginPath();
    for (let i = 0; i < ROPE_YS.length - 1; i++) {
      const a = project(p, ROPE_X, ROPE_YS[i], 14);
      const b = project(p, ROPE_X, ROPE_YS[i + 1], 14);
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 10 * p.scale, b[0], b[1]);
    }
    g.stroke();
    g.restore();
  }

  private drawRival(c: Ctx, t: number): void {
    const g = c.g;
    const p = c.p;
    const r = this.rival;
    const z0 = RIVAL_PLINTH_H;
    if (r) {
      const col = COMPETITORS.find((d) => d.id === r.comp.id)?.color ?? C.blue;
      const H = rivalHeight(r.m.overall);
      const size = 0.9;
      const x = RIVAL_X + (RIVAL_SIZE - size) / 2;
      const y = RIVAL_Y + (RIVAL_SIZE - size) / 2;
      const body = '#1a1714';
      isoBlock(c, x, y, size, size, z0, z0 + H, '#252320', shade(body, 0.8), shade(body, 0.95));
      const nb = Math.max(3, Math.floor(H / 9));
      const step = (H - 9) / nb;
      for (let b = 0; b < nb; b++) {
        const z = z0 + 4 + b * step;
        const a = 0.75 + 0.25 * Math.sin(t * 2.5 + b * 0.9);
        planeY(c, x + 0.1, x + size - 0.1, y + size, z, z + 1.4, withAlpha(col, a));
        planeX(c, x + size, y + 0.1, y + size - 0.1, z, z + 1.4, withAlpha(col, a * 0.7));
      }
      g.save();
      g.globalCompositeOperation = 'lighter';
      const [fx, fy] = project(p, x + size / 2, y + size / 2, 0);
      glow(g, fx, fy, 34 * p.scale, col, 0.12);
      const [tx, ty] = project(p, x + size / 2, y + size / 2, z0 + H);
      glow(g, tx, ty, 22 * p.scale, col, 0.3);
      g.restore();
    }
    this.hitsOther.push({ kind: 'rival', ...boxHit(c.p, RIVAL_X, RIVAL_Y, RIVAL_X + RIVAL_SIZE, RIVAL_Y + RIVAL_SIZE, 0, z0 + (r ? rivalHeight(r.m.overall) : 0)) });
  }

  /** Pills in screen space, drawn last so no model covers them. */
  private drawOverlays(c: Ctx, s: GameState, t: number): void {
    const g = c.g;
    const p = c.p;
    g.save();
    for (let k = 0; k < SLOTS; k++) {
      const m = this.bySlot[k];
      if (!m || m.releasedDay === null || m.deprecated) continue;
      if (!s.products.some((pr) => pr.active && pr.modelId === m.id)) continue;
      const gm = coreGeom(k, m);
      const [sx, sy] = project(p, gm.x + gm.size / 2, gm.y + gm.size / 2, gm.z0 + gm.H + 6);
      drawPill(g, sx, sy, 'LIVE', C.green, undefined, t);
    }
    if (s.training) {
      const tr = s.training;
      const pct = progressOf(s);
      const top = heightFor(tr.paramsB) + 10;
      const [x, y] = project(p, STACK.x + STACK.s / 2, STACK.y + STACK.s / 2, top);
      drawPill(g, x, y, `${kindWord(tr.kind)}: ${tr.name} ${Math.round(pct * 100)}%`, C.amber, pct, t);
      if (tr.pendingIncident) drawPill(g, x, y - 26, 'DECISION NEEDED', C.red, undefined, t);
    }
    if (this.rival) {
      const r = this.rival;
      const col = COMPETITORS.find((d) => d.id === r.comp.id)?.color ?? C.blue;
      // Beside the tower, at mid height, so it does not stack on the LIVE pills above the grid.
      const [x, y] = project(p, RIVAL_X + RIVAL_SIZE + 0.4, RIVAL_Y + RIVAL_SIZE / 2, RIVAL_PLINTH_H + rivalHeight(r.m.overall) * 0.4);
      drawPill(g, x, y, labName(s, r.comp.id), col, undefined, t);
    }
    if (this.shelfN > 0) {
      // Anchored right of the rack so the pill stays on screen at phone width.
      const [x, y] = project(p, STORE.x1 + 1.0, STORE.y0 + 0.9, SHELF_TOP + 8);
      drawPill(g, x, y, `×${this.shelfN} in storage`, C.amberDim, undefined, t);
    }
    g.restore();
  }

  hitTest(x: number, y: number): SceneHit | null {
    const s = this.s;
    if (!s) return null;
    for (let i = this.hitsModel.length - 1; i >= 0; i--) {
      const h = this.hitsModel[i];
      if (inBox(h, x, y) && h.m) return { id: `model:${h.m.id}`, label: labelModel(s, h.m) };
    }
    for (const h of this.hitsOther) {
      if (!inBox(h, x, y)) continue;
      if (h.kind === 'training') return { id: 'training', label: labelTraining(s) };
      if (h.kind === 'rival') return { id: 'rival', label: labelRival(s, this.rival) };
      if (h.kind === 'shelf') return { id: 'shelf', label: labelShelf(s, this.shelfN) };
    }
    return null;
  }
}

function boxHit(p: Projector, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): { x0: number; y0: number; x1: number; y1: number } {
  const [a, b, c, d] = bboxOf(p, x0, y0, x1, y1, z0, z1);
  return { x0: a, y0: b, x1: c, y1: d };
}

function inBox(h: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): boolean {
  return x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1;
}

/** Best rival model across the rope: the highest overall among active labs that have released one. */
function bestRival(s: GameState): Rival | null {
  let best: Rival | null = null;
  for (const comp of s.competitors) {
    if (!comp.active || !comp.model) continue;
    if (!best || comp.model.overall > best.m.overall) best = { comp, m: comp.model };
  }
  return best;
}

function labelModel(s: GameState, m: Model): string {
  const st = statusOf(s, m);
  const lines: string[] = [];
  lines.push(st === 'vault' ? (m.codename ?? m.name) : m.name);
  lines.push(`${fmtParams(m.paramsB)} params · overall ${Math.round(m.overall)}`);
  if (m.releasedDay !== null) {
    const e = provisionalElo(s, m);
    lines.push(`Elo ${Math.round(e.elo)}${e.provisional ? ' (provisional)' : ''}`);
  }
  const pid = parentIdOf(m);
  if (pid) {
    const par = s.models.find((x) => x.id === pid);
    if (par) {
      const how = m.derivedFrom?.kind === 'distill' ? 'Distilled from' : m.derivedFrom ? 'Merged from' : 'Fine-tune of';
      lines.push(`${how} ${par.name}`);
    }
  }
  if (st === 'vault') {
    lines.push(`Status: in the vault, unreleased\nTrained ${tdate(m.trainedDay)}`);
  } else if (st === 'deprecated') {
    lines.push(`Status: deprecated\nReleased ${tdate(m.releasedDay ?? m.trainedDay)}`);
  } else {
    const serving = liveProducts(s, m);
    const head = st === 'live' ? `Status: LIVE in ${serving.join(', ')}` : 'Status: released';
    lines.push(`${head}\nReleased ${tdate(m.releasedDay ?? m.trainedDay)}`);
  }
  return lines.join('\n');
}

function labelTraining(s: GameState): string {
  const tr = s.training;
  if (!tr) return 'Construction bay\nIdle, no run in progress';
  const lines = [`${kindWord(tr.kind)}: ${tr.name}`, `${fmtParams(tr.paramsB)} · ${Math.round(progressOf(s) * 100)}% done`];
  if (tr.pendingIncident) lines.push('Waiting for your decision');
  else if (tr.stallDays && tr.stallDays > 0) lines.push(`Stalled ${Math.ceil(tr.stallDays)} days`);
  return lines.join('\n');
}

function labelRival(s: GameState, r: Rival | null): string {
  if (!r) return 'Rival\nNo rival model released yet';
  return [
    `Rival: ${labName(s, r.comp.id)}`,
    `${r.m.name} · overall ${Math.round(r.m.overall)}`,
    `Elo ${Math.round(r.m.elo)}`,
    `Released ${tdate(r.m.releasedDay)}`,
  ].join('\n');
}

function labelShelf(s: GameState, n: number): string {
  const older = s.models.slice(0, n);
  const dead = older.filter((m) => m.deprecated).length;
  return `Storage shelf: ${n} older model${n === 1 ? '' : 's'}\n${dead} deprecated`;
}
