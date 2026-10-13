// OWNER: BOARD (v13, GAME_DESIGN §23.2). Quarterly board objectives.
//
// Every calendar quarter the board sets three goals sized to where the lab is right now: one easy, one fair and one
// stretch. A goal pays the moment it is met (XP plus cash, hype or research points), so there is always something
// close to finish. At quarter end the hit rate moves board confidence, which nudges valuation (bonuses.ts).
// The board draws from its own random stream (like contracts) so it never shifts the rest of the sim's rolls.
import type { ActionHandlers, BoardState, GameState, Objective, ObjectiveKind, ObjectiveReward, Rng } from '../types';
import { makeRng } from '../rng';
import { addRevenue, clamp, dayToDate, formatMoney, notify, pushNews } from '../util';
import { arenaLeaderboard } from './competitors';
import { availableResearch, effectiveResearchCost, researchPointsPerDay } from './research';
import { runwayDays } from './finance';
import { scenarioRule } from './scenario';
import { grantXp } from './progression';

export const BOARD_TUNING = {
  OBJECTIVES: 3,
  /** A first quarter shorter than this rolls into the next one. */
  MIN_QUARTER_DAYS: 45,
  REROLLS_PER_QUARTER: 1,
  START_CONFIDENCE: 50,
  HIT_CONFIDENCE: 6,
  MISS_CONFIDENCE: -4,
  SWEEP_CONFIDENCE: 5,
  BASE_XP: 70,
  STRETCH_MULT: 2,
  SWEEP_XP: 90,
  /** Cash reward = this many days of expenses, within [MIN, MAX] scaled by year. */
  CASH_DAYS: 8,
  CASH_MIN: 25_000,
  HYPE_REWARD: 6,
  RP_DAYS: 8,
  /**
   * Growth targets: the lab's own growth over the last quarter, scaled per step (easy, fair, stretch), with a floor
   * per step. A fast-growing startup gets big targets; a mature giant gets reachable ones.
   */
  GROWTH_SCALE: [0.7, 1.05, 1.5],
  GROWTH_FLOOR: [1.04, 1.08, 1.15],
  GROWTH_CAP: 2.5,
  HISTORY_CAP: 24,
};

const T = BOARD_TUNING;
const RNG_FLAG = 'board.rng';

function withBoardRng<R>(s: GameState, fn: (rng: Rng) => R): R {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x51ed270b) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

