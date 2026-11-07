// Power and running cost: the power bill, hardware operations and upkeep, per hall and for the whole fleet.
import { SITES } from '../../data/sites'; // v19 sites
import { cloudLeaseRentPerDay } from '../cloudMarket'; // v16 cloud market
import { COMPUTE_TUNING, datacenterPue, pueOf } from './tuning';
import { datacenterTierById, gpuById, rentMultiplier } from './catalogue';
import { isFinished, siteOf } from './sites';
import type { Datacenter, GameState, GpuDef } from '../../types';

/** Power bill per day for one datacenter (GPU kW x PUE x 24h x price per kWh). */
function powerPerDay(dc: Datacenter): number {
  const tier = datacenterTierById(dc.tierId);
  if (!tier) return 0;
  let kw = 0;
  for (const [gid, n] of Object.entries(dc.gpus)) kw += n * (gpuById(gid)?.powerKw ?? 0);
  return kw * datacenterPue(dc) * COMPUTE_TUNING.HOURS_PER_DAY * tier.powerPricePerKwh * SITES[siteOf(dc)].powerPriceMult;
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

/** v16: everything one finished datacenter costs per day: power with cooling, hardware operations and upkeep. */
export function datacenterRunningCostPerDay(dc: Datacenter): number {
  if (!isFinished(dc)) return 0;
  return powerPerDay(dc) + hardwarePerDay(dc) + (datacenterTierById(dc.tierId)?.upkeepPerDay ?? 0);
}

/** v14: what one installed GPU costs per day to run in a datacenter tier (power with cooling plus hardware ops). */
export function ownedCostPerGpuDay(gpu: GpuDef, tierId: string): number {
  const tier = datacenterTierById(tierId);
  const power = tier ? gpu.powerKw * pueOf(tier.id) * COMPUTE_TUNING.HOURS_PER_DAY * tier.powerPricePerKwh : 0;
  return power + (gpu.buyPrice * COMPUTE_TUNING.OPS_RATE_PER_YEAR) / 365;
}

/**
 * Daily compute cost breakdown preview. Power and upkeep are reported separately; computeTick books both under `power`.
 * Burst is not included: the serving tick books it under `serving`.
 */
export function dailyComputeCost(s: GameState): { rent: number; power: number; upkeep: number; hardware: number } {
  let rent = 0;
  for (const [gid, n] of Object.entries(s.compute.rented)) rent += n * (gpuById(gid)?.rentPerDay ?? 0);
  rent *= rentMultiplier(s);
  rent += cloudLeaseRentPerDay(s); // v16: other providers, reserved and spot (prices already carry the rent shock)
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
