// OWNER: PROGRESSION (v13, GAME_DESIGN §23). Lab XP, levels, perk points and the hot streak.
//
// XP is paid by watching the state, not by hooking every system: each day the observer compares counters it has
// already paid for (research done, releases, crowns, contracts, achievements) with the live ones, and pays the
// difference. Eval reveals pay by verdict and drive the hot streak. Board objectives pay through grantXp.
import type { ActionHandlers, EvalReveal, GameState, PerkDef, ProgressState } from '../types';
import { PERKS, perkById } from '../data/perks';
import { notify, pushNews, trySpend } from '../util';

export const PROGRESS_TUNING = {
  /** XP needed to go from level 1 to 2; each later level needs GROWTH times more. */
  FIRST_LEVEL_XP: 350,
  GROWTH: 1.07,
  MAX_LEVEL: 50,
  /** Perk points per level, plus a bonus point every BONUS_EVERY levels. */
  POINTS_PER_LEVEL: 1,
  BONUS_EVERY: 10,
  /** Eval-day XP by verdict (pre-training). Fine-tunes, distills and merges pay DERIVED_SHARE of it. */
  VERDICT_XP: { banger: 140, solid: 95, 'as expected': 70, mid: 45, dud: 30, cursed: 35 } as Record<EvalReveal['verdict'], number>,
  DERIVED_SHARE: 0.45,
  /** Each step of the hot streak multiplies run XP by 1 + STREAK_XP_STEP (up to STREAK_XP_MAX_STEPS steps). */
  STREAK_XP_STEP: 0.15,
  STREAK_XP_MAX_STEPS: 5,
  RESEARCH_XP: 18,
  RELEASE_XP: 45,
  CROWN_XP: 25,
  CONTRACT_XP: 60,
  ACHIEVEMENT_XP: 20,
  /** Every grant is worth 1 + ERA_PER_YEAR per year since 2017: later wins are bigger wins. */
  ERA_PER_YEAR: 0.08,
  /** Momentum perk: training speed per streak step, capped. */
  MOMENTUM_PER_STEP: 0.02,
  MOMENTUM_MAX: 0.1,
  /** Respec: refunds every point, costs this many days of expenses (min $50k), once a year. */
  RESPEC_EXPENSE_DAYS: 30,
  RESPEC_MIN_COST: 50_000,
  RESPEC_COOLDOWN_DAYS: 365,
  LOG_CAP: 30,
};

const T = PROGRESS_TUNING;
const STREAK_VERDICTS: ReadonlySet<EvalReveal['verdict']> = new Set(['banger', 'solid', 'as expected']);

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(T.FIRST_LEVEL_XP * T.GROWTH ** (level - 1));
}

/** Total XP at which `level` starts (level 1 starts at 0). */
export function xpAtLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/** The level a lifetime XP total reaches. */
export function levelForXp(xp: number): number {
  let level = 1;
  let need = xpToNext(1);
  let left = xp;
  while (left >= need && level < T.MAX_LEVEL) {
    left -= need;
    level++;
    need = xpToNext(level);
  }
  return level;
}

/** Points earned by reaching `level` from level 1. */
export function pointsForLevel(level: number): number {
  let pts = 0;
  for (let l = 2; l <= level; l++) pts += T.POINTS_PER_LEVEL + (l % T.BONUS_EVERY === 0 ? 1 : 0);
  return pts;
}

function counters(s: GameState): Omit<ProgressState['seen'], 'revealKey'> {
  const seenBench = new Set<string>();
  for (const c of s.classes?.crowns ?? []) if (c.holder === 'player') seenBench.add(`${c.benchId}:${c.weightClass}`);
  return {
    research: s.research.completed.length,
    released: s.stats.modelsReleased,
    crowns: seenBench.size,
    contractsWon: s.flags['stat.contractsWon'] ?? 0,
    achievements: Object.keys(s.achievements).length,
  };
}

/** The progress record, created on first use. Counters start at today's values so old saves get no XP dump. */
export function ensureProgress(s: GameState): ProgressState {
  if (!s.progress) {
    s.progress = { xp: 0, level: 1, perkPoints: 0, perks: [], streak: 0, bestStreak: 0, seen: { ...counters(s), revealKey: '' }, log: [] };
  }
  return s.progress;
}

/** Read-only view for the UI (no state is created). */
export function progressOf(s: GameState): ProgressState {
  return s.progress ?? { xp: 0, level: 1, perkPoints: 0, perks: [], streak: 0, bestStreak: 0, seen: { research: 0, released: 0, crowns: 0, contractsWon: 0, achievements: 0, revealKey: '' }, log: [] };
}

/** XP into the current level and the size of the level, for the progress bar. */
export function levelProgress(p: ProgressState): { into: number; need: number; frac: number } {
  const into = p.xp - xpAtLevel(p.level);
  const need = xpToNext(p.level);
  return { into, need, frac: p.level >= T.MAX_LEVEL ? 1 : Math.max(0, Math.min(1, into / need)) };
}

/** Era multiplier on every XP grant. */
export function eraXpMult(s: GameState): number {
  return 1 + T.ERA_PER_YEAR * Math.max(0, s.day / 365);
}

/** Pay XP. Levels up as often as the total allows; each level gives perk points. */
export function grantXp(s: GameState, amount: number, reason: string): void {
  const p = ensureProgress(s);
  const xp = Math.max(0, Math.round(amount * eraXpMult(s)));
  if (xp <= 0) return;
  p.xp += xp;
  p.log.push({ day: s.day, amount: xp, reason });
  if (p.log.length > T.LOG_CAP) p.log.splice(0, p.log.length - T.LOG_CAP);
  const next = levelForXp(p.xp);
  if (next > p.level) {
    const pts = pointsForLevel(next) - pointsForLevel(p.level);
    p.level = next;
    p.perkPoints += pts;
    notify(s, `Lab level ${next}. ${pts} perk point${pts === 1 ? '' : 's'} to spend.`, 'milestone');
    if (next % 5 === 0) pushNews(s, `${s.company.name} is now a level ${next} lab, according to a ranking nobody else uses.`, 'good');
  }
}

