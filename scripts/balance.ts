// Balance report: runs the scripted strategy bots over several seeds, prints a comparison table and checks the design
// goals of GAME_DESIGN §18.2 and §19 (PASS/FAIL lines). Checks use the median across seeds.
//
// Usage:
//   npx tsx scripts/balance.ts --all [--years=20] [--seeds=7,11,23,31,42,57]
//   npx tsx scripts/balance.ts --strategy=small|frontier|specialist|open|idle [--years=N] [--seeds=...]
//   npx tsx scripts/balance.ts [years] [seeds] [--idle]        (legacy positional form: frontier, or idle with --idle)
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import type { GameState, WeightClass } from '../src/sim/types';
import { calendarYear, formatMoney, yearOf } from '../src/sim/util';
import { frontierQuality } from '../src/sim/systems/market';
import { headcount } from '../src/sim/systems/staff';
import { botDay, BOT_STRATEGIES, type BotStrategy } from './bot';

type Strategy = BotStrategy | 'idle';
const ALL_RUNS: Strategy[] = [...BOT_STRATEGIES, 'idle'];
const DEFAULT_YEARS = 20;
const DEFAULT_SEEDS = [7, 11, 23, 31, 42, 57];
const TRILLION = 1e12;
const WEIGHT_CLASSES: WeightClass[] = ['nano', 'small', 'medium', 'open'];

/** Everything measured in one run (one strategy, one seed). Days are sim days from the start; null means never. */
interface Run {
  seed: number;
  yearsRun: number;
  profitableDay: number | null;
  ipoDay: number | null;
  trillionDay: number | null;
  bankruptDay: number | null;
  peakVal: number;
  valEnd: number;
  maxStaff: number;
  crownsEnd: number;
  crownsByClass: Record<WeightClass, number>;
  activeContractsEnd: number;
  contractShare: number;
  bestEnd: number;
  first95Day: number | null;
  /** Largest best-released overall minus the frontier, sampled every 182 days before 2020. */
  maxGap1719: number | null;
  /** Calendar year -> the player held a nano or small crown in a sample of that year. */
  nanoSmallYears: Record<number, boolean>;
  /** Ticks where the sim did not advance (blocked by a pending prompt the bot did not clear). */
  blockedTicks: number;
}

function bestReleasedOverall(s: GameState): number {
  return s.models.reduce((b, m) => (m.releasedDay !== null && !m.deprecated ? Math.max(b, m.overall) : b), 0);
}

function runOne(strategy: Strategy, seed: number, years: number): Run {
  const s: GameState = createInitialState(seed, 'BotCorp');
  const totalDays = years * 365;
  const run: Run = {
    seed,
    yearsRun: 0,
    profitableDay: null,
    ipoDay: null,
    trillionDay: null,
    bankruptDay: null,
    peakVal: 0,
    valEnd: 0,
    maxStaff: 0,
    crownsEnd: 0,
    crownsByClass: { nano: 0, small: 0, medium: 0, open: 0 },
    activeContractsEnd: 0,
    contractShare: 0,
    bestEnd: 0,
    first95Day: null,
    maxGap1719: null,
    nanoSmallYears: {},
    blockedTicks: 0,
  };
  let profitStreak = 0;
  let wasPublic = false;
  let contractRev = 0;
  let totalRev = 0;
  const cap = totalDays * 4;
  for (let iter = 0; s.day < totalDays && !s.gameOver && iter < cap; iter++) {
    const before = s.day;
    botDay(s, strategy === 'idle', strategy === 'idle' ? 'frontier' : strategy);
    tick(s);
    if (s.day === before) {
      run.blockedTicks += 1;
      continue;
    }
    for (const [k, v] of Object.entries(s.finance.today.revenue)) {
      totalRev += v;
      if (k === 'contracts') contractRev += v;
    }
    // "Profitable" = revenue above expenses for 60 days straight, so one lucky day does not count.
    profitStreak = s.finance.dailyRevenue > s.finance.dailyExpenses ? profitStreak + 1 : 0;
    if (run.profitableDay === null && profitStreak >= 60) run.profitableDay = s.day - 59;
    if (!wasPublic && s.company.isPublic) {
      run.ipoDay = s.day;
      wasPublic = true;
    }
    if (run.trillionDay === null && s.finance.valuation >= TRILLION) run.trillionDay = s.day;
    run.peakVal = Math.max(run.peakVal, s.finance.valuation);
    run.maxStaff = Math.max(run.maxStaff, headcount(s));
    if (s.day % 7 === 0 && run.first95Day === null && bestReleasedOverall(s) >= 95) run.first95Day = s.day;
    if (s.day % 182 === 0 && yearOf(s.day) < 2020) {
      const gap = bestReleasedOverall(s) - frontierQuality(yearOf(s.day));
      run.maxGap1719 = run.maxGap1719 === null ? gap : Math.max(run.maxGap1719, gap);
    }
    if (s.day % 30 === 0) {
      const year = calendarYear(s.day);
      const ns = (s.classes?.crowns ?? []).some((c) => c.holder === 'player' && (c.weightClass === 'nano' || c.weightClass === 'small'));
      if (ns) run.nanoSmallYears[year] = true;
    }
  }
  run.yearsRun = s.day / 365.25;
  if (s.gameOver) run.bankruptDay = s.day;
  run.valEnd = s.finance.valuation;
  const crowns = (s.classes?.crowns ?? []).filter((c) => c.holder === 'player');
  run.crownsEnd = crowns.length;
  for (const c of crowns) run.crownsByClass[c.weightClass] += 1;
  run.activeContractsEnd = s.contracts?.active.length ?? 0;
  run.contractShare = totalRev > 0 ? contractRev / totalRev : 0;
  run.bestEnd = bestReleasedOverall(s);
  return run;
}

