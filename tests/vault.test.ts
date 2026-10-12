// The vault (GAME_DESIGN §17.2–17.6): eval suite, benching, internal arena, teasers, leaks and playground pokes.
import { describe, it, expect, vi } from 'vitest';

// Aha moments are covered in moments.test.ts. Here they would pause the sim mid-test, so they are stubbed out.
vi.mock('../src/sim/systems/moments', () => ({ momentsTick: () => {}, handlers: {} }));
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState, Model, Rng, TrainingConfig } from '../src/sim/types';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { calendarYear, yearOf } from '../src/sim/util';
import { BALANCE } from '../src/sim/balance';
import { frontierQuality } from '../src/sim/systems/market';
import { getBonuses } from '../src/sim/bonuses';
import { headcount } from '../src/sim/systems/staff';
import { LAB_TUNING, provisionalElo } from '../src/sim/systems/lab';
import { activeBenchmarks, benchmarksTick, evaluateModel, isSaturated, availableSpecs } from '../src/sim/systems/capabilities';
import {
  VAULT_TUNING,
  arenaQuote,
  benchPending,
  benchQuote,
  benchSuiteFor,
  bestPublic,
  handlers,
  knownBenchmarks,
  leakChance,
  measureEvalSuite,
  onRelease,
  teaseOptions,
  vaultTick,
} from '../src/sim/systems/vault';

const DATA = ['scrawl_sample', 'common_scrawl_full'];
const MS_PER_DAY = 86_400_000;

function fleet(seed: number): GameState {
  const s = createInitialState(seed, 'Vault');
  s.research.completed.push('transformers');
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  s.data.owned = [...DATA];
  return s;
}

