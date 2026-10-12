// OWNER: Agent VAULT-B. Distillation and merges. GAME_DESIGN §17.8.
// Implemented by VAULT-B; the exported signatures are the UI contract.
import type { ActionHandlers, Capabilities, EvalReveal, Forecast, GameState, Id, MergeMethod, Model, Rng, TrainingConfig, TrainingRun } from '../types';
import { CAP_IDS } from '../types';
import { QUIRKS } from '../data/quirks';
import { suggestCodename } from '../data/names';
import { legacyConfig } from '../data/trainingOptions';
import { getBonuses } from '../bonuses';
import { clamp, formatParams, newId, notify, pushNews, trySpend } from '../util';
import { addCapDeltas, clampCaps, contextWindowK, evaluateModel, modalitiesFor, modelCaps, overallScore, scoresFromCaps, trainingRatePerDay } from './capabilities';
import { activeParamsFor, resolveRun } from './trainingMath';
import { LAB_TUNING, recordLabEval, sumCapAdd, verdictFor, verdictNews, type Verdict } from './lab';
import { benchSuiteFor } from './vault';

/** Tunables for distillation and merges (GAME_DESIGN §17.8). */
export const DERIVE_TUNING = {
  // Distillation
  DISTILL_MIN_PARAMS_B: 0.05,
  /** Student's active params at most this share of the teacher's. */
  DISTILL_MAX_RATIO: 0.5,
  /** A student trains on at most this many tokens per (active) parameter. */
  DISTILL_TOKENS_PER_PARAM: 20,
  DISTILL_COMPUTE_FRAC: 0.3,
  /** Overall points lost per (log10 of the size ratio) ^ EXP. */
  DISTILL_PENALTY: 14,
  DISTILL_PENALTY_EXP: 1.1,
  DISTILL_SD: 2.5,
  /** Share of the teacher's visible and latent quirks the student keeps. */
  DISTILL_QUIRK_KEEP: 0.6,
  DISTILL_VIBES: 0.7,
  /** A student never ends above its teacher minus this. */
  DISTILL_MARGIN: 1,
  // Merges
  MERGE_DAYS: 3,
  MERGE_COST: 25_000,
  AVG_BONUS: 1,
  AVG_SD: 2,
  TIES_BONUS: -0.5,
  TIES_SD: 2.5,
  /** TIES caps are the element-wise max minus this. */
  TIES_CAP_PENALTY: 2,
  FRANKEN_SD: 6,
  FRANKEN_CURSED_CHANCE: 0.15,
  FRANKEN_CURSED_PTS: -10,
  /** Frankenmerges gain this many random quirks. */
  FRANKEN_EXTRA_QUIRKS: 1,
  /** Merged vibes: mean of the parents, plus N(0, this). */
  MERGE_VIBES_SD: LAB_TUNING.VIBES_NEW_SD,
  // Shared
  /** Overall points per log10 of qualityMult (incidents and early stops act through it). */
  QUALITY_POINTS_PER_LOG10: 20,
};

export interface DeriveQuote { ok: boolean; reason?: string; forecast: Forecast | null; days: number; cost: number }

const MERGE_METHODS: MergeMethod[] = ['average', 'ties', 'frankenmerge'];
const VERDICT_KIND: Record<Verdict, 'good' | 'info' | 'bad'> = {
  banger: 'good',
  solid: 'good',
  'as expected': 'info',
  mid: 'bad',
  dud: 'bad',
  cursed: 'bad',
};

function fail(reason: string): DeriveQuote {
  return { ok: false, reason, forecast: null, days: 0, cost: 0 };
}

function confidenceFor(sd: number): Forecast['confidence'] {
  if (sd < 2) return 'tight';
  if (sd < 3.5) return 'decent';
  if (sd < 6) return 'rough';
  return 'wild guess';
}

function bandFor(mid: number, sd: number): { low: number; mid: number; high: number } {
  const half = LAB_TUNING.Z80 * sd;
  return { low: mid - half, mid, high: mid + half };
}

function overallOfCaps(c: Capabilities): number {
  return overallScore(scoresFromCaps(c));
}

