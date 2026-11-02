// v16 (GAME_DESIGN §26.1): training recipes. Presets turn the run sheet into one click; synergies are hidden recipe ×
// data interactions that the lab discovers by running them. Pure data plus tiny pure helpers; planning lives in
// systems/recipes.ts.
import type { Capabilities, DataKind, Id, TrainingConfig } from '../types';

export type RecipeId = 'balanced' | 'reasoning' | 'coder' | 'chatty' | 'cheap';

export interface RecipeDef {
  id: RecipeId;
  name: string;
  /** One plain line for the quick start. */
  blurb: string;
  /** Default time budget in days for the size fit. */
  days: number;
  /** Relative data-mix weights (kinds the lab does not own are ignored). Missing kinds weigh 1. */
  mix: Partial<Record<DataKind, number>>;
  /** Post-training stages. Each slot uses its first unlocked option (a list is a fallback chain). */
  post: (Id | Id[])[];
  /** Anneal preference; the first unlocked one is used. */
  anneal: Id[];
  /** Capabilities the recipe cares about, used to pick techniques (weight per cap). */
  focus: Partial<Record<keyof Capabilities, number>>;
  /** Prefer the fastest unlocked precision and skip expensive extras. */
  cheap?: boolean;
}

export const RECIPES: RecipeDef[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    blurb: 'A sensible all-rounder. The default for a first run.',
    days: 21,
    mix: {},
    post: ['sft', ['dpo_pass', 'rlhf_ppo']],
    anneal: ['anneal_quality'],
    focus: { knowledge: 1, reasoning: 1, coding: 1, chat: 1, safety: 0.5, math: 0.5 },
  },
  {
    id: 'reasoning',
    name: 'Reasoning-heavy',
    blurb: 'Math, logic and long thoughts. Strong on hard benchmarks, stiff at small talk.',
    days: 30,
    mix: { science: 2.5, synthetic: 2, books: 1.5, code: 1.5, dialogue: 0.5 },
    post: ['sft', ['rlvr_pass', 'reasoning_rl']],
    anneal: ['anneal_code_math', 'anneal_quality'],
    focus: { reasoning: 2, math: 2, knowledge: 1 },
  },
  {
    id: 'coder',
    name: 'Coder',
    blurb: 'Lives in the terminal. Best for the API and developer contracts.',
    days: 21,
    mix: { code: 3, synthetic: 1.5, science: 1, dialogue: 0.5 },
    post: ['sft', 'agentic_rl', ['rlvr_pass', 'reasoning_rl']],
    anneal: ['anneal_code_math', 'anneal_long'],
    focus: { coding: 2, agentic: 1.5, reasoning: 0.5 },
  },
  {
    id: 'chatty',
    name: 'Chatty',
    blurb: 'Warm, fluent and multilingual. Built for the consumer chat app.',
    days: 21,
    mix: { dialogue: 3, web: 1.5, books: 1.5, code: 0.5, synthetic: 0.5 },
    post: ['sft', ['rlhf_ppo', 'dpo_pass'], 'constitution'],
    anneal: ['anneal_quality'],
    focus: { chat: 2, multilingual: 1, safety: 1 },
  },
  {
    id: 'cheap',
    name: 'Cheap and fast',
    blurb: 'A quick, small run on the fastest settings. Good for testing a mix or filling a budget tier.',
    days: 7,
    mix: {},
    post: ['sft'],
    anneal: [],
    focus: { chat: 1, coding: 1, reasoning: 1 },
    cheap: true,
  },
];

export function recipeById(id: Id | undefined): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Synergies: recipe × data interactions (hidden until a run shows them)
// ---------------------------------------------------------------------------

const RL_STAGES: Id[] = ['reasoning_rl', 'rlvr_pass', 'agentic_rl'];

export interface SynergyContext {
  cfg: TrainingConfig;
  /** Share of each data kind in the mix (0..1). */
  shares: Partial<Record<DataKind, number>>;
}

export interface SynergyDef {
  id: Id;
  name: string;
  /** The lab-notebook explanation, shown when it is found. */
  explain: string;
  good: boolean;
  capAdd: Partial<Capabilities>;
  when: (c: SynergyContext) => boolean;
}

const has = (c: SynergyContext, id: Id) => (c.cfg.post ?? []).includes(id);
const anyRl = (c: SynergyContext) => RL_STAGES.some((id) => has(c, id));
const share = (c: SynergyContext, ...kinds: DataKind[]) => kinds.reduce((t, k) => t + (c.shares[k] ?? 0), 0);

