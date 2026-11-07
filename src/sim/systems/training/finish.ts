// Run completion: pretrain and fine-tune eval days, finishing a run, and run incidents.
import type { Capabilities, GameState, Id, Model, Rng, RunHidden, TrainingConfig, TrainingRun } from '../../types';
import { CAP_TUNING } from '../../balance';
import { legacyConfig, optionById } from '../../data/trainingOptions';
import { RUN_INCIDENTS } from '../../data/runIncidents';
import { quirkById, rollQuirks } from '../../data/quirks';
import { newId, notify, pushNews } from '../../util';
import { isResearched } from '../research';
import { measureEvalSuite } from '../vault';
import { addCapDeltas, contextWindowK, evaluateModel, modalitiesFor, modelCaps, overallScore, personaInferenceMult, scoresFromCaps, specById } from '../capabilities';
import { activeParamsFor, configInferenceMult, mixRows, runConfig, runSynergies } from '../trainingMath';
import { STAGE_TAKE } from '../../data/recipes';
import { applyForgetting, discoveriesOf, dataSurpriseLine, forecastFinetune, forecastTraining, labOf, recomputeTrueOverall, recordLabEval, settleEmergences, trueFinetuneCaps, verdictFor, verdictNews, trueCapsOf, verifyRunDatasets, LAB_TUNING } from '../lab';
import { emergenceById } from '../../data/emergences';
import { finishDerived, nextVersionName } from '../derive';
import { VERDICT_NEWS } from '../../data/evalCopy';
import { eloFor, shiftCaps } from './helpers';

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

  // v19: a continued run is the next version of its base model.
  const base = run.parentId ? s.models.find((m) => m.id === run.parentId) : undefined;
  const model: Model = {
    id: newId(s, 'm'),
    name: base ? nextVersionName(base.name) : run.name,
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
    inferenceMult: configInferenceMult(cfg),
    vibes: hidden.vibes ?? 0,
    emergences: [...(run.emerged ?? [])],
    forecast,
    ...(hidden.traits ? { traits: { ...hidden.traits } } : {}),
    ...(base ? { continuedFrom: base.id } : {}),
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
  const notes = pretrainNotes(s, run, cfg, hidden);
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
    ...(notes.length ? { notes } : {}),
    ...(hidden.traits ? { traits: { ...hidden.traits } } : {}),
  };
  for (const n of notes) run.log = [...(run.log ?? []), { day: s.day, text: n, kind: 'info' }];
  pushNews(s, verdictNews(s, rng, verdict, run.name, overall, forecast.mid), VERDICT_KIND[verdict]);
  notify(s, `${run.name} finished training. The eval report is in.`, 'milestone');
  pushNews(s, `Internal memo: ${run.name} has finished training. Nobody outside the building knows yet.`, 'info');
}

/**
 * v16 lab notebook (GAME_DESIGN §28.1): why the run landed where it did. Post-training stages that broke through or
 * fizzled, recipe × data interactions (new ones become discoveries the forecasts use from now on) and seed luck.
 */
function pretrainNotes(s: GameState, run: TrainingRun, cfg: TrainingConfig, hidden: RunHidden): string[] {
  const notes: string[] = [];
  for (const [id, take] of Object.entries(hidden.postTake ?? {})) {
    const name = optionById(id)?.name ?? id;
    if (take >= STAGE_TAKE.BREAKTHROUGH - 0.01) notes.push(`Breakthrough: ${name} took about twice as well as usual.`);
    else if (take <= STAGE_TAKE.DUD + 0.01) notes.push(`Dud: ${name} barely moved the model this time. The compute is spent.`);
    else if (take >= 1.3) notes.push(`${name} took better than usual.`);
    else if (take <= 0.7) notes.push(`${name} took worse than usual.`);
  }
  const lab = labOf(s);
  lab.synergies ??= {};
  for (const syn of runSynergies(s, cfg, mixRows(s, run.datasetIds, cfg, 'true'), 'true')) {
    const fresh = lab.synergies[syn.id] === undefined;
    lab.synergies[syn.id] ??= s.day;
    notes.push(`${fresh ? 'Found' : 'Again'}: ${syn.name}. ${syn.explain}`);
  }
  if (hidden.seedTag === 'golden') notes.push('Golden seed: the initialisation was simply lucky. Nobody can repeat it.');
  if (hidden.seedTag === 'cursed') notes.push('Cursed seed: the same sheet on another seed would have done better.');
  return notes;
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
    ...(parent.traits ? { traits: { ...parent.traits } } : {}),
    ...(parent.origin ? { origin: { ...parent.origin } } : {}), // v19: a fine-tune keeps its hub license
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

export function finishRun(s: GameState, rng: Rng): void {
  const run = s.training;
  if (!run) return;
  s.training = null;
  if (run.kind === 'finetune') finishFinetune(s, run, rng);
  else if (run.kind === 'distill' || run.kind === 'merge') finishDerived(s, run, rng);
  else finishPretrain(s, run, rng);
}

/** Pick and raise a run incident. Logged on the run; the sim pauses until the player resolves it. */
export function fireIncident(s: GameState, run: TrainingRun, rng: Rng): void {
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
  run.incidents = [...(run.incidents ?? []), pick.id];
  // v18: a standing spike policy answers loss spikes without pausing the run (if its choice is possible).
  const policy = pick.id === 'loss_spike' && run.spikePolicy !== undefined ? pick.choices[run.spikePolicy] : undefined;
  if (policy && (!policy.available || policy.available(s, run))) {
    const result = policy.effect(s, run, rng);
    recomputeTrueOverall(s, run);
    run.log = [...(run.log ?? []), { day: s.day, text: `${pick.title}: ${result}`, kind: 'info' }];
    s.flags['incidentsSurvived'] = (s.flags['incidentsSurvived'] ?? 0) + 1;
    notify(s, `${run.name}: ${result}`, 'info', { toast: true });
    return;
  }
  run.pendingIncident = { defId: pick.id, day: s.day };
  const kind = pick.good ? 'good' : 'bad';
  notify(s, `${run.name}: ${pick.title}. The run is paused until you decide.`, kind);
  pushNews(s, `${run.name} hits a snag: ${pick.title}.`, pick.good ? 'good' : 'bad');
}
