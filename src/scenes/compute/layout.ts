// Compute scene layout: a pure function of the game state and the fleet picture. Floor units are x and y, heights are z
// (see src/office/iso.ts). Halls sit on a grid (three to a row, later rows further back), the training pod stands in
// front of the halls, the cloud rental platform floats off to the left and the product block sits to the right.
import type { FleetBreakdown, GameState, Datacenter } from '../../sim/types';
import { DATACENTER_TIERS } from '../../sim/data/gpus';
import { prand } from '../../office/iso';

export const GAP = 1.2;
/** LED rows per rack. One row per slice of the rack's GPUs, so the LEDs show the fleet mix. */
export const LEDS = 6;
export const RACK_FOOT = 0.45;
/** Top of the floating cloud rental platform's slab; racks stand on it. */
export const CLOUD_Z = 40;
export const CLOUD_TOP = CLOUD_Z + 14;
export const CLOUD_W = 4.6;
export const CLOUD_X0 = -7.6;
/** Racks the platform holds (5 x 5). */
export const CLOUD_SLOTS = 25;
export const POD_H = 26;
/** Racks the training pod draws at most. */
export const POD_SLOTS = 64;
export const PRODUCT_H = 22;
export const PRODUCT_W = 3.2;
/** Front band: the pod, the cloud platform and the products share this y line. */
export const FRONT_Y = 1.8;
/** Height of the burst cloud's centre. */
export const BURST_Z = 62;
export const BURST_TOP = 78;
/** Spacing of pod racks along both floor axes. */
export const POD_PITCH = 0.8;

export type HallStyle = 'closet' | 'cage' | 'campus' | 'cathedral';

export interface HallLook {
  style: HallStyle;
  /** Footprint along x and y, floor units. */
  w: number;
  d: number;
  wallH: number;
  rackH: number;
  floor: string;
}

const LOOKS: Record<string, HallLook> = {
  closet: { style: 'closet', w: 3.6, d: 3.0, wallH: 24, rackH: 16, floor: '#33302c' },
  colo: { style: 'cage', w: 6.0, d: 4.5, wallH: 30, rackH: 20, floor: '#2c2a26' },
  hyperscale: { style: 'campus', w: 10.5, d: 7.5, wallH: 40, rackH: 24, floor: '#2a2c2f' },
  cathedral: { style: 'cathedral', w: 14, d: 10.5, wallH: 58, rackH: 28, floor: '#2a2622' },
};

export function hallLook(tierId: string): HallLook {
  return LOOKS[tierId] ?? LOOKS.closet;
}

export function tierName(tierId: string): string {
  return DATACENTER_TIERS.find((t) => t.id === tierId)?.name ?? tierId;
}

/** Rack columns that fit a hall of width w (columns run along y, 1.5 apart). */
export function hallCols(w: number): number {
  return Math.max(1, Math.floor((w - 1.05) / 1.5) + 1);
}
/** Racks per column that fit a hall of depth d (0.6 apart). */
export function hallPerCol(d: number): number {
  return Math.max(1, Math.floor((d - 1.05) / 0.6) + 1);
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function installedOf(dc: Datacenter): number {
  let n = 0;
  for (const k in dc.gpus) n += dc.gpus[k] ?? 0;
  return n;
}

/** One rack glyph. Paths are filled in by the scene each time the camera fit changes. */
export interface RackDraw {
  x: number;
  y: number;
  z: number;
  h: number;
  seed: number;
  pod: boolean;
  top: Path2D;
  left: Path2D;
  right: Path2D;
  leds: Path2D[];
}

export function makeRack(x: number, y: number, z: number, h: number, seed: number, pod: boolean): RackDraw {
  return { x, y, z, h, seed, pod, top: new Path2D(), left: new Path2D(), right: new Path2D(), leds: [] };
}

export interface HallLayout {
  dc: Datacenter;
  tierId: string;
  tierName: string;
  look: HallLook;
  built: boolean;
  x0: number;
  y0: number;
  w: number;
  d: number;
  /** Draw order: halls further back draw first. Used as the sort group. */
  group: number;
  installed: number;
  rackSize: number;
  cols: number;
  perCol: number;
  /** x of each aisle, running along y. */
  laneX: number[];
  racks: RackDraw[];
}

export interface PodLayout {
  x0: number;
  y0: number;
  w: number;
  d: number;
  gpus: number;
  rackSize: number;
  racks: RackDraw[];
}

export interface CloudLayout {
  x0: number;
  y0: number;
  w: number;
  d: number;
  rentedGpus: number;
  rackSize: number;
  racks: RackDraw[];
  burst: boolean;
}

export interface ProductsLayout {
  x0: number;
  y0: number;
  w: number;
  d: number;
  live: number;
}

export interface Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  zmax: number;
}

