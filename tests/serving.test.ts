// v10 serving (GAME_DESIGN §21.1): own GPUs serve products first, the cloud bursts the overflow, fleet priority decides
// who gets the own GPUs while a training run is active, and a frontier API model earns about 2x its burst cost.
import { describe, it, expect } from 'vitest';

import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, GameState, Model, Product } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { frontierActiveParamsB } from '../src/sim/data/weightClasses';
import { RESEARCH } from '../src/sim/data/research';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { burstPricePerPflopDay, computeCapacity, mtokPerPflopDay, ownPflops } from '../src/sim/systems/compute';
import {
  FLEET_PRIORITIES,
  SERVING_TUNING,
  fleetBreakdown,
  fleetPriority,
  previewFleet,
  servingTick,
} from '../src/sim/systems/serving';
import { refPriceFor, tamFor } from '../src/sim/systems/market';

/** Day number of 1 January of a calendar year (the sim's day 0 is 1 January 2017). */
const dayOf = (year: number) => Math.round((Date.UTC(year, 0, 1) - Date.UTC(2017, 0, 1)) / 86_400_000);

/** A world at a given year with the developer market set up, and no rival labs running. */
function worldAt(year: number, seed = 42): GameState {
  const s = createInitialState(seed, 'Serving Labs');
  s.day = dayOf(year);
  for (const seg of ['consumer', 'developer', 'enterprise'] as const) {
    const st = s.market.segments[seg];
    st.tam = tamFor(seg, year);
    st.refPrice = refPriceFor(seg, year);
    st.adoption = 0.3;
  }
  return s;
}

/** A flat-profile released model with `activeB` active params. */
function addModel(s: GameState, activeB: number): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, 60])) as Capabilities;
  caps.vision = 0;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: `Test ${activeB}B`,
    paramsB: activeB,
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
    activeParamsB: activeB,
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

/** Puts a live api product on a model straight into the state (no fee, no news). */
function liveProduct(s: GameState, model: Model, price: number): Product {
  const p: Product = {
    id: `p${++s.idCounter}`,
    kind: 'api',
    name: 'Test API',
    modelId: model.id,
    price,
    users: 0,
    launchedDay: s.day,
    satisfaction: 70,
    servedFraction: 1,
    mtokPerDay: 0,
    revenuePerDay: 0,
    active: true,
  };
  s.products.push(p);
  return p;
}

/** Sets a product's demand so it needs `pflops` PFLOP/s on its model. */
function demandPflops(s: GameState, p: Product, pflops: number): void {
  const m = s.models.find((x) => x.id === p.modelId)!;
  p.mtokPerDay = pflops * mtokPerPflopDay(s, m);
}

