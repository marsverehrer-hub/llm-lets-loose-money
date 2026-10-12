// The server room as data (GAME_DESIGN §21.5): one block per datacenter, a cloud rental block and a cloud burst block,
// each drawn as a grid of GPU cells. Pure functions, no UI. Safe on an empty fleet (every count can be zero).
// The fleet breakdown has no per-datacenter split yet, so each block gets the fleet's job mix in proportion.
import type { Datacenter, FleetBreakdown, GameState, Id, ServingSlice } from '../../../sim/types';
import { availableGpus, datacenterTierById, gpuById } from '../../../sim/systems/compute';
import { GPUS } from '../../../sim/data/gpus';
import { formatMoney } from '../../../sim/util';
import { fleetNow, ownGpuCount } from './fleetView';

/** The biggest block never needs more cells than this. */
export const MAX_ROOM_CELLS = 200;
const CELL_COLS_MAX = 20;

export type CellJob = 'training' | 'serving' | 'idle' | 'empty' | 'burst';
export interface RoomCell {
  job: CellJob;
  /** Index of the live product, for serving shades. */
  shade: number;
}
export interface GpuMixRow {
  gpuId: Id;
  name: string;
  count: number;
}
export interface ServingShare {
  productId: Id | null;
  name: string;
  gpus: number;
  shade: number;
}
export type BlockKind = 'dc' | 'rental' | 'burst';

export interface RoomBlock {
  key: string;
  kind: BlockKind;
  name: string;
  sub: string;
  building: boolean;
  buildDaysLeft: number;
  buildProgress: number;
  /** GPU slots the block can hold (burst: GPU-equivalents). */
  capacity: number;
  /** GPUs in the block (burst: GPU-equivalents bought). */
  installed: number;
  training: number;
  serving: number;
  idle: number;
  servingBy: ServingShare[];
  gpuMix: GpuMixRow[];
  /** Installed PF/s (burst: PF/s bought). */
  pflops: number;
  upkeepPerDay: number;
  powerPerDay: number;
  cols: number;
  rows: number;
  cells: RoomCell[];
}

export interface ServerRoom {
  blocks: RoomBlock[];
  /** GPUs per cell. Chosen so the biggest block has at most MAX_ROOM_CELLS cells. */
  gpusPerCell: number;
  ownGpus: number;
  training: number;
  serving: number;
  idle: number;
  liveProducts: number;
  burstPflops: number;
  burstCostPerDay: number;
  burstPricePerPflopDay: number;
  burstGpuEq: number;
  /** Best GPU available now, used to turn burst PF/s into GPU-equivalents. */
  refGpuName: string;
}

/** GPUs per cell: the smallest power of two that keeps the biggest block within MAX_ROOM_CELLS. */
export function gpusPerCell(maxCapacity: number): number {
  let n = 1;
  while (Math.ceil(maxCapacity / n) > MAX_ROOM_CELLS) n *= 2;
  return n;
}

/** Splits `total` into whole parts in proportion to `weights`, summing exactly to `total`. */
export function largestRemainder(total: number, weights: number[]): number[] {
  const out = weights.map(() => 0);
  const sum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (total <= 0 || sum <= 0 || weights.length === 0) return out;
  const raw = weights.map((w) => (w > 0 ? (total * w) / sum : 0));
  for (let i = 0; i < raw.length; i++) out[i] = Math.floor(raw[i]);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ frac: r - Math.floor(r), i })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k].i] += 1;
  return out;
}

interface Segment {
  job: CellJob;
  shade: number;
  count: number;
}

/** One cell per `perCell` GPUs. A cell takes the job at its middle GPU. Slots past the segments are empty. */
export function fillCells(capacity: number, perCell: number, segments: Segment[]): RoomCell[] {
  const n = capacity > 0 ? Math.ceil(capacity / perCell) : 0;
  let end = 0;
  const bounds = segments
    .filter((g) => g.count > 0)
    .map((g) => {
      end += g.count;
      return { end, job: g.job, shade: g.shade };
    });
  const cells: RoomCell[] = [];
  const half = Math.floor(perCell / 2);
  for (let i = 0; i < n; i++) {
    const pos = i * perCell + half;
    const hit = bounds.find((b) => pos < b.end);
    cells.push(hit ? { job: hit.job, shade: hit.shade } : { job: 'empty', shade: 0 });
  }
  return cells;
}

/** Rows and columns for a grid of `cells` cells: squarish, at most CELL_COLS_MAX wide. */
export function gridShape(cells: number): { cols: number; rows: number } {
  if (cells <= 0) return { cols: 0, rows: 0 };
  const cols = Math.min(cells, CELL_COLS_MAX, Math.max(1, Math.ceil(Math.sqrt(cells * 2))));
  return { cols, rows: Math.ceil(cells / cols) };
}

