// Own fleet, priority and the split: own GPU counts, serving demand, the fleet numbers and the capacity readers.
import { BALANCE } from '../../balance';
import { GPUS } from '../../data/gpus';
import { getBonuses } from '../../bonuses';
import { calendarYear } from '../../util';
import { roleStrength } from '../staff';
import { productPflopsNeed } from '../modelLife'; // v15 routers
import { cloudLeaseGpus } from '../cloudMarket'; // v16 cloud market
import { clusterFor } from './clusters';
import type { ClusterEfficiency } from './clusters';
import { COMPUTE_TUNING, SECONDS_PER_DAY, SERVING_TUNING } from './tuning';
import { gpuById, rentMultiplier } from './catalogue';
import { hallOffline, inFleet, installedCount } from './sites';
import { dailyComputeCost, installedRunningCostPerDay } from './power';
import type { FleetBreakdown, FleetPriority, GameState, Model, ServingSlice } from '../../types';

export interface Capacity { total: number; training: number; inference: number }

// ---------------------------------------------------------------------------
// Own fleet, priority and the split
// ---------------------------------------------------------------------------

/** Own GPUs: rented in the cloud (v16: every provider) plus installed in finished datacenters not dedicated to the neocloud. */
export function ownGpuCount(s: GameState): number {
  let gpus = 0;
  for (const n of Object.values(s.compute.rented)) gpus += n;
  for (const n of Object.values(cloudLeaseGpus(s))) gpus += n;
  for (const dc of s.compute.datacenters) if (inFleet(s, dc) && !hallOffline(s, dc)) gpus += installedCount(dc); // a dark hall trains nothing
  return gpus;
}

/** Own PFLOP/s: rented plus installed in finished datacenters. */
export function ownPflops(s: GameState): number {
  let rented = 0;
  for (const [gid, n] of Object.entries(s.compute.rented)) rented += n * (gpuById(gid)?.pflops ?? 0);
  for (const [gid, n] of Object.entries(cloudLeaseGpus(s))) rented += n * (gpuById(gid)?.pflops ?? 0); // v16
  let installed = 0;
  for (const dc of s.compute.datacenters) {
    if (!inFleet(s, dc) || hallOffline(s, dc)) continue; // v19: a grid outage takes the hall's GPUs out for the day
    for (const [gid, n] of Object.entries(dc.gpus)) installed += n * (gpuById(gid)?.pflops ?? 0);
  }
  return rented + installed;
}

/** Fleet priority. Old saves have none, and count as 'serving'. */
export function priorityOf(s: GameState): FleetPriority {
  return s.compute.priority ?? 'serving';
}

/** A training run is active (it takes the own GPUs the priority leaves it). */
export function runActive(s: GameState): boolean {
  return !!s.training;
}

/** The priority that a legacy training share maps to (old saves, multiplayer, bots, tests). */
export function priorityFromShare(share: number): FleetPriority {
  if (share >= 0.75) return 'training';
  if (share >= 0.4) return 'balanced';
  return 'serving';
}

/**
 * Own PFLOP/s offered to serving. Without a training run, idle GPUs always serve first, so every own GPU is offered.
 * With a run: serving offers all of them, balanced offers BALANCED_SERVING_CAP of them, training offers none.
 */
export function offeredPflops(total: number, priority: FleetPriority, run: boolean): number {
  if (!run) return total;
  if (priority === 'training') return 0;
  if (priority === 'balanced') return total * SERVING_TUNING.BALANCED_SERVING_CAP;
  return total;
}

/** Tokens (millions) per day that one PFLOP/s serves for a model: 43 200 x efficiency / active params (B). */
export function mtokPerPflopDay(s: GameState, model: { paramsB: number; activeParamsB?: number; inferenceMult?: number }): number {
  const paramsB = model.activeParamsB ?? model.paramsB;
  if (!(paramsB > 0)) return 0;
  const inferenceMult = model.inferenceMult ?? 1;
  const engineerMult = 1 + COMPUTE_TUNING.ENGINEER_BOOST * Math.sqrt(roleStrength(s, 'engineer'));
  const efficiency = BALANCE.BASE_INFERENCE_EFFICIENCY * getBonuses(s).inferenceEfficiency * engineerMult * inferenceMult;
  // Tokens per day = PFLOP/s x 1e15 x 86 400 x efficiency / (2 x params x 1e9); Mtok divides by 1e6.
  return ((SECONDS_PER_DAY * efficiency) / (2 * paramsB));
}

