import type { ActionHandlers, Capabilities, DatasetDef, EvalReveal, GameState, Id, Model, ResearchNode, Rng, RunHidden, Scores, TrainingConfig, TrainingRun, Forecast } from '../types';
import { CAP_IDS } from '../types';
import { CAP_TUNING } from '../balance';
import { RESEARCH } from '../data/research';
import { DATASETS } from '../data/datasets';
import { RUN_TUNING, configSignature, defaultConfig, describeConfig, legacyConfig, validateConfig, optionById } from '../data/trainingOptions';
import { RUN_INCIDENTS, runIncidentById } from '../data/runIncidents';
import { quirkById, rollQuirks } from '../data/quirks';
import { getBonuses } from '../bonuses';
import { calendarYear, clamp, formatMoney, newId, notify, pushNews, trySpend } from '../util';
import { trainingLockedNotice } from './scenario'; // v9 scenario
import { isResearched } from './research';
import { diffTangible, snapshotTangible } from './eventDeltas';
import { measureEvalSuite } from './vault';
import { availableDatasetsV2, buyDatasetV2, datasetById, hashNormal, hashUniform, trueQualityOf } from './data';
import { availableGpus } from './compute';
import {
  addCapDeltas,
  availableSpecs,
  capsFromTraining,
  clampCaps,
  contextWindowK,
  effectivePersona,
  evaluateModel,
  lossToQuality,
  modalitiesFor,
  modelCaps,
  overallScore,
  personaCapAdd,
  personaInferenceMult,
  releaseSota,
  scoresFromCaps,
  specById,
  takesPersona,
  trainingRatePerDay,
} from './capabilities';
import {
  activeParamsFor,
  ablationFlag,
  mixRows,
  resolveRun,
  runConfig,
  runPhysics,
  uniqueTokensOf,
  type RunPhysics,
} from './trainingMath';
import {
  applyForgetting,
  discoveriesOf,
  dataSurpriseLine,
  finetuneTrueOverall,
  forecastFinetune,
  forecastFromPhys,
  forecastTraining,
  labOf,
  plateauProgress,
  recomputeTrueOverall,
  recordLabEval,
  rollPretrainHidden,
  rollSpecTake,
  settleEmergences,
  sumCapAdd,
  trueFinetuneCaps,
  verdictFor,
  verdictNews,
  trueCapsOf,
  verifyRunDatasets,
  watchRun,
  LAB_TUNING,
} from './lab';
import { emergenceById } from '../data/emergences';
import { finishDerived } from './derive';
import { pickCopy, VERDICT_NEWS } from '../data/evalCopy';

export { lossToQuality, overallScore, trainingRatePerDay } from './capabilities';
import { applyTempoDay, liveRunRate, tempoOf, tempoRisk } from './tempo'; // v13 run tempo
export { chinchillaLoss, effectiveTokens, SCALE_TUNING, undertrainPenalty, runOverheadDays, repeatFactor } from './trainingMath';

export interface TrainingEstimate {
  totalFlops: number;
  /** Days at the current rate for this run sheet (Infinity if no compute). */
  days: number;
  dataQuality: number;
  predictedLoss: number;
  predictedScores: Scores;
  predictedCaps: Capabilities;
  /** The lab's belief: the forecast mid (what the player should expect). Never the hidden truth. */
  overall: number;
  /** The run sheet the estimate is for. */
  config: TrainingConfig;
  /** FLOP-active parameters (billions). */
  activeParamsB: number;
  /** Share of the training GPUs' PFLOPS that count (1 = fully efficient cluster). */
  clusterEfficiency: number;
  /** Instability of this run sheet. Show as a hidden estimate until `ablated`. */
  instability: number;
  /** Expected incidents over the whole run. Show as a hidden estimate until `ablated`. */
  incidentRisk: number;
  /** Expected incidents per day. */
  incidentRate: number;
  /** Effective tokens per effective parameter: the ratio the undertraining penalty reads (20 is compute-optimal). */
  tokensPerParam: number;
  /** Quality points lost to undertraining (0 when the run has enough tokens per parameter). */
  underPenalty: number;
  /** SD (overall points) of the forecast band. Equals (high - low) / (2 × 1.28). */
  uncertainty: number;
  /** True once this run sheet has been ablated (instability and incident risk are revealed). */
  ablated: boolean;
  qualityMult: number;
  speedMult: number;
  inferenceMult: number;
  /** v5: the forecast band the player sees for this run sheet. */
  forecast?: Forecast;
}

export const TRAINING_TUNING = {
  MIN_PARAMS_B: 0.05,
  MAX_PARAMS_B: 10_000,
  MIN_TOKENS_B: 0.1,
  /** A run may repeat each unique token up to this many times in total. */
  MAX_EPOCHS: RUN_TUNING.MAX_EPOCHS,
  /** Before `transformers` is researched, base quality is multiplied by this ("LSTM era"). */
  PRE_TRANSFORMER_QUALITY_MULT: CAP_TUNING.PRE_TRANSFORMER_QUALITY_MULT,
  /** Starting loss of the displayed loss curve (never below final loss + 0.5). */
  LOSS_CURVE_START: 4.5,
  /** Shape of the loss curve: progress h(f) = (1/(1+k f) - 1/(1+k)) / (1 - 1/(1+k)). */
  LOSS_CURVE_K: 8,
  LOSS_NOISE_SD: 0.012,
  /** Training speed multiplier per sqrt(researcher strength). */
  RESEARCHER_TRAIN_BOOST: CAP_TUNING.RESEARCHER_TRAIN_BOOST,
  /** Elo = ELO_BASE + overall * ELO_PER_POINT. */
  ELO_BASE: 800,
  ELO_PER_POINT: 8,
};

