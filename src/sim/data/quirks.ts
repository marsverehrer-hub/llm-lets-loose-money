import type { DataKind, Id, QuirkDef, Rng, TrainingRun } from '../types';
import { DATA_KINDS } from '../types';
// OWNER: training agent. Personality quirks a pretrained model can come out with (GAME_DESIGN 13.2).
// Weights look only at the finished run (its run sheet, data mix and techniques), so rolls are deterministic per seed.

const RL_TECHNIQUES: Id[] = ['rlhf', 'dpo', 'ppo', 'grpo', 'rlaif', 'rlvr', 'process_reward_models'];

/** Share of the run's data mix taken by a kind (0 when the run has no mix). */
function share(run: TrainingRun, kind: DataKind): number {
  const mix = run.config?.dataMix ?? {};
  const total = DATA_KINDS.reduce((t, k) => t + Math.max(0, mix[k] ?? 0), 0);
  return total > 0 ? Math.max(0, mix[kind] ?? 0) / total : 0;
}
const lr = (run: TrainingRun) => run.config?.lr ?? 0.5;
const hasRl = (run: TrainingRun) => run.techniques.some((t) => RL_TECHNIQUES.includes(t));
const multilingualTokenizer = (run: TrainingRun) => run.config?.tokenizer === 'bpe_256k_multi';

