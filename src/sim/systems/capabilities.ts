// OWNER: v2 capabilities. Latent capability profiles, derived scores, benchmarks, specialisations,
// context windows, SOTA headlines and the benchmark tick. See GAME_DESIGN.md section 12.
// Pure helpers: no DOM, deterministic given the passed rng. Imports only data, util, balance and read-only
// systems (compute, research, staff), so training.ts, competitors.ts and market.ts can all depend on it.
import type {
  BenchmarkDef,
  Capabilities,
  CapId,
  Competitor,
  DatasetDef,
  GameState,
  Id,
  Model,
  Personality,
  ProductKind,
  Rng,
  Scores,
  SpecializationDef,
} from '../types';
import { CAP_IDS } from '../types';
import { BALANCE, CAP_TUNING } from '../balance';
import type { TrainingConfig } from '../types';
import { BENCHMARKS } from '../data/benchmarks';
import { SPECIALIZATIONS } from '../data/specializations';
import { RESEARCH } from '../data/research';
import { DATASETS } from '../data/datasets';
import { COMPETITORS } from '../data/competitors';
import { PERSONA_SPECS, RUN_TUNING, defaultConfig, speedMultiplier, optionById } from '../data/trainingOptions';
import { getBonuses } from '../bonuses';
import { calendarYear, clamp, pushNews } from '../util';
import { computeCapacity } from './compute';
import { isResearched } from './research';
import { roleStrength } from './staff';
import { labName } from './labs';
import { allDatasets, datasetById } from './data';
import { nanoThresholdB, rivalActiveParamsB } from '../data/weightClasses';
import { momentumSpeedMult } from './progression'; // v13


const SAT = CAP_TUNING.SATURATION_FRACTION;

/** Research nodes by id (the capability estimate runs thousands of times per planning pass). */
const RESEARCH_BY_ID = new Map(RESEARCH.map((r) => [r.id, r] as const));

export { CAP_TUNING };
/**
 * Legacy scoreBonus values are in derived-score points. Each point is spread over the capabilities that feed that
 * score, with multipliers chosen so the derived score rises by exactly the legacy amount:
 * reasoning = 0.5 R + 0.3 M (x1.25 each), chat = 0.6 Ch + 0.2 L (x1.25 each), coding = 0.7 C + 0.3 A (x1 each).
 * Knowledge is left out so reasoning and chat bonuses don't leak into each other through it.
 */
const LEGACY_SPREAD: Record<keyof Scores, [CapId, number][]> = {
  reasoning: [['reasoning', 1.25], ['math', 1.25]],
  coding: [['coding', 1], ['agentic', 1]],
  chat: [['chat', 1.25], ['multilingual', 1.25]],
  safety: [['safety', 1]],
};

export interface CapabilityInputs {
  /** Final (or predicted) training loss. Lower is better. */
  loss: number;
  tokensB: number;
  datasetIds: readonly Id[];
  techniques: readonly Id[];
  /**
   * Multiplier on base quality from the run sheet (arch, tokenizer, optimizer, precision, schedule, lr, incidents).
   * When omitted, the legacy LSTM-era multiplier applies.
   */
  qualityMult?: number;
  /** Flat capability changes from the run sheet, data mix, and incidents. Added before noise. */
  capAdd?: Partial<Capabilities>;
}

export interface BenchRow {
  /** Competitor id, or 'player' for the player's best released model. */
  labId: string;
  lab: string;
  modelId: Id | null;
  modelName: string;
  score: number;
  isPlayer: boolean;
}

