// Mid-run calls. A call is plain data once made: title, body and options with effect lists.
// Rule: in a drawn call every option does something. Numbers come from the run itself, so the right answer moves.
import type { Call, CallOption, Fx, GameState, Id, Run, Vec } from '../types';
import { MODALITIES, type SegmentDef } from './modalities';
import { TECHS, tech, type EmergenceDef } from './tech';

export interface CallCtx {
  s: GameState; run: Run;
  wk: number; // what a week of this run is worth: compute bill plus some of the profit it delays
  u: (purpose: string) => number;
  rivalSoon: { lab: Id; weeks: number } | null;
  pivots: SegmentDef[]; // best two segments to pivot toward
  reading: number; // noisy early reading of the seed, for the smoke test
  bestAxis: number;
}
export interface CallDef { id: Id; weight: (c: CallCtx) => number; make: (c: CallCtx) => Omit<Call, 'def'> }

const weeks = (n: number): Fx => ({ k: 'weeks', n });
const mult = (m: number): Fx => ({ k: 'cap', mult: m });
const add = (v: Vec): Fx => ({ k: 'cap', add: v });
const all = (x: number): Fx => add([x, x, x, x]);
const cash = (n: number): Fx => ({ k: 'cash', n: Math.round(n) });
const risk = (p: number, bad: Fx[], good: Fx[] = []): Fx => ({ k: 'risk', p, bad, good });
const opt = (label: string, note: string, ...fx: Fx[]): CallOption => ({ label, note, fx });
const axisAdd = (axis: number, x: number): Fx => add([0, 1, 2, 3].map((i) => (i === axis ? x : 0)));

const share = (c: CallCtx, kinds: string[]): number => kinds.reduce((a, k) => a + (c.run.bp.mix[k] ?? 0), 0);
const secretTech = (c: CallCtx): Id | null => {
  const lab = c.s.companies[c.run.lab].lab!;
  const t = TECHS.find((x) => x.mods.includes(c.run.bp.modality) && x.week > c.s.week && x.week <= c.s.week + 60 && !lab.techniques.includes(x.id));
  return t?.id ?? null;
};

