// Release modes, internal use, naming, and the effects they have on products and research (GAME_DESIGN §17.7).
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import type { Capabilities, GameState, Model, Rng } from '../src/sim/types';
import { CAP_IDS } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { makeRng } from '../src/sim/rng';
import { frontierQuality } from '../src/sim/systems/market';
import { evaluateModel } from '../src/sim/systems/capabilities';
import { productsTick } from '../src/sim/systems/products';
import { researchPointsPerDay } from '../src/sim/systems/research';
import {
  RELEASE_TUNING,
  internalCostPerDay,
  internalResearchMult,
  previewDemandCap,
  releasePreview,
  releaseTick,
} from '../src/sim/systems/release';
import { yearOf } from '../src/sim/util';
import type { Product } from '../src/sim/types';

/** A flat-profile model: every capability equals `overall`, so the overall score is exactly `overall`. */
function addModel(s: GameState, o: { name: string; overall: number; paramsB?: number; releasedDay?: number | null; releaseMode?: Model['releaseMode']; internal?: boolean; parentId?: string | null }): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, o.overall])) as Capabilities;
  caps.vision = 0;
  const paramsB = o.paramsB ?? 70;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: o.name,
    paramsB,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: o.overall, coding: o.overall, chat: o.overall, safety: o.overall },
    overall: o.overall,
    elo: 800 + 8 * o.overall,
    trainedDay: s.day,
    releasedDay: o.releasedDay ?? null,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: o.parentId ?? null,
    lineage: [],
    contextK: 128,
    modalities: ['text'],
    contaminated: false,
    config: defaultConfig(s),
    activeParamsB: paramsB,
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
    ...(o.releaseMode ? { releaseMode: o.releaseMode } : {}),
    ...(o.internal ? { internal: true } : {}),
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

function fresh(seed = 7): GameState {
  const s = createInitialState(seed, 'Release Test Labs');
  s.finance.cash = 1e12;
  return s;
}

function productOn(s: GameState, modelId: string, users: number, kind: Product['kind'] = 'api'): Product {
  const p: Product = {
    id: `prod${++s.idCounter}`,
    kind,
    name: 'Test product',
    modelId,
    price: 10,
    users,
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

/** An rng whose chance() records the probabilities it was asked about and always says yes. */
function spyRng(): Rng & { asked: number[] } {
  const asked: number[] = [];
  const base = makeRng({ rngState: 1 });
  return {
    ...base,
    asked,
    chance: (p: number) => {
      asked.push(p);
      return true;
    },
  };
}

describe('release modes', () => {
  it('a full release makes the model public and gives the previewed gains', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    const expected = releasePreview(s, m, 'full');
    const brand0 = s.company.brand;
    const hype0 = s.company.hype;
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full' });
    expect(m.releasedDay).toBe(s.day);
    expect(m.releaseMode).toBe('full');
    expect(m.previewUntil).toBeUndefined();
    expect(s.company.hype - hype0).toBeCloseTo(expected.hype, 6);
    expect(s.company.brand - brand0).toBeCloseTo(expected.brand, 6);
    expect(s.stats.modelsReleased).toBe(1);
  });

  it('a preview gives half the full hype now and runs for 30 days', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    const full = releasePreview(s, m, 'full');
    const preview = releasePreview(s, m, 'preview');
    expect(preview.hype).toBeCloseTo(full.hype * RELEASE_TUNING.PREVIEW_HYPE_SHARE, 6);
    const hype0 = s.company.hype;
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'preview' });
    expect(m.releaseMode).toBe('preview');
    expect(m.releasedDay).toBe(s.day);
    expect(m.previewUntil).toBe(s.day + RELEASE_TUNING.PREVIEW_DAYS);
    expect(s.company.hype - hype0).toBeCloseTo(full.hype / 2, 6);
  });

  it('promoting a preview pays the remaining hype and settles the Elo now', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    const total = releasePreview(s, m, 'full').hype;
    const hype0 = s.company.hype;
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'preview' });
    dispatch(s, { type: 'promotePreview', modelId: m.id });
    expect(m.releaseMode).toBe('full');
    expect(m.previewUntil).toBeUndefined();
    expect(m.eloSettlesDay).toBe(s.day);
    expect(s.company.hype - hype0).toBeCloseTo(total, 6);
  });

  it('a preview auto-promotes when its window runs out', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'preview' });
    s.day = m.previewUntil! - 1;
    releaseTick(s, makeRng(s));
    expect(m.releaseMode).toBe('preview');
    s.day += 1;
    releaseTick(s, makeRng(s));
    expect(m.releaseMode).toBe('full');
    expect(m.previewUntil).toBeUndefined();
  });

  it('open weights add brand, reputation and a rival boost, and the mode sticks', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    const full = releasePreview(s, m, 'full');
    const brand0 = s.company.brand;
    const rep0 = s.company.reputation;
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'open' });
    expect(m.releaseMode).toBe('open');
    expect(s.company.brand - brand0).toBeCloseTo(full.brand + RELEASE_TUNING.OPEN_BRAND, 6);
    expect(s.company.reputation - rep0).toBeCloseTo(RELEASE_TUNING.OPEN_REPUTATION, 6);
    expect(s.flags['openBoost']).toBe(RELEASE_TUNING.OPEN_RIVAL_BOOST);
    // Open weights can't be taken back: promoting or re-releasing does nothing.
    dispatch(s, { type: 'promotePreview', modelId: m.id });
    expect(m.releaseMode).toBe('open');
  });

  it('a public rename keeps the old name as the codename, unless one is already set', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Strawberry', overall: 60 });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full', publicName: 'Loosey 2 Pro' });
    expect(m.name).toBe('Loosey 2 Pro');
    expect(m.codename).toBe('Strawberry');

    const t = addModel(s, { name: 'Orion-2', overall: 55 });
    t.codename = 'Project Gobi';
    dispatch(s, { type: 'releaseModel', modelId: t.id, mode: 'full', publicName: 'Hype 5' });
    expect(t.name).toBe('Hype 5');
    expect(t.codename).toBe('Project Gobi');
  });

  it('refuses unknown modes, public models and deprecated models', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'bogus' as never });
    expect(m.releasedDay).toBeNull();
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full' });
    const hype = s.company.hype;
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'preview' });
    expect(m.releaseMode).toBe('full');
    expect(s.company.hype).toBe(hype);
    const d = addModel(s, { name: 'Old', overall: 40 });
    d.deprecated = true;
    dispatch(s, { type: 'releaseModel', modelId: d.id, mode: 'full' });
    expect(d.releasedDay).toBeNull();
  });
});

