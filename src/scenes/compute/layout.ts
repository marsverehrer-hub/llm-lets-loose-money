// Compute scene layout: a pure function of the game state, the fleet picture and the canvas size. Every hall, the
// training cluster, the product edge and the cloud get a square cell on the staggered lattice (kit.lattice), so the
// campus spreads across a wide strip and stacks up on a phone. Floor units are x and y, heights are z.
import type { FleetBreakdown, GameState, Datacenter } from '../../sim/types';
import { DATACENTER_TIERS } from '../../sim/data/gpus';
import { cloudGpusByType } from '../../sim/systems/cloudMarket';
import { lattice, type Box3 } from '../kit';

/** Rack footprint (x by y) and the aisle in front of each row. The aisle is wide enough that no row hides the next one's front. */
export const RACK_W = 0.5;
export const RACK_D = 0.7;
export const AISLE = 1.2;
export const ROW_PITCH = RACK_D + AISLE;
/** Back strip for cooling units, side strip for the wall, front strip for the walkway. */
const BACK = 1.05;
const SIDE = 0.75;
const FRONT = 0.45;
export const LED_ROWS = 6;
export const CLOUD_Z = 16;
export const BURST_Z = 44;
export const POD_SLOTS = 18;
export const CLOUD_SLOTS = 12;
export const PRODUCT_H = 22;
const GAP = 1.0;

export type HallStyle = 'closet' | 'cage' | 'campus' | 'cathedral';

export interface HallLook {
  style: HallStyle;
  w: number;
  d: number;
  wallH: number;
  rackH: number;
}

const LOOKS: Record<string, HallLook> = {
  closet: { style: 'closet', w: 3.6, d: 3.1, wallH: 26, rackH: 17 },
  colo: { style: 'cage', w: 5.6, d: 4.9, wallH: 28, rackH: 19 },
  hyperscale: { style: 'campus', w: 7.8, d: 6.8, wallH: 32, rackH: 21 },
  cathedral: { style: 'cathedral', w: 10.2, d: 8.7, wallH: 38, rackH: 23 },
};

export function hallLook(tierId: string): HallLook {
  return LOOKS[tierId] ?? LOOKS.closet;
}

export function tierName(tierId: string): string {
  return DATACENTER_TIERS.find((t) => t.id === tierId)?.name ?? tierId;
}

export function installedOf(dc: Datacenter): number {
  let n = 0;
  for (const k in dc.gpus) n += dc.gpus[k] ?? 0;
  return n;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** One rack slot: its footprint origin, row and a stable random number for its LEDs. */
export interface RackSlot {
  x: number;
  y: number;
  row: number;
  filled: boolean;
  seed: number;
}

export interface HallLayout {
  dc: Datacenter;
  tierName: string;
  look: HallLook;
  built: boolean;
  liquid: boolean;
  infiniband: boolean;
  /** Dedicated to the neocloud: sold to customers. */
  leased: boolean;
  /** 0..1 build progress for halls under construction. */
  progress: number;
  x0: number;
  y0: number;
  w: number;
  d: number;
  line: number;
  installed: number;
  slots: number;
  gpusPerRack: number;
  filledRacks: number;
  rows: number;
  perRow: number;
  /** y of each row's back edge. */
  rowY: number[];
  /** x where the rows start. */
  rowX: number;
  racks: RackSlot[];
  box: Box3;
}

export interface PodLayout {
  x0: number;
  y0: number;
  w: number;
  d: number;
  line: number;
  gpus: number;
  gpusPerRack: number;
  racks: RackSlot[];
  box: Box3;
}

export interface CloudLayout {
  x0: number;
  y0: number;
  w: number;
  d: number;
  line: number;
  rentedGpus: number;
  gpusPerRack: number;
  racks: RackSlot[];
  burst: boolean;
  box: Box3;
  burstBox: Box3;
}

export interface ProductsLayout {
  x0: number;
  y0: number;
  w: number;
  d: number;
  line: number;
  live: number;
  box: Box3;
}

export interface Layout {
  halls: HallLayout[];
  pod: PodLayout | null;
  cloud: CloudLayout | null;
  products: ProductsLayout | null;
  cell: number;
  /** Everything the camera has to fit. */
  bounds: Box3[];
  engineers: number;
  lines: number;
}

export function engineersOf(s: GameState): number {
  return Math.max(0, Math.floor(s.staff.roles.engineer?.count ?? 0));
}

export function rentedOf(s: GameState): number {
  let n = 0;
  const rented = cloudGpusByType(s); // v16: every cloud provider
  for (const k in rented) n += rented[k] ?? 0;
  return n;
}

function rackGrid(x0: number, y0: number, w: number, d: number, n: number, pitchX: number, pitchY: number, seed: number): RackSlot[] {
  const cols = Math.max(1, Math.floor(w / pitchX));
  const out: RackSlot[] = [];
  for (let k = 0; k < n; k++) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    if (row * pitchY + RACK_D > d + 1e-6) break;
    out.push({ x: x0 + col * pitchX, y: y0 + row * pitchY, row, filled: true, seed: seed + k * 0.6180339 });
  }
  return out;
}