export const CALLS: CallDef[] = [
  { id: 'spike', weight: (c) => 1 + 3 * c.run.instab, make: (c) => ({
    title: 'Loss spike', body: 'The curve just grew a mountain. The on-call researcher says it is "probably fine" in a voice that is not fine.',
    options: [
      opt('Roll back to the checkpoint', 'Safe and slow.', weeks(1)),
      opt('Lower the learning rate', 'It will train, just a bit worse.', mult(0.97)),
      opt('Push through', 'Sometimes mountains are just mountains.', risk(0.25 + 0.2 * Math.min(1, c.run.instab), [mult(0.9)], [mult(1.015)])),
    ] }) },
  { id: 'nan', weight: (c) => 0.3 + 3 * c.run.instab, make: (c) => ({
    title: 'Loss is NaN', body: 'Not a number. Not a good sign either.',
    options: [
      opt('Roll back, halve the learning rate', 'The grown-up answer.', weeks(1), mult(0.99)),
      opt('Call it a rounding error', 'Restart the node and hope.', risk(0.5, [mult(0.88)], [{ k: 'reveal', frac: 0.05 }])),
      opt('Pay for a forensic rerun', 'Find the bad tensor overnight.', cash(-2.2 * c.wk)),
    ] }) },
  { id: 'node', weight: () => 1, make: (c) => ({
    title: 'A GPU node has left the cluster', body: 'It did not say goodbye. Row 4 smells faintly of toast.',
    options: [
      opt('Rent emergency spares', 'Money fixes this.', cash(-1.6 * c.wk)),
      opt('Route around it', 'Drop a few shards and keep going.', mult(0.98)),
      opt('Wait for the repair', 'The technician is "on the way".', weeks(1)),
    ] }) },
  { id: 'loader', weight: () => 1, make: (c) => ({
    title: 'Dataloader bug', body: 'The model has read the same shard four hundred times. It has opinions about it now.',
    options: [
      opt('Restart from the checkpoint', 'Lose the week, keep the model.', weeks(1)),
      opt('Call it curriculum learning', 'Repetition is the mother of skill, maybe.', risk(0.45, [all(-3)], [all(1)])),
      opt('Dedupe on the fly', 'An engineer with a hot fix and a cold pizza.', cash(-0.3 * c.wk), mult(0.99)),
    ] }) },
  { id: 'leak', weight: (c) => 0.4 + 3 * share(c, ['web', 'captions']), make: (c) => ({
    title: 'A reviewer found the answer key', body: 'The benchmark test set is sitting in your training data. Scores look amazing. That is the problem.',
    options: [
      opt('Clean it and retrain the slice', 'Honest numbers.', weeks(1), { k: 'attr', trust: 0.05 }),
      opt('Quietly keep it', 'Great launch day. Possibly a bad launch month.', { k: 'lab', hype: 0.15 }, { k: 'flag', id: 'contaminated' }),
      opt('Publish the contamination report', 'Brave. The marketing team is crying.', { k: 'attr', trust: 0.1 }, all(-1)),
    ] }) },
  { id: 'idea', weight: () => 1.2, make: (c) => {
    const t = secretTech(c);
    return {
      title: 'A researcher has a quick idea', body: t ? `"What if we tried ${tech(t).name}? Nobody has it working yet. Two days, tops."` : '"I have a hunch about the optimiser. Two days, tops."',
      options: [
        opt('Fund the side quest', t ? 'If it works, the technique is yours early.' : 'If it works, the model is better.',
          cash(-0.4 * c.wk), risk(0.5, [{ k: 'lab', talent: 0.01 }], t ? [{ k: 'learn', tech: t }] : [axisAdd(c.bestAxis, 2.5)])),
        opt('Merge it into the live run', 'No time for tests.', risk(0.4, [mult(0.93)], [axisAdd(c.bestAxis, 3)])),
        opt('Say no and buy them a coffee', 'They will remember this.', { k: 'lab', talent: -0.02 }, { k: 'reveal', frac: 0.05 }),
      ] };
  } },
  { id: 'poach', weight: (c) => (c.s.week > 12 ? 0.8 : 0), make: (c) => ({
    title: 'A rival wants your lead researcher', body: 'The offer letter has more zeroes than your seed round. They "just want to talk".',
    options: [
      opt('Counter-offer', 'Match it and smile.', cash(-2.5 * c.wk)),
      opt('Let them go', 'The run wobbles while the team regroups.', { k: 'lab', talent: -0.05 }, weeks(1)),
      opt('Promote the intern', 'Fortune favours the bold, sometimes.', risk(0.5, [mult(0.96), { k: 'lab', talent: -0.03 }], [{ k: 'lab', talent: 0.03 }])),
    ] }) },
  { id: 'surge', weight: (c) => Math.max(0, 2 * (c.s.market.scarcity - 1)) + 0.4, make: (c) => ({
    title: 'Compute crunch', body: 'Your cloud would like to "revisit pricing". Everyone is training this month.',
    options: [
      opt('Pay the surge', 'Keep the cluster, lose the cash.', cash(-0.7 * c.wk)),
      opt('Throttle and wait', 'Half speed until it passes.', weeks(1)),
      opt('Move to a bargain provider', 'The website has a lot of stock photos.', risk(0.35, [weeks(2)], [cash(0.3 * c.wk)])),
    ] }) },
  { id: 'rival', weight: (c) => (c.rivalSoon ? 3 : 0), make: (c) => {
    const r = c.rivalSoon!;
    const name = c.s.companies[r.lab].name;
    return {
      title: `${name} is about to ship`, body: `Word is ${name} launches in about ${r.weeks} week${r.weeks === 1 ? '' : 's'}. Whoever ships second gets the smaller headline.`,
      options: [
        opt('Rush the schedule', 'Cut a week, cut some corners.', weeks(-1), mult(0.96)),
        opt('Tease a demo', 'Steal some thunder now, owe a good launch later.', { k: 'lab', hype: 0.2 }, { k: 'flag', id: 'teased' }),
        opt('Ignore them, add evals', 'Let them have the headline. Know your model better.', { k: 'reveal', frac: 0.15 }, { k: 'lab', hype: -0.05 }),
      ] };
  } },
  { id: 'safety', weight: () => 0.9, make: (c) => ({
    title: 'The safety team raised a flag', body: 'A checkpoint said something in testing that made the room go quiet.',
    options: [
      opt('Pause for proper evals', 'A week of red-teaming.', weeks(1), { k: 'attr', trust: 0.1 }),
      opt('Overrule them', 'Ship dates are ship dates.', { k: 'attr', trust: -0.1 }, { k: 'lab', talent: -0.02 }),
      opt('Hire an outside auditor', 'A PDF with a logo on it.', cash(-0.5 * c.wk), { k: 'attr', trust: 0.05 }),
    ] }) },
  { id: 'lawsuit', weight: (c) => 0.3 + 2 * share(c, ['books', 'art', 'photos']), make: (c) => ({
    title: 'A letter from some lawyers', body: 'A rights holder has noticed their life\'s work in your training set and would like to discuss it, expensively.',
    options: [
      opt('Settle', 'Make it go away.', cash(-1 * c.wk)),
      opt('Pull the data', 'Retrain without it. The model forgets a few things.', all(-1.5), { k: 'attr', trust: 0.05 }),
      opt('Fight it', 'Fair use is a vibe.', risk(0.4, [cash(-2.5 * c.wk), { k: 'attr', trust: -0.1 }], [{ k: 'lab', hype: 0.1 }])),
    ] }) },
  { id: 'intern', weight: () => 0.7, make: (c) => ({
    title: 'An intern deleted the checkpoints', body: 'They were "cleaning up the bucket". The bucket is very clean now.',
    options: [
      opt('Restore from backups', 'Last week\'s backups.', weeks(1)),
      opt('Keep going on the weights in memory', 'Nobody touch anything.', risk(0.25, [mult(0.85)], [{ k: 'lab', hype: 0.05 }])),
      opt('Pay for recovery', 'The cloud can undelete things, for a price.', cash(-1.6 * c.wk)),
    ] }) },
  { id: 'heat', weight: (c) => (c.s.week % 48 > 20 && c.s.week % 48 < 36 ? 1.2 : 0.2), make: (c) => ({
    title: 'Heat wave', body: 'The datacenter is 41 degrees. The cooling contract has a clause about "acts of weather".',
    options: [
      opt('Pay the peak power rate', 'Fans on full.', cash(-0.9 * c.wk)),
      opt('Throttle until it cools', 'A slow week.', weeks(1)),
      opt('Run hot', 'Chips are tougher than they look.', risk(0.3, [mult(0.95), weeks(1)], [])),
    ] }) },
  { id: 'perfect', weight: () => 0.6, make: (c) => ({
    title: 'The learning rate is perfect', body: 'Nobody knows why. The curve is a ski slope. People are whispering near the dashboard.',
    options: [
      opt('Freeze the config', 'Touch nothing.', mult(1.02)),
      opt('Write the blog post', 'Tell the world you are geniuses.', { k: 'lab', hype: 0.15, brand: 0.02 }),
      opt('Scale it up while it lasts', 'More chips, right now.', cash(-1.5 * c.wk), risk(0.4, [mult(0.99)], [mult(1.05)])),
    ] }) },
  { id: 'press', weight: (c) => (c.s.week > 6 ? 0.8 : 0), make: (c) => ({
    title: 'A reporter has a screenshot', body: 'Someone leaked a checkpoint demo. The reporter would like a comment by five.',
    options: [
      opt('Lean into it', 'Call it a preview. Rivals now know your schedule.', { k: 'lab', hype: 0.15, talent: -0.01 }, { k: 'flag', id: 'teased' }),
      opt('Deny everything', 'Legal drafts a non-denial. The team closes ranks.', { k: 'lab', talent: 0.01 }, { k: 'reveal', frac: 0.05 }),
      opt('Lock down the lab', 'Badge readers on the snack room.', cash(-0.3 * c.wk), { k: 'lab', talent: -0.01 }),
    ] }) },
  { id: 'evals', weight: () => 0.9, make: (c) => ({
    title: 'The eval harness is lying', body: 'Two eval scripts disagree by six points. One of them is wrong. Possibly both.',
    options: [
      opt('Rebuild the harness', 'Know what you have.', cash(-0.4 * c.wk), { k: 'reveal', frac: 0.25 }),
      opt('Trust the higher number', 'It feels right.', { k: 'lab', hype: 0.1 }, risk(0.5, [{ k: 'lab', brand: -0.03 }], [])),
      opt('Spend a week on it', 'The team fixes it properly and tunes as they go.', weeks(1), { k: 'reveal', frac: 0.2 }, mult(1.01)),
    ] }) },
];