/** Static datasets' tokens by id (legacy, catalogue only). Prefer datasetTokensOf(s, ids). */
export function datasetTokens(ids: string[]): number {
  let total = 0;
  for (const id of new Set(ids)) total += DATASETS.find((d) => d.id === id)?.tokensB ?? 0;
  return total;
}

/** Unique tokens (billions) across dataset ids, static and custom. */
export function datasetTokensOf(s: GameState, ids: string[]): number {
  return uniqueTokensOf(s, ids);
}

/**
 * Datasets the player can see in the shop, owned or not, in catalogue order (rivals' signed deals excluded).
 * Thin view over availableDatasetsV2 kept for the existing panels.
 */
export function availableDatasets(s: GameState): DatasetDef[] {
  return availableDatasetsV2(s)
    .filter((r) => r.status !== 'lost')
    .map((r) => r.def);
}

/** Researched technique nodes that can be toggled in the wizard. */
export function availableTechniques(s: GameState): ResearchNode[] {
  return RESEARCH.filter((r) => r.technique && isResearched(s, r.id));
}

/**
 * Estimate a run before starting it. The run sheet defaults to the best unlocked sheet (defaultConfig). The
 * estimate carries the expected scores, the uncertainty band, and the (hidden until ablated) instability and risk.
 */
export function estimateTraining(
  s: GameState,
  paramsB: number,
  tokensB: number,
  datasetIds: string[],
  techniques: string[],
  config?: TrainingConfig,
): TrainingEstimate {
  const cfg = config ?? defaultConfig(s);
  // The belief: believed data quality and learning-rate quality, discovered emergences, no seed luck.
  const r = resolveRun(s, paramsB, tokensB, datasetIds, techniques, cfg, 'belief');
  const forecast = forecastFromPhys(s, r, tokensB, datasetIds, techniques, cfg);
  const predictedScores = scoresFromCaps(forecast.caps);
  return {
    totalFlops: r.totalFlops,
    days: r.days,
    dataQuality: r.dataQuality,
    predictedLoss: r.loss,
    predictedScores,
    predictedCaps: forecast.caps,
    overall: forecast.mid,
    config: cfg,
    activeParamsB: r.activeParamsB,
    clusterEfficiency: r.clusterEfficiency,
    instability: r.instability,
    incidentRisk: r.incidentRisk,
    incidentRate: r.incidentRate,
    tokensPerParam: r.tokensPerParam,
    underPenalty: r.underPenalty,
    uncertainty: (forecast.high - forecast.low) / (2 * LAB_TUNING.Z80),
    ablated: r.ablated,
    qualityMult: r.qualityMult,
    speedMult: r.speedMult,
    inferenceMult: r.inferenceMult,
    forecast,
  };
}

/** Loss on the displayed curve at training progress f (0..1). Starts high, ends at finalLoss. */
function lossCurve(finalLoss: number, progress: number): number {
  const start = Math.max(TRAINING_TUNING.LOSS_CURVE_START, finalLoss + 0.5);
  const k = TRAINING_TUNING.LOSS_CURVE_K;
  const f = clamp(progress, 0, 1);
  const h = (1 / (1 + k * f) - 1 / (1 + k)) / (1 - 1 / (1 + k));
  return finalLoss + (start - finalLoss) * h;
}

function arenaLeaderElo(s: GameState): number | null {
  let best: number | null = null;
  for (const c of s.competitors) {
    const elo = c.model?.elo;
    if (elo !== undefined && (best === null || elo > best)) best = elo;
  }
  return best;
}

function eloFor(overall: number): number {
  return TRAINING_TUNING.ELO_BASE + overall * TRAINING_TUNING.ELO_PER_POINT;
}

/** Shift every capability by the same amount (so the overall score moves by that amount). Vision stays 0 when 0. */
function shiftCaps(c: Capabilities, delta: number): Capabilities {
  const out = { ...c };
  for (const k of CAP_IDS) if (!(k === 'vision' && c[k] === 0)) out[k] = c[k] + delta;
  return out;
}

