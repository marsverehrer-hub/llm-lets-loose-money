// True physics for runs: hidden luck, emergence plans, grokking, true caps, checkpoints and eval bookkeeping.

import type { Capabilities, CapId, Forecast, GameState, Id, Persona, Rng, RunHidden, TrainingConfig, TrainingRun } from '../../types';
import { CAP_IDS } from '../../types';
import { EMERGENCES, emergenceById } from '../../data/emergences';
import { CHECKPOINT_NOTES, VERDICT_NEWS, pickCopy, type Verdict } from '../../data/evalCopy';
import { notify, clamp } from '../../util';
import { CAP_TUNING } from '../../balance';
import { isResearched } from '../research';
import { addCapDeltas, capsFromTraining, clampCaps, modelCaps, overallScore, personaCapAdd, scoresFromCaps, specById } from '../capabilities';
import { mixRows, resolveRun, runConfig, type RunPhysics } from '../trainingMath';
import { LAB_TUNING, FORGET_COPY } from './tuning';
import { effLog10, emergenceThresholdOf, labOf, requirementsMet, scaleCapAdd, shareMap, sumCapAdd } from './notebook';

// ---------------------------------------------------------------------------
// True physics for runs (hidden truths, GAME_DESIGN 16.1 and 16.3)
// ---------------------------------------------------------------------------

/** Seed luck and tag for a pre-training run. */
export function rollSeedLuck(rng: Rng): { seedLuck: number; seedTag: 'golden' | 'cursed' | null } {
  const r = rng.next();
  const cap = (x: number) => clamp(x, -LAB_TUNING.LUCK_CAP, LAB_TUNING.LUCK_CAP);
  if (r < LAB_TUNING.GOLDEN_CHANCE) return { seedLuck: cap(rng.normal(LAB_TUNING.GOLDEN_MEAN, LAB_TUNING.GOLDEN_SD)), seedTag: 'golden' };
  if (r < LAB_TUNING.GOLDEN_CHANCE + LAB_TUNING.CURSED_CHANCE) {
    return { seedLuck: cap(rng.normal(LAB_TUNING.CURSED_MEAN, LAB_TUNING.CURSED_SD)), seedTag: 'cursed' };
  }
  return { seedLuck: cap(rng.normal(0, LAB_TUNING.LUCK_SD)), seedTag: null };
}

/**
 * Which rolled emergences this run can produce: those whose requirements hold and whose threshold the FULL run
 * reaches, each passing its chance roll once. Detection happens during the run.
 */
export function planEmergences(s: GameState, rng: Rng, cfg: TrainingConfig, datasetIds: readonly Id[], truePhys: RunPhysics): Id[] {
  const shares = shareMap(mixRows(s, datasetIds, cfg, 'true'));
  const L = effLog10(truePhys);
  const plan: Id[] = [];
  const known = labOf(s).discoveries;
  let fresh = 0;
  for (const def of EMERGENCES) {
    if (!requirementsMet(s, def, shares)) continue;
    if (L < emergenceThresholdOf(s, def)) continue;
    if (!rng.chance(def.chance)) continue;
    // Already-discovered abilities come along freely; brand-new discoveries are rationed so they keep coming
    // one or two at a time instead of all landing on the first big run.
    if (!known[def.id]) {
      if (fresh >= LAB_TUNING.MAX_NEW_EMERGENCES_PER_RUN) continue;
      fresh += 1;
    }
    plan.push(def.id);
  }
  return plan;
}

/** Hidden truths for a new pre-training run: luck, vibes, emergence plan and grokking. The true overall is set by recomputeTrueOverall. */
export function rollPretrainHidden(s: GameState, rng: Rng, cfg: TrainingConfig, datasetIds: readonly Id[], truePhys: RunPhysics): RunHidden {
  const luck = rollSeedLuck(rng);
  const emergencePlan = planEmergences(s, rng, cfg, datasetIds, truePhys);
  let grokking: [number, number] | undefined;
  if (rng.chance(LAB_TUNING.GROK_CHANCE)) {
    const from = rng.range(LAB_TUNING.GROK_FROM[0], LAB_TUNING.GROK_FROM[1]);
    const to = Math.min(LAB_TUNING.GROK_END_MAX, from + rng.range(LAB_TUNING.GROK_LENGTH[0], LAB_TUNING.GROK_LENGTH[1]));
    grokking = [from, to];
  }
  const vibes = rng.normal(0, LAB_TUNING.VIBES_SD);
  return {
    seedLuck: luck.seedLuck,
    seedTag: luck.seedTag,
    trueOverall: 0,
    vibes,
    emergencePlan,
    ...(grokking ? { grokking } : {}),
  };
}

/** Fine-tune: how well the specialisation took. */
export function rollSpecTake(rng: Rng): number {
  return clamp(rng.normal(1, LAB_TUNING.SPEC_TAKE_SD), LAB_TUNING.SPEC_TAKE_MIN, LAB_TUNING.SPEC_TAKE_MAX);
}

