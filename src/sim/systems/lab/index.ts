// OWNER: Agent FOG-SIM. Fog of training: forecasts, hidden truths, the lab notebook. See GAME_DESIGN.md §16.
// Public API (used by the UI): keep the exported names and signatures stable. Run-side helpers (rolls, true caps,
// watching a run, verification bookkeeping) are exported too, for systems/training.ts.
// The lab is split by responsibility into sibling modules; this index keeps the old public surface.

export type { Verdict } from '../../data/evalCopy';

export { LAB_TUNING } from './tuning';
export { labOf, emergenceThresholdOf, effLog10, sumCapAdd } from './notebook';
export { sweepPointsFor, sweepQuote, sweepRunning } from './sweeps';
export { believedQuality, isVerified, dataSurprise, auditQuote, auditDoneDay, verifyRunDatasets, surpriseTone, dataSurpriseLine } from './verify';
export { redTeamQuote, latentCount } from './redteam';
export { provisionalElo } from './arena';
export type { JournalRow, LabStats } from './journal';
export { emergenceJournal, labStats } from './journal';
export { forecastTraining, forecastFromPhys, forecastFinetune, currentRunBand } from './forecast';
export {
  rollSeedLuck,
  planEmergences,
  rollPretrainHidden,
  rollSpecTake,
  pendingPlanCapAdd,
  trueCapsOf,
  recomputeTrueOverall,
  plateauProgress,
  watchRun,
  settleEmergences,
  verdictFor,
  verdictNews,
  recordLabEval,
  discoveriesOf,
  trueFinetuneCaps,
  applyForgetting,
  finetuneTrueOverall,
} from './physics';
export { labTick } from './tick';
export { handlers } from './actions';
