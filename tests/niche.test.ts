// Playstyles v8 (GAME_DESIGN §19.3): buyer tiers, product lines, crowns and the cost of serving small models.
// The tier tests build a clean world (no rival labs running) so each rule is checked on its own.
import { describe, it, expect } from 'vitest';

import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { BUYER_TIERS, CAP_IDS } from '../src/sim/types';
import type { BuyerTier, Capabilities, GameState, Model, Product, ProductKind, RivalLineModel } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { classGap, classThresholds, frontierActiveParamsB } from '../src/sim/data/weightClasses';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { ensureClasses, playerCrownCounts } from '../src/sim/systems/classes';
import { LAUNCH_FEE, MAX_LINES_PER_KIND, launchFee } from '../src/sim/systems/products';
import {
  TIER_TUNING,
  crownMultiplier,
  frontierQuality,
  previewDemand,
  refPriceFor,
  segmentShares,
  tamFor,
  tierBreakdown,
  tierWeights,
} from '../src/sim/systems/market';
import { modelInferenceCapacityMtok } from '../src/sim/systems/compute';
import { getBonuses } from '../src/sim/bonuses';
import { BENCHMARKS } from '../src/sim/data/benchmarks';

/** Day number of 1 January of a calendar year (the sim's day 0 is 1 January 2017). */
const dayOf = (year: number) => Math.round((Date.UTC(year, 0, 1) - Date.UTC(2017, 0, 1)) / 86_400_000);

/** A world at a given year with the developer market set up, and no rival labs running. */
function worldAt(year: number, seed = 42): GameState {
  const s = createInitialState(seed, 'Test Labs');
  s.day = dayOf(year);
  for (const seg of ['consumer', 'developer', 'enterprise'] as const) {
    const st = s.market.segments[seg];
    st.tam = tamFor(seg, year);
    st.refPrice = refPriceFor(seg, year);
    st.adoption = 0.3;
  }
  return s;
}

/** A flat-profile released model: every capability equals `overall`. */
function addModel(s: GameState, name: string, overall: number, activeB: number): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, overall])) as Capabilities;
  caps.vision = 0;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name,
    paramsB: activeB,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + 8 * overall,
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