export interface FinetuneEstimate {
  paramsB: number;
  /** Raw FLOPs for the fine-tune run (parent 6ND x computeFrac). */
  flops: number;
  /** Days at current training throughput (Infinity if none). */
  days: number;
  caps: Capabilities;
  scores: Scores;
  overall: number;
  benchmarks: Record<Id, number>;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

export function clampCaps(c: Capabilities): Capabilities {
  const out = { ...c };
  for (const k of CAP_IDS) out[k] = clamp(out[k], 0, 100);
  return out;
}

export function emptyCaps(): Capabilities {
  return { knowledge: 0, reasoning: 0, math: 0, coding: 0, agentic: 0, chat: 0, vision: 0, safety: 0, multilingual: 0, longContext: 0 };
}

export function lossToQuality(loss: number): number {
  return clamp(((BALANCE.LOSS_WORST - loss) / (BALANCE.LOSS_WORST - BALANCE.LOSS_BEST)) * 100, 0, 100);
}

/**
 * Soft ceiling (v1.0 tuning): identity up to OVERALL_KNEE, then approaches OVERALL_MAX asymptotically.
 * Monotonic, so rankings do not change. The inverse is in softCeilingInverse.
 */
export function softCeiling(x: number): number {
  const { OVERALL_KNEE: knee, OVERALL_MAX: max } = CAP_TUNING;
  if (x <= knee) return x;
  return knee + (max - knee) * Math.tanh((x - knee) / (max - knee));
}

/** Inverse of softCeiling for targets below OVERALL_MAX (higher targets are held just under it). */
export function softCeilingInverse(y: number): number {
  const { OVERALL_KNEE: knee, OVERALL_MAX: max } = CAP_TUNING;
  if (y <= knee) return y;
  const t = Math.min(y, max - 1e-3);
  return knee + (max - knee) * Math.atanh((t - knee) / (max - knee));
}

/** Weighted overall from the four market-facing scores (0..100, soft ceiling above OVERALL_KNEE). */
export function overallScore(sc: Scores): number {
  return softCeiling(CAP_TUNING.W_REASONING * sc.reasoning + CAP_TUNING.W_CODING * sc.coding + CAP_TUNING.W_CHAT * sc.chat + CAP_TUNING.W_SAFETY * sc.safety);
}

/** Distinct unique tokens (billions) across the given dataset ids, static and custom. */
export function uniqueTokensB(s: GameState, ids: readonly Id[]): number {
  let total = 0;
  for (const id of new Set(ids)) total += datasetById(s, id)?.tokensB ?? 0;
  return total;
}

/** Kind of a dataset. Without a state (legacy callers) only the static catalogue is searched. */
function datasetKind(s: GameState | undefined, id: Id): DatasetDef['kind'] | undefined {
  if (s) return datasetById(s, id)?.kind;
  return DATASETS.find((d) => d.id === id)?.kind;
}

function bonusScale(q: number): number {
  return CAP_TUNING.BONUS_SCALE_BASE + CAP_TUNING.BONUS_SCALE_Q * (q / 100);
}

/** Anything that adds bonuses to a run: a researched technique or a training dataset. */
interface BonusSource {
  scoreBonus?: Partial<Scores>;
  capBonus?: Partial<Capabilities>;
}

/**
 * Stacking rule for bonuses that pile up on one capability. Positive contributions are sorted biggest first and weighted
 * by position (the tail weight applies after the listed ones). Penalties are summed in full.
 */
interface StackRule {
  weights: readonly number[];
  tail: number;
}
/** Technique bonuses (v2): toggling every technique cannot overshoot. A single technique is unaffected. */
const TECHNIQUE_STACK: StackRule = { weights: [1, 0.7, 0.5, 0.35, 0.25], tail: 0.2 };
/**
 * Dataset bonuses (v1.0 tuning, GAME_DESIGN §18.2). A big mix still helps, but the tenth dataset adds little. Before this,
 * every owned dataset added its full bonus, and the frontier bot reached the top of the scale by 2021.
 */
const DATASET_STACK: StackRule = { weights: [1, 0.5, 0.3, 0.2, 0.1], tail: 0.02 };

function stackWeight(rule: StackRule, i: number): number {
  return i < rule.weights.length ? rule.weights[i] : rule.tail;
}

/** Adds the bonuses of several sources to `target`, applying `rule` per capability. Legacy scoreBonus maps via LEGACY_SPREAD. */
function addStackedBonuses(target: Capabilities, sources: readonly BonusSource[], scale: number, rule: StackRule): void {
  const positive: Partial<Record<CapId, number[]>> = {};
  const negative: Partial<Record<CapId, number>> = {};
  const contribute = (cap: CapId, value: number) => {
    if (value >= 0) (positive[cap] ??= []).push(value);
    else negative[cap] = (negative[cap] ?? 0) + value;
  };
  for (const src of sources) {
    for (const k of Object.keys(src.scoreBonus ?? {}) as (keyof Scores)[]) {
      const points = (src.scoreBonus?.[k] ?? 0) * scale;
      for (const [cap, mult] of LEGACY_SPREAD[k]) contribute(cap, points * mult);
    }
    for (const k of Object.keys(src.capBonus ?? {}) as CapId[]) contribute(k, (src.capBonus?.[k] ?? 0) * scale);
  }
  for (const cap of CAP_IDS) {
    const values = (positive[cap] ?? []).slice().sort((a, b) => b - a);
    const stacked = values.reduce((t, v, i) => t + v * stackWeight(rule, i), 0);
    target[cap] += stacked + (negative[cap] ?? 0);
  }
}

function addTechniqueBonuses(target: Capabilities, techniques: readonly Id[], scale: number): void {
  const sources: BonusSource[] = [];
  for (const id of new Set(techniques)) {
    const node = RESEARCH_BY_ID.get(id);
    if (node) sources.push(node);
  }
  addStackedBonuses(target, sources, scale, TECHNIQUE_STACK);
}

// ---------------------------------------------------------------------------
// capabilities <-> scores
// ---------------------------------------------------------------------------

/** Capability profile for a training run. `rng = null` gives expected values (used by estimates). */
export function capsFromTraining(s: GameState, inp: CapabilityInputs, rng: Rng | null, noiseSd = CAP_TUNING.RUN_NOISE_SD): Capabilities {
  const lstm = inp.qualityMult ?? (isResearched(s, 'transformers') ? 1 : CAP_TUNING.PRE_TRANSFORMER_QUALITY_MULT);
  const q = lossToQuality(inp.loss) * lstm;
  const unique = uniqueTokensB(s, inp.datasetIds);
  const used = Math.max(1, Math.min(inp.tokensB, unique > 0 ? unique : inp.tokensB));
  const knowledgeData = clamp(CAP_TUNING.KNOWLEDGE_PER_LOG10 * Math.log10(used), 0, CAP_TUNING.KNOWLEDGE_DATA_CAP);
  const c: Capabilities = {
    knowledge: CAP_TUNING.KNOWLEDGE_Q * q + knowledgeData,
    reasoning: CAP_TUNING.REASONING_Q * q,
    math: CAP_TUNING.MATH_Q * q,
    coding: CAP_TUNING.CODING_Q * q,
    agentic: CAP_TUNING.AGENTIC_Q * q,
    chat: CAP_TUNING.CHAT_Q * q,
    vision: 0,
    safety: CAP_TUNING.SAFETY_BASE + CAP_TUNING.SAFETY_Q * q + Math.min(CAP_TUNING.SAFETY_STAFF_CAP, CAP_TUNING.SAFETY_STAFF_PER_SQRT * Math.sqrt(roleStrength(s, 'safety'))),
    multilingual: CAP_TUNING.MULTILINGUAL_Q * q,
    longContext: CAP_TUNING.LONG_CONTEXT_BASE + CAP_TUNING.LONG_CONTEXT_Q * q,
  };
  const scale = bonusScale(q);
  addTechniqueBonuses(c, inp.techniques, scale);
  const datasets: BonusSource[] = [];
  for (const id of new Set(inp.datasetIds)) {
    const d = datasetById(s, id);
    if (d) datasets.push(d);
  }
  addStackedBonuses(c, datasets, scale, DATASET_STACK);
  if (inp.capAdd) for (const k of CAP_IDS) c[k] += inp.capAdd[k] ?? 0;
  if (rng) for (const k of CAP_IDS) c[k] += rng.normal(0, noiseSd);
  return clampCaps(c);
}

/** The four market-facing scores, derived from capabilities (GAME_DESIGN section 12). */
export function scoresFromCaps(c: Capabilities): Scores {
  return {
    reasoning: clamp(0.5 * c.reasoning + 0.3 * c.math + 0.2 * c.knowledge, 0, 100),
    coding: clamp(0.7 * c.coding + 0.3 * c.agentic, 0, 100),
    chat: clamp(0.6 * c.chat + 0.2 * c.multilingual + 0.2 * c.knowledge, 0, 100),
    safety: clamp(c.safety, 0, 100),
  };
}

/**
 * Capabilities that reproduce the given scores (exact inverse of scoresFromCaps, before clamping).
 * Used for competitor releases, save migration and tests. `personality` nudges the profile; `year` ramps agents and vision.
 */
export function competitorCaps(sc: Scores, personality: Personality | null, rng: Rng | null, year = 2026): Capabilities {
  const F = clamp(overallScore(sc), 0, 100);
  const agentic = clamp((year - CAP_TUNING.AGENTIC_RAMP_START) / CAP_TUNING.AGENTIC_RAMP_YEARS, 0, 1);
  const vision = clamp((year - CAP_TUNING.VISION_RAMP_START) / CAP_TUNING.VISION_RAMP_YEARS, 0, 1);
  let K = F;
  let M = 0.9 * F;
  let L = 0.85 * F;
  let A = (CAP_TUNING.COMPETITOR_AGENTIC_BASE + CAP_TUNING.COMPETITOR_AGENTIC_GAIN * agentic) * F;
  if (personality === 'research') {
    K += 4;
    M += 6;
  }
  if (personality === 'open') L += 6;
  if (personality === 'hype') A += 4;
  const caps: Capabilities = {
    knowledge: K,
    // Reasoning and chat are solved exactly so their derived scores come out as requested.
    reasoning: (sc.reasoning - 0.3 * M - 0.2 * K) / 0.5,
    math: M,
    // Coding is a fixed multiple of frontier quality. Solving it from the score would make it fall as agentic
    // capability ramps up, which would make coding benchmarks go down over time. The derived coding score
    // lands within a few percent of the target; overall is recomputed from the derived scores on release.
    coding: CAP_TUNING.COMPETITOR_CODING_MULT * F,
    agentic: A,
    chat: (sc.chat - 0.2 * L - 0.2 * K) / 0.6,
    vision: CAP_TUNING.COMPETITOR_VISION_MULT * F * vision,
    safety: sc.safety,
    multilingual: L,
    longContext: 20 + 0.3 * F + 10 * vision,
  };
  if (rng) for (const k of CAP_IDS) caps[k] += rng.normal(0, CAP_TUNING.COMPETITOR_NOISE_SD);
  return clampCaps(caps);
}

/** Context window in thousands of tokens: 2 at the start, 8 with long_context, then x4 per later research step. */
export function contextWindowK(s: GameState): number {
  if (!isResearched(s, 'long_context')) return CAP_TUNING.CONTEXT_BASE_K;
  let k = CAP_TUNING.CONTEXT_LONG_K;
  for (const id of CAP_TUNING.CONTEXT_FOLLOWUPS) if (isResearched(s, id)) k *= CAP_TUNING.CONTEXT_STEP_MULT;
  return Math.min(CAP_TUNING.CONTEXT_MAX_K, k);
}

export function modalitiesFor(caps: Capabilities, lineage: readonly Id[]): ('text' | 'vision' | 'audio')[] {
  const out: ('text' | 'vision' | 'audio')[] = ['text'];
  if (caps.vision > CAP_TUNING.VISION_MODALITY_MIN) out.push('vision');
  if (lineage.includes('omni')) out.push('audio');
  return out;
}

/**
 * Training throughput in raw FLOP per day. `cfg` applies the run sheet's precision, optimizer, checkpointing and
 * MFU multipliers; without one the default run sheet is used. Cluster efficiency is already in computeCapacity.
 */
export function trainingRatePerDay(s: GameState, cfg: TrainingConfig = defaultConfig(s)): number {
  const pflops = computeCapacity(s).training;
  const boost = 1 + CAP_TUNING.RESEARCHER_TRAIN_BOOST * Math.sqrt(roleStrength(s, 'researcher'));
  // v13: the Momentum perk turns the hot streak into training speed.
  return pflops * 1e15 * 86_400 * getBonuses(s).trainingSpeed * boost * speedMultiplier(s, cfg) * momentumSpeedMult(s);
}

/** Capabilities of a model, reconstructed from its scores when the save predates v2. */
export function modelCaps(model: Model, s?: GameState): Capabilities {
  if (model.caps) return model.caps;
  const year = calendarYear(model.trainedDay);
  const caps = competitorCaps(model.scores, null, null, year);
  const multimodal = model.techniques.includes('multimodal') || model.datasetIds.some((id) => datasetKind(s, id) === 'multimodal');
  if (!multimodal) caps.vision = 0;
  return caps;
}

// ---------------------------------------------------------------------------
// persona (instruct-style fine-tunes, GAME_DESIGN 13.2)
// ---------------------------------------------------------------------------

/** Does this spec take persona knobs? */
export function takesPersona(specId: Id | null | undefined): boolean {
  return !!specId && PERSONA_SPECS.includes(specId);
}

/** Persona knobs as set by the player: clamped to -1..1, and all zero without persona_vectors research. */
export function effectivePersona(s: GameState, persona: { helpfulness: number; verbosity: number; sycophancy: number } | undefined): { helpfulness: number; verbosity: number; sycophancy: number } {
  if (!persona || !isResearched(s, 'persona_vectors')) return { helpfulness: 0, verbosity: 0, sycophancy: 0 };
  const c = (v: number) => (Number.isFinite(v) ? clamp(v, -1, 1) : 0);
  return { helpfulness: c(persona.helpfulness), verbosity: c(persona.verbosity), sycophancy: c(persona.sycophancy) };
}

/** Capabilities plus a sparse set of deltas, clamped. */
export function addCapDeltas(caps: Capabilities, delta: Partial<Capabilities>): Capabilities {
  const out = { ...caps };
  for (const k of CAP_IDS) out[k] = caps[k] + (delta[k] ?? 0);
  return clampCaps(out);
}

/** Flat capability changes from persona knobs. */
export function personaCapAdd(persona: { helpfulness: number; verbosity: number; sycophancy: number } | undefined): Partial<Capabilities> {
  if (!persona) return {};
  return {
    chat: RUN_TUNING.PERSONA_HELPFUL_CHAT * persona.helpfulness + RUN_TUNING.PERSONA_VERBOSE_CHAT * persona.verbosity,
    safety: RUN_TUNING.PERSONA_HELPFUL_SAFETY * persona.helpfulness,
  };
}

/** Inference multiplier from verbosity (more words, less served per PFLOP). */
export function personaInferenceMult(persona: { verbosity: number } | undefined): number {
  return persona ? 1 - RUN_TUNING.PERSONA_VERBOSE_INFERENCE * persona.verbosity : 1;
}

/** Attractiveness multiplier for a chat product serving this model (sycophancy wins users short-term). */
export function sycophancyAttraction(model: Model | undefined, kind: ProductKind): number {
  if (kind !== 'chat') return 1;
  return 1 + RUN_TUNING.PERSONA_SYCOPHANCY_ATTRACTION * (model?.persona?.sycophancy ?? 0);
}

/** Inference efficiency multiplier of a model: arch and verbosity (1 = baseline). */
export function modelInferenceMult(model: Model): number {
  return model.inferenceMult ?? 1;
}

/** Option lookup for a run sheet's arch, used by UI labels and the bot. */
export function archName(cfg: TrainingConfig): string {
  return optionById(cfg.arch)?.name ?? cfg.arch;
}

// ---------------------------------------------------------------------------
// specialisations
// ---------------------------------------------------------------------------

export function specById(id: string | null | undefined): SpecializationDef | undefined {
  if (!id) return undefined;
  return SPECIALIZATIONS.find((x) => x.id === id);
}

/** The specialisation a model was fine-tuned into, if any. */
export function specOf(model: Model): SpecializationDef | undefined {
  return specById(model.specId);
}

/** Attractiveness multiplier for a model serving a product kind (1 for base models). */
export function productFitFor(model: Model, kind: ProductKind): number {
  return specOf(model)?.productFit?.[kind] ?? 1;
}

/** Scandal multiplier for PR events while this model is in a live product (1 for base models). */
export function scandalRiskFor(model: Model): number {
  return specOf(model)?.scandalRisk ?? 1;
}

/** Fine-tunes this model can start right now: parent spec matches, research and dataset gates are open. */
export function availableSpecs(s: GameState, model: Model): SpecializationDef[] {
  const parent = model.specId ?? 'base';
  return SPECIALIZATIONS.filter(
    (sp) =>
      sp.from.includes(parent) &&
      (!sp.requiresResearch || isResearched(s, sp.requiresResearch)) &&
      (!sp.requiresDatasetKind || s.data.owned.some((id) => datasetKind(s, id) === sp.requiresDatasetKind)),
  );
}

/** Capabilities after a specialisation, clamped. Optional noise for finished runs. */
export function applySpecialization(caps: Capabilities, spec: SpecializationDef, rng: Rng | null = null, noiseSd = 0): Capabilities {
  const out = { ...caps };
  for (const k of CAP_IDS) out[k] = caps[k] + (spec.capAdd[k] ?? 0) * CAP_TUNING.SPEC_CAP_SCALE + (rng && noiseSd > 0 ? rng.normal(0, noiseSd) : 0);
  return clampCaps(out);
}

/** Expected result of a fine-tune before it runs. `benchmaxx` shows inflated numbers, like the real run would. */
export function estimateFinetune(
  s: GameState,
  parentId: Id,
  specId: Id,
  benchmaxx = false,
  persona?: { helpfulness: number; verbosity: number; sycophancy: number },
): FinetuneEstimate | null {
  const parent = s.models.find((m) => m.id === parentId);
  const spec = specById(specId);
  if (!parent || !spec) return null;
  const year = calendarYear(s.day);
  // v8 doctrine: finetuneCost, the same multiplier startFinetune applies.
  const flops = 6 * (parent.activeParamsB ?? parent.paramsB) * 1e9 * parent.tokensB * 1e9 * spec.computeFrac * (getBonuses(s).finetuneCost ?? 1);
  const rate = trainingRatePerDay(s, parent.config ?? defaultConfig(s));
  const knobs = takesPersona(spec.id) ? effectivePersona(s, persona) : undefined;
  const caps = addCapDeltas(applySpecialization(modelCaps(parent, s), spec), personaCapAdd(knobs));
  const scores = scoresFromCaps(caps);
  const contaminated = benchmaxx || !!parent.contaminated;
  const activeParamsB = (parent.activeParamsB ?? parent.paramsB) * (spec.paramsMult ?? 1);
  return {
    paramsB: parent.paramsB * (spec.paramsMult ?? 1),
    flops,
    days: rate > 0 ? flops / rate : Infinity,
    caps,
    scores,
    overall: overallScore(scores),
    benchmarks: benchmarkTable(caps, year, contaminated ? year : null, activeParamsB),
  };
}

// ---------------------------------------------------------------------------
// benchmarks
// ---------------------------------------------------------------------------

/** Capability mix of a benchmark applied to a profile: weighted mean of the capabilities it tests (0..100). */
export function benchmarkWeightedCap(def: BenchmarkDef, caps: Capabilities): number {
  let num = 0;
  let den = 0;
  for (const k of Object.keys(def.weights) as CapId[]) {
    const w = def.weights[k] ?? 0;
    num += w * caps[k];
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/** Active size of the model being scored, and the year (the nano threshold moves with the frontier). */
export interface ActiveSize {
  activeParamsB: number;
  year: number;
}

/**
 * Efficiency multiplier on an efficiency benchmark's above-floor part (GAME_DESIGN §19.2):
 * clamp((nanoThreshold / active)^efficiency, 0.35, 1.15). Ordinary benchmarks always get 1.
 */
export function efficiencyFactor(def: BenchmarkDef, activeParamsB: number, year: number): number {
  if (def.efficiency === undefined) return 1;
  const ratio = nanoThresholdB(year) / Math.max(1e-6, activeParamsB);
  return clamp(Math.pow(ratio, def.efficiency), 0.35, 1.15);
}

/**
 * Score (%) on one benchmark. Logistic in the weighted capability: floor at zero, ceiling at the top.
 * `contaminatedAtTraining` means the model trained on this benchmark's test set; the numbers inflate but caps do not.
 * `size` scales efficiency benchmarks by the model's active size; without it they score as ordinary benchmarks.
 */
export function benchmarkResult(def: BenchmarkDef, caps: Capabilities, contaminatedAtTraining = false, size?: ActiveSize): number {
  const x = (benchmarkWeightedCap(def, caps) - def.difficulty) / def.spread;
  const frac = 1 / (1 + Math.exp(-x));
  let v = def.floor + (def.ceiling - def.floor) * frac;
  if (size && def.efficiency !== undefined) v = def.floor + (v - def.floor) * efficiencyFactor(def, size.activeParamsB, size.year);
  if (contaminatedAtTraining) v += CAP_TUNING.CONTAMINATION_GAP_FRACTION * (def.ceiling - v);
  return Math.round(clamp(v, 0, 100) * 10) / 10;
}

/**
 * Results for every benchmark introduced by `year`. `contaminatedYear` = the training year, or null when clean.
 * `activeParamsB` sizes the efficiency benchmarks; omit it and they score as ordinary benchmarks.
 */
export function benchmarkTable(caps: Capabilities, year: number, contaminatedYear: number | null = null, activeParamsB?: number): Record<Id, number> {
  const out: Record<Id, number> = {};
  const size = activeParamsB === undefined ? undefined : { activeParamsB, year };
  for (const def of BENCHMARKS) {
    if (def.year > year) continue;
    const contaminated = contaminatedYear !== null && def.year <= contaminatedYear;
    out[def.id] = benchmarkResult(def, caps, contaminated, size);
  }
  return out;
}

/** Fills model.benchmarks for every benchmark introduced by now. */
export function evaluateModel(s: GameState, model: Model): void {
  model.caps = modelCaps(model, s);
  model.benchmarks = benchmarkTable(
    model.caps,
    calendarYear(s.day),
    model.contaminated ? calendarYear(model.trainedDay) : null,
    model.activeParamsB ?? model.paramsB,
  );
}

export function benchmarkById(id: string): BenchmarkDef | undefined {
  return BENCHMARKS.find((b) => b.id === id);
}

/** Benchmarks introduced by the current calendar year. */
export function activeBenchmarks(s: GameState): BenchmarkDef[] {
  const year = calendarYear(s.day);
  return BENCHMARKS.filter((b) => b.year <= year);
}

/** Headline benchmarks still in play (not saturated). Used for compact model rows and SOTA press. */
export function headlineBenchmarks(s: GameState): BenchmarkDef[] {
  return activeBenchmarks(s).filter((b) => b.headline && !isSaturated(s, b.id));
}

function competitorDef(id: string) {
  return COMPETITORS.find((d) => d.id === id);
}

/** Active size estimate of a rival flagship (no published size): the frontier curve times its lab's personality. */
export function rivalFlagshipActiveB(c: Competitor): number {
  return rivalActiveParamsB(competitorDef(c.id)?.personality ?? 'research', calendarYear(c.model?.releasedDay ?? 0));
}

/** Current competitor model results on a benchmark, plus the player's best released model, sorted best first. */
export function bestResults(s: GameState, benchId: string): BenchRow[] {
  const rows: BenchRow[] = [];
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    const score = c.model.benchmarks?.[benchId];
    if (score === undefined) continue;
    rows.push({ labId: c.id, lab: labName(s, c.id), modelId: null, modelName: c.model.name, score, isPlayer: false });
  }
  let best: Model | null = null;
  let bestScore = -Infinity;
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated) continue;
    const score = m.benchmarks?.[benchId];
    if (score !== undefined && score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  if (best) rows.push({ labId: 'player', lab: s.company.name, modelId: best.id, modelName: best.name, score: bestScore, isPlayer: true });
  return rows.sort((a, b) => b.score - a.score);
}

/** A benchmark is saturated when the best released result reaches SATURATION_FRACTION of its ceiling. */
export function isSaturated(s: GameState, benchId: string): boolean {
  const def = benchmarkById(benchId);
  if (!def) return false;
  const top = bestResults(s, benchId)[0];
  return !!top && top.score >= SAT * def.ceiling;
}

/** Best score among competitors and the player's other released models (excluding `excludeModelId`). */
function bestOther(s: GameState, benchId: string, excludeModelId: Id): number {
  let best = -Infinity;
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    const score = c.model.benchmarks?.[benchId];
    if (score !== undefined && score > best) best = score;
  }
  for (const m of s.models) {
    if (m.id === excludeModelId || m.releasedDay === null || m.deprecated) continue;
    const score = m.benchmarks?.[benchId];
    if (score !== undefined && score > best) best = score;
  }
  return best;
}

/** Headline benchmarks where this just-released model is #1 and the benchmark is not yet saturated. */
export function sotaHeadlines(s: GameState, model: Model): BenchmarkDef[] {
  if (model.releasedDay === null || !model.benchmarks) return [];
  const out: BenchmarkDef[] = [];
  for (const def of activeBenchmarks(s)) {
    if (!def.headline) continue;
    const mine = model.benchmarks[def.id];
    if (mine === undefined) continue;
    // Counts only if the benchmark was not already saturated by someone else before this release.
    const others = bestOther(s, def.id, model.id);
    if (mine > others && others < SAT * def.ceiling) out.push(def);
  }
  return out;
}

/** Announce a release's headline SOTAs, apply the capped brand and hype bonus, and return how many there were. */
export function releaseSota(s: GameState, model: Model): number {
  const sota = sotaHeadlines(s, model);
  if (sota.length === 0) return 0;
  for (const def of sota) {
    pushNews(s, `${model.name} takes the top spot on ${def.name}. Nobody has asked the benchmark how it feels.`, 'milestone');
  }
  s.company.brand = clamp(s.company.brand + Math.min(CAP_TUNING.SOTA_BRAND_CAP, CAP_TUNING.SOTA_BRAND * sota.length), 0, 100);
  s.company.hype = clamp(s.company.hype + Math.min(CAP_TUNING.SOTA_HYPE_CAP, CAP_TUNING.SOTA_HYPE * sota.length), 0, 100);
  s.flags.sotaEver = (s.flags.sotaEver ?? 0) + sota.length;
  return sota.length;
}

/** Number of benchmarks where the player's best released model is currently #1. */
export function sotaCount(s: GameState): number {
  let n = 0;
  for (const def of activeBenchmarks(s)) {
    const top = bestResults(s, def.id)[0];
    if (top && top.isPlayer) n += 1;
  }
  return n;
}

/** Best (released, non-deprecated) player model's score on one benchmark, or null. */
export function playerBest(s: GameState, benchId: string): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated) continue;
    const score = m.benchmarks?.[benchId];
    if (score !== undefined && (best === null || score > best)) best = score;
  }
  return best;
}