/** Eval day for a finished pretrain (GAME_DESIGN 16.4). The model is built from the TRUE result; the reveal shows the forecast against it. */
function finishPretrain(s: GameState, run: TrainingRun, rng: Rng): void {
  const cfg = runConfig(s, run);
  const hidden: RunHidden = run.hidden ?? { seedLuck: 0, seedTag: null, trueOverall: 0, vibes: 0 };
  const forecast = run.forecast ?? forecastTraining(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, cfg);
  settleEmergences(s, run);

  // Quirks: each rolled quirk is latent with a fixed chance. Emergences can add their own quirk (always visible).
  const rolled = rollQuirks(run, rng);
  const latent: Id[] = [];
  const quirks: Id[] = [];
  for (const id of rolled) (rng.chance(LAB_TUNING.LATENT_CHANCE) ? latent : quirks).push(id);
  const quirkCaps: Partial<Capabilities> = {};
  const addQuirkCaps = (id: Id) => {
    for (const [k, v] of Object.entries(quirkById(id)?.capAdd ?? {})) quirkCaps[k as keyof Capabilities] = (quirkCaps[k as keyof Capabilities] ?? 0) + (v ?? 0);
  };
  for (const id of rolled) addQuirkCaps(id);
  for (const id of run.emerged ?? []) {
    const q = emergenceById(id)?.quirk;
    if (q && !quirks.includes(q) && !latent.includes(q)) {
      quirks.push(q);
      addQuirkCaps(q);
    }
  }

  let caps = trueCapsOf(s, run, run.capAdd ?? {});
  caps = addCapDeltas(caps, quirkCaps);
  // Seed luck moves every capability equally, so the overall moves by the luck.
  caps = shiftCaps(caps, hidden.seedLuck);
  const scores = scoresFromCaps(caps);
  const overall = overallScore(scores);
  const yolo = cfg.lr >= 0.9 && !(run.incidents ?? []).includes('divergence');
  if (yolo) s.flags['yoloClean'] = 1;

  const model: Model = {
    id: newId(s, 'm'),
    name: run.name,
    paramsB: run.paramsB,
    tokensB: run.tokensB,
    datasetIds: [...run.datasetIds],
    techniques: [...run.techniques],
    finalLoss: run.predictedLoss,
    codename: run.name,
    scores,
    overall,
    elo: eloFor(overall) + (hidden.vibes ?? 0),
    trainedDay: s.day,
    releasedDay: null,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: optionById(cfg.context)?.contextK ?? contextWindowK(s),
    modalities: modalitiesFor(caps, []),
    contaminated: !!run.benchmaxx || !!run.accidentallyContaminated,
    config: cfg,
    activeParamsB: activeParamsFor(run.paramsB, cfg),
    quirks,
    latentQuirks: latent,
    inferenceMult: optionById(cfg.arch)?.inferenceMult ?? 1,
    vibes: hidden.vibes ?? 0,
    emergences: [...(run.emerged ?? [])],
    forecast,
  };
  evaluateModel(s, model);
  s.models.push(model);
  s.stats.modelsTrained += 1;
  // v6: only the standard suite is measured on eval day (GAME_DESIGN §17.2).
  const suite = measureEvalSuite(s, model, rng);

  // Verify the sets the run used: their true quality is now known.
  const dataSurprises: Record<Id, number> = {};
  for (const v of verifyRunDatasets(s, run.datasetIds)) {
    dataSurprises[v.id] = v.surprise;
    if (Math.abs(v.surprise) > LAB_TUNING.DATA_SURPRISE_EPS) {
      const line = dataSurpriseLine(s, `run:${model.id}:${v.id}`, { name: v.name, claimed: v.claimed, truth: v.truth });
      pushNews(s, line.text, line.kind);
    }
  }

  recordLabEval(s, {
    kind: 'pretrain',
    arch: cfg.arch,
    totalFlops: run.totalFlops,
    actual: overall,
    forecastMid: forecast.mid,
    modelId: model.id,
    day: s.day,
    discovered: discoveriesOf(s, run),
  });

  const verdict = verdictFor(overall, forecast, hidden.seedTag);
  s.pendingReveal = {
    modelId: model.id,
    kind: 'pretrain',
    forecast,
    actual: overall,
    verdict,
    seedTag: hidden.seedTag,
    emerged: [...(run.emerged ?? [])],
    quirks: [...quirks],
    dataSurprises,
    benchmarks: suite,
  };
  pushNews(s, verdictNews(s, rng, verdict, run.name, overall, forecast.mid), VERDICT_KIND[verdict]);
  notify(s, `${run.name} finished training. The eval report is in.`, 'milestone');
  pushNews(s, `Internal memo: ${run.name} has finished training. Nobody outside the building knows yet.`, 'info');
}

const VERDICT_KIND: Record<keyof typeof VERDICT_NEWS, 'good' | 'info' | 'bad'> = {
  banger: 'good',
  solid: 'good',
  'as expected': 'info',
  mid: 'bad',
  dud: 'bad',
  cursed: 'bad',
};

