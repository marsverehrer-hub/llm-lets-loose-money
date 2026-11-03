// Rival yearly plans and lab acquisitions (GAME_DESIGN §31).
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { dispatch } from '../src/sim/engine';
import { COMPETITORS } from '../src/sim/data/competitors';
import { RIVAL_PLANS } from '../src/sim/data/rivalry';
import { COMP_TUNING, acquireQuote, arenaLeaderboard, competitorsTick, planEffects, planOutcome } from '../src/sim/systems/competitors';
import { frontierQuality, segmentShares } from '../src/sim/systems/market';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, Competitor, GameState, Model } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { yearOf } from '../src/sim/util';

const DAY_2024 = 2556; // 1 January 2024
const DAY_2025 = DAY_2024 + 366; // 1 January 2025 (2024 is a leap year)

/** Every lab founded by `day` is active and has released one real model; no more releases until a test asks. */
function world(day = DAY_2024 - 30, seed = 7): GameState {
  const s = createInitialState(seed, 'Test Labs');
  s.day = day;
  for (const c of s.competitors) {
    if (c.human) continue;
    const def = COMPETITORS.find((d) => d.id === c.id)!;
    c.active = yearOf(s.day) >= def.foundedYear;
    c.nextReleaseDay = s.day;
  }
  competitorsTick(s, makeRng(s));
  for (const c of s.competitors) c.nextReleaseDay = 1e9;
  return s;
}

const lab = (s: GameState, id: string): Competitor => s.competitors.find((c) => c.id === id)!;
const liveLabs = (s: GameState) => s.competitors.filter((c) => c.active && !c.human);

/** Flat-profile released player model (same shape as competition.test.ts). */
function addPlayerModel(s: GameState, overall: number): void {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, overall])) as Capabilities;
  caps.vision = 0;
  s.models.push({
    id: `m${++s.idCounter}`, name: 'Player-1', paramsB: 70, tokensB: 2000, datasetIds: [], techniques: [], finalLoss: 2,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall }, overall, elo: 800 + 8 * overall,
    trainedDay: s.day, releasedDay: s.day, deprecated: false, caps, benchmarks: {}, specId: null, parentId: null, lineage: [],
    contextK: 128, modalities: ['text'], contaminated: false, config: defaultConfig(s), activeParamsB: 70, quirks: [],
    latentQuirks: [], inferenceMult: 1, vibes: 0, emergences: [],
  } as unknown as Model);
}

/** Push one lab's model well behind the frontier so it is for sale. */
function weaken(s: GameState, c: Competitor): void {
  c.model!.overall = frontierQuality(yearOf(s.day)) - COMP_TUNING.ACQ_GAP - 3;
}

describe('rival plans', () => {
  it('every active lab gets a plan for the year when it opens', () => {
    const s = world();
    for (const c of liveLabs(s)) {
      expect(c.plan?.year).toBe(2023);
      expect(RIVAL_PLANS[c.plan!.id]).toBeDefined();
    }
  });

  it('plans are judged and replaced on 1 January', () => {
    const s = world();
    s.day = DAY_2024;
    competitorsTick(s, makeRng(s));
    for (const c of liveLabs(s)) expect(c.plan?.year).toBe(2024);
    expect(s.notifications.some((n) => n.text.includes('Rival plans for 2024'))).toBe(true);
  });

  it('effects reach prices and the release cycle', () => {
    const s = world();
    const c = liveLabs(s)[0];
    c.plan = { id: 'price_war', year: 2023 };
    expect(planEffects(c).apiPrice).toBe(0.7);
    const before = c.prices.api;
    for (let i = 0; i < 200; i++) {
      s.day += 1;
      competitorsTick(s, makeRng(s));
      c.plan = { id: 'price_war', year: 2023 }; // keep the plan across the new year for this check
    }
    expect(c.prices.api).toBeLessThan(before);

    c.plan = { id: 'ship_fast', year: 2023 };
    c.nextReleaseDay = s.day + 1;
    s.day += 1;
    competitorsTick(s, makeRng(s));
    c.plan = { id: 'ship_fast', year: 2023 };
    const def = COMPETITORS.find((d) => d.id === c.id)!;
    expect(c.nextReleaseDay - s.day).toBeLessThanOrEqual(Math.round(def.releaseEveryDays * 1.3 * 0.7) + 1);
  });

  it('a model plan is foiled when the player holds the better model, and the player is rewarded', () => {
    const s = world();
    const c = liveLabs(s)[0];
    c.plan = { id: 'scale', year: 2023 };
    expect(planOutcome(s, c)).toBe('won'); // no player model yet
    addPlayerModel(s, c.model!.overall + 5);
    expect(planOutcome(s, c)).toBe('foiled');
    const brand = c.brand;
    const hype = s.company.hype;
    s.day = DAY_2024;
    competitorsTick(s, makeRng(s));
    expect(c.brand).toBeLessThan(brand);
    expect(s.company.hype).toBeGreaterThan(hype);
  });

  it('a segment plan fizzles (no reward) when the player is not in that market', () => {
    const s = world();
    // Every lab runs an enterprise push; the player sells nothing, so none can be foiled.
    for (const x of liveLabs(s)) x.plan = { id: 'enterprise', year: 2023 };
    const c = liveLabs(s)[0];
    const out = planOutcome(s, c);
    expect(out === 'won' || out === 'fizzled').toBe(true);
    const hype = s.company.hype;
    const rivalry = c.rivalry ?? 0;
    s.day = DAY_2024;
    competitorsTick(s, makeRng(s));
    expect(s.company.hype).toBe(hype);
    expect(c.rivalry ?? 0).toBeLessThanOrEqual(rivalry);
  });

  it('a talent raid wins only if it poached this year', () => {
    const s = world();
    const c = liveLabs(s)[0];
    c.plan = { id: 'talent_raid', year: 2023 };
    expect(planOutcome(s, c)).toBe('foiled');
    s.flags[`raid.${c.id}`] = 2023;
    expect(planOutcome(s, c)).toBe('won');
  });
});

