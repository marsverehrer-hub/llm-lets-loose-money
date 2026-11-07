// Training clusters: the largest efficient cluster a run can use (research and fabric), and the size-efficiency curve.
import { CLUSTER_BEYOND_CAP_SHARE, CLUSTER_TIERS } from './tuning';
import { fabricClusterCap } from './sites';
import { isResearched } from '../research';
import type { GameState } from '../../types';

export interface ClusterEfficiency {
  /** Largest efficient training cluster size (Infinity with cross_dc_training). */
  maxEfficientGpus: number;
  /** GPUs the training share is spread over. */
  usedGpus: number;
  /** Effective share of the training GPUs' PFLOPS, 0..1. */
  efficiency: number;
}

export function clusterFor(s: GameState, usedGpus: number): ClusterEfficiency {
  let researchCap = CLUSTER_TIERS[0][1];
  for (const [id, cap] of CLUSTER_TIERS) if (isResearched(s, id)) researchCap = Math.max(researchCap, cap);
  // v19: the fabric caps the cluster too (pcie 64, nvlink 2 048, InfiniBand none).
  const maxEfficientGpus = Math.min(researchCap, fabricClusterCap(s));
  let efficiency = 1;
  if (usedGpus > maxEfficientGpus) {
    efficiency = (maxEfficientGpus + CLUSTER_BEYOND_CAP_SHARE * (usedGpus - maxEfficientGpus)) / usedGpus;
  }
  return { maxEfficientGpus, usedGpus, efficiency };
}
