// OWNER: Agent A. GPUs, cloud rental, datacenters, power, capacity split.
// v10 (GAME_DESIGN §21.1): the fleet split lives here, next to the capacity readers, so compute and serving share one
// set of numbers. Own GPUs serve products first; demand they cannot cover is bought from the cloud as burst capacity.
import type { ActionHandlers, FleetBreakdown, FleetPriority, GameState, Id, Model, Rng, GpuDef, DatacenterTier, Datacenter, ServingSlice } from '../types';
import { BALANCE } from '../balance';
import { GPUS, DATACENTER_TIERS } from '../data/gpus';
import { RESEARCH } from '../data/research';
import { addExpense, addRevenue, calendarYear, clamp, formatMoney, newId, notify, pushNews, trySpend } from '../util';
import { getBonuses } from '../bonuses';
import { isResearched } from './research';
import { roleStrength } from './staff';

export interface Capacity { total: number; training: number; inference: number }

export const COMPUTE_TUNING = {
  /** Fraction of buy price returned when selling a GPU. */
  SELL_REFUND: 0.4,
  HOURS_PER_DAY: 24,
  /** Inference efficiency gain per sqrt(engineer strength). */
  ENGINEER_BOOST: 0.08,
  MAX_GPU_ORDER: 1_000_000,
};

/**
 * v10 serving tuning (GAME_DESIGN §21.1). serving.ts re-exports this as SERVING_TUNING.
 * Rent is the floor for cloud prices, so BURST_PREMIUM stays above 1.
 */
export const SERVING_TUNING = {
  /** Cloud burst price = cheapest GPU's rent per PFLOP/s-day x this (x any rent shock from events). */
  BURST_PREMIUM: 1.5,
  /** Balanced priority: serving may use at most this share of own GPUs while a training run is active. */
  BALANCED_SERVING_CAP: 0.5,
};
const SECONDS_PER_DAY = 86_400;

export function gpuById(id: string): GpuDef | undefined {
  return GPUS.find((g) => g.id === id);
}
export function datacenterTierById(id: string): DatacenterTier | undefined {
  return DATACENTER_TIERS.find((t) => t.id === id);
}
function isFinished(dc: Datacenter): boolean {
  return dc.buildDaysLeft <= 0;
}
function installedCount(dc: Datacenter): number {
  let n = 0;
  for (const c of Object.values(dc.gpus)) n += c;
  return n;
}
export function rentMultiplier(s: GameState): number {
  const m = s.flags['rentMult'];
  return m === undefined ? 1 : m;
}
/** Power bill per day for one datacenter (GPU kW x 24h x price per kWh). */
function powerPerDay(dc: Datacenter): number {
  const tier = datacenterTierById(dc.tierId);
  if (!tier) return 0;
  let kw = 0;
  for (const [gid, n] of Object.entries(dc.gpus)) kw += n * (gpuById(gid)?.powerKw ?? 0);
  return kw * COMPUTE_TUNING.HOURS_PER_DAY * tier.powerPricePerKwh;
}
/** Power bill per day for every finished datacenter. Booked under `power` whether the GPUs serve or train. */
export function installedPowerPerDay(s: GameState): number {
  let p = 0;
  for (const dc of s.compute.datacenters) if (isFinished(dc)) p += powerPerDay(dc);
  return p;
}

/**
 * Largest number of GPUs one training run can use efficiently, by the best infra research owned (GAME_DESIGN 13.1).
 * Beyond it, extra GPUs add only CLUSTER_BEYOND_CAP_SHARE of their PFLOPS.
 */
export const CLUSTER_TIERS: [Id, number][] = [
  ['base', 256],
  ['zero_sharding', 2_048],
  ['tensor_parallel', 16_000],
  ['pipeline_parallel', 64_000],
  ['parallelism_3d', 500_000],
  ['cross_dc_training', Infinity],
];
export const CLUSTER_BEYOND_CAP_SHARE = 0.15;

export interface ClusterEfficiency {
  /** Largest efficient training cluster size (Infinity with cross_dc_training). */
  maxEfficientGpus: number;
  /** GPUs the training share is spread over. */
  usedGpus: number;
  /** Effective share of the training GPUs' PFLOPS, 0..1. */
  efficiency: number;
}

