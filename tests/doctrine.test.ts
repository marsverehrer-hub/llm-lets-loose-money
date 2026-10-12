// Lab doctrines (GAME_DESIGN §19.1): bonuses, the change cooldown, and the release, open-weights, finetune,
// distill and valuation hooks they touch.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import type { Capabilities, GameState, Model, Product } from '../src/sim/types';
import { CAP_IDS } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { DOCTRINES, DOCTRINE_COOLDOWN, DOCTRINE_TUNING, doctrineById } from '../src/sim/data/doctrines';
import { RESEARCH } from '../src/sim/data/research';
import { getBonuses, contractFitMult } from '../src/sim/bonuses';
import { NEUTRAL_BONUSES } from '../src/sim/util';
import { makeRng } from '../src/sim/rng';
import { evaluateModel, estimateFinetune } from '../src/sim/systems/capabilities';
import { computeValuation } from '../src/sim/systems/finance';
import { distillQuote } from '../src/sim/systems/derive';
import { productsTick } from '../src/sim/systems/products';
import { researchPointsPerDay } from '../src/sim/systems/research';
import { RELEASE_TUNING, openUserMult, releasePreview } from '../src/sim/systems/release';
import { doctrineCooldownLeft } from '../src/sim/systems/doctrine';

/** A flat-profile model: every capability equals `overall`. */
function addModel(s: GameState, o: { name: string; overall: number; paramsB?: number; releasedDay?: number | null; releaseMode?: Model['releaseMode'] }): Model {
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
    parentId: null,
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
  };
  evaluateModel(s, m);
  s.models.push(m);
  return m;
}

function fresh(seed = 21): GameState {
  const s = createInitialState(seed, 'Doctrine Test Labs');
  s.finance.cash = 1e12;
  return s;
}

