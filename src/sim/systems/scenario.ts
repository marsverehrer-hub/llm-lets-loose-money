// OWNER: SCENARIO. v9 new-game setup (GAME_DESIGN §20.1): scenario rules, difficulty hooks, goals with the victory and
// loss takeovers, the government grant, and mid-era starts (fast-forward the world, then rebase the player).
// Hooks in other systems are one line each, marked `// v9 scenario`. Read the helpers below before changing them.
import type { Capabilities, GameSetup, GameState, GoalState, Model, Moment, ReleaseMode, Rng, RoleId, Scores } from '../types';
import { CAP_IDS } from '../types';
import { BALANCE } from '../balance';
import { DOCTRINE_COOLDOWN } from '../data/doctrines';
import { DATASETS } from '../data/datasets';
import { OFFICE_TIERS } from '../data/roles';
import { RESEARCH } from '../data/research';
import { defaultConfig } from '../data/trainingOptions';
import { difficultyDef, scenarioById, SCENARIO_FLAGS, type GoalDef, type ScenarioRules } from '../data/scenarios';
import { makeRng } from '../rng';
import { addRevenue, calendarYear, clamp, formatMoney, newId, notify, pushNews, yearOf } from '../util';
import { TRAINING_TUNING } from './training';
import { activeParamsFor } from './trainingMath';
import { competitorCaps, contextWindowK, evaluateModel, modalitiesFor, overallScore, scoresFromCaps } from './capabilities';
import { frontierQuality } from './market';
import { measureEvalSuite } from './vault';

/** Flags. The sandbox flag is set when a goal is missed; the fast-forward flag only exists during createInitialState. */
export const SCENARIO_FLAG = {
  sandbox: 'scenario.sandbox',
  ffwd: 'scenario.ffwd',
  startDay: 'scenario.startDay',
  won: 'scenario.won',
  winPending: 'scenario.winPending',
  lossPending: 'scenario.lossPending',
} as const;

/** Government grant is paid only while reputation is at least this. */
export const GRANT_MIN_REPUTATION = 60;
/** Events wait this long after a mid-era start, the same grace as a new game. */
const EVENT_GRACE_DAYS = 30;
/** Player flags that a fast-forward could leave behind. The world's own flags are kept. */
const PLAYER_FLAGS = [
  'lastRoundDay',
  'lastSecondaryDay',
  'stockMomentum',
  'lastOfferDay',
  'eventsResolved',
  'rentMult',
  'rentMultUntil',
  'yoloClean',
  'leakBoost',
  'openBoost',
  'moments.arena1Since',
  'moments.arena1Held',
];

// ---------------------------------------------------------------------------
// Rules and difficulty (the only reads other systems make)
// ---------------------------------------------------------------------------

/** The sandbox has no bankruptcy and no goals. A missed goal turns the game into a sandbox too. */
export function isSandbox(s: GameState): boolean {
  return !!s.setup?.sandbox || !!s.flags[SCENARIO_FLAG.sandbox] || !!s.flags[SCENARIO_FLAG.ffwd];
}

/** A scenario rule for this game. Undefined when the scenario does not set it. */
export function scenarioRule<K extends keyof ScenarioRules>(s: GameState, key: K): ScenarioRules[K] {
  return scenarioById(s.setup?.scenarioId).rules[key];
}

/** The difficulty this game was set up with (founder when there is no setup). */
export function difficulty(s: GameState) {
  return difficultyDef(s.setup?.difficulty);
}

/** Event weight multiplier for one event: the difficulty times any scenario boost for that event id. */
export function eventWeightMult(s: GameState, eventId: string): number {
  return difficulty(s).eventWeight * (scenarioRule(s, 'eventBoost')?.[eventId] ?? 1);
}

/** Points added to every rival release's base quality. */
export function rivalQualityOffset(s: GameState): number {
  return difficulty(s).rivalOffset;
}

/** Multiplier on every segment's TAM. */
export function marketGrowthMult(s: GameState): number {
  return difficulty(s).marketGrowth;
}

/** Multiplier on the valuation a private round is priced at. */
export function vcGenerosity(s: GameState): number {
  return difficulty(s).vcGenerosity;
}

/** Research point multiplier from the scenario. */
export function communityResearchMult(s: GameState): number {
  return scenarioRule(s, 'communityResearch') ?? 1;
}

/** Recruiting fee multiplier (the hire itself is instant in this sim, so the cost is what waits). */
export function hireCostMult(s: GameState): number {
  return scenarioRule(s, 'hireDaysMult') ?? 1;
}

