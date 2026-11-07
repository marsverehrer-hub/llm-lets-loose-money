// Player action handlers for training (start, fine-tune, cancel, incidents, early stop, ablations).
import type { ActionHandlers, Capabilities } from '../../types';
import { RUN_TUNING, configSignature, defaultConfig, describeConfig, legacyConfig, optionById } from '../../data/trainingOptions';
import { runIncidentById } from '../../data/runIncidents';
import { rollTraits } from '../traits';
import { getBonuses } from '../../bonuses';
import { clamp, formatMoney, newId, notify, trySpend } from '../../util';
import { trainingLockedNotice } from '../scenario'; // v9 scenario
import { isResearched } from '../research';
import { diffTangible, snapshotTangible } from '../eventDeltas';
import { buyDatasetV2 } from '../data';
import { availableSpecs, effectivePersona, specById, takesPersona, trainingRatePerDay } from '../capabilities';
import { ablationFlag, extendRun, mixRows, resolveRun, runConfig, truncateRun } from '../trainingMath';
import { finetuneTrueOverall, forecastFinetune, forecastTraining, recomputeTrueOverall, rollPretrainHidden, rollSpecTake, LAB_TUNING } from '../lab';
import { isOwnBase } from '../derive';
import { cheapestCloudCostPerFlop, planRunCalls } from './calls';
import { finishRun } from './finish';
import { rollStageTakes } from './helpers';
import { validateSpec } from './validate';

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
    // v19: continued pretraining keeps the base's params and run sheet; a.tokensB is then the extra data.
    const base = a.continueFrom === undefined ? undefined : s.models.find((m) => m.id === a.continueFrom);
    if (a.continueFrom !== undefined && !isOwnBase(base)) {
      notify(s, 'Only your own pretrained base model can continue pretraining.', 'bad');
      return;
    }
    const paramsB = base ? base.paramsB : a.paramsB;
    const cfg = base ? (base.config ?? legacyConfig(s, base.datasetIds, base.contextK)) : (a.config ?? defaultConfig(s));
    const datasetIds = [...new Set(a.datasetIds)];
    const techniques = [...new Set(a.techniques)];
    const err = validateSpec(s, paramsB, a.tokensB, datasetIds, techniques, cfg);
    if (err) {
      notify(s, err, 'bad');
      return;
    }
    if (trainingRatePerDay(s, cfg) <= 0) {
      notify(s, 'No compute is allocated to training. Rent GPUs or set Fleet priority in Compute to favour training.', 'bad');
      return;
    }
    // The loss sees the base's tokens plus the new ones; the FLOPs are only the new ones.
    const tokensB = base ? base.tokensB + a.tokensB : a.tokensB;
    // The run itself uses the true world; the forecast the player sees uses the lab's belief.
    const phys = resolveRun(s, paramsB, tokensB, datasetIds, techniques, cfg, 'true');
    if (base) {
      phys.totalFlops = 6 * phys.activeParamsB * 1e9 * a.tokensB * 1e9 * phys.flopsMult;
      phys.days = phys.rate > 0 ? phys.totalFlops / phys.rate + phys.overheadDays : Infinity;
    }
    const believed = resolveRun(s, paramsB, tokensB, datasetIds, techniques, cfg, 'belief');
    const forecast = forecastTraining(s, paramsB, tokensB, datasetIds, techniques, cfg);
    const accidental = rng.chance(phys.contaminationChance);
    const hidden = rollPretrainHidden(s, rng, cfg, datasetIds, phys);
    // v16: each stage's take moves the TRUE caps away from what the sheet shows (the forecast assumes a take of 1).
    let capAdd = phys.capAdd;
    if (cfg.post?.length) {
      hidden.postTake = rollStageTakes(rng, cfg);
      for (const [id, take] of Object.entries(hidden.postTake)) {
        for (const [k, v] of Object.entries(optionById(id)?.capAdd ?? {})) {
          capAdd = { ...capAdd, [k]: (capAdd[k as keyof Capabilities] ?? 0) + (take - 1) * (v ?? 0) };
        }
      }
      // v18: hidden side effects of the stages, scaled by how well each one took.
      hidden.traits = rollTraits(rng, cfg, mixRows(s, datasetIds, cfg, 'true'), hidden.postTake);
    }
    s.training = {
      id: newId(s, 'run'),
      name,
      paramsB,
      tokensB,
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
      capAdd,
      pendingIncident: null,
      log: [],
      stallDays: 0,
      uncertainty: (forecast.high - forecast.low) / (2 * LAB_TUNING.Z80),
      accidentallyContaminated: accidental,
      incidents: [],
      overheadLeft: phys.overheadDays,
      ...(base ? { parentId: base.id } : {}),
    };
    s.training.calls = planRunCalls(s, s.training, phys.days);
    if (s.training.calls.length > 0) s.flags['callRuns'] = (s.flags['callRuns'] ?? 0) + 1;
    recomputeTrueOverall(s, s.training);
    const days = Number.isFinite(phys.days) ? Math.ceil(phys.days) : 0;
    notify(
      s,
      `Training ${name} (${describeConfig(cfg)}): about ${days} days.${base ? ` Continuing ${base.name} on ${a.tokensB}B new tokens.` : ''}${a.benchmaxx ? ' Test sets are in the training data. Nobody said that.' : ''}`,
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
      notify(s, 'No compute is allocated to training. Rent GPUs or set Fleet priority in Compute to favour training.', 'bad');
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
    if (!pending.call) s.flags['incidentsSurvived'] = (s.flags['incidentsSurvived'] ?? 0) + 1;
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
    const schedule = runConfig(s, run).schedule;
    const keepFactor = truncateRun(s, run);
    if (schedule === 'wsd') s.flags['earlyStopWsd'] = 1;
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
    const err = extendRun(s, run, a.fraction);
    if (err) {
      notify(s, err, 'bad');
      return;
    }
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

  deprecateModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.deprecated) {
      notify(s, `${m.name} is already off sale.`, 'info');
      return;
    }
    m.deprecated = true;
    notify(s, `${m.name} is off sale. Nobody will miss it. Probably.`, 'info');
  },
};