/** Shift every capability by the same amount (vision stays 0 when 0), clamped to 0..100. */
function shiftCapsBy(c: Capabilities, d: number): Capabilities {
  const out = { ...c };
  for (const k of CAP_IDS) if (!(k === 'vision' && c[k] === 0)) out[k] = clamp(c[k] + d, 0, 100);
  return out;
}

/** Shift a capability profile until its overall score lands on `target` (a few passes, for the clamp). */
function capsToOverall(c: Capabilities, target: number): Capabilities {
  let out = clampCaps(c);
  for (let i = 0; i < 6; i++) {
    const d = target - overallOfCaps(out);
    if (Math.abs(d) < 0.005) break;
    out = shiftCapsBy(out, d);
  }
  return out;
}

function mapCaps(a: Capabilities, b: Capabilities, f: (x: number, y: number) => number): Capabilities {
  const out = {} as Capabilities;
  for (const k of CAP_IDS) out[k] = clamp(f(a[k], b[k]), 0, 100);
  return out;
}

function archOf(m: Model): string {
  return m.config?.arch ?? '';
}

/** The base model a model descends from: follow fine-tune parents and derivation sources back to the root. */
function familyRoot(s: GameState, m: Model, depth = 0): Id {
  if (depth > 32) return m.id;
  const parentId = m.parentId ?? m.derivedFrom?.ids[0] ?? null;
  const parent = parentId ? s.models.find((x) => x.id === parentId) : undefined;
  return parent ? familyRoot(s, parent, depth + 1) : m.id;
}

// ---------------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------------

interface DistillPlan {
  cfg: TrainingConfig;
  studentActive: number;
  tokensB: number;
  flops: number;
  rate: number;
  days: number;
  ratio: number;
  /** Expected overall of the student (before its noise), never above the teacher minus the margin. */
  expected: number;
}

function distillExpected(teacher: Model, ratio: number): number {
  const penalty = DERIVE_TUNING.DISTILL_PENALTY * Math.log10(ratio) ** DERIVE_TUNING.DISTILL_PENALTY_EXP;
  return Math.min(teacher.overall - penalty, teacher.overall - DERIVE_TUNING.DISTILL_MARGIN);
}

function planDistill(s: GameState, teacher: Model, paramsB: number): DistillPlan {
  const cfg = teacher.config ?? legacyConfig(s, teacher.datasetIds, teacher.contextK);
  const studentActive = activeParamsFor(paramsB, cfg);
  const teacherActive = teacher.activeParamsB ?? teacher.paramsB;
  const tokensB = Math.min(teacher.tokensB, DERIVE_TUNING.DISTILL_TOKENS_PER_PARAM * studentActive);
  // v8 doctrine: finetuneCost scales distill compute too.
  const flops = 6 * studentActive * 1e9 * tokensB * 1e9 * DERIVE_TUNING.DISTILL_COMPUTE_FRAC * (getBonuses(s).finetuneCost ?? 1);
  const rate = trainingRatePerDay(s, cfg);
  const ratio = teacherActive / studentActive;
  return {
    cfg,
    studentActive,
    tokensB,
    flops,
    rate,
    days: rate > 0 ? flops / rate : Infinity,
    ratio,
    expected: distillExpected(teacher, ratio),
  };
}

function distillForecast(s: GameState, teacher: Model, plan: DistillPlan): Forecast {
  const mid = plan.expected;
  const sd = DERIVE_TUNING.DISTILL_SD;
  const reasons = [`A student ${plan.ratio.toFixed(1)}x smaller than ${teacher.name}.`];
  if (!s.models.some((m) => m.derivedFrom?.kind === 'distill' && m.derivedFrom.ids[0] === teacher.id)) {
    reasons.push('Nobody in the lab has distilled this teacher yet.');
  }
  return { ...bandFor(mid, sd), confidence: confidenceFor(sd), reasons, caps: capsToOverall(modelCaps(teacher, s), mid) };
}

