// v16 memory wall (GAME_DESIGN §27.1). A model has to fit in the cluster before it can train: weights, gradients and
// Adam state take BYTES_PER_PARAM per parameter (MoE counts every expert), and a GPU only has so much HBM. Naive model
// parallelism splits a model over one 8-GPU box. Each parallelism node
// lets the model be sharded over more GPUs. So a 3T model needs pipeline or 3D parallelism AND hundreds of big-memory
// GPUs, which in 2021 nobody had.
import type { GameState } from '../types';
import { GPUS } from '../data/gpus';
import { yearOf } from '../util';
import { isResearched } from './research';
import { clusterEfficiency } from './compute';
import { cloudGpusByType } from './cloudMarket';

export const MEMORY_TUNING = {
  /** Off only in unit tests that predate the wall (tests/setup.ts) and use toy fleets with big models. */
  ENFORCE: true,
  /** bf16 weights + bf16 grads + fp32 master weights + two Adam moments. */
  BYTES_PER_PARAM: 16,
  /** Share of HBM left for weights and optimizer state once activations and buffers are in. */
  USABLE_SHARE: 0.6,
  /** HBM of a GPU without memGB (old data). */
  DEFAULT_MEM_GB: 16,
  /**
   * How many GPUs one copy of the model can be sharded over, by the best parallelism node owned. ZeRO shards the
   * optimizer state, tensor parallel splits the matrices inside a node, pipeline parallel splits layers across nodes.
   */
  SHARD_DEGREE: [
    ['base', 8], // naive model parallelism inside one 8-GPU box
    ['zero_sharding', 32],
    ['tensor_parallel', 128],
    ['pipeline_parallel', 1024],
    ['parallelism_3d', 8192],
    ['cross_dc_training', 65536],
  ] as [string, number][],
};

/** Largest number of GPUs one model copy can be sharded over, by research. */
export function shardDegree(s: GameState): number {
  let d = 1;
  for (const [id, n] of MEMORY_TUNING.SHARD_DEGREE) if (id === 'base' || isResearched(s, id)) d = Math.max(d, n);
  return d;
}

/** GPU-count-weighted HBM (GB) across the lab's own GPUs (rented and installed). Starter-fleet memory with no GPUs. */
export function fleetMemGB(s: GameState): number {
  let n = 0;
  let mem = 0;
  const add = (gid: string, k: number) => {
    const g = GPUS.find((x) => x.id === gid);
    n += k;
    mem += k * (g?.memGB ?? MEMORY_TUNING.DEFAULT_MEM_GB);
  };
  for (const [gid, k] of Object.entries(cloudGpusByType(s))) if (k > 0) add(gid, k); // every cloud provider
  const sold = s.neocloud?.dedicated ?? []; // halls dedicated to the neocloud do not train
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft > 0 || sold.includes(dc.id)) continue;
    for (const [gid, k] of Object.entries(dc.gpus)) if (k > 0) add(gid, k);
  }
  return n > 0 ? mem / n : (GPUS[0].memGB ?? MEMORY_TUNING.DEFAULT_MEM_GB);
}

/** Parameters (billions) one GPU of `memGB` can hold for training. */
export function paramsPerGpuB(memGB: number): number {
  return (memGB * MEMORY_TUNING.USABLE_SHARE) / MEMORY_TUNING.BYTES_PER_PARAM;
}

/** GPUs needed to hold a model of `paramsB` total parameters for training on this fleet's memory. */
export function gpusToHold(s: GameState, paramsB: number): number {
  return Math.max(1, Math.ceil(paramsB / paramsPerGpuB(fleetMemGB(s))));
}

export interface MemoryWall {
  /** Largest trainable model (billions of total parameters) right now. */
  maxParamsB: number;
  /** What it would be with the whole training pool and no research limit: the next goal. */
  shardDegree: number;
  trainingGpus: number;
  memGB: number;
  /** Which limit binds: research (shard degree) or GPUs (not enough of them). */
  limitedBy: 'research' | 'gpus';
}

/** The memory wall for the current fleet, priority and research. */
export function memoryWall(s: GameState): MemoryWall {
  const memGB = fleetMemGB(s);
  const degree = shardDegree(s);
  const trainingGpus = Math.max(1, Math.floor(clusterEfficiency(s).usedGpus));
  const shards = Math.min(degree, trainingGpus);
  return {
    maxParamsB: paramsPerGpuB(memGB) * shards,
    shardDegree: degree,
    trainingGpus,
    memGB,
    limitedBy: degree <= trainingGpus ? 'research' : 'gpus',
  };
}

/** Why a model of `paramsB` cannot be trained on this cluster, or null. */
export function memoryWallError(s: GameState, paramsB: number): string | null {
  if (!MEMORY_TUNING.ENFORCE) return null;
  const w = memoryWall(s);
  if (paramsB <= w.maxParamsB * (1 + 1e-9)) return null;
  const need = gpusToHold(s, paramsB);
  const max = w.maxParamsB >= 1 ? `${w.maxParamsB.toFixed(w.maxParamsB < 10 ? 1 : 0)}B` : `${Math.round(w.maxParamsB * 1000)}M`;
  if (need > w.shardDegree) {
    return `Out of memory: ${paramsB}B parameters need ${need.toLocaleString('en-US')} GPUs of ${Math.round(w.memGB)} GB working as one, but your parallelism research can shard a model over ${w.shardDegree.toLocaleString('en-US')}. Max now ${max}. Research model parallelism or get bigger-memory GPUs.`;
  }
  return `Out of memory: ${paramsB}B parameters need ${need.toLocaleString('en-US')} GPUs of ${Math.round(w.memGB)} GB for training; your training pool has ${w.trainingGpus.toLocaleString('en-US')}. Max now ${max}.`;
}

// ---------------------------------------------------------------------------
// v16 GPU allocation (GAME_DESIGN §27.2): the vendor rations new generations
// ---------------------------------------------------------------------------

export const SUPPLY_TUNING = {
  /** Off only in unit tests that predate allocation (tests/setup.ts). */
  ENFORCE: true,
  /** GPUs of a generation the vendor sells one lab per quarter in its launch year. */
  ALLOC_BASE: 256,
  /** Allocation multiplies by this per year since launch as the fabs catch up. */
  ALLOC_GROWTH_PER_YEAR: 4,
  /** Brand helps: allocation × (1 + brand / BRAND_DIV). Big customers get the boxes first. */
  BRAND_DIV: 50,
  QUARTER_DAYS: 90,
};

function quarterKey(s: GameState, gpuId: string): string {
  return `alloc.${gpuId}.${Math.floor(s.day / SUPPLY_TUNING.QUARTER_DAYS)}`;
}

/** GPUs of `gpuId` the vendor will still sell this quarter (Infinity for unknown GPUs). */
export function gpuAllocationLeft(s: GameState, gpuId: string): number {
  const g = GPUS.find((x) => x.id === gpuId);
  if (!g || !SUPPLY_TUNING.ENFORCE) return Infinity;
  const T = SUPPLY_TUNING;
  const age = Math.max(0, yearOf(s.day) - g.unlockYear);
  const quota = Math.floor(T.ALLOC_BASE * T.ALLOC_GROWTH_PER_YEAR ** age * (1 + Math.max(0, s.company.brand) / T.BRAND_DIV));
  return Math.max(0, quota - (s.flags[quarterKey(s, gpuId)] ?? 0));
}

/** Book a purchase against this quarter's allocation. */
export function consumeGpuAllocation(s: GameState, gpuId: string, count: number): void {
  const k = quarterKey(s, gpuId);
  s.flags[k] = (s.flags[k] ?? 0) + count;
}
