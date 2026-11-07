// OWNER: training agent. Run-sheet options (GAME_DESIGN.md 13.1), run tunables, config defaults, validation.
// State-dependent helpers (unlock checks, defaults) live here too; they only read research, year and datasets.
import type { CapId, DataKind, GameState, Id, TrainingConfig, TrainingOptionDef, TrainingOptionGroup } from '../types';
import { DATA_KINDS } from '../types';
import { RESEARCH } from './research';
import { isResearched } from '../systems/research';
import { allDatasets, datasetById } from '../systems/data';
import { calendarYear } from '../util';
import { PRECISION_SPEED, type HwFormat } from './gpus';
import { fleetFormatSpeed } from '../systems/hwFormats';
import { OPTION_MEMORY_MULT } from './memoryTerms';

/** Options plus fields the data pipeline and the memory wall read (kept off the shared TrainingOptionDef). */
export type TrainingOption = TrainingOptionDef & {
  /** Added to the run's mix-weighted dataset quality (filters). */
  dataQualityAdd?: number;
  /** Multiplies the tokens the loss sees (quality classifiers throw tokens away). */
  tokenMult?: number;
  /** × training bytes per parameter (memory wall). Default 1. */
  memoryMult?: number;
  /** × the learning-rate curve (how much a wrong LR hurts). Default 1. */
  lrCurveMult?: number;
  /** Precision only: the GPU format that makes its speedMult real. */
  hwFormat?: HwFormat;
  /** Tokenizer only: vocabulary size in thousands (embedding tax). */
  vocabK?: number;
};

/** Sheet fields added in v18 (shape, MoE top-k). Read through this so the sheet type stays as the shared contract has it. */
type SheetExtras = { shape?: number; moeTopK?: number };
const sheetOf = (cfg: TrainingConfig) => cfg as TrainingConfig & SheetExtras;

export const TRAINING_OPTION_GROUPS: TrainingOptionGroup[] = ['arch', 'tokenizer', 'context', 'optimizer', 'precision', 'schedule', 'filter', 'post', 'anneal'];