/** Why a distillation can't start, or a quote for it. Shared by the UI quote and the start handler. */
export function distillQuote(s: GameState, teacherId: Id, paramsB: number): DeriveQuote {
  const teacher = s.models.find((m) => m.id === teacherId);
  if (!teacher) return fail('That teacher model no longer exists.');
  if (teacher.deprecated) return fail(`${teacher.name} is deprecated and can't teach anything.`);
  if (s.training) return fail(`${s.training.name} is still training. Cancel it first.`);
  if (!Number.isFinite(paramsB) || paramsB < DERIVE_TUNING.DISTILL_MIN_PARAMS_B) {
    return fail(`A student needs at least ${DERIVE_TUNING.DISTILL_MIN_PARAMS_B * 1000}M parameters.`);
  }
  const cfg = teacher.config ?? legacyConfig(s, teacher.datasetIds, teacher.contextK);
  const teacherActive = teacher.activeParamsB ?? teacher.paramsB;
  const studentActive = activeParamsFor(paramsB, cfg);
  if (studentActive > DERIVE_TUNING.DISTILL_MAX_RATIO * teacherActive) {
    return fail(`A student can have at most half of ${teacher.name}'s active parameters (${formatParams(teacherActive * DERIVE_TUNING.DISTILL_MAX_RATIO)}).`);
  }
  const plan = planDistill(s, teacher, paramsB);
  if (!(plan.rate > 0)) return fail('No compute is allocated to training. Rent GPUs or raise the training share.');
  return {
    ok: true,
    forecast: distillForecast(s, teacher, plan),
    days: Math.ceil(plan.days),
    cost: 0,
  };
}

// ---------------------------------------------------------------------------
// Merges
// ---------------------------------------------------------------------------

interface MergeBelief {
  expected: number;
  sd: number;
  /** The capability shape the method produces (before the overall is pinned). */
  shape: Capabilities;
  reasons: string[];
}

function mergeBelief(s: GameState, a: Model, b: Model, method: MergeMethod): MergeBelief {
  const ca = modelCaps(a, s);
  const cb = modelCaps(b, s);
  const mean = (a.overall + b.overall) / 2;
  const T = DERIVE_TUNING;
  if (method === 'average') {
    return {
      expected: mean + T.AVG_BONUS,
      sd: T.AVG_SD,
      shape: mapCaps(ca, cb, (x, y) => (x + y) / 2),
      reasons: ['Averaged weights usually land between their parents, and sometimes a little above.'],
    };
  }
  if (method === 'ties') {
    return {
      expected: Math.max(a.overall, b.overall) + T.TIES_BONUS,
      sd: T.TIES_SD,
      shape: mapCaps(ca, cb, (x, y) => Math.max(x, y) - T.TIES_CAP_PENALTY),
      reasons: ['TIES keeps the strongest weights and argues with the rest.'],
    };
  }
  return {
    expected: mean,
    sd: T.FRANKEN_SD,
    shape: mapCaps(ca, cb, (x, y) => (x + y) / 2),
    reasons: ['A frankenmerge is a coin toss with a crown.', 'Nobody has checked which half of the brain came from where.'],
  };
}

/** The true shape of a merge. A frankenmerge takes each capability from one parent or the other. */
function mergeTrueShape(method: MergeMethod, belief: Capabilities, a: Model, b: Model, s: GameState, rng: Rng): Capabilities {
  if (method !== 'frankenmerge') return belief;
  const ca = modelCaps(a, s);
  const cb = modelCaps(b, s);
  return mapCaps(ca, cb, (x, y) => (rng.chance(0.5) ? x : y));
}

function mergeForecast(s: GameState, a: Model, b: Model, method: MergeMethod): Forecast {
  const belief = mergeBelief(s, a, b, method);
  return { ...bandFor(belief.expected, belief.sd), confidence: confidenceFor(belief.sd), reasons: belief.reasons, caps: capsToOverall(belief.shape, belief.expected) };
}

