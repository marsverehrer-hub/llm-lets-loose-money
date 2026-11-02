// Compute scene drawing: halls on raised floors (rows of racks with status LEDs, cold and hot aisles, CRAH units or
// liquid-cooling CDUs, cable trays and InfiniBand fabric), halls under construction, the training cluster, the cloud
// platform, the burst cloud and the product edge. Kit primitives and token colours only; one light from the upper left.
import {
  alpha,
  box,
  faceX,
  faceY,
  flat,
  frac,
  iso,
  line3,
  person,
  prand,
  shadow,
  slab,
  tri,
  type Ctx,
  type Tri,
} from '../kit';
import {
  AISLE,
  BURST_Z,
  CLOUD_Z,
  LED_ROWS,
  PRODUCT_H,
  RACK_D,
  RACK_W,
  type CloudLayout,
  type HallLayout,
  type PodLayout,
  type ProductsLayout,
  type RackSlot,
} from './layout';

/** Per-frame values shared by every drawable. */
export interface Frame {
  t: number;
  /** Share of the fleet training and serving (LED colours). */
  fT: number;
  fS: number;
  /** Neocloud utilisation (LEDs of leased halls). */
  util: number;
  /** Which pass: the static layer (cached as a bitmap) or the live parts drawn over it every frame. */
  live: boolean;
}

export interface Walker {
  x: number;
  y: number;
  walk: number;
  moving: boolean;
}

/** Coolant and fibre: no token says "water", so the scene keeps its own two. */
const COOLANT = '#36b3c4';

interface LedBatch {
  on: Path2D;
  dim: Path2D;
}

function batches(n: number): LedBatch[] {
  const out: LedBatch[] = [];
  for (let i = 0; i < n; i++) out.push({ on: new Path2D(), dim: new Path2D() });
  return out;
}

/** Status LEDs of one rack, sorted into colour batches: 0 training, 1 serving, 2 leased. */
function rackLeds(c: Ctx, r: RackSlot, z0: number, h: number, f: Frame, b: LedBatch[], leased: boolean, all?: number): void {
  const p = c.p;
  const lw = Math.max(1.3, 1.9 * p.s);
  const lh = Math.max(1, 1.2 * p.s);
  const unit = (h - 3) / LED_ROWS;
  for (let i = 0; i < LED_ROWS; i++) {
    const v = prand(r.seed * 13.1 + i * 7.7);
    let k: number;
    if (all !== undefined) k = all;
    else if (leased) k = v < f.util ? 2 : 3;
    else k = v < f.fT ? 0 : v < f.fT + f.fS ? 1 : 3;
    if (k >= b.length) continue;
    const [sx, sy] = iso(p, r.x + 0.1, r.y + RACK_D, z0 + 1.5 + unit * (i + 0.55));
    // Idle units keep a steady standby light; busy ones flicker.
    const blink = k !== 3 && frac(f.t * (0.6 + v * 2.2) + v * 9.7) < 0.14;
    (blink ? b[k].dim : b[k].on).rect(sx, sy - lh / 2, lw, lh);
    // A second, faster activity LED on busy units.
    if (v > 0.5 && k !== 3) {
      const [ax, ay] = iso(p, r.x + 0.2, r.y + RACK_D, z0 + 1.5 + unit * (i + 0.55));
      if (frac(f.t * 5.3 + v * 31) > 0.5) b[k].on.rect(ax, ay - lh / 2, lw * 0.7, lh);
    }
  }
}

function flushLeds(c: Ctx, b: LedBatch[], colors: string[]): void {
  const g = c.g;
  for (let k = 0; k < b.length; k++) {
    g.fillStyle = colors[k];
    g.fill(b[k].on);
    g.globalAlpha = 0.35;
    g.fill(b[k].dim);
    g.globalAlpha = 1;
  }
}