/** Puts a live product straight into the state (no fee, no news). */
function liveProduct(s: GameState, kind: ProductKind, name: string, model: Model, price: number): Product {
  const p: Product = {
    id: `p${++s.idCounter}`,
    kind,
    name,
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

/**
 * The 2023 developer market: a frontier model at the reference price, and a small one. Returns the two products
 * and the models behind them. The nano model is about 1/40 of the frontier's active size, the small model about 1/8.
 */
function frontierVsSmall(year: number, smallPriceMult: number) {
  const s = worldAt(year);
  // A fleet big enough to serve both lines without outages, so the tick checks are about the market alone.
  s.compute.rented = { h100: 100_000 };
  const f = frontierQuality(year);
  const frontierB = frontierActiveParamsB(year);
  const ref = s.market.segments.developer.refPrice;
  const frontier = addModel(s, 'Frontier', f, frontierB);
  const small = addModel(s, 'Small', f - classGap('small', year), classThresholds(year).small * 0.8);
  const pf = liveProduct(s, 'api', 'Pro', frontier, ref);
  const ps = liveProduct(s, 'api', 'Lite', small, ref * smallPriceMult);
  return { s, pf, ps, frontier, small, ref };
}

describe('buyer tiers (GAME_DESIGN §19.3)', () => {
  it('tier weights start at 30/50/20 in 2017, end at 20/45/35 in 2030, and always sum to one', () => {
    const w17 = tierWeights(2017);
    expect(w17.premium).toBeCloseTo(0.3, 9);
    expect(w17.mainstream).toBeCloseTo(0.5, 9);
    expect(w17.budget).toBeCloseTo(0.2, 9);
    const w30 = tierWeights(2030);
    expect(w30.premium).toBeCloseTo(0.2, 9);
    expect(w30.mainstream).toBeCloseTo(0.45, 9);
    expect(w30.budget).toBeCloseTo(0.35, 9);
    // Interpolated by year, held flat outside the anchors.
    expect(tierWeights(2023.5).budget).toBeCloseTo(0.275, 9);
    expect(tierWeights(2010).budget).toBeCloseTo(0.2, 9);
    expect(tierWeights(2045).budget).toBeCloseTo(0.35, 9);
    for (let y = 2010; y <= 2045; y += 0.5) {
      const w = tierWeights(y);
      expect(w.premium + w.mainstream + w.budget).toBeCloseTo(1, 9);
    }
  });

  it('a frontier model at the reference price takes the premium majority against a small model at the same price', () => {
    const { s, pf } = frontierVsSmall(2023, 1);
    const pre = previewDemand(s, 'api', pf.modelId!, pf.price, pf.id);
    // Premium buyers weigh quality^3.2 against price^0.6. In 2023 the small line trails by about 10 points (classGap),
    // which leaves the frontier roughly 60% of premium buyers. It is a clear majority, not a rout.
    expect(pre.tiers.premium.share).toBeGreaterThan(0.55);
    expect(pre.tiers.premium.share).toBeGreaterThan(pre.tiers.budget.share);
  });

  it('a small cheap model wins a majority of the budget tier against a frontier model priced at the reference price', () => {
    const { s, pf, ps } = frontierVsSmall(2023, 0.25);
    // Preview the cheap line against the frontier line that is already live.
    const cheap = previewDemand(s, 'api', ps.modelId!, ps.price, ps.id);
    const frontierBudget = previewDemand(s, 'api', pf.modelId!, pf.price, pf.id).tiers.budget.share;
    expect(cheap.tiers.budget.share).toBeGreaterThan(0.5);
    expect(frontierBudget).toBeLessThan(0.5);
  });

  it('segment shares add up to one across the tiers and the product lines', () => {
    const { s } = frontierVsSmall(2023, 0.4);
    const total = segmentShares(s, 'developer').reduce((t, r) => t + r.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('tier breakdown reports each tier with the player share and the strongest rival', () => {
    const { s } = frontierVsSmall(2023, 0.4);
    const rows = tierBreakdown(s, 'developer');
    expect(rows.map((r) => r.tier)).toEqual([...BUYER_TIERS]);
    for (const r of rows) {
      expect(r.weight).toBeGreaterThan(0);
      expect(r.playerShare).toBeGreaterThan(0);
      // No rival labs run in this world.
      expect(r.top).toBeNull();
    }
  });

  it('a rival sells its budget line in the budget tier and its flagship everywhere else', () => {
    const s = worldAt(2023);
    const rival = s.competitors.find((c) => c.id === 'openaye');
    expect(rival).toBeDefined();
    rival!.active = true;
    rival!.model = { name: 'GPTee-Flagship', scores: { reasoning: 90, coding: 90, chat: 90, safety: 90 }, overall: 90, elo: 1520, releasedDay: s.day - 1 };
    rival!.prices.api = 10;
    const cs = ensureClasses(s);
    const line: RivalLineModel = {
      labId: 'openaye',
      weightClass: 'small',
      activeParamsB: 20,
      name: 'GPTee-14 mini',
      scores: { reasoning: 84, coding: 84, chat: 84, safety: 84 },
      overall: 84,
      elo: 1472,
      releasedDay: s.day - 1,
    };
    cs.rivalLines['openaye:small'] = line;
    const rows = tierBreakdown(s, 'developer');
    const top = (t: BuyerTier) => rows.find((r) => r.tier === t)!.top;
    expect(top('premium')?.model).toBe('GPTee-Flagship');
    expect(top('mainstream')?.model).toBe('GPTee-Flagship');
    expect(top('budget')?.model).toBe('GPTee-14 mini');
  });

  it('tier users follow the tier split: the tier shares of a product sum to its users', () => {
    const { s, pf, ps } = frontierVsSmall(2023, 0.4);
    for (let i = 0; i < 60; i++) tick(s);
    for (const p of [pf, ps]) {
      expect(p.users).toBeGreaterThan(0);
      const split = BUYER_TIERS.reduce((t, tier) => t + (p.tierUsers?.[tier] ?? 0), 0);
      expect(split / p.users).toBeCloseTo(1, 6);
    }
    // The budget tier is where the small line earns its users.
    expect(ps.tierUsers!.budget!).toBeGreaterThan(pf.tierUsers!.budget!);
  });
});

describe('product lines (two per kind)', () => {
  it('a second product of a kind launches at half the fee and a third is rejected', () => {
    const s = worldAt(2023);
    const m1 = addModel(s, 'Pro model', 90, 150);
    const m2 = addModel(s, 'Lite model', 80, 9);
    const m3 = addModel(s, 'Third model', 85, 40);
    const fee = LAUNCH_FEE.api;
    const cash0 = s.finance.cash;

    dispatch(s, { type: 'launchProduct', kind: 'api', name: 'Pro', modelId: m1.id, price: 30 });
    expect(s.products.filter((p) => p.active && p.kind === 'api')).toHaveLength(1);
    expect(s.finance.cash).toBeCloseTo(cash0 - fee, 0);
    expect(launchFee(s, 'api')).toBeCloseTo(fee * 0.5, 6);

    dispatch(s, { type: 'launchProduct', kind: 'api', name: 'Lite', modelId: m2.id, price: 3 });
    expect(s.products.filter((p) => p.active && p.kind === 'api')).toHaveLength(2);
    expect(s.finance.cash).toBeCloseTo(cash0 - fee - fee * 0.5, 0);

    const cash2 = s.finance.cash;
    dispatch(s, { type: 'launchProduct', kind: 'api', name: 'Third', modelId: m3.id, price: 10 });
    expect(s.products.filter((p) => p.active && p.kind === 'api')).toHaveLength(MAX_LINES_PER_KIND);
    expect(s.finance.cash).toBe(cash2);
  });

  it('the cap is per kind: a second chat line does not block an API line', () => {
    const s = worldAt(2023);
    s.research.completed.push('instruction_tuning');
    const m = addModel(s, 'Chat model', 85, 40);
    liveProduct(s, 'api', 'Pro', m, 30);
    liveProduct(s, 'api', 'Lite', m, 3);
    dispatch(s, { type: 'launchProduct', kind: 'chat', name: 'Chat', modelId: m.id, price: 20 });
    expect(s.products.filter((p) => p.active && p.kind === 'chat')).toHaveLength(1);
  });
});

describe('crowns pay', () => {
  it('the crown multiplier is 1 + 0.03 per segment crown, capped at 1.15, then times crown value', () => {
    const s = worldAt(2023);
    const bonuses = getBonuses(s);
    expect(crownMultiplier(s, 'developer', bonuses)).toBe(1);
    // Efficiency benchmarks carry their own category ('efficiency'), so they never count as coding or agentic crowns.
    const codingIds = BENCHMARKS.filter((b) => (b.category === 'coding' || b.category === 'agentic') && b.efficiency === undefined).map((b) => b.id);
    const cs = ensureClasses(s);
    const crown = (benchId: string) => ({ benchId, weightClass: 'open' as const, holder: 'player', modelName: 'X', score: 80, sinceDay: s.day });
    cs.crowns.push(crown(codingIds[0]), crown(codingIds[1]));
    const counts = playerCrownCounts(s);
    expect((counts.coding ?? 0) + (counts.agentic ?? 0)).toBe(2);
    expect(crownMultiplier(s, 'developer', bonuses)).toBeCloseTo(1 + 0.03 * 2, 9);
    for (const id of codingIds.slice(2, 12)) cs.crowns.push(crown(id));
    expect(crownMultiplier(s, 'developer', bonuses)).toBeCloseTo(TIER_TUNING.CROWN_MULT_CAP, 9);
    expect(crownMultiplier(s, 'developer', { ...bonuses, crownValue: 1.2 })).toBeCloseTo(TIER_TUNING.CROWN_MULT_CAP * 1.2, 9);
  });

  it('crowns raise the attractiveness and the users of the player products in their segment', () => {
    const s = worldAt(2023);
    const ref = s.market.segments.developer.refPrice;
    // Crowns lift the player's offers against rivals. A rival lab gives the new product someone to be compared with.
    const rival = s.competitors.find((c) => c.id === 'openaye')!;
    rival.active = true;
    rival.model = { name: 'GPTee-Rival', scores: { reasoning: 88, coding: 88, chat: 88, safety: 88 }, overall: 88, elo: 1504, releasedDay: s.day - 1 };
    rival.prices.api = ref;
    const m = addModel(s, 'Coder', 90, 150);
    const before = previewDemand(s, 'api', m.id, ref);
    const codingIds = BENCHMARKS.filter((b) => b.category === 'coding' && b.efficiency === undefined).map((b) => b.id);
    const cs = ensureClasses(s);
    for (const id of codingIds.slice(0, 2)) cs.crowns.push({ benchId: id, weightClass: 'open', holder: 'player', modelName: 'Coder', score: 80, sinceDay: s.day });
    const after = previewDemand(s, 'api', m.id, ref);
    expect(after.users).toBeGreaterThan(before.users);
    expect(after.tiers.mainstream.share).toBeGreaterThan(before.tiers.mainstream.share);
  });
});

describe('serving a small model', () => {
  it('serving capacity scales with 1 / active size, so a nano model serves ~40x the tokens of a frontier model per FLOP', () => {
    const s = worldAt(2023);
    const frontierB = frontierActiveParamsB(2023);
    const nanoB = classThresholds(2023).nano;
    const frontier = modelInferenceCapacityMtok(s, { paramsB: frontierB, activeParamsB: frontierB });
    const nano = modelInferenceCapacityMtok(s, { paramsB: nanoB, activeParamsB: nanoB });
    expect(frontier).toBeGreaterThan(0);
    // Capacity is FLOPs per day over 2 x active params, so tokens per day scale with 1 / active size.
    expect(nano / frontier).toBeCloseTo(frontierB / nanoB, 6);
    expect(nano / frontier).toBeGreaterThan(39);
  });
});
