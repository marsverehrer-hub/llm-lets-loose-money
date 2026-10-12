// Rival labs: catch-up, counter-punch, segment targeting, poaching, rivalry, trash talk, standings and boosts (GAME_DESIGN §18.1).
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { COMPETITORS } from '../src/sim/data/competitors';
import { CEO_QUOTES, COUNTER_HEADLINES, REACTION_HEADLINES, fillTemplate } from '../src/sim/data/rivalry';
import {
  COMP_TUNING,
  arenaLeaderboard,
  competitorsTick,
  rivalCatchUp,
  rivalryTier,
  topShareSegments,
} from '../src/sim/systems/competitors';
import { frontierQuality } from '../src/sim/systems/market';
import { CAP_IDS, MP_RIVAL_ID } from '../src/sim/types';
import type { Capabilities, Competitor, CompetitorModel, GameState, Model, Product } from '../src/sim/types';
import { yearOf } from '../src/sim/util';
import { defaultConfig } from '../src/sim/data/trainingOptions';

/** Day 2556 is 1 January 2024: the labs founded by then are live. Poaching rolls on days that are multiples of 30. */
const DAY_2024 = 2556;
const POACH_DAY_2024 = 2580; // 30 x 86, a monthly roll day in 2024

/** A fresh game with every founded AI lab active but silent (no releases) until a test sets a release day. */
function fresh(seed = 5, day = 100): GameState {
  const s = createInitialState(seed, 'Test Labs');
  s.day = day;
  for (const c of s.competitors) {
    if (c.human) continue;
    const def = COMPETITORS.find((d) => d.id === c.id)!;
    c.active = yearOf(s.day) >= def.foundedYear;
    c.nextReleaseDay = 1e9;
  }
  return s;
}

function labOf(s: GameState, id: string): Competitor {
  return s.competitors.find((c) => c.id === id)!;
}

/** Flat-profile released player model: every capability equals `overall`. */
function addPlayerModel(s: GameState, overall: number, name = 'Player-1'): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, overall])) as Capabilities;
  caps.vision = 0;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name,
    paramsB: 70,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + 8 * overall,
    trainedDay: s.day,
    releasedDay: s.day,
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
    activeParamsB: 70,
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
  } as unknown as Model;
  s.models.push(m);
  return m;
}