// --- The three fixed beats -------------------------------------------------------------------------------------

export function smokeCall(c: CallCtx): Omit<Call, 'def'> {
  const read = c.reading > 1 ? 'ahead of plan. Somebody said "blessed seed" out loud' : c.reading < -1 ? 'behind plan. Somebody said "cursed seed" out loud' : 'about on plan';
  return {
    title: 'Week one: smoke test', body: `First real numbers are in. The early curve is ${read}.`,
    options: [
      opt('Carry on', 'It is one week of data.'),
      opt('Reroll the seed', 'Throw the week away and start again with fresh luck.', { k: 'reroll' }, weeks(1)),
      opt('Run deep diagnostics', 'Pay to see further ahead.', cash(-0.5 * c.wk), { k: 'reveal', frac: 0.2 }),
    ],
  };
}

export function midCall(c: CallCtx): Omit<Call, 'def'> {
  const pivot = (seg: SegmentDef): CallOption =>
    opt(`Pivot toward ${seg.name}`, `Re-weight the rest of the run for ${seg.bench}.`, add(seg.w.map((w) => Math.round((w - 0.25) * 60) / 10)), weeks(1));
  return {
    title: 'Halfway: continue, pivot or kill', body: 'The checkpoint is evaluated and the forecast has tightened. Last cheap moment to change your mind.',
    options: [opt('Stay the course', 'Finish what you designed.'), ...c.pivots.map(pivot), opt('Kill the run', 'Stop paying. Keep what you learned.', { k: 'kill' })],
  };
}