/** Calendar label of the quarter that starts on `day`, e.g. "Q2 2018". */
export function quarterLabel(day: number): string {
  const d = dayToDate(day);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/** First day of the next calendar quarter after `day`. */
export function nextQuarterStart(day: number): number {
  const d = dayToDate(day);
  const m = d.getUTCMonth();
  const next = new Date(Date.UTC(d.getUTCFullYear() + (m >= 9 ? 1 : 0), ((Math.floor(m / 3) + 1) * 3) % 12, 1));
  return Math.round((next.getTime() - Date.UTC(2017, 0, 1)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// measuring
// ---------------------------------------------------------------------------

function bestReleased(s: GameState): number {
  return s.models.reduce((b, m) => (m.releasedDay !== null && !m.deprecated ? Math.max(b, m.overall) : b), 0);
}
function bestReleasedSince(s: GameState, day: number): number {
  return s.models.reduce((b, m) => (m.releasedDay !== null && m.releasedDay >= day ? Math.max(b, m.overall) : b), 0);
}
function totalUsers(s: GameState): number {
  return s.products.reduce((t, p) => t + (p.active ? p.users : 0), 0);
}
function playerCrowns(s: GameState): number {
  return (s.classes?.crowns ?? []).filter((c) => c.holder === 'player').length;
}
function arenaRank(s: GameState): number {
  const rows = arenaLeaderboard(s);
  const i = rows.findIndex((r) => r.isPlayer);
  return i < 0 ? 99 : i + 1;
}
function runwayMonths(s: GameState): number {
  const d = runwayDays(s);
  return Number.isFinite(d) ? d / 30 : 999;
}
function goodRunsSince(s: GameState, day: number): number {
  // Pretrain models trained this quarter whose result met their forecast midpoint.
  return s.models.filter((m) => m.trainedDay >= day && !m.parentId && m.forecast && m.overall >= m.forecast.mid).length;
}

/** Today's value of the quantity an objective tracks. */
export function measure(s: GameState, o: Pick<Objective, 'kind'>, quarterStart: number): number {
  switch (o.kind) {
    case 'revenue': return s.finance.dailyRevenue;
    case 'users': return totalUsers(s);
    case 'ship': return bestReleasedSince(s, quarterStart);
    case 'research': return s.research.completed.length;
    case 'beat': return goodRunsSince(s, quarterStart);
    case 'crown': return playerCrowns(s);
    case 'contract': return s.flags['stat.contractsWon'] ?? 0;
    case 'rank': return arenaRank(s);
    case 'hype': return s.company.hype;
    case 'runway': return runwayMonths(s);
    case 'launch': return s.products.filter((p) => p.active).length;
    case 'train': return s.stats.modelsTrained;
    case 'scale': return s.lab?.largestFlops ?? 0;
  }
}

/** Lower is better only for arena rank. */
function met(o: Objective): boolean {
  return o.kind === 'rank' ? o.value <= o.target : o.value >= o.target;
}

/** 0..1 progress for the bar. */
export function objectiveProgress(o: Objective): number {
  if (o.doneDay !== null) return 1;
  if (o.kind === 'rank') return o.base <= o.target ? 1 : clamp((o.base - o.value) / Math.max(1, o.base - o.target), 0, 1);
  const span = o.target - o.base;
  if (span <= 0) return met(o) ? 1 : 0;
  return clamp((o.value - o.base) / span, 0, 1);
}

// ---------------------------------------------------------------------------
// building goals
// ---------------------------------------------------------------------------

interface Draft { kind: ObjectiveKind; text: string; target: number; base: number; endOnly?: boolean }

function money(v: number): string {
  return formatMoney(v);
}

/** Goals that make sense for this lab today, sized by difficulty step 0 (easy), 1 (fair), 2 (stretch). */
/** Growth over the last ~quarter of a FinanceSample field (1 = flat). Falls back to 1.3 with no history. */
function recentGrowth(s: GameState, key: 'revenue' | 'users'): number {
  const h = s.finance.history;
  if (h.length < 3) return 1.3;
  const now = h[h.length - 1];
  const then = h.find((x) => x.day >= now.day - 91) ?? h[0];
  if (!(then[key] > 0)) return 1.3;
  return clamp(now[key] / then[key], 1, T.GROWTH_CAP);
}

function growthTarget(s: GameState, key: 'revenue' | 'users', step: number): number {
  const g = recentGrowth(s, key);
  return Math.max(T.GROWTH_FLOOR[step], 1 + (g - 1) * T.GROWTH_SCALE[step]);
}

function candidates(s: GameState, step: number, quarterStart: number, quarterDays: number): Draft[] {
  const out: Draft[] = [];
  const trainingLocked = (scenarioRule(s, 'trainingLockedUntilYear') ?? 0) > dayToDate(s.day).getUTCFullYear();
  const live = s.products.filter((p) => p.active).length;
  const released = s.models.some((m) => m.releasedDay !== null);
  const rev = s.finance.dailyRevenue;
  if (rev >= 500) {
    const target = Math.max(rev * growthTarget(s, 'revenue', step), rev + 1000);
    out.push({ kind: 'revenue', text: `Reach ${money(target)} revenue a day`, target, base: rev });
  }
  const users = totalUsers(s);
  if (users >= 200) {
    const target = Math.round(Math.max(users * growthTarget(s, 'users', step), users + 500));
    out.push({ kind: 'users', text: `Grow to ${Math.round(target).toLocaleString('en-US')} users`, target, base: users });
  }
  if (!trainingLocked) {
    if (s.stats.modelsTrained === 0 || (!s.training && step === 0)) out.push({ kind: 'train', text: 'Finish a training run', target: s.stats.modelsTrained + 1, base: s.stats.modelsTrained });
    if (s.stats.modelsTrained > 0) out.push({ kind: 'beat', text: 'Finish a pre-training run that meets its forecast', target: 1, base: 0 });
    const largest = s.lab?.largestFlops ?? 0;
    if (largest > 0 && step === 2 && !s.training) out.push({ kind: 'scale', text: 'Train 2x bigger than your largest run', target: largest * 2, base: largest });
  }
  const best = bestReleased(s);
  if (s.stats.modelsTrained > 0) {
    const target = Math.round(best > 0 ? best + [0.5, 1.5, 3][step] : 10);
    out.push({ kind: 'ship', text: best > 0 ? `Release a model scoring ${target}+ overall` : 'Release your first model', target, base: 0 });
  }
  if (live === 0 && released) out.push({ kind: 'launch', text: 'Launch a product', target: 1, base: 0 });
  if (released) {
    const crowns = playerCrowns(s);
    out.push({ kind: 'crown', text: step === 2 ? 'Take 3 new benchmark crowns' : 'Take a new benchmark crown', target: crowns + (step === 2 ? 3 : 1), base: crowns });
    const rank = arenaRank(s);
    if (rank > 1 && rank < 99 && step >= 1) {
      const target = Math.max(1, rank - (step === 2 ? 2 : 1));
      out.push({ kind: 'rank', text: target === 1 ? 'Take Arena #1' : `Reach Arena #${target}`, target, base: rank });
    }
  }
  if ((s.contracts?.offers.length ?? 0) > 0 || (s.flags['stat.contractsWon'] ?? 0) > 0) {
    const won = s.flags['stat.contractsWon'] ?? 0;
    out.push({ kind: 'contract', text: 'Win a contract', target: won + 1, base: won });
  }
  const avail = availableResearch(s).filter((n) => n.id !== s.research.current);
  const rpPerDay = researchPointsPerDay(s);
  if (avail.length > 0 && rpPerDay > 0) {
    const cheap = avail.map((n) => effectiveResearchCost(s, n)).sort((a, b) => a - b);
    const budget = rpPerDay * quarterDays * [0.45, 0.7, 1][step];
    let n = 0;
    let spent = 0;
    for (const c of cheap) {
      if (spent + c > budget) break;
      spent += c;
      n++;
    }
    n = clamp(n, 1, 6);
    const done = s.research.completed.length;
    out.push({ kind: 'research', text: `Finish ${n} research topic${n === 1 ? '' : 's'}`, target: done + n, base: done });
  }
  const hype = s.company.hype;
  if (hype < 85) {
    const target = Math.round(Math.min(95, hype + [8, 15, 25][step]));
    out.push({ kind: 'hype', text: `Get hype to ${target}`, target, base: hype });
  }
  if (rev < 500 && released && live > 0) out.push({ kind: 'revenue', text: `Reach ${money(2000 * (step + 1))} revenue a day`, target: 2000 * (step + 1), base: rev });
  const months = runwayMonths(s);
  if (months < 999 && step <= 1) {
    const target = months < 12 ? 9 : 18;
    out.push({ kind: 'runway', text: `End the quarter with ${target}+ months of runway`, target, base: months, endOnly: true });
  }
  return out;
}

const REWARD_ORDER: (keyof ObjectiveReward)[] = ['cash', 'hype', 'rp'];

function rewardFor(s: GameState, step: number, i: number, stretch: boolean): ObjectiveReward {
  const mult = stretch ? T.STRETCH_MULT : 1;
  const reward: ObjectiveReward = { xp: Math.round(T.BASE_XP * (1 + 0.3 * step) * mult) };
  const kind = REWARD_ORDER[(i + s.day) % REWARD_ORDER.length];
  if (kind === 'cash') reward.cash = Math.round(Math.max(T.CASH_MIN, s.finance.dailyExpenses * T.CASH_DAYS) * mult);
  else if (kind === 'hype') reward.hype = T.HYPE_REWARD * mult;
  else reward.rp = Math.round(Math.max(20, researchPointsPerDay(s) * T.RP_DAYS) * mult);
  return reward;
}

function toObjective(s: GameState, d: Draft, reward: ObjectiveReward, stretch: boolean, quarterStart: number): Objective {
  const o: Objective = {
    id: `ob${s.day}-${d.kind}`,
    kind: d.kind,
    text: d.text,
    target: d.target,
    base: d.base,
    value: 0,
    reward,
    stretch: stretch || undefined,
    doneDay: null,
  };
  o.value = measure(s, o, quarterStart);
  return o;
}

function draw(s: GameState, rng: Rng, step: number, taken: Set<ObjectiveKind>, b: { quarterStart: number; quarterEnd: number }): Draft | null {
  const days = b.quarterEnd - s.day;
  const pool = candidates(s, step, b.quarterStart, days).filter((d) => !taken.has(d.kind));
  if (pool.length === 0) return null;
  return rng.pick(pool);
}

function buildObjectives(s: GameState, b: BoardState): Objective[] {
  return withBoardRng(s, (rng) => {
    const out: Objective[] = [];
    const taken = new Set<ObjectiveKind>();
    for (let i = 0; i < T.OBJECTIVES; i++) {
      const step = Math.min(2, i);
      const d = draw(s, rng, step, taken, b);
      if (!d) continue;
      taken.add(d.kind);
      out.push(toObjective(s, d, rewardFor(s, step, i, step === 2), step === 2, b.quarterStart));
    }
    return out;
  });
}

function startQuarter(s: GameState, b: BoardState): void {
  b.quarterStart = s.day;
  let end = nextQuarterStart(s.day);
  if (end - s.day < T.MIN_QUARTER_DAYS) end = nextQuarterStart(end);
  b.quarterEnd = end;
  b.quarter += 1;
  b.rerolls = T.REROLLS_PER_QUARTER;
  b.objectives = buildObjectives(s, b);
}

/** The board, created on first use with its first quarter. */
export function ensureBoard(s: GameState): BoardState {
  if (!s.board) {
    s.board = { quarterStart: s.day, quarterEnd: s.day, quarter: 0, objectives: [], confidence: T.START_CONFIDENCE, rerolls: 0, history: [] };
    startQuarter(s, s.board);
  }
  return s.board;
}

function payReward(s: GameState, o: Objective): void {
  const r = o.reward;
  const parts: string[] = [];
  if (r.cash) {
    addRevenue(s, 'other', r.cash);
    parts.push(formatMoney(r.cash));
  }
  if (r.hype) {
    s.company.hype = clamp(s.company.hype + r.hype, 0, 100);
    parts.push(`hype +${r.hype}`);
  }
  if (r.rp) {
    if (s.research.current) s.research.progress += r.rp;
    parts.push(`${r.rp} RP`);
  }
  parts.push(`${r.xp} XP`);
  grantXp(s, r.xp, o.stretch ? 'Stretch goal' : 'Board goal');
  notify(s, `${o.stretch ? 'Stretch goal' : 'Board goal'} done: ${o.text}. ${parts.join(', ')}.`, 'good');
}

function closeQuarter(s: GameState, b: BoardState): void {
  // End-only goals are judged now.
  for (const o of b.objectives) {
    if (o.doneDay !== null) continue;
    o.value = measure(s, o, b.quarterStart);
    if (met(o)) {
      o.doneDay = s.day;
      payReward(s, o);
    }
  }
  const total = b.objectives.length;
  const hit = b.objectives.filter((o) => o.doneDay !== null).length;
  let delta = hit * T.HIT_CONFIDENCE + (total - hit) * T.MISS_CONFIDENCE;
  if (total > 0 && hit === total) {
    delta += T.SWEEP_CONFIDENCE;
    grantXp(s, T.SWEEP_XP, 'Clean sweep');
    notify(s, `Clean sweep: every board goal met. The board is ${b.confidence + delta >= 75 ? 'thrilled' : 'pleased'}.`, 'milestone');
    pushNews(s, `${s.company.name} hits every target this quarter. A board member is seen smiling.`, 'good');
  } else if (total > 0) {
    notify(s, `Quarter closed: ${hit}/${total} board goals met. Board confidence ${delta >= 0 ? '+' : ''}${delta}.`, hit > 0 ? 'info' : 'bad');
  }
  b.confidence = clamp(b.confidence + delta, 0, 100);
  b.history.push({ quarter: b.quarter, hit, total, day: s.day });
  if (b.history.length > T.HISTORY_CAP) b.history.splice(0, b.history.length - T.HISTORY_CAP);
}

/** Daily: refresh values, pay goals the moment they are met, roll the quarter over. */
export function boardTick(s: GameState): void {
  if (s.mp?.result) return;
  const b = ensureBoard(s);
  if (s.day >= b.quarterEnd) {
    closeQuarter(s, b);
    startQuarter(s, b);
    return;
  }
  for (const o of b.objectives) {
    if (o.doneDay !== null) continue;
    o.value = measure(s, o, b.quarterStart);
    if (o.kind !== 'runway' && met(o)) {
      o.doneDay = s.day;
      payReward(s, o);
    }
  }
}

export const handlers: ActionHandlers = {
  rerollObjective: (s, a) => {
    const b = ensureBoard(s);
    const at = b.objectives.findIndex((o) => o.id === a.objectiveId);
    if (at < 0 || b.objectives[at].doneDay !== null) return;
    if (b.rerolls <= 0) {
      notify(s, 'The board already changed one goal this quarter.', 'bad');
      return;
    }
    const old = b.objectives[at];
    const step = old.stretch ? 2 : Math.min(1, at);
    const taken = new Set(b.objectives.map((o) => o.kind));
    const next = withBoardRng(s, (rng) => draw(s, rng, step, taken, b));
    if (!next) {
      notify(s, 'The board has no other goal in mind right now.', 'info');
      return;
    }
    b.rerolls -= 1;
    b.objectives[at] = toObjective(s, next, old.reward, !!old.stretch, b.quarterStart);
    notify(s, `The board swaps "${old.text}" for "${next.text}".`, 'info');
  },
};
