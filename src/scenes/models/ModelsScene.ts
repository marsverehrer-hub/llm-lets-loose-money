// Model vault: the player's models as server-core monoliths on plinths, one island each (the 12 newest; a model keeps
// its slot, index mod 12), plus the construction bay (the live run), the storage shelf of older models and the best
// rival model behind a rope. Islands sit on the kit's lattice and the camera fits them to the canvas. Reads GameState
// fresh every frame.
import type { Competitor, GameState, Model } from '../../sim/types';
import { COMPETITORS } from '../../sim/data/competitors';
import { provisionalElo } from '../../sim/systems/lab';
import { labName } from '../../sim/systems/labs';
import { tdate } from '../../ui/shell/fmt';
import type { Scene, SceneHit } from '../types';
import {
  Tags,
  alpha,
  background,
  box,
  faceX,
  faceY,
  fitIso,
  flat,
  frac,
  hitBox,
  hud,
  iso,
  line3,
  lattice,
  mix,
  outline,
  palette,
  slab,
  tri,
  type Box3,
  type Ctx,
  type Pal,
  type Proj,
  type Tri,
} from '../kit';

const SLOTS = 12;
const CELL = 3.4;
const ISLE = 3.0;
const PLINTH = 1.5;
const PLINTH_H = 5;
const SHELF_BOARDS = [6, 17, 28];
const SHELF_TOP = 38;
const MAX_BOXES = 12;
const CRANE_H = 66;