describe('own GPUs serve first, the cloud bursts the overflow', () => {
  it('exposes the tuning the design names', () => {
    expect(SERVING_TUNING.BURST_PREMIUM).toBe(1.5);
    expect(SERVING_TUNING.BALANCED_SERVING_CAP).toBe(0.5);
    expect(FLEET_PRIORITIES).toEqual(['serving', 'balanced', 'training']);
  });

  it('serves the demand that own GPUs cover for free and bursts only the rest', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    const own = ownPflops(s);
    expect(own).toBeCloseTo(8 * 0.012, 9);
    demandPflops(s, p, 0.2);

    const f = previewFleet(s, 'serving');
    expect(f.servingPflops).toBeCloseTo(own, 9);
    expect(f.burstPflops).toBeCloseTo(0.2 - own, 9);
    expect(f.burstCostPerDay).toBeCloseTo((0.2 - own) * burstPricePerPflopDay(s), 6);
    expect(f.slices[0].ownPflops + f.slices[0].burstPflops).toBeCloseTo(0.2, 9);
  });

  it('books no burst when own GPUs cover the demand, and books the burst under serving otherwise', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.05);
    servingTick(s);
    expect(s.finance.today.expenses.serving ?? 0).toBe(0);
    expect(s.compute.fleet!.burstPflops).toBe(0);

    demandPflops(s, p, 0.2);
    servingTick(s);
    const burst = (0.2 - ownPflops(s)) * burstPricePerPflopDay(s);
    expect(s.finance.today.expenses.serving).toBeCloseTo(burst, 6);
    expect(s.compute.fleet!.burstCostPerDay).toBeCloseTo(burst, 6);
  });

  it('gives each product a serving cost: its own GPUs power share plus its burst', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.2);
    servingTick(s);
    const slice = s.compute.fleet!.slices.find((x) => x.productId === p.id)!;
    expect(p.servingCostPerDay).toBeCloseTo(slice.ownCostPerDay + slice.burstCostPerDay, 9);
    // The starter GPUs are rented (their power is in the rent), so their power share is zero here.
    expect(p.servingCostPerDay!).toBeGreaterThanOrEqual(slice.burstCostPerDay);
  });

  it('never takes a product down for lack of GPUs, even with a huge demand (real ticks)', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    p.users = 1_000_000;
    for (let d = 0; d < 5; d++) tick(s);
    expect(p.servedFraction).toBe(1);
    expect(s.stats.outageDays).toBe(0);
    expect(s.compute.fleet!.burstPflops).toBeGreaterThan(10);
    expect(s.finance.today.expenses.serving ?? 0).toBeGreaterThan(0);
  });

  it('keeps the incident hook: an incident can still take a product down', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    p.users = 1_000;
    s.flags[`incidentServed.${p.id}`] = 0.5;
    tick(s);
    expect(p.servedFraction).toBeCloseTo(0.5, 9);
    expect(s.stats.outageDays).toBe(1);
  });
});

describe('fleet priority', () => {
  it('without a training run, idle GPUs serve first whatever the priority says', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.08);
    for (const pr of FLEET_PRIORITIES) {
      const f = previewFleet(s, pr);
      expect(f.servingPflops, pr).toBeCloseTo(0.08, 9);
      expect(f.burstPflops, pr).toBe(0);
      expect(f.trainingPflops, pr).toBe(0);
    }
  });

  it('with a run, serving takes its demand and training gets the rest; balanced caps serving; training gives it all', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    dispatch(s, { type: 'startTraining', name: 'Run', paramsB: 0.35, tokensB: 7, datasetIds: ['scrawl_sample'], techniques: [] });
    expect(s.training).not.toBeNull();
    demandPflops(s, p, 0.08);
    const total = ownPflops(s);

    const serving = previewFleet(s, 'serving');
    expect(serving.servingPflops).toBeCloseTo(0.08, 9);
    expect(serving.trainingPflops).toBeCloseTo(total - 0.08, 9);
    expect(serving.burstPflops).toBe(0);

    const balanced = previewFleet(s, 'balanced');
    expect(balanced.servingPflops).toBeCloseTo(total * SERVING_TUNING.BALANCED_SERVING_CAP, 9);
    expect(balanced.burstPflops).toBeCloseTo(0.08 - total * SERVING_TUNING.BALANCED_SERVING_CAP, 9);
    expect(balanced.trainingPflops).toBeCloseTo(total * SERVING_TUNING.BALANCED_SERVING_CAP, 9);

    const training = previewFleet(s, 'training');
    expect(training.servingPflops).toBe(0);
    expect(training.burstPflops).toBeCloseTo(0.08, 9);
    expect(training.trainingPflops).toBeCloseTo(total, 9);
  });

  it('previewFleet does not change state', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.08);
    dispatch(s, { type: 'startTraining', name: 'Run', paramsB: 0.35, tokensB: 7, datasetIds: ['scrawl_sample'], techniques: [] });
    const before = JSON.stringify(s);
    for (const pr of FLEET_PRIORITIES) previewFleet(s, pr);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('the setFleetPriority action sets the priority and refreshes the derived split', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.08);
    dispatch(s, { type: 'setFleetPriority', priority: 'balanced' });
    expect(fleetPriority(s)).toBe('balanced');
    expect(s.compute.trainingShare).toBeCloseTo(0.5, 9);
    expect(fleetBreakdown(s).servingPflops).toBeCloseTo(0.08, 9);
    dispatch(s, { type: 'setFleetPriority', priority: 'nonsense' as never });
    expect(fleetPriority(s)).toBe('balanced');
  });

  it('the legacy setTrainingShare maps to the nearest priority', () => {
    const s = worldAt(2021);
    const cases: [number, string][] = [
      [0.95, 'training'],
      [0.75, 'training'],
      [0.74, 'balanced'],
      [0.4, 'balanced'],
      [0.39, 'serving'],
      [0, 'serving'],
    ];
    for (const [share, want] of cases) {
      dispatch(s, { type: 'setTrainingShare', share });
      expect(fleetPriority(s), `share ${share}`).toBe(want);
    }
  });

  it('the trainingShare mirror is training GPUs over total', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.08);
    const total = ownPflops(s);
    dispatch(s, { type: 'setFleetPriority', priority: 'serving' });
    expect(s.compute.trainingShare).toBeCloseTo((total - 0.08) / total, 9);
    dispatch(s, { type: 'setFleetPriority', priority: 'training' });
    expect(s.compute.trainingShare).toBeCloseTo(1, 9);
    // With no run, idle GPUs serve first, so the whole fleet is offered to serving whatever the priority.
    expect(computeCapacity(s).inference).toBeCloseTo(ownPflops(s), 9);
  });

  it('old saves with no priority or fleet count as serving', () => {
    const s = worldAt(2021);
    const m = addModel(s, 10);
    const p = liveProduct(s, m, 5);
    demandPflops(s, p, 0.08);
    delete s.compute.priority;
    delete s.compute.fleet;
    expect(fleetPriority(s)).toBe('serving');
    const f = fleetBreakdown(s);
    expect(f.slices.length).toBe(1);
    expect(f.servingPflops).toBeCloseTo(0.08, 9);
    tick(s);
    expect(s.compute.fleet).toBeDefined();
  });
});

