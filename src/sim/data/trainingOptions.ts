// OWNER: training agent. Run-sheet options (GAME_DESIGN.md 13.1), run tunables, config defaults, validation.
// State-dependent helpers (unlock checks, defaults) live here too; they only read research, year and datasets.
import type { CapId, DataKind, GameState, Id, TrainingConfig, TrainingOptionDef, TrainingOptionGroup } from '../types';
import { DATA_KINDS } from '../types';
import { RESEARCH } from './research';
import { isResearched } from '../systems/research';
import { allDatasets, datasetById } from '../systems/data';
import { calendarYear } from '../util';

/** Options plus two fields that only the data pipeline reads (kept off the shared TrainingOptionDef). */
export type TrainingOption = TrainingOptionDef & {
  /** Added to the run's mix-weighted dataset quality (filters). */
  dataQualityAdd?: number;
  /** Multiplies the tokens the loss sees (quality classifiers throw tokens away). */
  tokenMult?: number;
};

export const TRAINING_OPTION_GROUPS: TrainingOptionGroup[] = ['arch', 'tokenizer', 'context', 'optimizer', 'precision', 'schedule', 'filter'];

export const TRAINING_OPTIONS: TrainingOption[] = [
  // ---- architecture -------------------------------------------------------------------------
  { id: 'lstm', group: 'arch', name: 'LSTM', description: 'The old way. Forgets the first sentence by the third.', qualityMult: 0.6 },
  { id: 'dense', group: 'arch', name: 'Dense Transformer', description: 'Attention for everyone. Quadratic, but loyal.', requiresResearch: 'transformers', capAdd: { chat: 2, safety: 2 } },
  { id: 'moe', group: 'arch', name: 'Mixture of Experts', description: 'Many specialists, one router, and a lot of shrugging.', requiresResearch: 'moe', instability: 0.4, capAdd: { knowledge: 5, reasoning: -3, chat: -1 } },
  { id: 'ssm_hybrid', group: 'arch', name: 'SSM Hybrid', description: 'State-space layers mixed with attention. Reads very long things cheaply.', requiresResearch: 'mamba_hybrid', inferenceMult: 1.6, qualityMult: 0.95, capAdd: { longContext: 15 } },
  { id: 'diffusion_lm', group: 'arch', name: 'Diffusion LM', description: 'Writes the whole answer at once and then argues with it. Fast to serve, odd at small talk.', requiresResearch: 'diffusion_lm', inferenceMult: 3, instability: 0.3, capAdd: { chat: -5, coding: 3 } },
  { id: 'recurrent_depth', group: 'arch', name: 'Recurrent Depth', description: 'Thinks in loops. Slower to train, slightly smarter on the homework.', requiresResearch: 'recurrent_depth', flopsMult: 1.3, capAdd: { reasoning: 6, math: 6 } },

  // ---- tokenizer ----------------------------------------------------------------------------
  { id: 'bpe_32k', group: 'tokenizer', name: 'BPE 32K', description: 'A small vocabulary that has seen a lot of emojis.' },
  { id: 'bpe_100k', group: 'tokenizer', name: 'BPE 100K', description: 'A bigger vocabulary. Now it can spell "ChatGPT" in four scripts.', requiresResearch: 'tokenizer_100k', qualityMult: 1.03, capAdd: { multilingual: 4 } },
  { id: 'bpe_256k_multi', group: 'tokenizer', name: 'Multilingual BPE 256K', description: 'Every alphabet, most of the emojis, and one cursed ligature.', requiresResearch: 'multilingual_tokenizer', qualityMult: 1.02, flopsMult: 1.05, capAdd: { multilingual: 12, coding: -2 } },
  { id: 'byte_latent', group: 'tokenizer', name: 'Byte Latent', description: 'No tokenizer at all. Reads raw bytes and stares at them until they make sense.', requiresResearch: 'byte_latent', qualityMult: 1.05, flopsMult: 1.18, capAdd: { multilingual: 5, math: 2 } },

  // ---- context window -----------------------------------------------------------------------
  { id: 'ctx_2k', group: 'context', name: '2K context', description: 'Remembers the last page. Roughly.', contextK: 2 },
  { id: 'ctx_8k', group: 'context', name: '8K context', description: 'Remembers the last chapter.', requiresResearch: 'rope', contextK: 8, flopsMult: 1.05 },
  { id: 'ctx_32k', group: 'context', name: '32K context', description: 'Remembers the whole short story, including the twist it spoiled.', requiresResearch: 'long_context', contextK: 32, flopsMult: 1.12 },
  { id: 'ctx_128k', group: 'context', name: '128K context', description: 'Remembers the whole codebase and the meeting where you decided to rewrite it.', requiresResearch: 'yarn_scaling', contextK: 128, flopsMult: 1.2 },
  { id: 'ctx_1m', group: 'context', name: '1M context', description: 'Remembers every email you have ever sent. Feels seen.', requiresResearch: 'million_token', contextK: 1000, flopsMult: 1.35 },
  { id: 'ctx_10m', group: 'context', name: '10M context', description: 'Remembers your childhood. Starts quoting it back.', requiresResearch: 'infinite_context', contextK: 10000, flopsMult: 1.6 },

  // ---- optimizer ----------------------------------------------------------------------------
  { id: 'sgd', group: 'optimizer', name: 'SGD', description: 'Stochastic gradient descent. Stochastic, mostly descent.', qualityMult: 0.85 },
  { id: 'adam', group: 'optimizer', name: 'Adam', description: 'The default. Everybody uses it, so nobody is blamed.' },
  { id: 'adamw', group: 'optimizer', name: 'AdamW', description: 'Adam with the weight decay finally where it belongs.', requiresResearch: 'adamw', qualityMult: 1.04 },
  { id: 'lion', group: 'optimizer', name: 'Lion', description: 'Found by a search algorithm. Fast, a little reckless.', requiresResearch: 'lion_optimizer', speedMult: 1.2, qualityMult: 0.98, instability: 0.3 },
  { id: 'shampoo', group: 'optimizer', name: 'Shampoo', description: 'Preconditioned, and very sure of itself. Costs more per step.', requiresResearch: 'shampoo_soap', qualityMult: 1.07, speedMult: 0.82, instability: -0.05 },
  { id: 'muon', group: 'optimizer', name: 'Muon', description: 'Orthogonalises the updates. Sounds like physics, behaves like a good coach.', requiresResearch: 'muon_optimizer', qualityMult: 1.09, speedMult: 0.93, instability: 0.2 },

  // ---- precision ----------------------------------------------------------------------------
  { id: 'fp32', group: 'precision', name: 'FP32', description: 'Full precision. Slow, boring, and the numbers are all there.', instability: -0.1 },
  { id: 'fp16', group: 'precision', name: 'FP16', description: 'Half precision with a loss scaler and a prayer.', requiresResearch: 'mixed_precision', speedMult: 2, instability: 0.3 },
  { id: 'bf16', group: 'precision', name: 'BF16', description: 'Brain floats. Same range as FP32, half the bits, none of the drama.', requiresResearch: 'bf16_training', speedMult: 2 },
  { id: 'fp8', group: 'precision', name: 'FP8', description: 'Eight bits per weight. Very fast, very opinionated about outliers.', requiresResearch: 'fp8_training', speedMult: 3.5, instability: 0.5, qualityMult: 0.985 },
  { id: 'fp4', group: 'precision', name: 'FP4', description: 'Four bits. The weights are fine. The weights are fine.', requiresResearch: 'fp4_training', speedMult: 6, instability: 1.2, qualityMult: 0.95 },

  // ---- schedule -----------------------------------------------------------------------------
  { id: 'cosine', group: 'schedule', name: 'Cosine', description: 'Decay the learning rate along a cosine. Best if you run to the end; stopping early wastes the tail.', qualityMult: 1.02 },
  { id: 'constant', group: 'schedule', name: 'Constant', description: 'Keep the learning rate flat and hope. Stopping early is fine-ish.', qualityMult: 0.97 },
  { id: 'wsd', group: 'schedule', name: 'Warmup-Stable-Decay', description: 'Flat in the middle, decay at the end. Stop anytime without much regret.', requiresResearch: 'wsd_schedule', qualityMult: 1 },

  // ---- data filters -------------------------------------------------------------------------
  { id: 'dedup', group: 'filter', name: 'MinHash Dedup', description: 'Removes the 40,000 copies of the same terms of service.', requiresResearch: 'minhash_dedup', dataQualityAdd: 0.06 },
  { id: 'quality_clf', group: 'filter', name: 'Quality Classifier', description: 'A model that judges other data. Throws away a sixth of it for being mean.', requiresResearch: 'quality_classifiers', dataQualityAdd: 0.08, tokenMult: 0.85 },
  { id: 'toxicity', group: 'filter', name: 'Toxicity Filter', description: 'Keeps the worst of the internet out. Also some of the best jokes.', requiresResearch: 'toxicity_filtering', capAdd: { safety: 6, knowledge: -1 } },
  { id: 'decontam', group: 'filter', name: 'Decontamination', description: 'Scrubs the benchmark answer keys out of the training set.', requiresResearch: 'decontamination' },
  { id: 'pii_scrub', group: 'filter', name: 'PII Scrubber', description: 'Removes names, numbers and the one embarrassing diary. Lowers lawsuit risk.', requiresResearch: 'pii_scrubbing' },
];