export function buildLayout(s: GameState, fleet: FleetBreakdown, W: number, H: number): Layout {
  const dcs = s.compute.datacenters;
  const looks = dcs.map((dc) => hallLook(dc.tierId));
  const rented = rentedOf(s);
  const burst = fleet.burstPflops > 1e-6;
  const hasCloud = rented > 0 || burst;
  const hasPod = !!s.training;
  const hasProducts = s.products.length > 0;
  const leasedIds = new Set(s.neocloud?.dedicated ?? []);

  let cell = 4.4;
  for (const l of looks) cell = Math.max(cell, l.w, l.d);
  // Order on the lattice: the cloud first (top left), then the halls, the training cluster and the product edge.
  const kinds: ('cloud' | 'pod' | 'products' | number)[] = [];
  if (hasCloud) kinds.push('cloud');
  dcs.forEach((_, i) => kinds.push(i));
  if (hasPod) kinds.push('pod');
  if (hasProducts) kinds.push('products');
  const n = Math.max(1, kinds.length);
  const zTop = 46;
  const cells = lattice(n, cell, GAP, zTop, W, H);
  const lines = cells.length ? cells[cells.length - 1].line + 1 : 1;

  const halls: HallLayout[] = [];
  let pod: PodLayout | null = null;
  let cloud: CloudLayout | null = null;
  let products: ProductsLayout | null = null;
  const bounds: Box3[] = [];

  kinds.forEach((kind, ci) => {
    const c = cells[ci];
    if (!c) return;
    bounds.push({ x0: c.x, y0: c.y, x1: c.x + cell, y1: c.y + cell, z0: -2, z1: 0 });
    if (typeof kind === 'number') {
      const dc = dcs[kind];
      const look = looks[kind];
      const x0 = c.x + (cell - look.w) / 2;
      const y0 = c.y + (cell - look.d) / 2;
      const tier = DATACENTER_TIERS.find((t) => t.id === dc.tierId);
      const built = dc.buildDaysLeft <= 0;
      const perRow = Math.max(1, Math.floor((look.w - SIDE - 0.25) / RACK_W));
      const rows = Math.max(1, Math.floor((look.d - BACK - FRONT + AISLE) / ROW_PITCH));
      const cap = perRow * rows;
      const installed = installedOf(dc);
      const maxGpus = tier?.maxGpus ?? Math.max(1, installed);
      const gpusPerRack = Math.max(1, Math.ceil(Math.max(maxGpus, installed) / cap));
      const filledRacks = built && installed > 0 ? Math.min(cap, Math.ceil(installed / gpusPerRack)) : 0;
      const rowX = x0 + SIDE;
      const rowY: number[] = [];
      for (let r = 0; r < rows; r++) rowY.push(y0 + BACK + r * ROW_PITCH);
      const racks: RackSlot[] = [];
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < perRow; k++) {
          const idx = r * perRow + k;
          racks.push({ x: rowX + k * RACK_W, y: rowY[r], row: r, filled: idx < filledRacks, seed: kind * 97.13 + idx * 0.6180339 });
        }
      }
      const buildDays = Math.max(1, (tier?.buildDays ?? 1));
      const progress = built ? 1 : Math.max(0, Math.min(1, 1 - dc.buildDaysLeft / buildDays));
      halls.push({
        dc,
        tierName: tierName(dc.tierId),
        look,
        built,
        liquid: !!dc.liquid,
        infiniband: !!dc.infiniband,
        leased: leasedIds.has(dc.id),
        progress,
        x0,
        y0,
        w: look.w,
        d: look.d,
        line: c.line,
        installed,
        slots: maxGpus,
        gpusPerRack,
        filledRacks,
        rows,
        perRow,
        rowY,
        rowX,
        racks,
        box: { x0, y0, x1: x0 + look.w, y1: y0 + look.d, z0: 0, z1: look.wallH },
      });
      bounds.push({ x0, y0, x1: x0 + look.w, y1: y0 + look.d, z0: 0, z1: look.wallH + 14 });
    } else if (kind === 'pod') {
      const tg = Math.max(0, Math.round(fleet.trainingGpus));
      const gpusPerRack = tg > 0 ? nextPow2(Math.ceil(tg / POD_SLOTS)) : 1;
      const glyphs = tg > 0 ? Math.min(POD_SLOTS, Math.ceil(tg / gpusPerRack)) : 0;
      const w = Math.min(cell, 5.2);
      const x0 = c.x + (cell - w) / 2;
      const y0 = c.y + (cell - w) / 2;
      const racks = rackGrid(x0 + 0.5, y0 + 0.6, w - 0.9, w - 0.9, glyphs, RACK_W + 0.12, RACK_D + 1.05, 900);
      pod = { x0, y0, w, d: w, line: c.line, gpus: tg, gpusPerRack, racks, box: { x0, y0, x1: x0 + w, y1: y0 + w, z0: 0, z1: 28 } };
      bounds.push({ x0, y0, x1: x0 + w, y1: y0 + w, z0: 0, z1: 40 });
    } else if (kind === 'cloud') {
      const gpusPerRack = rented > 0 ? nextPow2(Math.ceil(rented / CLOUD_SLOTS)) : 1;
      const glyphs = rented > 0 ? Math.min(CLOUD_SLOTS, Math.ceil(rented / gpusPerRack)) : 0;
      const w = Math.min(cell, 4.6);
      const x0 = c.x + (cell - w) / 2;
      const y0 = c.y + (cell - w) / 2;
      const racks = rackGrid(x0 + 0.45, y0 + 0.45, w - 0.8, w - 0.8, glyphs, RACK_W + 0.32, RACK_D + 0.62, 5000);
      const cx = x0 + w / 2;
      const cy = y0 + w / 2;
      cloud = {
        x0,
        y0,
        w,
        d: w,
        line: c.line,
        rentedGpus: rented,
        gpusPerRack,
        racks,
        burst,
        box: { x0, y0, x1: x0 + w, y1: y0 + w, z0: CLOUD_Z - 3, z1: CLOUD_Z + 14 },
        burstBox: { x0: cx - 1.2, y0: cy - 1.2, x1: cx + 1.2, y1: cy + 1.2, z0: BURST_Z - 8, z1: BURST_Z + 10 },
      };
      bounds.push({ x0, y0, x1: x0 + w, y1: y0 + w, z0: 0, z1: burst ? BURST_Z + 14 : CLOUD_Z + 26 });
    } else {
      const w = Math.min(cell, 3.6);
      const x0 = c.x + (cell - w) / 2;
      const y0 = c.y + (cell - w) / 2;
      products = {
        x0,
        y0,
        w,
        d: w,
        line: c.line,
        live: s.products.filter((p) => p.active).length,
        box: { x0: x0 + 0.5, y0: y0 + 0.5, x1: x0 + w - 0.5, y1: y0 + w - 0.5, z0: 0, z1: PRODUCT_H },
      };
      bounds.push({ x0, y0, x1: x0 + w, y1: y0 + w, z0: 0, z1: PRODUCT_H + 16 });
    }
  });
  if (!bounds.length) bounds.push({ x0: 0, y0: 0, x1: cell, y1: cell, z0: 0, z1: 10 });

  return { halls, pod, cloud, products, cell, bounds, engineers: engineersOf(s), lines };
}