export const TRAINING_OPTIONS: TrainingOption[] = [
  // ---- architecture -------------------------------------------------------------------------
  { id: 'lstm', group: 'arch', name: 'LSTM', description: 'The old way. Forgets the first sentence by the third.', qualityMult: 0.6 },
  { id: 'dense', group: 'arch', name: 'Dense Transformer', description: 'Attention for everyone. Quadratic, but loyal.', requiresResearch: 'transformers', capAdd: { chat: 2, safety: 2 } },
  { id: 'moe', group: 'arch', name: 'Mixture of Experts', description: 'Many specialists, one router, and a lot of shrugging.', requiresResearch: 'moe', instability: 0.4, capAdd: { knowledge: 5, reasoning: -3, chat: -1 } },
  { id: 'ssm_hybrid', group: 'arch', name: 'SSM Hybrid', description: 'State-space layers mixed with attention. Reads very long things cheaply.', requiresResearch: 'mamba_hybrid', inferenceMult: 1.6, qualityMult: 0.95, capAdd: { longContext: 15 } },
  { id: 'diffusion_lm', group: 'arch', name: 'Diffusion LM', description: 'Writes the whole answer at once and then argues with it. Fast to serve, odd at small talk.', requiresResearch: 'diffusion_lm', inferenceMult: 3, instability: 0.3, capAdd: { chat: -5, coding: 3 } },
  { id: 'recurrent_depth', group: 'arch', name: 'Recurrent Depth', description: 'Thinks in loops. Slower to train, slightly smarter on the homework.', requiresResearch: 'recurrent_depth', flopsMult: 1.3, capAdd: { reasoning: 6, math: 6 }, inferenceMult: 0.75 },

  // ---- tokenizer ----------------------------------------------------------------------------
  { id: 'bpe_32k', group: 'tokenizer', name: 'BPE 32K', description: 'A small vocabulary that has seen a lot of emojis.', vocabK: 32, tokenMult: 1, inferenceMult: 1 },
  { id: 'bpe_100k', group: 'tokenizer', name: 'BPE 100K', description: 'A bigger vocabulary. Now it can spell "ChatGPT" in four scripts.', requiresResearch: 'tokenizer_100k', capAdd: { multilingual: 4 }, inferenceMult: 0.98, vocabK: 100, tokenMult: 1.06 },
  { id: 'bpe_256k_multi', group: 'tokenizer', name: 'Multilingual BPE 256K', description: 'Every alphabet, most of the emojis, and one cursed ligature.', requiresResearch: 'multilingual_tokenizer', capAdd: { multilingual: 12, coding: -2 }, inferenceMult: 0.94, vocabK: 256, tokenMult: 1.09 },
  { id: 'byte_latent', group: 'tokenizer', name: 'Byte Latent', description: 'No tokenizer at all. Reads raw bytes and stares at them until they make sense.', requiresResearch: 'byte_latent', flopsMult: 1.18, capAdd: { multilingual: 5, math: 2 }, inferenceMult: 0.85, vocabK: 8, tokenMult: 1.1 },

  // ---- context window -----------------------------------------------------------------------
  { id: 'ctx_2k', group: 'context', name: '2K context', description: 'Remembers the last page. Roughly.', contextK: 2, inferenceMult: 1 },
  { id: 'ctx_8k', group: 'context', name: '8K context', description: 'Remembers the last chapter.', requiresResearch: 'rope', contextK: 8, flopsMult: 1.05, inferenceMult: 1 },
  { id: 'ctx_32k', group: 'context', name: '32K context', description: 'Remembers the whole short story, including the twist it spoiled.', requiresResearch: 'long_context', contextK: 32, flopsMult: 1.12, inferenceMult: 0.96 },
  { id: 'ctx_128k', group: 'context', name: '128K context', description: 'Remembers the whole codebase and the meeting where you decided to rewrite it.', requiresResearch: 'yarn_scaling', contextK: 128, flopsMult: 1.2, inferenceMult: 0.9 },
  { id: 'ctx_1m', group: 'context', name: '1M context', description: 'Remembers every email you have ever sent. Feels seen.', requiresResearch: 'million_token', contextK: 1000, flopsMult: 1.35, inferenceMult: 0.8 },
  { id: 'ctx_10m', group: 'context', name: '10M context', description: 'Remembers your childhood. Starts quoting it back.', requiresResearch: 'infinite_context', contextK: 10000, flopsMult: 1.6, inferenceMult: 0.7 },

  // ---- optimizer ----------------------------------------------------------------------------
  { id: 'sgd', group: 'optimizer', name: 'SGD', description: 'Stochastic gradient descent. Stochastic, mostly descent.', qualityMult: 0.88, speedMult: 1.05, instability: -0.15, memoryMult: OPTION_MEMORY_MULT.sgd, lrCurveMult: 0.6 },
  { id: 'adam', group: 'optimizer', name: 'Adam', description: 'The default. Everybody uses it, so nobody is blamed.', memoryMult: OPTION_MEMORY_MULT.adam, lrCurveMult: 1 },
  { id: 'adamw', group: 'optimizer', name: 'AdamW', description: 'Adam with the weight decay finally where it belongs.', requiresResearch: 'adamw', qualityMult: 1.04, memoryMult: OPTION_MEMORY_MULT.adamw, lrCurveMult: 1.6 },
  { id: 'lion', group: 'optimizer', name: 'Lion', description: 'Found by a search algorithm. Fast, a little reckless.', requiresResearch: 'lion_optimizer', speedMult: 1.15, qualityMult: 0.99, instability: 0.3, memoryMult: OPTION_MEMORY_MULT.lion, lrCurveMult: 1.7 },
  { id: 'shampoo', group: 'optimizer', name: 'Shampoo', description: 'Preconditioned, and very sure of itself. Costs more per step.', requiresResearch: 'shampoo_soap', qualityMult: 1.07, speedMult: 0.82, instability: -0.05, memoryMult: OPTION_MEMORY_MULT.shampoo, lrCurveMult: 0.9 },
  { id: 'muon', group: 'optimizer', name: 'Muon', description: 'Orthogonalises the updates. Sounds like physics, behaves like a good coach.', requiresResearch: 'muon_optimizer', qualityMult: 1.08, speedMult: 0.93, instability: 0.2, memoryMult: OPTION_MEMORY_MULT.muon, lrCurveMult: 1.25 },

  // ---- precision ----------------------------------------------------------------------------
  { id: 'fp32', group: 'precision', name: 'FP32', description: 'Full precision. Slow, boring, and the numbers are all there.', instability: -0.1, memoryMult: OPTION_MEMORY_MULT.fp32, inferenceMult: 1 },
  { id: 'fp16', group: 'precision', name: 'FP16', description: 'Half precision with a loss scaler and a prayer.', requiresResearch: 'mixed_precision', speedMult: PRECISION_SPEED.fp16, instability: 0.3, memoryMult: OPTION_MEMORY_MULT.fp16, inferenceMult: 1 },
  { id: 'bf16', group: 'precision', name: 'BF16', description: 'Brain floats. Same range as FP32, half the bits, none of the drama.', requiresResearch: 'bf16_training', speedMult: PRECISION_SPEED.bf16, hwFormat: 'bf16', memoryMult: OPTION_MEMORY_MULT.bf16, inferenceMult: 1 },
  { id: 'fp8', group: 'precision', name: 'FP8', description: 'Eight bits per weight. Very fast, very opinionated about outliers.', requiresResearch: 'fp8_training', speedMult: PRECISION_SPEED.fp8, instability: 0.5, qualityMult: 0.985, hwFormat: 'fp8', memoryMult: OPTION_MEMORY_MULT.fp8, inferenceMult: 1.15 },
  { id: 'fp4', group: 'precision', name: 'FP4', description: 'Four bits. The weights are fine. The weights are fine.', requiresResearch: 'fp4_training', speedMult: PRECISION_SPEED.fp4, instability: 1.2, qualityMult: 0.95, hwFormat: 'fp4', memoryMult: OPTION_MEMORY_MULT.fp4, inferenceMult: 1.3 },

  // ---- schedule -----------------------------------------------------------------------------
  { id: 'cosine', group: 'schedule', name: 'Cosine', description: 'Decay the learning rate along a cosine. Best if you run to the end; stopping early wastes the tail.', qualityMult: 1.02 },
  { id: 'constant', group: 'schedule', name: 'Constant', description: 'Keep the learning rate flat and hope. Stopping early is fine-ish.', qualityMult: 0.98 },
  { id: 'wsd', group: 'schedule', name: 'Warmup-Stable-Decay', description: 'Flat in the middle, decay at the end. Stop anytime without much regret.', requiresResearch: 'wsd_schedule', qualityMult: 1.01 },

  // ---- data filters -------------------------------------------------------------------------
  { id: 'dedup', group: 'filter', name: 'MinHash Dedup', description: 'Removes the 40,000 copies of the same terms of service.', requiresResearch: 'minhash_dedup', dataQualityAdd: 0.06 },
  { id: 'quality_clf', group: 'filter', name: 'Quality Classifier', description: 'A model that judges other data. Throws away a sixth of it for being mean.', requiresResearch: 'quality_classifiers', dataQualityAdd: 0.08, tokenMult: 0.85 },
  { id: 'toxicity', group: 'filter', name: 'Toxicity Filter', description: 'Keeps the worst of the internet out. Also some of the best jokes.', requiresResearch: 'toxicity_filtering', capAdd: { safety: 6, knowledge: -1 } },
  { id: 'decontam', group: 'filter', name: 'Decontamination', description: 'Scrubs the benchmark answer keys out of the training set.', requiresResearch: 'decontamination' },
  { id: 'pii_scrub', group: 'filter', name: 'PII Scrubber', description: 'Removes names, numbers and the one embarrassing diary. Lowers lawsuit risk.', requiresResearch: 'pii_scrubbing' },

  // ---- v16 post-training stages (GAME_DESIGN §28.1). Extra compute after pretraining; each one reshapes the model. --
  // Every stage costs compute (flopsMult) and moves some skills down as others go up, so the sum stays near neutral
  // on overall: the point is the shape. How well a stage takes is rolled per run (breakthroughs and duds).
  { id: 'sft', group: 'post', name: 'SFT', description: 'Supervised fine-tuning on curated answers. Cheap, polite, a little less curious.', requiresResearch: 'instruction_tuning', flopsMult: 1.03, capAdd: { chat: 3, safety: 2, knowledge: -3, multilingual: -1 } },
  { id: 'rlhf_ppo', group: 'post', name: 'RLHF (PPO)', description: 'A reward model trained on human ratings, then a policy trained on the reward model. Liked by humans, taxed on logic.', requiresResearch: 'rlhf', flopsMult: 1.08, instability: 0.08, capAdd: { chat: 6, safety: 4, reasoning: -4, math: -3, knowledge: -2 } },
  { id: 'dpo_pass', group: 'post', name: 'DPO', description: 'Preference tuning without the reward model. Most of RLHF for a third of the drama.', requiresResearch: 'dpo', flopsMult: 1.04, capAdd: { chat: 4, safety: 2, reasoning: -3, math: -2 } },
  { id: 'constitution', group: 'post', name: 'Constitution pass', description: 'The model critiques itself against a list of principles. Safer, slightly preachier.', requiresResearch: 'constitutional_ai', flopsMult: 1.05, capAdd: { safety: 9, chat: -3, agentic: -2, coding: -1 } },
  { id: 'reasoning_rl', group: 'post', name: 'Reasoning RL', description: 'Long chains of thought, rewarded when the answer checks out. Thinks harder, chats worse.', requiresResearch: 'reasoning_models', flopsMult: 1.18, instability: 0.15, capAdd: { reasoning: 7, math: 8, coding: 2, chat: -6, multilingual: -3, knowledge: -1 } },
  { id: 'rlvr_pass', group: 'post', name: 'RL on verifiable rewards', description: 'Unit tests and proof checkers as the only judges. Scary good at homework, a bit of a rules lawyer.', requiresResearch: 'rlvr', flopsMult: 1.25, instability: 0.2, capAdd: { reasoning: 8, math: 10, coding: 5, chat: -7, safety: -3, multilingual: -2 } },
  { id: 'agentic_rl', group: 'post', name: 'Agentic RL', description: 'Rewarded for finishing multi-step tasks in a sandbox. Gets things done, asks forgiveness later.', requiresResearch: 'agents', flopsMult: 1.12, instability: 0.1, capAdd: { agentic: 9, coding: 3, safety: -3, chat: -2 } },

  // ---- v16 data annealing: the last stretch of the run on a different diet (GAME_DESIGN §28.1) -----------------------
  { id: 'anneal_quality', group: 'anneal', name: 'Quality anneal', description: 'Finish on the cleanest tenth of the data. Sharper, slightly narrower.', requiresResearch: 'curriculum_learning', qualityMult: 1.015, capAdd: { knowledge: -2, multilingual: -2 } },
  { id: 'anneal_code_math', group: 'anneal', name: 'Code and math anneal', description: 'The last stretch is all code and proofs. It comes out sharper at both and duller at parties.', requiresResearch: 'curriculum_learning', capAdd: { coding: 4, math: 4, reasoning: 1, chat: -4, multilingual: -3 } },
  { id: 'anneal_long', group: 'anneal', name: 'Long-document anneal', description: 'Finish on books and whole repositories. Reads further, costs a little more.', requiresResearch: 'long_context', flopsMult: 1.04, capAdd: { longContext: 8, knowledge: 1, chat: -2 } },
];

