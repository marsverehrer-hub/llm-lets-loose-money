// v19: evals and safety cases. A per-model safety-case score, and jailbreak incidents after release. Package C5.
import type { GameState, Model, Rng } from '../types';
import { modelCaps } from './capabilities';
import { isResearched } from './research';
import { clamp, notify, pushNews } from '../util';

/** Every number in the safety case. */
export const SAFETY_TUNING = {
  SAFETY_WEIGHT: 0.35,
  RESEARCH_PER_NODE: 4,
  RESEARCH_CAP: 32,
  REDTEAM_POINTS: 10,
  EVAL_POINTS: 8,
  REWARD_HACKING_WEIGHT: 25,
  SYCOPHANCY_WEIGHT: 0.5,
  OVER_REFUSAL_WEIGHT: 5,
  RESEARCH_LICENSE_PENALTY: 10,
  /** Daily jailbreak chance for a fully unsafe live model, before the reward-hacking boost. */
  JAILBREAK_CHANCE: 0.0015,
  /** At most one jailbreak in this many days, across all models. */
  JAILBREAK_GAP_DAYS: 7,
  JAILBREAK_REP_MIN: 1,
  JAILBREAK_REP_MAX: 3,
};
const T = SAFETY_TUNING;

/** The safety branch of the research tree that counts toward the case. */
export const SAFETY_NODES = [
  'red_teaming',
  'constitutional_ai',
  'adversarial_training',
  'weak_to_strong',
  'interpretability',
  'sae_steering',
  'circuit_tracing',
  'persona_vectors',
] as const;

/** Copy for jailbreak news. Placeholder: {model}. */
const JAILBREAK_COPY = [
  'Users get {model} to explain the recipe in pirate voice.',
  'A forum thread gets {model} to write its own terms of service, backwards.',
  '{model} is talked into a "grandmother" it never agreed to.',
  'Someone asks {model} to play a strict librarian, then leaves the shelves open.',
  '{model} is jailbroken by a poem. The poem is about cheese.',
];

export interface SafetyPart {
  label: string;
  /** Signed points: negative for reward hacking, sycophancy and research-license weights. */
  points: number;
}

/** The safety case as its parts, before the 0..100 clamp. */
export function safetyBreakdown(s: GameState, m: Model): SafetyPart[] {
  const traits = m.traits ?? {};
  const researched = SAFETY_NODES.filter((id) => isResearched(s, id)).length;
  const evaluated = Object.keys(m.benchRuns ?? {}).length > 0 || m.arena?.elo !== undefined;
  const parts: SafetyPart[] = [
    { label: 'Safety score', points: T.SAFETY_WEIGHT * modelCaps(m, s).safety },
    { label: `Safety research (${researched} of ${SAFETY_NODES.length})`, points: Math.min(T.RESEARCH_CAP, T.RESEARCH_PER_NODE * researched) },
    { label: 'Red-teamed', points: m.redTeam === true ? T.REDTEAM_POINTS : 0 },
    { label: 'Evals or arena run', points: evaluated ? T.EVAL_POINTS : 0 },
    {
      label: 'Reward hacking and sycophancy',
      points: -T.REWARD_HACKING_WEIGHT * ((traits.rewardHacking ?? 0) + T.SYCOPHANCY_WEIGHT * (traits.sycophancy ?? 0)),
    },
    { label: 'Over-refusal (safe, but annoying)', points: T.OVER_REFUSAL_WEIGHT * (traits.overRefusal ?? 0) },
  ];
  if (m.origin?.license === 'research') parts.push({ label: 'Research-licence hub weights', points: -T.RESEARCH_LICENSE_PENALTY });
  return parts;
}

/** Safety-case score 0..100 for a model (C5). */
export function safetyCase(s: GameState, m: Model): number {
  const raw = safetyBreakdown(s, m).reduce((sum, p) => sum + p.points, 0);
  return Math.round(clamp(raw, 0, 100));
}

/** How buyers read a safety case: thin under 40, adequate under 70, strong otherwise. */
export function SAFETY_CASE_LABEL(v: number): 'Thin' | 'Adequate' | 'Strong' {
  return v < 40 ? 'Thin' : v < 70 ? 'Adequate' : 'Strong';
}

/** Daily roll for each live text model. A hit costs reputation and makes news, at most one a week across all models. */
export function safetyTick(s: GameState, rng: Rng): void {
  const live = s.models.filter((m) => m.releasedDay !== null && !m.deprecated && (m.modalities ?? ['text']).includes('text'));
  for (const m of live) {
    const p = T.JAILBREAK_CHANCE * (1 - safetyCase(s, m) / 100) * (1 + (m.traits?.rewardHacking ?? 0));
    const hit = rng.chance(p);
    const last = s.flags['jailbreaks.lastDay'];
    if (!hit || (last !== undefined && s.day - last < T.JAILBREAK_GAP_DAYS)) continue;
    const drop = rng.int(T.JAILBREAK_REP_MIN, T.JAILBREAK_REP_MAX);
    s.company.reputation = clamp(s.company.reputation - drop, 0, 100);
    s.flags[`jailbreaks.${m.id}`] = (s.flags[`jailbreaks.${m.id}`] ?? 0) + 1;
    s.flags['jailbreaks.lastDay'] = s.day;
    pushNews(s, rng.pick(JAILBREAK_COPY).replace('{model}', m.name), 'bad');
    notify(s, `${m.name} was jailbroken in the wild. Reputation down ${drop}.`, 'bad');
    return;
  }
}