function nextBenchmarkName(s: GameState): string {
  const year = calendarYear(s.day);
  const next = BENCHMARKS.filter((b) => b.year > year).sort((a, b) => a.year - b.year)[0];
  return next?.name ?? 'a harder exam';
}

/**
 * Daily benchmark bookkeeping: introduces benchmarks when their year arrives (news plus re-evaluation of every
 * model), and announces saturation once per benchmark.
 */
export function benchmarksTick(s: GameState, _rng: Rng): void {
  const year = calendarYear(s.day);
  for (const def of BENCHMARKS) {
    if (def.year > year) continue;
    const key = `bench.${def.id}`;
    if (s.flags[key] !== undefined) continue;
    s.flags[key] = s.day;
    for (const m of s.models) {
      if (m.deprecated) continue;
      const caps = modelCaps(m, s);
      m.caps = caps;
      const size = { activeParamsB: m.activeParamsB ?? m.paramsB, year };
      m.benchmarks = { ...(m.benchmarks ?? {}), [def.id]: benchmarkResult(def, caps, !!m.contaminated && def.year <= calendarYear(m.trainedDay), size) };
    }
    for (const c of s.competitors) {
      // The human rival's benchmarks arrive in their snapshots; don't recompute them locally.
      if (!c.model || c.human) continue;
      const caps = competitorModelCaps(c);
      c.model.caps = caps;
      c.model.benchmarks = { ...(c.model.benchmarks ?? {}), [def.id]: benchmarkResult(def, caps, false, { activeParamsB: rivalFlagshipActiveB(c), year }) };
    }
    // Benchmarks that were already around when the game starts are history, not news.
    if (def.year > BALANCE.START_YEAR) pushNews(s, `New benchmark: ${def.name}. ${def.flavor}`, 'info');
  }
  for (const def of activeBenchmarks(s)) {
    const key = `benchSat.${def.id}`;
    if (s.flags[key] !== undefined) continue;
    if (!isSaturated(s, def.id)) continue;
    s.flags[key] = s.day;
    pushNews(s, `${def.name} is saturated. Researchers announce ${nextBenchmarkName(s)}.`, 'milestone');
  }
}