/** A row of racks, left to right. Filled racks are graphite with unit seams; empty slots are ghost frames. */
function drawRow(c: Ctx, racks: RackSlot[], h: number, f: Frame, leds: LedBatch[], leased: boolean, z0 = 0, all?: number): void {
  const { g, pal } = c;
  if (!racks.length) return;
  if (f.live) {
    for (const r of racks) if (r.filled) rackLeds(c, r, z0, h, f, leds, leased, all);
    return;
  }
  const seams = new Path2D();
  const ghosts = new Path2D();
  for (const r of racks) {
    if (r.filled) {
      box(c, r.x + 0.02, r.y, RACK_W - 0.04, RACK_D, z0, z0 + h, pal.metal);
      // Front door: a slightly lighter panel with unit seams.
      const unit = (h - 3) / LED_ROWS;
      for (let i = 1; i < LED_ROWS; i++) {
        const a = iso(c.p, r.x + 0.06, r.y + RACK_D, z0 + 1.5 + unit * i);
        const b = iso(c.p, r.x + RACK_W - 0.06, r.y + RACK_D, z0 + 1.5 + unit * i);
        seams.moveTo(a[0], a[1]);
        seams.lineTo(b[0], b[1]);
      }
    } else {
      const P = (x: number, y: number, z: number) => iso(c.p, x, y, z);
      const a = P(r.x + 0.04, r.y + RACK_D, z0);
      const b = P(r.x + 0.04, r.y + RACK_D, z0 + h);
      const cc = P(r.x + RACK_W - 0.04, r.y + RACK_D, z0 + h);
      const d = P(r.x + RACK_W - 0.04, r.y, z0 + h);
      const e = P(r.x + 0.04, r.y, z0 + h);
      ghosts.moveTo(a[0], a[1]);
      ghosts.lineTo(b[0], b[1]);
      ghosts.lineTo(cc[0], cc[1]);
      ghosts.lineTo(d[0], d[1]);
      ghosts.lineTo(e[0], e[1]);
      ghosts.lineTo(b[0], b[1]);
    }
  }
  g.lineWidth = 1;
  g.strokeStyle = alpha(pal.silver, 0.16);
  g.stroke(seams);
  g.strokeStyle = alpha(pal.fg3, pal.light ? 0.5 : 0.35);
  g.stroke(ghosts);
  // Brushed-silver rim along the row's top front edge.
  const first = racks[0];
  const last = racks[racks.length - 1];
  const anyFilled = racks.some((r) => r.filled);
  if (anyFilled) line3(c, first.x + 0.02, first.y + RACK_D, z0 + h, last.x + RACK_W - 0.02, last.y + RACK_D, z0 + h, alpha(pal.silver, 0.55), 1, 0.6);
}

/** Overhead ladder tray above a row; InfiniBand halls get orange fibre bundles dropping into each rack and spine links. */
function drawTray(c: Ctx, x0: number, x1: number, y: number, z: number, ib: boolean, last: boolean, nextY: number | null): void {
  const { pal } = c;
  const rail = alpha(pal.silver, 0.5);
  line3(c, x0, y + 0.18, z, x1, y + 0.18, z, rail, 0.8, 0.5);
  line3(c, x0, y + 0.52, z, x1, y + 0.52, z, rail, 0.8, 0.5);
  if (!ib) return;
  const fib = alpha(pal.warn, 0.8);
  line3(c, x0, y + 0.3, z + 0.6, x1, y + 0.3, z + 0.6, fib, 1.1, 0.6);
  line3(c, x0, y + 0.4, z + 0.6, x1, y + 0.4, z + 0.6, fib, 1.1, 0.6);
  for (let x = x0 + 0.25; x < x1; x += RACK_W * 2) line3(c, x, y + 0.35, z, x, y + 0.35, z - 3, fib, 0.8, 0.5);
  if (!last && nextY !== null) {
    // Spine links between this row's tray and the next one.
    for (const x of [x0 + 0.2, (x0 + x1) / 2, x1 - 0.2]) line3(c, x, y + 0.35, z + 0.6, x, nextY + 0.35, z + 0.6, fib, 0.9, 0.5);
  }
}

/** CRAH unit against the back wall: a silver cabinet with a spinning fan on top. */
function drawCrah(c: Ctx, x: number, y: number, h: number, t: number, seed: number, live: boolean): void {
  const { g, p, pal } = c;
  const [cx, cy] = iso(p, x + 0.45, y + 0.275, h);
  const rx = 0.32 * 20 * p.s;
  if (!live) {
    box(c, x, y, 0.9, 0.55, 0, h, pal.steel, alpha(pal.fg, pal.light ? 0.25 : 0.2));
    // Grille on the front.
    for (let k = 1; k < 5; k++) faceY(c, x + 0.1, x + 0.8, y + 0.55, (h * k) / 5 - 0.5, (h * k) / 5, alpha('#000000', 0.25));
    g.fillStyle = alpha('#000000', 0.45);
    g.beginPath();
    g.ellipse(cx, cy, rx, rx * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    return;
  }
  if (rx < 2.5) return;
  g.strokeStyle = alpha(pal.silver, 0.85);
  g.lineWidth = Math.max(1, 1.2 * p.s);
  g.beginPath();
  const a0 = t * 7 + seed;
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * Math.PI * 2) / 3;
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * rx * 0.9, cy + Math.sin(a) * rx * 0.45);
  }
  g.stroke();
}