const OPTION_BY_ID = new Map(TRAINING_OPTIONS.map((o) => [o.id, o] as const));

export function optionById(id: Id): TrainingOption | undefined {
  return OPTION_BY_ID.get(id);
}

/** Options that stop being offered once their replacement is researched. */
export const SUPERSEDED_BY: Record<Id, Id> = { lstm: 'transformers' };

export { RUN_TUNING } from './runTuning';
import { RUN_TUNING } from './runTuning';

/** Which capabilities a data kind feeds, and how strongly (1 = the full mix swing). */
export const DATA_KIND_CAPS: Record<DataKind, Partial<Record<CapId, number>>> = {
  web: { knowledge: 0.5, multilingual: 1 },
  books: { knowledge: 0.7, reasoning: 0.5 },
  code: { coding: 1, agentic: 0.5 },
  science: { math: 1, reasoning: 0.5, knowledge: 0.5 },
  dialogue: { chat: 1 },
  synthetic: { math: 0.6, reasoning: 0.6 },
  multimodal: { vision: 1 },
};

/** Specialisations that take persona knobs (instruct-style fine-tunes). */
export const PERSONA_SPECS: Id[] = ['instruct', 'companion', 'safe_assistant', 'polyglot'];

function researchName(id: Id): string {
  return RESEARCH.find((r) => r.id === id)?.name ?? id;
}