/** Capabilities of a competitor's current model, reconstructed from its scores when missing. */
export function competitorModelCaps(c: Competitor): Capabilities {
  if (c.model?.caps) return c.model.caps;
  const model = c.model;
  const personality = competitorDef(c.id)?.personality ?? null;
  return competitorCaps(model?.scores ?? { reasoning: 0, coding: 0, chat: 0, safety: 0 }, personality, null, calendarYear(model?.releasedDay ?? 0));
}

// ---------------------------------------------------------------------------
// save migration
// ---------------------------------------------------------------------------

/**
 * Fills v2 fields on a loaded state: capabilities from scores, lineage, context, modalities and benchmarks.
 * Idempotent. Benchmarks that already existed when the save was made are marked as introduced silently.
 */
export function backfillCapabilities(s: GameState): void {
  const year = calendarYear(s.day);
  let migrated = false;
  for (const m of s.models) {
    if (!m.caps) {
      m.caps = modelCaps(m, s);
      migrated = true;
    }
    if (m.lineage === undefined) m.lineage = [];
    if (m.specId === undefined) m.specId = null;
    if (m.parentId === undefined) m.parentId = null;
    if (m.contextK === undefined) m.contextK = CAP_TUNING.CONTEXT_BASE_K;
    if (m.modalities === undefined) m.modalities = modalitiesFor(m.caps, m.lineage);
    if (!m.benchmarks) evaluateModel(s, m);
  }
  for (const c of s.competitors) {
    if (c.model && !c.model.caps) {
      c.model.caps = competitorModelCaps(c);
      c.model.benchmarks = benchmarkTable(c.model.caps, year, null, rivalFlagshipActiveB(c));
    }
    if (c.model && !c.model.benchmarks) c.model.benchmarks = benchmarkTable(competitorModelCaps(c), year, null, rivalFlagshipActiveB(c));
  }
  if (migrated) {
    for (const def of activeBenchmarks(s)) {
      if (s.flags[`bench.${def.id}`] === undefined) s.flags[`bench.${def.id}`] = s.day;
      if (s.flags[`benchSat.${def.id}`] === undefined && isSaturated(s, def.id)) s.flags[`benchSat.${def.id}`] = s.day;
    }
  }
}
