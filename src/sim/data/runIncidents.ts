import type { GameState, Id, Rng, RunIncidentDef, TrainingRun } from '../types';
import { addExpense, addRevenue, clamp, formatMoney } from '../util';
import { RUN_TUNING } from './trainingOptions';
import { capAtCash, scaledCost, spreadCost } from './eventKit';
import { trainingRatePerDay } from '../systems/capabilities';
import { clusterEfficiency } from '../systems/compute';
import { runConfig, runPhysics } from '../systems/trainingMath';
// OWNER: training agent. Things that go wrong (or right) mid-run (GAME_DESIGN 13.2). Each has 2-3 choices with
// real trade-offs: stalls, quality, capability changes, money, morale. Choice 0 is always the conservative one.
// Hints are tangible only (money, days, progress, models). Results are narrative: no stat numbers, no percent signs.
// Amounts are drawn from rng so no two incidents play out the same way.

// ---------------------------------------------------------------------------
// helpers used by the effects
// ---------------------------------------------------------------------------

/** Days of progress a rollback to the last checkpoint throws away, for this run's checkpointing. */
export function checkpointDays(run: TrainingRun): number {
  return RUN_TUNING.CHECKPOINT[run.config?.checkpointing ?? 'normal'].rollbackDays;
}

/** Roll the run back by `days` of progress. Returns the days actually lost. */
export function rollBack(s: GameState, run: TrainingRun, days: number): number {
  const rate = trainingRatePerDay(s, runConfig(s, run));
  const lost = Math.min(run.doneFlops, Math.max(0, days) * rate);
  run.doneFlops -= lost;
  return rate > 0 ? lost / rate : 0;
}

function stall(run: TrainingRun, days: number): void {
  run.stallDays = (run.stallDays ?? 0) + days;
}

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

/** Share of the run's FLOPs done, 0..1. */
function progressOf(run: TrainingRun): number {
  return run.totalFlops > 0 ? clamp(run.doneFlops / run.totalFlops, 0, 1) : 0;
}

/** GPUs in the training share, which the money and failure effects scale with. */
function usedGpus(s: GameState): number {
  return clusterEfficiency(s).usedGpus;
}

/** Instability of this run, from its physics (cheap enough to call on a roll). */
function instabilityOf(s: GameState, run: TrainingRun): number {
  return runPhysics(s, run).instability;
}

/** A twist branch: roughly one roll in seven goes somewhere unexpected. */
const twist = (rng: Rng, p = 0.15): boolean => rng.chance(p);

/** Stall the run for a random whole number of days, and say so in the hint with the same range. */
const stallDays = (run: TrainingRun, rng: Rng, lo: number, hi: number): void => stall(run, rng.int(lo, hi));
const daysHint = (lo: number, hi: number): string => `Delays training by ${lo} to ${hi} days`;

/** Roll back by a random share of the checkpoint interval (1 = the whole interval). */
function rollBackShare(s: GameState, run: TrainingRun, rng: Rng, lo: number, hi: number): void {
  rollBack(s, run, checkpointDays(run) * rng.range(lo, hi));
}

/** Money for the safest option: a random spread around the scaled base, capped at a quarter of cash. */
const safePay = (s: GameState, rng: Rng, base: number): number => capAtCash(s, spreadCost(s, rng, base), 0.25);
/** Money for any other option: a random spread around the scaled base, capped at half of cash. */
const pay = (s: GameState, rng: Rng, base: number): number => capAtCash(s, spreadCost(s, rng, base), 0.5);
/** What the hint promises: the scaled base, capped the same way as the effect. */
const costHint = (s: GameState, base: number, share = 0.5): string =>
  `Costs about ${formatMoney(capAtCash(s, scaledCost(s, base), share))}`;

// ---------------------------------------------------------------------------
// incidents
// ---------------------------------------------------------------------------

