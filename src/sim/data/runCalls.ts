// OWNER: v18 training agent. Planned decision calls mid-run (GAME_DESIGN 31). They reuse the incident machinery
// (pendingIncident, RunIncidentDef, resolveRunIncident) but are planned at launch and raised at a progress point.
// Choice 0 is always "carry on, nothing changes", so a passive player and the bot are unaffected.
// This module must NOT import runIncidents.ts (runIncidents imports RUN_CALLS). Hints: no percent signs, no stat numbers.
import type { GameState, RunCallDef, TrainingRun } from '../types';
import { clamp } from '../util';
import { DATA_KIND_CAPS, RUN_TUNING } from './trainingOptions';
import {
  activeParamsFor,
  beliefLrQuality,
  extendRun,
  lrQualityIn,
  type MixRow,
  mixRows,
  resolveRun,
  runConfig,
  runPhysics,
  truncateRun,
  uniqueTokensOf,
} from '../systems/trainingMath';
import { collapsePenalty, syntheticShare } from '../systems/data';
import { isResearched } from '../systems/research';

// ---------------------------------------------------------------------------
// local helpers (runIncidents keeps its own copies; the two modules must not import each other)
// ---------------------------------------------------------------------------

function mult(run: TrainingRun, m: number): void {
  run.qualityMult = (run.qualityMult ?? 1) * m;
}

function addCaps(run: TrainingRun, delta: NonNullable<TrainingRun['capAdd']>): void {
  const out = { ...(run.capAdd ?? {}) };
  for (const [k, v] of Object.entries(delta) as [keyof NonNullable<TrainingRun['capAdd']>, number][]) {
    out[k] = (out[k] ?? 0) + v;
  }
  run.capAdd = out;
}

function stall(run: TrainingRun, days: number): void {
  run.stallDays = (run.stallDays ?? 0) + days;
}

/** Share of the run's FLOPs done, 0..1. */
function progressOf(run: TrainingRun): number {
  return run.totalFlops > 0 ? clamp(run.doneFlops / run.totalFlops, 0, 1) : 0;
}

function instabilityOf(s: GameState, run: TrainingRun): number {
  return runPhysics(s, run).instability;
}

/** Calls only exist for pretraining runs; legacy runs with no kind are pretraining too. */
const isPretrain = (run: TrainingRun): boolean => (run.kind ?? 'pretrain') === 'pretrain';

/** The run's data mix as the game sees it (true quality), with the run's epochs. */
const mixOf = (s: GameState, run: TrainingRun): MixRow[] => mixRows(s, run.datasetIds, runConfig(s, run), 'true', run.tokensB);

/** The smallest slice of the mix that is not multimodal, or undefined. */
function lowestKind(rows: readonly MixRow[]): MixRow | undefined {
  let best: MixRow | undefined;
  for (const r of rows) if (r.kind !== 'multimodal' && (!best || r.share < best.share)) best = r;
  return best;
}

/** Whether `fraction` more tokens fit in the run's unique data. */
function headroomFor(s: GameState, run: TrainingRun, fraction: number): boolean {
  return run.tokensB * (1 + fraction) <= uniqueTokensOf(s, run.datasetIds) * RUN_TUNING.MAX_EPOCHS + 1e-9;
}

/** A learning rate moved by `delta`, kept in 0..1 and rounded to hundredths. */
const shiftLr = (lr: number, delta: number): number => clamp(Math.round((lr + delta) * 100) / 100, 0, 1);

/**
 * Change the learning rate for the rest of the run. The quality ratio (true curve, with the optimizer's curve
 * multiplier) applies to the share of the run still to come. Returns the player-facing line.
 */
function changeLr(s: GameState, run: TrainingRun, newLr: number): string {
  const cfg = runConfig(s, run);
  const active = activeParamsFor(run.paramsB, cfg);
  const before = lrQualityIn(s, cfg, active, 'true');
  const next = { ...cfg, lr: newLr };
  const ratio = before > 0 ? lrQualityIn(s, next, active, 'true') / before : 1;
  mult(run, 1 + (1 - progressOf(run)) * (ratio - 1));
  run.config = next;
  if (ratio > 1.005) return 'The loss bent down within a day.';
  if (ratio < 0.995) return 'The curve flattened.';
  return 'No visible difference.';
}