describe('preview cap, open penalty and latent quirks', () => {
  it('a preview model serves at most 15% of the demand a product would have', () => {
    const s = fresh();
    const full = addModel(s, { name: 'Full', overall: 60, releasedDay: s.day, releaseMode: 'full' });
    const pre = addModel(s, { name: 'Pre', overall: 60, releasedDay: s.day, releaseMode: 'preview' });
    expect(previewDemandCap(pre)).toBe(RELEASE_TUNING.PREVIEW_DEMAND_CAP);
    expect(previewDemandCap(full)).toBe(1);
    const pa = productOn(s, full.id, 50_000);
    productsTick(s, makeRng(s));
    const fullDemand = pa.mtokPerDay;
    pa.active = false;
    const pb = productOn(s, pre.id, 50_000);
    productsTick(s, makeRng(s));
    expect(pb.mtokPerDay / fullDemand).toBeCloseTo(RELEASE_TUNING.PREVIEW_DEMAND_CAP, 6);
  });

  it('open weights cut the users a product keeps by a quarter, for good', () => {
    const s = fresh();
    const open = addModel(s, { name: 'Open', overall: 60, releasedDay: s.day, releaseMode: 'open' });
    const closed = addModel(s, { name: 'Closed', overall: 60, releasedDay: s.day, releaseMode: 'full' });
    const po = productOn(s, open.id, 40_000, 'chat');
    productsTick(s, makeRng(s));
    const openRevenue = po.revenuePerDay;
    po.active = false;
    const pc = productOn(s, closed.id, 40_000, 'chat');
    productsTick(s, makeRng(s));
    expect(openRevenue / pc.revenuePerDay).toBeCloseTo(RELEASE_TUNING.OPEN_USER_MULT, 6);
  });

  it('preview latent quirks are checked at five times the base rate', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Pre', overall: 60, releasedDay: s.day, releaseMode: 'preview' });
    m.latentQuirks = ['delve'];
    const rng = spyRng();
    releaseTick(s, rng);
    // labTick already rolls 2% a day; releaseTick adds the other 8% so the total is 10%, five times the base.
    expect(rng.asked).toHaveLength(1);
    expect(rng.asked[0]).toBeCloseTo(0.08, 9);
  });

  it('a full release gets no extra latent-quirk rolls', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Full', overall: 60, releasedDay: s.day, releaseMode: 'full' });
    m.latentQuirks = ['delve'];
    const rng = spyRng();
    releaseTick(s, rng);
    expect(rng.asked).toEqual([]);
  });

  it('a surfaced preview quirk moves to the visible list and makes news', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Pre', overall: 60, releasedDay: s.day, releaseMode: 'preview' });
    m.latentQuirks = ['golden_gate'];
    const news0 = s.news.length;
    const always: Rng = { ...makeRng({ rngState: 3 }), chance: () => true } as Rng;
    releaseTick(s, always);
    expect(m.latentQuirks).toEqual([]);
    expect(m.quirks).toContain('golden_gate');
    expect(s.news.length).toBeGreaterThan(news0);
  });
});