/** Eval day for a fine-tune: the spec took by its rolled amount, may have made the model forget something, and inherits vibes. */
function finishFinetune(s: GameState, run: TrainingRun, rng: Rng): void {
  const parent = s.models.find((m) => m.id === run.parentId);
  const spec = specById(run.specId);
  if (!parent || !spec) {
    notify(s, `${run.name} lost its parent model and was discarded.`, 'bad');
    return;
  }
  const cfg = parent.config ?? legacyConfig(s, parent.datasetIds, parent.contextK);
  const take = run.hidden?.specTake ?? 1;
  const forecast = run.forecast ?? forecastFinetune(s, parent.id, spec.id, run.persona);
  const trueCaps = trueFinetuneCaps(modelCaps(parent, s), spec, take, run.persona, rng, CAP_TUNING.FINETUNE_NOISE_SD);
  const forgot = applyForgetting(trueCaps, spec, rng);
  const caps = forgot.caps;
  const scores = scoresFromCaps(caps);
  const overall = overallScore(scores);
  const lineage = [...(parent.lineage ?? []), spec.id];

  // Quirks: the player's pick goes first, then sae_steering strips one negative quirk if any are left.
  let quirks = [...(parent.quirks ?? [])];
  if (run.removeQuirk && quirks.includes(run.removeQuirk)) quirks = quirks.filter((q) => q !== run.removeQuirk);
  if (isResearched(s, 'sae_steering')) {
    const negative = quirks.filter((q) => quirkById(q)?.good === false);
    if (negative.length > 0) {
      const drop = rng.pick(negative);
      quirks = quirks.filter((q) => q !== drop);
    }
  }
  const vibes = (parent.vibes ?? 0) * LAB_TUNING.VIBES_INHERIT + rng.normal(0, LAB_TUNING.VIBES_NEW_SD);

  const model: Model = {
    id: newId(s, 'm'),
    name: run.name,
    paramsB: run.paramsB,
    tokensB: parent.tokensB,
    datasetIds: [...parent.datasetIds],
    techniques: [...parent.techniques],
    finalLoss: parent.finalLoss,
    codename: run.name,
    scores,
    overall,
    elo: eloFor(overall) + vibes,
    trainedDay: s.day,
    releasedDay: null,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: spec.id,
    parentId: parent.id,
    lineage,
    contextK: parent.contextK ?? contextWindowK(s),
    modalities: modalitiesFor(caps, lineage),
    contaminated: !!run.benchmaxx || !!parent.contaminated,
    config: cfg,
    activeParamsB: (parent.activeParamsB ?? parent.paramsB) * (spec.paramsMult ?? 1),
    quirks,
    latentQuirks: [...(parent.latentQuirks ?? [])],
    inferenceMult: (parent.inferenceMult ?? 1) * personaInferenceMult(run.persona),
    vibes,
    forecast,
    ...(run.persona ? { persona: { ...run.persona } } : {}),
  };
  evaluateModel(s, model);
  s.models.push(model);
  s.stats.modelsTrained += 1;
  // v6: only the standard suite is measured on eval day (GAME_DESIGN §17.2).
  const suite = measureEvalSuite(s, model, rng);

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
  const verdict = verdictFor(overall, forecast, null);
  s.pendingReveal = {
    modelId: model.id,
    kind: 'finetune',
    forecast,
    actual: overall,
    verdict,
    seedTag: null,
    emerged: [],
    quirks: [...quirks],
    dataSurprises: {},
    benchmarks: suite,
  };
  if (forgot.lost) pushNews(s, `${run.name}: catastrophic forgetting. ${forgot.lost.text}.`, 'bad');
  pushNews(s, verdictNews(s, rng, verdict, run.name, overall, forecast.mid), VERDICT_KIND[verdict]);
  notify(s, `${run.name} finished fine-tuning. The eval report is in.`, 'milestone');
  pushNews(s, `${s.company.name} quietly fine-tunes ${parent.name} into ${run.name}. Nobody asked, and everyone will.`, 'info');
}

function finishRun(s: GameState, rng: Rng): void {
  const run = s.training;
  if (!run) return;
  s.training = null;
  if (run.kind === 'finetune') finishFinetune(s, run, rng);
  else if (run.kind === 'distill' || run.kind === 'merge') finishDerived(s, run, rng);
  else finishPretrain(s, run, rng);
}

/** Pick and raise a run incident. Logged on the run; the sim pauses until the player resolves it. */
function fireIncident(s: GameState, run: TrainingRun, rng: Rng): void {
  const eligible = RUN_INCIDENTS.map((d) => ({ d, w: d.weight(s, run) })).filter((x) => x.w > 0);
  if (eligible.length === 0) return;
  const total = eligible.reduce((t, x) => t + x.w, 0);
  let roll = rng.next() * total;
  let pick = eligible[eligible.length - 1].d;
  for (const x of eligible) {
    roll -= x.w;
    if (roll < 0) {
      pick = x.d;
      break;
    }
  }
  run.pendingIncident = { defId: pick.id, day: s.day };
  run.incidents = [...(run.incidents ?? []), pick.id];
  const kind = pick.good ? 'good' : 'bad';
  notify(s, `${run.name}: ${pick.title}. The run is paused until you decide.`, kind);
  pushNews(s, `${run.name} hits a snag: ${pick.title}.`, pick.good ? 'good' : 'bad');
}

/** Ablations finish on their day and reveal the instability and incident rate for their run sheet. */
function tickAblations(s: GameState): void {
  const PREFIX = 'ablationDone.';
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith(PREFIX) || s.day < s.flags[key]) continue;
    const sig = key.slice(PREFIX.length);
    delete s.flags[key];
    s.flags[`ablation.${sig}`] = s.day;
    const instability = s.flags[`ablationInstab.${sig}`] ?? 0;
    const rate = s.flags[`ablationRate.${sig}`] ?? 0;
    notify(
      s,
      `Ablation finished: instability ${instability.toFixed(2)}, about ${(rate * 365).toFixed(1)} incidents a year on that run sheet. Predictions are sharper for a year.`,
      'good',
    );
  }
}