/** Run XP multiplier from the current hot streak. */
export function streakXpMult(streak: number): number {
  return 1 + T.STREAK_XP_STEP * Math.min(T.STREAK_XP_MAX_STEPS, Math.max(0, streak));
}

export function hasPerk(s: GameState, id: string): boolean {
  return !!s.progress?.perks.includes(id);
}

/** Momentum perk: training speed multiplier from the hot streak (1 without the perk). */
export function momentumSpeedMult(s: GameState): number {
  if (!hasPerk(s, 'momentum')) return 1;
  return 1 + Math.min(T.MOMENTUM_MAX, T.MOMENTUM_PER_STEP * (s.progress?.streak ?? 0));
}

/** Why a perk cannot be bought right now, or null when it can. */
export function perkBlocker(s: GameState, perk: PerkDef): string | null {
  const p = progressOf(s);
  if (p.perks.includes(perk.id)) return 'Owned';
  if (p.level < perk.minLevel) return `Needs lab level ${perk.minLevel}`;
  if (perk.tier > 1) {
    const below = PERKS.some((o) => o.branch === perk.branch && o.tier === perk.tier - 1 && p.perks.includes(o.id));
    if (!below) return `Needs a tier ${perk.tier - 1} ${perk.branch} perk`;
  }
  if (perk.tier === 4 && p.perks.some((id) => perkById(id)?.tier === 4)) return 'You already own a capstone';
  if (p.perkPoints < perk.cost) return `Needs ${perk.cost} point${perk.cost === 1 ? '' : 's'}`;
  return null;
}

/** Respec price: a month of expenses, at least the minimum. */
export function respecCost(s: GameState): number {
  return Math.max(T.RESPEC_MIN_COST, s.finance.dailyExpenses * T.RESPEC_EXPENSE_DAYS);
}

export function respecCooldownLeft(s: GameState): number {
  const d = s.progress?.respecDay;
  return d === undefined ? 0 : Math.max(0, T.RESPEC_COOLDOWN_DAYS - (s.day - d));
}

function payReveal(s: GameState, p: ProgressState, r: EvalReveal): void {
  const key = `${r.modelId}:${r.kind}`;
  if (p.seen.revealKey === key) return;
  p.seen.revealKey = key;
  let xp = T.VERDICT_XP[r.verdict] ?? 50;
  if (r.kind === 'pretrain') {
    if (STREAK_VERDICTS.has(r.verdict)) {
      p.streak += 1;
      if (p.streak > p.bestStreak) p.bestStreak = p.streak;
      if (p.streak >= 3) notify(s, `Hot streak: ${p.streak} runs in a row at or above forecast. Run XP x${streakXpMult(p.streak).toFixed(2)}.`, 'good');
    } else {
      if (p.streak >= 3) notify(s, `Hot streak over at ${p.streak}. The forecast wins this one.`, 'bad');
      p.streak = 0;
    }
    xp *= streakXpMult(p.streak);
  } else {
    xp *= T.DERIVED_SHARE;
  }
  grantXp(s, xp, `Eval: ${r.verdict}`);
}

/** Daily observer. Registered near the end of the tick so every system's changes for the day are visible. */
export function progressionTick(s: GameState): void {
  const p = ensureProgress(s);
  if (s.pendingReveal) payReveal(s, p, s.pendingReveal);
  const now = counters(s);
  const pay = (key: keyof typeof now, per: number, reason: string) => {
    const d = now[key] - p.seen[key];
    if (d > 0) grantXp(s, d * per, d > 1 ? `${reason} x${d}` : reason);
    p.seen[key] = now[key]; // crowns can also be lost; the counter follows them down so a retake pays again
  };
  pay('research', T.RESEARCH_XP, 'Research finished');
  pay('released', T.RELEASE_XP, 'Model released');
  pay('crowns', T.CROWN_XP, 'Crown taken');
  pay('contractsWon', T.CONTRACT_XP, 'Contract won');
  pay('achievements', T.ACHIEVEMENT_XP, 'Achievement');
}

export const handlers: ActionHandlers = {
  buyPerk: (s, a) => {
    const perk = perkById(a.perkId);
    if (!perk) return;
    const why = perkBlocker(s, perk);
    if (why) {
      notify(s, `${perk.name}: ${why.toLowerCase()}.`, 'bad');
      return;
    }
    const p = ensureProgress(s);
    p.perkPoints -= perk.cost;
    p.perks.push(perk.id);
    notify(s, `Perk unlocked: ${perk.name}. ${perk.effectText}`, 'good');
  },
  respecPerks: (s) => {
    const p = ensureProgress(s);
    if (p.perks.length === 0) return;
    const left = respecCooldownLeft(s);
    if (left > 0) {
      notify(s, `The team needs ${left} more days before another reorg.`, 'bad');
      return;
    }
    const cost = respecCost(s);
    if (!trySpend(s, 'other', cost, 'a reorg')) return;
    p.perkPoints += p.perks.reduce((t, id) => t + (perkById(id)?.cost ?? 0), 0);
    p.perks = [];
    p.respecDay = s.day;
    notify(s, 'Reorg done. Every perk point is back on the table.', 'info');
    pushNews(s, `${s.company.name} announces a reorg. Slack channels are renamed; nothing else changes.`, 'info');
  },
};
