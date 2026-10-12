// OWNER: Agent VAULT-A. Unreleased models: benching, internal arena, teasers, leaks, playground pokes. GAME_DESIGN §17.2–17.6.
import type { ActionHandlers, BenchmarkDef, GameState, Id, Model, Rng, TeaseLevel } from '../types';
import { activeBenchmarks, benchmarkById, bestResults, isSaturated } from './capabilities';
import { frontierQuality } from './market';
import { headcount } from './staff';
import { getBonuses } from '../bonuses';
import { quirkById } from '../data/quirks';
import { calendarYear, clamp, notify, pushNews, trySpend, yearOf } from '../util';

/** Every number in the vault. Sim-side only; the UI reads results, not these. */
export const VAULT_TUNING = {
  /** Eval day: the standard suite size, and the measurement noise on any benchmark reading (SD, points). */
  SUITE_SIZE: 4,
  MEASURE_SD: 0.8,
  /** Benchmarking: per-benchmark cost = max(MIN, PER_PARAM_B × activeParamsB × DOLLARS × (1 + GROWTH × (year − BASE))). Days = DAYS_BASE + n. */
  BENCH_MIN_COST: 5_000,
  BENCH_COST_PER_PARAM_B: 0.002,
  BENCH_DOLLARS_PER_UNIT: 1_000,
  BENCH_YEAR_GROWTH: 0.15,
  BENCH_BASE_YEAR: 2017,
  BENCH_DAYS_BASE: 2,
  /** Internal arena: cost = COST × (1 + GROWTH × (year − BASE)), takes ARENA_DAYS. Reading is Elo ± BAND. */
  ARENA_COST: 40_000,
  ARENA_YEAR_GROWTH: 0.2,
  ARENA_BASE_YEAR: 2017,
  ARENA_DAYS: 10,
  ARENA_BAND: 12,
  /** Chance the arena screenshots leak when the arena finishes (not a weights leak). */
  ARENA_SCREENSHOT_CHANCE: 0.06,
  ARENA_SCREENSHOT_HYPE: 4,
  /** Teasers: hype gained, and the promise made (expected overall). */
  TEASE_VAGUE_HYPE: 6,
  TEASE_VAGUE_OFFSET: 3,
  TEASE_BENCH_HYPE: 12,
  TEASE_BENCH_MIN_MEASURED: 2,
  TEASE_HYPE_HYPE: 20,
  TEASE_HYPE_AI: 2,
  TEASE_HYPE_OFFSET: 8,
  /** Release: meeting or beating a teaser pays off; falling short is backlash (rep and hype scaled by the gap). */
  PAYOFF_HYPE: 5,
  PAYOFF_BRAND_MARGIN: 5,
  PAYOFF_BRAND: 3,
  BACKLASH_REP_MAX: 10,
  BACKLASH_HYPE_PER_POINT: 2,
  BACKLASH_HYPE_MAX: 25,
  /** A contaminated model teased on benchmarks adds this to s.flags.teasedContaminated (scandal weight) at release. */
  TEASED_CONTAMINATED_SCANDAL: 10,
  /** Leaks: daily chance before the headcount, safety and internal-only factors. Only models within FRONTIER_GAP of the frontier can leak. */
  LEAK_CHANCE_PER_DAY: 0.0006,
  LEAK_HEADCOUNT_DIVISOR: 200,
  LEAK_INTERNAL_FACTOR: 0.5,
  LEAK_FRONTIER_GAP: 5,
  LEAK_HYPE: 8,
  LEAK_REP: -4,
  LEAK_BOOST: 3,
  /** Release of a leaked model: its launch hype is cut by this flat amount (stands in for the ×0.6 curiosity penalty). */
  LEAK_RELEASE_HYPE_CUT: 3,
  /** Playground pokes: the first POKE_CHANCE_LIMIT per model per day each have POKE_CHANCE to expose one latent quirk. */
  POKE_CHANCE: 0.08,
  POKE_CHANCE_LIMIT: 10,
};
const T = VAULT_TUNING;