/** Why a merge can't start, or a quote for it. Frankenmerges skip the architecture and lineage rules. */
export function mergeQuote(s: GameState, aId: Id, bId: Id, method: MergeMethod): DeriveQuote {
  if (s.training) return fail(`${s.training.name} is still training. Cancel it first.`);
  const a = s.models.find((m) => m.id === aId);
  const b = s.models.find((m) => m.id === bId);
  if (!a || !b) return fail('Pick two models to merge.');
  if (a.id === b.id) return fail("A model can't be merged with itself.");
  if (a.deprecated || b.deprecated) return fail('Deprecated models stay deprecated. Pick two that still work.');
  if (!MERGE_METHODS.includes(method)) return fail('Pick a merge method: average, ties or frankenmerge.');
  if (method !== 'frankenmerge') {
    if (archOf(a) !== archOf(b)) return fail(`${a.name} and ${b.name} have different architectures. Only a frankenmerge would try.`);
    if (familyRoot(s, a) !== familyRoot(s, b)) return fail(`${a.name} and ${b.name} come from different base models. Only a frankenmerge would try.`);
  }
  const cfg = a.config ?? legacyConfig(s, a.datasetIds, a.contextK);
  if (!(trainingRatePerDay(s, cfg) > 0)) return fail('No compute is allocated to training. Rent GPUs or raise the training share.');
  return {
    ok: true,
    forecast: mergeForecast(s, a, b, method),
    days: DERIVE_TUNING.MERGE_DAYS,
    cost: DERIVE_TUNING.MERGE_COST,
  };
}

// ---------------------------------------------------------------------------
// Eval day
// ---------------------------------------------------------------------------