function addPlayerProduct(s: GameState, modelId: string, kind: Product['kind'], price: number): Product {
  const p: Product = {
    id: `prod${++s.idCounter}`,
    kind,
    name: 'Test product',
    modelId,
    price,
    users: 1000,
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

/** Gives a lab a released flagship with a given overall (elo follows the game's 800 + 8 x overall rule). */
function setLab(c: Competitor, overall: number, name = 'Lab-1', day = 0): CompetitorModel {
  c.model = { name, scores: { reasoning: overall, coding: overall, chat: overall, safety: overall }, overall, elo: 800 + 8 * overall, releasedDay: day };
  return c.model;
}

function runDays(s: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    s.day += 1;
    competitorsTick(s, makeRng(s));
  }
}

describe('catch-up (§18.1)', () => {
  it('starts in 2018, is full by 2020, closes 90% of the gap with no margin', () => {
    const s = fresh();
    addPlayerModel(s, 90);
    expect(rivalCatchUp(s, 2017.9, frontierQuality(2017.9))).toBe(0);
    expect(rivalCatchUp(s, 2018, frontierQuality(2018))).toBeCloseTo(0, 9);
    const f19 = frontierQuality(2019);
    expect(rivalCatchUp(s, 2019, f19)).toBeCloseTo(0.5 * 0.9 * (90 - f19), 6);
    const f21 = frontierQuality(2021);
    expect(rivalCatchUp(s, 2021, f21)).toBeCloseTo(0.9 * (90 - f21), 6);
    expect(COMP_TUNING.CATCHUP_START_YEAR).toBe(2018);
    expect(COMP_TUNING.CATCHUP_FULL_YEAR).toBe(2020);
    expect(COMP_TUNING.CATCHUP_SHARE).toBe(0.9);
    expect(COMP_TUNING.CATCHUP_MARGIN).toBe(0);
  });

  it('the early frontier sits near a competent player: about +5 at most in 2017-2019', () => {
    expect(frontierQuality(2017.5)).toBeGreaterThanOrEqual(45);
    expect(frontierQuality(2018.5)).toBeGreaterThanOrEqual(68);
    expect(frontierQuality(2019.5)).toBeGreaterThanOrEqual(74);
  });
});

describe('counter-punch', () => {
  it('pulls the two labs within 10 Elo of the top forward when the player takes Arena #1', () => {
    const s = fresh();
    addPlayerModel(s, 70); // elo 1360
    const near = labOf(s, 'deepmined');
    const close = labOf(s, 'openaye');
    const far = labOf(s, 'anthropomorphic');
    setLab(near, 69); // elo 1352, within 10
    setLab(close, 69.5); // elo 1356, within 10
    setLab(far, 60); // elo 1280, outside
    competitorsTick(s, makeRng(s));
    for (const lab of [near, close]) {
      expect(lab.nextReleaseDay).toBeGreaterThanOrEqual(s.day + COMP_TUNING.COUNTER_DAYS_MIN);
      expect(lab.nextReleaseDay).toBeLessThanOrEqual(s.day + COMP_TUNING.COUNTER_DAYS_MAX);
    }
    expect(far.nextReleaseDay).toBe(1e9);
    // Each pulled lab gets a floor at the player's overall plus a little noise.
    expect(s.flags['counter.deepmined']).toBeGreaterThan(55);
    expect(s.flags['counter.deepmined']).toBeLessThan(85);
    expect(s.flags['counter.openaye']).toBeDefined();
    // The headline is personality-flavoured.
    const lines = [...COUNTER_HEADLINES.research, ...COUNTER_HEADLINES.hype].map((t) => fillTemplate(t, { lab: 'DeepMined' }));
    expect(s.news.some((n) => lines.includes(n.text))).toBe(true);
  });

  it('applies the floor to the next release, so the lab ships at or above it', () => {
    const s = fresh();
    addPlayerModel(s, 70);
    const lab = labOf(s, 'deepmined');
    setLab(lab, 30);
    lab.nextReleaseDay = s.day;
    s.flags['counter.deepmined'] = 80;
    competitorsTick(s, makeRng(s));
    expect(lab.modelsReleased).toBe(1);
    expect(lab.model!.overall).toBeGreaterThanOrEqual(80);
    expect(s.flags['counter.deepmined']).toBeUndefined();
  });

  it('a second takeover inside the cooldown does not pull labs forward again', () => {
    const s = fresh();
    addPlayerModel(s, 70);
    const near = labOf(s, 'deepmined');
    setLab(near, 69);
    competitorsTick(s, makeRng(s));
    expect(near.nextReleaseDay).toBeLessThan(1e9);
    // Player loses the top, then retakes it ten days later: still inside the 30-day cooldown.
    near.nextReleaseDay = 1e9;
    s.flags['arenaTop'] = 0;
    s.day += 10;
    competitorsTick(s, makeRng(s));
    expect(near.nextReleaseDay).toBe(1e9);
  });

  it('never pulls a human rival forward, and leaves the human entry alone', () => {
    const s = fresh();
    addPlayerModel(s, 70);
    const human: Competitor = {
      id: MP_RIVAL_ID,
      human: true,
      active: true,
      model: { name: 'Human-1', scores: { reasoning: 69.5, coding: 69.5, chat: 69.5, safety: 69.5 }, overall: 69.5, elo: 1356, releasedDay: 0 },
      prices: { chat: Infinity, api: Infinity, enterprise: Infinity },
      users: { consumer: 0, developer: 0, enterprise: 0 },
      brand: 10,
      valuation: 0,
      nextReleaseDay: 1e9,
      modelsReleased: 0,
    };
    s.competitors.push(human);
    // The human is on the Arena, within 10 Elo of the player, and still the player is #1.
    expect(arenaLeaderboard(s)[0].isPlayer).toBe(true);
    competitorsTick(s, makeRng(s));
    expect(human.nextReleaseDay).toBe(1e9);
    expect(human.modelsReleased).toBe(0);
    expect(human.rivalry).toBeUndefined();
    expect(s.flags[`counter.${MP_RIVAL_ID}`]).toBeUndefined();
    expect(human.model!.name).toBe('Human-1');
  });
});

describe('segment targeting (home brand and price labs)', () => {
  it('a home-segment lab gains 0.02 brand a day while the player holds the top share there', () => {
    const s = fresh();
    s.flags['chatMoment'] = 1; // consumer chat is open
    const m = addPlayerModel(s, 80);
    addPlayerProduct(s, m.id, 'chat', 20);
    expect(topShareSegments(s).has('consumer')).toBe(true);
    const openaye = labOf(s, 'openaye'); // hype: consumer is home
    const before = openaye.brand;
    competitorsTick(s, makeRng(s));
    // The brand also drifts back toward its starting value by 0.2% of the gap each day, which is negligible here.
    expect(openaye.brand - before).toBeCloseTo(COMP_TUNING.HOME_BRAND_PER_DAY, 3);
  });

  it('no home brand gain without the top share', () => {
    const s = fresh();
    const openaye = labOf(s, 'openaye');
    const before = openaye.brand;
    competitorsTick(s, makeRng(s));
    expect(openaye.brand).toBeCloseTo(before, 6);
  });

  it('a price lab follows the player down to 80% of its base within about 60 days, and not below', () => {
    const s = fresh(5, DAY_2024);
    const mistrial = labOf(s, 'mistrial');
    expect(mistrial.active).toBe(true);
    const base = s.market.segments.developer.refPrice * 0.55;
    mistrial.prices.api = base;
    const m = addPlayerModel(s, 70);
    addPlayerProduct(s, m.id, 'api', 0.3 * base); // a deep undercut, well under the floor
    expect(topShareSegments(s).has('developer')).toBe(true);
    runDays(s, 60);
    expect(mistrial.prices.api).toBeLessThan(0.85 * base);
    expect(mistrial.prices.api).toBeGreaterThan(0.78 * base);
    runDays(s, 60);
    expect(mistrial.prices.api).toBeGreaterThan(0.78 * base);
  });
});

describe('poaching', () => {
  /** Runs monthly rolls and returns the head count of each poaching event, read from the player's notifications. */
  function monthsOfPoaching(s: GameState, months: number): number[] {
    const events: number[] = [];
    let seenId = Math.max(0, ...s.notifications.map((n) => n.id));
    for (let k = 1; k <= months; k++) {
      s.day = POACH_DAY_2024 + k * COMP_TUNING.POACH_EVERY_DAYS;
      competitorsTick(s, makeRng(s));
      for (const n of s.notifications) {
        if (n.id <= seenId) continue;
        const m = /poached (\d+) of your/.exec(n.text);
        if (m) events.push(Number(m[1]));
      }
      seenId = Math.max(seenId, ...s.notifications.map((n) => n.id));
    }
    return events;
  }

  it('takes one to three researchers at a time, and tells the player', () => {
    const s = fresh(9, POACH_DAY_2024);
    s.staff.roles.researcher.count = 200;
    s.staff.morale = 30;
    const events = monthsOfPoaching(s, 240);
    expect(events.length).toBeGreaterThan(0);
    for (const n of events) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(COMP_TUNING.POACH_MAX_RESEARCHERS);
    }
    expect(s.notifications.some((n) => /poached \d+ of your researchers?/.test(n.text))).toBe(true);
  });

  it('does nothing when morale is above 80', () => {
    const s = fresh(9, POACH_DAY_2024);
    s.staff.roles.researcher.count = 200;
    s.staff.morale = 85;
    expect(monthsOfPoaching(s, 240)).toEqual([]);
    expect(s.staff.roles.researcher.count).toBe(200);
  });

  it('does nothing when researchers are paid at least 1.2x market', () => {
    const s = fresh(9, POACH_DAY_2024);
    s.staff.roles.researcher.count = 200;
    s.staff.morale = 30;
    s.staff.roles.researcher.salaryLevel = 1.2;
    expect(monthsOfPoaching(s, 240)).toEqual([]);
  });

  it('can take a hired star when there are no researchers left to take', () => {
    const s = fresh(9, POACH_DAY_2024);
    s.staff.roles.researcher.count = 0;
    s.staff.morale = 30;
    s.staff.stars.push({ id: 'star-x', name: 'Star X', role: 'researcher', title: 'Test star', salary: 1, bonuses: {}, loyalty: 10, hiredDay: 0 });
    monthsOfPoaching(s, 240);
    expect(s.staff.stars.some((st) => st.id === 'star-x')).toBe(false);
  });
});