const OPTION_BY_ID = new Map(TRAINING_OPTIONS.map((o) => [o.id, o] as const));

export function optionById(id: Id): TrainingOption | undefined {
  return OPTION_BY_ID.get(id);
}

/** Options that stop being offered once their replacement is researched. */
export const SUPERSEDED_BY: Record<Id, Id> = { lstm: 'transformers' };

/** Tunables for runs, incidents, ablations and uncertainty. Numbers here are the single source of truth. */
export const RUN_TUNING = {
  /** Default expert count when the MoE arch is picked without one. */
  MOE_DEFAULT_EXPERTS: 16,
  /** Share of total parameters active per token, by expert count (GAME_DESIGN 13.1). */
  MOE_ACTIVE_FRACTION: { 8: 0.3, 16: 0.18, 64: 0.08, 256: 0.04 } as Record<number, number>,
  /** Quality exponent on active vs total params: N_eff = N_act^a * N_tot^(1-a). */
  MOE_ACTIVE_EXPONENT: 0.6,
  /**
   * Learning-rate quality (GAME_DESIGN 16.1): a peaked curve, LR_PEAK - LR_CURVE x (lr - lrOpt)^2, clamped to
   * [LR_QUALITY_MIN, LR_PEAK]. The optimum lrOpt depends on the architecture and (without mup_transfer) shrinks
   * with active parameters: lrOpt = LR_OPT_BASE[arch] - LR_OPT_SCALE_SLOPE x log10(activeParamsB) + offset.
   */
  LR_PEAK: 1.08,
  LR_CURVE: 2.0,
  LR_QUALITY_MIN: 0.8,
  LR_OPT_BASE: { lstm: 0.55, dense: 0.55, moe: 0.5, ssm_hybrid: 0.6, diffusion_lm: 0.45, recurrent_depth: 0.55 } as Record<string, number>,
  LR_OPT_DEFAULT_BASE: 0.55,
  LR_OPT_SCALE_SLOPE: 0.06,
  LR_OPT_OFFSET_SD: 0.12,
  LR_OPT_MIN: 0.1,
  LR_OPT_MAX: 0.9,
  /** Sweep readings: noise on each measured quality factor (halved with scaling_laws). */
  LR_SWEEP_NOISE_SD: 0.015,
  /** Sweeps this close (log10 active params) to the planned run inform its forecast. */
  LR_SWEEP_NEAR_LOG10: 0.5,
  /** Instability added by the learning rate: LR_INSTAB x lr^2 (mup_transfer halves it). */
  LR_INSTAB: 1.2,
  MUP_LR_INSTAB_MULT: 0.5,
  /** Stability research. */
  QK_NORM_INSTAB: -0.3,
  Z_LOSS_INSTAB: -0.2,
  /** MoE stability research. */
  MOE_LOAD_BALANCING_INSTAB: -0.3,
  AUX_FREE_BALANCING_INSTAB: -0.4,
  MIN_INSTABILITY: -0.5,
  /** Incidents: per-day chance = (INCIDENT_BASE + INCIDENT_PER_INSTAB x instability + hardware) / safety / engineers. */
  INCIDENT_BASE: 0.004,
  INCIDENT_PER_INSTAB: 0.01,
  HARDWARE_COEF: 0.002,
  FAULT_TOLERANT_HARDWARE_LEFT: 0.25,
  ENGINEER_INCIDENT_COEF: 0.05,
  MIN_INCIDENT_RATE: 0.0005,
  /** Quirk rolls at the end of a pretrain: P(0), P(1), rest is P(2). */
  QUIRK_ROLL_P0: 0.45,
  QUIRK_ROLL_P1: 0.4,
  /** Long context adds this much longContext per doubling above 2K. */
  CONTEXT_CAP_PER_DOUBLING: 0.8,
  /** Data mix: cap swing at the extreme of a mix (one kind gets everything). */
  MIX_SWING: 10,
  /** Chance of accidental benchmark contamination per run = webShare x this, unless decontam is on. */
  ACCIDENTAL_CONTAMINATION_PER_WEB: 0.25,
  /** Uncertainty of predicted overall score (SD in points), before reductions. */
  UNCERTAINTY_BASE: 6,
  UNCERTAINTY_SCALING_LAWS: 0.6,
  UNCERTAINTY_MUP: 0.7,
  /** An ablation halves uncertainty for this many days after it finishes. */
  ABLATION_UNCERTAINTY_MULT: 0.5,
  ABLATION_WINDOW_DAYS: 365,
  ABLATION_FRACTION: 0.02,
  ABLATION_DAYS: 5,
  /** Data headroom for runs: each unique token may be used this many times. */
  MAX_EPOCHS: 4,
  /** Extend training by a fraction in this range. */
  EXTEND_MIN: 0.1,
  EXTEND_MAX: 0.5,
  /** Early stop keeps this share of the would-be quality: keep = base + slope x progress. */
  KEEP: {
    cosine: { base: 0.6, slope: 0.4 },
    constant: { base: 0.85, slope: 0.15 },
    wsd: { base: 0.95, slope: 0.05 },
  } as Record<string, { base: number; slope: number }>,
  /** Checkpointing: speed and how many days a rollback loses. */
  CHECKPOINT: {
    often: { speed: 0.96, rollbackDays: 2 },
    normal: { speed: 1, rollbackDays: 5 },
    rare: { speed: 1.02, rollbackDays: 12 },
  } as Record<'often' | 'normal' | 'rare', { speed: number; rollbackDays: number }>,
  /** Persona knobs (fine-tunes of instruct-style specs). */
  PERSONA_HELPFUL_CHAT: 8,
  PERSONA_HELPFUL_SAFETY: -8,
  PERSONA_VERBOSE_CHAT: 4,
  PERSONA_VERBOSE_INFERENCE: 0.25,
  PERSONA_SYCOPHANCY_ATTRACTION: 0.1,
  PERSONA_SYCOPHANCY_REP_PER_DAY: 0.012,
};

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