export function trainingTick(s: GameState, rng: Rng): void {
  tickAblations(s);
  const run = s.training;
  if (!run) return;
  if (run.pendingIncident && run.pendingIncident.result === undefined) return;
  if ((run.stallDays ?? 0) > 0) {
    run.stallDays = (run.stallDays ?? 0) - 1;
    return;
  }
  // Fixed overhead (setup, warm-up, evals) comes before any FLOPs count. A part-day overhead leaves the rest of the day to work.
  let workShare = 1;
  if ((run.overheadLeft ?? 0) > 0) {
    const spent = Math.min(1, run.overheadLeft ?? 0);
    run.overheadLeft = Math.max(0, (run.overheadLeft ?? 0) - spent);
    if (spent >= 1) return;
    workShare = 1 - spent;
  }
  // v13: the run's tempo scales its speed (careful / standard / crunch) and its incident risk below.
  run.doneFlops = Math.min(run.totalFlops, run.doneFlops + workShare * liveRunRate(s, run));
  applyTempoDay(s, run);
  if (run.doneFlops >= run.totalFlops) {
    run.lossHistory.push(run.predictedLoss);
    finishRun(s, rng);
    return;
  }
  const progress = run.totalFlops > 0 ? run.doneFlops / run.totalFlops : 1;
  // Checkpoints and emergences (GAME_DESIGN 16.3), then the loss sample. The loss is the TRUE one.
  if (run.kind !== 'finetune') watchRun(s, run, rng);
  run.lossHistory.push(lossCurve(run.predictedLoss, plateauProgress(run, progress)) + rng.normal(0, TRAINING_TUNING.LOSS_NOISE_SD));
  if (!run.pendingIncident) {
    const phys: RunPhysics = runPhysics(s, run);
    if (rng.chance(phys.incidentRate * tempoRisk(s, tempoOf(run)))) fireIncident(s, run, rng);
  }
}

/** Cloud price of an ablation: its FLOPs at the cheapest available GPU rent, per FLOP. */
export function cheapestCloudCostPerFlop(s: GameState): number {
  const rentMult = s.flags['rentMult'] ?? 1;
  let best = Infinity;
  for (const g of availableGpus(s)) best = Math.min(best, g.rentPerDay / (g.pflops * 1e15 * 86_400));
  return best * rentMult;
}

/** Why a pretraining spec is not valid, or null. Shared by starting a run and ablating one. */
function validateSpec(
  s: GameState,
  paramsB: number,
  tokensB: number,
  datasetIds: string[],
  techniques: string[],
  cfg: TrainingConfig,
): string | null {
  const { MIN_PARAMS_B, MAX_PARAMS_B, MIN_TOKENS_B, MAX_EPOCHS } = TRAINING_TUNING;
  if (!Number.isFinite(paramsB) || paramsB < MIN_PARAMS_B || paramsB > MAX_PARAMS_B) {
    return `Parameters must be between ${MIN_PARAMS_B * 1000}M and ${(MAX_PARAMS_B / 1000).toFixed(0)}T.`;
  }
  if (!Number.isFinite(tokensB) || tokensB < MIN_TOKENS_B) return `Train on at least ${MIN_TOKENS_B}B tokens.`;
  const ids = [...new Set(datasetIds)];
  if (ids.length === 0) return 'Pick at least one dataset.';
  for (const id of ids) {
    if (!s.data.owned.includes(id)) return `You don't own ${datasetById(s, id)?.name ?? id} yet.`;
  }
  const unique = uniqueTokensOf(s, ids);
  if (tokensB > unique * MAX_EPOCHS + 1e-9) {
    return `${tokensB}B tokens is too many for ${unique.toFixed(1)}B unique (max ${MAX_EPOCHS} epochs). Add data or train on less.`;
  }
  const allowed = new Set(availableTechniques(s).map((t) => t.id));
  for (const id of new Set(techniques)) {
    if (!allowed.has(id)) return `Technique ${RESEARCH.find((r) => r.id === id)?.name ?? id} is not researched yet.`;
  }
  return validateConfig(s, cfg);
}

/**
 * Back-fill fields on a loaded state: old runs and models get the legacy run sheet and the v3 defaults.
 * Idempotent. Called by save.ts after loading.
 */
export function backfillTraining(s: GameState): void {
  for (const m of s.models) {
    if (!m.config) m.config = legacyConfig(s, m.datasetIds, m.contextK);
    if (m.activeParamsB === undefined) m.activeParamsB = activeParamsFor(m.paramsB, m.config);
    if (m.quirks === undefined) m.quirks = [];
    if (m.inferenceMult === undefined) m.inferenceMult = 1;
  }
  const run = s.training;
  if (!run) return;
  if (!run.config) run.config = legacyConfig(s, run.datasetIds);
  if (run.qualityMult === undefined || run.capAdd === undefined) {
    const phys = resolveRun(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, run.config, 'true');
    if (run.qualityMult === undefined) run.qualityMult = phys.qualityMult;
    if (run.capAdd === undefined) run.capAdd = phys.capAdd;
  }
  if (run.stallDays === undefined) run.stallDays = 0;
  if (run.pendingIncident === undefined) run.pendingIncident = null;
  if (run.log === undefined) run.log = [];
  if (run.incidents === undefined) run.incidents = [];
  if (run.accidentallyContaminated === undefined) run.accidentallyContaminated = false;
  if (run.uncertainty === undefined) run.uncertainty = RUN_TUNING.UNCERTAINTY_BASE;
  // v5 fog of training: an in-flight run from an older save gets a hidden record, a forecast and its belief loss.
  if (run.checkpoints === undefined) run.checkpoints = [];
  if (run.emerged === undefined) run.emerged = [];
  if (run.hidden === undefined) run.hidden = { seedLuck: 0, seedTag: null, trueOverall: 0, vibes: 0 };
  if (run.kind !== 'finetune') {
    if (run.forecast === undefined) run.forecast = forecastTraining(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, run.config);
    if (run.forecastLoss === undefined) run.forecastLoss = resolveRun(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, run.config, 'belief').loss;
    recomputeTrueOverall(s, run);
  }
}

