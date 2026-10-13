// v15 model life (GAME_DESIGN §25): patches, mastery, retirement and the Hall of Fame, routers, the Arena Cup.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { Capabilities, GameState, Model, Product } from '../src/sim/types';
import { CAP_IDS } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { getBonuses } from '../src/sim/bonuses';
import { makeRng } from '../src/sim/rng';
import { servingDemandPflops } from '../src/sim/systems/compute';
import { segmentShares } from '../src/sim/systems/market';
import {
  MODEL_LIFE_TUNING as T,
  addMasteryXp,
  feedbackFactor,
  masteryAppeal,
  modelLifeTick,
  patchBlocker,
  patchGain,
  retireBlocker,
  routedQuality,
} from '../src/sim/systems/modelLife';
import { CUP_TUNING, cupTick, ensureCup, rivalField, themeScore } from '../src/sim/systems/tournament';

function addModel(s: GameState, o: { name: string; overall: number; paramsB?: number; released?: boolean }): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, o.overall])) as Capabilities;
  caps.vision = 0;
  const paramsB = o.paramsB ?? 70;
  const m: Model = {
    id: `m${++s.idCounter}`, name: o.name, paramsB, tokensB: 2000, datasetIds: [], techniques: [], finalLoss: 2,
    scores: { reasoning: o.overall, coding: o.overall, chat: o.overall, safety: o.overall },
    overall: o.overall, elo: 800 + 8 * o.overall, trainedDay: s.day, releasedDay: o.released === false ? null : s.day,
    deprecated: false, caps, benchmarks: {}, specId: null, parentId: null, lineage: [], contextK: 128, modalities: ['text'],
    contaminated: false, config: defaultConfig(s), activeParamsB: paramsB, quirks: [], latentQuirks: [], inferenceMult: 1, vibes: 0, emergences: [],
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

function addProduct(s: GameState, m: Model, users = 100_000): Product {
  const p: Product = {
    id: `p${++s.idCounter}`, kind: 'api', name: 'Api', modelId: m.id, price: 10, users, launchedDay: s.day,
    satisfaction: 70, servedFraction: 1, mtokPerDay: 1000, revenuePerDay: 0, active: true,
  };
  s.products.push(p);
  return p;
}

function lab(): GameState {
  const s = createInitialState(31, 'Life', { scenarioId: 'garage', difficulty: 'founder', sandbox: true, skipTutorial: true, startYear: 2017 });
  s.finance.cash = 1e12;
  s.day = 2000;
  return s;
}

describe('patches', () => {
  it('learn from users, shrink each time, and raise the focus caps', () => {
    const s = lab();
    const m = addModel(s, { name: 'Loosey', overall: 60 });
    const lonely = feedbackFactor(s, m);
    addProduct(s, m, 1_000_000);
    expect(feedbackFactor(s, m)).toBeGreaterThan(lonely);
    const g0 = patchGain(s, m);
    const chat0 = m.caps!.chat;
    const overall0 = m.overall;
    dispatch(s, { type: 'patchModel', modelId: m.id, focus: 'chat' });
    expect(m.patchJob).toBeDefined();
    expect(patchBlocker(s, m)).toMatch(/in progress/);
    s.day = m.patchJob!.doneDay;
    modelLifeTick(s, makeRng(s));
    expect(m.patches).toBe(1);
    expect(m.caps!.chat).toBeGreaterThan(chat0);
    expect(m.overall).toBeGreaterThan(overall0 - 2); // a regression can cost a little elsewhere
    expect(patchGain(s, m)).toBeCloseTo(g0 * T.PATCH_DECAY, 5);
  });

  it('need a released model and stop after the cap', () => {
    const s = lab();
    const m = addModel(s, { name: 'Secret', overall: 50, released: false });
    expect(patchBlocker(s, m)).toMatch(/Release/);
    const r = addModel(s, { name: 'Old', overall: 50 });
    r.patches = T.MAX_PATCHES;
    expect(patchBlocker(s, r)).toMatch(/successor/);
  });
});

describe('mastery', () => {
  it('grows from serving users and makes the model more attractive', () => {
    const s = lab();
    const m = addModel(s, { name: 'Workhorse', overall: 60 });
    addProduct(s, m, 400_000);
    for (let i = 0; i < 30; i++) modelLifeTick(s, makeRng(s));
    expect(m.mastery!.xp).toBeGreaterThan(0);
    addMasteryXp(s, m, T.MASTERY_XP[4]);
    expect(m.mastery!.level).toBe(5);
    expect(masteryAppeal(m)).toBeCloseTo(1 + 4 * T.MASTERY_APPEAL_PER_LEVEL);
    expect(s.notifications.some((n) => /mastery 5/.test(n.text))).toBe(true);
  });
});

describe('retirement and the Hall of Fame', () => {
  it('refuses while a product runs the model', () => {
    const s = lab();
    const m = addModel(s, { name: 'Busy', overall: 60 });
    addProduct(s, m);
    expect(retireBlocker(s, m)).toMatch(/product/);
  });

  it('a notable model enters the hall and pays a lasting bonus', () => {
    const s = lab();
    const m = addModel(s, { name: 'Legend', overall: 70 });
    addMasteryXp(s, m, T.MASTERY_XP[4]);
    const brand = getBonuses(s).brand;
    const val = getBonuses(s).valuation ?? 1;
    dispatch(s, { type: 'retireModel', modelId: m.id, openWeights: true });
    expect(m.deprecated).toBe(true);
    expect(m.retiredDay).toBe(s.day);
    expect(s.hallOfFame?.length).toBe(1);
    expect(s.hallOfFame![0].honors).toContain('Mastery 5');
    // A Legend counts twice.
    expect(getBonuses(s).brand).toBeCloseTo(brand * 1.02 ** 2);
    expect(getBonuses(s).valuation ?? 1).toBeCloseTo(val * 1.01 ** 2);
    expect(s.flags['openBoost']).toBeGreaterThan(0);
  });

  it('an ordinary model just retires', () => {
    const s = lab();
    const m = addModel(s, { name: 'Meh', overall: 40 });
    dispatch(s, { type: 'retireModel', modelId: m.id });
    expect(m.deprecated).toBe(true);
    expect(s.hallOfFame ?? []).toEqual([]);
  });
});

describe('routers', () => {
  it('cut serving compute and cost a little visible quality', () => {
    const s = lab();
    const big = addModel(s, { name: 'Big', overall: 80, paramsB: 400 });
    const small = addModel(s, { name: 'Small', overall: 65, paramsB: 20 });
    const p = addProduct(s, big);
    const before = servingDemandPflops(s);
    dispatch(s, { type: 'setProductRouter', productId: p.id, modelId: small.id, share: 0.6 });
    expect(p.router).toEqual({ modelId: small.id, share: 0.6 });
    expect(servingDemandPflops(s)).toBeLessThan(before * 0.5);
    expect(routedQuality('developer', 80, 65, 0.6)).toBeCloseTo(80 - 0.6 * 15 * T.ROUTER_GAP_VISIBLE);
    expect(segmentShares(s, 'developer').length).toBeGreaterThan(0);
  });

  it('refuse a model that is too big, and drop a router whose model retires', () => {
    const s = lab();
    const big = addModel(s, { name: 'Big', overall: 80, paramsB: 100 });
    const mid = addModel(s, { name: 'Mid', overall: 75, paramsB: 80 });
    const small = addModel(s, { name: 'Small', overall: 60, paramsB: 10 });
    const p = addProduct(s, big);
    dispatch(s, { type: 'setProductRouter', productId: p.id, modelId: mid.id });
    expect(p.router).toBeUndefined();
    dispatch(s, { type: 'setProductRouter', productId: p.id, modelId: small.id, share: 5 });
    expect(p.router?.share).toBe(T.ROUTER_SHARE_MAX);
    dispatch(s, { type: 'retireModel', modelId: small.id });
    modelLifeTick(s, makeRng(s));
    expect(p.router).toBeUndefined();
  });
});

describe('Arena Cup', () => {
  it('scores themes from capabilities, and the efficiency cup favours small models', () => {
    const caps = Object.fromEntries(CAP_IDS.map((k) => [k, 70])) as Capabilities;
    expect(themeScore('coding', caps, 70, 10, 2024)).toBeCloseTo(70);
    expect(themeScore('efficiency', caps, 70, 1, 2024)).toBeGreaterThan(themeScore('efficiency', caps, 70, 2000, 2024));
  });

  it('announces, takes an entry fee once, plays and pays the player', () => {
    const s = lab();
    for (const c of s.competitors) c.active = c.active || !!c.model;
    // Make sure rivals exist with models: run the world a little.
    for (let i = 0; i < 5; i++) tick(s);
    const m = addModel(s, { name: 'Champ', overall: 99, paramsB: 5 });
    const cs = ensureCup(s);
    s.day = cs.nextAnnounceDay;
    cupTick(s);
    expect(cs.open).toBeDefined();
    const cash = s.finance.cash;
    dispatch(s, { type: 'enterCup', modelId: m.id });
    expect(s.finance.cash).toBe(cash - cs.open!.entryFee);
    dispatch(s, { type: 'enterCup', modelId: m.id });
    expect(s.finance.cash).toBe(cash - cs.open!.entryFee);
    s.day = cs.open!.playDay;
    cupTick(s);
    const res = cs.history[cs.history.length - 1];
    if (rivalField(s, res.theme).length > 0) {
      expect(res.placing).toBeDefined();
      expect(m.cupBest).toBe(res.placing);
      expect(m.mastery?.xp ?? 0).toBeGreaterThan(0);
    }
    expect(cs.open === undefined || cs.open.edition > res.edition).toBe(true);
  });

  it('keeps its own random stream', () => {
    const a = createInitialState(5, 'A');
    const b = createInitialState(5, 'B');
    const cs = ensureCup(a);
    a.day = cs.nextAnnounceDay;
    cupTick(a);
    expect(a.rngState).toBe(b.rngState);
    expect(CUP_TUNING.SEATS).toBe(8);
  });
});
