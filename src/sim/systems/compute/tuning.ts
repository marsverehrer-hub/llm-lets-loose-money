// Tuning constants (COMPUTE_TUNING, SERVING_TUNING, cluster and fabric tables) and the PUE readers that use them.
import type { Datacenter, Id, Interconnect } from '../../types';

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
  /**
   * v16 (GAME_DESIGN §26.3): datacenter upgrades, priced as a share of the tier's build cost. Liquid cooling multiplies
   * the PUE and the failure rate; InfiniBand matters to neocloud customers (systems/neocloud.ts).
   */
  LIQUID_COST_SHARE: 0.3,
  LIQUID_PUE_MULT: 0.85,
  LIQUID_FAIL_MULT: 0.75,
  INFINIBAND_COST_SHARE: 0.25,
  /** v19: fabric upgrades (interconnect), priced as a share of the tier's build cost; NVLink from 2018, InfiniBand from 2019. */
  NVLINK_COST_SHARE: 0.1,
  NVLINK_YEAR: 2018,
  INFINIBAND_YEAR: 2019,
  /** v19: failure-rate growth per decade of training GPUs beyond 1 000 (clusterFailureMult). */
  CLUSTER_FAILURE_PER_DECADE: 0.15,
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

export const SECONDS_PER_DAY = 86_400;

/** v16: PUE of one datacenter: its tier's, lowered by liquid cooling. */
export function datacenterPue(dc: Datacenter): number {
  return pueOf(dc.tierId) * (dc.liquid ? COMPUTE_TUNING.LIQUID_PUE_MULT : 1);
}

/** v19: training clusters a fabric can hold efficiently. pcie is a 64-GPU box; InfiniBand is no limit. */
export const INTERCONNECT_CLUSTER_CAP: Record<Interconnect, number> = { pcie: 64, nvlink: 2_048, infiniband: Infinity };
export const INTERCONNECT_RANK: Record<Interconnect, number> = { pcie: 0, nvlink: 1, infiniband: 2 };
export const INTERCONNECT_COST_SHARE: Record<Interconnect, number> = {
  pcie: 0,
  nvlink: COMPUTE_TUNING.NVLINK_COST_SHARE,
  infiniband: COMPUTE_TUNING.INFINIBAND_COST_SHARE,
};

/** v14: power usage effectiveness of a datacenter tier (cooling and power delivery on top of the GPUs' own draw). */
export function pueOf(tierId: string): number {
  return COMPUTE_TUNING.PUE[tierId] ?? 1.4;
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