/** Null when the option can be picked now; otherwise the reason it is locked. */
export function optionLock(s: GameState, opt: TrainingOption): string | null {
  const replacement = SUPERSEDED_BY[opt.id];
  if (replacement && isResearched(s, replacement)) return `Superseded by ${researchName(replacement)}.`;
  if (opt.minYear !== undefined && calendarYear(s.day) < opt.minYear) return `Not until ${opt.minYear}.`;
  if (opt.requiresResearch && !isResearched(s, opt.requiresResearch)) return `Needs research: ${researchName(opt.requiresResearch)}.`;
  return null;
}

export interface OptionRow {
  option: TrainingOption;
  unlocked: boolean;
  /** Why it is locked, or null when unlocked. */
  reason: string | null;
}

/** Every option in a group with its unlock state, in table order. */
export function optionsByGroup(s: GameState, group: TrainingOptionGroup): OptionRow[] {
  return TRAINING_OPTIONS.filter((o) => o.group === group).map((option) => {
    const reason = optionLock(s, option);
    return { option, unlocked: reason === null, reason };
  });
}

export function isOptionUnlocked(s: GameState, id: Id): boolean {
  const opt = optionById(id);
  return !!opt && optionLock(s, opt) === null;
}

function firstUnlocked(s: GameState, group: TrainingOptionGroup, prefs: Id[], fallback: Id): Id {
  return prefs.find((id) => isOptionUnlocked(s, id)) ?? fallback;
}