type Status = 'vault' | 'deprecated' | 'live' | 'released';
interface Rival {
  comp: Competitor;
  m: NonNullable<Competitor['model']>;
}
interface Isle {
  x: number;
  y: number;
  line: number;
}
interface Geom {
  x: number;
  y: number;
  size: number;
  z0: number;
  H: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Overall quality as a band colour: red at 40, caution at 60, green at 90 (timing-screen colours). */
function qualityColor(pal: Pal, o: number): string {
  return o < 60 ? mix(pal.down, pal.warn, clamp01((o - 40) / 20)) : mix(pal.warn, pal.up, clamp01((o - 60) / 30));
}

/** Tower height grows with log10 of parameter count (0.3B is the floor, 10T the ceiling). */
function heightFor(paramsB: number): number {
  const lp = Math.log10(Math.max(0.1, paramsB));
  return 14 + clamp01((lp + 0.5) / 4.5) * 44;
}

function rivalHeight(overall: number): number {
  return 18 + clamp01((overall - 40) / 60) * 42;
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

/** Core of a model on its island. Fine-tunes and distills stand smaller, on a riser. */
function coreGeom(isle: Isle, m: Model): Geom {
  const H = heightFor(m.paramsB);
  const cx = isle.x + ISLE / 2;
  const cy = isle.y + ISLE / 2;
  if (isChild(m)) return { x: cx - 0.3, y: cy - 0.3, size: 0.6, z0: PLINTH_H + 2.5, H: H * 0.6 };
  return { x: cx - 0.45, y: cy - 0.45, size: 0.9, z0: PLINTH_H, H };
}

export class ModelsScene implements Scene {
  private cssW = 0;
  private cssH = 0;
  private proj: Proj = { ox: 0, oy: 0, s: 1 };
  private time = 0;
  private s: GameState | null = null;
  private hover: string | null = null;
  private readonly tags = new Tags();
  /** Layout key: canvas size, slots in use and whether the shelf shows. */
  private key = '';
  private slotIsles: Isle[] = [];
  private bayIsle: Isle = { x: 0, y: 0, line: 0 };
  private rivalIsle: Isle = { x: 0, y: 0, line: 0 };
  private storeIsle: Isle | null = null;
  private lines = 1;
  /** Models currently on the grid, by slot (null = empty plinth). Refilled every frame. */
  private bySlot: (Model | null)[] = new Array(SLOTS).fill(null);
  private shelfN = 0;
  private rival: Rival | null = null;
  private hits: { id: string; box: Box3; line: number; m?: Model }[] = [];
  /** Static layer (islands, plinths, monoliths, shelf, rival, crane frame): rebuilt when the vault changes. */
  private live = false;
  private staticCv: HTMLCanvasElement | null = null;
  private staticKey = '';

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.key = '';
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

  private relayout(slots: number, shelf: boolean): void {
    const n = 2 + slots + (shelf ? 1 : 0);
    const cells = lattice(n, CELL, 0.4, 64, this.cssW, this.cssH);
    const at = (k: number): Isle => {
      const c = cells[k] ?? { x: 0, y: 0, line: 0 };
      return { x: c.x + (CELL - ISLE) / 2, y: c.y + (CELL - ISLE) / 2, line: c.line };
    };
    let k = 0;
    this.bayIsle = at(k++);
    this.storeIsle = shelf ? at(k++) : null;
    this.slotIsles = [];
    for (let i = 0; i < slots; i++) this.slotIsles.push(at(k++));
    this.rivalIsle = at(k++);
    this.lines = cells.length ? cells[cells.length - 1].line + 1 : 1;
    const boxes: Box3[] = [];
    const all = [this.bayIsle, this.rivalIsle, ...this.slotIsles, ...(this.storeIsle ? [this.storeIsle] : [])];
    for (const i of all) boxes.push({ x0: i.x, y0: i.y, x1: i.x + ISLE, y1: i.y + ISLE, z0: -2, z1: 58 });
    boxes.push({ x0: this.bayIsle.x, y0: this.bayIsle.y, x1: this.bayIsle.x + ISLE, y1: this.bayIsle.y + ISLE, z0: 0, z1: CRANE_H + 4 });
    fitIso(this.proj, boxes, this.cssW, this.cssH);
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.s = s;
    this.time += dt;
    const t = this.time;
    const n = s.models.length;
    const first = Math.max(0, n - SLOTS);
    this.shelfN = first;
    const slots = Math.max(1, Math.min(SLOTS, n));
    const key = `${this.cssW}x${this.cssH}|${slots}|${first > 0 ? 1 : 0}`;
    if (key !== this.key) {
      this.key = key;
      this.relayout(slots, first > 0);
    }
    for (let k = 0; k < SLOTS; k++) this.bySlot[k] = null;
    for (let i = first; i < n; i++) this.bySlot[i % SLOTS] = s.models[i];
    this.rival = bestRival(s);

    const pal = palette();
    const c: Ctx = { g, p: this.proj, pal };
    const dpr = g.getTransform().a || 1;
    let vault = '';
    for (let k = 0; k < this.slotIsles.length; k++) {
      const m = this.bySlot[k];
      vault += m ? `${m.id}:${statusOf(s, m)}:${Math.round(m.overall)};` : '-;';
    }
    const tr = s.training;
    const skey = `${key}@${dpr}|${pal.bg}|${vault}|${this.rival ? `${this.rival.comp.id}:${Math.round(this.rival.m.overall)}` : '-'}|${tr ? `${tr.paramsB}:${Math.round(progressOf(s) * 100)}` : '-'}`;
    if (!this.staticCv || skey !== this.staticKey) {
      const cv = this.staticCv ?? document.createElement('canvas');
      cv.width = Math.max(1, Math.round(this.cssW * dpr));
      cv.height = Math.max(1, Math.round(this.cssH * dpr));
      const sg = cv.getContext('2d');
      if (sg) {
        sg.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.hits.length = 0;
        this.islands({ g: sg, p: this.proj, pal }, s, first, t, false);
        this.hits.sort((a, b) => a.line - b.line);
      }
      this.staticCv = cv;
      this.staticKey = skey;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.staticCv, 0, 0);
    g.restore();
    this.islands(c, s, first, t, true);
    this.drawCables(c, t);

    if (this.hover) {
      const h = this.hits.find((x) => (x.m ? `model:${x.m.id}` : x.id) === this.hover);
      if (h) outline(c, h.box);
    }
    this.drawTags(c, s);
    const released = s.models.filter((m) => m.releasedDay !== null).length;
    hud(g, pal, this.cssW, this.cssH, `${n} models · ${released} released · ${s.products.filter((p) => p.active).length} live products`);
  }

  private islands(c: Ctx, s: GameState, first: number, t: number, live: boolean): void {
    this.live = live;
    if (!live) background(c, this.cssW, this.cssH);
    for (let line = 0; line < this.lines; line++) {
      if (this.bayIsle.line === line) this.drawBay(c, s, t);
      if (live) continue;
      if (this.storeIsle && this.storeIsle.line === line) this.drawShelf(c, s, first);
      for (let k = 0; k < this.slotIsles.length; k++) {
        const isle = this.slotIsles[k];
        if (isle.line !== line) continue;
        this.drawSlot(c, s, isle, this.bySlot[k]);
      }
      if (this.rivalIsle.line === line) this.drawRival(c);
    }
    if (live) {
      // Beacons on live models.
      for (let k = 0; k < this.slotIsles.length; k++) {
        const m = this.bySlot[k];
        if (!m || statusOf(s, m) !== 'live') continue;
        const gm = coreGeom(this.slotIsles[k], m);
        const [bx, by] = iso(c.p, gm.x + gm.size / 2, gm.y + gm.size / 2, gm.z0 + gm.H + 1.5);
        c.g.fillStyle = frac(t * 1.2 + k * 0.17) < 0.55 ? c.pal.up : alpha(c.pal.up, 0.3);
        c.g.beginPath();
        c.g.arc(bx, by, Math.max(1.5, 2.2 * c.p.s), 0, Math.PI * 2);
        c.g.fill();
      }
    }
  }

  /** A model island: plinth with the team stripe, the monolith with quality bands, its status dressing. */
  private drawSlot(c: Ctx, s: GameState, isle: Isle, m: Model | null): void {
    const { pal } = c;
    slab(c, isle.x, isle.y, ISLE, ISLE, 2, 0.5);
    const px = isle.x + (ISLE - PLINTH) / 2;
    const py = isle.y + (ISLE - PLINTH) / 2;
    box(c, px, py, PLINTH, PLINTH, 0, PLINTH_H, pal.steel, alpha(pal.silver, 0.7));
    if (!m) {
      flat(c, px + 0.3, py + 0.3, PLINTH - 0.6, PLINTH - 0.6, PLINTH_H + 0.01, alpha(pal.fg4, 0.4));
      return;
    }
    faceY(c, px, px + PLINTH, py + PLINTH, 1.4, 2.6, pal.hl);
    const gm = coreGeom(isle, m);
    if (isChild(m)) box(c, gm.x - 0.15, gm.y - 0.15, gm.size + 0.3, gm.size + 0.3, PLINTH_H, gm.z0, pal.metal);
    this.drawCore(c, s, m, gm);
    this.hits.push({ id: 'model', m, line: isle.line, box: { x0: px, y0: py, x1: px + PLINTH, y1: py + PLINTH, z0: 0, z1: gm.z0 + gm.H + 4 } });
  }

  private drawCore(c: Ctx, s: GameState, m: Model, gm: Geom): void {
    const { g, p, pal } = c;
    const { x, y, size, z0, H } = gm;
    const st = statusOf(s, m);
    const dead = st === 'deprecated';
    const vault = st === 'vault';
    const live = st === 'live';
    const q = dead ? pal.fg4 : qualityColor(pal, m.overall);
    const body: Tri = dead ? tri(pal.light ? '#7d828c' : '#3a3c42') : pal.metal;
    box(c, x, y, size, size, z0, z0 + H, body, alpha(pal.silver, dead ? 0.25 : 0.6));
    // Quality bands on the two visible faces.
    const amt = vault ? 0.45 : dead ? 0.3 : live ? 1 : 0.85;
    const nb = Math.max(3, Math.floor(H / 7));
    const step = (H - 6) / nb;
    for (let b = 0; b < nb; b++) {
      const z = z0 + 3 + b * step;
      const a = Math.min(1, amt);
      faceY(c, x + 0.08, x + size - 0.08, y + size, z, z + 1.2, alpha(q, a));
      faceX(c, x + size, y + 0.08, y + size - 0.08, z, z + 1.2, alpha(q, a * 0.7));
    }
    if (live) faceY(c, x + 0.08, x + size - 0.08, y + size, z0 + H - 1.5, z0 + H - 0.5, pal.up);
    if (dead) flat(c, x + 0.04, y + 0.04, size - 0.08, size - 0.08, z0 + H + 0.01, alpha(pal.fg3, 0.35));
    if (vault) {
      // Behind glass, with a yellow lock on the front.
      const e = 0.14;
      const glass = alpha(pal.light ? '#9fb3c8' : '#b5c6cf', pal.light ? 0.28 : 0.16);
      box(c, x - e, y - e, size + 2 * e, size + 2 * e, z0, z0 + H + 5, { t: glass, l: glass, r: glass });
      const zt = z0 + H + 5;
      const rim = alpha(pal.silver, 0.8);
      line3(c, x - e, y + size + e, z0, x - e, y + size + e, zt, rim, 1, 0.6);
      line3(c, x + size + e, y + size + e, z0, x + size + e, y + size + e, zt, rim, 1, 0.6);
      line3(c, x + size + e, y - e, z0, x + size + e, y - e, zt, rim, 1, 0.6);
      line3(c, x - e, y + size + e, zt, x + size + e, y + size + e, zt, rim, 1, 0.6);
      line3(c, x + size + e, y + size + e, zt, x + size + e, y - e, zt, rim, 1, 0.6);
      const [lx, ly] = iso(p, x + size / 2, y + size + e, z0 + H * 0.35);
      const sc = Math.max(0.7, p.s);
      g.fillStyle = pal.hl;
      g.fillRect(lx - 3 * sc, ly - 2 * sc, 6 * sc, 5 * sc);
      g.strokeStyle = pal.hl;
      g.lineWidth = 1.2 * sc;
      g.beginPath();
      g.arc(lx, ly - 2 * sc, 2.2 * sc, Math.PI, 0);
      g.stroke();
    }
  }

  /** Cables link each fine-tune or distill to its parent (or the storage shelf), with a pulse running along them. */
  private drawCables(c: Ctx, t: number): void {
    const { g, p, pal } = c;
    for (let k = 0; k < this.slotIsles.length; k++) {
      const m = this.bySlot[k];
      if (!m || !isChild(m)) continue;
      const pid = parentIdOf(m);
      if (!pid) continue;
      const j = this.bySlot.findIndex((x) => x?.id === pid);
      const gm = coreGeom(this.slotIsles[k], m);
      const a = iso(p, gm.x + gm.size / 2, gm.y + gm.size + 0.2, gm.z0 - 1);
      let b: [number, number];
      if (j >= 0 && j < this.slotIsles.length) {
        const pi = this.slotIsles[j];
        b = iso(p, pi.x + ISLE / 2, pi.y + ISLE / 2 + PLINTH / 2, PLINTH_H - 1);
      } else if (this.storeIsle) {
        b = iso(p, this.storeIsle.x + ISLE / 2, this.storeIsle.y + ISLE / 2, 4);
      } else continue;
      const mx = (a[0] + b[0]) / 2;
      const my = Math.max(a[1], b[1]) + 18 * p.s;
      g.strokeStyle = alpha(pal.hl, 0.55);
      g.lineWidth = Math.max(1, 1.3 * p.s);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo(mx, my, b[0], b[1]);
      g.stroke();
      const u = (t * 0.35 + k * 0.173) % 1;
      const v = 1 - u;
      g.fillStyle = pal.hl;
      g.beginPath();
      g.arc(v * v * a[0] + 2 * v * u * mx + u * u * b[0], v * v * a[1] + 2 * v * u * my + u * u * b[1], Math.max(1.5, 2 * p.s), 0, Math.PI * 2);
      g.fill();
    }
  }

  /** Construction bay: a gantry crane stacks the model under training to its finished height. */
  private drawBay(c: Ctx, s: GameState, t: number): void {
    const { pal } = c;
    const { x, y } = this.bayIsle;
    const live = this.live;
    if (!live) slab(c, x, y, ISLE, ISLE, 2, 0.5);
    if (!live) faceY(c, x, x + ISLE, y + ISLE, -2, -1, pal.hl);
    if (!live) faceX(c, x + ISLE, y, y + ISLE, -2, -1, pal.hl);
    for (let k = 0; k < 5 && !live; k++) flat(c, x + 0.2 + k * 0.55, y + ISLE - 0.4, 0.28, 0.25, 0.02, alpha(pal.hl, 0.55));
    const leg = tri(pal.hl, 0.82, 0.62);
    const cy = y + ISLE / 2;
    const x0 = x + 0.25;
    const x1 = x + ISLE - 0.4;
    if (!live) box(c, x0, cy - 0.08, 0.15, 0.15, 0, CRANE_H, leg);
    const tr = s.training;
    const sx = x + ISLE / 2 - 0.45;
    const sy = cy - 0.45;
    let tx = x + 1.0;
    let zb = 8;
    if (tr) {
      const pct = progressOf(s);
      const Ht = heightFor(tr.paramsB);
      const hc = Math.max(2, pct * Ht);
      const pole = alpha(pal.warn, 0.85);
      for (const [px, py] of [
        [sx - 0.1, sy - 0.1],
        [sx + 1.0, sy - 0.1],
        [sx + 1.0, sy + 1.0],
        [sx - 0.1, sy + 1.0],
      ] as [number, number][])
        if (!live) line3(c, px, py, 0, px, py, Ht + 3, pole, 0.9, 0.5);
      if (!live) {
        // Wireframe of the finished height, and the part built so far.
        line3(c, sx, sy + 0.9, Ht, sx + 0.9, sy + 0.9, Ht, alpha(pal.hl, 0.6), 1, 0.6);
        line3(c, sx + 0.9, sy + 0.9, Ht, sx + 0.9, sy, Ht, alpha(pal.hl, 0.6), 1, 0.6);
        box(c, sx, sy, 0.9, 0.9, 0, hc, pal.metal, alpha(pal.silver, 0.6));
        for (let z = 3; z < hc - 2; z += 7) faceY(c, sx + 0.08, sx + 0.82, sy + 0.9, z, z + 1.2, alpha(pal.hl, 0.75));
      }
      tx = x + 1.3 + 0.5 * Math.sin(t * 0.35);
      zb = hc + 4 + 10 * (0.5 + 0.5 * Math.sin(t * 0.7));
    }
    if (!live) {
      box(c, x1, cy - 0.08, 0.15, 0.15, 0, CRANE_H, leg);
      box(c, x0, cy - 0.1, x1 - x0 + 0.15, 0.2, CRANE_H - 3, CRANE_H, leg);
      this.hits.push({ id: 'training', line: this.bayIsle.line, box: { x0: x, y0: y, x1: x + ISLE, y1: y + ISLE, z0: 0, z1: CRANE_H } });
      return;
    }
    box(c, tx - 0.2, cy - 0.15, 0.4, 0.3, CRANE_H - 6, CRANE_H - 3, pal.metal);
    line3(c, tx, cy, CRANE_H - 6, tx, cy, zb + 5, alpha(pal.fg2, 0.9), 0.8, 0.6);
    box(c, tx - 0.3, cy - 0.3, 0.6, 0.6, zb, zb + 5, tr ? tri(pal.hl, 0.82, 0.62) : pal.metal);
  }

  /** Older models: a storage rack, one case per model (newest first), up to 12 shown. */
  private drawShelf(c: Ctx, s: GameState, first: number): void {
    const { pal } = c;
    const isle = this.storeIsle;
    if (!isle) return;
    slab(c, isle.x, isle.y, ISLE, ISLE, 2, 0.5);
    const x0 = isle.x + 0.4;
    const y0 = isle.y + 0.6;
    const len = ISLE - 0.8;
    const d = 0.9;
    for (const ux of [x0, x0 + len - 0.08]) box(c, ux, y0, 0.08, 0.08, 0, SHELF_TOP, pal.steel);
    const count = Math.min(first, MAX_BOXES);
    for (let lv = 0; lv < SHELF_BOARDS.length; lv++) {
      const z = SHELF_BOARDS[lv];
      box(c, x0, y0, len, d, z - 1, z, pal.metal);
      for (let col = 0; col < 4; col++) {
        const i = lv * 4 + col;
        if (i >= count) break;
        const m = s.models[first - 1 - i];
        const bx = x0 + 0.1 + col * ((len - 0.2) / 4);
        const h = 6 + (i % 3);
        box(c, bx, y0 + 0.15, (len - 0.2) / 4 - 0.08, 0.6, z, z + h, pal.light ? tri('#4a4d55') : tri('#2f3137'));
        const dead = m.deprecated || m.releasedDay === null;
        faceY(c, bx + 0.08, bx + 0.3, y0 + 0.75, z + 2, z + 3.2, alpha(m.deprecated ? pal.fg4 : qualityColor(pal, m.overall), dead ? 0.4 : 0.95));
      }
    }
    for (const ux of [x0, x0 + len - 0.08]) box(c, ux, y0 + d - 0.08, 0.08, 0.08, 0, SHELF_TOP, pal.steel);
    box(c, x0, y0, len, d, SHELF_TOP - 1, SHELF_TOP, pal.metal, alpha(pal.silver, 0.5));
    this.hits.push({ id: 'shelf', line: isle.line, box: { x0: isle.x, y0: isle.y, x1: isle.x + ISLE, y1: isle.y + ISLE, z0: 0, z1: SHELF_TOP } });
  }

  /** The best rival model across the rope, in its lab's colour. */
  private drawRival(c: Ctx): void {
    const { g, p, pal } = c;
    const { x, y } = this.rivalIsle;
    slab(c, x, y, ISLE, ISLE, 2, 0.5, pal.light ? tri('#d6d8dd', 0.86, 0.72) : tri(pal.bg2, 0.8, 0.6));
    const r = this.rival;
    const col = r ? COMPETITORS.find((d) => d.id === r.comp.id)?.color ?? pal.blue : pal.fg4;
    const px = x + (ISLE - PLINTH) / 2;
    const py = y + (ISLE - PLINTH) / 2 - 0.2;
    box(c, px, py, PLINTH, PLINTH, 0, PLINTH_H + 1, pal.metal, alpha(pal.silver, 0.4));
    let H = 0;
    if (r) {
      H = rivalHeight(r.m.overall);
      const size = 0.9;
      const cx = px + (PLINTH - size) / 2;
      const cy = py + (PLINTH - size) / 2;
      const z0 = PLINTH_H + 1;
      box(c, cx, cy, size, size, z0, z0 + H, pal.metal, alpha(col, 0.8));
      const nb = Math.max(3, Math.floor(H / 7));
      const step = (H - 6) / nb;
      for (let b = 0; b < nb; b++) {
        const z = z0 + 3 + b * step;
        const a = 0.85;
        faceY(c, cx + 0.08, cx + size - 0.08, cy + size, z, z + 1.2, alpha(col, a));
        faceX(c, cx + size, cy + 0.08, cy + size - 0.08, z, z + 1.2, alpha(col, a * 0.7));
      }
    }
    // Rope line along the front edges.
    const posts: [number, number][] = [
      [x + 0.2, y + ISLE - 0.3],
      [x + 1.4, y + ISLE - 0.3],
      [x + ISLE - 0.3, y + ISLE - 0.3],
      [x + ISLE - 0.3, y + 1.4],
      [x + ISLE - 0.3, y + 0.2],
    ];
    for (const [qx, qy] of posts) box(c, qx - 0.05, qy - 0.05, 0.1, 0.1, 0, 9, pal.steel, alpha(pal.silver, 0.6));
    g.strokeStyle = pal.down;
    g.lineWidth = Math.max(1, 1.4 * p.s);
    g.beginPath();
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = iso(p, posts[i][0], posts[i][1], 8.5);
      const b = iso(p, posts[i + 1][0], posts[i + 1][1], 8.5);
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 5 * p.s, b[0], b[1]);
    }
    g.stroke();
    this.hits.push({ id: 'rival', line: this.rivalIsle.line, box: { x0: px, y0: py, x1: px + PLINTH, y1: py + PLINTH, z0: 0, z1: PLINTH_H + 1 + H } });
  }