function clusterFor(s: GameState, usedGpus: number): ClusterEfficiency {
  let maxEfficientGpus = CLUSTER_TIERS[0][1];
  for (const [id, cap] of CLUSTER_TIERS) if (isResearched(s, id)) maxEfficientGpus = Math.max(maxEfficientGpus, cap);
  let efficiency = 1;
  if (usedGpus > maxEfficientGpus) {
    efficiency = (maxEfficientGpus + CLUSTER_BEYOND_CAP_SHARE * (usedGpus - maxEfficientGpus)) / usedGpus;
  }
  return { maxEfficientGpus, usedGpus, efficiency };
}

// ---------------------------------------------------------------------------
// Own fleet, priority and the split
// ---------------------------------------------------------------------------

/** Own GPUs: rented in the cloud plus installed in finished datacenters. */
export function ownGpuCount(s: GameState): number {
  let gpus = 0;
  for (const n of Object.values(s.compute.rented)) gpus += n;
  for (const dc of s.compute.datacenters) if (isFinished(dc)) gpus += installedCount(dc);
  return gpus;
}

/** Own PFLOP/s: rented plus installed in finished datacenters. */
export function ownPflops(s: GameState): number {
  let rented = 0;
  for (const [gid, n] of Object.entries(s.compute.rented)) rented += n * (gpuById(gid)?.pflops ?? 0);
  let installed = 0;
  for (const dc of s.compute.datacenters) {
    if (!isFinished(dc)) continue;
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
    const per = mtokPerPflopDay(s, m);
    if (per > 0) need += p.mtokPerDay / per;
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
  // Power is paid for the whole installed fleet either way; each own PFLOP/s carries an equal share of it.
  const powerRate = n.total > 0 ? installedPowerPerDay(s) / n.total : 0;
  const slices: ServingSlice[] = [];
  for (const p of s.products) {
    if (!p.active) continue;
    const m = modelOf(s, p.modelId);
    const per = m ? mtokPerPflopDay(s, m) : 0;
    const need = per > 0 ? p.mtokPerDay / per : 0;
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

/** GPUs the player can rent or buy this year. */
export function availableGpus(s: GameState): GpuDef[] {
  const year = calendarYear(s.day);
  return GPUS.filter((g) => year >= g.unlockYear);
}

/** Datacenter tiers whose year and research gates are open. */
export function availableDatacenterTiers(s: GameState): DatacenterTier[] {
  const year = calendarYear(s.day);
  return DATACENTER_TIERS.filter(
    (t) => year >= t.unlockYear && (!t.requiresResearch || isResearched(s, t.requiresResearch)),
  );
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

/**
 * Daily compute cost breakdown preview. Power and upkeep are reported separately; computeTick books both under `power`.
 * Burst is not included: the serving tick books it under `serving`.
 */
export function dailyComputeCost(s: GameState): { rent: number; power: number; upkeep: number } {
  let rent = 0;
  for (const [gid, n] of Object.entries(s.compute.rented)) rent += n * (gpuById(gid)?.rentPerDay ?? 0);
  rent *= rentMultiplier(s);
  let power = 0;
  let upkeep = 0;
  for (const dc of s.compute.datacenters) {
    if (!isFinished(dc)) continue;
    power += powerPerDay(dc);
    upkeep += datacenterTierById(dc.tierId)?.upkeepPerDay ?? 0;
  }
  return { rent, power, upkeep };
}

export function computeTick(s: GameState, _rng: Rng): void {
  // Construction countdown
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft <= 0) continue;
    dc.buildDaysLeft -= 1;
    if (dc.buildDaysLeft <= 0) {
      dc.buildDaysLeft = 0;
      const slots = datacenterTierById(dc.tierId)?.maxGpus ?? 0;
      notify(s, `${dc.name} is online with ${slots.toLocaleString('en-US')} GPU slots.`, 'good');
      pushNews(s, `${s.company.name} brings ${dc.name} online.`, 'good');
    }
  }

  // Derived capacity for this day (the serving tick refreshes it again after the products have their demand)
  const cap = computeCapacity(s);
  s.compute.totalPflops = cap.total;
  s.compute.trainingPflops = cap.training;
  s.compute.inferencePflops = cap.inference;

  // Daily bills
  const cost = dailyComputeCost(s);
  addExpense(s, 'compute', cost.rent);
  addExpense(s, 'power', cost.power + cost.upkeep);
}

export const handlers: ActionHandlers = {
  rentGpus: (s, a) => {
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count === 0 || Math.abs(a.count) > COMPUTE_TUNING.MAX_GPU_ORDER) {
      notify(s, 'Rent a whole number of GPUs (negative to give them back).', 'bad');
      return;
    }
    if (calendarYear(s.day) < gpu.unlockYear) {
      notify(s, `${gpu.name} is not available until ${gpu.unlockYear}.`, 'bad');
      return;
    }
    const have = s.compute.rented[gpu.id] ?? 0;
    if (a.count > 0) {
      const perDay = a.count * gpu.rentPerDay * rentMultiplier(s);
      if (s.finance.cash < perDay) {
        notify(s, `Need ${formatMoney(perDay)} to cover a day of rent on ${a.count} × ${gpu.name}.`, 'bad');
        return;
      }
      s.compute.rented[gpu.id] = have + a.count;
      notify(s, `Rented ${a.count} × ${gpu.name} (${formatMoney(perDay)}/day).`, 'good');
      return;
    }
    const back = Math.min(-a.count, have);
    if (back === 0) {
      notify(s, `You have no ${gpu.name} rentals to return.`, 'bad');
      return;
    }
    const left = have - back;
    if (left > 0) s.compute.rented[gpu.id] = left;
    else delete s.compute.rented[gpu.id];
    notify(s, `Returned ${back} × ${gpu.name} to the cloud.`, 'info');
  },

  buildDatacenter: (s, a) => {
    const tier = datacenterTierById(a.tierId);
    if (!tier) {
      notify(s, 'Unknown datacenter tier.', 'bad');
      return;
    }
    if (calendarYear(s.day) < tier.unlockYear) {
      notify(s, `${tier.name} is not available until ${tier.unlockYear}.`, 'bad');
      return;
    }
    if (tier.requiresResearch && !isResearched(s, tier.requiresResearch)) {
      const node = RESEARCH.find((r) => r.id === tier.requiresResearch);
      notify(s, `${tier.name} needs research: ${node?.name ?? tier.requiresResearch}.`, 'bad');
      return;
    }
    const name = a.name.trim().slice(0, 32) || `${tier.name} #${s.compute.datacenters.length + 1}`;
    if (!trySpend(s, 'capex', tier.buildCost, tier.name)) return;
    const dc: Datacenter = { id: newId(s, 'dc'), name, tierId: tier.id, gpus: {}, buildDaysLeft: tier.buildDays };
    s.compute.datacenters.push(dc);
    notify(s, `Breaking ground on ${name}: ready in ${tier.buildDays} days.`, 'good');
  },

  buyGpus: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    if (!isFinished(dc)) {
      notify(s, `${dc.name} is still under construction.`, 'bad');
      return;
    }
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    if (calendarYear(s.day) < gpu.unlockYear) {
      notify(s, `${gpu.name} is not available until ${gpu.unlockYear}.`, 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count < 1) {
      notify(s, 'Buy at least one GPU.', 'bad');
      return;
    }
    const tier = datacenterTierById(dc.tierId);
    const free = (tier?.maxGpus ?? 0) - installedCount(dc);
    if (a.count > free) {
      notify(s, `Only ${Math.max(0, free).toLocaleString('en-US')} free slot${free === 1 ? '' : 's'} in ${dc.name}.`, 'bad');
      return;
    }
    if (!trySpend(s, 'capex', a.count * gpu.buyPrice, `${a.count} × ${gpu.name}`)) return;
    dc.gpus[gpu.id] = (dc.gpus[gpu.id] ?? 0) + a.count;
    notify(s, `Installed ${a.count} × ${gpu.name} in ${dc.name}.`, 'good');
  },

  sellGpus: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    const have = dc.gpus[gpu.id] ?? 0;
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > have) {
      notify(s, `${dc.name} only has ${have} × ${gpu.name} to sell.`, 'bad');
      return;
    }
    const refund = a.count * gpu.buyPrice * COMPUTE_TUNING.SELL_REFUND;
    addRevenue(s, 'other', refund);
    const left = have - a.count;
    if (left > 0) dc.gpus[gpu.id] = left;
    else delete dc.gpus[gpu.id];
    notify(s, `Sold ${a.count} × ${gpu.name} for ${formatMoney(refund)}.`, 'info');
  },

  // Legacy action: maps the share to the nearest fleet priority (v10).
  setTrainingShare: (s, a) => {
    if (!Number.isFinite(a.share)) return;
    applyPriority(s, priorityFromShare(clamp(a.share, 0, 1)));
  },
};
