// Per-day training tick: advances the active run, logs loss, raises calls and incidents.
import type { GameState, Rng } from '../../types';
import { runPhysics, type RunPhysics } from '../trainingMath';
import { plateauProgress, watchRun } from '../lab';
import { applyTempoDay, liveRunRate, tempoOf, tempoRisk } from '../tempo'; // v13 run tempo
import { raiseDueCall, tickAblations } from './calls';
import { finishRun, fireIncident } from './finish';
import { lossCurve } from './helpers';
import { TRAINING_TUNING } from './tuning';

export function trainingTick(s: GameState, rng: Rng): void {
  tickAblations(s);
  const run = s.training;
  if (!run) return;
  if (run.pendingIncident && run.pendingIncident.result === undefined) return;
  if ((run.stallDays ?? 0) > 0) {
    run.stallDays = (run.stallDays ?? 0) - 1;
    return;
  }
  // Fixed overhead (setup, warm-up, evals) comes before any FLOPs count. A part-day overhead leaves the rest of the day to work.
  let workShare = 1;
  if ((run.overheadLeft ?? 0) > 0) {
    const spent = Math.min(1, run.overheadLeft ?? 0);
    run.overheadLeft = Math.max(0, (run.overheadLeft ?? 0) - spent);
    if (spent >= 1) return;
    workShare = 1 - spent;
  }
  // v13: the run's tempo scales its speed (careful / standard / crunch) and its incident risk below.
  run.doneFlops = Math.min(run.totalFlops, run.doneFlops + workShare * liveRunRate(s, run));
  applyTempoDay(s, run);
  if (run.doneFlops >= run.totalFlops) {
    run.lossHistory.push(run.predictedLoss);
    finishRun(s, rng);
    return;
  }
  const progress = run.totalFlops > 0 ? run.doneFlops / run.totalFlops : 1;
  // Checkpoints and emergences (GAME_DESIGN 16.3), then the loss sample. The loss is the TRUE one.
  if (run.kind !== 'finetune') watchRun(s, run, rng);
  run.lossHistory.push(lossCurve(run.predictedLoss, plateauProgress(run, progress)) + rng.normal(0, TRAINING_TUNING.LOSS_NOISE_SD));
  if (!run.pendingIncident) {
    if (raiseDueCall(s, run, progress)) return;
    const phys: RunPhysics = runPhysics(s, run);
    if (rng.chance(phys.incidentRate * tempoRisk(s, tempoOf(run)))) fireIncident(s, run, rng);
  }
}