// ---------------------------------------------------------------------------
// Statistics and formatting
// ---------------------------------------------------------------------------

type Num = number | null;

/** Median over the seeds that reached the value (null when none did). */
function medianOf(vals: Num[]): number | null {
  const got = vals.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (got.length === 0) return null;
  const mid = got.length >> 1;
  return got.length % 2 ? got[mid] : (got[mid - 1] + got[mid]) / 2;
}

/** Median where a null (never) counts as infinitely late: null when the median is never. */
function medianOrNever(vals: Num[]): number | null {
  const sorted = vals.map((v) => (v === null ? Infinity : v)).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Number.isFinite(m) ? m : null;
}

function rangeOf(vals: Num[]): { min: number | null; max: number | null } {
  const got = vals.filter((v): v is number => v !== null);
  if (got.length === 0) return { min: null, max: null };
  return { min: Math.min(...got), max: Math.max(...got) };
}

const yearOfDay = (day: number | null): string => (day === null ? 'never' : yearOf(day).toFixed(1));
const yearOfDayNum = (day: number | null): number | null => (day === null ? null : yearOf(day));
const moneyOf = (v: number | null): string => (v === null ? '-' : formatMoney(v));

/** "median (min..max)" for one metric column; `reached` is shown when some seeds never got there. */
function cell(vals: Num[], fmt: (v: number) => string): string {
  const med = medianOf(vals);
  if (med === null) return 'never';
  const r = rangeOf(vals);
  const reached = vals.filter((v) => v !== null).length;
  const base = `${fmt(med)} (${fmt(r.min!)}..${fmt(r.max!)})`;
  return reached < vals.length ? `${base} ${reached}/${vals.length}` : base;
}

/** Metric rows of the comparison table. `better` is the direction used for the dominance check. */
interface Metric {
  label: string;
  values: (r: Run) => Num;
  fmt: (v: number) => string;
  better?: 'low' | 'high';
}

const METRICS: Metric[] = [
  { label: 'profitable (60d streak)', values: (r) => r.profitableDay, fmt: (v) => yearOf(v).toFixed(1), better: 'low' },
  { label: 'IPO', values: (r) => r.ipoDay, fmt: (v) => yearOf(v).toFixed(1), better: 'low' },
  { label: '$1T valuation', values: (r) => r.trillionDay, fmt: (v) => yearOf(v).toFixed(1), better: 'low' },
  { label: 'bankrupt (day)', values: (r) => r.bankruptDay, fmt: (v) => yearOf(v).toFixed(1) },
  { label: 'peak valuation', values: (r) => r.peakVal, fmt: (v) => formatMoney(v), better: 'high' },
  { label: 'valuation at end', values: (r) => r.valEnd, fmt: (v) => formatMoney(v), better: 'high' },
  { label: 'max staff', values: (r) => r.maxStaff, fmt: (v) => v.toFixed(0) },
  { label: 'crowns held at end', values: (r) => r.crownsEnd, fmt: (v) => v.toFixed(0), better: 'high' },
  { label: 'active contracts at end', values: (r) => r.activeContractsEnd, fmt: (v) => v.toFixed(0), better: 'high' },
  { label: 'contract revenue share', values: (r) => r.contractShare, fmt: (v) => `${(v * 100).toFixed(1)}%`, better: 'high' },
  { label: 'best overall at end', values: (r) => r.bestEnd, fmt: (v) => v.toFixed(1), better: 'high' },
  { label: 'first best overall >= 95', values: (r) => r.first95Day, fmt: (v) => yearOf(v).toFixed(1) },
  { label: 'maxGap 2017-19 (pts)', values: (r) => r.maxGap1719, fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1) },
];

