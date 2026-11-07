// v20 C: the open ecosystem (rival fine-tunes), contract market scaling, specialist exclusives and the support deal.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { COMPETITORS } from '../src/sim/data/competitors';
import { EXCLUSIVE_DEFS, contractDefById } from '../src/sim/data/contracts';
import { rivalLabs } from '../src/sim/systems/rivals';
import { hubTick } from '../src/sim/systems/hub';
import { frontierQuality } from '../src/sim/systems/market';
import { contractsTick, isExclusive, marketScale } from '../src/sim/systems/contracts';
import { makeRng } from '../src/sim/rng';
import { CAP_IDS, type Capabilities, type GameState, type Model } from '../src/sim/types';
import { calendarYear, yearOf } from '../src/sim/util';

/** Day number for a calendar date, day 0 = 2017-01-01 (matches util.dayToDate). */
function dayOf(year: number): number {
  return Math.round((Date.UTC(year, 0, 1) - Date.UTC(2017, 0, 1)) / 86_400_000);
}

/** A fresh game at `year` with every rival lab active. */
function world(seed: number, year: number): GameState {
  const s = createInitialState(seed, 'Ecosystem');
  s.finance.cash = 1e13;
  s.day = dayOf(year);
  for (const lab of rivalLabs(s)) lab.status = 'active';
  return s;
}

/** The player's released open-weights model, at the frontier of the current year unless `overall` says otherwise. */
function openModel(s: GameState, overall = frontierQuality(calendarYear(s.day))): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, overall])) as Capabilities;
  const m: Model = {
    id: `m${++s.idCounter}`, name: 'Hearth 1', paramsB: 7, tokensB: 2000, datasetIds: [], techniques: [], finalLoss: 2,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall }, overall, elo: 1200, trainedDay: s.day,
    releasedDay: s.day, deprecated: false, caps, benchmarks: {}, specId: null, parentId: null, lineage: [], contextK: 128,
    modalities: ['text'], contaminated: false, config: defaultConfig(s), activeParamsB: 7, quirks: [], latentQuirks: [],
    inferenceMult: 1, vibes: 0, emergences: [], releaseMode: 'open',
  };
  s.models.push(m);
  return m;
}

/** Runs the hub for `days` days from the state's current day, then puts the day back. */
function runHub(s: GameState, days: number): void {
  const start = s.day;
  for (let d = 0; d < days; d++) {
    s.day = start + d;
    hubTick(s);
  }
  s.day = start;
}

describe('ecosystem derivatives', () => {
  it('never grows without a released open model', () => {
    const s = world(7, 2030);
    runHub(s, 800);
    expect(s.ecosystem?.derivatives ?? 0).toBe(0);
  });

  it('grows once the player ships open weights, and counts per lab', () => {
    const s = world(7, 2030);
    openModel(s);
    runHub(s, 800);
    const eco = s.ecosystem!;
    expect(eco.derivatives).toBeGreaterThan(0);
    expect(Object.values(eco.byLab).reduce((a, b) => a + b, 0)).toBe(eco.derivatives);
  });

  it('is deterministic per seed', () => {
    const run = () => {
      const s = world(13, 2030);
      openModel(s);
      runHub(s, 800);
      return s.ecosystem!.derivatives;
    };
    expect(run()).toBe(run());
  });

  it('leaves the player rng stream alone', () => {
    const s = world(7, 2030);
    openModel(s);
    const before = s.rngState;
    runHub(s, 400);
    expect(s.rngState).toBe(before);
  });

  it('only open-release labs and labs with a high open bias can fine-tune', () => {
    const s = world(7, 2030);
    openModel(s);
    runHub(s, 800);
    const allowed = new Set(COMPETITORS.filter((d) => d.kind === 'open' || (d.openBias ?? 0) >= 0.3).map((d) => d.id));
    for (const id of Object.keys(s.ecosystem!.byLab)) expect(allowed.has(id)).toBe(true);
  });
});

describe('market scale', () => {
  it('is flat until 2024, grows after, and is capped at 3', () => {
    expect(marketScale(2018)).toBe(1);
    expect(marketScale(2026)).toBeGreaterThan(marketScale(2024));
    expect(marketScale(2030)).toBeGreaterThan(marketScale(2026));
    expect(marketScale(2040)).toBe(3);
  });

  it('scales the value of deals offered in late years', () => {
    const s = world(21, 2030);
    s.contracts = { offers: [], active: [], history: [], nextOfferDay: s.day, pending: [] };
    contractsTick(s, makeRng({ rngState: 1 }));
    const y = yearOf(s.day);
    const regular = s.contracts.offers.filter((o) => o.defId !== 'support-ecosystem' && !isExclusive(o));
    expect(regular.length).toBeGreaterThan(0);
    for (const o of regular) expect(o.perYear / contractDefById(o.defId)!.value(y).perYear).toBeCloseTo(marketScale(y), 6);
  });
});

describe('specialist exclusives', () => {
  it('pay $50-300M a year from 2024 and are flagged exclusive', () => {
    for (const d of EXCLUSIVE_DEFS) {
      expect(d.minYear).toBe(2024);
      expect(d.exclusive).toBe(true);
      for (const y of [2024, 2030, 2036]) {
        const v = d.value(y).perYear;
        expect(v).toBeGreaterThanOrEqual(50e6);
        expect(v).toBeLessThanOrEqual(300e6);
      }
    }
  });

  it('are offered to specialist labs only', () => {
    const exclusiveCount = (doctrine: 'specialist' | undefined) => {
      const s = world(31, 2024);
      s.company.doctrine = doctrine;
      s.contracts = { offers: [], active: [], history: [], nextOfferDay: s.day, pending: [] };
      let found = 0;
      for (let d = 0; d < 1500; d++) {
        s.day += 1;
        contractsTick(s, makeRng({ rngState: 1 }));
        found += s.contracts.offers.filter(isExclusive).length;
      }
      return found;
    };
    expect(exclusiveCount('specialist')).toBeGreaterThan(0);
    expect(exclusiveCount(undefined)).toBe(0);
  });
});

describe('ecosystem support deal', () => {
  it('appears at five derivatives, is sized per derivative, and only one is open at a time', () => {
    const s = world(41, 2030);
    openModel(s);
    s.ecosystem = { derivatives: 4, byLab: {}, lastDay: s.day };
    contractsTick(s, makeRng({ rngState: 1 }));
    const support = () => s.contracts!.offers.filter((o) => o.defId === 'support-ecosystem');
    expect(support()).toHaveLength(0);

    s.ecosystem.derivatives = 6;
    contractsTick(s, makeRng({ rngState: 1 }));
    contractsTick(s, makeRng({ rngState: 2 }));
    expect(support()).toHaveLength(1);
    expect(support()[0].perYear).toBe(6 * 2e6);
    expect(support()[0].reqs.openWeights).toBe(true);
    expect(support()[0].title).toContain('Hearth 1');
  });
});