/** A lab with a big rented fleet, so training runs take days rather than years. */
function fleet(seed = 22): GameState {
  const s = fresh(seed);
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
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

describe('doctrine bonuses', () => {
  it('with no doctrine picked, every bonus is neutral', () => {
    const s = fresh();
    expect(s.company.doctrine).toBeUndefined();
    expect(getBonuses(s)).toEqual(NEUTRAL_BONUSES);
  });

  it('each doctrine applies its Bonuses multipliers as specced in GAME_DESIGN 19.1', () => {
    const expected: Record<string, Partial<Record<keyof typeof NEUTRAL_BONUSES, number>>> = {
      frontier: { releaseHype: 1.3, valuation: 1.15, budgetAppeal: 0.9 },
      efficient: { inferenceEfficiency: 1.4, budgetAppeal: 1.25, trainingSpeed: 1.1, crownValue: 1.2, releaseHype: 0.85, valuation: 0.95 },
      open: { openPenalty: 0.4, valuation: 0.9 },
      specialist: { finetuneCost: 0.6, crownValue: 1.5, releaseHype: 0.9 },
      enterprise: { sales: 1.2, safety: 1.3, releaseHype: 0.8, budgetAppeal: 0.95 },
    };
    for (const id of Object.keys(expected)) {
      const s = fresh();
      s.company.doctrine = id as GameState['company']['doctrine'];
      const b = getBonuses(s);
      for (const k of Object.keys(NEUTRAL_BONUSES) as (keyof typeof NEUTRAL_BONUSES)[]) {
        expect(b[k], `${id} ${k}`).toBeCloseTo(expected[id][k] ?? 1, 9);
      }
    }
  });

  it('contract fit is per deal kind, not a global bonus', () => {
    const s = fresh();
    s.company.doctrine = 'open';
    expect(contractFitMult(s, 'onprem')).toBeCloseTo(1.1, 9);
    expect(contractFitMult(s, 'government')).toBe(1);
    s.company.doctrine = 'specialist';
    expect(contractFitMult(s, 'vertical')).toBeCloseTo(1.15, 9);
    expect(contractFitMult(s, 'grant')).toBeCloseTo(1.15, 9);
    expect(contractFitMult(s, 'onprem')).toBe(1);
    s.company.doctrine = 'enterprise';
    expect(contractFitMult(s, 'government')).toBeCloseTo(1.2, 9);
    expect(contractFitMult(s, 'onprem')).toBeCloseTo(1.2, 9);
    expect(getBonuses(s).contractFit ?? 1).toBe(1);
    s.company.doctrine = undefined;
    expect(contractFitMult(s, 'government')).toBe(1);
  });

  it('every perk and drawback bullet states the real multiplier', () => {
    for (const d of DOCTRINES) {
      const text = [...d.perks, ...d.drawbacks].join(' | ');
      const values = [...Object.values(d.bonuses), ...Object.values(d.contractFit ?? {})];
      for (const v of values) expect(text, `${d.id} ${v}`).toContain(`x${v}`);
      expect(d.perks.length).toBeGreaterThan(0);
      expect(d.drawbacks.length).toBeGreaterThan(0);
    }
  });

  it('doctrineById finds each doctrine and ignores unknown ids', () => {
    expect(DOCTRINES).toHaveLength(5);
    for (const d of DOCTRINES) expect(doctrineById(d.id)).toBe(d);
    expect(doctrineById(undefined)).toBeUndefined();
  });
});

describe('doctrine choice and cooldown', () => {
  it('the first pick is free and sets the day it was made', () => {
    const s = fresh();
    const hype0 = s.company.hype;
    const morale0 = s.staff.morale;
    dispatch(s, { type: 'setDoctrine', doctrine: 'frontier' });
    expect(s.company.doctrine).toBe('frontier');
    expect(s.company.doctrineSince).toBe(s.day);
    expect(s.company.hype).toBe(hype0);
    expect(s.staff.morale).toBe(morale0);
  });

  it('changing focus is blocked until the cooldown has passed, then costs hype and morale', () => {
    const s = fresh();
    dispatch(s, { type: 'setDoctrine', doctrine: 'frontier' });
    const since = s.company.doctrineSince!;
    s.day = since + DOCTRINE_COOLDOWN - 1;
    expect(doctrineCooldownLeft(s)).toBe(1);
    const hype0 = s.company.hype;
    const morale0 = s.staff.morale;
    dispatch(s, { type: 'setDoctrine', doctrine: 'efficient' });
    expect(s.company.doctrine).toBe('frontier');
    expect(s.company.hype).toBe(hype0);
    expect(s.staff.morale).toBe(morale0);
    expect(s.notifications.at(-1)?.text).toContain('1 days');

    s.day = since + DOCTRINE_COOLDOWN;
    expect(doctrineCooldownLeft(s)).toBe(0);
    dispatch(s, { type: 'setDoctrine', doctrine: 'efficient' });
    expect(s.company.doctrine).toBe('efficient');
    expect(s.company.doctrineSince).toBe(s.day);
    expect(s.company.hype).toBeCloseTo(Math.max(0, hype0 - 10), 9);
    expect(s.staff.morale).toBeCloseTo(Math.max(0, morale0 - 5), 9);
  });

  it('re-picking the current focus changes nothing, and unknown ids are refused', () => {
    const s = fresh();
    dispatch(s, { type: 'setDoctrine', doctrine: 'open' });
    const since = s.company.doctrineSince;
    s.day += DOCTRINE_COOLDOWN;
    const hype0 = s.company.hype;
    dispatch(s, { type: 'setDoctrine', doctrine: 'open' });
    expect(s.company.hype).toBe(hype0);
    expect(s.company.doctrineSince).toBe(since);
    dispatch(s, { type: 'setDoctrine', doctrine: 'bogus' as never });
    expect(s.company.doctrine).toBe('open');
  });
});

describe('release hooks', () => {
  it('releaseHype scales the hype and brand a release brings in', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Loosey 1', overall: 60 });
    const neutral = releasePreview(s, m, 'full');
    s.company.doctrine = 'frontier';
    const frontier = releasePreview(s, m, 'full');
    expect(frontier.hype / neutral.hype).toBeCloseTo(1.3, 6);
    expect(frontier.brand / neutral.brand).toBeCloseTo(1.3, 6);
    s.company.doctrine = 'enterprise';
    const enterprise = releasePreview(s, m, 'full');
    expect(enterprise.hype / neutral.hype).toBeCloseTo(0.8, 6);
    expect(enterprise.brand / neutral.brand).toBeCloseTo(0.8, 6);
  });

  it('the open penalty reduces the user loss, is shown in the preview, and is fixed at release', () => {
    const s = fresh();
    expect(openUserMult(undefined)).toBe(1);
    s.company.doctrine = 'open';
    const m = addModel(s, { name: 'Open 1', overall: 60 });
    expect(releasePreview(s, m, 'open').notes.join(' ')).toContain('10%');
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'open' });
    expect(m.openUserShare).toBeCloseTo(0.9, 9);
    expect(openUserMult(m)).toBeCloseTo(0.9, 9);

    // Products serving the open model keep 90% of their users, not the 75% of the base game.
    const po = productOn(s, m.id, 40_000, 'chat');
    productsTick(s, makeRng(s));
    const openRevenue = po.revenuePerDay;
    po.active = false;
    s.company.doctrine = 'specialist';
    const pc = productOn(s, addModel(s, { name: 'Closed', overall: 60, releasedDay: s.day, releaseMode: 'full' }).id, 40_000, 'chat');
    productsTick(s, makeRng(s));
    expect(openRevenue / pc.revenuePerDay).toBeCloseTo(0.9, 6);

    // The loss was decided at release: switching doctrine later does not change it.
    s.company.doctrine = undefined;
    expect(openUserMult(m)).toBeCloseTo(0.9, 9);
  });

  it('without the doctrine, open weights keep the base 75% of users and say 25% loss', () => {
    const s = fresh();
    const m = addModel(s, { name: 'Open 2', overall: 60 });
    expect(releasePreview(s, m, 'open').notes.join(' ')).toContain('25%');
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'open' });
    expect(openUserMult(m)).toBeCloseTo(RELEASE_TUNING.OPEN_USER_MULT, 9);
  });

  it('the open doctrine multiplies brand on open releases by 1.5 and banks research points', () => {
    const s = fresh();
    s.company.doctrine = 'open';
    const m = addModel(s, { name: 'Open 3', overall: 60 });
    const full = releasePreview(s, m, 'full');
    const brand0 = s.company.brand;
    s.research.current = RESEARCH[0].id;
    s.research.progress = 5;
    const rp = researchPointsPerDay(s);
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'open' });
    expect(DOCTRINE_TUNING.OPEN_BRAND_MULT).toBe(1.5);
    expect(s.company.brand - brand0).toBeCloseTo((full.brand + RELEASE_TUNING.OPEN_BRAND) * 1.5, 6);
    expect(s.research.progress).toBeCloseTo(5 + DOCTRINE_TUNING.OPEN_RESEARCH_DAYS * rp, 6);
    expect(s.research.current).toBe(RESEARCH[0].id);
  });

  it('open releases bank no research without the doctrine or without a current topic', () => {
    const s = fresh();
    s.research.current = RESEARCH[0].id;
    s.research.progress = 0;
    const m = addModel(s, { name: 'Open 4', overall: 60 });
    dispatch(s, { type: 'releaseModel', modelId: m.id, mode: 'open' });
    expect(s.research.progress).toBe(0);

    s.company.doctrine = 'open';
    s.research.current = null;
    const n = addModel(s, { name: 'Open 5', overall: 60 });
    dispatch(s, { type: 'releaseModel', modelId: n.id, mode: 'open' });
    expect(s.research.progress).toBe(0);
  });
});