function modelOf(s: GameState, id: string | null): Model | undefined {
  if (!id) return undefined;
  return s.models.find((m) => m.id === id);
}

/** PFLOP/s the live products need today, from their stored Mtok demand (written by productsTick). */
export function servingDemandPflops(s: GameState): number {
  let need = 0;
  for (const p of s.products) {
    if (!p.active || !(p.mtokPerDay > 0)) continue;
    const m = modelOf(s, p.modelId);
    if (!m) continue;
    need += productPflopsNeed(s, p, m); // v15: a router splits the load with a smaller model
  }
  return need;
}

export interface FleetNumbers {
  /** Own PFLOP/s. */
  total: number;
  /** PFLOP/s the products need (own plus burst). */
  demand: number;
  /** Own PFLOP/s offered to serving under the priority (and run state). */
  offered: number;
  /** Own PFLOP/s serving products now. */
  servingOwn: number;
  /** PFLOP/s bought from the cloud now. */
  burst: number;
  /** Own PFLOP/s a training run gets under the priority, before cluster efficiency. Used even with no run active. */
  trainingPool: number;
  /** Own PFLOP/s training now (0 without an active run). */
  training: number;
  /** Own PFLOP/s doing nothing now. */
  idle: number;
}

/** The split of own GPUs, for a priority and a run state. Pure: reads state, writes nothing. */
export function fleetNumbers(s: GameState, priority: FleetPriority, run: boolean): FleetNumbers {
  const total = ownPflops(s);
  const demand = servingDemandPflops(s);
  const offered = offeredPflops(total, priority, run);
  const servingOwn = Math.min(demand, offered);
  // What a run would get: the same rule as if a run were active (so estimates and the training speed stay meaningful).
  const trainingPool = total - Math.min(demand, offeredPflops(total, priority, true));
  const training = run ? trainingPool : 0;
  return {
    total,
    demand,
    offered,
    servingOwn,
    burst: demand - servingOwn,
    trainingPool,
    training,
    idle: Math.max(0, total - servingOwn - training),
  };
}

/**
 * v19: incident odds multiplier for training on the efficient cluster: 1 + 0.15 × log10(training GPUs / 1 000).
 * training.ts does not use it yet; the lead wires it into training incidents.
 */
export function clusterFailureMult(s: GameState): number {
  const gpus = Math.max(1, clusterEfficiency(s).usedGpus);
  return 1 + COMPUTE_TUNING.CLUSTER_FAILURE_PER_DECADE * Math.log10(Math.max(1, gpus / 1000));
}

function trainingEfficiency(s: GameState, n: FleetNumbers): number {
  const frac = n.total > 0 ? n.trainingPool / n.total : 0;
  return clusterFor(s, ownGpuCount(s) * frac).efficiency;
}

/**
 * Training cluster efficiency for the GPUs a run gets under the current priority (GAME_DESIGN 13.1).
 * Uses the training pool, so it is the same with or without an active run.
 */
export function clusterEfficiency(s: GameState): ClusterEfficiency {
  const n = fleetNumbers(s, priorityOf(s), runActive(s));
  const frac = n.total > 0 ? n.trainingPool / n.total : 0;
  return clusterFor(s, ownGpuCount(s) * frac);
}

/**
 * Compute capacity in PFLOP/s. `total` is own compute. `training` is what a run gets under the current priority,
 * cluster-efficient (the same with or without an active run, so estimates work). `inference` is the own pool offered
 * to serving (the capacity a product can use before it bursts).
 */
export function computeCapacity(s: GameState): Capacity {
  const n = fleetNumbers(s, priorityOf(s), runActive(s));
  return { total: n.total, training: n.trainingPool * trainingEfficiency(s, n), inference: n.offered };
}

/** Cheapest cloud price per PFLOP/s-day this year (rent per PFLOP/s-day of the best GPU on sale) x the burst premium. */
export function burstPricePerPflopDay(s: GameState): number {
  const year = calendarYear(s.day);
  let best = Infinity;
  for (const g of GPUS) if (g.unlockYear <= year && g.pflops > 0) best = Math.min(best, g.rentPerDay / g.pflops);
  if (!Number.isFinite(best)) return 0;
  // Shortage events may raise the premium by setting this flag (1 = none).
  const shortage = s.flags['burstPremiumMult'] ?? 1;
  return best * SERVING_TUNING.BURST_PREMIUM * shortage * rentMultiplier(s);
}

