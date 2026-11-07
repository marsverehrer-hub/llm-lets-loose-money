// Public surface of the compute system: re-exports the names the old systems/compute.ts exported, so importers keep working.
// OWNER: Agent A. GPUs, cloud rental, datacenters, power, capacity split.
// v10 (GAME_DESIGN §21.1): the fleet split lives here, next to the capacity readers, so compute and serving share one
// set of numbers. Own GPUs serve products first; demand they cannot cover is bought from the cloud as burst capacity.
export { COMPUTE_TUNING, SERVING_TUNING, datacenterPue, pueOf, INTERCONNECT_CLUSTER_CAP, CLUSTER_TIERS, CLUSTER_BEYOND_CAP_SHARE } from './tuning';
export { gpuById, datacenterTierById, rentMultiplier, availableGpus, availableDatacenterTiers } from './catalogue';
export { interconnectOf, fabricClusterCap, siteOf, siteOpen, hallMegawatts, siteMwLeft, gpusThatFitMw, hallOffline } from './sites';
export { installedPowerPerDay, installedRunningCostPerDay, datacenterRunningCostPerDay, ownedCostPerGpuDay, dailyComputeCost } from './power';
export { gpuAgeYears, annualFailureRate, resaleFraction } from './wear';
export type { ClusterEfficiency } from './clusters';
export type { Capacity, FleetNumbers } from './fleet';
export { ownGpuCount, ownPflops, priorityOf, runActive, priorityFromShare, offeredPflops, mtokPerPflopDay, servingDemandPflops, fleetNumbers, clusterFailureMult, clusterEfficiency, computeCapacity, burstPricePerPflopDay, fleetFor, refreshFleet, applyPriority, inferenceCapacityMtok, modelInferenceCapacityMtok } from './fleet';
export { computeTick } from './tick';
export { handlers } from './handlers';
