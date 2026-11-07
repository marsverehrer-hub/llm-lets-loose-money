// Sites and halls: interconnect fabric, site gates, megawatt caps, grid outages and the finished-hall helpers.
import { SITES, DEFAULT_SITE } from '../../data/sites'; // v19 sites
import { calendarYear } from '../../util';
import { isResearched } from '../research';
import { datacenterPue, INTERCONNECT_CLUSTER_CAP } from './tuning';
import { gpuById } from './catalogue';
import type { Datacenter, GameState, GpuDef, Interconnect, SiteId } from '../../types';

export function isFinished(dc: Datacenter): boolean {
  return dc.buildDaysLeft <= 0;
}

/** v16: a finished datacenter that works for the lab (a hall dedicated to the neocloud is sold to customers instead). */
export function inFleet(s: GameState, dc: Datacenter): boolean {
  return isFinished(dc) && !s.neocloud?.dedicated?.includes(dc.id);
}

export function installedCount(dc: Datacenter): number {
  let n = 0;
  for (const c of Object.values(dc.gpus)) n += c;
  return n;
}

/** v19: a hall's fabric. Old saves: InfiniBand when that upgrade is on, otherwise PCIe. */
export function interconnectOf(dc: Datacenter): Interconnect {
  if (dc.infiniband) return 'infiniband';
  return dc.interconnect ?? 'pcie';
}

/**
 * v19: the fabric cap on one training cluster, from the finished hall holding the most installed GPUs. No such hall
 * (cloud only) assumes InfiniBand.
 * shortcut: a run is capped by its biggest hall alone, not spread over halls; upgrade with cross-hall training.
 */
export function fabricClusterCap(s: GameState): number {
  let best: Datacenter | undefined;
  for (const dc of s.compute.datacenters) {
    if (!isFinished(dc) || installedCount(dc) <= 0) continue;
    if (!best || installedCount(dc) > installedCount(best)) best = dc;
  }
  return best ? INTERCONNECT_CLUSTER_CAP[interconnectOf(best)] : Infinity;
}

/** v19: the site a hall was built on (old saves: grid). */
export function siteOf(dc: Datacenter): SiteId {
  return dc.site ?? DEFAULT_SITE;
}

/** v19: a site's research and year gates are open. */
export function siteOpen(s: GameState, site: SiteId): boolean {
  const def = SITES[site];
  return calendarYear(s.day) >= def.unlockYear && (!def.requiresResearch || isResearched(s, def.requiresResearch));
}

/** v19: megawatts a hall draws: installed GPUs x kW x PUE. */
export function hallMegawatts(dc: Datacenter): number {
  let kw = 0;
  for (const [gid, n] of Object.entries(dc.gpus)) kw += n * (gpuById(gid)?.powerKw ?? 0);
  return (kw * datacenterPue(dc)) / 1000;
}

/** v19: megawatts a hall may still draw under its site's cap (0 when full). Buying GPUs past it is refused. */
export function siteMwLeft(_s: GameState, dc: Datacenter): number {
  return Math.max(0, SITES[siteOf(dc)].mwCap - hallMegawatts(dc));
}

/** v19: how many of `gpu` still fit under the hall's site megawatt cap. Every way in (buy, used, pre-order) checks it. */
export function gpusThatFitMw(s: GameState, dc: Datacenter, gpu: GpuDef): number {
  const perGpuMw = (gpu.powerKw * datacenterPue(dc)) / 1000;
  return perGpuMw > 0 ? Math.floor(siteMwLeft(s, dc) / perGpuMw + 1e-9) : Infinity;
}

/** v19: a hall dark from a grid outage: its GPUs serve and train nothing until the day passes. */
export function hallOffline(s: GameState, dc: Datacenter): boolean {
  return s.day < (s.flags[`outage.${dc.id}`] ?? 0);
}