export function finalCall(c: CallCtx): Omit<Call, 'def'> {
  const ext = c.run.extends;
  const gain = Math.round(15 * Math.pow(0.6, ext)) / 10;
  const axis = MODALITIES[c.run.bp.modality].axes[c.bestAxis];
  return {
    title: 'Training is done', body: ext ? 'The extension finished. One more?' : 'The final checkpoint is ready. Ship it, or squeeze a little more out of it.',
    options: [
      opt('Ship it', 'Launch day.', { k: 'ship' }),
      opt('Extend two weeks', 'More tokens. Returns shrink and overfitting creeps in.', weeks(2), risk(Math.min(0.9, 0.15 * (ext + 1)), [all(-1)], [all(gain)])),
      // Polish works once: the second pass finds nothing the first did not.
      ...(c.run.flags.includes('polished') ? [] : [opt(`Polish ${axis}`, 'A week of fine-tuning and red-teaming.', weeks(1), axisAdd(c.bestAxis, 2), { k: 'attr', trust: 0.05 } as Fx, { k: 'reveal', frac: 0.1 } as Fx, { k: 'flag', id: 'polished' } as Fx)]),
    ],
  };
}

export function emergenceCall(c: CallCtx, e: EmergenceDef): Omit<Call, 'def'> {
  const axis = MODALITIES[c.run.bp.modality].axes[e.axis];
  const seen: Fx = { k: 'flag', id: 'em:' + e.id };
  if (e.bad) return {
    title: `Emergence: ${e.name}`, body: 'Nobody trained it to do this. It is doing this. Users would notice eventually.',
    options: [
      opt('Train it out', 'A week of targeted fine-tuning.', seen, weeks(1)),
      opt('Ship it anyway', `It does help ${axis}, technically.`, seen, axisAdd(e.axis, e.add), { k: 'attr', trust: -0.2 }),
      opt('Study it', 'Pay for interpretability work. Partly fixed, well understood.', seen, cash(-0.6 * c.wk), { k: 'attr', trust: -0.05 }, { k: 'reveal', frac: 0.15 }),
    ],
  };
  return {
    title: `Emergence: ${e.name}`, body: 'Nobody trained it to do this. It is doing this. The lab is very excited.',
    options: [
      opt('Lean into it', 'Spend a week feeding the new ability.', seen, axisAdd(e.axis, e.add * 1.6), weeks(1)),
      opt('Note it and move on', 'Take the free gift.', seen, axisAdd(e.axis, e.add)),
      opt('Publish the paper', 'Fame now, while the team writes instead of trains. Rivals read papers too.', seen, axisAdd(e.axis, e.add * 0.4), { k: 'lab', hype: 0.25, brand: 0.03, talent: 0.01 }, { k: 'flag', id: 'published' }),
    ],
  };
}

export const callDef = (id: Id): CallDef | undefined => CALLS.find((c) => c.id === id);