/** The learning rate the sweeps believe is best at this size, or null when nobody has swept near it. */
function believedBestLr(s: GameState, run: TrainingRun): number | null {
  const cfg = runConfig(s, run);
  const active = activeParamsFor(run.paramsB, cfg);
  const mup = isResearched(s, 'mup_transfer');
  const logN = Math.log10(Math.max(1e-6, active));
  const near = (s.lab?.sweeps?.[cfg.arch] ?? []).some((p) => mup || Math.abs(p.scale - logN) <= RUN_TUNING.LR_SWEEP_NEAR_LOG10);
  if (!near) return null;
  let best = 0;
  let bestQ = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const q = beliefLrQuality(s, cfg.arch, active, i / 100, mup);
    if (q > bestQ) {
      bestQ = q;
      best = i / 100;
    }
  }
  return best;
}

/** The mix with the synthetic weight halved and the rest renormalised (epochs follow their share). */
function halvedRows(rows: readonly MixRow[]): MixRow[] {
  const syn = rows.find((r) => r.kind === 'synthetic');
  if (!syn) return [...rows];
  const next = syn.share / 2;
  const rest = 1 - syn.share;
  const scale = rest > 0 ? (1 - next) / rest : 1;
  return rows.map((r) => {
    const share = r.kind === 'synthetic' ? next : r.share * scale;
    const ratio = r.share > 0 ? share / r.share : 0;
    return { ...r, share, ...(r.epochs !== undefined ? { epochs: r.epochs * ratio } : {}) };
  });
}

// ---------------------------------------------------------------------------
// calls
// ---------------------------------------------------------------------------

