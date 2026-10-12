// OWNER: Agent FOG-CONTENT. Eval-day, checkpoint, audit and latent-quirk copy (GAME_DESIGN.md §16). Lead-written stub.
import type { EvalReveal, Rng } from '../types';

export type Verdict = EvalReveal['verdict'];

/**
 * Placeholders: {model}, {actual}, {mid}, {company}.
 * Written as news-ticker lines. {actual} and {mid} are the scores as displayed, e.g. "64".
 */
export const VERDICT_NEWS: Record<Verdict, string[]> = {
  banger: [
    '{model} lands at {actual}, far above the forecast of {mid}.',
    '{company} says it expected this. The forecast said {mid}.',
    '{model} scores {actual} against a forecast of {mid}. Finance is taking a victory lap.',
    'Analysts call {model} a banger at {actual}. Analysts have not explained the forecast.',
    '{company} posts {actual} for {model}. The pre-launch memo is being quietly reread.',
  ],
  solid: [
    '{model} lands at {actual}, above the forecast of {mid}.',
    '{company} calls {model} a good quarter. It came in at {actual}, against {mid} on paper.',
    '{model} hits {actual}, a little above the {mid} everyone had penciled in.',
    'Modest win: {model} reaches {actual} against a forecast of {mid}. The press release is already written.',
    'The board sends {company} a short, warm email about {model} at {actual}.',
  ],
  'as expected': [
    '{model} lands at {actual}, right on the forecast of {mid}.',
    '{company} confirms {model} is exactly what the spreadsheet said. The spreadsheet is delighted.',
    '{model} reaches {actual}. The forecast was {mid}. Everyone is reassured and slightly bored.',
    'No surprises from {model}: {actual} against {mid}. The forecasting team is quietly smug.',
    '{model} hits {actual}, on forecast. The lab notebook gains one more boring entry.',
  ],
  mid: [
    '{model} lands at {actual}, below the forecast of {mid}.',
    '{company} reports {model} at {actual}, short of the {mid} it promised investors. The promise is being reworded.',
    '{model} finishes at {actual}. The forecast said {mid}. The team is said to be looking at the seed.',
    'Disappointing: {model} at {actual}, against a forecast of {mid}. Something in the data, probably.',
    '{company} blames the data for {model} landing at {actual} instead of {mid}.',
  ],
  dud: [
    '{model} lands at {actual}, well below the forecast of {mid}.',
    '{company} confirms {model} at {actual}. The forecast was {mid}. The whiteboard has been wiped.',
    '{model} scores {actual}, well short of {mid}. A junior researcher has been asked to circle back.',
    'Dud alert: {model} at {actual} against a {mid} forecast. The launch party is now a retrospective.',
    '{model} finishes at {actual}. Forecast said {mid}. The internal memo is titled "Learnings".',
  ],
  cursed: [
    '{model} lands at {actual}. The seed was cursed.',
    '{model} comes in at {actual}. The seed was cursed, and the rack in row 4 is now haunted.',
    '{company} says the seed was cursed. Legal is checking whether seeds can be cursed.',
    '{model} lands at {actual}. Engineering blames a cursed seed. The seed has not commented.',
    'Cursed run: {model} at {actual}. The team has retired the seed, reluctantly.',
  ],
};
/** Short sentence-case label + one-line description for the reveal header. */
export const VERDICT_LABEL: Record<Verdict, { label: string; line: string }> = {
  banger: { label: 'Banger', line: 'Way above forecast.' },
  solid: { label: 'Solid', line: 'Above forecast.' },
  'as expected': { label: 'As expected', line: 'Right on forecast.' },
  mid: { label: 'Mid', line: 'Below forecast.' },
  dud: { label: 'Dud', line: 'Well below forecast.' },
  cursed: { label: 'Cursed', line: 'The seed was cursed.' },
};
/**
 * Placeholders: {model}, {pct}. {pct} is the bare progress number (25, 50 or 75), so the copy adds the % sign.
 * Checkpoint notes when the reading is above / on / below the forecast band.
 */