/** A reason pretraining is locked, or null when it is open. */
export function trainingLockedNotice(s: GameState): string | null {
  const until = scenarioRule(s, 'trainingLockedUntilYear');
  if (until === undefined || calendarYear(s.day) >= until) return null;
  return `Pretraining is locked until ${until}. Sell data until then, or read the papers.`;
}

/** Open-weights scenarios turn every release into an open release. Notifies when the player's choice changed. */
export function enforceOpenRelease(s: GameState, mode: ReleaseMode): ReleaseMode {
  if (!scenarioRule(s, 'openOnly') || mode === 'open') return mode;
  notify(s, 'Every release ships open weights in this scenario. Your release is open.', 'info');
  return 'open';
}

/** A reason the lab focus cannot change, or null. */
export function doctrineLockedNotice(s: GameState): string | null {
  const locked = scenarioById(s.setup?.scenarioId).doctrine?.lock;
  return locked ? 'This scenario locks the lab focus. The board has voted, and the minutes are public.' : null;
}

// ---------------------------------------------------------------------------
// Start day and calendar helpers
// ---------------------------------------------------------------------------

/** Days from the game's first day (1 Jan 2017) to 1 January of `year`. */
export function startDayOf(year: number): number {
  return Math.round((Date.UTC(year, 0, 1) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Score and goals
// ---------------------------------------------------------------------------

/** Victory score: a base for the company, scaled by pace (faster is better) and the difficulty multiplier. */
export function scenarioScore(s: GameState): { score: number; days: number; crowns: number; valuation: number; mult: number } {
  const days = Math.max(1, s.day - (s.flags[SCENARIO_FLAG.startDay] ?? 0));
  const crowns = (s.classes?.crowns ?? []).filter((c) => c.holder === 'player').length;
  const valuation = Math.max(0, s.finance.valuation);
  const mult = difficulty(s).scoreMult;
  const pace = clamp(1 - days / 3650, 0.2, 1);
  const base = 1000 + crowns * 50 + Math.log10(Math.max(valuation, 1e6) / 1e6) * 100;
  return { score: Math.round(base * pace * mult), days, crowns, valuation, mult };
}

function goalDefs(s: GameState): GoalDef[] {
  return scenarioById(s.setup?.scenarioId).goals;
}

const WIN_TITLES = ['Goals met. Suspiciously quickly.', 'Scenario complete. The sandbox is open.', 'Every objective is done. The fine print is not.'];
const WIN_SUBTITLES = [
  '{company} hit every goal in {days} days. Score {score}. You may keep playing, which is the hard part.',
  'Objectives achieved in {days} days. The board has asked for a slide. Score {score}.',
];
const LOSS_SUBTITLES = [
  'The deadline has passed. The game continues as a sandbox, with no score and a great many opinions.',
  'Time is up. The scenario is over, and the rest of the game is a sandbox.',
];

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** Show a takeover now, or hold it until the sim is free (only one moment can be on screen). */
function announce(s: GameState, flag: string, moment: () => Moment, news: string[]): void {
  if (s.pendingMoment) {
    s.flags[flag] = 1;
    return;
  }
  delete s.flags[flag];
  const m = moment();
  s.pendingMoment = m;
  s.flags[`moment.${m.id}`] = s.day;
  for (const line of news) pushNews(s, line, m.tone === 'loss' ? 'bad' : 'milestone');
}

function winMoment(s: GameState, rng: Rng): () => Moment {
  return () => {
    const sc = scenarioById(s.setup?.scenarioId);
    const r = scenarioScore(s);
    const vars = { company: s.company.name, days: String(r.days), score: String(r.score) };
    return {
      id: 'scenario_won',
      title: rng.pick(WIN_TITLES),
      subtitle: fill(rng.pick(WIN_SUBTITLES), vars),
      stats: [
        { label: 'Scenario', value: sc.name },
        { label: 'Difficulty', value: `${difficulty(s).name} (x${r.mult})` },
        { label: 'Days taken', value: String(r.days), num: true },
        { label: 'Valuation', value: formatMoney(r.valuation), num: true },
        { label: 'Crowns held', value: String(r.crowns), num: true },
        { label: 'Score', value: String(r.score), num: true },
      ],
      tone: 'triumph',
      day: s.day,
    };
  };
}

function lossMoment(s: GameState, rng: Rng, goal: GoalState): () => Moment {
  return () => {
    const sc = scenarioById(s.setup?.scenarioId);
    return {
      id: 'scenario_lost',
      title: `Goal missed: ${goal.text}`,
      subtitle: rng.pick(LOSS_SUBTITLES),
      stats: [
        { label: 'Scenario', value: sc.name },
        { label: 'Goal missed', value: goal.text },
        { label: 'Deadline', value: String(goal.deadlineYear ?? '-'), num: true },
        { label: 'Days in', value: String(Math.max(0, s.day - (s.flags[SCENARIO_FLAG.startDay] ?? 0))), num: true },
      ],
      tone: 'loss',
      day: s.day,
    };
  };
}

/** Goal checks, the victory and loss takeovers, and the government grant. Runs daily, before the books close. */
export function scenarioTick(s: GameState, rng: Rng): void {
  // Data sales made today (the books are still open). Read by the data broker goal.
  const sold = s.finance.today.revenue.data ?? 0;
  if (sold > 0) s.flags[SCENARIO_FLAGS.dataSales] = (s.flags[SCENARIO_FLAGS.dataSales] ?? 0) + sold;

  // Government grant: paid daily (a month's share), while reputation holds.
  const grant = scenarioRule(s, 'grantPerMonth') ?? 0;
  if (grant > 0 && s.company.reputation >= GRANT_MIN_REPUTATION) addRevenue(s, 'grant', grant / 30);

  // A takeover that was waiting for a free screen.
  if (s.flags[SCENARIO_FLAG.lossPending] !== undefined && !s.pendingMoment) {
    const missed = s.goals?.find((g) => g.missed);
    if (missed) announce(s, SCENARIO_FLAG.lossPending, lossMoment(s, rng, missed), [`Goal missed: ${missed.text}. The game continues as a sandbox.`]);
    else delete s.flags[SCENARIO_FLAG.lossPending];
  }
  if (s.flags[SCENARIO_FLAG.winPending] !== undefined && !s.pendingMoment) {
    announce(s, SCENARIO_FLAG.winPending, winMoment(s, rng), [`${s.company.name} meets every scenario goal. The board is thrilled, and a little suspicious.`]);
  }

  if (!s.goals || s.goals.length === 0 || isSandbox(s) || s.flags[SCENARIO_FLAG.won] !== undefined) return;

  const defs = goalDefs(s);
  let missed: GoalState | null = null;
  for (const g of s.goals) {
    if (g.doneDay !== null || g.failedDay !== null) continue;
    const def = defs.find((d) => d.id === g.id);
    if (!def) continue;
    if (def.check(s)) {
      g.doneDay = s.day;
      notify(s, `Goal met: ${g.text}.`, 'good');
      pushNews(s, `${s.company.name} meets a goal: ${g.text}.`, 'milestone');
      continue;
    }
    if (g.deadlineYear !== undefined && calendarYear(s.day) > g.deadlineYear) {
      missed = g;
      break;
    }
  }

  if (missed) {
    // The challenge is lost. Every open goal fails, and the game carries on as a sandbox.
    missed.missed = true;
    for (const g of s.goals) if (g.doneDay === null && g.failedDay === null) g.failedDay = s.day;
    s.flags[SCENARIO_FLAG.sandbox] = 1;
    announce(s, SCENARIO_FLAG.lossPending, lossMoment(s, rng, missed), [`Goal missed: ${missed.text}. The game continues as a sandbox.`]);
    return;
  }

  if (s.goals.every((g) => g.doneDay !== null)) {
    s.flags[SCENARIO_FLAG.won] = s.day;
    announce(s, SCENARIO_FLAG.winPending, winMoment(s, rng), [`${s.company.name} meets every scenario goal.`]);
  }
}

// ---------------------------------------------------------------------------
// Mid-era starts
// ---------------------------------------------------------------------------

/**
 * The engine's tick, registered by engine.ts when it loads. This module does not import the engine itself: state.ts
 * imports this file, and the engine pulls in the multiplayer module (tests mock that one).
 */
let advanceOneDay: ((s: GameState) => void) | null = null;

/** Called once by engine.ts. */
export function setScenarioTicker(fn: (s: GameState) => void): void {
  advanceOneDay = fn;
}

/**
 * Fast-forward the world from 2017 to `startDay` with the player frozen. The sim runs every system, so rivals,
 * the market, research and the frontier all arrive where a normal game would have them. Events are off, bankruptcy
 * is off, and any takeover the world earns is marked as already seen (the ChatMoment in a 2022 start, for example).
 */
function fastForward(s: GameState, startDay: number): void {
  if (!advanceOneDay) throw new Error('A mid-era start needs the sim engine loaded (import engine.ts first).');
  s.flags[SCENARIO_FLAG.ffwd] = 1;
  s.flags['nextEventDay'] = Infinity;
  while (s.day < startDay) {
    advanceOneDay(s);
    s.gameOver = null;
    s.pendingReveal = null;
    s.events.pending = null;
    if (s.pendingMoment) {
      s.flags[`moment.${s.pendingMoment.id}`] = s.day;
      s.pendingMoment = null;
    }
  }
  delete s.flags[SCENARIO_FLAG.ffwd];
  s.flags['nextEventDay'] = s.day + EVENT_GRACE_DAYS;
}

/** A starter model for the year: every capability at frontier minus 12 (the overall is tuned to that), evaluated and unreleased. */
function buildStarter(s: GameState, name: string, paramsB: number, tokensB: number): Model {
  const year = yearOf(s.day);
  const target = frontierQuality(year) - 12;
  const sc: Scores = { reasoning: target, coding: target, chat: target, safety: target };
  let caps: Capabilities = competitorCaps(sc, null, null, calendarYear(s.day));
  // One correction pass: move every capability by the gap between the overall and the target.
  for (let i = 0; i < 2; i++) {
    const gap = target - overallScore(scoresFromCaps(caps));
    const next = { ...caps };
    for (const k of CAP_IDS) if (!(k === 'vision' && caps[k] === 0)) next[k] = clamp(caps[k] + gap, 0, 100);
    caps = next;
  }
  const scores = scoresFromCaps(caps);
  const overall = overallScore(scores);
  const cfg = defaultConfig(s);
  const model: Model = {
    id: newId(s, 'm'),
    name,
    paramsB,
    tokensB,
    datasetIds: [],
    techniques: [],
    finalLoss: BALANCE.LOSS_WORST - (clamp(overall, 0, 100) / 100) * (BALANCE.LOSS_WORST - BALANCE.LOSS_BEST),
    codename: name,
    scores,
    overall,
    elo: TRAINING_TUNING.ELO_BASE + overall * TRAINING_TUNING.ELO_PER_POINT,
    trainedDay: s.day,
    releasedDay: null,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: contextWindowK(s),
    modalities: modalitiesFor(caps, []),
    contaminated: false,
    config: cfg,
    activeParamsB: activeParamsFor(paramsB, cfg),
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
  };
  evaluateModel(s, model);
  measureEvalSuite(s, model, makeRng(s));
  return model;
}

/** Rebase the player onto a scenario. Fields a scenario leaves out keep the game's defaults. */
function rebasePlayer(s: GameState, setup: GameSetup, startDay: number): void {
  const sc = scenarioById(setup.scenarioId);
  const diff = difficultyDef(setup.difficulty);
  const mid = startDay > 0;
  const staffCount = sc.staff ? Object.values(sc.staff).reduce((a, b) => a + (b ?? 0), 0) : headcountOf(s);

  // Company
  if (sc.brand !== undefined) s.company.brand = sc.brand;
  if (mid) {
    s.company.hype = 5;
    s.company.reputation = 60;
    s.company.founderEquity = BALANCE.START_FOUNDER_EQUITY;
    s.company.isPublic = false;
    s.company.sharesOutstanding = 0;
    s.company.stockPrice = 0;
    s.company.safetyIncidents = 0;
  }
  if (sc.staff) {
    const tier = OFFICE_TIERS.find((t) => t.capacity >= staffCount) ?? OFFICE_TIERS[OFFICE_TIERS.length - 1];
    s.company.officeTierId = tier.id;
  }
  if (sc.doctrine) {
    s.company.doctrine = sc.doctrine.start;
    // A focus picked at the start costs nothing to keep. Enterprise (the grant's default) can change at once.
    s.company.doctrineSince = sc.doctrine.lock ? startDay : startDay - DOCTRINE_COOLDOWN;
  }

  // Money
  const cash = Math.round(sc.startCash * diff.startCash);
  s.finance.cash = cash;
  s.finance.totalRaised = cash;
  s.finance.debt = 0;
  s.finance.today = { revenue: {}, expenses: {} };
  s.finance.dailyRevenue = 0;
  s.finance.dailyExpenses = 0;
  s.finance.revenueBreakdown = {};
  s.finance.expenseBreakdown = {};
  s.finance.valuation = sc.startValuation ?? 8_000_000;
  s.finance.lastPostMoney = sc.startValuation ?? 8_000_000;
  s.finance.roundsRaised = sc.roundsRaised ? [...sc.roundsRaised] : ['Pre-seed'];
  s.finance.pendingOffer = null;
  s.finance.nextOfferDay = startDay + 60;
  s.finance.negativeCashDays = 0;
  if (mid) s.finance.history = [];

  // Compute and data
  if (sc.fleet) s.compute.rented = { ...sc.fleet };
  if (mid) {
    s.compute.datacenters = [];
    s.data.owned = DATASETS.filter((d) => d.cost === 0 && d.unlockYear <= sc.startYear && !d.requiresResearch).map((d) => d.id);
  }

  // Research granted: every node that opens before the start year is done.
  if (mid) {
    s.research.completed = RESEARCH.filter((n) => n.minYear < sc.startYear).map((n) => n.id);
    s.research.current = null;
    s.research.progress = 0;
    s.research.pointsPerDay = 0;
  }

  // Staff
  if (sc.staff) {
    const roles: RoleId[] = ['researcher', 'engineer', 'safety', 'sales', 'marketing'];
    for (const r of roles) {
      s.staff.roles[r] = { count: sc.staff[r] ?? 0, skill: r === 'researcher' ? 1.1 : 1, salaryLevel: 1 };
    }
    s.staff.stars = [];
    s.staff.morale = 80;
    s.staff.nextStarDay = startDay + 60;
  }

  // Market and products: the player starts with nothing on the market.
  for (const seg of Object.values(s.market.segments)) seg.playerUsers = 0;
  s.market.campaigns = [];
  s.products = [];
  s.training = null;
  s.events = { pending: null, lastFired: {}, fired: [] };
  s.gameOver = null;

  if (mid) {
    s.trainingQueue = [];
    s.pendingReveal = null;
    s.pendingMoment = null;
    for (const k of PLAYER_FLAGS) delete s.flags[k];
    for (const k of Object.keys(s.flags)) if (k.startsWith('bonus.') || k.startsWith('bonusUntil.')) delete s.flags[k];
    s.notifications = [];
    s.noticeLog = [];
    s.achievements = {};
    s.stats = { totalRevenue: 0, peakValuation: 0, modelsTrained: 0, modelsReleased: 0, outageDays: 0, lawsuits: 0, bestElo: 0 };
    s.flags['lastRoundDay'] = startDay;
    s.flags[SCENARIO_FLAG.startDay] = startDay;
    delete s.lab;
    delete s.contracts;
    if (s.classes) s.classes.benchTunes = [];
    // A starter model comes with the start, so its "first model" takeover has been seen.
    if (sc.starter) s.flags['moment.first_model'] = startDay;
  }

  if (sc.starter) {
    s.models.push(buildStarter(s, sc.starter.name, sc.starter.paramsB, sc.starter.tokensB));
  }
}

function headcountOf(s: GameState): number {
  let n = 0;
  for (const r of ['researcher', 'engineer', 'safety', 'sales', 'marketing'] as RoleId[]) n += s.staff.roles[r].count;
  return n;
}

/**
 * Set up a new game for `setup` on top of a fresh state. The default setup (garage, founder, 2017) changes nothing
 * but the setup record, so it matches the classic game. Called by createInitialState.
 */
export function applyScenarioStart(s: GameState, setup: GameSetup): void {
  const sc = scenarioById(setup.scenarioId);
  const diff = difficultyDef(setup.difficulty);
  const startDay = startDayOf(sc.startYear);
  const sandbox = !!setup.sandbox;
  const mid = startDay > 0;

  s.setup = { scenarioId: sc.id, difficulty: diff.id, sandbox, skipTutorial: !!setup.skipTutorial, startYear: sc.startYear };
  if (mid) {
    fastForward(s, startDay);
  }
  rebasePlayer(s, s.setup, startDay);
  // v13: the world's fast-forward must not leave the player XP or a stale board.
  delete s.progress;
  delete s.board;

  if (setup.skipTutorial || mid) s.tutorialStep = -1;
  if (!sandbox && sc.goals.length > 0) {
    s.goals = sc.goals.map((g) => ({ id: g.id, text: g.text, deadlineYear: g.deadlineYear, doneDay: null, failedDay: null }));
  }
}
