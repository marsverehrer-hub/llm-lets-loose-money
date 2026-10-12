// Compute UI helpers: the fleet picture the screen draws, made safe to show before the serving system has run.
import type { FleetBreakdown, FleetPriority, GameState, ServingSlice } from '../../../sim/types';
import { fleetBreakdown, previewFleet } from '../../../sim/systems/serving';

/** Own GPUs: installed in finished datacenters, plus cloud rentals. Under-construction sites hold none. */
export function ownGpuCount(s: GameState): number {
  let n = 0;
  for (const v of Object.values(s.compute.rented)) n += v ?? 0;
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft > 0) continue;
    for (const v of Object.values(dc.gpus)) n += v ?? 0;
  }
  return n;
}

/**
 * Makes a fleet breakdown safe to draw. When the serving system has not reported GPU counts yet (zeros, or an
 * older save), the old training share fills in the split. Otherwise the breakdown is returned unchanged.
 */
export function normaliseFleet(s: GameState, fb: FleetBreakdown): FleetBreakdown {
  const own = ownGpuCount(s);
  if (fb.totalGpus > 0 || own === 0) return fb;
  const share = Math.min(1, Math.max(0, s.compute.trainingShare || 0));
  const training = s.training ? Math.round(own * share) : 0;
  const fallbackSlices: ServingSlice[] = s.products
    .filter((p) => p.active)
    .map((p) => ({ productId: p.id, ownPflops: 1, burstPflops: 0, mtokPerDay: p.mtokPerDay, burstCostPerDay: 0, ownCostPerDay: 0 }));
  return {
    ...fb,
    totalGpus: own,
    trainingGpus: training,
    servingGpus: own - training,
    idleGpus: 0,
    slices: fb.slices.length > 0 ? fb.slices : fallbackSlices,
  };
}

/** Today's fleet, safe to draw. */
export function fleetNow(s: GameState): FleetBreakdown {
  return normaliseFleet(s, fleetBreakdown(s));
}

/** The fleet if the priority were `p`, safe to draw. */
export function fleetPreview(s: GameState, p: FleetPriority): FleetBreakdown {
  return normaliseFleet(s, previewFleet(s, p));
}