/** Copy for teasers, keyed by level. Placeholders: {company}, {codename}. */
const TEASE_COPY: Record<TeaseLevel, string> = {
  vague: '{company} hints that {codename} is "a step change". The step is not described.',
  benchmarks: '{company} posts a bar chart of {codename}\'s internal benchmarks. The y-axis starts at 70.',
  hype: '{company} says {codename} will change everything. The date is "soon".',
};

function modelById(s: GameState, id: Id): Model | undefined {
  return s.models.find((x) => x.id === id);
}
function codenameOf(m: Model): string {
  return m.codename ?? m.name;
}
function bestReleasedOverall(s: GameState): number {
  let best = 0;
  for (const m of s.models) if (m.releasedDay !== null && !m.deprecated) best = Math.max(best, m.overall);
  return best;
}
/** A reading: true score plus measurement noise, rounded to 0.1 and kept in 0..100. */
export function measure(truth: number, rng: Rng): number {
  return Math.round(clamp(truth + rng.normal(0, T.MEASURE_SD), 0, 100) * 10) / 10;
}
function benchCostOf(s: GameState, m: Model): number {
  const year = calendarYear(s.day);
  const paramsB = m.activeParamsB ?? m.paramsB;
  const raw = T.BENCH_COST_PER_PARAM_B * paramsB * T.BENCH_DOLLARS_PER_UNIT * (1 + T.BENCH_YEAR_GROWTH * (year - T.BENCH_BASE_YEAR));
  return Math.max(T.BENCH_MIN_COST, Math.round(raw));
}

/** Eval-day standard suite for a model (benchmark ids). The newest non-saturated benchmarks, one per category first. */
export function benchSuiteFor(s: GameState, _m: Model): Id[] {
  const active = activeBenchmarks(s);
  const fresh = active.filter((b) => !isSaturated(s, b.id));
  const pool = (fresh.length > 0 ? fresh : active).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
  const picked: BenchmarkDef[] = [];
  const cats = new Set<string>();
  for (const b of pool) {
    if (picked.length >= T.SUITE_SIZE) break;
    if (!cats.has(b.category)) {
      cats.add(b.category);
      picked.push(b);
    }
  }
  for (const b of pool) {
    if (picked.length >= T.SUITE_SIZE) break;
    if (!picked.includes(b)) picked.push(b);
  }
  return picked.map((b) => b.id);
}

/**
 * Eval day: measure the suite on a freshly built model. Fills m.benchRuns (true score + noise) and returns the same
 * readings for EvalReveal.benchmarks. Everything else stays unmeasured until the player pays for it.
 */
export function measureEvalSuite(s: GameState, m: Model, rng: Rng): Record<Id, number> {
  const readings: Record<Id, number> = {};
  const runs: Record<Id, { day: number; score: number }> = {};
  for (const id of benchSuiteFor(s, m)) {
    const truth = m.benchmarks?.[id];
    if (truth === undefined) continue;
    const score = measure(truth, rng);
    readings[id] = score;
    runs[id] = { day: s.day, score };
  }
  m.benchRuns = runs;
  return readings;
}

/** Benchmarks the player can see for this model: all for released ones, measured ones for unreleased. */
export function knownBenchmarks(_s: GameState, m: Model): Record<Id, number> {
  return m.releasedDay !== null ? { ...(m.benchmarks ?? {}) } : Object.fromEntries(Object.entries(m.benchRuns ?? {}).map(([k, v]) => [k, v.score]));
}

/** Best public score on a benchmark (rivals + the player's released models), or null when nobody publishes one. */
export function bestPublic(s: GameState, benchId: Id): number | null {
  return bestResults(s, benchId)[0]?.score ?? null;
}

/** A reading that beats every public score on that benchmark. */
function beatsPublic(s: GameState, benchId: Id, score: number): boolean {
  const best = bestPublic(s, benchId);
  return best !== null && score > best;
}

/** A measured benchmark that beats every public score. Shown as "SOTA (unannounced)" in the UI. */
export function isUnannouncedSota(s: GameState, m: Model, benchId: Id): boolean {
  const mine = m.benchRuns?.[benchId]?.score;
  return mine !== undefined && beatsPublic(s, benchId, mine);
}