function bankruptCount(runs: Run[]): string {
  const n = runs.filter((r) => r.bankruptDay !== null).length;
  return `${n}/${runs.length}`;
}

function crownsByClassLine(runs: Run[]): string {
  return WEIGHT_CLASSES.map((c) => `${c} ${medianOf(runs.map((r) => r.crownsByClass[c])) ?? 0}`).join(' · ');
}

/** Fraction of calendar years from 2022 on in which the player held a nano or small crown. */
function nanoSmallShare(r: Run): number | null {
  const endYear = Math.floor(2017 + r.yearsRun);
  let years = 0;
  let held = 0;
  for (let y = 2022; y <= endYear; y++) {
    years += 1;
    if (r.nanoSmallYears[y]) held += 1;
  }
  return years ? held / years : null;
}

// ---------------------------------------------------------------------------
// Design goals
// ---------------------------------------------------------------------------

interface Check {
  label: string;
  /** true = PASS, false = FAIL, null = not checked (strategy not run or run too short). */
  pass: boolean | null;
  detail: string;
}

function inYears(year: number | null, lo: number, hi: number): boolean {
  return year !== null && year >= lo && year < hi;
}

/** The strategy that is best (leads) for each comparable column, by median. */
function leaders(byStrategy: Map<Strategy, Run[]>, metric: Metric): Strategy[] {
  const entries = [...byStrategy.entries()].filter(([s]) => s !== 'idle');
  const score = (runs: Run[]) => {
    const med = medianOrNever(runs.map((r) => metric.values(r) ?? null));
    if (metric.better === 'low') return med ?? Infinity;
    return med ?? -Infinity;
  };
  const scored = entries.map(([s, runs]) => ({ s, v: score(runs) }));
  const best = metric.better === 'low' ? Math.min(...scored.map((x) => x.v)) : Math.max(...scored.map((x) => x.v));
  return scored.filter((x) => x.v === best).map((x) => x.s);
}

