// Run decision calls (planRunCalls, raising due calls) and ablations.
import type { GameState, Id, TrainingRun } from '../../types';
import { runIncidentById } from '../../data/runIncidents';
import { RUN_CALLS } from '../../data/runCalls';
import { notify } from '../../util';
import { hashUniform } from '../data';
import { availableGpus } from '../compute';

/**
 * v18: plan a run's decision calls at launch. No rng draws: eligibility, priority and the jitter all come from hashUniform.
 * Runs under 14 days get none, then one call under 40, two under 100 and three after that.
 */
export function planRunCalls(s: GameState, run: TrainingRun, days: number): { id: Id; at: number }[] {
  // v18: short runs never pause; the big bets earn decisions.
  const n = !Number.isFinite(days) || days < 14 ? 0 : days < 40 ? 1 : days < 100 ? 2 : 3;
  if (n === 0) return [];
  const keyed = RUN_CALLS.filter((c) => c.weight(s, run) > 0).map((c) => ({ c, u: hashUniform(s.seed, run.id + c.id) }));
  keyed.sort((a, b) => a.c.priority - b.c.priority || a.u - b.u);
  return keyed
    .slice(0, n)
    .map(({ c, u }) => ({ id: c.id, at: c.at + (u * 2 - 1) * 0.05 }))
    .sort((a, b) => a.at - b.at);
}

/** Raise the next planned call once its progress point has come. Returns true when the run is now paused on it. */
export function raiseDueCall(s: GameState, run: TrainingRun, progress: number): boolean {
  while (run.calls && run.calls.length > 0 && progress >= run.calls[0].at) {
    const [next, ...rest] = run.calls;
    run.calls = rest;
    const def = runIncidentById(next.id);
    if (!def || def.weight(s, run) <= 0) continue;
    run.pendingIncident = { defId: def.id, day: s.day, call: true };
    s.flags['callsRaised'] = (s.flags['callsRaised'] ?? 0) + 1;
    notify(s, `${run.name}: ${def.title}. The run is paused until you decide.`, 'info', { toast: true });
    return true;
  }
  return false;
}

/** Ablations finish on their day and reveal the instability and incident rate for their run sheet. */
export function tickAblations(s: GameState): void {
  const PREFIX = 'ablationDone.';
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith(PREFIX) || s.day < s.flags[key]) continue;
    const sig = key.slice(PREFIX.length);
    delete s.flags[key];
    s.flags[`ablation.${sig}`] = s.day;
    const instability = s.flags[`ablationInstab.${sig}`] ?? 0;
    const rate = s.flags[`ablationRate.${sig}`] ?? 0;
    notify(
      s,
      `Ablation finished: instability ${instability.toFixed(2)}, about ${(rate * 365).toFixed(1)} incidents a year on that run sheet. Predictions are sharper for a year.`,
      'good',
    );
  }
}

/** Cloud price of an ablation: its FLOPs at the cheapest available GPU rent, per FLOP. */
export function cheapestCloudCostPerFlop(s: GameState): number {
  const rentMult = s.flags['rentMult'] ?? 1;
  let best = Infinity;
  for (const g of availableGpus(s)) best = Math.min(best, g.rentPerDay / (g.pflops * 1e15 * 86_400));
  return best * rentMult;
}
