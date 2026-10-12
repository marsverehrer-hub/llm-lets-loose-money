// Treasury scene: the company's money as an isometric room. Builds a layout from GameState, rebuilds the static parts
// only when the layout signature changes, and paints one frame at a time.
import type { GameState } from '../../sim/types';
import { formatMoney, formatNumber } from '../../sim/util';
import { project, TILE_H, TILE_W, type Projector } from '../../office/iso';
import { C } from '../../office/palette';
import { glow, type Ctx } from '../../office/draw/prims';
import { drawFloor, drawWalls, WALL_H } from '../../office/draw/room';
import { drawPerson } from '../../office/draw/person';
import { drawPlant } from '../../office/draw/furniture';
import type { Scene, SceneHit } from '../types';
import { EXP_LABEL, logCount, tipFor, VAULT_FULL } from './model';
import type { Lane } from './plan';
import {
  BIN,
  BOARD,
  BUS,
  CASH_SPOTS,
  CHAIN_ANCHOR,
  COLLECTOR_AT,
  CRATES,
  D,
  EXP_MAIN,
  OFFER_AT,
  PLANTS,
  REV_PATH,
  SAFE,
  SEATS,
  SLOT,
  TABLE,
  VAULT,
  W,
  buildLayout,
  pathAt,
  type Layout,
  type Pt,
} from './plan';
import * as parts from './parts';
import { TREAS } from './parts';

const FLOW_SPEED = 0.035; // belt cycles per second
const TAU = Math.PI * 2;
const COIN_MAX = 40;
const HISTORY_SHOWN = 80;

interface StaticItem {
  d: number;
  fn: (c: Ctx, t: number) => void;
}

interface Person {
  x: number;
  y: number;
  role: string;
  seed: number;
  sitting: boolean;
  kind: 'seat' | 'offer' | 'collector';
}

interface Hit {
  id: string;
  poly: number[];
}

type Corner = [number, number, number];

/** Convex hull of screen points, flattened. Monotone chain. */
function hull(pts: Pt[]): number[] {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  const out: number[] = [];
  for (const q of lower.concat(upper)) out.push(q[0], q[1]);
  return out;
}

/** True when (x, y) is inside a convex polygon given flat, in either winding. */
function inside(poly: number[], x: number, y: number): boolean {
  let sign = 0;
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const cr = (poly[j] - poly[i]) * (y - poly[i + 1]) - (poly[j + 1] - poly[i + 1]) * (x - poly[i]);
    if (cr === 0) continue;
    const sg = cr > 0 ? 1 : -1;
    if (sign === 0) sign = sg;
    else if (sg !== sign) return false;
  }
  return sign !== 0;
}

