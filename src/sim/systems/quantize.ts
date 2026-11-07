// v19: serving work. Quantized variants (int8 / int4) and per-model latency. Package C3 fills this in.
import type { ActionHandlers, Capabilities, GameState, Id, Model, Scores } from '../types';
import { activeParamsFor } from './trainingMath';
import { evaluateModel, modelCaps, overallScore } from './capabilities';
import { LAB_TUNING } from './lab';
import { isResearched } from './research';
import { clamp, newId, notify, trySpend } from '../util';

/** Share of every cap and score kept after quantizing, by bit width. */
export const QUANT_QUALITY: Record<8 | 4, number> = { 8: 0.99, 4: 0.965 };
/** Inference speed multiplier, by bit width. */
export const QUANT_SPEED: Record<8 | 4, number> = { 8: 1.6, 4: 2.5 };
/** Quantizing costs this much times the square root of the parameters (in billions). */
export const QUANT_COST_PER_SQRT_B = 20_000;

/** A quantized copy of a released model, built but not added to the state. Also used by the Serving card preview. */
export function quantVariant(s: GameState, parent: Model, bits: 8 | 4, id: Id): Model {
  const q = QUANT_QUALITY[bits];
  const caps = Object.fromEntries(Object.entries(modelCaps(parent, s)).map(([k, v]) => [k, v * q])) as Capabilities;
  const scores: Scores = { reasoning: parent.scores.reasoning * q, coding: parent.scores.coding * q, chat: parent.scores.chat * q, safety: parent.scores.safety * q };
  const overall = overallScore(scores);
  const m: Model = {
    id,
    name: `${parent.name} ${bits === 8 ? 'int8' : 'int4'}`,
    paramsB: parent.paramsB,
    tokensB: parent.tokensB,
    datasetIds: [...parent.datasetIds],
    techniques: [...parent.techniques],
    finalLoss: parent.finalLoss,
    scores,
    overall,
    elo: parent.elo + (overall - parent.overall) * LAB_TUNING.ELO_PER_POINT,
    trainedDay: parent.trainedDay,
    releasedDay: s.day,
    deprecated: false,
    caps,
    specId: parent.specId ?? null,
    parentId: parent.id,
    lineage: [...(parent.lineage ?? [])],
    contextK: parent.contextK,
    modalities: parent.modalities ? [...parent.modalities] : undefined,
    contaminated: parent.contaminated,
    config: parent.config,
    activeParamsB: parent.activeParamsB,
    quirks: [...(parent.quirks ?? [])],
    latentQuirks: [...(parent.latentQuirks ?? [])],
    persona: parent.persona ? { ...parent.persona } : undefined,
    inferenceMult: (parent.inferenceMult ?? 1) * QUANT_SPEED[bits],
    vibes: parent.vibes,
    emergences: [...(parent.emergences ?? [])],
    derivedFrom: { kind: 'quant', ids: [parent.id] },
    quant: bits,
    origin: parent.origin ? { ...parent.origin } : undefined,
    traits: parent.traits ? { ...parent.traits } : undefined,
  };
  evaluateModel(s, m);
  return m;
}

/** Milliseconds per output token for a model (C3). */
export function latencyMs(s: GameState, m: Model): number {
  const active = m.config ? activeParamsFor(m.paramsB, m.config) : m.paramsB;
  let ms = 4 + (0.6 * Math.pow(active, 0.75)) / (m.inferenceMult ?? 1);
  if (isResearched(s, 'speculative_decoding')) ms *= 0.8;
  return clamp(ms, 2, 400);
}

/** The overall score and latency a quantized variant would have, plus its price, for the Serving card. */
export function quantPreview(s: GameState, parent: Model, bits: 8 | 4): { overall: number; latency: number; cost: number } {
  const v = quantVariant(s, parent, bits, '');
  return { overall: v.overall, latency: latencyMs(s, v), cost: QUANT_COST_PER_SQRT_B * Math.sqrt(parent.paramsB) };
}

export const handlers: ActionHandlers = {
  quantizeModel: (s, a) => {
    const parent = s.models.find((x) => x.id === a.modelId);
    if (!parent || parent.releasedDay === null) {
      notify(s, 'Pick a released model to quantize.', 'bad');
      return;
    }
    if (parent.quant) {
      notify(s, `${parent.name} is already quantized. Quantize the full-precision model instead.`, 'bad');
      return;
    }
    if (s.models.some((x) => x.quant === a.bits && x.derivedFrom?.kind === 'quant' && x.derivedFrom.ids[0] === parent.id)) {
      notify(s, `${parent.name} already has an int${a.bits} variant.`, 'bad');
      return;
    }
    const cost = QUANT_COST_PER_SQRT_B * Math.sqrt(parent.paramsB);
    if (!trySpend(s, 'compute', cost, `the int${a.bits} quantization`)) return;
    const v = quantVariant(s, parent, a.bits, newId(s, 'm'));
    s.models.push(v);
    notify(s, `${v.name} is out. Cheaper to serve, a little less clever.`, 'milestone');
  },
};