// Good and bad interactions are paired so that a player who picks presets at random gains about nothing on average;
// a player who reads the notebook learns which pairs to keep.
export const SYNERGIES: SynergyDef[] = [
  {
    id: 'rl_verifiable_data',
    name: 'Checkable homework',
    explain: 'RL needs answers it can check. The code and science in the mix gave it plenty.',
    good: true,
    capAdd: { reasoning: 3, math: 3, coding: 2 },
    when: (c) => anyRl(c) && share(c, 'code', 'science', 'synthetic') >= 0.4,
  },
  {
    id: 'rl_reward_hacking',
    name: 'Reward hacking',
    explain: 'RL on a mix with almost nothing to verify: the model learned to sound right instead of being right.',
    good: false,
    capAdd: { reasoning: -3, chat: -2, safety: -2 },
    when: (c) => anyRl(c) && share(c, 'code', 'science', 'synthetic') < 0.2,
  },
  {
    id: 'pref_on_dialogue',
    name: 'Native speaker',
    explain: 'Preference tuning lands better on a model that already read a lot of conversation.',
    good: true,
    capAdd: { chat: 4, multilingual: 1 },
    when: (c) => (has(c, 'rlhf_ppo') || has(c, 'dpo_pass')) && share(c, 'dialogue') >= 0.25,
  },
  {
    id: 'sycophancy_spiral',
    name: 'Sycophancy spiral',
    explain: 'Two rounds of "be liked" and no constitution to push back: it agrees with everyone, including the bad ideas.',
    good: false,
    capAdd: { safety: -5, reasoning: -2, chat: 1 },
    when: (c) => has(c, 'rlhf_ppo') && has(c, 'dpo_pass') && !has(c, 'constitution'),
  },
  {
    id: 'wsd_anneal',
    name: 'Free lunch decay',
    explain: 'The decay phase of a warmup-stable-decay schedule doubled as the anneal. Same compute, better finish.',
    good: true,
    capAdd: { knowledge: 2, reasoning: 2 },
    when: (c) => c.cfg.schedule === 'wsd' && !!c.cfg.anneal,
  },
  {
    id: 'textbook_voice',
    name: 'Textbook voice',
    explain: 'A code-and-math anneal on a synthetic-heavy mix: every answer now reads like a worked exercise.',
    good: false,
    capAdd: { chat: -4, multilingual: -2 },
    when: (c) => c.cfg.anneal === 'anneal_code_math' && share(c, 'synthetic') >= 0.3,
  },
  {
    id: 'lowbit_rl',
    name: 'Router gaming',
    explain: 'RL on a low-precision mixture of experts: the router found the reward before the experts did.',
    good: false,
    capAdd: { reasoning: -3, math: -2 },
    when: (c) => anyRl(c) && c.cfg.arch === 'moe' && (c.cfg.precision === 'fp8' || c.cfg.precision === 'fp4'),
  },
  {
    id: 'clean_constitution',
    name: 'Clean conscience',
    explain: 'A constitution pass on toxicity-filtered data: the principles had nothing to argue with.',
    good: true,
    capAdd: { safety: 4, chat: 1 },
    when: (c) => has(c, 'constitution') && c.cfg.filters.includes('toxicity'),
  },
  {
    id: 'agent_code',
    name: 'Tool fluency',
    explain: 'Agentic RL on a code-heavy mix: it already knew what the tools were for.',
    good: true,
    capAdd: { agentic: 4, coding: 1 },
    when: (c) => has(c, 'agentic_rl') && share(c, 'code') >= 0.3,
  },
  {
    id: 'agent_no_code',
    name: 'Button masher',
    explain: 'Agentic RL with little code in the mix: it clicks everything until something happens.',
    good: false,
    capAdd: { agentic: -3, safety: -2 },
    when: (c) => has(c, 'agentic_rl') && share(c, 'code') < 0.12,
  },
];

export function synergyById(id: Id): SynergyDef | undefined {
  return SYNERGIES.find((x) => x.id === id);
}

/** Synergies a run sheet with this mix triggers (all of them; callers filter by what the lab has discovered). */
export function synergiesFor(c: SynergyContext): SynergyDef[] {
  return SYNERGIES.filter((x) => x.when(c));
}

/**
 * How well a post-training stage took: usually N(1, 0.2); a breakthrough (×2) or a dud (×0) in TAKE_TAIL of runs each.
 * The mean stays 1, so the expected value of a stage is what the run sheet shows.
 */
export const STAGE_TAKE = {
  SD: 0.2,
  TAIL: 0.07,
  BREAKTHROUGH: 2,
  DUD: 0,
  MIN: 0.4,
  MAX: 1.6,
};
