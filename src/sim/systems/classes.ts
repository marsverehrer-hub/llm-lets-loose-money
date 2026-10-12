// OWNER: CLASSES. v8 playstyles (GAME_DESIGN §19.2): weight classes, class crowns, rival small and medium lines,
// the class arena and benchmark-targeted bench tuning. The exported signatures are a contract that contracts and
// market code build against; keep them. Weight-class tables live in data/weightClasses.ts (re-exported here).
import type {
  ActionHandlers,
  BenchmarkCategory,
  BenchmarkDef,
  Capabilities,
  ClassCrown,
  ClassesState,
  Competitor,
  GameState,
  Id,
  Model,
  Personality,
  RivalLineModel,
  Rng,
  WeightClass,
} from '../types';
import { CAP_IDS } from '../types';
import {
  activeBenchmarks,
  benchmarkById,
  benchmarkResult,
  benchmarkTable,
  clampCaps,
  competitorModelCaps,
  evaluateModel,
  isSaturated,
  overallScore,
  rivalFlagshipActiveB,
  scoresFromCaps,
} from './capabilities';
import { CLASS_RANK, classThresholds, classGap } from '../data/weightClasses';
import { LINE_NEWS, LINE_SCHEDULE, lineName, type LineClass } from '../data/rivalLines';
import { getBonuses } from '../bonuses';
import { labInfo, labName } from './labs';
import { measure } from './vault';
import { calendarYear, clamp, formatMoney, newId, notify, pushNews, trySpend } from '../util';

export { classGap, classThresholds, frontierActiveParamsB, rivalActiveParamsB } from '../data/weightClasses';

export const WEIGHT_CLASSES: WeightClass[] = ['nano', 'small', 'medium', 'open'];
const LINE_CLASSES: LineClass[] = ['nano', 'small', 'medium'];
const SHAPED_QUIRK = 'benchmark_shaped';

/** Every tunable for classes, crowns, lines and tuning. Change numbers here, not in the logic. */
export const CLASS_TUNING = {
  /** Crowns are recomputed weekly. */
  CROWN_EVERY_DAYS: 7,
  /** A rival line is rebuilt when its flagship changes, and at least this often. */
  LINE_REFRESH_DAYS: 180,
  /** Line active size as a share of its class threshold. */
  LINE_ACTIVE_MIN: 0.6,
  LINE_ACTIVE_MAX: 0.9,
  /** Per-capability noise on a line (SD, points). */
  LINE_CAP_NOISE: 1.2,
  /** Open and price labs get this many points less gap. */
  LINE_GAP_BONUS_OPEN_PRICE: 2,
  /** First player crown per benchmark and class. */
  CROWN_BRAND: 1,
  CROWN_HYPE: 1.5,
  /** Latent quirk "benchmark_shaped": Elo lost when it is found. */
  SHAPED_ELO_PENALTY: 10,
  /** Chance a bench tune leaves the quirk behind. */
  SHAPED_CHANCE: 0.1,
  /** Bench tuning: days, cost base ($) and growth per year, reference year, and the cap effect. */
  TUNE_DAYS: 12,
  TUNE_COST_BASE: 30_000,
  TUNE_YEAR_GROWTH: 0.15,
  TUNE_BASE_YEAR: 2017,
  TUNE_GAIN_MEAN: 6,
  TUNE_GAIN_SD: 2.5,
  TUNE_OTHER_PENALTY: 1,
  /** Rival crown changes that make news per crown pass (the player's always do). */
  RIVAL_CROWN_NEWS_PER_PASS: 3,
  /** Diminishing returns on repeat tunes of one benchmark: 1st, 2nd, 3rd and later. */
  TUNE_MULTS: [1, 0.5, 0.25],
  /** Elo per point of overall, the same mapping rivals use (800 + overall * 8). */
  ELO_PER_OVERALL: 8,
};
const T = CLASS_TUNING;

// ---------------------------------------------------------------------------
// classes
// ---------------------------------------------------------------------------

/** Smallest class a model of this active size belongs to (it also competes in every larger class). */
export function classOf(year: number, activeParamsB: number): WeightClass {
  const t = classThresholds(year);
  if (activeParamsB <= t.nano) return 'nano';
  if (activeParamsB <= t.small) return 'small';
  if (activeParamsB <= t.medium) return 'medium';
  return 'open';
}