function gpuMixOf(counts: Record<Id, number>): GpuMixRow[] {
  return Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([gpuId, count]) => ({ gpuId, name: gpuById(gpuId)?.name ?? gpuId, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count);
}

function pflopsOf(counts: Record<Id, number>): number {
  let p = 0;
  for (const [gid, n] of Object.entries(counts)) p += (n ?? 0) * (gpuById(gid)?.pflops ?? 0);
  return p;
}

function powerOf(dc: Datacenter): number {
  const tier = datacenterTierById(dc.tierId);
  if (!tier) return 0;
  let kw = 0;
  for (const [gid, n] of Object.entries(dc.gpus)) kw += (n ?? 0) * (gpuById(gid)?.powerKw ?? 0);
  return kw * 24 * tier.powerPricePerKwh;
}

/** Share of a block's own GPUs given to training and serving, from the fleet's mix. */
function jobRatios(fb: FleetBreakdown): { training: number; serving: number } {
  const total = fb.trainingGpus + fb.servingGpus + fb.idleGpus;
  if (!(total > 0)) return { training: 0, serving: 0 };
  return { training: fb.trainingGpus / total, serving: fb.servingGpus / total };
}

/** Each live product's share of the block's serving GPUs, by its own PF/s. Equal shares when nothing reports PF/s. */
function servingShares(gpus: number, slices: ServingSlice[], shadeOf: Map<Id, number>, nameOf: Map<Id, string>): ServingShare[] {
  if (gpus <= 0) return [];
  if (slices.length === 0) return [{ productId: null, name: 'Serving', gpus, shade: 0 }];
  const weights = slices.map((sl) => (sl.ownPflops > 0 ? sl.ownPflops : 0));
  const weighted = weights.some((w) => w > 0) ? weights : slices.map(() => 1);
  const parts = largestRemainder(gpus, weighted);
  return slices.map((sl, i) => ({
    productId: sl.productId,
    name: nameOf.get(sl.productId) ?? 'Product',
    gpus: parts[i],
    shade: shadeOf.get(sl.productId) ?? 0,
  }));
}

function ownSplit(k: number, ratios: { training: number; serving: number }): { training: number; serving: number; idle: number } {
  const training = Math.min(k, Math.round(k * ratios.training));
  const serving = Math.min(k - training, Math.round(k * ratios.serving));
  return { training, serving, idle: k - training - serving };
}

function ownBlock(args: {
  key: string;
  kind: BlockKind;
  name: string;
  sub: string;
  capacity: number;
  counts: Record<Id, number>;
  upkeepPerDay: number;
  powerPerDay: number;
  building: boolean;
  buildDaysLeft: number;
  buildProgress: number;
  fb: FleetBreakdown;
  slices: ServingSlice[];
  shadeOf: Map<Id, number>;
  nameOf: Map<Id, string>;
  perCell: number;
}): RoomBlock {
  const k = Object.values(args.counts).reduce((a, n) => a + (n ?? 0), 0);
  const ratios = jobRatios(args.fb);
  const split = ownSplit(k, ratios);
  const serving = servingShares(split.serving, args.slices, args.shadeOf, args.nameOf);
  const segments: Segment[] = [
    { job: 'training', shade: 0, count: split.training },
    ...serving.map((sh) => ({ job: 'serving' as const, shade: sh.shade, count: sh.gpus })),
    { job: 'idle', shade: 0, count: split.idle },
  ];
  const cells = fillCells(args.capacity, args.perCell, segments);
  const shape = gridShape(cells.length);
  return {
    key: args.key,
    kind: args.kind,
    name: args.name,
    sub: args.sub,
    building: args.building,
    buildDaysLeft: args.buildDaysLeft,
    buildProgress: args.buildProgress,
    capacity: args.capacity,
    installed: k,
    training: split.training,
    serving: split.serving,
    idle: split.idle,
    servingBy: serving,
    gpuMix: gpuMixOf(args.counts),
    pflops: pflopsOf(args.counts),
    upkeepPerDay: args.upkeepPerDay,
    powerPerDay: args.powerPerDay,
    cols: shape.cols,
    rows: shape.rows,
    cells,
  };
}

/** Best GPU the player can get this year (for converting burst PF/s into GPU-equivalents). */
function referenceGpu(s: GameState): { name: string; pflops: number } {
  const pool = availableGpus(s);
  const list = pool.length > 0 ? pool : GPUS;
  let best = list[0];
  for (const g of list) if (g.pflops > (best?.pflops ?? 0)) best = g;
  return best ? { name: best.name, pflops: best.pflops } : { name: 'GPU', pflops: 1 };
}

export function buildRoom(s: GameState): ServerRoom {
  const fb = fleetNow(s);
  const live = s.products.filter((p) => p.active);
  const shadeOf = new Map<Id, number>(live.map((p, i) => [p.id, i]));
  const nameOf = new Map<Id, string>(live.map((p) => [p.id, p.name]));
  const slices = fb.slices.filter((sl) => shadeOf.has(sl.productId));

  const ref = referenceGpu(s);
  const burstGpuEq = fb.burstPflops > 0 && ref.pflops > 0 ? fb.burstPflops / ref.pflops : 0;
  const burstCap = Math.ceil(burstGpuEq - 1e-9);
  const rented = s.compute.rented;
  const rentedCount = Object.values(rented).reduce((a, n) => a + (n ?? 0), 0);
  const slotsOf = (dc: Datacenter) => datacenterTierById(dc.tierId)?.maxGpus ?? 0;
  const biggest = Math.max(0, rentedCount, burstCap, ...s.compute.datacenters.map(slotsOf));
  const perCell = gpusPerCell(biggest);

  const blocks: RoomBlock[] = s.compute.datacenters.map((dc) => {
    const tier = datacenterTierById(dc.tierId);
    const total = tier?.buildDays ?? 0;
    const building = dc.buildDaysLeft > 0;
    const buildProgress = building && total > 0 ? Math.min(1, Math.max(0, 1 - dc.buildDaysLeft / total)) : 1;
    return ownBlock({
      key: dc.id,
      kind: 'dc',
      name: dc.name,
      sub: tier?.name ?? dc.tierId,
      capacity: slotsOf(dc),
      counts: dc.gpus,
      upkeepPerDay: tier?.upkeepPerDay ?? 0,
      powerPerDay: powerOf(dc),
      building,
      buildDaysLeft: dc.buildDaysLeft,
      buildProgress,
      fb,
      slices,
      shadeOf,
      nameOf,
      perCell,
    });
  });

  blocks.push(
    ownBlock({
      key: 'rental',
      kind: 'rental',
      name: 'Cloud rental',
      sub: 'GPUs you rent by the day',
      capacity: rentedCount,
      counts: rented,
      upkeepPerDay: 0,
      powerPerDay: 0,
      building: false,
      buildDaysLeft: 0,
      buildProgress: 1,
      fb,
      slices,
      shadeOf,
      nameOf,
      perCell,
    }),
  );

  const burstCells = fillCells(burstCap, perCell, [{ job: 'burst', shade: 0, count: burstCap }]);
  const burstShape = gridShape(burstCells.length);
  blocks.push({
    key: 'burst',
    kind: 'burst',
    name: 'Cloud burst',
    sub: 'Overflow serving, bought per PF/s-day',
    building: false,
    buildDaysLeft: 0,
    buildProgress: 1,
    capacity: burstCap,
    installed: burstGpuEq,
    training: 0,
    serving: 0,
    idle: 0,
    servingBy: [],
    gpuMix: [],
    pflops: fb.burstPflops,
    upkeepPerDay: 0,
    powerPerDay: 0,
    cols: burstShape.cols,
    rows: burstShape.rows,
    cells: burstCells,
  });

  const ownGpus = ownGpuCount(s);
  const training = fb.trainingGpus;
  const serving = fb.servingGpus;
  return {
    blocks,
    gpusPerCell: perCell,
    ownGpus,
    training,
    serving,
    idle: Math.max(0, ownGpus - training - serving),
    liveProducts: live.length,
    burstPflops: fb.burstPflops,
    burstCostPerDay: fb.burstCostPerDay,
    burstPricePerPflopDay: fb.burstPricePerPflopDay,
    burstGpuEq,
    refGpuName: ref.name,
  };
}

/** One plain line for the top of the room: "1,216 GPUs · 1,040 training Bot-15 · 176 serving 2 products · cloud burst $3.1K/day". */
export function summaryParts(s: GameState, room: ServerRoom): string[] {
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  const parts: string[] = [`${n(room.ownGpus)} GPUs`];
  if (room.training > 0) parts.push(`${n(room.training)} training${s.training ? ` ${s.training.name}` : ''}`);
  if (room.liveProducts > 0 && room.serving > 0) {
    parts.push(`${n(room.serving)} serving ${room.liveProducts} ${room.liveProducts === 1 ? 'product' : 'products'}`);
  }
  if (room.idle > 0) parts.push(`${n(room.idle)} idle`);
  parts.push(room.burstCostPerDay > 0 ? `cloud burst ${formatMoney(room.burstCostPerDay)}/day` : 'no cloud burst');
  return parts;
}

/** The GPU slots a datacenter's tier allows, used for the free-slot count. */
export function freeSlots(dc: Datacenter): number {
  const max = datacenterTierById(dc.tierId)?.maxGpus ?? 0;
  const used = Object.values(dc.gpus).reduce((a, n) => a + (n ?? 0), 0);
  return Math.max(0, max - used);
}