/** Liquid cooling: a CDU cabinet with a teal stripe, and the supply pipe along the back wall. */
function drawCdu(c: Ctx, x: number, y: number, h: number, t: number, seed: number, live: boolean): void {
  const { g, p, pal } = c;
  if (!live) {
    box(c, x, y, 0.8, 0.55, 0, h, pal.steel, alpha(pal.fg, 0.2));
    faceY(c, x + 0.08, x + 0.72, y + 0.55, h * 0.62, h * 0.7, COOLANT);
    return;
  }
  const [sx, sy] = iso(p, x + 0.62, y + 0.55, h * 0.4);
  g.fillStyle = frac(t * 0.8 + seed) < 0.5 ? pal.up : alpha(pal.up, 0.3);
  g.fillRect(sx, sy, Math.max(1.5, 2 * p.s), Math.max(1.5, 2 * p.s));
}

/** Coolant pipe on the floor (static pass), and dots flowing along it (live pass, only where nothing stands in front). */
function coolantFlow(c: Ctx, x0: number, y0: number, x1: number, y1: number, z: number, t: number, live: boolean): void {
  const { g, p } = c;
  if (!live) {
    line3(c, x0, y0, z, x1, y1, z, alpha(COOLANT, 0.85), 2.2, 1.2);
    return;
  }
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 0.8));
  g.fillStyle = alpha('#ffffff', 0.75);
  for (let k = 0; k < n; k++) {
    const u = frac(t * 0.25 + k / n);
    const [sx, sy] = iso(p, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z);
    const r = Math.max(0.8, 0.9 * p.s);
    g.fillRect(sx - r, sy - r * 0.6, r * 2, r * 1.2);
  }
}