/** The eight screen corners of an axis box in floor units. */
function boxCorners(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): Corner[] {
  return [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
}

function buildStatics(L: Layout): StaticItem[] {
  const out: StaticItem[] = [];
  // gold pallets (empty when cash is negative) and cash stacks in front of the vault
  for (let i = 0; i < SLOT.count; i++) {
    const r = Math.floor(i / SLOT.cols);
    const k = i % SLOT.cols;
    const x = SLOT.x0 + k * SLOT.dx;
    const y = SLOT.y0 + r * SLOT.dy;
    const bars = Math.max(0, Math.min(SLOT.perSlot, L.bars - i * SLOT.perSlot));
    out.push({ d: x + y + 1.0, fn: (c) => parts.drawSlot(c, x, y, bars) });
  }
  for (let k = 0; k < L.stacks; k++) {
    const [x, y] = CASH_SPOTS[k];
    out.push({ d: x + y + 0.8, fn: (c) => parts.drawCashStack(c, x, y, L.stackLayers) });
  }
  out.push({ d: 9.0, fn: (c) => parts.drawPost(c, VAULT.x0, VAULT.y1) });
  out.push({ d: 12.6, fn: (c) => parts.drawRightWall(c) });
  out.push({ d: 13.4, fn: (c) => parts.drawPost(c, VAULT.x1, VAULT.y1) });

  // investors' table, chairs and papers
  out.push({ d: 3.2, fn: (c) => parts.drawTable(c) });
  for (let i = 0; i < L.seats; i++) {
    const seat = SEATS[i];
    out.push({ d: seat[0] + seat[1] - 0.2, fn: (c) => parts.drawSeat(c, seat) });
  }

  PLANTS.forEach(([x, y], i) => out.push({ d: x + y + 0.5, fn: (c) => drawPlant(c, x, y, 1 + (i % 2) * 0.25) }));
  if (L.fill > 0.15 && !L.negative) {
    out.push({ d: CRATES[0] + CRATES[1] + 0.5, fn: (c) => parts.drawCrates(c, 1 + Math.floor(L.fill * 3)) });
  }

  // debt safe
  out.push({
    d: SAFE.x + SAFE.w / 2 + SAFE.y + SAFE.d / 2 + 0.5,
    fn: (c, t) => parts.drawSafe(c, L.safe, L.debtOn, L.chains, t),
  });

  // expense bins (their labels are placed after the statics, see drawBinLabels)
  for (const lane of L.lanes) {
    out.push({ d: BIN.x0 + 0.35 + lane.yc, fn: (c) => parts.drawBin(c, lane) });
  }
  return out.sort((a, b) => a.d - b.d);
}

function buildPeople(L: Layout): Person[] {
  const out: Person[] = [];
  for (let i = 0; i < L.seats; i++) {
    out.push({ x: SEATS[i][0], y: SEATS[i][1], role: 'sales', seed: 3 + i * 5, sitting: true, kind: 'seat' });
  }
  if (L.offer) out.push({ x: OFFER_AT[0], y: OFFER_AT[1], role: 'marketing', seed: 9, sitting: false, kind: 'offer' });
  if (L.negative) out.push({ x: COLLECTOR_AT[0], y: COLLECTOR_AT[1], role: 'safety', seed: 14, sitting: false, kind: 'collector' });
  return out;
}

export class TreasuryScene implements Scene {
  private layout: Layout | null = null;
  private statics: StaticItem[] = [];
  private people: Person[] = [];
  private hits: Hit[] = [];
  private sigTimer = 0;
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private cssW = 0;
  private cssH = 0;
  private time = 0;
  private flow = 0;
  private s: GameState | null = null;
  private vals: number[] = [];
  private order: Person[] = [];
  private laneOrder: Lane[] = [];
  /** Label rectangles placed this frame, flat [x0, y0, x1, y1, ...]. */
  private placed: number[] = [];

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
    this.layoutHits();
  }

  /** Fit the room into the canvas (CSS px). Same framing as the HQ office. */
  private fit(): void {
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const X = W + 0.5;
    const Y = D + 0.5;
    const sc = Math.max(0.35, Math.min(availW / (((X + Y) * TILE_W) / 2), availH / (((X + Y) * TILE_H) / 2 + WALL_H), 2.6));
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - (((X - Y) * TILE_W) / 4) * sc;
    this.proj.oy = this.cssH / 2 - (((X + Y) * TILE_H) / 4 - WALL_H / 2) * sc;
  }

  private rebuild(L: Layout): void {
    this.layout = L;
    this.statics = buildStatics(L);
    this.people = buildPeople(L);
    this.layoutHits();
  }

  /** Hit shapes in screen space, most specific first. Built from the current projection. */
  private layoutHits(): void {
    const hits = this.hits;
    hits.length = 0;
    const L = this.layout;
    if (!L) return;
    const p = this.proj;
    const add = (id: string, corners: Corner[]) => {
      hits.push({ id, poly: hull(corners.map(([x, y, z]) => project(p, x, y, z))) });
    };
    // the collector stands close to the term-sheet investor, so it is tested first
    if (L.negative) add('cash', boxCorners(COLLECTOR_AT[0] - 0.5, COLLECTOR_AT[1] - 0.7, COLLECTOR_AT[0] + 0.5, COLLECTOR_AT[1] + 0.7, 0, 50));
    if (L.offer) add('offer', boxCorners(OFFER_AT[0] - 0.7, OFFER_AT[1] - 0.5, OFFER_AT[0] + 0.7, OFFER_AT[1] + 0.5, 0, 52));
    add('debt', [...boxCorners(SAFE.x - 0.1, SAFE.y - 0.1, SAFE.x + SAFE.w + 0.1, SAFE.y + SAFE.d + 0.1, 0, SAFE.h * L.safe + 2), [CHAIN_ANCHOR[0], CHAIN_ANCHOR[1], CHAIN_ANCHOR[2]] as Corner]);
    add('stock', boxCorners(BOARD.x0 - 0.3, -0.1, BOARD.x1 + 0.3, 0.1, BOARD.z0 - 2, BOARD.z1 + 2));
    add('investors', boxCorners(0.2, 0.4, 4.3, 3.3, 0, 16));
    for (const lane of L.lanes) add(`expense:${lane.key}`, boxCorners(BUS.x, lane.y0, BIN.x1, lane.y1, 0, BIN.h + 2));
    add('revenue', [...boxCorners(-0.1, 5.7, 5.9, 6.7, 0, 4), ...boxCorners(5.1, 3.8, 6.1, 6.7, 0, 4)]);
    add('cash', [...boxCorners(VAULT.x0 - 0.2, -0.1, VAULT.x1 + 0.2, VAULT.y1 + 0.05, 0, VAULT.h + 2), ...boxCorners(6.3, 4.4, 7.8, 6.5, 0, 14)]);
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number): void {
    this.time += dt;
    this.flow = (this.flow + dt * FLOW_SPEED) % 1;
    this.s = s;
    // Layout only changes when its signature does; check a few times a second.
    this.sigTimer -= dt;
    if (!this.layout || this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      const next = buildLayout(s);
      if (!this.layout || next.sig !== this.layout.sig) this.rebuild(next);
    }
    const L = this.layout as Layout;
    const t = this.time;
    const sc = this.proj.scale;
    const p = this.proj;

    // background
    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    const c: Ctx = { g, p };
    drawFloor(c, W, D, 1, TREAS.carpetA, TREAS.carpetB);
    parts.drawVaultFloor(c);
    drawWalls(c, W, D, WALL_H, TREAS.trim);
    parts.drawShell(c);
    this.vals = this.chartValues(s);
    parts.drawBoard(c, s, t, this.vals);

    // floor level: belts, lanes, coins
    this.drawFlows(c, L, s);

    // statics and people in painter's order
    const order = this.order;
    order.length = 0;
    for (const pe of this.people) order.push(pe);
    order.sort((a, b) => a.x + a.y - (b.x + b.y));
    const st = this.statics;
    let si = 0;
    for (const pe of order) {
      const key = pe.x + pe.y + 0.1;
      while (si < st.length && st[si].d <= key) {
        st[si].fn(c, t);
        si++;
      }
      drawPerson(c, {
        x: pe.x,
        y: pe.y,
        role: pe.role,
        seed: pe.seed,
        sitting: pe.sitting,
        typing: false,
        walkPhase: 0,
        highlight: false,
        t,
      });
      if (pe.kind === 'offer') this.drawTermSheet(g, pe, t, sc, p);
      if (pe.kind === 'collector') this.drawBriefcase(g, pe, sc, p);
    }
    for (; si < st.length; si++) st[si].fn(c, t);
    if (L.negative) parts.drawGate(c);
    this.drawBinLabels(g, L, p);

    // lights
    g.save();
    g.globalCompositeOperation = 'lighter';
    const [vx, vy] = project(p, (VAULT.x0 + VAULT.x1) / 2, 2.0, 30);
    if (!L.negative) {
      glow(g, vx, vy, 60 * sc, C.amber, 0.1 + 0.03 * Math.sin(t * 1.7));
    } else {
      const on = Math.sin(t * 6) > 0 ? 1 : 0.3;
      for (const x of [VAULT.x0, VAULT.x1]) {
        const [lx, ly] = project(p, x, VAULT.y1, VAULT.h + 1);
        glow(g, lx, ly, 22 * sc, C.red, 0.6 * on);
      }
    }
    g.restore();
    if (L.negative) {
      for (const x of [VAULT.x0, VAULT.x1]) {
        const [lx, ly] = project(p, x, VAULT.y1, VAULT.h + 1);
        g.beginPath();
        g.arc(lx, ly, 2 * sc, 0, TAU);
        g.fillStyle = Math.sin(t * 6) > 0 ? C.red : '#5a2a25';
        g.fill();
      }
    }

    // labels, rare and short
    if (s.finance.cash < 0) {
      const [px, py] = project(p, (VAULT.x0 + VAULT.x1) / 2, 1.8, VAULT.h + 8);
      parts.drawPill(g, px, py, `OVERDRAWN ${formatMoney(-s.finance.cash)}`, C.red);
    } else if (s.finance.cash >= VAULT_FULL) {
      const [px, py] = project(p, (VAULT.x0 + VAULT.x1) / 2, 1.8, VAULT.h + 8);
      parts.drawPill(g, px, py, `×${formatNumber(s.finance.cash / VAULT_FULL, 1)}`, C.amber);
    }
    if (L.moreSeats > 0) {
      const [mx, my] = project(p, TABLE.x + TABLE.w / 2, TABLE.y - 0.4, 22);
      parts.drawPill(g, mx, my, `+${L.moreSeats} more`, C.amber);
    }

    // HUD, bottom right
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(
      `IN ${formatMoney(s.finance.dailyRevenue)}/DAY  ·  OUT ${formatMoney(s.finance.dailyExpenses)}/DAY`,
      this.cssW - 10,
      this.cssH - 8,
    );
    g.restore();
  }

  /**
   * Expense labels on the bins, biggest lanes first. A label that would overlap one already placed is left off, so
   * small categories show only in the hover tip.
   */
  private drawBinLabels(g: CanvasRenderingContext2D, L: Layout, p: Projector): void {
    if (!L.lanes.length) return;
    const fs = Math.max(7, 8 * p.scale);
    g.save();
    g.font = `600 ${fs}px IBM Plex Mono, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = C.fgDim;
    const order = this.laneOrder;
    order.length = 0;
    for (const lane of L.lanes) order.push(lane);
    order.sort((a, b) => b.share - a.share);
    const placed = this.placed;
    placed.length = 0;
    for (const lane of order) {
      const label = (EXP_LABEL[lane.key] ?? lane.key).toUpperCase();
      const [tx, ty] = parts.binLabelAt(p, lane);
      const w = g.measureText(label).width + 4;
      const h = fs + 2;
      const x0 = tx - w / 2;
      const y0 = ty - h / 2;
      const x1 = x0 + w;
      const y1 = y0 + h;
      let clash = false;
      for (let i = 0; i < placed.length; i += 4) {
        if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed.push(x0, y0, x1, y1);
      g.fillText(label, tx, ty);
    }
    g.restore();
  }

  /** The chart's samples: share prices since the IPO, oldest first, last HISTORY_SHOWN only. */
  private chartValues(s: GameState): number[] {
    const out = this.vals;
    out.length = 0;
    if (!s.company.isPublic) return out;
    const h = s.finance.history;
    let start = h.length;
    let taken = 0;
    while (start > 0 && taken < HISTORY_SHOWN) {
      start--;
      if (h[start].stockPrice > 0) taken++;
    }
    for (let i = start; i < h.length; i++) if (h[i].stockPrice > 0) out.push(h[i].stockPrice);
    if (out.length === 0) out.push(s.company.stockPrice);
    return out;
  }

  /** Belts, lanes and the coins riding them. Revenue in from the left, expenses out to the lanes on the right. */
  private drawFlows(c: Ctx, L: Layout, s: GameState): void {
    const { g, p } = c;
    const phase = this.flow;
    parts.beltStroke(c, REV_PATH.pts, phase);
    parts.beltStroke(c, EXP_MAIN, phase);
    parts.drawBus(c, phase);
    for (const lane of L.lanes) parts.laneFloor(c, lane, phase);

    const revN = logCount(s.finance.dailyRevenue, 100, 4, COIN_MAX);
    for (let j = 0; j < revN; j++) {
      let u = j / revN + phase;
      u -= Math.floor(u);
      if (u > 0.97) continue;
      const [x, y] = pathAt(REV_PATH, u);
      const [sx, sy] = project(p, x, y, 1.2);
      parts.coin(g, sx, sy, p.scale, C.green);
    }

    const expN = logCount(s.finance.dailyExpenses, 100, 4, COIN_MAX);
    for (const lane of L.lanes) {
      const n = Math.max(1, Math.round(expN * lane.share));
      for (let j = 0; j < n; j++) {
        let u = j / n + phase;
        u -= Math.floor(u);
        if (u > 0.96) continue;
        const [x, y] = pathAt(lane.path, u);
        const [sx, sy] = project(p, x, y, 1.2);
        parts.coin(g, sx, sy, p.scale, C.amber);
      }
    }
  }

  /** The investor at the door waves a term sheet above the head. */
  private drawTermSheet(g: CanvasRenderingContext2D, pe: Person, t: number, sc: number, p: Projector): void {
    const [bx, by] = project(p, pe.x, pe.y, 0);
    const cx = bx + 7 * sc;
    const cy = by - 36 * sc + Math.sin(t * 5) * 1.6 * sc;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.sin(t * 4) * 0.25);
    g.fillStyle = TREAS.paper;
    g.fillRect(-3.5 * sc, -4.5 * sc, 7 * sc, 9 * sc);
    g.fillStyle = C.amberDim;
    g.fillRect(-2.5 * sc, -2 * sc, 5 * sc, 1 * sc);
    g.fillRect(-2.5 * sc, 0.5 * sc, 4 * sc, 1 * sc);
    g.restore();
  }

  /** The collector's briefcase, by the hand. */
  private drawBriefcase(g: CanvasRenderingContext2D, pe: Person, sc: number, p: Projector): void {
    const [bx, by] = project(p, pe.x, pe.y, 0);
    g.fillStyle = '#4a2f22';
    g.fillRect(bx - 11 * sc, by - 10 * sc, 6 * sc, 4.5 * sc);
    g.strokeStyle = '#2a1a12';
    g.lineWidth = 1 * sc;
    g.strokeRect(bx - 11 * sc, by - 10 * sc, 6 * sc, 4.5 * sc);
  }

  hitTest(x: number, y: number): SceneHit | null {
    if (!this.s) return null;
    for (const h of this.hits) {
      if (inside(h.poly, x, y)) return { id: h.id, label: tipFor(h.id, this.s) };
    }
    return null;
  }
}