describe('acquisitions', () => {
  it('a lab near the frontier is not for sale; a weak one is', () => {
    const s = world();
    const c = liveLabs(s)[0];
    c.model!.overall = frontierQuality(yearOf(s.day));
    expect(acquireQuote(s, c.id).ok).toBe(false);
    weaken(s, c);
    const q = acquireQuote(s, c.id);
    expect(q.ok).toBe(true);
    if (q.ok) expect(q.price).toBeGreaterThanOrEqual(COMP_TUNING.ACQ_MIN_PRICE);
  });

  it('refuses in multiplayer, without cash, during the cooldown, and when too few labs would remain', () => {
    const s = world();
    const c = liveLabs(s)[0];
    weaken(s, c);

    s.mp = {} as any;
    expect(acquireQuote(s, c.id).ok).toBe(false);
    s.mp = undefined;

    s.finance.cash = 0;
    dispatch(s, { type: 'acquireLab', labId: c.id });
    expect(c.acquired).toBeFalsy();

    s.flags['acq.lastDay'] = s.day - 10;
    expect(acquireQuote(s, c.id).ok).toBe(false);
    delete s.flags['acq.lastDay'];

    const others = liveLabs(s).filter((x) => x !== c);
    for (const o of others.slice(COMP_TUNING.ACQ_MIN_LABS_LEFT - 1)) o.active = false;
    expect(acquireQuote(s, c.id).ok).toBe(false);
  });

  it('buying a lab removes it from the market for good and brings staff and data', () => {
    const s = world();
    const c = liveLabs(s)[0];
    weaken(s, c);
    const q = acquireQuote(s, c.id);
    if (!q.ok) throw new Error(q.reason);
    s.finance.cash = q.price * 2;
    const researchers = s.staff.roles.researcher.count;
    const engineers = s.staff.roles.engineer.count;
    const other = liveLabs(s).find((x) => x !== c)!;
    const otherRivalry = other.rivalry ?? 0;

    dispatch(s, { type: 'acquireLab', labId: c.id });

    expect(c.acquired).toBe(true);
    expect(s.finance.cash).toBeCloseTo(q.price, 0);
    expect(s.staff.roles.researcher.count).toBe(researchers + q.researchers);
    expect(s.staff.roles.engineer.count).toBe(engineers + q.engineers);
    expect(s.data.owned).toContain(`lab_${c.id}`);
    expect(other.rivalry).toBeGreaterThan(otherRivalry);
    expect(arenaLeaderboard(s).some((r) => r.id === c.id)).toBe(false);
    expect(segmentShares(s, 'developer').some((r) => r.id === c.id)).toBe(false);

    for (let i = 0; i < 400; i++) {
      s.day += 1;
      competitorsTick(s, makeRng(s));
    }
    expect(c.active).toBe(false);
    expect(c.model).toBeNull();
    expect(acquireQuote(s, c.id).ok).toBe(false);
  });

  it('an old save without plan or acquired fields keeps ticking', () => {
    const s = world();
    for (const c of s.competitors) {
      delete c.plan;
      delete c.acquired;
    }
    s.day = DAY_2025;
    expect(() => competitorsTick(s, makeRng(s))).not.toThrow();
    for (const c of liveLabs(s)) expect(c.plan?.year).toBe(2025);
  });
});
