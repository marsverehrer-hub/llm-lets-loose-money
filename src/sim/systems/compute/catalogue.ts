// Catalogue readers: GPU and datacenter-tier lookups, the rent multiplier, and what is on offer this year.
import { GPUS, DATACENTER_TIERS } from '../../data/gpus';
import { chipReady } from '../chipRnd'; // v19 own silicon
import { isResearched } from '../research';
import { calendarYear } from '../../util';
import type { DatacenterTier, GameState, GpuDef } from '../../types';

export function gpuById(id: string): GpuDef | undefined {
  return GPUS.find((g) => g.id === id);
}
export function datacenterTierById(id: string): DatacenterTier | undefined {
  return DATACENTER_TIERS.find((t) => t.id === id);
}

export function rentMultiplier(s: GameState): number {
  const m = s.flags['rentMult'];
  return m === undefined ? 1 : m;
}

/** GPUs the player can rent or buy this year. */
export function availableGpus(s: GameState): GpuDef[] {
  const year = calendarYear(s.day);
  // v19: custom silicon is on offer only once your own programme has produced it.
  return GPUS.filter((g) => (g.class === 'custom' ? chipReady(s, g.id) : year >= g.unlockYear));
}

/** Datacenter tiers whose year and research gates are open. */
export function availableDatacenterTiers(s: GameState): DatacenterTier[] {
  const year = calendarYear(s.day);
  return DATACENTER_TIERS.filter(
    (t) => year >= t.unlockYear && (!t.requiresResearch || isResearched(s, t.requiresResearch)),
  );
}
