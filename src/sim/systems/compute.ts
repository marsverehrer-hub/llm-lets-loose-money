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
import { productPflopsNeed } from './modelLife'; // v15 routers

export interface Capacity { total: number; training: number; inference: number }

export const COMPUTE_TUNING = {
  /** Fraction of buy price returned when selling a brand-new GPU. v14: it shrinks with age (RESALE_DECAY). */
  SELL_REFUND: 0.4,
  /** v14: resale value multiplier per year of age, and the floor (scrap value) as a share of the buy price. */
  RESALE_DECAY: 0.65,
  RESALE_FLOOR: 0.03,
  /**
   * v14 (GAME_DESIGN §24): owning GPUs is not free after the purchase. Cooling and power delivery multiply the power
   * bill by the tier's PUE, and maintenance contracts, networking, spares and on-call cost OPS_RATE_PER_YEAR of the
   * buy price every year (booked under `hardware`).
   */
  PUE: { closet: 1.6, colo: 1.4, hyperscale: 1.25, cathedral: 1.12 } as Record<string, number>,
  OPS_RATE_PER_YEAR: 0.16,
  /** v14: annual failure rate of an installed GPU = FAIL_BASE + FAIL_PER_YEAR × age in years, capped at FAIL_MAX. */
  FAIL_BASE: 0.03,
  FAIL_PER_YEAR: 0.045,
  FAIL_MAX: 0.4,
  /** Failures are reported at most once per this many days. */
  FAIL_NOTICE_DAYS: 30,
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
/** v14: power usage effectiveness of a datacenter tier (cooling and power delivery on top of the GPUs' own draw). */
export function pueOf(tierId: string): number {
  return COMPUTE_TUNING.PUE[tierId] ?? 1.4;
}
/** Power bill per day for one datacenter (GPU kW x PUE x 24h x price per kWh). */
function powerPerDay(dc: Datacenter): number {
  const tier = datacenterTierById(dc.tierId);
  if (!tier) return 0;
  let kw = 0;
  for (const [gid, n] of Object.entries(dc.gpus)) kw += n * (gpuById(gid)?.powerKw ?? 0);
  return kw * pueOf(tier.id) * COMPUTE_TUNING.HOURS_PER_DAY * tier.powerPricePerKwh;
}
/** v14: hardware operations per day for one datacenter: maintenance, networking, spares and on-call per installed GPU. */
function hardwarePerDay(dc: Datacenter): number {
  let capex = 0;
  for (const [gid, n] of Object.entries(dc.gpus)) capex += n * (gpuById(gid)?.buyPrice ?? 0);
  return (capex * COMPUTE_TUNING.OPS_RATE_PER_YEAR) / 365;
}
/** Power bill per day for every finished datacenter. Booked under `power` whether the GPUs serve or train. */
export function installedPowerPerDay(s: GameState): number {
  let p = 0;
  for (const dc of s.compute.datacenters) if (isFinished(dc)) p += powerPerDay(dc);
  return p;
}
/** v14: everything an installed fleet costs per day while it runs (power with cooling, plus hardware operations). */
export function installedRunningCostPerDay(s: GameState): number {
  let p = 0;
  for (const dc of s.compute.datacenters) if (isFinished(dc)) p += powerPerDay(dc) + hardwarePerDay(dc);
  return p;
}

/** v14: what one installed GPU costs per day to run in a datacenter tier (power with cooling plus hardware ops). */
export function ownedCostPerGpuDay(gpu: GpuDef, tierId: string): number {
  const tier = datacenterTierById(tierId);
  const power = tier ? gpu.powerKw * pueOf(tier.id) * COMPUTE_TUNING.HOURS_PER_DAY * tier.powerPricePerKwh : 0;
  return power + (gpu.buyPrice * COMPUTE_TUNING.OPS_RATE_PER_YEAR) / 365;
}

/** v14: age in years of the GPUs of one model in a datacenter (their count-weighted purchase day). */
export function gpuAgeYears(s: GameState, dc: Datacenter, gpuId: string): number {
  const day = dc.bought?.[gpuId];
  return day === undefined ? 0 : Math.max(0, (s.day - day) / 365);
}
/** v14: annual failure rate for a GPU of this age. */
export function annualFailureRate(ageYears: number): number {
  const T = COMPUTE_TUNING;
  return Math.min(T.FAIL_MAX, T.FAIL_BASE + T.FAIL_PER_YEAR * Math.max(0, ageYears));
}
/** v14: share of the buy price a GPU of this age sells for. */
export function resaleFraction(ageYears: number): number {
  const T = COMPUTE_TUNING;
  return Math.max(T.RESALE_FLOOR, T.SELL_REFUND * T.RESALE_DECAY ** Math.max(0, ageYears));
}

/**
 * v14: GPUs wear out. Each day every installed GPU model loses count × rate(age)/365 GPUs, carried as a fraction
 * until a whole GPU fails. Deterministic (no random draws), so seeded games stay the same everywhere else.
 */
function wearTick(s: GameState): void {
  let failed = 0;
  const names = new Map<string, number>();
  for (const dc of s.compute.datacenters) {
    if (!isFinished(dc)) continue;
    for (const [gid, n] of Object.entries(dc.gpus)) {
      if (n <= 0) continue;
      dc.bought ??= {};
      dc.bought[gid] ??= s.day; // old saves: count the fleet as new
      dc.wear ??= {};
      const w = (dc.wear[gid] ?? 0) + (n * annualFailureRate(gpuAgeYears(s, dc, gid))) / 365;
      const k = Math.min(n, Math.floor(w));
      dc.wear[gid] = w - k;
      if (k <= 0) continue;
      const left = n - k;
      if (left > 0) dc.gpus[gid] = left;
      else {
        delete dc.gpus[gid];
        delete dc.bought[gid];
        delete dc.wear[gid];
      }
      failed += k;
      const name = gpuById(gid)?.name ?? gid;
      names.set(name, (names.get(name) ?? 0) + k);
    }
  }
  if (failed === 0) return;
  const KEY = 'gpuFailedSinceNotice';
  s.flags[KEY] = (s.flags[KEY] ?? 0) + failed;
  s.flags['stat.gpusFailed'] = (s.flags['stat.gpusFailed'] ?? 0) + failed;
  const last = s.flags['gpuFailNoticeDay'] ?? -Infinity;
  if (s.day - last >= COMPUTE_TUNING.FAIL_NOTICE_DAYS) {
    const total = s.flags[KEY];
    const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    notify(s, `Hardware: ${total.toLocaleString('en-US')} GPU${total === 1 ? '' : 's'} failed since the last report${top ? `, mostly ${top}` : ''}. Old GPUs fail more often; replace them in Compute.`, 'bad');
    s.flags[KEY] = 0;
    s.flags['gpuFailNoticeDay'] = s.day;
  }
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
export function dailyComputeCost(s: GameState): { rent: number; power: number; upkeep: number; hardware: number } {
  let rent = 0;
  for (const [gid, n] of Object.entries(s.compute.rented)) rent += n * (gpuById(gid)?.rentPerDay ?? 0);
  rent *= rentMultiplier(s);
  let power = 0;
  let upkeep = 0;
  let hardware = 0;
  for (const dc of s.compute.datacenters) {
    if (!isFinished(dc)) continue;
    power += powerPerDay(dc);
    upkeep += datacenterTierById(dc.tierId)?.upkeepPerDay ?? 0;
    hardware += hardwarePerDay(dc);
  }
  return { rent, power, upkeep, hardware };
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
  addExpense(s, 'hardware', cost.hardware); // v14
  wearTick(s); // v14: GPUs fail more as they age
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
    // v14: track the batch's age as a count-weighted average purchase day.
    const had = dc.gpus[gpu.id] ?? 0;
    dc.bought ??= {};
    const prevDay = dc.bought[gpu.id] ?? s.day;
    dc.bought[gpu.id] = (prevDay * had + s.day * a.count) / (had + a.count);
    dc.gpus[gpu.id] = had + a.count;
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
    const refund = a.count * gpu.buyPrice * resaleFraction(gpuAgeYears(s, dc, gpu.id));
    addRevenue(s, 'other', refund);
    const left = have - a.count;
    if (left > 0) dc.gpus[gpu.id] = left;
    else {
      delete dc.gpus[gpu.id];
      if (dc.bought) delete dc.bought[gpu.id];
      if (dc.wear) delete dc.wear[gpu.id];
    }
    notify(s, `Sold ${a.count} × ${gpu.name} for ${formatMoney(refund)}.`, 'info');
  },

  // Legacy action: maps the share to the nearest fleet priority (v10).
  setTrainingShare: (s, a) => {
    if (!Number.isFinite(a.share)) return;
    applyPriority(s, priorityFromShare(clamp(a.share, 0, 1)));
  },
};