/** Planned emergences not yet detected in this run. */
function pendingPlan(run: TrainingRun): Id[] {
  const emerged = new Set(run.emerged ?? []);
  return (run.hidden?.emergencePlan ?? []).filter((id) => !emerged.has(id));
}

/** Capability changes of emergences planned for this run but not yet seen. */
export function pendingPlanCapAdd(run: TrainingRun): Partial<Capabilities> {
  let out: Partial<Capabilities> = {};
  for (const id of pendingPlan(run)) {
    const def = emergenceById(id);
    if (def) out = sumCapAdd(out, scaleCapAdd(def.capAdd, LAB_TUNING.EMERGENCE_CAP_SCALE));
  }
  return out;
}

/** The true capabilities of a run with the given capAdd. Noise-free; luck and vibes are applied separately. */
export function trueCapsOf(s: GameState, run: TrainingRun, capAdd: Partial<Capabilities>): Capabilities {
  return capsFromTraining(
    s,
    { loss: run.predictedLoss, tokensB: run.tokensB, datasetIds: run.datasetIds, techniques: run.techniques, qualityMult: run.qualityMult ?? 1, capAdd },
    null,
  );
}

/** Recompute hidden.trueOverall from the run's current true inputs (after incidents, early stop, extension, emergences). */
export function recomputeTrueOverall(s: GameState, run: TrainingRun): void {
  if (run.kind === 'finetune' || !run.hidden) return;
  const caps = trueCapsOf(s, run, sumCapAdd(run.capAdd ?? {}, pendingPlanCapAdd(run)));
  run.hidden.trueOverall = overallScore(scoresFromCaps(caps)) + run.hidden.seedLuck;
}

/** Progress-based effective compute of a run in the true world, at a fraction of its tokens. */
function runEffLog10(s: GameState, run: TrainingRun, fraction: number): number {
  const phys = resolveRun(s, run.paramsB, run.tokensB * fraction, run.datasetIds, run.techniques, runConfig(s, run), 'true');
  return effLog10(phys);
}

/** The loss display progress: flat through a grokking plateau, then the drop. */
export function plateauProgress(run: TrainingRun, progress: number): number {
  const g = run.hidden?.grokking;
  if (g && progress >= g[0] && progress < g[1]) return g[0];
  return progress;
}

function logRun(run: TrainingRun, s: GameState, text: string, kind: 'good' | 'bad' | 'info' | 'milestone'): void {
  run.log = [...(run.log ?? []), { day: s.day, text, kind }];
}

function doCheckpoint(s: GameState, run: TrainingRun, at: number, rng: Rng): void {
  const band = (LAB_TUNING.CHECKPOINT_BAND[at] ?? 3) * (isResearched(s, 'scaling_laws') ? LAB_TUNING.SCALING_LAWS_FACTOR : 1);
  const reading = (run.hidden?.trueOverall ?? 0) + rng.normal(0, band);
  const f = run.forecast;
  const where: 'above' | 'on' | 'below' = f ? (reading > f.high ? 'above' : reading < f.low ? 'below' : 'on') : 'on';
  const pct = Math.round(at * 100);
  const note = pickCopy(rng, CHECKPOINT_NOTES[where], { model: run.name, pct });
  run.checkpoints = [...(run.checkpoints ?? []), { at, day: s.day, reading, band, note }];
  const n = run.checkpoints.length;
  const kind = where === 'above' ? 'good' : where === 'below' ? 'bad' : 'info';
  const text = `Checkpoint ${n} evals (${pct}%): tracking ${reading.toFixed(0)} ± ${band.toFixed(0)}. ${note}`;
  notify(s, `${run.name}: ${text}`, kind);
  logRun(run, s, text, kind);
}

/**
 * Watch a live pre-training run: checkpoints at 25/50/75% and emergences as compute crosses their thresholds.
 * Called every day from the training tick, before the loss sample.
 */
export function watchRun(s: GameState, run: TrainingRun, rng: Rng): void {
  if (run.kind === 'finetune' || !run.hidden || run.totalFlops <= 0) return;
  const p = clamp(run.doneFlops / run.totalFlops, 0, 1);
  const done = new Set((run.checkpoints ?? []).map((c) => c.at));
  for (const at of LAB_TUNING.CHECKPOINT_STEPS) {
    if (p >= at && !done.has(at)) doCheckpoint(s, run, at, rng);
  }
  const pending = pendingPlan(run);
  if (pending.length === 0) return;
  const L = runEffLog10(s, run, p);
  for (const id of pending) {
    const def = emergenceById(id);
    if (!def || L < emergenceThresholdOf(s, def)) continue;
    run.emerged = [...(run.emerged ?? []), id];
    run.capAdd = sumCapAdd(run.capAdd ?? {}, scaleCapAdd(def.capAdd, LAB_TUNING.EMERGENCE_CAP_SCALE));
    const pct = Math.round(p * 100);
    const text = `At ${pct}%: ${def.name}. ${def.description}`;
    notify(s, `${run.name} ${text}`, def.good ? 'milestone' : 'bad');
    logRun(run, s, text, def.good ? 'good' : 'bad');
  }
  recomputeTrueOverall(s, run);
}