describe('finance, finetune and distill hooks', () => {
  it('the valuation multiplier scales the fundamental valuation', () => {
    const s = fresh();
    s.company.doctrine = undefined;
    const v0 = computeValuation(s);
    s.company.doctrine = 'frontier';
    expect(computeValuation(s) / v0).toBeCloseTo(1.15, 6);
    s.company.doctrine = 'open';
    expect(computeValuation(s) / v0).toBeCloseTo(0.9, 6);
  });

  it('the specialist finetune cost cuts fine-tune FLOPs to 60%', () => {
    const s = fresh();
    const base = addModel(s, { name: 'Base', overall: 60, releasedDay: s.day });
    const neutral = estimateFinetune(s, base.id, 'instruct')!.flops;
    s.company.doctrine = 'specialist';
    expect(estimateFinetune(s, base.id, 'instruct')!.flops / neutral).toBeCloseTo(0.6, 9);
  });

  it('startFinetune and startDistill spend the cheaper compute under the specialist doctrine', () => {
    const neutral = fleet(31);
    const cheap = fleet(31);
    cheap.company.doctrine = 'specialist';
    for (const s of [neutral, cheap]) s.research.completed.push('instruction_tuning');
    const nb = addModel(neutral, { name: 'Base', overall: 60, releasedDay: neutral.day });
    const cb = addModel(cheap, { name: 'Base', overall: 60, releasedDay: cheap.day });
    dispatch(neutral, { type: 'startFinetune', parentId: nb.id, specId: 'instruct' });
    dispatch(cheap, { type: 'startFinetune', parentId: cb.id, specId: 'instruct' });
    expect(neutral.training?.totalFlops).toBeGreaterThan(0);
    expect(cheap.training!.totalFlops / neutral.training!.totalFlops).toBeCloseTo(0.6, 9);

    const dn = fleet(32);
    const dc = fleet(32);
    dc.company.doctrine = 'specialist';
    const tn = addModel(dn, { name: 'Teacher', overall: 70, paramsB: 70 });
    const tc = addModel(dc, { name: 'Teacher', overall: 70, paramsB: 70 });
    expect(distillQuote(dn, tn.id, 14).ok).toBe(true);
    dispatch(dn, { type: 'startDistill', teacherId: tn.id, paramsB: 14, name: 'Pupil' });
    dispatch(dc, { type: 'startDistill', teacherId: tc.id, paramsB: 14, name: 'Pupil' });
    expect(dn.training?.totalFlops).toBeGreaterThan(0);
    expect(dc.training!.totalFlops / dn.training!.totalFlops).toBeCloseTo(0.6, 9);
  });
});