describe('frontier margin: a frontier-quality API model earns about 2x its burst cost per Mtok', () => {
  /**
   * Reference lab for year Y: every inference-efficiency research node the calendar has released by Y is researched
   * (the research tree's minYear). The model is the typical frontier model that year (frontierActiveParamsB), priced at
   * the market reference API price. Burst is priced for all of the model's tokens (the worst case, nothing from own GPUs).
   */
  function marginAt(year: number, researched: boolean): { price: number; burstPerMtok: number; margin: number } {
    const s = worldAt(year);
    if (researched) {
      s.research.completed = RESEARCH.filter((r) => r.minYear <= year && r.bonuses?.inferenceEfficiency !== undefined).map((r) => r.id);
    }
    const activeB = frontierActiveParamsB(year);
    const model = { paramsB: activeB, activeParamsB: activeB, inferenceMult: 1 };
    const price = refPriceFor('developer', year);
    const burstPerMtok = burstPricePerPflopDay(s) / mtokPerPflopDay(s, model);
    return { price, burstPerMtok, margin: price / burstPerMtok };
  }

  for (const year of [2018, 2021, 2024, 2028]) {
    it(`${year}: the frontier model clears 2x its burst cost with the lab's inference research`, () => {
      const r = marginAt(year, true);
      expect(r.margin, `${year}: price ${r.price.toFixed(2)} vs burst ${r.burstPerMtok.toFixed(2)} per Mtok`).toBeGreaterThanOrEqual(2);
    });
  }

  it('a bare lab (no inference research) still clears 2x in 2018, when frontier models are small', () => {
    // From 2021 a bare lab only breaks even on burst at reference prices (about 1x), so inference research is what pays.
    expect(marginAt(2018, false).margin).toBeGreaterThanOrEqual(2);
  });
});