/** Equal weight per data kind the player owns (kinds that exist in the owned catalogue). */
function equalMixForOwned(s: GameState): Partial<Record<DataKind, number>> {
  const mix: Partial<Record<DataKind, number>> = {};
  for (const id of s.data.owned) {
    const d = datasetById(s, id);
    if (d) mix[d.kind] = 1;
  }
  return mix;
}

/** Equal weight per data kind among the given dataset ids. */
export function equalMixFor(s: GameState, datasetIds: readonly Id[]): Partial<Record<DataKind, number>> {
  const mix: Partial<Record<DataKind, number>> = {};
  for (const id of datasetIds) {
    const d = datasetById(s, id);
    if (d) mix[d.kind] = 1;
  }
  return mix;
}

/** Active fraction of total parameters per token for an MoE with `experts` experts and top-k `k` (k = 2 is the base). */
export function moeActiveFraction(experts: number, k = 2): number {
  const base = RUN_TUNING.MOE_ACTIVE_FRACTION[experts] ?? RUN_TUNING.MOE_ACTIVE_FRACTION[RUN_TUNING.MOE_DEFAULT_EXPERTS];
  return base + ((k - 2) / experts) * RUN_TUNING.MOE_TOPK_STEP;
}

/** The unlocked precision that trains fastest on this lab's fleet while staying stable (instability <= 0.5). */
export function bestPrecision(s: GameState): Id {
  let best: { id: Id; speed: number; instab: number } | null = null;
  for (const o of TRAINING_OPTIONS) {
    if (o.group !== 'precision' || !isOptionUnlocked(s, o.id)) continue;
    const instab = o.instability ?? 0;
    if (instab > 0.5) continue;
    const speed = fleetFormatSpeed(s, o.id);
    const better = !best || speed > best.speed + 1e-9 || (Math.abs(speed - best.speed) <= 1e-9 && instab < best.instab);
    if (better) best = { id: o.id, speed, instab };
  }
  return best?.id ?? 'fp32';
}

/** Tokenizer for a model of `paramsB` billion parameters: big models get the largest vocabulary they can use. */
export function tokenizerFor(s: GameState, paramsB: number): Id {
  if (paramsB >= 8) {
    return firstUnlocked(s, 'tokenizer', ['bpe_256k_multi', 'bpe_100k'], 'bpe_32k');
  }
  return 'bpe_32k';
}

/** Best sensible unlocked defaults: what a competent researcher would pick today, for a model of about `paramsB`. */
export function defaultConfig(s: GameState, paramsB = 10): TrainingConfig {
  const contexts = ['ctx_128k', 'ctx_32k', 'ctx_8k', 'ctx_2k'];
  const filters = TRAINING_OPTIONS.filter((o) => o.group === 'filter' && isOptionUnlocked(s, o.id)).map((o) => o.id);
  return {
    arch: isResearched(s, 'transformers') ? 'dense' : 'lstm',
    tokenizer: tokenizerFor(s, paramsB),
    context: firstUnlocked(s, 'context', contexts, 'ctx_2k'),
    optimizer: firstUnlocked(s, 'optimizer', ['adamw'], 'adam'),
    precision: bestPrecision(s),
    schedule: firstUnlocked(s, 'schedule', ['wsd'], 'cosine'),
    lr: 0.5,
    dataMix: equalMixForOwned(s),
    filters,
    checkpointing: 'normal',
  };
}