describe('internal use', () => {
  it('internal research multiplier follows the gap to the frontier, clamped', () => {
    const s = fresh();
    const frontier = frontierQuality(yearOf(s.day));
    expect(internalResearchMult(s)).toBe(1);
    const m = addModel(s, { name: 'Inside', overall: frontier + 10, paramsB: 30 });
    m.internal = true;
    expect(internalResearchMult(s)).toBeCloseTo(1.25, 6);
    m.overall = frontier + 14; // gap past the clamp
    evaluateModel(s, m);
    expect(internalResearchMult(s)).toBeCloseTo(1 + 0.25 * 1.2, 6);
    m.overall = frontier - 30; // far behind: no bonus
    expect(internalResearchMult(s)).toBeCloseTo(1, 6);
  });

  it('only the best internal model sets the research boost', () => {
    const s = fresh();
    const frontier = frontierQuality(yearOf(s.day));
    const weak = addModel(s, { name: 'Weak', overall: frontier - 30, internal: true });
    const strong = addModel(s, { name: 'Strong', overall: frontier + 10, internal: true });
    expect(internalResearchMult(s)).toBeCloseTo(1.25, 6);
    strong.deprecated = true;
    expect(internalResearchMult(s)).toBeCloseTo(1, 6);
    expect(weak.internal).toBe(true);
  });

  it('the research boost multiplies research points per day', () => {
    const s = fresh();
    const frontier = frontierQuality(yearOf(s.day));
    const base = researchPointsPerDay(s);
    expect(base).toBeGreaterThan(0);
    const m = addModel(s, { name: 'Inside', overall: frontier + 10 });
    dispatch(s, { type: 'deployInternally', modelId: m.id, on: true });
    expect(m.internal).toBe(true);
    expect(researchPointsPerDay(s)).toBeCloseTo(base * 1.25, 6);
  });

  it('internal deployment costs compute per active parameter each day', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Inside', overall: 60, paramsB: 70 });
    dispatch(s, { type: 'deployInternally', modelId: m.id, on: true });
    expect(internalCostPerDay(m)).toBe(70 * RELEASE_TUNING.INTERNAL_COST_PER_PARAM_DAY);
    const cash0 = s.finance.cash;
    s.finance.today = { revenue: {}, expenses: {} };
    releaseTick(s, makeRng(s));
    expect(cash0 - s.finance.cash).toBeCloseTo(internalCostPerDay(m), 6);
    expect(s.finance.today.expenses['compute']).toBeCloseTo(internalCostPerDay(m), 6);
  });

  it('an internal model can be released and stays internal', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Inside', overall: 60 });
    dispatch(s, { type: 'deployInternally', modelId: m.id, on: true });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'full' });
    expect(m.releasedDay).toBe(s.day);
    expect(m.internal).toBe(true);
  });

  it('a public model cannot be deployed internally', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Public', overall: 60, releasedDay: s.day, releaseMode: 'full' });
    dispatch(s, { type: 'deployInternally', modelId: m.id, on: true });
    expect(m.internal).toBeFalsy();
  });

  it('turning internal use off stops the cost and the boost', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Inside', overall: 60 });
    dispatch(s, { type: 'deployInternally', modelId: m.id, on: true });
    dispatch(s, { type: 'deployInternally', modelId: m.id, on: false });
    expect(m.internal).toBe(false);
    expect(internalResearchMult(s)).toBe(1);
  });
});

describe('naming scheme', () => {
  it('stores a known scheme and refuses unknown ones', () => {
    const s = fresh();
    dispatch(s, { type: 'setNamingScheme', schemeId: 'versioned' });
    expect(s.company.namingScheme).toBe('versioned');
    dispatch(s, { type: 'setNamingScheme', schemeId: 'no-such-scheme' });
    expect(s.company.namingScheme).toBe('versioned');
  });
});