export interface Layout {
  halls: HallLayout[];
  pod: PodLayout | null;
  cloud: CloudLayout | null;
  products: ProductsLayout | null;
  frontY: number;
  bounds: Bounds;
  engineers: number;
}

export function engineersOf(s: GameState): number {
  return Math.max(0, Math.floor(s.staff.roles.engineer?.count ?? 0));
}

export function rentedOf(s: GameState): number {
  let n = 0;
  for (const k in s.compute.rented) n += s.compute.rented[k] ?? 0;
  return n;
}

export function buildLayout(s: GameState, fleet: FleetBreakdown): Layout {
  const dcs = s.compute.datacenters;
  const ncols = Math.min(3, Math.max(1, dcs.length));
  const looks = dcs.map((dc) => hallLook(dc.tierId));

  // Grid: column widths and row depths are the largest hall in that column or row.
  const colW: number[] = [];
  const rowD: number[] = [];
  dcs.forEach((_, i) => {
    const c = i % ncols;
    const r = Math.floor(i / ncols);
    colW[c] = Math.max(colW[c] ?? 0, looks[i].w);
    rowD[r] = Math.max(rowD[r] ?? 0, looks[i].d);
  });
  const colLeft: number[] = [];
  let acc = 0;
  for (let c = 0; c < ncols; c++) {
    colLeft.push(acc);
    acc += (colW[c] ?? 0) + GAP;
  }
  // Row 0's front edge is y = 0. Later rows sit further back (negative y).
  const rowFront: number[] = [];
  acc = 0;
  for (let r = 0; r < rowD.length; r++) {
    rowFront.push(-acc);
    acc += rowD[r] + GAP;
  }

  const halls: HallLayout[] = dcs.map((dc, i) => {
    const c = i % ncols;
    const r = Math.floor(i / ncols);
    const look = looks[i];
    const x0 = colLeft[c];
    const y1 = rowFront[r];
    const y0 = y1 - look.d;
    const built = dc.buildDaysLeft <= 0;
    const cols = hallCols(look.w);
    const perCol = hallPerCol(look.d);
    const installed = installedOf(dc);
    const cap = cols * perCol;
    // Rack size doubles until the GPUs fit in the hall's rack slots, so every hall stays readable.
    const rackSize = built && installed > 0 ? nextPow2(Math.ceil(installed / cap)) : 1;
    const glyphs = built && installed > 0 ? Math.ceil(installed / rackSize) : 0;
    const racks: RackDraw[] = [];
    for (let k = 0; k < glyphs; k++) {
      const col = Math.floor(k / perCol);
      const row = k % perCol;
      racks.push(makeRack(x0 + 0.6 + col * 1.5, y0 + 0.6 + row * 0.6, 0, look.rackH, Math.floor(prand(i * 131.7 + k * 7.13) * LEDS), false));
    }
    const laneX: number[] = [];
    for (let j = 0; j < cols; j++) laneX.push(j === 0 ? x0 + 0.3 : x0 + 1.575 + (j - 1) * 1.5);
    return { dc, tierId: dc.tierId, tierName: tierName(dc.tierId), look, built, x0, y0, w: look.w, d: look.d, group: 0, installed, rackSize, cols, perCol, laneX, racks };
  });

  // Draw order: back rows first, then left to right. Halls never overlap in x or y, so this order is correct.
  const order = halls.map((_, i) => i).sort((a, b) => {
    const ra = Math.floor(a / ncols);
    const rb = Math.floor(b / ncols);
    if (ra !== rb) return rb - ra;
    return a % ncols - b % ncols;
  });
  order.forEach((idx, rank) => {
    halls[idx].group = rank;
  });
  const ordered = order.map((idx) => halls[idx]);

  const gridX1 = halls.reduce((m, h) => Math.max(m, h.x0 + h.w), 0);

  let pod: PodLayout | null = null;
  if (s.training) {
    // A run can be active before any GPU is installed; then the pod is an empty glowing pad.
    const tg = Math.max(0, Math.round(fleet.trainingGpus));
    const rackSize = tg > 0 ? nextPow2(Math.ceil(tg / POD_SLOTS)) : 1;
    const glyphs = tg > 0 ? Math.ceil(tg / rackSize) : 0;
    const cols = Math.max(1, Math.ceil(Math.sqrt(glyphs)));
    const rows = Math.max(1, Math.ceil(glyphs / cols));
    const x0 = 0;
    const y0 = FRONT_Y;
    const racks: RackDraw[] = [];
    for (let k = 0; k < glyphs; k++) {
      racks.push(makeRack(x0 + 0.3 + (k % cols) * POD_PITCH, y0 + 0.3 + Math.floor(k / cols) * POD_PITCH, 0, POD_H, Math.floor(prand(900 + k * 3.37) * LEDS), true));
    }
    pod = {
      x0,
      y0,
      w: Math.max(3, cols * POD_PITCH + 0.3),
      d: Math.max(3, rows * POD_PITCH + 0.3),
      gpus: tg,
      rackSize,
      racks,
    };
  }

  const rented = rentedOf(s);
  const burst = fleet.burstPflops > 1e-6;
  let cloud: CloudLayout | null = null;
  if (rented > 0 || burst) {
    const rackSize = rented > 0 ? nextPow2(Math.ceil(rented / CLOUD_SLOTS)) : 1;
    const glyphs = rented > 0 ? Math.ceil(rented / rackSize) : 0;
    const racks: RackDraw[] = [];
    for (let k = 0; k < glyphs; k++) {
      racks.push(makeRack(CLOUD_X0 + 0.3 + (k % 5) * 0.9, FRONT_Y + 0.3 + Math.floor(k / 5) * 0.9, CLOUD_Z, 14, Math.floor(prand(5000 + k * 1.91) * LEDS), false));
    }
    cloud = { x0: CLOUD_X0, y0: FRONT_Y, w: CLOUD_W, d: CLOUD_W, rentedGpus: rented, rackSize, racks, burst };
  }

  let products: ProductsLayout | null = null;
  if (s.products.length > 0) {
    const podX1 = pod ? pod.x0 + pod.w : 0;
    products = {
      x0: Math.max(gridX1, podX1) + 2.2,
      y0: FRONT_Y,
      w: PRODUCT_W,
      d: PRODUCT_W,
      live: s.products.filter((p) => p.active).length,
    };
  }

  const frontY = (pod ? pod.y0 + pod.d : FRONT_Y + PRODUCT_W) + 0.9;

  // Bounds for the camera fit.
  let xmin = 0;
  let xmax = gridX1;
  let ymin = 0;
  let ymax = FRONT_Y + PRODUCT_W;
  let zmax = 30;
  for (const h of halls) {
    ymin = Math.min(ymin, h.y0);
    zmax = Math.max(zmax, h.look.wallH + (h.look.style === 'cathedral' ? 22 : 0));
  }
  if (cloud) {
    xmin = Math.min(xmin, cloud.x0);
    ymax = Math.max(ymax, cloud.y0 + cloud.d);
    zmax = Math.max(zmax, CLOUD_TOP);
    if (cloud.burst) zmax = Math.max(zmax, BURST_TOP);
  }
  if (pod) {
    xmax = Math.max(xmax, pod.x0 + pod.w);
    ymax = Math.max(ymax, pod.y0 + pod.d);
    zmax = Math.max(zmax, POD_H);
  }
  if (products) {
    xmax = Math.max(xmax, products.x0 + products.w);
    ymax = Math.max(ymax, products.y0 + products.d);
    zmax = Math.max(zmax, PRODUCT_H + 4);
  }
  // A small or empty campus still gets a sensible frame.
  if (xmax - xmin < 10) xmax = xmin + 10;
  if (ymax - ymin < 8) ymin = ymax - 8;

  return {
    halls: ordered,
    pod,
    cloud,
    products,
    frontY,
    bounds: { xmin, xmax, ymin, ymax, zmax },
    engineers: engineersOf(s),
  };
}
