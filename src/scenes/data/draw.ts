// Drawing for the data warehouse: shelving islands with crates per domain (conveyors for startup streams, workers
// carrying job deliveries), the crawler mast, the refinery and the loading bay with the training gate and its forklift.
// Kit primitives and token colours; one light from the upper left.
import { alpha, box, faceY, flat, frac, iso, line3, person, slab, tri, type Ctx, type Tri } from '../kit';
import {
  BAY_W,
  BAYS,
  BOARD_Z,
  CRATE_D,
  CRATE_H,
  CRATE_W,
  ISLE,
  RACK_D,
  RACK_LEN,
  RACK_TOP,
  type AisleView,
  type CrawlerView,
  type Isle,
  type Layout,
} from './layout';

const triCache = new Map<string, Tri>();
function triOf(color: string): Tri {
  let t = triCache.get(color);
  if (!t) {
    t = tri(color, 0.8, 0.6);
    if (triCache.size > 256) triCache.clear();
    triCache.set(color, t);
  }
  return t;
}

/** One crate: a cardboard block with a tape strip, plus the optional warning tag and legal sticker. */
function drawCrate(c: Ctx, x: number, y: number, z0: number, w: number, d: number, h: number, color: string, warn: boolean, legal: boolean): void {
  const { pal } = c;
  const f = triOf(color);
  box(c, x, y, w, d, z0, z0 + h, f);
  flat(c, x + w / 2 - 0.04, y, 0.08, d, z0 + h + 0.01, alpha('#ffffff', 0.18));
  faceY(c, x + w / 2 - 0.04, x + w / 2 + 0.04, y + d, z0, z0 + h, alpha('#ffffff', 0.14));
  if (warn) faceY(c, x + 0.05, x + 0.16, y + d + 0.002, z0 + 1, z0 + h - 2, pal.hl);
  if (legal) faceY(c, x + 0.2, x + w - 0.05, y + d + 0.002, z0 + h * 0.45, z0 + h * 0.85, pal.down);
}

/** A shelving island: yellow beams, silver uprights, crates by quality, a conveyor per stream and job workers.
 * The static pass draws the island (cached as a bitmap); the live pass draws what moves over it. */