/** A model of class `entrant` competes in contest `contest` when it is that class or smaller. */
function competesIn(contest: WeightClass, entrant: WeightClass): boolean {
  return CLASS_RANK[entrant] <= CLASS_RANK[contest];
}

function clsLabel(cls: WeightClass): string {
  return cls === 'open' ? 'open-class' : cls;
}

export function ensureClasses(s: GameState): ClassesState {
  s.classes ??= { crowns: [], rivalLines: {}, benchTunes: [] };
  return s.classes;
}

/** Rival small/medium lines currently on the market (excludes human competitors). */
export function rivalLines(s: GameState): RivalLineModel[] {
  return Object.values(s.classes?.rivalLines ?? {});
}

/** True if the player currently holds a crown (any class) on one of these benchmarks. */
export function playerHoldsCrown(s: GameState, benchIds: Id[]): boolean {
  return (s.classes?.crowns ?? []).some((c) => c.holder === 'player' && benchIds.includes(c.benchId));
}

/** Player crown counts by benchmark category: distinct benchmarks where the player holds a crown in any class. Efficiency benchmarks count as 'efficiency'. */
export function playerCrownCounts(s: GameState): Partial<Record<BenchmarkCategory | 'efficiency', number>> {
  const out: Partial<Record<BenchmarkCategory | 'efficiency', number>> = {};
  const seen = new Set<Id>();
  for (const c of s.classes?.crowns ?? []) {
    if (c.holder !== 'player' || seen.has(c.benchId)) continue;
    seen.add(c.benchId);
    const def = benchmarkById(c.benchId);
    if (!def) continue;
    const key = def.efficiency !== undefined ? 'efficiency' : def.category;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// entrants and the class arena
// ---------------------------------------------------------------------------

/** One released model in the class contests: the player's, a rival flagship or a rival line. */
interface Entrant {
  holder: Id;
  modelId: Id | null;
  isLine: boolean;
  name: string;
  cls: WeightClass;
  activeParamsB: number;
  overall: number;
  elo: number;
  benchmarks: Record<Id, number>;
}

function entrants(s: GameState): Entrant[] {
  const year = calendarYear(s.day);
  const out: Entrant[] = [];
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated || !m.benchmarks) continue;
    const act = m.activeParamsB ?? m.paramsB;
    out.push({ holder: 'player', modelId: m.id, isLine: false, name: m.name, cls: classOf(year, act), activeParamsB: act, overall: m.overall, elo: m.elo, benchmarks: m.benchmarks });
  }
  for (const c of s.competitors) {
    if (!c.active || c.human || !c.model?.benchmarks) continue;
    const act = rivalFlagshipActiveB(c);
    out.push({ holder: c.id, modelId: null, isLine: false, name: c.model.name, cls: classOf(year, act), activeParamsB: act, overall: c.model.overall, elo: c.model.elo, benchmarks: c.model.benchmarks });
  }
  for (const line of rivalLines(s)) {
    out.push({
      holder: line.labId,
      modelId: null,
      isLine: true,
      name: line.name,
      cls: classOf(year, line.activeParamsB),
      activeParamsB: line.activeParamsB,
      overall: line.overall,
      elo: line.elo,
      benchmarks: line.benchmarks ?? {},
    });
  }
  return out;
}

export interface ClassArenaRow {
  name: string;
  holder: Id;
  elo: number;
  overall: number;
  activeParamsB: number;
  weightClass: WeightClass;
}

/** Elo leaderboard for one class: every released model that competes in it (its own class and smaller), best first. */
export function classArena(s: GameState, cls: WeightClass): ClassArenaRow[] {
  return entrants(s)
    .filter((e) => competesIn(cls, e.cls))
    .map((e) => ({ name: e.name, holder: e.holder, elo: e.elo, overall: e.overall, activeParamsB: e.activeParamsB, weightClass: e.cls }))
    .sort((a, b) => b.elo - a.elo);
}

/** One row of a class leaderboard for a benchmark. */
export interface ClassBenchRow {
  labId: Id;
  lab: string;
  modelId: Id | null;
  modelName: string;
  score: number;
  isPlayer: boolean;
  /** A rival small or medium line, not a flagship. */
  isLine: boolean;
  activeParamsB: number;
  weightClass: WeightClass;
}