export function benchQuote(s: GameState, modelId: Id, benchIds: Id[]): { cost: number; days: number } {
  const m = modelById(s, modelId);
  const n = benchIds.length;
  if (!m || n === 0) return { cost: 0, days: 0 };
  return { cost: benchCostOf(s, m) * n, days: T.BENCH_DAYS_BASE + n };
}

/** Benchmark ids currently being measured for this model. */
export function benchPending(m: Model): Id[] {
  return (m.benchJobs ?? []).flatMap((j) => j.benchIds);
}

export function arenaQuote(s: GameState): { cost: number; days: number } {
  const year = calendarYear(s.day);
  return { cost: Math.round(T.ARENA_COST * (1 + T.ARENA_YEAR_GROWTH * (year - T.ARENA_BASE_YEAR))), days: T.ARENA_DAYS };
}

export interface TeaseOption { level: TeaseLevel; label: string; hype: number; expected: number; available: boolean; reason?: string }

/** The three teasers for a model, with what each promises. Only one teaser per model, and only while unreleased. */
export function teaseOptions(s: GameState, m: Model): TeaseOption[] {
  const locked = m.releasedDay !== null ? 'Already public.' : m.teased ? 'Already teased. One teaser per model.' : null;
  const measured = Object.keys(m.benchRuns ?? {}).length;
  const benchOk = measured >= T.TEASE_BENCH_MIN_MEASURED;
  const opts: TeaseOption[] = [
    { level: 'vague', label: 'Vague hint', hype: T.TEASE_VAGUE_HYPE, expected: bestReleasedOverall(s) + T.TEASE_VAGUE_OFFSET, available: locked === null },
    { level: 'benchmarks', label: 'Benchmark chart', hype: T.TEASE_BENCH_HYPE, expected: m.overall, available: locked === null && benchOk },
    { level: 'hype', label: 'Overpromise', hype: T.TEASE_HYPE_HYPE, expected: m.overall + T.TEASE_HYPE_OFFSET, available: locked === null },
  ];
  return opts.map((o) => {
    const reason = locked ?? (o.level === 'benchmarks' && !benchOk ? `Needs ${T.TEASE_BENCH_MIN_MEASURED} measured benchmarks first (have ${measured}).` : null);
    return reason ? { ...o, available: false, reason } : o;
  });
}

/** Daily leak chance for an unreleased model (0 when it can't leak). */
export function leakChance(s: GameState, m: Model): number {
  if (m.releasedDay !== null || m.deprecated || m.leakedDay !== undefined) return 0;
  if (m.overall < frontierQuality(yearOf(s.day)) - T.LEAK_FRONTIER_GAP) return 0;
  let p = (T.LEAK_CHANCE_PER_DAY * (1 + headcount(s) / T.LEAK_HEADCOUNT_DIVISOR)) / Math.max(0.01, getBonuses(s).safety);
  if (m.internal) p *= T.LEAK_INTERNAL_FACTOR;
  return Math.min(1, p);
}

/**
 * Called by the release handler. Resolves the teaser (payoff or backlash) and the leak hype penalty, and returns
 * lines for the release notice. Hype and reputation are changed here; the release's own gain is not.
 */