/** Today's serving picture for a priority and run state. Pure. Books nothing. */
export function fleetFor(s: GameState, priority: FleetPriority, run: boolean): FleetBreakdown {
  const n = fleetNumbers(s, priority, run);
  const gpus = ownGpuCount(s);
  const price = burstPricePerPflopDay(s);
  const ownShare = n.demand > 0 ? n.servingOwn / n.demand : 0;
  // Power and hardware operations are paid for the whole installed fleet either way; each own PFLOP/s carries an
  // equal share of them (v14: hardware operations included, so product margins show what owned GPUs really cost).
  // v15: cloud rent counts too. Rented GPUs that serve a product are part of what that product costs, so its margin
  // is honest (before, rent was only booked company-wide and a rented fleet looked free per product).
  const powerRate = n.total > 0 ? (installedRunningCostPerDay(s) + dailyComputeCost(s).rent) / n.total : 0;
  const slices: ServingSlice[] = [];
  for (const p of s.products) {
    if (!p.active) continue;
    const m = modelOf(s, p.modelId);
    const need = productPflopsNeed(s, p, m);
    const own = need * ownShare;
    const burst = need - own;
    slices.push({
      productId: p.id,
      ownPflops: own,
      burstPflops: burst,
      mtokPerDay: p.mtokPerDay,
      burstCostPerDay: burst * price,
      ownCostPerDay: own * powerRate,
    });
  }
  const gpusOf = (pf: number) => (n.total > 0 ? (gpus * pf) / n.total : 0);
  return {
    totalGpus: gpus,
    totalPflops: n.total,
    trainingPflops: run ? n.training * trainingEfficiency(s, n) : 0,
    trainingGpus: gpusOf(n.training),
    servingPflops: n.servingOwn,
    servingGpus: gpusOf(n.servingOwn),
    idlePflops: n.idle,
    idleGpus: gpusOf(n.idle),
    burstPflops: n.burst,
    burstCostPerDay: n.burst * price,
    burstPricePerPflopDay: price,
    slices,
  };
}

/**
 * Recomputes every derived compute field from the current state: fleet, totals, the training share mirror, the
 * inference pool and its utilization. Writes no money. Called once per tick by the serving tick, and when the
 * priority changes.
 */
export function refreshFleet(s: GameState): FleetBreakdown {
  const priority = priorityOf(s);
  const run = runActive(s);
  const fleet = fleetFor(s, priority, run);
  const n = fleetNumbers(s, priority, run);
  const cap = computeCapacity(s);
  s.compute.fleet = fleet;
  s.compute.totalPflops = cap.total;
  s.compute.trainingPflops = cap.training;
  s.compute.inferencePflops = cap.inference;
  // Mirror of the split: training GPUs / total (what a run would get under the priority).
  s.compute.trainingShare = n.total > 0 ? n.trainingPool / n.total : 0;
  // Own serving GPUs used / own GPUs offered to serving, capped at 1.
  s.compute.inferenceUtilization = n.offered > 0 ? Math.min(1, n.servingOwn / n.offered) : 0;
  return fleet;
}

/** Sets the fleet priority and refreshes the derived picture. */
export function applyPriority(s: GameState, priority: FleetPriority): void {
  s.compute.priority = priority;
  refreshFleet(s);
}

/**
 * Max tokens (millions/day) the own serving pool can serve for a model with `paramsB` billion FLOP-active params.
 * `inferenceMult` is the model's arch and verbosity efficiency (1 = baseline). Burst is not included (it is bought per day).
 */
export function inferenceCapacityMtok(s: GameState, paramsB: number, inferenceMult = 1): number {
  if (!(paramsB > 0)) return 0;
  return computeCapacity(s).inference * mtokPerPflopDay(s, { paramsB, inferenceMult });
}

/** Inference capacity for a specific model: MoE serves on its active params, arch and verbosity set the efficiency. */
export function modelInferenceCapacityMtok(s: GameState, model: { paramsB: number; activeParamsB?: number; inferenceMult?: number }): number {
  return inferenceCapacityMtok(s, model.activeParamsB ?? model.paramsB, model.inferenceMult ?? 1);
}
