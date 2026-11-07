// v19: the tiny-studio path. Tracks the most GPUs the lab has ever held (owned, legacy rented and cloud) and whether
// the last training run used consumer cards only. Feeds the Garage Prodigy, Indie Darling and Consumer Grade
// achievements (data/achievements.ts). Package D2.
import type { GameState, Model } from '../types';
import { cloudGpusByType } from './cloudMarket';
import { trainingFleet } from './hwFormats';
import { bestResults } from './capabilities';

export const STUDIO_TUNING = {
  /** Garage Prodigy: at most this many GPUs ever held. */
  GARAGE_GPUS: 16,
  /** Indie Darling: at most this many GPUs ever held. */
  INDIE_GPUS: 32,
  /** Indie Darling: a product with at least this many users. */
  INDIE_USERS: 10_000,
  /** Garage Prodigy: each benchmark score is at least this share of the current best on it. */
  BENCH_SHARE: 0.8,
};

/** GPUs the lab holds right now: every datacenter, the legacy rented pool and the cloud leases. */
export function gpusHeld(s: GameState): number {
  let n = 0;
  for (const dc of s.compute.datacenters) for (const k of Object.values(dc.gpus)) n += k;
  for (const k of Object.values(cloudGpusByType(s))) n += k;
  return n;
}

/** True if a training run is on and every GPU it runs on is a consumer card (no run means false). */
function consumerOnlyRun(s: GameState): boolean {
  if (!s.training) return false;
  const fleet = trainingFleet(s).filter((f) => f.k > 0);
  return fleet.length > 0 && fleet.every((f) => f.g?.class === 'consumer');
}

export function studioTick(s: GameState): void {
  s.flags.peakGpusEver = Math.max(s.flags.peakGpusEver ?? 0, gpusHeld(s));
  if (s.training) s.flags['studio.consumerRun'] = consumerOnlyRun(s) ? 1 : 0;
  // A model that appeared since the last tick was trained on the run that was going, so it takes that run's hardware.
  const seen = s.flags['studio.models'];
  if (seen === undefined) s.flags['studio.models'] = s.models.length; // old saves: existing models do not count
  else if (s.models.length > seen) {
    if (s.flags['studio.consumerRun'] === 1) s.flags.consumerGrade = 1;
    s.flags['studio.models'] = s.models.length;
  }
}

/**
 * Garage Prodigy: a released model of ours scores at least BENCH_SHARE of the current best on every benchmark it has,
 * while the lab has never held more than GARAGE_GPUS GPUs. Current SOTA, not the SOTA of the release day, on purpose.
 */
export function garageProdigy(s: GameState): boolean {
  if ((s.flags.peakGpusEver ?? 0) > STUDIO_TUNING.GARAGE_GPUS) return false;
  return s.models.some((m: Model) => {
    if (m.releasedDay === null || m.deprecated) return false;
    const scores = Object.entries(m.benchmarks ?? {});
    if (scores.length === 0) return false;
    return scores.every(([benchId, score]) => {
      const best = bestResults(s, benchId)[0];
      return !best || score >= STUDIO_TUNING.BENCH_SHARE * best.score;
    });
  });
}