/** Quirks a merge inherits: the union of both parents' visible quirks and latent quirks. */
function unionIds(...lists: (readonly Id[] | undefined)[]): Id[] {
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

/** Finish a 'distill' or 'merge' run: create the model, set the eval-day reveal. Called by training.ts finishRun. */
export function finishDerived(s: GameState, run: TrainingRun, rng: Rng): void {
  const isMerge = run.kind === 'merge' && !!run.merge;
  const parentIds = isMerge ? [run.merge!.aId, run.merge!.bId] : [run.distill?.teacherId ?? ''];
  const parents = parentIds.map((id) => s.models.find((m) => m.id === id));
  if (parents.some((p) => !p)) {
    notify(s, `${run.name} lost its parents and was discarded.`, 'bad');
    return;
  }
  const ps = parents as Model[];
  const cfg = run.config ?? ps[0].config ?? legacyConfig(s, run.datasetIds);
  const capAdd: Partial<Capabilities> = { ...(run.capAdd ?? {}) };
  const qualityPts = DERIVE_TUNING.QUALITY_POINTS_PER_LOG10 * Math.log10(Math.max(0.05, run.qualityMult ?? 1));

  // Build the truth: shape, expected overall with noise, quirks, vibes and what the derived model keeps.
  let shape: Capabilities;
  let base: number;
  let ceiling: number | undefined;
  let seedTag: EvalReveal['seedTag'] = null;
  let quirks: Id[];
  let latent: Id[];
  let vibes: number;
  let forecast: Forecast;
  let derivedFrom: Model['derivedFrom'];
  let contaminated: boolean;
  let contextK: number;
  let inferenceMult: number;
  let kind: EvalReveal['kind'];

  if (isMerge) {
    const [a, b] = ps;
    const method = run.merge!.method;
    kind = 'merge';
    forecast = run.forecast ?? mergeForecast(s, a, b, method);
    const belief = mergeBelief(s, a, b, method);
    shape = mergeTrueShape(method, belief.shape, a, b, s, rng);
    base = belief.expected + rng.normal(0, belief.sd);
    if (method === 'frankenmerge' && rng.chance(DERIVE_TUNING.FRANKEN_CURSED_CHANCE)) {
      seedTag = 'cursed';
      base += DERIVE_TUNING.FRANKEN_CURSED_PTS;
    }
    quirks = unionIds(a.quirks, b.quirks);
    latent = unionIds(a.latentQuirks, b.latentQuirks).filter((q) => !quirks.includes(q));
    if (method === 'frankenmerge') {
      for (let i = 0; i < DERIVE_TUNING.FRANKEN_EXTRA_QUIRKS; i++) {
        const pool = QUIRKS.filter((q) => !quirks.includes(q.id) && !latent.includes(q.id));
        if (pool.length === 0) break;
        const pick = rng.pick(pool);
        quirks.push(pick.id);
        Object.assign(capAdd, sumCapAdd(capAdd, pick.capAdd ?? {}));
      }
    }
    vibes = ((a.vibes ?? 0) + (b.vibes ?? 0)) / 2 + rng.normal(0, DERIVE_TUNING.MERGE_VIBES_SD);
    derivedFrom = { kind: 'merge', ids: [a.id, b.id], method };
    contaminated = !!a.contaminated || !!b.contaminated;
    contextK = Math.max(a.contextK ?? contextWindowK(s), b.contextK ?? contextWindowK(s));
    inferenceMult = ((a.inferenceMult ?? 1) + (b.inferenceMult ?? 1)) / 2;
  } else {
    const teacher = ps[0];
    kind = 'distill';
    const plan = planDistill(s, teacher, run.paramsB);
    forecast = run.forecast ?? distillForecast(s, teacher, plan);
    shape = modelCaps(teacher, s);
    base = plan.expected + rng.normal(0, DERIVE_TUNING.DISTILL_SD);
    ceiling = teacher.overall - DERIVE_TUNING.DISTILL_MARGIN;
    const keep = DERIVE_TUNING.DISTILL_QUIRK_KEEP;
    quirks = teacher.quirks?.filter(() => rng.chance(keep)) ?? [];
    latent = (teacher.latentQuirks ?? []).filter(() => rng.chance(keep));
    vibes = (teacher.vibes ?? 0) * DERIVE_TUNING.DISTILL_VIBES;
    derivedFrom = { kind: 'distill', ids: [teacher.id] };
    contaminated = !!teacher.contaminated;
    contextK = teacher.contextK ?? contextWindowK(s);
    inferenceMult = teacher.inferenceMult ?? 1;
  }

  // Incidents and early stops act through qualityMult and capAdd; both move the overall the same way as in a pretrain.
  const withCaps = clampCaps(addCapDeltas(shape, capAdd));
  const capPts = overallOfCaps(withCaps) - overallOfCaps(clampCaps(shape));
  let target = base + qualityPts + capPts;
  if (ceiling !== undefined) target = Math.min(target, ceiling);
  const caps = capsToOverall(withCaps, target);
  const scores = scoresFromCaps(caps);
  const overall = overallScore(scores);
  const lineage: Id[] = [];
  const model: Model = {
    id: newId(s, 'm'),
    name: run.name,
    codename: suggestCodename(rng),
    paramsB: run.paramsB,
    tokensB: run.tokensB,
    datasetIds: [...run.datasetIds],
    techniques: [...run.techniques],
    finalLoss: run.predictedLoss,
    scores,
    overall,
    elo: LAB_TUNING.ELO_BASE + overall * LAB_TUNING.ELO_PER_POINT + vibes,
    trainedDay: s.day,
    releasedDay: null,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage,
    contextK,
    modalities: modalitiesFor(caps, lineage),
    contaminated,
    config: cfg,
    activeParamsB: activeParamsFor(run.paramsB, cfg),
    quirks,
    latentQuirks: latent,
    inferenceMult,
    vibes,
    emergences: [],
    forecast,
    derivedFrom,
  };
  evaluateModel(s, model);
  s.models.push(model);
  s.stats.modelsTrained += 1;

  // Only the forecast track record moves: derived models don't count as pretrains for runs per architecture.
  recordLabEval(s, {
    kind: 'finetune',
    arch: cfg.arch,
    totalFlops: run.totalFlops,
    actual: overall,
    forecastMid: forecast.mid,
    modelId: model.id,
    day: s.day,
    discovered: [],
  });

  const verdict = verdictFor(overall, forecast, seedTag);
  const suite = benchSuiteFor(s, model);
  const benchmarks: Record<Id, number> = {};
  for (const id of suite.length ? suite : Object.keys(model.benchmarks ?? {})) {
    const v = model.benchmarks?.[id];
    if (v !== undefined) benchmarks[id] = v;
  }
  s.pendingReveal = {
    modelId: model.id,
    kind,
    forecast,
    actual: overall,
    verdict,
    seedTag,
    emerged: [],
    quirks: [...quirks],
    dataSurprises: {},
    benchmarks,
  };
  pushNews(s, verdictNews(s, rng, verdict, run.name, overall, forecast.mid), VERDICT_KIND[verdict]);
  if (isMerge) {
    notify(s, `${run.name} finished merging. The eval report is in.`, 'milestone');
    pushNews(s, `${s.company.name} merges ${ps[0].name} and ${ps[1].name} into ${run.name}. Both parents have opinions.`, 'info');
  } else {
    notify(s, `${run.name} finished distilling. The eval report is in.`, 'milestone');
    pushNews(s, `${s.company.name} distills ${ps[0].name} into ${run.name}. The teacher was not consulted.`, 'info');
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function runBase(s: GameState, name: string, paramsB: number, tokensB: number, datasetIds: Id[], techniques: Id[], cfg: TrainingConfig, flops: number, forecast: Forecast, predictedLoss: number, kind: 'distill' | 'merge'): TrainingRun {
  return {
    id: newId(s, 'run'),
    name,
    paramsB,
    tokensB,
    datasetIds,
    techniques,
    dataQuality: resolveRun(s, paramsB, tokensB, datasetIds, [], cfg, 'true').dataQuality,
    totalFlops: flops,
    doneFlops: 0,
    startedDay: s.day,
    lossHistory: [],
    predictedLoss,
    forecast,
    forecastLoss: predictedLoss,
    checkpoints: [],
    emerged: [],
    kind,
    config: cfg,
    qualityMult: 1,
    capAdd: {},
    pendingIncident: null,
    log: [],
    stallDays: 0,
    uncertainty: (forecast.high - forecast.low) / (2 * LAB_TUNING.Z80),
    accidentallyContaminated: false,
    incidents: [],
  };
}

export const handlers: ActionHandlers = {
  startDistill: (s, a) => {
    const q = distillQuote(s, a.teacherId, a.paramsB);
    if (!q.ok || !q.forecast) {
      notify(s, q.reason ?? 'Distillation is not possible.', 'bad');
      return;
    }
    const name = (a.name ?? '').trim().slice(0, 40);
    if (!name) {
      notify(s, 'Give the model a name first.', 'bad');
      return;
    }
    const teacher = s.models.find((m) => m.id === a.teacherId);
    if (!teacher) return;
    const plan = planDistill(s, teacher, a.paramsB);
    const run = runBase(s, name, a.paramsB, plan.tokensB, [...teacher.datasetIds], [...teacher.techniques], plan.cfg, plan.flops, q.forecast, teacher.finalLoss, 'distill');
    run.distill = { teacherId: teacher.id };
    s.training = run;
    notify(s, `Distilling ${teacher.name} into ${name}: about ${q.days} days.`, 'info');
  },

  startMerge: (s, a) => {
    const q = mergeQuote(s, a.aId, a.bId, a.method);
    if (!q.ok || !q.forecast) {
      notify(s, q.reason ?? 'Merging is not possible.', 'bad');
      return;
    }
    const name = (a.name ?? '').trim().slice(0, 40);
    if (!name) {
      notify(s, 'Give the model a name first.', 'bad');
      return;
    }
    const ma = s.models.find((m) => m.id === a.aId);
    const mb = s.models.find((m) => m.id === a.bId);
    if (!ma || !mb) return;
    if (!trySpend(s, 'compute', q.cost, `the ${a.method} merge`)) return;
    const cfg = ma.config ?? legacyConfig(s, ma.datasetIds, ma.contextK);
    const rate = trainingRatePerDay(s, cfg);
    const paramsB = Math.max(ma.paramsB, mb.paramsB);
    const tokensB = Math.max(ma.tokensB, mb.tokensB);
    const datasetIds = unionIds(ma.datasetIds, mb.datasetIds);
    const techniques = unionIds(ma.techniques, mb.techniques);
    const run = runBase(s, name, paramsB, tokensB, datasetIds, techniques, cfg, rate * DERIVE_TUNING.MERGE_DAYS, q.forecast, (ma.finalLoss + mb.finalLoss) / 2, 'merge');
    run.merge = { aId: ma.id, bId: mb.id, method: a.method };
    s.training = run;
    notify(s, `Merging ${ma.name} and ${mb.name} into ${name}: about ${q.days} days.`, 'info');
  },
};