/** Back and left walls of the cutaway hall: graphite, a silver cap and the livery stripe (yellow, purple when leased). */
function drawWalls(c: Ctx, h: HallLayout, H: number): void {
  const { pal } = c;
  const { x0, y0, w, d } = h;
  const T = 0.14;
  const cap = alpha(pal.silver, 0.6);
  const stripe = h.leased ? pal.sota : pal.hl;
  if (h.look.style === 'cage') {
    // Colo cage: a mesh, so the racks behind read through it.
    const mesh = alpha(pal.fg3, pal.light ? 0.55 : 0.38);
    const frame = alpha(pal.silver, 0.6);
    for (let u = x0; u <= x0 + w + 1e-6; u += 0.5) line3(c, u, y0, 0, u, y0, H, mesh, 0.6, 0.5);
    for (let v = y0; v <= y0 + d + 1e-6; v += 0.5) line3(c, x0, v, 0, x0, v, H, mesh, 0.6, 0.5);
    for (let z = 0; z <= H; z += H / 6) {
      line3(c, x0, y0, z, x0 + w, y0, z, mesh, 0.6, 0.5);
      line3(c, x0, y0, z, x0, y0 + d, z, mesh, 0.6, 0.5);
    }
    line3(c, x0, y0 + d, 0, x0, y0 + d, H, frame, 1.2);
    line3(c, x0 + w, y0, 0, x0 + w, y0, H, frame, 1.2);
    line3(c, x0, y0, H, x0 + w, y0, H, frame, 1.2);
    line3(c, x0, y0, H, x0, y0 + d, H, frame, 1.2);
    line3(c, x0 + 0.02, y0 + 0.02, 1.6, x0 + w, y0 + 0.02, 1.6, stripe, 2, 1);
    line3(c, x0 + 0.02, y0 + 0.02, 1.6, x0 + 0.02, y0 + d, 1.6, stripe, 2, 1);
    return;
  }
  box(c, x0, y0, w, T, 0, H, pal.wall);
  box(c, x0, y0, T, d, 0, H, pal.wall);
  // Panel seams on the inner faces.
  const seam = alpha(pal.light ? '#000000' : '#000000', pal.light ? 0.08 : 0.25);
  for (let u = x0 + 1.2; u < x0 + w - 0.2; u += 1.2) line3(c, u, y0 + T, 0, u, y0 + T, H, seam, 1, 0.5);
  for (let v = y0 + 1.2; v < y0 + d - 0.2; v += 1.2) line3(c, x0 + T, v, 0, x0 + T, v, H, seam, 1, 0.5);
  // Livery stripe low on the walls, silver cap on top.
  faceY(c, x0 + T, x0 + w, y0 + T, 2.4, 3.6, stripe);
  faceX(c, x0 + T, y0 + T, y0 + d, 2.4, 3.6, stripe);
  line3(c, x0, y0 + d, H, x0, y0, H, cap, 1, 0.6);
  line3(c, x0, y0, H, x0 + w, y0, H, cap, 1, 0.6);
  if (h.look.style === 'campus' || h.look.style === 'cathedral') {
    // Clerestory windows high on the back wall.
    const glass = alpha(pal.blue, pal.light ? 0.35 : 0.22);
    for (let u = x0 + 0.6; u < x0 + w - 0.9; u += 1.2) faceY(c, u, u + 0.8, y0 + T + 0.001, H - 8, H - 3, glass);
  }
  if (h.look.style === 'cathedral') {
    // Buttresses and a crown in the team colour: visible from orbit.
    for (let u = x0 + 1.6; u < x0 + w - 0.4; u += 2.4) box(c, u, y0 + T, 0.3, 0.25, 0, H, pal.wall);
    for (let v = y0 + 1.6; v < y0 + d - 0.4; v += 2.4) box(c, x0 + T, v, 0.25, 0.3, 0, H, pal.wall);
    faceY(c, x0 + T, x0 + w, y0 + T + 0.002, H - 1.6, H - 0.6, alpha(pal.hl, 0.8));
  }
  if (h.look.style === 'closet') {
    // The door and the mop's fan.
    faceY(c, x0 + w - 1.0, x0 + w - 0.45, y0 + T + 0.001, 0, H * 0.72, alpha('#000000', 0.4));
  }
}

/** A finished hall: floor, aisles, walls, cooling, rows of racks, trays (static pass); LEDs, fans, coolant and the
 * engineers walking the front aisle (live pass). */
export function drawHall(c: Ctx, h: HallLayout, f: Frame, walkers: Walker[]): void {
  const { pal } = c;
  const { x0, y0, w, d, look } = h;
  const rackH = look.rackH;
  const rowW = h.perRow * RACK_W;
  const live = f.live;
  if (!live) {
    slab(c, x0, y0, w, d, 2.2, 0.5);
    // Aisles: perforated cold tiles in front of each row; hot strips behind (air) or coolant manifolds (liquid).
    for (let r = 0; r < h.rows; r++) {
      const yF = h.rowY[r] + RACK_D;
      const coldD = r < h.rows - 1 ? AISLE : Math.min(AISLE, y0 + d - yF - 0.05);
      flat(c, h.rowX - 0.05, yF, rowW + 0.1, coldD, 0.02, alpha(pal.blue, pal.light ? 0.16 : 0.1));
      if (!h.liquid) flat(c, h.rowX - 0.05, h.rowY[r] - 0.38, rowW + 0.1, 0.38, 0.02, alpha(pal.warn, pal.light ? 0.16 : 0.12));
    }
    drawWalls(c, h, look.wallH);
  }
  // Cooling along the back wall.
  const n = Math.max(1, Math.floor((w - 0.9) / 1.5));
  for (let k = 0; k < n; k++) {
    const x = x0 + 0.55 + k * ((w - 1.0) / n) + ((w - 1.0) / n - 0.9) / 2;
    if (h.liquid) {
      if (k % 2 === 0) drawCdu(c, x, y0 + 0.24, rackH * 0.7, f.t, k, live);
    } else {
      drawCrah(c, x, y0 + 0.24, rackH * 0.8, f.t, k * 1.7, live);
    }
  }
  if (h.liquid && !live) {
    coolantFlow(c, x0 + 0.5, y0 + 0.92, x0 + w - 0.2, y0 + 0.92, 0.6, f.t, false);
    for (let r = 0; r < h.rows; r++) coolantFlow(c, h.rowX, h.rowY[r] - 0.2, h.rowX + rowW, h.rowY[r] - 0.2, 0.4, f.t, false);
  }
  // The supply main runs along the front edge, where nothing stands in front of it, so its flow can be live.
  if (h.liquid) coolantFlow(c, x0 + 0.3, y0 + d - 0.14, x0 + w - 0.2, y0 + d - 0.14, 0.6, f.t, live);

  const leds = batches(4);
  const byRow: RackSlot[][] = [];
  for (const r of h.racks) (byRow[r.row] ??= []).push(r);
  for (let r = 0; r < h.rows; r++) drawRow(c, byRow[r] ?? [], rackH, f, leds, h.leased);
  if (live) {
    flushLeds(c, leds, [pal.hl, pal.up, pal.sota, alpha(pal.silver, 0.38)]);
  } else {
    for (let r = 0; r < h.rows; r++) {
      drawTray(c, h.rowX, h.rowX + rowW, h.rowY[r], rackH + 3.5, h.infiniband, r === h.rows - 1, r < h.rows - 1 ? h.rowY[r + 1] : null);
    }
  }
  if (h.infiniband) {
    // Spine switches at the end of each row: fast green link lights.
    for (let r = 0; r < h.rows; r++) {
      const sx = h.rowX + rowW + 0.08;
      if (!live) {
        box(c, sx, h.rowY[r], 0.32, RACK_D, 0, rackH * 0.55, pal.metal);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        const [lx, ly] = iso(c.p, sx + 0.08 + i * 0.07, h.rowY[r] + RACK_D, rackH * 0.4);
        c.g.fillStyle = frac(f.t * 6 + i * 0.37 + r * 0.21) < 0.6 ? pal.up : alpha(pal.up, 0.25);
        c.g.fillRect(lx, ly, Math.max(1, 1.4 * c.p.s), Math.max(1, 1.4 * c.p.s));
      }
    }
  }
  if (live) for (const wk of walkers) person(c, wk.x, wk.y, pal.fg3, wk.walk, wk.moving, pal.hl);
}