  private drawTags(c: Ctx, s: GameState): void {
    const { g, p, pal } = c;
    const small = p.s < 0.42;
    const tags = this.tags;
    for (let k = 0; k < this.slotIsles.length; k++) {
      const m = this.bySlot[k];
      if (!m) continue;
      const gm = coreGeom(this.slotIsles[k], m);
      const st = statusOf(s, m);
      const [x, y] = iso(p, gm.x + gm.size / 2, gm.y + gm.size / 2, gm.z0 + gm.H + 6);
      const name = st === 'vault' ? m.codename ?? m.name : m.name;
      const sub = st === 'live' ? 'Live' : st === 'vault' ? 'Vault' : st === 'deprecated' ? 'Retired' : `${Math.round(m.overall)}`;
      const tone = st === 'live' ? pal.up : st === 'vault' ? pal.hl : st === 'deprecated' ? pal.fg4 : qualityColor(pal, m.overall);
      const hovered = this.hover === `model:${m.id}`;
      tags.add(x, y, name, { tone, sub, small, leader: 3 }, hovered ? 20 : st === 'live' ? 6 : 3);
    }
    if (s.training) {
      const tr = s.training;
      const pct = progressOf(s);
      const [x, y] = iso(p, this.bayIsle.x + ISLE / 2, this.bayIsle.y + ISLE / 2, CRANE_H + 4);
      tags.add(x, y, `${kindWord(tr.kind)} ${tr.name}`, { solid: true, sub: `${Math.round(pct * 100)}%`, progress: pct, small }, 12);
      if (tr.pendingIncident) tags.add(x, y - 20, 'Decision needed', { tone: pal.down, small }, 15);
    }
    if (this.rival) {
      const r = this.rival;
      const col = COMPETITORS.find((d) => d.id === r.comp.id)?.color ?? pal.blue;
      const [x, y] = iso(p, this.rivalIsle.x + ISLE / 2, this.rivalIsle.y + ISLE / 2 - 0.2, PLINTH_H + rivalHeight(r.m.overall) + 6);
      tags.add(x, y, labName(s, r.comp.id), { tone: col, sub: `${Math.round(r.m.overall)}`, small, leader: 3 }, 7);
    }
    if (this.storeIsle && this.shelfN > 0) {
      const [x, y] = iso(p, this.storeIsle.x + 0.6, this.storeIsle.y + 0.8, SHELF_TOP + 3);
      tags.add(x, y, 'Storage', { tone: pal.fg3, sub: `×${this.shelfN}`, small, leader: 3 }, 5);
    }
    tags.flush(g, pal, this.cssW, this.cssH);
  }

  hitTest(x: number, y: number): SceneHit | null {
    const s = this.s;
    if (!s) return null;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (!hitBox(this.proj, h.box, x, y)) continue;
      if (h.m) return { id: `model:${h.m.id}`, label: labelModel(s, h.m) };
      if (h.id === 'training') return { id: 'training', label: labelTraining(s) };
      if (h.id === 'rival') return { id: 'rival', label: labelRival(s, this.rival) };
      if (h.id === 'shelf') return { id: 'shelf', label: labelShelf(s, this.shelfN) };
    }
    return null;
  }
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
