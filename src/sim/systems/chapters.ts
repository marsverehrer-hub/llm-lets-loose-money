// v17 (GAME_DESIGN §29): lab chapters. One clear objective at a time, from the first training run to a $1T lab, so the
// player always knows what the game wants from them next. Every scenario gets them (the Garage start has no other
// goals). A chapter completes the day its condition holds; several can complete on the same day. Progress lives in
// s.flags.chapter (index of the current chapter), so saves need nothing new.
import type { GameState } from '../types';
import { formatMoney, notify } from '../util';
import { grantXp } from './progression';
import { playerArenaRank } from './finance';
import { scenarioRule } from './scenario';

export interface ChapterDef {
  id: string;
  /** The objective, as an imperative. */
  title: string;
  /** Why it matters, one plain sentence. */
  why: string;
  /** UI panel id where the player does it. */
  panel: string;
  /** Button label for that panel. */
  cta: string;
  done: (s: GameState) => boolean;
  /** 0..1 towards the goal, where the goal is a number (revenue, valuation). */
  progress?: (s: GameState) => number;
  /** XP paid on completion (before the era multiplier). */
  xp: number;
}

const released = (s: GameState) => s.models.some((m) => m.releasedDay !== null);
const revenueAtLeast = (n: number) => (s: GameState) => s.finance.dailyRevenue >= n;
const rankAtMost = (n: number) => (s: GameState) => {
  const r = released(s) ? playerArenaRank(s) : 0;
  return r > 0 && r <= n;
};

export const CHAPTERS: ChapterDef[] = [
  { id: 'first_run', title: 'Start your first training run', why: 'Models are the whole business. Pick a recipe and let the GPUs cook.', panel: 'models', cta: 'Train', xp: 40, done: (s) => !!s.training || s.models.length > 0 },
  { id: 'first_release', title: 'Release a model', why: 'A model in the vault earns nothing. Ship it so the world can use it.', panel: 'models', cta: 'Release', xp: 60, done: released },
  { id: 'first_round', title: 'Raise a funding round', why: 'Early labs live on investors, not revenue. A good released model raises your valuation; then pitch investors in Finance.', panel: 'finance', cta: 'Pitch investors', xp: 120, done: (s) => (s.finance.roundLog?.length ?? 0) > 0 || s.company.isPublic || !!scenarioRule(s, 'noVc') },
  { id: 'first_product', title: 'Launch your first product', why: 'Products turn a released model into money every day.', panel: 'products', cta: 'Launch', xp: 80, done: (s) => s.products.some((p) => p.active) || (s.media?.products ?? []).some((p) => p.active) },
  { id: 'rev_1k', title: `First paying customers: ${formatMoney(1_000)} a day`, why: 'An API on a decent model finds its first developers. Small money, but real, and it shows investors traction.', panel: 'products', cta: 'Products', xp: 120, done: revenueAtLeast(1_000), progress: (s) => s.finance.dailyRevenue / 1_000 },
  { id: 'own_gpus', title: 'Own your GPUs: build a datacenter', why: 'Once a hall is full, owned GPUs cost far less per day than rent. It ties up cash, so build when the money is there.', panel: 'compute', cta: 'Build', xp: 150, done: (s) => s.compute.datacenters.some((d) => d.buildDaysLeft <= 0 && Object.values(d.gpus).some((n) => n > 0)) },
  { id: 'top3', title: 'Reach the top 3 on the Arena', why: 'The Arena is where buyers and investors look. Top 3 means you are a real lab.', panel: 'models', cta: 'Models', xp: 200, done: rankAtMost(3) },
  { id: 'rev_100k', title: `Earn ${formatMoney(100_000)} a day`, why: 'Scale: more products, more segments, enough serving GPUs to carry them.', panel: 'products', cta: 'Products', xp: 220, done: revenueAtLeast(100_000), progress: (s) => s.finance.dailyRevenue / 100_000 },
  { id: 'crown', title: 'Win a crown or a client contract', why: 'Crowns and contracts reward being the best at something specific, not just big.', panel: 'contracts', cta: 'Contracts', xp: 220, done: (s) => (s.classes?.crowns ?? []).some((c) => c.holder === 'player') || (s.contracts?.history ?? []).some((h) => h.outcome === 'won' || h.outcome === 'completed') },
  { id: 'rev_1m', title: `Earn ${formatMoney(1_000_000)} a day`, why: 'A big business. Enterprise deals and owned compute keep margins healthy.', panel: 'finance', cta: 'Finance', xp: 300, done: revenueAtLeast(1_000_000), progress: (s) => s.finance.dailyRevenue / 1_000_000 },
  { id: 'ipo', title: 'Go public', why: 'An IPO needs a big valuation and real revenue. The market will judge you daily after.', panel: 'finance', cta: 'Finance', xp: 350, done: (s) => s.company.isPublic || !!scenarioRule(s, 'noIpo') },
  { id: 'arena1', title: 'Be number one on the Arena', why: 'SOTA. Every rival lab will answer within weeks, so stay there.', panel: 'models', cta: 'Models', xp: 400, done: rankAtMost(1) },
  { id: 'trillion', title: `Reach a ${formatMoney(1e12)} valuation`, why: 'The last chapter. Whatever comes after this is between you and the regulators.', panel: 'finance', cta: 'Finance', xp: 600, done: (s) => s.finance.valuation >= 1e12, progress: (s) => s.finance.valuation / 1e12 },
];

/** Index of the current chapter (CHAPTERS.length once all are done). */
export function chapterIndex(s: GameState): number {
  return Math.min(CHAPTERS.length, Math.max(0, s.flags['chapter'] ?? 0));
}

/** The current chapter, or null when the story is finished. */
export function currentChapter(s: GameState): ChapterDef | null {
  return CHAPTERS[chapterIndex(s)] ?? null;
}

/** Completes every chapter whose condition holds, in order, and announces the next one. */
export function chaptersTick(s: GameState): void {
  let i = chapterIndex(s);
  const start = i;
  while (i < CHAPTERS.length && CHAPTERS[i].done(s)) {
    grantXp(s, CHAPTERS[i].xp, `Chapter: ${CHAPTERS[i].title}`);
    i += 1;
  }
  if (i === start) return;
  s.flags['chapter'] = i;
  const last = CHAPTERS[i - 1];
  const next = CHAPTERS[i];
  notify(s, next ? `Chapter ${i} complete: ${last.title}. Next: ${next.title}.` : `Final chapter complete: ${last.title}.`, 'milestone');
}