/**
 * Config for a run or model that predates the run sheet (old saves). Keeps the 2017 behaviour: no speed bonus,
 * no filters, the LSTM era when transformers is not researched.
 */
export function legacyConfig(s: GameState, datasetIds: readonly Id[], contextK?: number): TrainingConfig {
  let context: Id = 'ctx_2k';
  if (contextK !== undefined) {
    const fits = TRAINING_OPTIONS.filter((o) => o.group === 'context' && (o.contextK ?? 0) <= contextK);
    context = fits[fits.length - 1]?.id ?? 'ctx_2k';
  }
  return {
    arch: isResearched(s, 'transformers') ? 'dense' : 'lstm',
    tokenizer: 'bpe_32k',
    context,
    optimizer: 'adam',
    precision: 'fp32',
    schedule: 'cosine',
    lr: 0.5,
    dataMix: equalMixFor(s, datasetIds),
    filters: [],
    checkpointing: 'normal',
  };
}

/** Stable key for a run sheet (ablations are stored per signature). Data mix and size are not part of it. */
export function configSignature(cfg: TrainingConfig): string {
  const experts = cfg.arch === 'moe' ? `:${cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS}` : '';
  const filters = [...cfg.filters].sort().join(',');
  const parts = [`${cfg.arch}${experts}`, cfg.tokenizer, cfg.context, cfg.optimizer, cfg.precision, cfg.schedule, `lr${cfg.lr.toFixed(2)}`, filters || 'nofilter', cfg.checkpointing];
  // v18: shape and top-k only when they differ from the default, so older sheets keep their keys.
  const sheet = sheetOf(cfg);
  if (sheet.shape) parts.push(`shape:${sheet.shape}`);
  if (sheet.moeTopK !== undefined && sheet.moeTopK !== 2) parts.push(`k:${sheet.moeTopK}`);
  // v16: only sheets that use post-training or annealing get the extra parts, so older ablations keep their keys.
  if (cfg.post?.length) parts.push(`post:${[...cfg.post].sort().join(',')}`);
  if (cfg.anneal) parts.push(`anneal:${cfg.anneal}`);
  return parts.join('|');
}

/** Short human label for a run sheet, e.g. "MoE x64 · FP8 · WSD · lr 0.50". */
export function describeConfig(cfg: TrainingConfig): string {
  const arch = optionById(cfg.arch)?.name ?? cfg.arch;
  const experts = cfg.arch === 'moe' ? ` x${cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS}` : '';
  const prec = optionById(cfg.precision)?.name ?? cfg.precision;
  const sched = optionById(cfg.schedule)?.name ?? cfg.schedule;
  const post = [...(cfg.post ?? []), ...(cfg.anneal ? [cfg.anneal] : [])].map((id) => optionById(id)?.name ?? id);
  const sheet = sheetOf(cfg);
  const head = [`${arch}${experts}`];
  if (cfg.arch === 'moe' && sheet.moeTopK !== undefined) head.push(`top-k ${sheet.moeTopK}`);
  if (sheet.shape) head.push(sheet.shape > 0 ? 'deep' : 'wide');
  return `${head.join(' · ')} · ${prec} · ${sched} · lr ${cfg.lr.toFixed(2)}${post.length ? ` · ${post.join(' + ')}` : ''}`;
}

/**
 * Throughput multiplier (1 = baseline): precision (the fleet's real hardware formats, see fleetFormatSpeed), optimizer,
 * checkpointing, model shape and MoE top-k. MFU research (fused kernels, flash attention 3) is NOT applied here: those
 * nodes carry their own trainingSpeed bonus through getBonuses.
 */