export const handlers: ActionHandlers = {
  buyDataset: (s, a) => {
    // Purchases (one-off, licence and partnership fees) and their toasts live in the data module.
    buyDatasetV2(s, a.datasetId);
  },

  startTraining: (s, a, rng) => {
    const locked = trainingLockedNotice(s); // v9 scenario: locked until a year (Data broker)
    if (locked) {
      notify(s, locked, 'bad');
      return;
    }
    if (s.training) {
      notify(s, `${s.training.name} is still training. Cancel it first.`, 'bad');
      return;
    }
    const name = a.name.trim().slice(0, 40);
    if (!name) {
      notify(s, 'Give the model a name first.', 'bad');
      return;
    }
    const cfg = a.config ?? defaultConfig(s);
    const datasetIds = [...new Set(a.datasetIds)];
    const techniques = [...new Set(a.techniques)];
    const err = validateSpec(s, a.paramsB, a.tokensB, datasetIds, techniques, cfg);
    if (err) {
      notify(s, err, 'bad');
      return;
    }
    if (trainingRatePerDay(s, cfg) <= 0) {
      notify(s, 'No compute is allocated to training. Rent GPUs or raise the training share.', 'bad');
      return;
    }
    // The run itself uses the true world; the forecast the player sees uses the lab's belief.
    const phys = resolveRun(s, a.paramsB, a.tokensB, datasetIds, techniques, cfg, 'true');
    const believed = resolveRun(s, a.paramsB, a.tokensB, datasetIds, techniques, cfg, 'belief');
    const forecast = forecastTraining(s, a.paramsB, a.tokensB, datasetIds, techniques, cfg);
    const accidental = rng.chance(phys.contaminationChance);
    const hidden = rollPretrainHidden(s, rng, cfg, datasetIds, phys);
    s.training = {
      id: newId(s, 'run'),
      name,
      paramsB: a.paramsB,
      tokensB: a.tokensB,
      datasetIds,
      techniques,
      dataQuality: phys.dataQuality,
      totalFlops: phys.totalFlops,
      doneFlops: 0,
      startedDay: s.day,
      lossHistory: [],
      predictedLoss: phys.loss,
      forecastLoss: believed.loss,
      forecast,
      checkpoints: [],
      emerged: [],
      hidden,
      kind: 'pretrain',
      benchmaxx: !!a.benchmaxx,
      config: cfg,
      qualityMult: phys.qualityMult,
      capAdd: phys.capAdd,
      pendingIncident: null,
      log: [],
      stallDays: 0,
      uncertainty: (forecast.high - forecast.low) / (2 * LAB_TUNING.Z80),
      accidentallyContaminated: accidental,
      incidents: [],
      overheadLeft: phys.overheadDays,
    };
    recomputeTrueOverall(s, s.training);
    const days = Number.isFinite(phys.days) ? Math.ceil(phys.days) : 0;
    notify(
      s,
      `Training ${name} (${describeConfig(cfg)}): about ${days} days.${a.benchmaxx ? ' Test sets are in the training data. Nobody said that.' : ''}`,
      'info',
    );
  },

  startFinetune: (s, a, rng) => {
    const parent = s.models.find((m) => m.id === a.parentId);
    if (!parent) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    const spec = specById(a.specId);
    if (!spec) {
      notify(s, 'Unknown specialisation.', 'bad');
      return;
    }
    if (!availableSpecs(s, parent).some((x) => x.id === spec.id)) {
      notify(s, `${parent.name} can't become ${spec.name} yet. Check its lineage and the research it needs.`, 'bad');
      return;
    }
    if (s.training) {
      notify(s, `${s.training.name} is still training. Cancel it first.`, 'bad');
      return;
    }
    const cfg = parent.config ?? legacyConfig(s, parent.datasetIds, parent.contextK);
    if (trainingRatePerDay(s, cfg) <= 0) {
      notify(s, 'No compute is allocated to training. Rent GPUs or raise the training share.', 'bad');
      return;
    }
    if (a.removeQuirk !== undefined) {
      if (!isResearched(s, 'persona_vectors')) {
        notify(s, 'Picking a quirk to remove needs persona vectors research.', 'bad');
        return;
      }
      if (!(parent.quirks ?? []).includes(a.removeQuirk)) {
        notify(s, `${parent.name} doesn't have that quirk.`, 'bad');
        return;
      }
    }
    const name = (a.name ?? '').trim().slice(0, 40) || `${parent.name}${spec.suffix}`;
    // v8 doctrine: finetuneCost scales the fine-tune's compute (the doctrine's cheap-tuning hook).
    const flops = 6 * (parent.activeParamsB ?? parent.paramsB) * 1e9 * parent.tokensB * 1e9 * spec.computeFrac * (getBonuses(s).finetuneCost ?? 1);
    const persona = takesPersona(spec.id) ? effectivePersona(s, a.persona) : undefined;
    const specTake = rollSpecTake(rng);
    const forecast = forecastFinetune(s, parent.id, spec.id, persona);
    s.training = {
      id: newId(s, 'run'),
      name,
      paramsB: parent.paramsB * (spec.paramsMult ?? 1),
      tokensB: parent.tokensB,
      datasetIds: [...parent.datasetIds],
      techniques: [...parent.techniques],
      dataQuality: resolveRun(s, parent.paramsB, parent.tokensB, parent.datasetIds, parent.techniques, cfg, 'true').dataQuality,
      totalFlops: flops,
      doneFlops: 0,
      startedDay: s.day,
      lossHistory: [],
      predictedLoss: parent.finalLoss,
      forecast,
      forecastLoss: parent.finalLoss,
      checkpoints: [],
      emerged: [],
      hidden: {
        seedLuck: 0,
        seedTag: null,
        trueOverall: finetuneTrueOverall(s, parent.id, spec.id, specTake, persona),
        vibes: 0,
        specTake,
      },
      kind: 'finetune',
      parentId: parent.id,
      specId: spec.id,
      benchmaxx: !!a.benchmaxx,
      config: cfg,
      qualityMult: 1,
      capAdd: {},
      pendingIncident: null,
      log: [],
      stallDays: 0,
      uncertainty: 0,
      accidentallyContaminated: false,
      incidents: [],
      ...(persona ? { persona } : {}),
      ...(a.removeQuirk !== undefined ? { removeQuirk: a.removeQuirk } : {}),
    };
    notify(s, `Fine-tuning ${parent.name} into ${name}.${a.benchmaxx ? ' The benchmarks are in the training data now.' : ''}`, 'info');
  },

  cancelTraining: (s) => {
    const run = s.training;
    if (!run) {
      notify(s, 'Nothing is training right now.', 'info');
      return;
    }
    const pct = run.totalFlops > 0 ? Math.floor((run.doneFlops / run.totalFlops) * 100) : 0;
    s.training = null;
    notify(s, `Cancelled ${run.name} at ${pct}%. That compute is gone.`, 'bad');
  },

  resolveRunIncident: (s, a, rng) => {
    const run = s.training;
    const pending = run?.pendingIncident;
    if (!run || !pending) {
      notify(s, 'Nothing needs a decision right now.', 'info');
      return;
    }
    if (pending.result !== undefined) return;
    const def = runIncidentById(pending.defId);
    const choice = def?.choices[a.choice];
    if (!def || !choice) {
      notify(s, 'That is not one of the options.', 'bad');
      return;
    }
    if (choice.available && !choice.available(s, run)) {
      notify(s, `"${choice.label}" is not possible right now.`, 'bad');
      return;
    }
    const before = snapshotTangible(s, run);
    const result = choice.effect(s, run, rng);
    const deltas = diffTangible(before, s, run);
    // Incidents change qualityMult or capAdd, so the hidden true overall moves with them.
    recomputeTrueOverall(s, run);
    pending.result = result;
    pending.deltas = deltas;
    run.log = [...(run.log ?? []), { day: s.day, text: `${def.title}: ${result}`, kind: def.good ? 'good' : 'info' }];
    s.flags['incidentsSurvived'] = (s.flags['incidentsSurvived'] ?? 0) + 1;
    notify(s, result, def.good ? 'good' : 'info');
  },

  clearRunIncident: (s) => {
    const run = s.training;
    if (!run?.pendingIncident) return;
    if (run.pendingIncident.result === undefined) {
      notify(s, 'Decide what to do about it first.', 'bad');
      return;
    }
    run.pendingIncident = null;
  },

  earlyStopTraining: (s, _a, rng) => {
    const run = s.training;
    if (!run) {
      notify(s, 'Nothing is training right now.', 'info');
      return;
    }
    if (run.kind === 'finetune') {
      notify(s, 'Early stopping is for pretraining runs.', 'bad');
      return;
    }
    const progress = run.totalFlops > 0 ? clamp(run.doneFlops / run.totalFlops, 0, 1) : 0;
    if (progress <= 0) {
      notify(s, `${run.name} has not trained anything yet. Cancel it instead.`, 'bad');
      return;
    }
    const cfg = runConfig(s, run);
    const keep = RUN_TUNING.KEEP[cfg.schedule] ?? RUN_TUNING.KEEP.cosine;
    const keepFactor = keep.base + keep.slope * progress;
    const tokensB = run.tokensB * progress;
    const phys = resolveRun(s, run.paramsB, tokensB, run.datasetIds, run.techniques, cfg, 'true');
    run.tokensB = tokensB;
    run.predictedLoss = phys.loss;
    run.dataQuality = phys.dataQuality;
    run.qualityMult = (run.qualityMult ?? 1) * keepFactor;
    run.totalFlops = run.doneFlops;
    if (cfg.schedule === 'wsd') s.flags['earlyStopWsd'] = 1;
    notify(s, `Stopped ${run.name} at ${(progress * 100).toFixed(0)}%. It keeps ${(keepFactor * 100).toFixed(0)}% of the full-run quality.`, 'info');
    finishRun(s, rng);
  },

  extendTraining: (s, a) => {
    const run = s.training;
    if (!run) {
      notify(s, 'Nothing is training right now.', 'info');
      return;
    }
    if (run.kind === 'finetune' || run.kind === 'distill' || run.kind === 'merge') {
      notify(s, 'Only pretraining runs can be extended.', 'bad');
      return;
    }
    if (!Number.isFinite(a.fraction) || a.fraction < RUN_TUNING.EXTEND_MIN || a.fraction > RUN_TUNING.EXTEND_MAX) {
      notify(s, `Extend by between ${RUN_TUNING.EXTEND_MIN * 100}% and ${RUN_TUNING.EXTEND_MAX * 100}%.`, 'bad');
      return;
    }
    const tokensB = run.tokensB * (1 + a.fraction);
    const unique = uniqueTokensOf(s, run.datasetIds);
    if (tokensB > unique * RUN_TUNING.MAX_EPOCHS + 1e-9) {
      notify(s, 'Not enough data headroom for that. Buy more data or extend less.', 'bad');
      return;
    }
    const cfg = runConfig(s, run);
    const phys = resolveRun(s, run.paramsB, tokensB, run.datasetIds, run.techniques, cfg, 'true');
    run.tokensB = tokensB;
    run.totalFlops = phys.totalFlops;
    run.predictedLoss = phys.loss;
    run.dataQuality = phys.dataQuality;
    notify(s, `Extended ${run.name} by ${(a.fraction * 100).toFixed(0)}%. It will take longer and know more.`, 'info');
  },

  runAblation: (s, a) => {
    const err = validateSpec(s, a.paramsB, a.tokensB, a.datasetIds, [], a.config);
    if (err) {
      notify(s, err, 'bad');
      return;
    }
    const sig = configSignature(a.config);
    if (s.flags[`ablationDone.${sig}`] !== undefined) {
      notify(s, 'That ablation is already running.', 'info');
      return;
    }
    const known = s.flags[ablationFlag(a.config)];
    if (known !== undefined && s.day - known <= RUN_TUNING.ABLATION_WINDOW_DAYS) {
      notify(s, 'That run sheet was ablated recently. The results still stand.', 'info');
      return;
    }
    const phys = resolveRun(s, a.paramsB, a.tokensB, a.datasetIds, [], a.config);
    const cost = Math.round(RUN_TUNING.ABLATION_FRACTION * phys.totalFlops * cheapestCloudCostPerFlop(s));
    if (!Number.isFinite(cost)) {
      notify(s, 'No cloud GPUs are available to run an ablation.', 'bad');
      return;
    }
    if (!trySpend(s, 'compute', cost, 'the ablation')) return;
    s.flags[`ablationDone.${sig}`] = s.day + RUN_TUNING.ABLATION_DAYS;
    s.flags[`ablationInstab.${sig}`] = phys.instability;
    s.flags[`ablationRate.${sig}`] = phys.incidentRate;
    notify(s, `Ablation started for ${describeConfig(a.config)}: ${formatMoney(cost)} of cloud time, results in ${RUN_TUNING.ABLATION_DAYS} days.`, 'info');
  },

  releaseModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is already public.`, 'info');
      return;
    }
    if (m.deprecated) {
      notify(s, `${m.name} is deprecated and can't be released.`, 'bad');
      return;
    }
    const arena = arenaLeaderElo(s);
    const beatsArena = arena === null || m.elo > arena;
    let prevBest = -1;
    for (const x of s.models) if (x.releasedDay !== null) prevBest = Math.max(prevBest, x.overall);
    const beatsOwn = m.overall > prevBest;

    const arenaF = beatsArena ? 1 : 0.4;
    const ownF = beatsOwn ? 1 : 0.5;
    const brandGain = (2 + 4 * arenaF) * ownF * getBonuses(s).brand;
    const hypeGain = (5 + 15 * arenaF) * ownF + (specById(m.specId)?.releaseHype ?? 0);
    s.company.brand = clamp(s.company.brand + brandGain, 0, 100);
    s.company.hype = clamp(s.company.hype + hypeGain, 0, 100);
    s.market.aiHype = clamp(s.market.aiHype + (beatsArena ? 1.5 : 0.3) * ownF, 0, 100);

    m.releasedDay = s.day;
    m.eloSettlesDay = s.day + LAB_TUNING.ELO_SETTLE_DAYS;
    s.stats.modelsReleased += 1;
    s.stats.bestElo = Math.max(s.stats.bestElo, m.elo);

    const elo = Math.round(m.elo);
    const label = m.specId ? `${m.name} (${specById(m.specId)?.name ?? 'fine-tune'})` : m.name;
    if (beatsArena) {
      pushNews(s, `${s.company.name} releases ${label} and takes the top spot on the arena (Elo ${elo}).`, 'milestone');
    } else if (beatsOwn) {
      pushNews(s, `${s.company.name} releases ${label}. Good model, not the arena leader (Elo ${elo}).`, 'good');
    } else {
      pushNews(s, `${s.company.name} releases ${label}. A step back from the last flagship (Elo ${elo}).`, 'info');
    }
    const sota = releaseSota(s, m);
    notify(s, `Released ${m.name}: brand +${brandGain.toFixed(1)}, hype +${hypeGain.toFixed(1)}${sota ? `, ${sota} headline SOTA${sota > 1 ? 's' : ''}` : ''}.`, 'good');
  },

  deprecateModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.deprecated) {
      notify(s, `${m.name} is already deprecated.`, 'info');
      return;
    }
    m.deprecated = true;
    notify(s, `${m.name} is deprecated. Nobody will miss it. Probably.`, 'info');
  },
};