/** At the end of a run: emergences whose thresholds the finished run reached count, the rest never show. */
export function settleEmergences(s: GameState, run: TrainingRun): void {
  const pending = pendingPlan(run);
  if (pending.length === 0) return;
  const L = runEffLog10(s, run, 1);
  for (const id of pending) {
    const def = emergenceById(id);
    if (!def || L < emergenceThresholdOf(s, def)) continue;
    run.emerged = [...(run.emerged ?? []), id];
    run.capAdd = sumCapAdd(run.capAdd ?? {}, scaleCapAdd(def.capAdd, LAB_TUNING.EMERGENCE_CAP_SCALE));
  }
}

/** Verdict from the actual overall against the forecast band (GAME_DESIGN 16.4). */
export function verdictFor(actual: number, forecast: Forecast, seedTag: 'golden' | 'cursed' | null): Verdict {
  const d = actual - forecast.mid;
  const w = (forecast.high - forecast.low) / 2;
  if (seedTag === 'cursed' && d < -w) return 'cursed';
  if (d > 1.5 * w) return 'banger';
  if (d > 0.5 * w) return 'solid';
  if (Math.abs(d) <= 0.5 * w) return 'as expected';
  if (d < -1.5 * w) return 'dud';
  return 'mid';
}

/** Ticker line for an eval verdict. */
export function verdictNews(s: GameState, rng: Rng, verdict: Verdict, model: string, actual: number, mid: number): string {
  return pickCopy(rng, VERDICT_NEWS[verdict], { model, actual: actual.toFixed(1), mid: mid.toFixed(1), company: s.company.name });
}

/** Lab bookkeeping at eval day: runs per arch, largest run, forecast track record and discoveries. */
export function recordLabEval(
  s: GameState,
  o: { kind: 'pretrain' | 'finetune'; arch: Id; totalFlops: number; actual: number; forecastMid: number; modelId: Id; day: number; discovered: { id: Id; threshold: number }[] },
): void {
  const lab = labOf(s);
  if (o.kind === 'pretrain') {
    lab.runsByArch[o.arch] = (lab.runsByArch[o.arch] ?? 0) + 1;
    lab.largestFlops = Math.max(lab.largestFlops, o.totalFlops);
  }
  lab.forecastErrors = [...lab.forecastErrors, Math.abs(o.actual - o.forecastMid)].slice(-LAB_TUNING.FORECAST_ERRORS_KEEP);
  for (const d of o.discovered) {
    if (!lab.discoveries[d.id]) lab.discoveries[d.id] = { day: o.day, modelId: o.modelId, threshold: d.threshold };
  }
}

/** Emergences this run showed, as discoveries to record at eval day. */
export function discoveriesOf(s: GameState, run: TrainingRun): { id: Id; threshold: number }[] {
  return (run.emerged ?? []).map((id) => {
    const def = emergenceById(id);
    return { id, threshold: def ? emergenceThresholdOf(s, def) : 0 };
  });
}

/** Fine-tune caps in the true world: the parent's caps, the spec scaled by how well it took, persona and noise. */
export function trueFinetuneCaps(
  parentCaps: Capabilities,
  spec: { capAdd: Partial<Capabilities> },
  take: number,
  persona: Persona | undefined,
  rng: Rng | null,
  noiseSd: number,
): Capabilities {
  const out = { ...parentCaps };
  for (const k of CAP_IDS) out[k] = parentCaps[k] + take * CAP_TUNING.SPEC_CAP_SCALE * (spec.capAdd[k] ?? 0) + (rng && noiseSd > 0 ? rng.normal(0, noiseSd) : 0);
  return addCapDeltas(clampCaps(out), personaCapAdd(persona));
}

/** Catastrophic forgetting: with a chance, one capability the spec did not target drops by a few points. */
export function applyForgetting(caps: Capabilities, spec: { capAdd: Partial<Capabilities> }, rng: Rng): { caps: Capabilities; lost?: { cap: CapId; amount: number; text: string } } {
  if (!rng.chance(LAB_TUNING.FORGET_CHANCE)) return { caps };
  const targets = new Set(Object.keys(spec.capAdd));
  const pool = CAP_IDS.filter((k) => !targets.has(k) && caps[k] > 0);
  if (pool.length === 0) return { caps };
  const cap = rng.pick(pool);
  const amount = rng.range(LAB_TUNING.FORGET_MIN, LAB_TUNING.FORGET_MAX);
  const out = { ...caps, [cap]: clamp(caps[cap] - amount, 0, 100) } as Capabilities;
  return { caps: out, lost: { cap, amount, text: FORGET_COPY[cap] } };
}

/** Hidden-truth overall of a fine-tune at launch (no noise): parent + spec at the rolled take + persona. */
export function finetuneTrueOverall(s: GameState, parentId: Id, specId: Id, take: number, persona: Persona | undefined): number {
  const parent = s.models.find((m) => m.id === parentId);
  const spec = specById(specId);
  if (!parent || !spec) return 0;
  return overallScore(scoresFromCaps(trueFinetuneCaps(modelCaps(parent, s), spec, take, persona, null, 0)));
}