export function drawAisle(c: Ctx, a: AisleView, t: number, live: boolean): void {
  const { pal } = c;
  if (live) {
    aisleLive(c, a, t);
    return;
  }
  slab(c, a.x, a.y, ISLE, ISLE, 2, 0.65);
  // Safety line in front of the shelf.
  flat(c, a.sx - 0.1, a.sy + RACK_D + 0.18, RACK_LEN + 0.2, 0.07, 0.02, alpha(pal.hl, 0.75));
  const { sx, sy } = a;
  const up = pal.steel;
  // Pallet racking: back uprights and beams, the crates level by level (sorted back to front), then the front
  // uprights and the yellow front beams. No decks, so every crate stays in view.
  for (let b = 0; b <= BAYS; b++) box(c, sx + b * BAY_W - 0.04, sy, 0.07, 0.07, 0, RACK_TOP, up);
  for (const bz of BOARD_Z) box(c, sx, sy, RACK_LEN, 0.07, bz - 1.2, bz, pal.metal);
  box(c, sx, sy, RACK_LEN, 0.07, RACK_TOP - 1.2, RACK_TOP, pal.metal);
  const crates = a.crates;
  for (const bz of BOARD_Z) {
    // Side rails the crates rest on.
    for (let b = 0; b <= BAYS; b++) box(c, sx + b * BAY_W - 0.03, sy + 0.07, 0.06, RACK_D - 0.14, bz - 0.8, bz, pal.metal);
    for (const cr of crates) if (cr.z0 === bz) drawCrate(c, cr.x, cr.y, cr.z0, CRATE_W, CRATE_D, CRATE_H, cr.color, cr.warn, cr.legal);
  }
  for (let b = 0; b <= BAYS; b++) box(c, sx + b * BAY_W - 0.04, sy + RACK_D - 0.07, 0.07, 0.07, 0, RACK_TOP, up);
  for (const bz of BOARD_Z) box(c, sx, sy + RACK_D - 0.06, RACK_LEN, 0.06, bz - 0.8, bz, tri(pal.hl, 0.85, 0.66));
  box(c, sx, sy + RACK_D - 0.08, RACK_LEN, 0.08, RACK_TOP - 1.4, RACK_TOP, tri(pal.hl, 0.85, 0.66));
  // Cross braces on the end frame.
  line3(c, sx + RACK_LEN, sy, 2, sx + RACK_LEN, sy + RACK_D, RACK_TOP / 2, alpha(pal.silver, 0.5), 0.8, 0.5);
  line3(c, sx + RACK_LEN, sy + RACK_D, RACK_TOP / 2, sx + RACK_LEN, sy, RACK_TOP - 2, alpha(pal.silver, 0.5), 0.8, 0.5);

  // Conveyors from the edge of the island.
  for (const b of a.belts) {
    flat(c, b.x0, b.y - 0.2, b.x1 - b.x0, 0.4, 2, pal.light ? '#3a3c42' : '#232428');
    faceY(c, b.x0, b.x1, b.y + 0.2, 0, 2, pal.metal.l);
    line3(c, b.x0, b.y - 0.2, 2.2, b.x1, b.y - 0.2, 2.2, alpha(pal.silver, 0.7), 1, 0.6);
    line3(c, b.x0, b.y + 0.2, 2.2, b.x1, b.y + 0.2, 2.2, alpha(pal.silver, 0.7), 1, 0.6);
  }

  // Past the shelf capacity: a pallet stack in the front corner.
  if (a.overflow > 0) {
    const px = a.x + ISLE - 1.0;
    const py = a.y + ISLE - 0.75;
    box(c, px, py, 0.8, 0.6, 0, 1.5, triOf('#7a5f3c'));
    const stack = Math.min(3, 1 + Math.floor(a.overflow / 20));
    for (let k = 0; k < stack; k++) drawCrate(c, px + 0.05, py + 0.05, 1.5 + k * 7, 0.7, 0.5, 6.5, pal.card, false, false);
  }
}

/** Boxes riding the conveyors, and workers carrying job deliveries to the shelf and walking back empty. */
function aisleLive(c: Ctx, a: AisleView, t: number): void {
  const { pal } = c;
  for (const b of a.belts) {
    const len = b.x1 - b.x0;
    const n = Math.max(2, Math.round(len / 0.9));
    for (let k = 0; k < n; k++) {
      const u = frac(t * 0.12 + k / n);
      const x = b.x1 - 0.35 - u * (len - 0.4);
      box(c, x, b.y - 0.15, 0.3, 0.3, 2, 7, triOf(pal.card));
    }
  }

  a.jobs.slice(0, 2).forEach((_, k) => {
    const u = frac(t * 0.05 + k * 0.37 + a.index * 0.13);
    const out = u < 0.5;
    const v = out ? u * 2 : (1 - u) * 2;
    const x = a.sx + 0.7 + k * 1.4;
    const y = a.y + ISLE - 0.25 - v * (ISLE - 0.25 - (a.sy + RACK_D + 0.4) + a.y);
    person(c, x, y, pal.warn, t * 8 + k, true);
    if (out) box(c, x - 0.15, y - 0.35, 0.3, 0.3, 8, 13, triOf(pal.card));
  });
}