function designChecks(byStrategy: Map<Strategy, Run[]>): Check[] {
  const out: Check[] = [];
  const runsOf = (s: Strategy) => byStrategy.get(s);
  const yearWord = (year: number | null) => (year === null ? 'never' : year.toFixed(1));

  // §18.2 (frontier)
  const fr = runsOf('frontier');
  if (fr) {
    const p = yearOfDayNum(medianOrNever(fr.map((r) => r.profitableDay)));
    out.push({ label: '§18.2 first profitability 2020-2021 (frontier)', pass: inYears(p, 2020, 2022), detail: `median ${yearWord(p)}` });
    const ipo = yearOfDayNum(medianOrNever(fr.map((r) => r.ipoDay)));
    out.push({ label: '§18.2 IPO 2022-2025 (frontier)', pass: inYears(ipo, 2022, 2026), detail: `median ${yearWord(ipo)}` });
    const tr = yearOfDayNum(medianOrNever(fr.map((r) => r.trillionDay)));
    // yearsRun is days / 365.25, so a 20-year run ends at 19.99.
    const long = fr.every((r) => r.yearsRun >= 19.9);
    out.push({
      label: '§18.2 $1T 2032-2036 (frontier, needs 20 years)',
      pass: long ? inYears(tr, 2032, 2037) : null,
      detail: long ? `median ${yearWord(tr)}` : `run too short (${Math.min(...fr.map((r) => r.yearsRun)).toFixed(1)}y), rerun with --years=20`,
    });
    const gap = medianOrNever(fr.map((r) => r.maxGap1719));
    out.push({
      label: '§18.2 early gap <= +5 (frontier, 2017-19)',
      pass: gap === null ? null : gap <= 5,
      detail: `median ${gap === null ? 'n/a' : (gap >= 0 ? '+' : '') + gap.toFixed(1)}, max ${rangeOf(fr.map((r) => r.maxGap1719)).max?.toFixed(1) ?? 'n/a'}`,
    });
  } else {
    out.push({ label: '§18.2 frontier checks', pass: null, detail: 'frontier not run' });
  }
  const idle = runsOf('idle');
  if (idle) {
    const bk = idle.map((r) => r.bankruptDay);
    const allBroke = bk.every((d) => d !== null);
    const med = medianOrNever(bk);
    const yrs = med === null ? null : med / 365.25;
    out.push({
      label: '§18.2 idle bankrupt within 2-3 years',
      pass: allBroke && yrs !== null && yrs >= 2 && yrs <= 3,
      detail: `${bankruptCount(idle)} bankrupt, median ${yrs === null ? 'never' : yrs.toFixed(1) + 'y'}`,
    });
  } else {
    out.push({ label: '§18.2 idle bankrupt within 2-3 years', pass: null, detail: 'idle not run' });
  }

  // §19
  for (const s of ['small', 'specialist'] as const) {
    const runs = runsOf(s);
    if (!runs) {
      out.push({ label: `§19 ${s} profitable by 2021-2022`, pass: null, detail: `${s} not run` });
      continue;
    }
    const p = yearOfDayNum(medianOrNever(runs.map((r) => r.profitableDay)));
    out.push({ label: `§19 ${s} profitable by 2021-2022`, pass: p !== null && p < 2023, detail: `median ${yearWord(p)}` });
  }
  const small = runsOf('small');
  if (small) {
    const shares = small.map(nanoSmallShare).filter((x): x is number => x !== null);
    const med = shares.length ? medianOf(shares) : null;
    out.push({
      label: '§19 small holds a nano/small crown in most years from 2022',
      pass: med === null ? null : med > 0.5,
      detail: `median share of years ${med === null ? 'n/a' : (med * 100).toFixed(0) + '%'}`,
    });
  } else {
    out.push({ label: '§19 small holds a nano/small crown in most years from 2022', pass: null, detail: 'small not run' });
  }
  const spec = runsOf('specialist');
  if (spec) {
    const crowns = medianOf(spec.map((r) => r.crownsEnd));
    out.push({ label: '§19 specialist holds >= 2 crowns', pass: crowns !== null && crowns >= 2, detail: `median ${crowns ?? 0} at end, ${crownsByClassLine(spec)}` });
  } else {
    out.push({ label: '§19 specialist holds >= 2 crowns', pass: null, detail: 'specialist not run' });
  }

  // No strategy dominates every column (idle is a baseline and does not count).
  const contested = METRICS.filter((m) => m.better !== undefined);
  if (BOT_STRATEGIES.every((s) => runsOf(s))) {
    const lead = new Map<Strategy, string[]>();
    for (const m of contested) for (const s of leaders(byStrategy, m)) lead.set(s, [...(lead.get(s) ?? []), m.label]);
    const dominant = BOT_STRATEGIES.filter((s) => (lead.get(s) ?? []).length === contested.length);
    out.push({
      label: '§19 no strategy dominates every column',
      pass: dominant.length === 0,
      detail: dominant.length ? `${dominant.join(', ')} lead every column` : `most columns led by: ${[...lead.entries()].map(([s, ls]) => `${s} ${ls.length}`).join(', ')}`,
    });
  } else {
    out.push({ label: '§19 no strategy dominates every column', pass: null, detail: 'needs all four strategies (use --all)' });
  }

  // Overall must not saturate early.
  const firsts = BOT_STRATEGIES.filter((s) => runsOf(s)).map((s) => [s, yearOfDayNum(medianOrNever(runsOf(s)!.map((r) => r.first95Day)))] as const);
  if (firsts.length) {
    const early = firsts.filter(([, y]) => y !== null && y < 2027);
    out.push({
      label: '§19 overall does not saturate (best >= 95 not before 2027)',
      pass: early.length === 0,
      detail: firsts.map(([s, y]) => `${s} ${yearWord(y)}`).join(', '),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printComparison(byStrategy: Map<Strategy, Run[]>, years: number): void {
  const names = [...byStrategy.keys()];
  console.log(`\nBALANCE ${years}y, ${byStrategy.get(names[0])!.length} seeds: median (min..max)`);
  const colW = 30;
  console.log(['metric'.padEnd(26), ...names.map((n) => n.padEnd(colW))].join(' '));
  for (const m of METRICS) {
    const row = [m.label.padEnd(26)];
    for (const n of names) {
      const runs = byStrategy.get(n)!;
      row.push(cell(runs.map((r) => m.values(r) ?? null), m.fmt).padEnd(colW));
    }
    console.log(row.join(' '));
  }
  const bankRow = ['bankrupt (seeds)'.padEnd(26), ...names.map((n) => bankruptCount(byStrategy.get(n)!).padEnd(colW))];
  console.log(bankRow.join(' '));
  const cr = ['crowns by class (median)'.padEnd(26), ...names.map((n) => crownsByClassLine(byStrategy.get(n)!).padEnd(colW))];
  console.log(cr.join(' '));
  const nsr = ['nano/small crown years'.padEnd(26), ...names.map((n) => {
    const v = byStrategy.get(n)!.map(nanoSmallShare);
    const med = medianOf(v);
    return (med === null ? '-' : `${(med * 100).toFixed(0)}% of years from 2022`).padEnd(colW);
  })];
  console.log(nsr.join(' '));
  const blocked = [...byStrategy.entries()].reduce((a, [, runs]) => a + runs.reduce((b, r) => b + r.blockedTicks, 0), 0);
  console.log(`blocked ticks (sim did not advance): ${blocked}`);
}

function printPerSeed(strategy: Strategy, runs: Run[]): void {
  console.log(`\n--- ${strategy}: per seed ---`);
  console.log(['seed', 'profitable', 'IPO', '$1T', 'bankrupt', 'peakVal', 'valEnd', 'maxStaff', 'crowns', 'contracts', 'contrShare', 'bestEnd', 'first>=95', 'gap17-19'].join('\t'));
  for (const r of runs) {
    console.log(
      [
        r.seed,
        yearOfDay(r.profitableDay),
        yearOfDay(r.ipoDay),
        yearOfDay(r.trillionDay),
        r.bankruptDay === null ? '-' : yearOfDay(r.bankruptDay),
        moneyOf(r.peakVal),
        moneyOf(r.valEnd),
        r.maxStaff,
        r.crownsEnd,
        r.activeContractsEnd,
        `${(r.contractShare * 100).toFixed(1)}%`,
        r.bestEnd.toFixed(1),
        yearOfDay(r.first95Day),
        r.maxGap1719 === null ? '-' : (r.maxGap1719 >= 0 ? '+' : '') + r.maxGap1719.toFixed(1),
      ].join('\t'),
    );
  }
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags.set(k, v ?? 'true');
    } else positional.push(a);
  }
  const years = Number(flags.get('years') ?? positional[0] ?? DEFAULT_YEARS);
  const seedsRaw = flags.get('seeds') ?? positional[1];
  const seeds = seedsRaw ? seedsRaw.split(',').map(Number) : DEFAULT_SEEDS;
  let strategies: Strategy[];
  if (flags.has('all')) strategies = ALL_RUNS;
  else if (flags.has('strategy')) strategies = [flags.get('strategy') as Strategy];
  else if (flags.has('idle')) strategies = ['idle'];
  else strategies = ['frontier'];
  for (const s of strategies) {
    if (!ALL_RUNS.includes(s)) throw new Error(`Unknown strategy "${s}". Use one of: ${ALL_RUNS.join(', ')}.`);
  }
  return { years, seeds, strategies, all: flags.has('all') };
}

function main(): void {
  const { years, seeds, strategies, all } = parseArgs(process.argv.slice(2));
  const byStrategy = new Map<Strategy, Run[]>();
  const t0 = Date.now();
  for (const strategy of strategies) {
    const t1 = Date.now();
    const runs = seeds.map((seed) => runOne(strategy, seed, years));
    byStrategy.set(strategy, runs);
    console.log(`${strategy}: ${seeds.length} seeds x ${years}y in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!all && strategies.length === 1) printPerSeed(strategies[0], byStrategy.get(strategies[0])!);
  printComparison(byStrategy, years);
  if (all) {
    console.log('\nDESIGN GOALS (median across seeds)');
  } else {
    console.log('\nDESIGN GOALS (strategies not run are skipped)');
  }
  for (const c of designChecks(byStrategy)) {
    const tag = c.pass === null ? 'SKIP' : c.pass ? 'PASS' : 'FAIL';
    console.log(`${tag}  ${c.label}: ${c.detail}`);
  }
}

main();