export const RUN_INCIDENTS: RunIncidentDef[] = [
  {
    id: 'loss_spike',
    title: 'Loss spike',
    body: (s, run) =>
      `The loss jumped like a startled cat at a bad moment in ${run.name}. The dashboard is red, and someone has already screenshotted it for the group chat.`,
    weight: (s, run) => 1 + 4 * Math.max(0, instabilityOf(s, run)),
    choices: [
      {
        label: 'Roll back to the last checkpoint',
        hint: `Loses up to a checkpoint of progress. ${daysHint(1, 3)}`,
        effect: (s, run, rng) => {
          rollBackShare(s, run, rng, 0.6, 1.3);
          stallDays(run, rng, 1, 3);
          if (twist(rng)) {
            rollBackShare(s, run, rng, 0.3, 0.8);
            return 'The last checkpoint turned out to be a little corrupt, so the rollback went one checkpoint further. The loss is normal again, and so is the mood, eventually.';
          }
          return 'Rolled back to the last checkpoint and lost a few nights. The loss is normal again, and so is the mood.';
        },
      },
      {
        label: 'Skip the bad batch and keep going',
        hint: 'The model may come out slightly worse. No delay',
        effect: (s, run, rng) => {
          mult(run, rng.range(0.98, 0.995));
          if (twist(rng)) {
            stallDays(run, rng, 1, 2);
            return 'Skipped the batch. It was not the batch. The spike came back for a second look and cost the run a night.';
          }
          return 'Skipped the batch. The model did not notice, which is either good or the start of something.';
        },
      },
      {
        label: 'Lower the learning rate on the fly',
        hint: 'The model comes out a bit worse. No delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            return 'Turned the learning rate down and the spike never came back. It was the learning rate all along, and nobody will admit they suspected it.';
          }
          mult(run, rng.range(0.94, 0.985));
          return 'Turned the learning rate down. Nobody will remember the spike. The final number will.';
        },
      },
    ],
  },
  {
    id: 'divergence',
    title: 'Loss is NaN',
    body: () =>
      'Gradients exploded and the loss now reads NaN. In a happy universe NaN is not a number. Here it is a meeting, and everyone is invited.',
    weight: (s, run) => {
      const lr = run.config?.lr ?? 0.5;
      return lr > 0.6 ? 2 + 12 * (lr - 0.6) : 0.05;
    },
    choices: [
      {
        label: 'Roll back and halve the learning rate',
        hint: `Loses up to a checkpoint of progress. ${daysHint(2, 4)}`,
        effect: (s, run, rng) => {
          rollBackShare(s, run, rng, 0.7, 1.3);
          stallDays(run, rng, 2, 4);
          if (twist(rng)) {
            return 'Rolled back and restarted with a gentler learning rate. The new rate turned out to suit the model. The optimizer is speaking to everyone again, and is a bit smug about it.';
          }
          mult(run, rng.range(0.95, 0.985));
          return 'Rolled back and restarted with a gentler learning rate. The optimizer is not speaking to anyone.';
        },
      },
      {
        label: 'Restart the run from scratch',
        hint: `Loses all progress. ${daysHint(1, 3)}`,
        effect: (s, run, rng) => {
          const lost = run.doneFlops;
          stallDays(run, rng, 1, 3);
          if (twist(rng)) {
            run.doneFlops = lost * rng.range(0.05, 0.12);
            return 'Restarted from scratch, then someone found a week-one checkpoint on a spare drive. A sliver of the work survived. The GPUs are cautiously forgiving.';
          }
          run.doneFlops = 0;
          return 'Restarted from scratch and threw the whole run into the bin. The GPUs have never felt so betrayed.';
        },
      },
      {
        label: 'Call it a rounding error',
        hint: 'The model comes out noticeably worse. No delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            mult(run, rng.range(0.96, 0.985));
            return 'It was, in fact, a rounding error. Nobody is more surprised than the person who said it.';
          }
          mult(run, rng.range(0.7, 0.88));
          return 'It was not a rounding error. The model now ends sentences in confident mush, but the dashboard is green.';
        },
      },
    ],
  },
  {
    id: 'gpu_node_failure',
    title: 'A GPU node has left the cluster',
    body: () =>
      'Node 14-B stopped answering pings. It is not dead, merely resting, according to the on-call engineer who is also resting.',
    weight: (s) => 0.5 + Math.sqrt(usedGpus(s) / 200),
    choices: [
      {
        label: 'Hot-swap the node',
        hint: daysHint(1, 3),
        effect: (s, run, rng) => {
          if (twist(rng)) {
            return 'The spare was already racked and warm. The swap took one coffee. The checkpoint did not even look up.';
          }
          stallDays(run, rng, 1, 3);
          return 'Hot-swapped the node. The checkpoint shrugged and kept going.';
        },
      },
      {
        label: 'Route around it and accept a few dropped shards',
        hint: 'The model may come out slightly worse. No delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            return 'Routed around the node. The dropped shards turned out to be the ones nobody liked. The model is fine.';
          }
          mult(run, rng.range(0.98, 0.995));
          return 'Routed around the node. A few shards never got trained. They will be fine, probably.';
        },
      },
      {
        label: 'Rent emergency spare nodes',
        hint: (s) => `${costHint(s, 15_000 + 80 * usedGpus(s))}. No delay`,
        effect: (s, run, rng) => {
          const cost = pay(s, rng, 15_000 + 80 * usedGpus(s));
          addExpense(s, 'compute', cost);
          if (twist(rng)) {
            mult(run, 1.005);
            return `Rented spare nodes for ${formatMoney(cost)}. They turned out faster than the originals, and the dead node has been given a nice funeral.`;
          }
          return `Rented spare nodes for ${formatMoney(cost)}. The dead node has been given a nice funeral.`;
        },
      },
    ],
  },
  {
    id: 'router_collapse',
    title: 'Router collapse',
    body: () =>
      'Nearly every token is now being routed to Expert 7. Expert 7 has never been so busy, and has never been so wrong.',
    weight: (s, run) => (run.config?.arch === 'moe' ? 3 : 0),
    choices: [
      {
        label: 'Reset the router',
        hint: daysHint(1, 4),
        effect: (s, run, rng) => {
          stallDays(run, rng, 1, 4);
          return 'Reset the router. The experts have been reassigned and have opinions about it.';
        },
      },
      {
        label: 'Turn up the load-balancing loss',
        hint: 'The model comes out a little worse. No delay',
        effect: (s, run, rng) => {
          mult(run, rng.range(0.97, 0.99));
          if (twist(rng)) {
            stallDays(run, rng, 1, 2);
            return 'Turned up the load balancing too far. Expert 7 is now idle out of spite, and the run lost a night finding the dial.';
          }
          return 'Turned up the load balancing. Expert 7 has been asked to share its tokens with its neighbours.';
        },
      },
      {
        label: 'Call it specialisation',
        hint: 'The model comes out worse overall, better at reasoning, and loses some languages',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            mult(run, rng.range(0.96, 0.985));
            addCaps(run, { reasoning: rng.int(2, 4) });
            return 'Expert 7 really is a specialist. It is very good at something. The team is now trying to find out what.';
          }
          mult(run, rng.range(0.85, 0.93));
          addCaps(run, { reasoning: rng.int(1, 3), multilingual: -rng.int(1, 3) });
          return 'Expert 7 is now a specialist. Nobody has asked what it specialises in.';
        },
      },
    ],
  },
  {
    id: 'dataloader_bug',
    title: 'Dataloader bug',
    body: () =>
      'A shuffle bug has shown shard 12 to the model dozens of times. The model has memorised it and is quietly proud.',
    weight: () => 1,
    choices: [
      {
        label: 'Restart the dataloader from the checkpoint',
        hint: `Loses half a checkpoint of progress. ${daysHint(1, 2)}`,
        effect: (s, run, rng) => {
          stallDays(run, rng, 1, 2);
          if (twist(rng)) {
            return 'Restarted the dataloader and it resumed mid-epoch without losing a step. Shard 12 is now shown exactly once, out of respect.';
          }
          rollBackShare(s, run, rng, 0.3, 0.7);
          return 'Restarted the dataloader and lost a few days. Shard 12 is now shown exactly once, out of respect.';
        },
      },
      {
        label: 'Call it curriculum learning',
        hint: 'Trades some quality for knowledge. No delay',
        effect: (s, run, rng) => {
          mult(run, rng.range(0.92, 0.97));
          addCaps(run, { knowledge: rng.int(1, 3) });
          return 'Shard 12 is now a curriculum. The paper is being written by someone who has never seen a curriculum.';
        },
      },
      {
        label: 'Dedupe the shard',
        hint: (s) => `${costHint(s, 30_000)}. No delay`,
        effect: (s, run, rng) => {
          const cost = pay(s, rng, 30_000);
          addExpense(s, 'compute', cost);
          if (twist(rng)) {
            mult(run, 1.01);
            return 'Deduped shard 12 and found shard 3 was the same shard in a hat. The data got cleaner than anyone planned.';
          }
          return 'Deduped shard 12. It has been quietly removed from the list of celebrities.';
        },
      },
    ],
  },
  {
    id: 'heatwave_throttle',
    title: 'Heat wave',
    body: () =>
      'It is hot outside and hotter in the cold aisle. The clusters are throttling, and facilities is praying in Slack.',
    weight: (s) => (s.compute.datacenters.length > 0 ? 1.5 : 0.1),
    choices: [
      {
        label: 'Pause until it cools',
        hint: daysHint(2, 5),
        effect: (s, run, rng) => {
          if (twist(rng)) {
            stallDays(run, rng, 1, 1);
            return 'Paused the run, and a cold front rolled in a day later. The GPUs are mildly insulted at the drama.';
          }
          stallDays(run, rng, 2, 5);
          return 'Paused the run until the evenings. The GPUs are sunbathing in spirit.';
        },
      },
      {
        label: 'Turn on the extra fans and pay the power bill',
        hint: (s) => `${costHint(s, 25_000 + 40 * usedGpus(s))}. No delay`,
        effect: (s, run, rng) => {
          const cost = pay(s, rng, 25_000 + 40 * usedGpus(s));
          addExpense(s, 'power', cost);
          if (twist(rng)) {
            stall(run, 1);
            return `Fans on, power bill up ${formatMoney(cost)}. One of the fans took the whole row's breaker with it, and the run lost a night.`;
          }
          return `Fans on, power bill up ${formatMoney(cost)}. The cold aisle is cold again.`;
        },
      },
      {
        label: 'Keep training and lose some progress to the heat',
        hint: 'Loses some progress, no delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            return 'Kept training. The aisle held, nothing crashed, and facilities has been told it can stop praying.';
          }
          rollBack(s, run, rng.range(0.3, 1.2));
          return 'Kept training. The heat took some of the progress as a tax.';
        },
      },
    ],
  },
  {
    id: 'emergent_ability',
    title: 'Emergent ability',
    body: () =>
      'Nobody trained it to do multi-digit arithmetic in its sleep. It did it anyway, in a reply about sourdough starters.',
    good: true,
    weight: (s, run) => (progressOf(run) >= 0.2 ? 1 : 0.1),
    choices: [
      {
        label: 'Publish the paper',
        hint: 'A lot more math and some reasoning. The whole world finds out',
        effect: (s, run, rng) => {
          addCaps(run, { math: rng.int(3, 5), reasoning: rng.int(1, 3) });
          s.company.hype = clamp(s.company.hype + rng.int(3, 6), 0, 100);
          s.company.reputation = clamp(s.company.reputation + 1, 0, 100);
          if (twist(rng)) {
            return 'The paper is titled "Surprising Arithmetic". Reviewers found it surprising, and then found a rival who claims to have seen it first.';
          }
          return 'The paper is titled "Surprising Arithmetic". Reviewers found it surprising.';
        },
      },
      {
        label: 'Keep it quiet for the demo',
        hint: 'Even more math. Nobody outside the building finds out',
        effect: (s, run, rng) => {
          addCaps(run, { math: rng.int(4, 8) });
          return 'Quiet demo, impressive numbers. Nobody outside the building knows why it works, including us.';
        },
      },
      {
        label: 'Call it a hallucination',
        hint: 'A little math. Nobody gets excited',
        effect: (s, run, rng) => {
          addCaps(run, { math: rng.int(0, 2) });
          if (twist(rng)) {
            s.company.hype = clamp(s.company.hype + 3, 0, 100);
            return 'It is a hallucination. It is also correct. Someone posted the screenshot and the internet has decided it is a personality.';
          }
          return 'It is a hallucination. It is also correct. The fact-check team is confused and has asked for a sandwich.';
        },
      },
    ],
  },
  {
    id: 'grokking',
    title: 'Grokking',
    body: () =>
      'For three weeks the loss sat flat. Then, on a Tuesday, the model understood modular arithmetic all at once and wrote a very calm poem about it.',
    good: true,
    weight: (s, run) => (progressOf(run) >= 0.3 ? 0.25 : 0),
    choices: [
      {
        label: 'Let it cook',
        hint: 'The model comes out better. No delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            mult(run, rng.range(1.06, 1.09));
            return 'Let it cook. The loss dropped off a cliff and kept going. The model is calm, and the team is not.';
          }
          mult(run, rng.range(1.02, 1.06));
          return 'Let it cook. The loss has stayed flat, and the model has stayed calm, and both are on purpose now.';
        },
      },
      {
        label: 'Snapshot it and write it up',
        hint: 'More reasoning, and the write-up gets read',
        effect: (s, run, rng) => {
          mult(run, rng.range(1.0, 1.02));
          addCaps(run, { reasoning: rng.int(3, 5) });
          s.company.hype = clamp(s.company.hype + rng.int(3, 6), 0, 100);
          return 'Snapshotted the grokked weights. The write-up is three pages of arrows.';
        },
      },
    ],
  },
  {
    id: 'contamination_found',
    title: 'A reviewer found the answer key',
    body: () =>
      'Someone ran a substring match and found benchmark answers in the training data. The reviewer is very polite and very disappointed.',
    weight: (s, run) => (run.accidentallyContaminated ? 3 : 0),
    choices: [
      {
        label: 'Retrain the clean version from scratch',
        hint: `Loses all progress, removes the contamination. ${daysHint(1, 3)}`,
        effect: (s, run, rng) => {
          const before = run.doneFlops;
          run.accidentallyContaminated = false;
          stallDays(run, rng, 1, 3);
          if (twist(rng)) {
            run.doneFlops = before * rng.range(0.1, 0.3);
            return 'Restarted without the leaked rows, from a clean early checkpoint nobody remembered making. Some of the work survived, and the benchmark is still owed an apology.';
          }
          run.doneFlops = 0;
          return 'Restarted without the leaked rows. The GPUs have been through a lot, and the benchmark is still owed an apology.';
        },
      },
      {
        label: 'Quietly delete the leaked rows',
        hint: `Removes the contamination. ${daysHint(1, 3)}`,
        effect: (s, run, rng) => {
          run.accidentallyContaminated = false;
          if (twist(rng)) {
            return 'Deleted the leaked rows between two meetings. The run did not even notice, and neither did the reviewer.';
          }
          stallDays(run, rng, 1, 3);
          return 'Deleted the leaked rows. The run continues, and so does the quiet.';
        },
      },
      {
        label: 'Publish: "it is a feature"',
        hint: 'The model stays contaminated. The benchmark may get a lawyer',
        effect: (s, run, rng) => {
          s.company.reputation = clamp(s.company.reputation - rng.int(3, 6), 0, 100);
          s.company.hype = clamp(s.company.hype + rng.int(2, 4), 0, 100);
          if (twist(rng)) {
            const fee = pay(s, rng, 120_000);
            addExpense(s, 'legal', fee);
            return `The blog post is titled "Generalisation Through Memorisation". The benchmark's lawyer replied the same afternoon, and the reply came with an invoice for ${formatMoney(fee)}.`;
          }
          return 'The blog post is titled "Generalisation Through Memorisation". The benchmark has asked for its lawyer.';
        },
      },
    ],
  },
  {
    id: 'intern_checkpoint',
    title: 'An intern deleted the checkpoints',
    body: () =>
      'The intern was freeing up disk space. The disk is now free. The checkpoints are not free. They are gone. The intern is asking if this counts as a learning experience.',
    weight: () => 1,
    choices: [
      {
        label: 'Restore from the backup bucket',
        hint: (s) => `${costHint(s, 20_000, 0.25)}. Loses half a checkpoint of progress`,
        effect: (s, run, rng) => {
          const cost = safePay(s, rng, 20_000);
          addExpense(s, 'compute', cost);
          if (twist(rng)) {
            return `Restored from the backup bucket for ${formatMoney(cost)}. The backup was from this morning. The intern has quietly been given a raise.`;
          }
          rollBackShare(s, run, rng, 0.3, 0.7);
          return `Restored from the backup bucket for ${formatMoney(cost)}. Some progress was lost in the process.`;
        },
      },
      {
        label: 'Restart the run',
        hint: `Loses all progress. ${daysHint(1, 3)}`,
        effect: (s, run, rng) => {
          const lost = run.doneFlops;
          stallDays(run, rng, 1, 3);
          if (twist(rng)) {
            run.doneFlops = lost * rng.range(0.2, 0.5);
            return 'Restarted the run, until the intern produced a copy of the weights from his laptop. He has been given a new title, a good one this time.';
          }
          run.doneFlops = 0;
          return 'Restarted the run and threw the work away. The intern has been given a new title.';
        },
      },
      {
        label: 'Keep going on the weights in memory',
        hint: 'The model comes out noticeably worse. No delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            mult(run, rng.range(0.96, 0.985));
            return 'The weights live on in RAM, the way all good ideas do. The RAM held, against all odds and a lot of superstition.';
          }
          mult(run, rng.range(0.85, 0.93));
          return 'The weights live on in RAM, the way all good ideas do. Mostly the way that one unreliable RAM stick does.';
        },
      },
    ],
  },
  {
    id: 'quick_idea',
    title: 'A researcher has a quick idea',
    body: () =>
      '"It is a quick one," they said, holding a whiteboard covered in the word "just". It is not quick.',
    weight: () => 1,
    choices: [
      {
        label: 'Approve the side quest',
        hint: `${daysHint(2, 5)}, and a little more reasoning`,
        effect: (s, run, rng) => {
          stallDays(run, rng, 2, 5);
          if (twist(rng)) {
            addCaps(run, { reasoning: rng.int(3, 5) });
            mult(run, 1.01);
            return 'The side quest ate a few days and then worked embarrassingly well. The whiteboard has been framed.';
          }
          addCaps(run, { reasoning: rng.int(1, 3) });
          return 'The side quest ran long, and the idea works a little. The whiteboard has been photographed for the archive.';
        },
      },
      {
        label: 'Say no and buy them a coffee',
        hint: 'Costs a coffee. They will sulk',
        effect: (s, run, rng) => {
          s.staff.morale = clamp(s.staff.morale - rng.int(1, 4), 0, 100);
          return 'Denied, with coffee. They have started a Slack channel called #quick-ideas.';
        },
      },
      {
        label: 'Merge it into the live run',
        hint: 'A gamble: the model gets better, or the model gets worse',
        effect: (s, run, rng) => {
          if (rng.chance(0.5)) {
            mult(run, rng.range(1.02, 1.05));
            return 'The merge worked on the first try. The researcher is insufferable about it.';
          }
          mult(run, rng.range(0.88, 0.95));
          if (twist(rng)) {
            stallDays(run, rng, 1, 2);
            return 'The merge worked on the first try and then broke everything else. Cleaning it up took a night, and the researcher is writing a postmortem.';
          }
          return 'The merge worked on the first try and then broke everything else. The researcher is writing a postmortem.';
        },
      },
    ],
  },
  {
    id: 'perfect_lr',
    title: 'The learning rate is perfect',
    body: () =>
      'The learning-rate schedule has hit the sweet spot exactly. Nobody knows why, and nobody wants to touch it.',
    good: true,
    weight: (s, run) => {
      const lr = run.config?.lr ?? 0.5;
      return lr >= 0.4 && lr <= 0.6 ? 1 : 0.1;
    },
    choices: [
      {
        label: 'Document it in a long blog post',
        hint: 'The model comes out better, and the post gets shared',
        effect: (s, run, rng) => {
          mult(run, rng.range(1.02, 1.04));
          s.company.hype = clamp(s.company.hype + rng.int(2, 4), 0, 100);
          if (twist(rng)) {
            s.company.hype = clamp(s.company.hype + 3, 0, 100);
            return 'The long post has eleven diagrams and one sentence that says "trust us". An aggregator picked it up and it is everywhere.';
          }
          return 'The long post has eleven diagrams and one sentence that says "trust us". It is a hit.';
        },
      },
      {
        label: 'Freeze the config and never touch it',
        hint: 'The model comes out a bit better. Nobody dares touch it',
        effect: (s, run, rng) => {
          mult(run, rng.range(1.01, 1.03));
          if (twist(rng)) {
            return 'Frozen. The config file has a sticky note that says "DO NOT". Somebody removed the note and nothing happened, which is worse.';
          }
          return 'Frozen. The config file now has a sticky note that says "DO NOT".';
        },
      },
    ],
  },
  {
    id: 'cosmic_ray',
    title: 'A cosmic ray flipped bit 17',
    body: () =>
      'Somewhere in layer 42, a particle from another galaxy changed one weight. The model now has a very slightly different opinion about everything.',
    weight: () => 0.4,
    choices: [
      {
        label: 'Roll back to the checkpoint',
        hint: `Loses up to a checkpoint of progress. ${daysHint(1, 2)}`,
        effect: (s, run, rng) => {
          rollBackShare(s, run, rng, 0.6, 1.3);
          stallDays(run, rng, 1, 2);
          if (twist(rng)) {
            return 'Rolled back. The ray turned out to be an overclocked stick of RAM with a story. Bit 17 has been returned to its rightful owner anyway.';
          }
          return 'Rolled back to the checkpoint. Bit 17 has been returned to its rightful owner.';
        },
      },
      {
        label: 'Leave it and let the model adapt',
        hint: 'The model comes out slightly different. No delay',
        effect: (s, run, rng) => {
          if (twist(rng)) {
            mult(run, 1.01);
            addCaps(run, { agentic: rng.int(1, 2) });
            return 'The model adapted, and then improved. It now has a faint, unexplained fondness for vending machines and a better grip on tools.';
          }
          mult(run, rng.range(0.97, 0.99));
          addCaps(run, { agentic: rng.int(0, 2) });
          return 'The model adapted. It now has a faint, unexplained fondness for vending machines.';
        },
      },
      {
        label: 'File a hardware support ticket',
        hint: daysHint(1, 4),
        effect: (s, run, rng) => {
          if (twist(rng)) {
            return 'The ticket was answered in an hour with "have you tried a rollback". It had been tried. The run carried on regardless.';
          }
          stallDays(run, rng, 1, 4);
          return 'The ticket is in the queue. The queue is also in a cosmic ray\'s path.';
        },
      },
    ],
  },
  {
    id: 'power_cap',
    title: 'The utility imposes a power cap',
    body: () =>
      'The grid operator has capped you well below your usual draw for ten days. They have sent a very long PDF with the word "curtailment" on every page.',
    weight: (s) => (s.compute.datacenters.length > 0 ? 1 : 0.2),
    choices: [
      {
        label: 'Pay the surge price',
        hint: (s) => `${costHint(s, 30_000 + 60 * usedGpus(s), 0.25)}. No delay`,
        effect: (s, run, rng) => {
          const cost = safePay(s, rng, 30_000 + 60 * usedGpus(s));
          addExpense(s, 'power', cost);
          if (twist(rng)) {
            const rebate = Math.round(cost * rng.range(0.2, 0.5));
            addRevenue(s, 'other', rebate);
            return `Paid the surge price of ${formatMoney(cost)}. The grid operator then sent a rebate for part of it, with a survey.`;
          }
          return `Paid the surge price of ${formatMoney(cost)}. The grid operator has sent a thank-you note with a survey.`;
        },
      },
      {
        label: 'Throttle and wait it out',
        hint: daysHint(3, 7),
        effect: (s, run, rng) => {
          if (twist(rng)) {
            stallDays(run, rng, 1, 2);
            return 'Throttled down, and the cap was lifted early after a polite email. The PDF has been printed, bound and filed under "later".';
          }
          stallDays(run, rng, 3, 7);
          return 'Throttled down and waited. The PDF has been printed, bound and filed under "later".';
        },
      },
      {
        label: 'Shift the run to spare hardware',
        hint: (s) => `${costHint(s, 10_000)}. ${daysHint(1, 2)}`,
        effect: (s, run, rng) => {
          const cost = pay(s, rng, 10_000);
          addExpense(s, 'compute', cost);
          if (twist(rng)) {
            return 'Moved the run to spare hardware, which is grid-powered in a different state and did not lose a minute.';
          }
          stallDays(run, rng, 1, 2);
          return 'Moved the run to spare hardware, which is grid-powered in a different state.';
        },
      },
    ],
  },
];

const INCIDENT_BY_ID = new Map(RUN_INCIDENTS.map((d) => [d.id, d] as const));

export function runIncidentById(id: Id): RunIncidentDef | undefined {
  return INCIDENT_BY_ID.get(id);
}