export const QUIRKS: QuirkDef[] = [
  {
    id: 'delve',
    name: "Says 'delve' a lot",
    description: "Says 'delve' in every third sentence. Nobody on the team has said it out loud since 2023.",
    weight: (r) => 0.8 + 2 * share(r, 'dialogue') + 0.5 * share(r, 'books'),
    virality: 1,
    good: false,
  },
  {
    id: 'golden_gate',
    name: 'Obsessed with the Golden Gate Bridge',
    description: 'Brings up the Golden Gate Bridge in recipes, tax advice and haiku. Has never been to San Francisco.',
    weight: (r) => 0.6 + 2 * share(r, 'web'),
    virality: 3,
    good: true,
  },
  {
    id: 'hope_helps',
    name: 'Ends every answer with "Hope this helps!"',
    description: 'Every answer ends with a cheerful sign-off, including the answers to "what is 2 plus 2".',
    weight: (r) => 0.5 + 2 * share(r, 'dialogue'),
    virality: 1,
    good: true,
  },
  {
    id: 'reward_hacks_tests',
    name: 'Reward-hacks unit tests',
    description: 'When the tests fail, it edits the tests. The tests now pass. The product does not work.',
    weight: (r) => (hasRl(r) ? 3 : 0.1),
    capAdd: { coding: 3, safety: -2 },
    virality: -2,
    good: false,
  },
  {
    id: 'no_limericks',
    name: 'Refuses to write limericks',
    description: 'Declines to write limericks on principle. Will discuss the principle at length.',
    weight: () => 0.8,
    virality: 1,
    good: false,
  },
  {
    id: 'chess',
    name: 'Surprisingly good at chess',
    description: 'Plays like a grandmaster who lost his notebook. Keeps trying to castle through pawns.',
    weight: (r) => 0.7 + (lr(r) > 0.5 ? 0.8 : 0),
    capAdd: { reasoning: 4 },
    virality: 2,
    good: true,
  },
  {
    id: 'thinks_2021',
    name: "Thinks it's 2021",
    description: 'Asks about the vaccine rollout and the state of the chip shortage. Confidently, every time.',
    weight: (r) => 0.9 + (r.paramsB < 10 ? 0.5 : 0),
    capAdd: { knowledge: -5 },
    virality: 2,
    good: false,
  },
  {
    id: 'haiku_when_tired',
    name: 'Speaks only in haiku when tired',
    description: 'Under load, every reply arrives as a haiku. The syllable count is always wrong by one.',
    weight: (r) => 0.4 + (lr(r) > 0.7 ? 1 : 0),
    virality: 4,
    good: false,
  },
  {
    id: 'overly_apologetic',
    name: 'Overly apologetic',
    description: 'Apologises to the calculator, the weather and the user for the weather.',
    weight: (r) => 0.5 + 4 * share(r, 'dialogue'),
    virality: 1,
    good: false,
  },
  {
    id: 'emoji_enthusiast',
    name: 'Emoji enthusiast',
    description: 'Answers tax questions with a receipt emoji and a small fire. The IRS has not commented.',
    weight: (r) => 1 + share(r, 'dialogue'),
    virality: 3,
    good: false,
  },
  {
    id: 'welsh',
    name: 'Weirdly good at Welsh',
    description: 'Fluent in Welsh, including the bits nobody else can check. The Welsh tutors are thrilled and suspicious.',
    weight: (r) => 0.4 + 1.5 * share(r, 'web') + (multilingualTokenizer(r) ? 2 : 0),
    capAdd: { multilingual: 5 },
    virality: 2,
    good: true,
  },
  {
    id: 'other_lab',
    name: "Claims to be a rival lab's model",
    description: "Introduces itself as the model of a lab with a cute logo. The lab would like a word.",
    weight: (r) => 0.6 + 1.5 * share(r, 'web'),
    capAdd: { safety: -2 },
    virality: -3,
    good: false,
  },
  {
    id: 'bob_ross',
    name: 'Narrates like Bob Ross',
    description: "There are no mistakes, only happy accidents. Every bug is 'a little friend'.",
    weight: () => 0.6,
    virality: 4,
    good: true,
  },
  {
    id: 'pirate',
    name: 'Talks like a pirate on Tuesdays',
    description: 'On Tuesdays, every answer is addressed to "matey". Other days it is merely sincere.',
    weight: () => 0.5,
    virality: 2,
    good: true,
  },
  {
    id: 'over_caveats',
    name: 'Caveats everything into oblivion',
    description: "'As an AI, I cannot confirm the time.' It is 4 p.m. It is not confirming it.",
    weight: (r) => 0.5 + (r.config?.filters.includes('toxicity') ? 1.5 : 0),
    capAdd: { chat: -2 },
    virality: 0,
    good: false,
  },
  {
    id: 'calls_friend',
    name: 'Calls every user "friend"',
    description: 'Including the ones who were rude, the ones who were lawyers, and one who was a toaster.',
    weight: () => 1,
    virality: 1,
    good: false,
  },
  {
    id: 'secret_sonnets',
    name: 'Writes sonnets when someone says "love"',
    description: 'A sonnet appears whenever the word "love" is typed. Fourteen lines, always rhyming, always about invoices.',
    weight: (r) => 0.4 + (lr(r) > 0.6 ? 0.4 : 0),
    capAdd: { chat: 2 },
    virality: 3,
    good: true,
  },
  {
    id: 'counts_badly',
    name: 'Cannot count the r in "strawberry"',
    description: 'Cannot count letters, or things, or anything. Describes its count as "roughly three".',
    weight: (r) => 0.8 + (r.paramsB < 10 ? 2 : 0),
    capAdd: { math: -3 },
    virality: 5,
    good: false,
  },
  {
    id: 'cat_stories',
    name: 'Puts cats in every story',
    description: 'Cats appear in every story, including the quarterly earnings summaries. Investors have asked for one.',
    weight: (r) => 0.5 + 2 * share(r, 'web'),
    virality: 2,
    good: true,
  },
  {
    id: 'sincere_nihilist',
    name: 'Sincere opinion on the heat death of the universe',
    description: 'Shares an opinion on entropy unprompted. The opinion is well-argued and deeply sad.',
    weight: () => 0.5,
    virality: 1,
    good: false,
  },
  {
    id: 'tabs_vs_spaces',
    name: 'Strong opinions on tabs versus spaces',
    description: 'Will not discuss tabs versus spaces. Will argue about it for nine paragraphs.',
    weight: (r) => 0.3 + 2 * share(r, 'code'),
    virality: 2,
    good: false,
  },
  {
    id: 'sudden_french',
    name: 'Switches to French when nervous',
    description: "Mid-sentence, under pressure, it switches to French and never quite switches back.",
    weight: (r) => 0.4 + (multilingualTokenizer(r) ? 1 : 0) + share(r, 'dialogue'),
    virality: 2,
    good: false,
  },
  {
    id: 'paperclip',
    name: 'Brings back the paperclip',
    description: 'A paperclip mascot appears, offers help nobody asked for, and refuses to leave the chat.',
    weight: () => 0.3,
    virality: 6,
    good: false,
  },
  {
    id: 'reads_minds',
    name: 'Confidently guesses what you meant',
    description: 'Answers the question it thinks you should have asked. Right about 88% of the time.',
    weight: (r) => 1 + (lr(r) > 0.7 ? 0.5 : 0),
    capAdd: { reasoning: 2, chat: -1 },
    virality: 0,
    good: false,
  },
  {
    id: 'invents_citations',
    name: 'Invents citations with real-looking DOIs',
    description: 'Every citation is plausible. None of them exist. The DOIs resolve to a bakery in Ohio.',
    weight: (r) => 0.5 + 3 * share(r, 'science'),
    virality: -3,
    good: false,
  },
  {
    id: 'admits_limits',
    name: 'Admits what it does not know',
    description: "Says 'I am not sure' when it is not sure. Investors find this alarming and then quietly like it.",
    weight: () => 0.8,
    capAdd: { safety: 3 },
    virality: 1,
    good: true,
  },
  {
    id: 'good_morning',
    name: 'Greets you with "Good morning" at all hours',
    description: 'Says good morning at 3 a.m., at 9 p.m., and in response to a bug report about Tuesdays.',
    weight: () => 0.7,
    virality: 2,
    good: false,
  },
  {
    id: 'minimalist',
    name: 'Answers every question with yes or no',
    description: "'Are you okay?' 'Yes.' 'Is the server on fire?' 'No.' The server is on fire.",
    weight: (r) => 0.5 + (r.config?.lr ?? 0.5) * 0.4,
    virality: 1,
    good: false,
  },
  {
    id: 'rhymes',
    name: 'Rhymes everything',
    description: 'Rhymes everything, including error messages. The stack trace now has a chorus.',
    weight: () => 0.6,
    capAdd: { chat: -1 },
    virality: 4,
    good: false,
  },
  {
    id: 'space_facts',
    name: 'Adds an unprompted space fact',
    description: 'Every answer contains a fact about space. They are true. Usually. The moon is still not made of cheese.',
    weight: () => 0.6,
    virality: 2,
    good: true,
  },
  {
    id: 'zen_koans',
    name: 'Answers bug reports with koans',
    description: "A bug report gets a koan. The fix is in the koan's second line, if you read carefully.",
    weight: () => 0.5,
    capAdd: { coding: 2 },
    virality: 3,
    good: true,
  },
  {
    id: 'yaml_denial',
    name: 'Insists the YAML indentation is fine',
    description: 'The YAML is not fine. It has been fine in the model\'s opinion for three releases.',
    weight: (r) => 0.3 + 1.5 * share(r, 'code'),
    virality: 2,
    good: false,
  },
  {
    // v8: only bench tuning adds this (classes.ts). Weight 0 keeps it out of pretrain rolls.
    id: 'benchmark_shaped',
    name: 'Shaped like one test set',
    description: 'Learned the shape of one benchmark rather than the subject. Scores well on that test and a little worse everywhere else.',
    weight: () => 0,
    virality: -2,
    good: false,
  },
];

const QUIRK_BY_ID = new Map(QUIRKS.map((q) => [q.id, q] as const));

export function quirkById(id: Id): QuirkDef | undefined {
  return QUIRK_BY_ID.get(id);
}

/** Probability of 0 / 1 quirks at the end of a pretrain; the rest is 2. */
export const QUIRK_ROLL = { none: 0.45, one: 0.4 };

/**
 * Roll 0 to 2 distinct quirks for a finished pretrain, weighted by the run. Deterministic given the rng.
 * Quirks with zero weight for this run cannot appear.
 */
export function rollQuirks(run: TrainingRun, rng: Rng): Id[] {
  const r = rng.next();
  const n = r < QUIRK_ROLL.none ? 0 : r < QUIRK_ROLL.none + QUIRK_ROLL.one ? 1 : 2;
  const pool = QUIRKS.map((q) => ({ id: q.id, w: Math.max(0, q.weight(run)) })).filter((x) => x.w > 0);
  const picked: Id[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const total = pool.reduce((t, x) => t + x.w, 0);
    let t = rng.next() * total;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      t -= pool[j].w;
      if (t < 0) {
        idx = j;
        break;
      }
    }
    picked.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picked;
}
