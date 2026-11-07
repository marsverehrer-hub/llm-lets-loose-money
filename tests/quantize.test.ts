// v19 C3 serving: quantized variants (int8 / int4) and per-model latency, and the latency satisfaction factor.
import { describe, it, expect } from 'vitest';

import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, GameState, Model } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { latencyMs, quantPreview } from '../src/sim/systems/quantize';
import { latencySatisfactionMult } from '../src/sim/systems/products';

/** A released flat-profile model with `paramsB` parameters, dense unless `inferenceMult` says otherwise. */
function addModel(s: GameState, paramsB: number, inferenceMult = 1): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, 60])) as Capabilities;
  caps.vision = 0;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: `Test ${paramsB}B`,
    paramsB,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: 60, coding: 60, chat: 60, safety: 60 },
    overall: 60,
    elo: 800 + 8 * 60,
    trainedDay: s.day,
    releasedDay: s.day - 1,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: 128,
    modalities: ['text'],
    contaminated: false,
    config: defaultConfig(s),
    activeParamsB: paramsB,
    quirks: [],
    latentQuirks: [],
    inferenceMult,
    vibes: 0,
    emergences: [],
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

describe('quantized variants', () => {
  it('an int4 variant is faster and slightly worse, and carries the quant marks', () => {
    const s = createInitialState(7, 'Quant Labs');
    s.finance.cash = 1e9;
    const parent = addModel(s, 70);
    dispatch(s, { type: 'quantizeModel', modelId: parent.id, bits: 4 });
    const v = s.models.find((x) => x.quant === 4);
    expect(v).toBeDefined();
    expect(v!.derivedFrom).toEqual({ kind: 'quant', ids: [parent.id] });
    expect(v!.parentId).toBe(parent.id);
    expect(v!.releasedDay).toBe(s.day);
    expect(v!.name).toBe(`${parent.name} int4`);
    expect(v!.overall).toBeLessThan(parent.overall);
    expect(v!.overall).toBeGreaterThan(parent.overall * 0.95);
    expect(latencyMs(s, v!)).toBeLessThan(latencyMs(s, parent));
  });

  it('int8 keeps more quality than int4 and is slower than int4', () => {
    const s = createInitialState(7, 'Quant Labs');
    const parent = addModel(s, 70);
    const p8 = quantPreview(s, parent, 8);
    const p4 = quantPreview(s, parent, 4);
    expect(p8.overall).toBeGreaterThan(p4.overall);
    expect(p8.latency).toBeGreaterThan(p4.latency);
  });

  it('refuses a duplicate quantization and quantizing a quantized model', () => {
    const s = createInitialState(7, 'Quant Labs');
    s.finance.cash = 1e9;
    const parent = addModel(s, 20);
    dispatch(s, { type: 'quantizeModel', modelId: parent.id, bits: 8 });
    const count = s.models.length;
    dispatch(s, { type: 'quantizeModel', modelId: parent.id, bits: 8 });
    expect(s.models.length).toBe(count);
    const v = s.models.find((x) => x.quant === 8)!;
    dispatch(s, { type: 'quantizeModel', modelId: v.id, bits: 4 });
    expect(s.models.length).toBe(count);
  });
});

describe('latency', () => {
  it('latency falls as inferenceMult rises', () => {
    const s = createInitialState(7, 'Quant Labs');
    const slow = addModel(s, 70, 1);
    const fast = addModel(s, 70, 2.5);
    expect(latencyMs(s, fast)).toBeLessThan(latencyMs(s, slow));
  });

  it('stays clamped between 2 and 400 ms', () => {
    const s = createInitialState(7, 'Quant Labs');
    expect(latencyMs(s, addModel(s, 0.01, 100))).toBeGreaterThanOrEqual(2);
    expect(latencyMs(s, addModel(s, 1e7, 1))).toBe(400);
  });

  it('a slow model loses satisfaction only past its product tolerance', () => {
    expect(latencySatisfactionMult('chat', 50)).toBe(1);
    expect(latencySatisfactionMult('chat', 240)).toBeCloseTo(Math.pow(60 / 240, 0.3), 10);
    expect(latencySatisfactionMult('api', 100)).toBe(1);
    expect(latencySatisfactionMult('enterprise', 300)).toBeLessThan(1);
  });
});