/** Scores on one benchmark for every released model that competes in the class, rival lines included. Best first. */
export function classBenchRows(s: GameState, benchId: Id, cls: WeightClass): ClassBenchRow[] {
  const rows: ClassBenchRow[] = [];
  for (const e of entrants(s)) {
    if (!competesIn(cls, e.cls)) continue;
    const score = e.benchmarks[benchId];
    if (score === undefined) continue;
    const isPlayer = e.holder === 'player';
    rows.push({
      labId: e.holder,
      lab: isPlayer ? s.company.name : labName(s, e.holder),
      modelId: e.modelId,
      modelName: e.name,
      score,
      isPlayer,
      isLine: e.isLine,
      activeParamsB: e.activeParamsB,
      weightClass: e.cls,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** The current crown on one benchmark in one class, if anyone holds it. */
export function crownOf(s: GameState, benchId: Id, cls: WeightClass): ClassCrown | undefined {
  return s.classes?.crowns.find((c) => c.benchId === benchId && c.weightClass === cls);
}

/** Weight class of a model right now (judged against the current frontier). */
export function weightClassOf(s: GameState, m: Model): WeightClass {
  return classOf(calendarYear(s.day), m.activeParamsB ?? m.paramsB);
}

// ---------------------------------------------------------------------------
// crowns
// ---------------------------------------------------------------------------

const crownKey = (benchId: Id, cls: WeightClass) => `${benchId}|${cls}`;

/** Recomputes every crown and reports the changes. The first pass of a game is silent apart from the player. */
function recomputeCrowns(s: GameState): void {
  const cs = ensureClasses(s);
  const ents = entrants(s);
  const prior = new Map(cs.crowns.map((c) => [crownKey(c.benchId, c.weightClass), c] as const));
  const quiet = !s.flags.crownsSeeded;
  const budget = { rivalNews: T.RIVAL_CROWN_NEWS_PER_PASS };
  const next: ClassCrown[] = [];
  for (const def of activeBenchmarks(s)) {
    if (isSaturated(s, def.id)) continue;
    for (const cls of WEIGHT_CLASSES) {
      let best: Entrant | null = null;
      let bestScore = -Infinity;
      for (const e of ents) {
        if (!competesIn(cls, e.cls)) continue;
        const score = e.benchmarks[def.id];
        if (score === undefined) continue;
        if (score > bestScore || (score === bestScore && best !== null && e.overall > best.overall)) {
          best = e;
          bestScore = score;
        }
      }
      if (!best) continue;
      const old = prior.get(crownKey(def.id, cls));
      const crown: ClassCrown = { benchId: def.id, weightClass: cls, holder: best.holder, modelName: best.name, score: bestScore, sinceDay: s.day };
      if (old && old.holder === crown.holder && old.modelName === crown.modelName) {
        crown.sinceDay = old.sinceDay;
      } else {
        crownChanged(s, def, cls, crown, old, quiet, budget);
      }
      next.push(crown);
    }
  }
  cs.crowns = next;
  s.flags.crownsSeeded = 1;
}

function crownChanged(
  s: GameState,
  def: BenchmarkDef,
  cls: WeightClass,
  crown: ClassCrown,
  old: ClassCrown | undefined,
  quiet: boolean,
  budget: { rivalNews: number },
): void {
  if (crown.holder === 'player') {
    const text = `Your ${crown.modelName} takes the ${clsLabel(cls)} crown on ${def.name}.`;
    const key = `crownFirst.${def.id}.${cls}`;
    if (s.flags[key] === undefined) {
      s.flags[key] = s.day;
      s.company.brand = clamp(s.company.brand + T.CROWN_BRAND, 0, 100);
      s.company.hype = clamp(s.company.hype + T.CROWN_HYPE * (getBonuses(s).crownValue ?? 1), 0, 100);
      notify(s, text, 'milestone');
      pushNews(s, text, 'milestone');
    } else if (!quiet) {
      pushNews(s, text, 'good');
    }
    return;
  }
  if (quiet) return;
  if (old?.holder === 'player') {
    pushNews(s, `${crown.modelName} takes the ${clsLabel(cls)} crown on ${def.name} from ${old.modelName}.`, 'bad');
    return;
  }
  // Rival crowns are news only on the headline open-class leaderboards and on efficiency benchmarks, and only a few per pass.
  const notable = (def.headline && cls === 'open') || def.efficiency !== undefined;
  if (notable && budget.rivalNews > 0) {
    budget.rivalNews -= 1;
    pushNews(s, `${crown.modelName} takes the ${clsLabel(cls)} crown on ${def.name}.`, 'info');
  }
}

// ---------------------------------------------------------------------------
// rival lines
// ---------------------------------------------------------------------------

/** Builds a rival line from its lab's current flagship, shifted down by the class gap. */
function buildLine(s: GameState, c: Competitor, cls: LineClass, rng: Rng, year: number, personality: Personality): RivalLineModel {
  const flagship = c.model!;
  const activeParamsB = classThresholds(year)[cls] * rng.range(T.LINE_ACTIVE_MIN, T.LINE_ACTIVE_MAX);
  const bonus = personality === 'open' || personality === 'price' ? T.LINE_GAP_BONUS_OPEN_PRICE : 0;
  const gap = Math.max(0, classGap(cls, year) - bonus);
  const base = competitorModelCaps(c);
  const shifted = {} as Capabilities;
  for (const k of CAP_IDS) shifted[k] = base[k] - gap + rng.normal(0, T.LINE_CAP_NOISE);
  const caps = clampCaps(shifted);
  const scores = scoresFromCaps(caps);
  const overall = Math.round(overallScore(scores) * 10) / 10;
  return {
    labId: c.id,
    weightClass: cls,
    activeParamsB,
    name: lineName(c.id, cls, flagship.name, activeParamsB),
    scores,
    overall,
    elo: 800 + overall * T.ELO_PER_OVERALL,
    releasedDay: s.day,
    basedOnDay: flagship.releasedDay,
    caps,
    benchmarks: benchmarkTable(caps, year, null, activeParamsB),
  };
}

/** Each scheduled lab and class gets a line. It is rebuilt when the flagship changes and every LINE_REFRESH_DAYS. */
function refreshRivalLines(s: GameState, rng: Rng): void {
  const cs = ensureClasses(s);
  const year = calendarYear(s.day);
  for (const c of s.competitors) {
    const schedule = LINE_SCHEDULE[c.id];
    if (!schedule || !c.active || c.human || !c.model) continue;
    const info = labInfo(s, c.id);
    if (!info) continue;
    for (const cls of LINE_CLASSES) {
      const from = schedule[cls];
      if (from === undefined || year < from) continue;
      const key = `${c.id}:${cls}`;
      const cur = cs.rivalLines[key];
      const newFlagship = !cur || cur.basedOnDay !== c.model.releasedDay;
      if (!newFlagship && s.day - (cur?.releasedDay ?? 0) < T.LINE_REFRESH_DAYS) continue;
      const line = buildLine(s, c, cls, rng, year, info.personality);
      cs.rivalLines[key] = line;
      if (newFlagship) {
        const text = rng.pick(LINE_NEWS[cls]).replace('{lab}', info.name).replace('{model}', line.name).replace('{flagship}', c.model.name);
        pushNews(s, text, 'info');
      }
    }
  }
}

function syncBenchmarks(bench: Record<Id, number>, caps: Capabilities, activeParamsB: number, year: number, defs: BenchmarkDef[]): void {
  for (const def of defs) {
    if (def.efficiency !== undefined || bench[def.id] === undefined) {
      bench[def.id] = benchmarkResult(def, caps, false, { activeParamsB, year });
    }
  }
}

/**
 * Keeps rival benchmark numbers current. Fills benchmarks introduced since the last pass, and re-scores efficiency
 * benchmarks at each rival's active size (competitors.ts releases do not know the active size).
 */
function syncRivalBenchmarks(s: GameState): void {
  const year = calendarYear(s.day);
  const defs = activeBenchmarks(s);
  for (const c of s.competitors) {
    if (!c.active || c.human || !c.model) continue;
    c.model.benchmarks ??= {};
    syncBenchmarks(c.model.benchmarks, competitorModelCaps(c), rivalFlagshipActiveB(c), year, defs);
  }
  for (const line of rivalLines(s)) {
    if (!line.caps) continue;
    line.benchmarks ??= {};
    syncBenchmarks(line.benchmarks, line.caps, line.activeParamsB, year, defs);
  }
}

/** Latent quirk "benchmark_shaped": the Elo penalty lands once, when the quirk becomes visible. */
function applyShapedQuirks(s: GameState): void {
  for (const m of s.models) {
    if (!(m.quirks ?? []).includes(SHAPED_QUIRK)) continue;
    const key = `shaped.${m.id}`;
    if (s.flags[key] !== undefined) continue;
    s.flags[key] = s.day;
    m.elo -= T.SHAPED_ELO_PENALTY;
  }
}

// ---------------------------------------------------------------------------
// bench tuning
// ---------------------------------------------------------------------------

const tuneKey = (modelId: Id, benchId: Id) => `tune.${modelId}.${benchId}`;
const tuneCount = (s: GameState, modelId: Id, benchId: Id): number => s.flags[tuneKey(modelId, benchId)] ?? 0;
const codenameOf = (m: Model): string => m.codename ?? m.name;

/** Cost of one bench tune: $30k x (1 + 0.15 (year - 2017)) x max(1, active/10)^0.5 x finetuneCost. */
function tuneCost(s: GameState, m: Model): number {
  const year = calendarYear(s.day);
  const active = m.activeParamsB ?? m.paramsB;
  const finetune = getBonuses(s).finetuneCost ?? 1;
  return Math.round(T.TUNE_COST_BASE * (1 + T.TUNE_YEAR_GROWTH * (year - T.TUNE_BASE_YEAR)) * Math.pow(Math.max(1, active / 10), 0.5) * finetune);
}

/** Caps after a tune: weighted caps gain gain x (weight / max weight), every other cap loses a point. */
function shapedCaps(def: BenchmarkDef, caps: Capabilities, gain: number): Capabilities {
  const wmax = Math.max(1e-9, ...Object.values(def.weights).map((v) => v ?? 0));
  const out = { ...caps };
  for (const k of CAP_IDS) {
    const w = def.weights[k] ?? 0;
    out[k] = w > 0 ? caps[k] + gain * (w / wmax) : caps[k] - T.TUNE_OTHER_PENALTY;
  }
  return clampCaps(out);
}

/** A model's score on a benchmark for a given cap profile (same rules as evaluateModel). */
function scoreWith(s: GameState, m: Model, def: BenchmarkDef, caps: Capabilities): number {
  const contaminated = !!m.contaminated && def.year <= calendarYear(m.trainedDay);
  return benchmarkResult(def, caps, contaminated, { activeParamsB: m.activeParamsB ?? m.paramsB, year: calendarYear(s.day) });
}

export interface BenchTuneQuote {
  ok: boolean;
  reason?: string;
  cost: number;
  days: number;
  /** Expected change on this benchmark, in points (mean cap gain, with diminishing returns applied). */
  expectedGain: number;
}

/** What a bench tune would cost and return. The UI shows this before the player confirms. */
export function benchTuneQuote(s: GameState, modelId: Id, benchId: Id): BenchTuneQuote {
  const days = T.TUNE_DAYS;
  const m = s.models.find((x) => x.id === modelId);
  const def = benchmarkById(benchId);
  const fail = (reason: string, cost = 0): BenchTuneQuote => ({ ok: false, reason, cost, days, expectedGain: 0 });
  if (!m) return fail('That model no longer exists.');
  const cost = tuneCost(s, m);
  if (m.releasedDay !== null) return fail(`${m.name} is public. Tuning is for models nobody has seen yet.`, cost);
  if (m.deprecated) return fail(`${codenameOf(m)} is deprecated.`, cost);
  if (!def || def.year > calendarYear(s.day) || !m.caps || m.benchmarks?.[benchId] === undefined) {
    return fail(`${def?.name ?? 'That benchmark'} is not available for ${codenameOf(m)}.`, cost);
  }
  if ((s.classes?.benchTunes ?? []).some((j) => j.modelId === m.id && j.benchId === benchId)) {
    return fail(`Already tuning ${codenameOf(m)} on ${def.name}.`, cost);
  }
  if (s.finance.cash < cost) return fail(`Not enough cash for the bench tune (need ${formatMoney(cost)}).`, cost);
  const mult = T.TUNE_MULTS[Math.min(tuneCount(s, m.id, benchId), T.TUNE_MULTS.length - 1)];
  const before = scoreWith(s, m, def, m.caps);
  const after = scoreWith(s, m, def, shapedCaps(def, m.caps, T.TUNE_GAIN_MEAN * mult));
  return { ok: true, cost, days, expectedGain: Math.round((after - before) * 10) / 10 };
}

/** Completion of a tune: the caps move, the model is re-scored and the benchmark is re-measured. */
function finishTune(s: GameState, modelId: Id, benchId: Id, gainMult: number, rng: Rng): void {
  const m = s.models.find((x) => x.id === modelId);
  const def = benchmarkById(benchId);
  if (!m || !def || !m.caps) return;
  const name = codenameOf(m);
  if (m.releasedDay !== null || m.deprecated) {
    notify(s, `The bench tune on ${name} was dropped: the model is already public.`, 'info');
    return;
  }
  const prior = m.benchRuns?.[def.id]?.score;
  const gain = rng.normal(T.TUNE_GAIN_MEAN, T.TUNE_GAIN_SD) * gainMult;
  const oldOverall = m.overall;
  m.caps = shapedCaps(def, m.caps, gain);
  m.scores = scoresFromCaps(m.caps);
  m.overall = Math.round(overallScore(m.scores) * 10) / 10;
  m.elo += (m.overall - oldOverall) * T.ELO_PER_OVERALL;
  evaluateModel(s, m);
  const truth = m.benchmarks?.[def.id];
  if (truth !== undefined) {
    const score = measure(truth, rng);
    m.benchRuns = { ...(m.benchRuns ?? {}), [def.id]: { day: s.day, score } };
    const was = prior === undefined ? '' : ` (was ${prior})`;
    notify(s, `Bench tune on ${name} finished: ${def.name} reads ${score}${was}.`, prior === undefined || score >= prior ? 'good' : 'info');
  }
  const known = [...(m.quirks ?? []), ...(m.latentQuirks ?? [])];
  if (!known.includes(SHAPED_QUIRK) && rng.chance(T.SHAPED_CHANCE)) m.latentQuirks = [...(m.latentQuirks ?? []), SHAPED_QUIRK];
}

function settleBenchTunes(s: GameState, rng: Rng): void {
  const cs = ensureClasses(s);
  const due = cs.benchTunes.filter((j) => j.doneDay <= s.day);
  if (due.length === 0) return;
  cs.benchTunes = cs.benchTunes.filter((j) => j.doneDay > s.day);
  for (const job of due) finishTune(s, job.modelId, job.benchId, job.gainMult ?? 1, rng);
}

// ---------------------------------------------------------------------------
// daily tick
// ---------------------------------------------------------------------------

/** Runs right after benchmarksTick. Rival lines and efficiency scores daily, crowns weekly, tunes when they finish. */
export function classesTick(s: GameState, rng: Rng): void {
  ensureClasses(s);
  syncRivalBenchmarks(s);
  refreshRivalLines(s, rng);
  settleBenchTunes(s, rng);
  applyShapedQuirks(s);
  if (!s.flags.crownsSeeded || s.day % T.CROWN_EVERY_DAYS === 0) recomputeCrowns(s);
}

export const handlers: ActionHandlers = {
  benchTune: (s, a) => {
    const q = benchTuneQuote(s, a.modelId, a.benchId);
    if (!q.ok) {
      notify(s, q.reason ?? 'Not yet.', 'bad');
      return;
    }
    const m = s.models.find((x) => x.id === a.modelId);
    const def = benchmarkById(a.benchId);
    if (!m || !def) return;
    if (!trySpend(s, 'compute', q.cost, `the bench tune on ${codenameOf(m)}`)) return;
    const n = tuneCount(s, m.id, def.id);
    s.flags[tuneKey(m.id, def.id)] = n + 1;
    ensureClasses(s).benchTunes.push({
      id: newId(s, 'tune'),
      modelId: m.id,
      benchId: def.id,
      startDay: s.day,
      doneDay: s.day + T.TUNE_DAYS,
      cost: q.cost,
      gainMult: T.TUNE_MULTS[Math.min(n, T.TUNE_MULTS.length - 1)],
    });
    notify(s, `Bench tune on ${codenameOf(m)} for ${def.name} started: results in ${T.TUNE_DAYS} days.`, 'info');
  },
};