/** Vertical cylinder (tank): ellipse top, shaded body. */
function cylinder(c: Ctx, x: number, y: number, r: number, z0: number, z1: number, color: string): void {
  const { g, p } = c;
  const [cx, cyTop] = iso(p, x, y, z1);
  const [, cyBot] = iso(p, x, y, z0);
  const rx = 28.28 * r * p.s;
  const ry = 14.14 * r * p.s;
  const grad = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  grad.addColorStop(0, tri(color).l);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, tri(color).r);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(cx, cyBot, rx, ry, 0, 0, Math.PI);
  g.lineTo(cx - rx, cyTop);
  g.ellipse(cx, cyTop, rx, ry, 0, Math.PI, 0, true);
  g.closePath();
  g.fill();
  g.fillStyle = tri(color, 1.18).l;
  g.beginPath();
  g.ellipse(cx, cyTop, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** The crawler: a server hut and a lattice mast with a turning dish. Tokens stream down into it while it pulls. */
export function drawCrawler(c: Ctx, isle: Isle, cw: CrawlerView, t: number, live: boolean): void {
  const { g, p, pal } = c;
  const { x, y } = isle;
  const mx = x + 2.9;
  const my = y + 0.8;
  const H = cw.h + 10;
  if (!live) {
    crawlerStatic(c, isle, cw);
    return;
  }
  // Status lights on the hut front.
  const color = cw.blocked ? pal.down : cw.building ? pal.warn : cw.flowing ? pal.up : pal.fg4;
  const rate = cw.blocked ? 6 : cw.building ? 2 : 1.4;
  for (let k = 0; k < 3; k++) {
    const [lx, ly] = iso(p, x + 0.9 + k * 0.45, y + 3.2, 9);
    g.fillStyle = frac(t * rate + k * 0.3) < 0.6 ? color : alpha(color, 0.3);
    g.fillRect(lx - 1.5, ly - 1.5, Math.max(2, 2.4 * p.s), Math.max(2, 2.4 * p.s));
  }
  // Dish: a tilted ellipse turning slowly.
  const [dx, dy] = iso(p, mx + 0.25, my + 0.25, H + 2);
  const a = cw.online && !cw.blocked ? t * 0.8 : 0.4;
  const rx = 9 * p.s;
  g.fillStyle = pal.light ? '#e3e5e9' : '#c9ccd2';
  g.beginPath();
  g.ellipse(dx, dy, rx * (0.45 + 0.55 * Math.abs(Math.cos(a))), rx * 0.75, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = alpha(pal.fg4, 0.8);
  g.lineWidth = 1;
  g.stroke();
  if (cw.flowing) {
    // Tokens raining into the dish.
    g.fillStyle = pal.hl;
    for (let k = 0; k < 6; k++) {
      const u = frac(t * 0.6 + k / 6);
      const [sx, sy] = iso(p, mx + 0.25 - 1.6 * (1 - u), my + 0.25 - 1.6 * (1 - u), H + 2 + 30 * (1 - u));
      g.fillRect(sx - 1, sy - 1, Math.max(2, 2.2 * p.s), Math.max(2, 2.2 * p.s));
    }
  }
}

/** Crawler hut, mast, scaffolding while it is built, and the fibre run. */
function crawlerStatic(c: Ctx, isle: Isle, cw: CrawlerView): void {
  const { pal } = c;
  const { x, y } = isle;
  slab(c, x, y, ISLE, ISLE, 2, 0.65);
  box(c, x + 0.5, y + 1.6, 2.0, 1.6, 0, 16, pal.metal, alpha(pal.silver, 0.5));
  faceY(c, x + 0.7, x + 2.3, y + 3.2, 6, 12, pal.light ? '#1d1e22' : '#111214');
  // Mast: four legs and cross braces.
  const mx = x + 2.9;
  const my = y + 0.8;
  const H = cw.h + 10;
  const leg = alpha(pal.silver, 0.85);
  const legs: [number, number][] = [
    [mx, my],
    [mx + 0.5, my],
    [mx + 0.5, my + 0.5],
    [mx, my + 0.5],
  ];
  for (const [lx, ly] of legs) line3(c, lx, ly, 0, mx + 0.25, my + 0.25, H, leg, 1, 0.6);
  for (let z = 6; z < H - 4; z += 7) {
    const k = 1 - z / H;
    line3(c, mx + 0.25 - 0.25 * k, my + 0.25 + 0.25 * k, z, mx + 0.25 + 0.25 * k, my + 0.25 + 0.25 * k, z + 7, alpha(pal.silver, 0.5), 0.8, 0.5);
  }
  if (cw.building) {
    const pole = alpha(pal.warn, 0.9);
    for (const [lx, ly] of [
      [x + 0.4, y + 1.5],
      [x + 2.6, y + 1.5],
      [x + 2.6, y + 3.3],
    ] as [number, number][])
      line3(c, lx, ly, 0, lx, ly, 22, pole, 1, 0.6);
    line3(c, x + 0.4, y + 1.5, 20, x + 2.6, y + 1.5, 20, pole, 1.4, 0.8);
  }
  // Fibre run from the hut to the bay.
  line3(c, x + 2.5, y + 2.4, 0.6, x + ISLE - 0.1, y + 2.4, 0.6, alpha(pal.warn, 0.7), 1.2, 0.6);
}

/** The refinery: two tanks, a column with pipes, and two feed lines; crates roll in and steam rises while it works. */
export function drawRefinery(c: Ctx, isle: Isle, busy: number, t: number, live: boolean): void {
  const { pal } = c;
  const { x, y } = isle;
  if (live) {
    refineryLive(c, isle, busy, t);
    return;
  }
  slab(c, x, y, ISLE, ISLE, 2, 0.65);
  const tank = pal.light ? '#c4c7ce' : '#8a8f99';
  box(c, x + 0.4, y + 0.4, 3.1, 1.6, 0, 3, pal.metal);
  cylinder(c, x + 1.0, y + 1.1, 0.5, 3, 26, tank);
  cylinder(c, x + 2.1, y + 1.1, 0.5, 3, 22, tank);
  box(c, x + 2.85, y + 0.7, 0.45, 0.45, 3, 34, pal.steel, alpha(pal.silver, 0.6));
  // Yellow bands on the tanks (the team's plant), pipes joining them.
  line3(c, x + 1.0, y + 1.1, 26, x + 2.1, y + 1.1, 22, alpha(pal.silver, 0.8), 1.6, 0.8);
  line3(c, x + 2.1, y + 1.1, 18, x + 3.05, y + 0.95, 18, alpha(pal.silver, 0.8), 1.6, 0.8);
  // Feed lines.
  for (let lane = 0; lane < 2; lane++) {
    const ly = y + 2.45 + lane * 0.7;
    flat(c, x + 0.3, ly - 0.2, ISLE - 0.6, 0.4, 2, pal.light ? '#3a3c42' : '#232428');
    faceY(c, x + 0.3, x + ISLE - 0.3, ly + 0.2, 0, 2, pal.metal.l);
  }
}

/** Crates rolling in on busy lines, the status light and the steam. */
function refineryLive(c: Ctx, isle: Isle, busy: number, t: number): void {
  const { g, p, pal } = c;
  const { x, y } = isle;
  for (let lane = 0; lane < 2; lane++) {
    const ly = y + 2.45 + lane * 0.7;
    if (lane < busy) {
      for (let k = 0; k < 3; k++) {
        const u = frac(t * 0.15 + k / 3 + lane * 0.2);
        box(c, x + ISLE - 0.7 - u * (ISLE - 1.2), ly - 0.15, 0.3, 0.3, 2, 7, triOf('#c09656'));
      }
    }
  }
  const [lx, ly] = iso(p, x + 0.5, y + 2.0, 1.5);
  g.fillStyle = busy > 0 ? (frac(t * 1.5) < 0.6 ? pal.hl : alpha(pal.hl, 0.35)) : alpha(pal.fg4, 0.6);
  g.fillRect(lx, ly, Math.max(2, 2.4 * p.s), Math.max(2, 2.4 * p.s));
  if (busy > 0) {
    // Steam off the column.
    for (let k = 0; k < 4; k++) {
      const u = frac(t * 0.35 + k / 4);
      const [sx, sy] = iso(p, x + 3.07, y + 0.92, 36 + u * 18);
      g.fillStyle = alpha(pal.fg2, 0.28 * (1 - u));
      g.beginPath();
      g.arc(sx + Math.sin(t + k) * 3 * p.s, sy, (3 + u * 6) * p.s, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Loading bay: the job dock (pallets with deliveries) and the training gate, with a forklift that feeds runs. */
export function drawBay(c: Ctx, L: Layout, training: boolean, t: number, live: boolean): void {
  const { pal } = c;
  const { x, y } = L.bayIsle;
  const gx = x + 1.6;
  if (live) {
    // The gate glows while a run eats data; the forklift and the bay worker.
    if (training) faceY(c, gx + 0.25, gx + 1.75, y + 0.501, 0, 22, alpha(pal.hl, 0.22 + 0.08 * Math.sin(t * 2.5)));
    bayLive(c, L, training, t);
    return;
  }
  slab(c, x, y, ISLE, ISLE, 2, 0.65);
  // Gate on the back edge: a yellow portal with a dark mouth.
  box(c, gx, y + 0.2, 2.0, 0.3, 0, 30, pal.wall);
  faceY(c, gx + 0.25, gx + 1.75, y + 0.5, 0, 22, pal.light ? '#2a2b30' : '#08080a');
  faceY(c, gx + 0.15, gx + 0.25, y + 0.5, 0, 23, pal.hl);
  faceY(c, gx + 1.75, gx + 1.85, y + 0.5, 0, 23, pal.hl);
  faceY(c, gx + 0.15, gx + 1.85, y + 0.5, 22, 23.5, pal.hl);
  // Hazard chevrons on the floor in front of the gate.
  for (let k = 0; k < 4; k++) flat(c, gx + 0.25 + k * 0.4, y + 0.6, 0.2, 0.4, 0.02, alpha(pal.hl, 0.5));
  // Dock pallets with job deliveries.
  const dx = x + 0.25;
  const dy = y + 2.2;
  for (let k = 0; k < 2; k++) box(c, dx + k * 0.85, dy, 0.75, 1.2, 0, 1.5, triOf('#7a5f3c'));
  for (let i = 0; i < L.dockBoxes; i++) {
    const px = dx + (i % 2) * 0.85;
    const lv = Math.floor(i / 2);
    drawCrate(c, px + 0.08, dy + 0.15, 1.5 + lv * 6.5, 0.6, 0.9, 6, pal.card, false, false);
  }
}

function bayLive(c: Ctx, L: Layout, training: boolean, t: number): void {
  const { pal } = c;
  const { x, y } = L.bayIsle;
  // Forklift: parked, or shuttling crates into the gate while a run is on.
  let fx = x + 2.9;
  let fy = y + 2.9;
  let carry = false;
  if (training) {
    const u = frac(t / 7);
    const v = u < 0.5 ? u * 2 : (1 - u) * 2;
    fx = x + 2.6;
    fy = y + 3.2 - v * 2.2;
    carry = u < 0.5;
  }
  box(c, fx - 0.25, fy - 0.3, 0.5, 0.6, 0, 7, tri(pal.hl, 0.82, 0.64));
  box(c, fx - 0.2, fy - 0.05, 0.4, 0.35, 7, 13, pal.metal);
  line3(c, fx - 0.2, fy - 0.45, 0, fx - 0.2, fy - 0.45, 16, alpha(pal.fg2, 0.9), 1, 0.6);
  line3(c, fx + 0.2, fy - 0.45, 0, fx + 0.2, fy - 0.45, 16, alpha(pal.fg2, 0.9), 1, 0.6);
  if (carry) drawCrate(c, fx - 0.25, fy - 0.95, 2, 0.5, 0.45, 6, pal.card, false, false);
  // Bay worker.
  person(c, x + 0.6, y + 1.6, pal.warn, t * 3, false, pal.hl);
}