/** Moves the calendar to January 1 of `year` and introduces the benchmarks of that year (as benchmarksTick does daily). */
function toYear(s: GameState, year: number): void {
  s.day = Math.round((Date.UTC(year, 0, 1) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / MS_PER_DAY);
  benchmarksTick(s, rigRng());
}

function cfgWith(s: GameState, patch: Partial<TrainingConfig>): TrainingConfig {
  return { ...defaultConfig(s), ...patch };
}

/** Answers incidents and events with the first choice, the way the bot does, until the run finishes. */
function playRun(s: GameState, maxDays = 2000): void {
  let days = 0;
  while (s.training && days < maxDays) {
    if (s.training.pendingIncident && s.training.pendingIncident.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    if (s.events.pending) {
      dispatch(s, { type: 'resolveEvent', choice: 0 });
      dispatch(s, { type: 'clearEventResult' });
    }
    tick(s);
    days += 1;
  }
}

/** Ticks n days, clearing anything that would block the sim (eval reveals, events, incidents). */
function advance(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (s.events.pending && s.events.pending.result === undefined) {
      dispatch(s, { type: 'resolveEvent', choice: 0 });
      dispatch(s, { type: 'clearEventResult' });
    }
    const pending = s.training?.pendingIncident;
    if (pending && pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
    if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
    if (s.pendingReveal) dispatch(s, { type: 'dismissReveal' });
    tick(s);
  }
}

/** A deterministic rng: chance() answers `chanceFor(p)`, normal() returns its mean, pick() takes the first item. */
function rigRng(chanceFor: boolean | ((p: number) => boolean) = true, seen: number[] = []): Rng {
  return {
    next: () => 0.5,
    range: (min) => min,
    int: (min) => min,
    chance: (p: number) => {
      seen.push(p);
      return typeof chanceFor === 'function' ? chanceFor(p) : chanceFor;
    },
    pick: <T,>(arr: readonly T[]) => arr[0],
    normal: (mean = 0) => mean,
  };
}

/** A real finished pretrain in 2026, so the full benchmark set is active, with its eval reveal still pending. */
function pretrained(seed: number): { s: GameState; model: Model } {
  const s = fleet(seed);
  toYear(s, 2026);
  const cfg = cfgWith(s, { precision: 'fp32', lr: 0.5 });
  dispatch(s, { type: 'startTraining', name: 'Vault run', paramsB: 30, tokensB: 300, datasetIds: DATA, techniques: [], config: cfg });
  playRun(s);
  const model = s.models[s.models.length - 1];
  return { s, model };
}

/** Benchmark ids active now that this model has not measured yet, in table order. */
function unmeasuredActive(s: GameState, model: Model): string[] {
  return activeBenchmarks(s)
    .map((b) => b.id)
    .filter((id) => model.benchRuns?.[id] === undefined);
}

/** Clears every public benchmark score for one id, so any measured reading counts as SOTA. */
function clearPublicBenchmarks(s: GameState, id: string): void {
  for (const c of s.competitors) if (c.model) c.model.benchmarks = { ...(c.model.benchmarks ?? {}), [id]: 0 };
  for (const m of s.models) if (m.releasedDay !== null) m.benchmarks = { ...(m.benchmarks ?? {}), [id]: 0 };
}

describe('eval suite on eval day', () => {
  it('in the first year only the benchmarks already out can be in the suite', () => {
    const s = createInitialState(10, 'Vault');
    expect(calendarYear(s.day)).toBe(BALANCE.START_YEAR);
    const suite = benchSuiteFor(s, {} as Model);
    expect(suite.length).toBeGreaterThan(0);
    const active = activeBenchmarks(s).map((b) => b.id);
    for (const id of suite) expect(active).toContain(id);
  });

  it('benchSuiteFor returns at most the suite size, distinct, active and not saturated', () => {
    const { s, model } = pretrained(11);
    const suite = benchSuiteFor(s, model);
    expect(suite.length).toBe(VAULT_TUNING.SUITE_SIZE);
    expect(new Set(suite).size).toBe(suite.length);
    const active = new Set(activeBenchmarks(s).map((b) => b.id));
    for (const id of suite) {
      expect(active.has(id)).toBe(true);
      expect(isSaturated(s, id)).toBe(false);
    }
  });

  it('the suite spreads over categories before doubling up', () => {
    const { s, model } = pretrained(12);
    const cats = benchSuiteFor(s, model).map((id) => activeBenchmarks(s).find((b) => b.id === id)!.category);
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('stamps the codename, measures only the suite, and reveals only the suite', () => {
    const { s, model } = pretrained(13);
    const reveal = s.pendingReveal!;
    expect(reveal).toBeTruthy();
    expect(model.codename).toBe('Vault run');
    const suite = benchSuiteFor(s, model);
    expect(Object.keys(model.benchRuns ?? {}).sort()).toEqual([...suite].sort());
    expect(Object.keys(reveal.benchmarks).sort()).toEqual([...suite].sort());
    // The true table is kept in full for the market and capabilities.
    expect(Object.keys(model.benchmarks ?? {}).length).toBeGreaterThan(suite.length);
  });

  it('readings are the true score plus small noise, and the reveal shows them', () => {
    const { s, model } = pretrained(14);
    for (const [id, run] of Object.entries(model.benchRuns ?? {})) {
      const truth = model.benchmarks![id];
      expect(Math.abs(run.score - truth)).toBeLessThan(4 * VAULT_TUNING.MEASURE_SD + 0.1);
      expect(s.pendingReveal!.benchmarks[id]).toBe(run.score);
    }
  });

  it('measureEvalSuite fills benchRuns and returns the same readings', () => {
    const { s, model } = pretrained(16);
    const readings = measureEvalSuite(s, model, rigRng());
    expect(Object.keys(readings).sort()).toEqual(Object.keys(model.benchRuns ?? {}).sort());
    for (const id of Object.keys(readings)) expect(readings[id]).toBe(Math.round(model.benchmarks![id] * 10) / 10);
  });

  it('a finished fine-tune is measured the same way', () => {
    const { s, model } = pretrained(15);
    dispatch(s, { type: 'dismissReveal' });
    const spec = availableSpecs(s, model)[0];
    expect(spec).toBeTruthy();
    dispatch(s, { type: 'startFinetune', parentId: model.id, specId: spec.id, name: 'Vault tune' });
    playRun(s);
    const tuned = s.models[s.models.length - 1];
    expect(tuned.codename).toBe('Vault tune');
    const suite = benchSuiteFor(s, tuned);
    expect(Object.keys(tuned.benchRuns ?? {}).sort()).toEqual([...suite].sort());
    expect(Object.keys(s.pendingReveal!.benchmarks).sort()).toEqual([...suite].sort());
  });
});

describe('benching', () => {
  it('benchQuote is $5k per benchmark for a small model, plus two days and one day per benchmark', () => {
    const { s, model } = pretrained(21);
    const ids = unmeasuredActive(s, model).slice(0, 2);
    const q = benchQuote(s, model.id, ids);
    expect(q.cost).toBe(ids.length * VAULT_TUNING.BENCH_MIN_COST);
    expect(q.days).toBe(VAULT_TUNING.BENCH_DAYS_BASE + ids.length);
  });

  it('runBenchmarks charges the quote, runs a job, and announces the results when they land', () => {
    const { s, model } = pretrained(22);
    dispatch(s, { type: 'dismissReveal' });
    const ids = unmeasuredActive(s, model).slice(0, 2);
    const quote = benchQuote(s, model.id, ids);
    const before = s.finance.cash;
    dispatch(s, { type: 'runBenchmarks', modelId: model.id, benchIds: ids });
    expect(before - s.finance.cash).toBeCloseTo(quote.cost, 6);
    expect(benchPending(model)).toEqual(ids);
    const announcements: string[] = [];
    for (let i = 0; i < quote.days; i++) {
      advance(s, 1);
      for (const n of s.notifications) if (/^Evals for Vault run/.test(n.text)) announcements.push(n.text);
    }
    expect(benchPending(model)).toEqual([]);
    for (const id of ids) expect(model.benchRuns?.[id]).toBeDefined();
    expect(announcements.some((t) => /: 2 new results/.test(t))).toBe(true);
  });

  it('skips unknown, already measured and already pending benchmarks', () => {
    const { s, model } = pretrained(23);
    dispatch(s, { type: 'dismissReveal' });
    const measured = Object.keys(model.benchRuns ?? {})[0];
    const [free] = unmeasuredActive(s, model);
    const before = s.finance.cash;
    dispatch(s, { type: 'runBenchmarks', modelId: model.id, benchIds: [measured, 'no_such_bench'] });
    expect(s.finance.cash).toBe(before);
    expect(benchPending(model)).toEqual([]);
    dispatch(s, { type: 'runBenchmarks', modelId: model.id, benchIds: [free] });
    const once = s.finance.cash;
    dispatch(s, { type: 'runBenchmarks', modelId: model.id, benchIds: [free] });
    expect(s.finance.cash).toBe(once);
    expect(benchPending(model)).toEqual([free]);
  });

  it('refuses public models: their benchmarks are already out', () => {
    const { s, model } = pretrained(24);
    dispatch(s, { type: 'dismissReveal' });
    model.releasedDay = s.day;
    const before = s.finance.cash;
    dispatch(s, { type: 'runBenchmarks', modelId: model.id, benchIds: unmeasuredActive(s, model).slice(0, 1) });
    expect(s.finance.cash).toBe(before);
    expect(benchPending(model)).toEqual([]);
  });

  it('a finished job lands exact readings under a rigged rng, and flags an unannounced SOTA', () => {
    const { s, model } = pretrained(25);
    const [id] = unmeasuredActive(s, model);
    clearPublicBenchmarks(s, id);
    expect(bestPublic(s, id)).toBe(0);
    model.benchJobs = [{ benchIds: [id], doneDay: s.day }];
    vaultTick(s, rigRng(false));
    expect(model.benchRuns?.[id]?.score).toBe(Math.round(model.benchmarks![id] * 10) / 10);
    expect(model.benchJobs).toEqual([]);
    expect(s.notifications.some((n) => /Evals for Vault run: 1 new result, 1 unannounced SOTA\./.test(n.text))).toBe(true);
  });

  it('a result that does not beat the public table is not an unannounced SOTA', () => {
    const { s, model } = pretrained(26);
    const [id] = unmeasuredActive(s, model);
    for (const c of s.competitors) if (c.model) c.model.benchmarks = { ...(c.model.benchmarks ?? {}), [id]: 100 };
    model.benchJobs = [{ benchIds: [id], doneDay: s.day }];
    vaultTick(s, rigRng(false));
    expect(s.notifications.some((n) => /unannounced SOTA/.test(n.text) && /Vault run/.test(n.text))).toBe(false);
  });

  it('knownBenchmarks shows only measured results before release and the full table after', () => {
    const { s, model } = pretrained(27);
    expect(Object.keys(knownBenchmarks(s, model)).sort()).toEqual(Object.keys(model.benchRuns ?? {}).sort());
    model.releasedDay = s.day;
    expect(Object.keys(knownBenchmarks(s, model)).length).toBe(Object.keys(model.benchmarks ?? {}).length);
  });

  it('bestPublic is the best of rivals and released models, or null when nobody publishes', () => {
    const { s, model } = pretrained(28);
    clearPublicBenchmarks(s, 'squad');
    expect(bestPublic(s, 'squad')).toBe(0);
    model.releasedDay = s.day;
    model.benchmarks = { ...(model.benchmarks ?? {}), squad: 77 };
    expect(bestPublic(s, 'squad')).toBe(77);
    expect(bestPublic(s, 'no_such_bench')).toBeNull();
  });
});

describe('internal arena', () => {
  it('arenaQuote is $40k in the first year and grows with the calendar', () => {
    const s = fleet(31);
    expect(arenaQuote(s)).toEqual({ cost: 40_000, days: 10 });
    toYear(s, 2026);
    expect(arenaQuote(s).cost).toBe(Math.round(40_000 * (1 + 0.2 * (calendarYear(s.day) - 2017))));
  });

  it('measures Elo within the band, charges once, and shows the reading before release', () => {
    const { s, model } = pretrained(32);
    dispatch(s, { type: 'dismissReveal' });
    const before = s.finance.cash;
    dispatch(s, { type: 'internalArena', modelId: model.id });
    const paid = before - s.finance.cash;
    expect(paid).toBeCloseTo(arenaQuote(s).cost, 6);
    dispatch(s, { type: 'internalArena', modelId: model.id });
    expect(s.finance.cash).toBeCloseTo(before - paid, 6);
    advance(s, arenaQuote(s).days);
    expect(model.arena?.elo).toBeDefined();
    expect(model.arena?.band).toBe(12);
    expect(Math.abs(model.arena!.elo! - model.elo)).toBeLessThan(5 * 12);
    const pre = provisionalElo(s, model);
    expect(pre.provisional).toBe(true);
    expect(pre.elo).toBe(model.arena!.elo);
    expect(pre.band).toBe(12);
  });

  it('after release the arena reading is the starting point and converges on the true Elo', () => {
    const { s, model } = pretrained(33);
    model.arena = { doneDay: s.day, elo: 1234, band: 12 };
    model.releasedDay = s.day;
    model.eloSettlesDay = s.day + 21;
    expect(provisionalElo(s, model).elo).toBe(1234);
    const truth = LAB_TUNING.ELO_BASE + LAB_TUNING.ELO_PER_POINT * model.overall + (model.vibes ?? 0);
    s.day = model.eloSettlesDay;
    const done = provisionalElo(s, model);
    expect(done.provisional).toBe(false);
    expect(done.elo).toBeCloseTo(truth, 6);
  });

  it('without an arena, the settled rating is still the true base plus vibes', () => {
    const { s, model } = pretrained(34);
    model.releasedDay = s.day;
    model.eloSettlesDay = s.day + 21;
    s.day += 21;
    const truth = LAB_TUNING.ELO_BASE + LAB_TUNING.ELO_PER_POINT * model.overall + (model.vibes ?? 0);
    expect(provisionalElo(s, model).elo).toBeCloseTo(truth, 6);
  });

  it('a finished arena can leak its screenshots, adding hype and news but no weights leak', () => {
    const { s, model } = pretrained(35);
    dispatch(s, { type: 'dismissReveal' });
    model.overall = 0;
    model.arena = { doneDay: s.day };
    const hype = s.company.hype;
    const newsBefore = s.news.length;
    const seen: number[] = [];
    vaultTick(s, rigRng((p) => (seen.push(p), p === VAULT_TUNING.ARENA_SCREENSHOT_CHANCE)));
    expect(model.arena?.elo).toBe(Math.round(model.elo));
    expect(seen).toContain(VAULT_TUNING.ARENA_SCREENSHOT_CHANCE);
    expect(s.company.hype).toBe(Math.min(100, hype + VAULT_TUNING.ARENA_SCREENSHOT_HYPE));
    expect(s.news.length).toBeGreaterThan(newsBefore);
    expect(model.leakedDay).toBeUndefined();
  });
});

describe('teasers', () => {
  it('teaseOptions promises the right overall for each level', () => {
    const { s, model } = pretrained(41);
    dispatch(s, { type: 'dismissReveal' });
    const byLevel = Object.fromEntries(teaseOptions(s, model).map((o) => [o.level, o]));
    expect(byLevel.vague.expected).toBe(3); // nothing released yet: best is 0, plus 3
    expect(byLevel.vague.hype).toBe(VAULT_TUNING.TEASE_VAGUE_HYPE);
    expect(byLevel.benchmarks.expected).toBe(model.overall);
    expect(byLevel.hype.expected).toBe(model.overall + VAULT_TUNING.TEASE_HYPE_OFFSET);
    expect(byLevel.hype.hype).toBe(VAULT_TUNING.TEASE_HYPE_HYPE);
    expect(byLevel.vague.available && byLevel.hype.available).toBe(true);
  });

  it('the vague expectation follows the best released model', () => {
    const { s, model } = pretrained(47);
    dispatch(s, { type: 'dismissReveal' });
    const shipped = { ...model, id: 'shipped', releasedDay: 0, overall: 40 } as Model;
    s.models.push(shipped);
    const vague = teaseOptions(s, model).find((o) => o.level === 'vague')!;
    expect(vague.expected).toBe(40 + VAULT_TUNING.TEASE_VAGUE_OFFSET);
  });

  it('the benchmark tease needs two measured benchmarks', () => {
    const { s, model } = pretrained(42);
    dispatch(s, { type: 'dismissReveal' });
    model.benchRuns = { squad: { day: s.day, score: 50 } };
    const bench = teaseOptions(s, model).find((o) => o.level === 'benchmarks')!;
    expect(bench.available).toBe(false);
    expect(bench.reason).toMatch(/2 measured benchmarks/);
    model.benchRuns = { ...model.benchRuns, glue: { day: s.day, score: 60 } };
    expect(teaseOptions(s, model).find((o) => o.level === 'benchmarks')!.available).toBe(true);
  });

  it('teaseModel applies hype (and aiHype for the overpromise), and only once per model', () => {
    const { s, model } = pretrained(43);
    dispatch(s, { type: 'dismissReveal' });
    s.company.hype = 10;
    s.market.aiHype = 10;
    dispatch(s, { type: 'teaseModel', modelId: model.id, level: 'hype' });
    expect(s.company.hype).toBe(10 + VAULT_TUNING.TEASE_HYPE_HYPE);
    expect(s.market.aiHype).toBe(10 + VAULT_TUNING.TEASE_HYPE_AI);
    expect(model.teased?.level).toBe('hype');
    expect(model.teased?.expected).toBe(model.overall + VAULT_TUNING.TEASE_HYPE_OFFSET);
    dispatch(s, { type: 'teaseModel', modelId: model.id, level: 'vague' });
    expect(s.company.hype).toBe(10 + VAULT_TUNING.TEASE_HYPE_HYPE);
    expect(teaseOptions(s, model).every((o) => !o.available)).toBe(true);
  });

  it('a teased model that lands on or above the promise pays off, with brand for a clear beat', () => {
    const { s, model } = pretrained(44);
    model.teased = { day: s.day, level: 'hype', expected: model.overall - 10 };
    model.releasedDay = s.day;
    s.company.hype = 40;
    s.company.brand = 20;
    const lines = onRelease(s, model);
    expect(s.company.hype).toBe(40 + VAULT_TUNING.PAYOFF_HYPE);
    expect(s.company.brand).toBe(20 + VAULT_TUNING.PAYOFF_BRAND);
    expect(lines.length).toBe(2);
  });

  it('a teaser the model misses is backlash scaled by the gap', () => {
    const { s, model } = pretrained(45);
    model.teased = { day: s.day, level: 'hype', expected: model.overall + 6 };
    model.releasedDay = s.day;
    s.company.hype = 50;
    s.company.reputation = 50;
    const lines = onRelease(s, model);
    expect(s.company.reputation).toBeCloseTo(50 - 6, 6);
    expect(s.company.hype).toBeCloseTo(50 - 6 * VAULT_TUNING.BACKLASH_HYPE_PER_POINT, 6);
    expect(lines.some((l) => /backlash/i.test(l))).toBe(true);
  });

  it('the reputation and hype hits are capped on large gaps', () => {
    const { s, model } = pretrained(46);
    model.teased = { day: s.day, level: 'hype', expected: model.overall + 60 };
    model.releasedDay = s.day;
    s.company.hype = 80;
    s.company.reputation = 80;
    onRelease(s, model);
    expect(s.company.reputation).toBeCloseTo(80 - VAULT_TUNING.BACKLASH_REP_MAX, 6);
    expect(s.company.hype).toBeCloseTo(80 - VAULT_TUNING.BACKLASH_HYPE_MAX, 6);
  });

  it('a contaminated model teased on benchmarks adds to the scandal weight at release', () => {
    const { s, model } = pretrained(48);
    model.contaminated = true;
    model.teased = { day: s.day, level: 'benchmarks', expected: model.overall };
    model.releasedDay = s.day;
    onRelease(s, model);
    expect(s.flags.teasedContaminated).toBe(VAULT_TUNING.TEASED_CONTAMINATED_SCANDAL);
  });

  it('onRelease does nothing for a plain, unteased, unleaked model', () => {
    const { s, model } = pretrained(49);
    model.releasedDay = s.day;
    model.teased = undefined;
    model.leakedDay = undefined;
    const hype = s.company.hype;
    expect(onRelease(s, model)).toEqual([]);
    expect(s.company.hype).toBe(hype);
  });
});

describe('leaks', () => {
  it('a released model cannot leak, and neither can one far below the frontier', () => {
    const { s, model } = pretrained(51);
    const frontier = frontierQuality(yearOf(s.day));
    model.overall = frontier + 1;
    expect(leakChance(s, model)).toBeGreaterThan(0);
    model.releasedDay = s.day;
    expect(leakChance(s, model)).toBe(0);
    model.releasedDay = null;
    model.overall = frontier - VAULT_TUNING.LEAK_FRONTIER_GAP - 1;
    expect(leakChance(s, model)).toBe(0);
  });

  it('the chance follows headcount and safety, and halves for internal-only models', () => {
    const { s, model } = pretrained(52);
    model.overall = frontierQuality(yearOf(s.day)) + 1;
    model.internal = false;
    const base = leakChance(s, model);
    const expected = (VAULT_TUNING.LEAK_CHANCE_PER_DAY * (1 + headcount(s) / VAULT_TUNING.LEAK_HEADCOUNT_DIVISOR)) / Math.max(0.01, getBonuses(s).safety);
    expect(base).toBeCloseTo(expected, 10);
    model.internal = true;
    expect(leakChance(s, model)).toBeCloseTo(base * VAULT_TUNING.LEAK_INTERNAL_FACTOR, 10);
  });

  it('a leak sets leakedDay, moves hype and reputation, and boosts rivals once', () => {
    const { s, model } = pretrained(53);
    model.overall = frontierQuality(yearOf(s.day)) + 1;
    s.company.hype = 20;
    s.company.reputation = 50;
    s.flags.leakBoost = 0;
    vaultTick(s, rigRng(true));
    expect(model.leakedDay).toBe(s.day);
    expect(s.company.hype).toBe(20 + VAULT_TUNING.LEAK_HYPE);
    expect(s.company.reputation).toBe(50 + VAULT_TUNING.LEAK_REP);
    expect(s.flags.leakBoost).toBe(VAULT_TUNING.LEAK_BOOST);
    expect(s.news.some((n) => /torrent site/.test(n.text))).toBe(true);
    vaultTick(s, rigRng(true));
    expect(s.flags.leakBoost).toBe(VAULT_TUNING.LEAK_BOOST);
  });

  it('a leaked model that is released takes the flat launch hype cut', () => {
    const { s, model } = pretrained(54);
    model.leakedDay = s.day;
    model.releasedDay = s.day;
    s.company.hype = 30;
    const lines = onRelease(s, model);
    expect(s.company.hype).toBe(30 - VAULT_TUNING.LEAK_RELEASE_HYPE_CUT);
    expect(lines.some((l) => /leaked/.test(l))).toBe(true);
  });
});

describe('playground pokes', () => {
  it('exposes a latent quirk with the poke chance, moving it into the visible quirks', () => {
    const { s, model } = pretrained(61);
    model.latentQuirks = ['golden_gate'];
    model.quirks = [];
    const seen: number[] = [];
    handlers.pokeModel!(s, { type: 'pokeModel', modelId: model.id, promptId: 'strawberry' }, rigRng(true, seen));
    expect(seen).toEqual([VAULT_TUNING.POKE_CHANCE]);
    expect(model.latentQuirks).toEqual([]);
    expect(model.quirks).toEqual(['golden_gate']);
    expect(model.pokes).toEqual({ day: s.day, count: 1 });
    expect(s.notifications.some((n) => /You noticed something while testing Vault run/.test(n.text))).toBe(true);
  });

  it('only the first ten pokes each day have a chance, and the count resets the next day', () => {
    const { s, model } = pretrained(62);
    model.latentQuirks = Array.from({ length: 12 }, (_, i) => `fake_q${i}`);
    model.quirks = [];
    const rng = rigRng(true);
    for (let i = 0; i < 12; i++) handlers.pokeModel!(s, { type: 'pokeModel', modelId: model.id, promptId: 'x' }, rng);
    expect(model.quirks!.length).toBe(VAULT_TUNING.POKE_CHANCE_LIMIT);
    expect(model.latentQuirks!.length).toBe(2);
    expect(model.pokes).toEqual({ day: s.day, count: 12 });
    s.day += 1;
    handlers.pokeModel!(s, { type: 'pokeModel', modelId: model.id, promptId: 'x' }, rng);
    expect(model.quirks!.length).toBe(VAULT_TUNING.POKE_CHANCE_LIMIT + 1);
    expect(model.pokes).toEqual({ day: s.day, count: 1 });
  });

  it('a model with no latent quirks is poked harmlessly', () => {
    const { s, model } = pretrained(63);
    model.latentQuirks = [];
    const before = [...(model.quirks ?? [])];
    handlers.pokeModel!(s, { type: 'pokeModel', modelId: model.id, promptId: 'x' }, rigRng(true));
    expect(model.quirks).toEqual(before);
  });
});

describe('tunables', () => {
  it('the headline numbers are exported and sensible', () => {
    expect(VAULT_TUNING.ARENA_COST).toBe(40_000);
    expect(VAULT_TUNING.ARENA_DAYS).toBe(10);
    expect(VAULT_TUNING.BENCH_MIN_COST).toBe(5_000);
    expect(VAULT_TUNING.SUITE_SIZE).toBe(4);
    expect(VAULT_TUNING.POKE_CHANCE).toBe(0.08);
  });
});