export const RUN_CALLS: RunCallDef[] = [
  {
    id: 'call_checkpoint_verdict',
    title: 'Checkpoint verdict',
    at: 0.85,
    priority: 1,
    body: (s, run) => {
      const last = run.checkpoints?.[run.checkpoints.length - 1];
      const mid = run.forecast?.mid;
      if (!last || mid === undefined) return `${run.name} is nearly done. Nobody has a checkpoint reading to compare with the forecast.`;
      const verdict = last.reading >= mid ? 'Ahead of the forecast.' : 'Behind the forecast.';
      return `The latest checkpoint reads ${last.reading.toFixed(0)} against a forecast of ${mid.toFixed(0)}. ${verdict}`;
    },
    weight: (s, run) => (isPretrain(run) ? 1 : 0),
    choices: [
      {
        label: 'Finish as planned',
        hint: 'Nothing changes',
        effect: () => 'Carried on. The run finishes as planned.',
      },
      {
        label: 'Stop now',
        hint: 'Ends the run here. The model keeps what it has learned so far',
        effect: (s, run) => {
          const schedule = runConfig(s, run).schedule;
          truncateRun(s, run);
          if (schedule === 'wsd') s.flags['earlyStopWsd'] = 1;
          return 'Stopped early. The run wraps up at the next tick with what it has.';
        },
      },
      {
        label: 'Stay on and add a quarter more tokens',
        hint: 'A longer run with more data. A cosine run pays for the longer tail',
        available: (s, run) => headroomFor(s, run, 0.25),
        effect: (s, run) => extendRun(s, run, 0.25) ?? 'Extended the run by a quarter. It will take longer and know more.',
      },
    ],
  },
  {
    id: 'call_spike_policy',
    title: 'Loss spikes: what now?',
    at: 0.5,
    priority: 2,
    body: () => 'The run is getting restless. Loss spikes are coming more often, and every one of them pauses the run for a decision.',
    weight: (s, run) => (isPretrain(run) && instabilityOf(s, run) >= 0.4 ? 1 : 0),
    choices: [
      {
        label: 'Decide each time',
        hint: 'Every loss spike pauses the run for a decision',
        effect: (s, run) => {
          delete run.spikePolicy;
          return 'Each loss spike will get its own decision.';
        },
      },
      {
        label: 'Always roll back',
        hint: 'Future spikes roll back to the last checkpoint without asking',
        effect: (s, run) => {
          run.spikePolicy = 0;
          return 'Future loss spikes will roll back to the last checkpoint without asking.';
        },
      },
      {
        label: 'Always skip the bad batch',
        hint: 'Future spikes skip the batch without asking. The model may come out slightly worse',
        effect: (s, run) => {
          run.spikePolicy = 1;
          return 'Future loss spikes will skip the batch without asking.';
        },
      },
      {
        label: 'Lower the learning rate by a tenth now',
        hint: 'Changes the rate for the rest of the run. No delay',
        effect: (s, run) => `Lowered the learning rate. ${changeLr(s, run, shiftLr(runConfig(s, run).lr, -0.1))}`,
      },
    ],
  },
  {
    id: 'call_synthetic',
    title: 'Synthetic data is piling up',
    at: 0.5,
    priority: 2,
    body: (s, run) => {
      const share = mixOf(s, run).find((r) => r.kind === 'synthetic')?.share ?? 0;
      const heavy = share >= 0.4 ? 'a large slice' : 'a fair slice';
      return `Machine-written data is ${heavy} of the mix. Models trained on their own output tend to go soft.`;
    },
    weight: (s, run) => (isPretrain(run) && syntheticShare(run.datasetIds, s) >= 0.25 ? 1 : 0),
    choices: [
      {
        label: 'Keep the synthetic data',
        hint: 'Nothing changes',
        effect: () => 'The synthetic data stays in the mix.',
      },
      {
        label: 'Halve the synthetic data for the rest of the run',
        hint: 'Less collapse risk. The model loses a little maths and reasoning',
        effect: (s, run) => {
          const rows = mixOf(s, run);
          const p = progressOf(run);
          const before = collapsePenalty(s, run.datasetIds, rows);
          const after = collapsePenalty(s, run.datasetIds, halvedRows(rows));
          mult(run, 1 + (1 - p) * (after / before - 1));
          addCaps(run, { math: -1, reasoning: -1 });
          return 'Halved the synthetic data for the rest of the run. The model is a little less clever about sums.';
        },
      },
      {
        label: 'Filter it with a judge model',
        hint: 'Stalls the run for a few days. Needs quality classifiers research',
        available: (s) => isResearched(s, 'quality_classifiers'),
        effect: (s, run, rng) => {
          const p = progressOf(run);
          const before = collapsePenalty(s, run.datasetIds, mixOf(s, run));
          stall(run, rng.int(2, 4));
          mult(run, 1 + (1 - p) * (1 / before - 1));
          return 'A judge model went through the synthetic data. It took a few days, and most of the collapse is undone.';
        },
      },
    ],
  },
  {
    id: 'call_decay_timing',
    title: 'When to decay?',
    at: 0.6,
    priority: 3,
    body: () => 'The learning rate is supposed to decay in the last stretch. The team can decay now, on schedule, or stay hot for longer.',
    weight: (s, run) => (isPretrain(run) && runConfig(s, run).schedule === 'wsd' ? 1 : 0),
    choices: [
      {
        label: 'Decay on schedule',
        hint: 'Nothing changes',
        effect: () => 'The decay follows the plan.',
      },
      {
        label: 'Decay now and finish early',
        hint: 'The run ends with four fifths of its tokens. The quality holds up',
        effect: (s, run) => {
          const cfg = runConfig(s, run);
          const tokensB = run.tokensB * 0.8;
          const phys = resolveRun(s, run.paramsB, tokensB, run.datasetIds, run.techniques, cfg, 'true');
          run.tokensB = tokensB;
          run.predictedLoss = phys.loss;
          run.dataQuality = phys.dataQuality;
          run.totalFlops = Math.max(run.doneFlops, phys.totalFlops);
          mult(run, 1.005);
          return 'The decay started early and the run wraps up sooner. The loss flattened out nicely.';
        },
      },
      {
        label: 'Stay hot and add a quarter more tokens',
        hint: 'A longer run with more data. Restless runs may stall for a few days',
        available: (s, run) => headroomFor(s, run, 0.25),
        effect: (s, run, rng) => {
          const err = extendRun(s, run, 0.25);
          if (err) return err;
          if (instabilityOf(s, run) > 0.3 && rng.chance(0.3)) {
            stall(run, rng.int(2, 4));
            return 'Kept the rate hot and extended the run. It got restless and stalled for a few days.';
          }
          return 'Kept the rate hot and extended the run. It will take longer and know more.';
        },
      },
    ],
  },
  {
    id: 'call_lr_review',
    title: 'Learning rate review',
    at: 0.4,
    priority: 3,
    body: (s, run) => {
      const cfg = runConfig(s, run);
      const best = believedBestLr(s, run);
      const belief = best === null ? 'Nobody has swept this size, so nobody knows where the optimum is.' : `The sweeps say the best rate is about ${best.toFixed(2)}.`;
      return `The run is at a learning rate of ${cfg.lr.toFixed(2)}. ${belief}`;
    },
    weight: (s, run) => (isPretrain(run) && runConfig(s, run).schedule !== 'wsd' ? 1 : 0),
    choices: [
      {
        label: 'Leave the rate alone',
        hint: 'Nothing changes',
        effect: () => 'The learning rate stays where it is.',
      },
      {
        label: 'Lower the rate by a tenth',
        hint: 'Changes the rate for the rest of the run. No delay',
        effect: (s, run) => `Lowered the learning rate. ${changeLr(s, run, shiftLr(runConfig(s, run).lr, -0.1))}`,
      },
      {
        label: 'Raise the rate by a tenth',
        hint: 'Changes the rate for the rest of the run. No delay',
        effect: (s, run) => `Raised the learning rate. ${changeLr(s, run, shiftLr(runConfig(s, run).lr, 0.1))}`,
      },
    ],
  },
  {
    id: 'call_mix_review',
    title: 'Data mix review',
    at: 0.3,
    priority: 3,
    body: (s, run) => {
      const low = lowestKind(mixOf(s, run));
      return low ? `The ${low.kind} data is the thinnest slice of the mix. Nobody has asked whether it is worth more.` : 'The mix has nothing to review.';
    },
    weight: (s, run) => (isPretrain(run) && mixOf(s, run).length >= 2 && lowestKind(mixOf(s, run)) ? 1 : 0),
    choices: [
      {
        label: 'Keep the mix',
        hint: 'Nothing changes',
        effect: () => 'The mix stays as it is.',
      },
      {
        label: 'Lean into it',
        hint: 'Its skills grow for the rest of the run. Whether it is any good is a separate question',
        effect: (s, run) => {
          const low = lowestKind(mixOf(s, run));
          if (!low) return 'Nothing to lean into.';
          const p = progressOf(run);
          const delta: NonNullable<TrainingRun['capAdd']> = {};
          for (const [cap, factor] of Object.entries(DATA_KIND_CAPS[low.kind]) as [keyof NonNullable<TrainingRun['capAdd']>, number][]) {
            delta[cap] = 4 * factor * (1 - p);
          }
          addCaps(run, delta);
          const believed = mixRows(s, run.datasetIds, runConfig(s, run), 'belief', run.tokensB).find((r) => r.kind === low.kind)?.quality ?? low.quality;
          const good = low.quality >= believed;
          mult(run, good ? 1.005 : 0.985);
          return good
            ? `Leaned into the ${low.kind} data. It turned out better than the team had said.`
            : `Leaned into the ${low.kind} data. It turned out weaker than it looked on paper.`;
        },
      },
      {
        label: 'Curriculum, hardest data last',
        hint: 'A gamble on the order of the data. Needs curriculum learning research',
        available: (s) => isResearched(s, 'curriculum_learning'),
        effect: (s, run, rng) => {
          if (rng.chance(0.65)) {
            mult(run, 1.02);
            addCaps(run, { reasoning: 2 });
            return 'The hardest data went last. The model got sharper at the end.';
          }
          mult(run, 0.99);
          return 'The hardest data went last. The model found it confusing and said so.';
        },
      },
    ],
  },
];