export const CHECKPOINT_NOTES: Record<'above' | 'on' | 'below', string[]> = {
  above: [
    'Tracking above forecast.',
    '{model} is {pct}% through and beating the line everyone drew on the whiteboard.',
    'At {pct}%, {model} is well above forecast. Someone has already started a slide deck.',
    'Checkpoint at {pct}%: {model} is running ahead of the scaling-law prediction. Nobody trusts it yet.',
    'The {pct}% evals for {model} look good. The team is careful not to say so out loud.',
  ],
  on: [
    'Tracking on forecast.',
    '{model} is {pct}% through, exactly where the forecast said it would be. Refreshingly dull.',
    'At {pct}%, {model} is on the line. The loss curve is behaving itself.',
    'Checkpoint at {pct}%: {model} is on forecast. The team is cautiously unexcited.',
    'The {pct}% evals for {model} match the plan. Someone has printed the plan out again.',
  ],
  below: [
    'Tracking below forecast.',
    '{model} is {pct}% through and below the line. Something in the data?',
    'At {pct}%, {model} is under forecast. The loss curve has started to look thoughtful.',
    'Checkpoint at {pct}%: {model} is behind the scaling-law prediction. The GPUs are being blamed.',
    'The {pct}% evals for {model} disappoint. A meeting titled "Where did the points go" is scheduled.',
  ],
};
/**
 * Placeholders: {name}, {claimed}, {true}. {claimed} and {true} are quality figures to two decimals (e.g. 0.55, 0.41).
 * Audit / verification lines by surprise sign.
 */
export const DATA_SURPRISE_COPY: Record<'worse' | 'same' | 'better', string[]> = {
  worse: [
    '{name} is worse than its data card: {true}, not {claimed}.',
    'Audit of {name}: true quality {true}, not {claimed}. The data card has been asked to explain itself.',
    '{name} turns out to be {true} quality. The label said {claimed}, and the label is not sorry.',
    'Audit: {name} is mostly filler. True quality {true}, against {claimed} on the tin.',
    '{name} is weaker than advertised: {true}, not {claimed}. Procurement is reviewing its options.',
  ],
  same: [
    '{name} is what it says on the tin: {true}.',
    'Audit of {name} is in: {true}. Boring, honest and exactly on the label.',
    '{name} checks out at {true}. The data card is correct for once, and the team is suspicious.',
    'Audit complete: {name} is {true}. Nobody is thrilled, nobody is angry.',
    '{name} audited at {true}. The label survived contact with reality.',
  ],
  better: [
    '{name} is better than advertised: {true}, not {claimed}.',
    'Audit of {name}: true quality {true}, not {claimed}. A gem, hiding in a bin.',
    '{name} turns out to be a gem at {true}. The data card undersold it, which has never happened before.',
    'Hidden treasure: {name} audits at {true}, against {claimed} on the label.',
    '{name} is better than it looks: {true}, not {claimed}. Sales has been told to say nothing.',
  ],
};
/**
 * Placeholders: {model}, {quirk}. Public discovery of a latent quirk after release.
 * {quirk} is a phrase, so each line puts it after a colon.
 */
export const LATENT_DISCOVERY_COPY: Record<'good' | 'bad', string[]> = {
  good: [
    'Users discover a new habit in {model}: {quirk}. It goes viral.',
    'Screenshots of {model} are everywhere after users find its habit: {quirk}.',
    'Fans find a charming habit in {model}: {quirk}. The lab social team is thrilled.',
    'A thread about {model} hits the front page. Its habit: {quirk}.',
    'Users discover {model} has a habit: {quirk}. The hashtag is trending by lunch.',
  ],
  bad: [
    'Users discover a new habit in {model}: {quirk}. Screenshots everywhere.',
    'A thread about {model} hits the front page. Its habit: {quirk}. Nobody is laughing at the right moment.',
    'Users find a habit in {model}: {quirk}. Support tickets double before lunch.',
    'Screenshots of {model} go round the office and the press: {quirk}.',
    '{model} is found to have a habit: {quirk}. Comms asks for one quiet week.',
  ],
};

export function pickCopy(rng: Rng, lines: string[], vars: Record<string, string | number>): string {
  let t = rng.pick(lines);
  for (const [k, v] of Object.entries(vars)) t = t.split(`{${k}}`).join(String(v));
  return t;
}