describe('rivalry', () => {
  it('rises when the player beats a lab flagship, and does not count the same standing twice', () => {
    const s = fresh();
    const openaye = labOf(s, 'openaye');
    setLab(openaye, 60); // elo 1280
    addPlayerModel(s, 70); // elo 1360: beats the flagship and passes the lab on the Arena
    competitorsTick(s, makeRng(s));
    const afterFirst = COMP_TUNING.RIVALRY_BEAT_FLAGSHIP + COMP_TUNING.RIVALRY_ARENA_PASS - COMP_TUNING.RIVALRY_DECAY_PER_DAY;
    expect(openaye.rivalry).toBeCloseTo(afterFirst, 6);
    s.day += 1;
    competitorsTick(s, makeRng(s));
    expect(openaye.rivalry).toBeCloseTo(afterFirst - COMP_TUNING.RIVALRY_DECAY_PER_DAY, 6);
  });

  it('decays by 0.1 a day when nothing happens', () => {
    const s = fresh();
    const openaye = labOf(s, 'openaye');
    openaye.rivalry = 50;
    runDays(s, 10);
    expect(openaye.rivalry).toBeCloseTo(49, 6);
  });

  it('rivalry tiers split at 20, 40 and 60', () => {
    expect(rivalryTier(0)).toBe(0);
    expect(rivalryTier(19.9)).toBe(0);
    expect(rivalryTier(20)).toBe(1);
    expect(rivalryTier(40)).toBe(2);
    expect(rivalryTier(60)).toBe(3);
    expect(rivalryTier(100)).toBe(3);
  });

  it('above 60, a lab releases faster (cycle -20%), and below it does not', () => {
    const cycleMax = COMP_TUNING.RIVALRY_CYCLE_MULT * 1.3 * COMPETITORS.find((d) => d.id === 'openaye')!.releaseEveryDays;
    const highCycles: number[] = [];
    const lowCycles: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      for (const [rivalry, out] of [
        [70, highCycles],
        [0, lowCycles],
      ] as const) {
        const s = fresh(seed);
        const openaye = labOf(s, 'openaye');
        openaye.rivalry = rivalry;
        openaye.nextReleaseDay = s.day;
        competitorsTick(s, makeRng(s));
        out.push(openaye.nextReleaseDay - s.day);
      }
    }
    expect(Math.max(...highCycles)).toBeLessThanOrEqual(Math.ceil(cycleMax) + 1);
    expect(Math.max(...lowCycles)).toBeGreaterThan(Math.ceil(cycleMax) + 1);
  });

  it('emits a CEO quote when rivalry climbs into a higher tier', () => {
    const s = fresh();
    const openaye = labOf(s, 'openaye');
    openaye.rivalry = 25; // tier 1
    competitorsTick(s, makeRng(s));
    const quotes = CEO_QUOTES.openaye[1].map((q) => `OpenAye's CEO says: "${q}"`);
    expect(s.news.some((n) => quotes.includes(n.text))).toBe(true);
  });

  it('CEO quotes: every lab has four tiers of at least four lines, with no leftover placeholders', () => {
    for (const def of COMPETITORS) {
      const tiers = CEO_QUOTES[def.id];
      expect(tiers, def.id).toHaveLength(4);
      for (const lines of tiers) {
        expect(lines.length, def.id).toBeGreaterThanOrEqual(4);
        for (const line of lines) expect(line, line).not.toMatch(/\{\w+\}/);
      }
    }
    for (const pool of Object.values(REACTION_HEADLINES)) expect(pool.length).toBeGreaterThanOrEqual(2);
    for (const pool of Object.values(COUNTER_HEADLINES)) expect(pool.length).toBeGreaterThanOrEqual(2);
  });
});