/** Best sensible unlocked defaults: what a competent researcher would pick today. */
export function defaultConfig(s: GameState): TrainingConfig {
  const contexts = ['ctx_10m', 'ctx_1m', 'ctx_128k', 'ctx_32k', 'ctx_8k', 'ctx_2k'];
  const filters = TRAINING_OPTIONS.filter((o) => o.group === 'filter' && isOptionUnlocked(s, o.id)).map((o) => o.id);
  return {
    arch: isResearched(s, 'transformers') ? 'dense' : 'lstm',
    tokenizer: firstUnlocked(s, 'tokenizer', ['bpe_256k_multi', 'bpe_100k'], 'bpe_32k'),
    context: firstUnlocked(s, 'context', contexts, 'ctx_2k'),
    optimizer: firstUnlocked(s, 'optimizer', ['adamw'], 'adam'),
    precision: firstUnlocked(s, 'precision', ['bf16', 'fp16'], 'fp32'),
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
  return [`${cfg.arch}${experts}`, cfg.tokenizer, cfg.context, cfg.optimizer, cfg.precision, cfg.schedule, `lr${cfg.lr.toFixed(2)}`, filters || 'nofilter', cfg.checkpointing].join('|');
}

/** Short human label for a run sheet, e.g. "MoE x64 · FP8 · WSD · lr 0.50". */
export function describeConfig(cfg: TrainingConfig): string {
  const arch = optionById(cfg.arch)?.name ?? cfg.arch;
  const experts = cfg.arch === 'moe' ? ` x${cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS}` : '';
  const prec = optionById(cfg.precision)?.name ?? cfg.precision;
  const sched = optionById(cfg.schedule)?.name ?? cfg.schedule;
  return `${arch}${experts} · ${prec} · ${sched} · lr ${cfg.lr.toFixed(2)}`;
}

/**
 * Throughput multiplier from precision, optimizer and checkpointing (1 = baseline). MFU research (fused kernels,
 * flash attention 3) is NOT applied here: those nodes carry their own trainingSpeed bonus through getBonuses.
 */
export function speedMultiplier(s: GameState, cfg: TrainingConfig): number {
  const precision = optionById(cfg.precision)?.speedMult ?? 1;
  const optimizer = optionById(cfg.optimizer)?.speedMult ?? 1;
  let checkpoint = RUN_TUNING.CHECKPOINT[cfg.checkpointing]?.speed ?? 1;
  if (cfg.checkpointing === 'often' && isResearched(s, 'async_checkpointing')) checkpoint = 1;
  return precision * optimizer * checkpoint;
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
  if (!Number.isFinite(cfg.lr) || cfg.lr < 0 || cfg.lr > 1) return 'Learning rate must be between 0 and 1.';
  if (!(cfg.checkpointing in RUN_TUNING.CHECKPOINT)) return 'Unknown checkpointing setting.';
  for (const id of cfg.filters) {
    const opt = optionById(id);
    if (!opt || opt.group !== 'filter') return `Unknown data filter: ${id}.`;
    const lock = optionLock(s, opt);
    if (lock) return `${opt.name} is locked. ${lock}`;
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
