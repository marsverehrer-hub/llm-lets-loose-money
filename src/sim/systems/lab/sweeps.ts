// Learning-rate sweeps: quotes, the running-sweep check and the sweep history per architecture.

import type { GameState, Id, SweepPoint, TrainingConfig } from '../../types';
import { availableGpus } from '../compute';
import { resolveRun } from '../trainingMath';
import { LAB_TUNING } from './tuning';

// ---------------------------------------------------------------------------
// Learning-rate sweeps (belief side in trainingMath)
// ---------------------------------------------------------------------------

/** Known sweep points for an architecture (all scales), oldest first. */
export function sweepPointsFor(s: GameState, arch: Id): SweepPoint[] {
  return [...(s.lab?.sweeps?.[arch] ?? [])];
}

/** Cheapest cloud $ per FLOP among GPUs on sale now, with the rent market multiplier. */
export function cloudCostPerFlop(s: GameState): number {
  const rentMult = s.flags['rentMult'] ?? 1;
  let best = Infinity;
  for (const g of availableGpus(s)) best = Math.min(best, g.rentPerDay / (g.pflops * 1e15 * 86_400));
  return best * rentMult;
}

export function sweepQuote(s: GameState, paramsB: number, tokensB: number, datasetIds: Id[], config: TrainingConfig, lrs: number[]): { cost: number; days: number } {
  const count = lrs.length;
  if (count === 0) return { cost: 0, days: 0 };
  const phys = resolveRun(s, paramsB, tokensB, datasetIds, [], config, 'belief');
  const perLr = Math.max(LAB_TUNING.SWEEP_MIN_COST, LAB_TUNING.SWEEP_FRACTION * phys.totalFlops * cloudCostPerFlop(s));
  const cost = Number.isFinite(perLr) ? Math.round(count * perLr) : Infinity;
  return { cost, days: LAB_TUNING.SWEEP_DAYS };
}

/** True if a sweep for this arch is running right now. */
export function sweepRunning(s: GameState, arch: Id): boolean {
  return (s.lab?.sweepJobs ?? []).some((j) => j.arch === arch);
}