describe('weekly standings', () => {
  it('announces when a lab passes the player on the Arena, and when the player passes it back', () => {
    const s = fresh(5, 700); // day 700 is a Sunday-style weekly tick (700 = 7 x 100)
    addPlayerModel(s, 70);
    const lab = labOf(s, 'deepmined');
    setLab(lab, 60);
    competitorsTick(s, makeRng(s)); // first standing: records the order, no news

    setLab(lab, 75); // now above the player
    s.day = 707;
    competitorsTick(s, makeRng(s));
    expect(s.notifications.some((n) => n.text === 'DeepMined passes you on the Arena (#1 → #2)')).toBe(true);

    setLab(lab, 60); // back below
    s.day = 714;
    competitorsTick(s, makeRng(s));
    expect(s.notifications.some((n) => n.text === 'You pass DeepMined (#2 → #1)')).toBe(true);
  });
});

describe('leak and open-weights boosts', () => {
  it('each point adds one point to every rival release, and the boosts fade by (1 - 1/180) a day', () => {
    const plain = fresh(9);
    const boosted = fresh(9);
    boosted.flags.leakBoost = 10;
    boosted.flags.openBoost = 5;
    for (const s of [plain, boosted]) labOf(s, 'deepmined').nextReleaseDay = s.day;
    competitorsTick(plain, makeRng(plain));
    competitorsTick(boosted, makeRng(boosted));
    const gain = labOf(boosted, 'deepmined').model!.overall - labOf(plain, 'deepmined').model!.overall;
    expect(gain).toBeGreaterThan(12);
    expect(gain).toBeLessThan(18);

    // One day has already passed; measure the fade over the next 180 days from there.
    const leakNow = boosted.flags.leakBoost!;
    const openNow = boosted.flags.openBoost!;
    runDays(boosted, 180);
    expect(boosted.flags.leakBoost).toBeCloseTo(leakNow * Math.pow(1 - 1 / 180, 180), 6);
    expect(boosted.flags.openBoost).toBeCloseTo(openNow * Math.pow(1 - 1 / 180, 180), 6);
  });
});