export function onRelease(s: GameState, m: Model): string[] {
  const lines: string[] = [];
  const name = codenameOf(m);
  if (m.teased) {
    const expected = Math.round(m.teased.expected);
    const overall = Math.round(m.overall);
    const gap = m.overall - m.teased.expected;
    if (gap >= 0) {
      s.company.hype = clamp(s.company.hype + T.PAYOFF_HYPE, 0, 100);
      lines.push(`As promised: ${m.name} scores ${overall} against the ${expected} we implied. Hype +${T.PAYOFF_HYPE}.`);
      if (gap >= T.PAYOFF_BRAND_MARGIN) {
        s.company.brand = clamp(s.company.brand + T.PAYOFF_BRAND, 0, 100);
        lines.push(`It beat the teaser by ${Math.round(gap)}. Brand +${T.PAYOFF_BRAND}.`);
      }
    } else {
      const short = -gap;
      const repLoss = Math.min(T.BACKLASH_REP_MAX, short);
      const hypeLoss = Math.min(T.BACKLASH_HYPE_MAX, short * T.BACKLASH_HYPE_PER_POINT);
      s.company.reputation = clamp(s.company.reputation - repLoss, 0, 100);
      s.company.hype = clamp(s.company.hype - hypeLoss, 0, 100);
      const text = `Teaser backlash: ${m.name} scores ${overall}, not the ${expected} we implied. Reputation -${round1(repLoss)}, hype -${round1(hypeLoss)}.`;
      lines.push(text);
      pushNews(s, text, 'bad');
    }
    if (m.teased.level === 'benchmarks' && m.contaminated) {
      s.flags.teasedContaminated = (s.flags.teasedContaminated ?? 0) + T.TEASED_CONTAMINATED_SCANDAL;
      lines.push('The benchmark chart is being compared against the test sets. The comparison is not going well.');
    }
  }
  if (m.leakedDay !== undefined) {
    s.company.hype = clamp(s.company.hype - T.LEAK_RELEASE_HYPE_CUT, 0, 100);
    lines.push(`The weights for ${name} leaked first, so the launch is old news. Hype -${T.LEAK_RELEASE_HYPE_CUT}.`);
  }
  return lines;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

/** Finished benchmark jobs land their readings and announce them. */
function settleBenchJobs(s: GameState, m: Model, rng: Rng): void {
  const jobs = m.benchJobs ?? [];
  if (jobs.length === 0) return;
  const done = jobs.filter((j) => j.doneDay <= s.day);
  if (done.length === 0) return;
  m.benchJobs = jobs.filter((j) => j.doneDay > s.day);
  const runs = { ...(m.benchRuns ?? {}) };
  let fresh = 0;
  let sota = 0;
  for (const job of done) {
    for (const id of job.benchIds) {
      const truth = m.benchmarks?.[id];
      if (truth === undefined || runs[id]) continue;
      const score = measure(truth, rng);
      runs[id] = { day: s.day, score };
      fresh += 1;
      if (beatsPublic(s, id, score)) sota += 1;
    }
  }
  m.benchRuns = runs;
  if (fresh === 0) return;
  const tail = sota > 0 ? `, ${sota} unannounced SOTA${sota === 1 ? '' : 's'}` : '';
  notify(s, `Evals for ${codenameOf(m)}: ${fresh} new result${fresh === 1 ? '' : 's'}${tail}.`, sota > 0 ? 'good' : 'info');
}

/** Internal arena finishes: a noisy Elo reading, and a small chance the screenshots leak. */
function settleArena(s: GameState, m: Model, rng: Rng): void {
  const a = m.arena;
  if (!a || a.elo !== undefined || s.day < a.doneDay) return;
  const elo = Math.round(m.elo + rng.normal(0, T.ARENA_BAND));
  m.arena = { doneDay: a.doneDay, elo, band: T.ARENA_BAND };
  notify(s, `Internal arena for ${codenameOf(m)}: about ${elo} Elo, give or take ${T.ARENA_BAND}.`, 'info');
  if (rng.chance(T.ARENA_SCREENSHOT_CHANCE)) {
    s.company.hype = clamp(s.company.hype + T.ARENA_SCREENSHOT_HYPE, 0, 100);
    pushNews(s, `Screenshots of ${codenameOf(m)}'s arena results are going round. Nobody inside will say whether they are real.`, 'info');
  }
}

/** The weights leak: news, a hype bump, a reputation hit and a boost for rivals. */
function rollLeak(s: GameState, m: Model, rng: Rng): void {
  const p = leakChance(s, m);
  if (p <= 0 || !rng.chance(p)) return;
  m.leakedDay = s.day;
  const name = codenameOf(m);
  s.company.hype = clamp(s.company.hype + T.LEAK_HYPE, 0, 100);
  s.company.reputation = clamp(s.company.reputation + T.LEAK_REP, 0, 100);
  s.flags.leakBoost = (s.flags.leakBoost ?? 0) + T.LEAK_BOOST;
  pushNews(s, `Weights for ${name} appear on a torrent site.`, 'bad');
  notify(s, `Weights for ${name} are on a torrent site. We are not commenting.`, 'bad');
}

/** Daily vault bookkeeping: benchmark jobs, arena readings, and the leak roll. Runs after labTick, before releaseTick. */
export function vaultTick(s: GameState, rng: Rng): void {
  for (const m of s.models) {
    if (m.deprecated) continue;
    settleBenchJobs(s, m, rng);
    settleArena(s, m, rng);
  }
  for (const m of s.models) rollLeak(s, m, rng);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const handlers: ActionHandlers = {
  runBenchmarks: (s, a) => {
    const m = modelById(s, a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is public, so its benchmarks are already out.`, 'info');
      return;
    }
    const year = calendarYear(s.day);
    const busy = new Set(benchPending(m));
    const measured = m.benchRuns ?? {};
    const ids = [...new Set(a.benchIds)].filter((id) => {
      const def = benchmarkById(id);
      return !!def && def.year <= year && m.benchmarks?.[id] !== undefined && !measured[id] && !busy.has(id);
    });
    if (ids.length === 0) {
      notify(s, `Nothing new to measure on ${codenameOf(m)}.`, 'info');
      return;
    }
    const cost = benchCostOf(s, m) * ids.length;
    if (!trySpend(s, 'compute', cost, `evals for ${codenameOf(m)}`)) return;
    const days = T.BENCH_DAYS_BASE + ids.length;
    m.benchJobs = [...(m.benchJobs ?? []), { benchIds: ids, doneDay: s.day + days }];
    notify(s, `Evals for ${codenameOf(m)} started: ${ids.length} benchmark${ids.length === 1 ? '' : 's'}, results in ${days} days.`, 'info');
  },

  internalArena: (s, a) => {
    const m = modelById(s, a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is public. The arena is for things nobody has seen yet.`, 'info');
      return;
    }
    if (m.arena) {
      notify(s, `${codenameOf(m)} is already in the arena${m.arena.elo === undefined ? '' : ' (results are in)'}.`, 'info');
      return;
    }
    const q = arenaQuote(s);
    if (!trySpend(s, 'compute', q.cost, `the internal arena for ${codenameOf(m)}`)) return;
    m.arena = { doneDay: s.day + q.days };
    notify(s, `Internal arena for ${codenameOf(m)} is running: results in ${q.days} days.`, 'info');
  },

  teaseModel: (s, a) => {
    const m = modelById(s, a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    const opt = teaseOptions(s, m).find((o) => o.level === a.level);
    if (!opt) return;
    if (!opt.available) {
      notify(s, opt.reason ?? 'Not yet.', 'bad');
      return;
    }
    s.company.hype = clamp(s.company.hype + opt.hype, 0, 100);
    if (a.level === 'hype') s.market.aiHype = clamp(s.market.aiHype + T.TEASE_HYPE_AI, 0, 100);
    m.teased = { day: s.day, level: a.level, expected: opt.expected };
    const line = TEASE_COPY[a.level].replace('{company}', s.company.name).replace('{codename}', codenameOf(m));
    pushNews(s, line, 'info');
    notify(s, `Teaser out for ${codenameOf(m)}. Expectations are now a line item.`, 'info');
  },

  pokeModel: (s, a, rng) => {
    const m = modelById(s, a.modelId);
    if (!m) return;
    const today = m.pokes?.day === s.day ? m.pokes.count : 0;
    m.pokes = { day: s.day, count: today + 1 };
    if (today >= T.POKE_CHANCE_LIMIT) return;
    if (!rng.chance(T.POKE_CHANCE)) return;
    const latent = m.latentQuirks ?? [];
    if (latent.length === 0) return;
    const q = rng.pick(latent);
    m.latentQuirks = latent.filter((x) => x !== q);
    m.quirks = [...(m.quirks ?? []), q];
    const def = quirkById(q);
    const kind = def?.good === true ? 'good' : 'bad';
    const text = `You noticed something while testing ${codenameOf(m)}: ${def?.name ?? q}.`;
    notify(s, text, kind);
    pushNews(s, text, kind);
  },
};