/** A hall under construction: bare slab with a hazard edge, walls rising with progress, scaffolding and a tower crane. */
export function drawBuilding(c: Ctx, h: HallLayout, t: number, live: boolean): void {
  const { g, pal } = c;
  const { x0, y0, w, d, look } = h;
  const H = look.wallH;
  const cx = x0 + w - 0.6;
  const cy = y0 + d - 0.6;
  const top = H + 18;
  if (live) {
    // Tower crane jib swings slowly.
    const a = Math.sin(t * 0.25) * 0.9 + 2.4;
    const jx = cx + Math.cos(a) * 3.4;
    const jy = cy + Math.sin(a) * 3.4;
    line3(c, cx - Math.cos(a) * 1.0, cy - Math.sin(a) * 1.0, top, jx, jy, top, pal.hl, 1.6, 1);
    const hookZ = top - 6 - 4 * (0.5 + 0.5 * Math.sin(t * 0.6));
    line3(c, jx * 0.6 + cx * 0.4, jy * 0.6 + cy * 0.4, top, jx * 0.6 + cx * 0.4, jy * 0.6 + cy * 0.4, hookZ, alpha(pal.fg2, 0.8), 0.8, 0.5);
    return;
  }
  const concrete = pal.light ? tri('#c8c6c0') : tri('#3a3936');
  slab(c, x0, y0, w, d, 2.2, 0, concrete);
  // Hazard tape along the front edges.
  const haz = alpha(pal.warn, 0.9);
  for (let u = x0; u < x0 + w; u += 0.5) faceY(c, u, Math.min(x0 + w, u + 0.25), y0 + d, -2.2, -1.2, haz);
  for (let v = y0; v < y0 + d; v += 0.5) faceX(c, x0 + w, v, Math.min(y0 + d, v + 0.25), -2.2, -1.2, haz);
  const wallZ = Math.max(1, H * h.progress);
  const raw: Tri = pal.light ? tri('#b6b4ae') : tri('#4a4945');
  box(c, x0, y0, w, 0.14, 0, wallZ, raw);
  box(c, x0, y0, 0.14, d, 0, wallZ, raw);
  // Scaffolding: poles and planks in front of the rising walls.
  const pole = alpha(pal.warn, 0.95);
  const plank = alpha(pal.warn, 0.7);
  for (let u = x0 + 0.3; u <= x0 + w - 0.2; u += 1.3) line3(c, u, y0 + 0.45, 0, u, y0 + 0.45, H, pole, 1.1, 0.6);
  for (let v = y0 + 0.3; v <= y0 + d - 0.2; v += 1.3) line3(c, x0 + 0.45, v, 0, x0 + 0.45, v, H, pole, 1.1, 0.6);
  for (let z = H / 4; z <= H + 0.1; z += H / 4) {
    line3(c, x0 + 0.3, y0 + 0.45, z, x0 + w - 0.2, y0 + 0.45, z, plank, 1.6, 0.8);
    line3(c, x0 + 0.45, y0 + 0.3, z, x0 + 0.45, y0 + d - 0.2, z, plank, 1.6, 0.8);
  }
  // Pallets of racks waiting on the floor.
  for (let k = 0; k < 3; k++) box(c, x0 + 1.4 + k * 0.8, y0 + d - 1.3, 0.6, 0.6, 0, 4, tri(pal.card));
  // Tower crane mast in the front-right corner (the jib is live).
  box(c, cx - 0.12, cy - 0.12, 0.24, 0.24, 0, top, tri(pal.hl, 0.82, 0.66));
  g.globalAlpha = 1;
}