export function speedMultiplier(s: GameState, cfg: TrainingConfig): number {
  const precision = fleetFormatSpeed(s, cfg.precision);
  const optimizer = optionById(cfg.optimizer)?.speedMult ?? 1;
  let checkpoint = RUN_TUNING.CHECKPOINT[cfg.checkpointing]?.speed ?? 1;
  if (cfg.checkpointing === 'often' && isResearched(s, 'async_checkpointing')) checkpoint = 1;
  const sheet = sheetOf(cfg);
  const shape = 1 - RUN_TUNING.SHAPE.speed * (sheet.shape ?? 0);
  const topK = cfg.arch === 'moe' ? (RUN_TUNING.MOE_TOPK[sheet.moeTopK ?? 2]?.speed ?? 1) : 1;
  return precision * optimizer * checkpoint * shape * topK;
}

/** Why a run sheet cannot be used, or null when it is valid. */
export function validateConfig(s: GameState, cfg: TrainingConfig): string | null {
  const groups: [TrainingOptionGroup, Id][] = [
    ['arch', cfg.arch],
    ['tokenizer', cfg.tokenizer],
    ['context', cfg.context],
    ['optimizer', cfg.optimizer],
    ['precision', cfg.precision],
    ['schedule', cfg.schedule],
  ];
  for (const [group, id] of groups) {
    const opt = optionById(id);
    if (!opt || opt.group !== group) return `Unknown ${group} option: ${id}.`;
    const lock = optionLock(s, opt);
    if (lock) return `${opt.name} is locked. ${lock}`;
  }
  if (cfg.arch === 'moe' && cfg.moeExperts !== undefined && !(cfg.moeExperts in RUN_TUNING.MOE_ACTIVE_FRACTION)) {
    return 'Mixture of Experts comes in 8, 16, 64 or 256 experts.';
  }
  const sheet = sheetOf(cfg);
  if (sheet.shape !== undefined && (!Number.isFinite(sheet.shape) || sheet.shape < -1 || sheet.shape > 1)) return 'Shape must be between -1 (wide) and 1 (deep).';
  if (cfg.arch === 'lstm' && sheet.shape) return 'An LSTM has no shape to tune.';
  if (sheet.moeTopK !== undefined) {
    if (cfg.arch !== 'moe') return 'Top-k only applies to Mixture of Experts.';
    if (![1, 2, 4, 8].includes(sheet.moeTopK)) return 'Top-k must be 1, 2, 4 or 8.';
    if (sheet.moeTopK >= (cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS)) return 'Top-k must be less than the expert count.';
  }
  if (!Number.isFinite(cfg.lr) || cfg.lr < 0 || cfg.lr > 1) return 'Learning rate must be between 0 and 1.';
  if (!(cfg.checkpointing in RUN_TUNING.CHECKPOINT)) return 'Unknown checkpointing setting.';
  for (const id of cfg.filters) {
    const opt = optionById(id);
    if (!opt || opt.group !== 'filter') return `Unknown data filter: ${id}.`;
    const lock = optionLock(s, opt);
    if (lock) return `${opt.name} is locked. ${lock}`;
  }
  for (const [group, ids] of [['post', cfg.post ?? []], ['anneal', cfg.anneal ? [cfg.anneal] : []]] as const) {
    if (new Set(ids).size !== ids.length) return 'Each post-training stage can run once.';
    for (const id of ids) {
      const opt = optionById(id);
      if (!opt || opt.group !== group) return `Unknown ${group === 'post' ? 'post-training stage' : 'anneal'}: ${id}.`;
      const lock = optionLock(s, opt);
      if (lock) return `${opt.name} is locked. ${lock}`;
    }
  }
  for (const [kind, w] of Object.entries(cfg.dataMix)) {
    if (!DATA_KINDS.includes(kind as DataKind)) return `Unknown data kind: ${kind}.`;
    if (w === undefined || !Number.isFinite(w) || w < 0) return 'Data mix weights must be zero or more.';
  }
  return null;
}

/** Everything in a dataset list, resolved against static and custom datasets. */
export function datasetKinds(s: GameState, ids: readonly Id[]): DataKind[] {
  const seen = new Set<DataKind>();
  for (const id of ids) {
    const d = datasetById(s, id);
    if (d) seen.add(d.kind);
  }
  return [...seen];
}

/** All dataset definitions the player could hold, for the data mix UI and defaults. */
export function ownedKinds(s: GameState): DataKind[] {
  return datasetKinds(s, s.data.owned.filter((id) => allDatasets(s).some((d) => d.id === id)));
}