/** The training cluster: a slab with a yellow edge and racks whose LEDs all run in the team colour. */
export function drawPod(c: Ctx, pod: PodLayout, f: Frame): void {
  const { pal } = c;
  if (!f.live) {
    slab(c, pod.x0, pod.y0, pod.w, pod.d, 2.2, 0.5);
    faceY(c, pod.x0, pod.x0 + pod.w, pod.y0 + pod.d, -2.2, -1.2, pal.hl);
    faceX(c, pod.x0 + pod.w, pod.y0, pod.y0 + pod.d, -2.2, -1.2, pal.hl);
  }
  const leds = batches(1);
  const rows: RackSlot[][] = [];
  for (const r of pod.racks) (rows[r.row] ??= []).push(r);
  for (const row of rows) if (row) drawRow(c, row, 20, f, leds, false, 0, 0);
  if (f.live) flushLeds(c, leds, [pal.hl]);
  if (f.live && pod.racks.length === 0) {
    // A run waiting for GPUs: an empty yellow pad.
    flat(c, pod.x0 + 0.5, pod.y0 + 0.5, pod.w - 1, pod.d - 1, 0.03, alpha(pal.hl, 0.12 + 0.06 * Math.sin(f.t * 2)));
  }
}

/** Cloud rental: a platform floating over its shadow, puffs under its rim, racks on top lit with the fleet mix. */
export function drawCloud(c: Ctx, cl: CloudLayout, f: Frame): void {
  const { g, p, pal } = c;
  const z = CLOUD_Z;
  if (f.live) {
    const leds = batches(4);
    const rows: RackSlot[][] = [];
    for (const r of cl.racks) (rows[r.row] ??= []).push(r);
    for (const row of rows) if (row) drawRow(c, row, 12, f, leds, false, z);
    flushLeds(c, leds, [pal.hl, pal.up, pal.sota, alpha(pal.silver, 0.38)]);
    return;
  }
  shadow(c, cl.x0 + 0.5, cl.y0 + 0.5, cl.w - 1, cl.d - 1, pal.light ? 0.12 : 0.3);
  // Puffs under the platform.
  g.fillStyle = alpha(pal.light ? '#ffffff' : pal.blue, pal.light ? 0.85 : 0.22);
  for (let k = 0; k < 7; k++) {
    const u = k / 6;
    const [px, py] = iso(p, cl.x0 + cl.w * u, cl.y0 + cl.d - 0.1, z - 4);
    const [qx, qy] = iso(p, cl.x0 + cl.w - 0.1, cl.y0 + cl.d * u, z - 4);
    const r = (8 + 4 * Math.sin(k * 1.7)) * p.s;
    g.beginPath();
    g.ellipse(px, py, r, r * 0.6, 0, 0, Math.PI * 2);
    g.ellipse(qx, qy, r, r * 0.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  box(c, cl.x0, cl.y0, cl.w, cl.d, z - 2.5, z, pal.light ? tri('#eef0f3') : tri(pal.bg3, 0.8, 0.62), alpha(pal.blue, 0.9));
  // Dashed outline: rented, not owned.
  const P = (x: number, y: number) => iso(p, x, y, z + 0.02);
  const a = P(cl.x0 + 0.15, cl.y0 + 0.15);
  const b = P(cl.x0 + cl.w - 0.15, cl.y0 + 0.15);
  const cc = P(cl.x0 + cl.w - 0.15, cl.y0 + cl.d - 0.15);
  const d = P(cl.x0 + 0.15, cl.y0 + cl.d - 0.15);
  g.save();
  g.setLineDash([4, 3]);
  g.strokeStyle = alpha(pal.blue, 0.85);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.lineTo(cc[0], cc[1]);
  g.lineTo(d[0], d[1]);
  g.closePath();
  g.stroke();
  g.restore();
  const leds = batches(4);
  const rows: RackSlot[][] = [];
  for (const r of cl.racks) (rows[r.row] ??= []).push(r);
  for (const row of rows) if (row) drawRow(c, row, 12, f, leds, false, z);
}

/** Burst capacity: dashed puffs above the platform with dashes drifting through. Screen space. */
export function drawBurst(c: Ctx, cl: CloudLayout, t: number): void {
  const { g, p, pal } = c;
  const [cx, cy] = iso(p, cl.x0 + cl.w / 2, cl.y0 + cl.d / 2, BURST_Z);
  const s = p.s;
  const puffs: [number, number, number][] = [
    [-15, 3, 11],
    [-3, -5, 15],
    [12, -1, 12],
    [3, 6, 10],
  ];
  g.save();
  g.fillStyle = alpha(pal.bg2, 0.6);
  for (const [ox, oy, r] of puffs) {
    g.beginPath();
    g.arc(cx + ox * s, cy + oy * s, r * s, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = alpha(pal.fg3, 0.9);
  g.lineWidth = Math.max(1, 1.1 * s);
  g.setLineDash([Math.max(2, 4 * s), Math.max(2, 3 * s)]);
  g.lineDashOffset = -t * 14;
  for (const [ox, oy, r] of puffs) {
    g.beginPath();
    g.arc(cx + ox * s, cy + oy * s, r * s, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/** Product edge: a serving cabinet on its own slab, one lit panel per live product (up to 12). */
export function drawProducts(c: Ctx, pr: ProductsLayout, t: number, live: boolean): void {
  const { pal } = c;
  const bx = pr.x0 + 0.6;
  const by = pr.y0 + 0.6;
  const bw = pr.w - 1.2;
  const bd = pr.d - 1.4;
  if (!live) {
    slab(c, pr.x0, pr.y0, pr.w, pr.d, 2.2, 0.6);
    box(c, bx, by, bw, bd, 0, PRODUCT_H, pal.metal, alpha(pal.silver, 0.6));
    // Antenna mast.
    line3(c, bx + bw - 0.2, by + 0.2, PRODUCT_H, bx + bw - 0.2, by + 0.2, PRODUCT_H + 8, alpha(pal.silver, 0.8), 1, 0.7);
    return;
  }
  const n = Math.min(12, Math.max(1, pr.live));
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / 3);
    const col = k % 3;
    const z = 3 + row * 4.5;
    const u = bx + 0.15 + col * ((bw - 0.3) / 3);
    const on = pr.live > 0 ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3 + k * 1.3)) : 0.2;
    faceY(c, u, u + (bw - 0.3) / 3 - 0.1, by + bd, z, z + 3, alpha(pr.live > 0 ? pal.up : pal.fg4, on));
  }
}

/** A dashed data flow from a to b (screen points), arching up, with dots running along it. */
export function drawFlow(c: Ctx, ax: number, ay: number, bx: number, by: number, color: string, t: number, phase: number): void {
  const { g, p } = c;
  const s = p.s;
  const cx = (ax + bx) / 2;
  const cy = Math.min(ay, by) - 50 * s;
  g.save();
  g.strokeStyle = alpha(color, 0.35);
  g.lineWidth = 1;
  g.setLineDash([3, 5]);
  g.lineDashOffset = -t * 18;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo(cx, cy, bx, by);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const u = (t * 0.22 + phase + k / 3) % 1;
    const iu = 1 - u;
    const x = iu * iu * ax + 2 * iu * u * cx + u * u * bx;
    const y = iu * iu * ay + 2 * iu * u * cy + u * u * by;
    g.beginPath();
    g.arc(x, y, Math.max(1.2, 1.8 * s), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
