// Research screen model (v10, GAME_DESIGN 21.2): node states, the year range of the timeline, and how far behind the
// calendar the lab is. Every price here goes through effectiveResearchCost (knowledge diffusion), never the base price.
import type { GameState, Id, ResearchBranch, ResearchNode } from '../../../sim/types';
import { RESEARCH_BRANCHES } from '../../../sim/types';
import { RESEARCH } from '../../../sim/data/research';
import {
  DIFFUSION_FLOOR,
  DIFFUSION_PER_YEAR,
  availableResearch,
  effectiveResearchCost,
  isResearched,
  researchPointsPerDay,
  RESEARCH_TUNING,
} from '../../../sim/systems/research';
import { calendarYear } from '../../../sim/util';
import { fmtDays } from '../panelKit';

export type NodeState = 'done' | 'active' | 'available' | 'early' | 'locked';
export type BranchTab = 'all' | ResearchBranch;

export const BRANCH_LABEL: Record<ResearchBranch, string> = {
  architecture: 'Architecture',
  scaling: 'Scaling',
  infra: 'Infrastructure',
  data: 'Data',
  posttraining: 'Post-training',
  reasoning: 'Reasoning',
  agents: 'Agents',
  multimodal: 'Multimodal',
  inference: 'Inference',
  safety: 'Safety',
  product: 'Product',
};

export const EARLY = RESEARCH_TUNING.EARLY_YEARS;
export const NODE_BY_ID = new Map<Id, ResearchNode>(RESEARCH.map((n) => [n.id, n] as const));
export const branchOf = (n: ResearchNode): ResearchBranch => n.branch ?? RESEARCH_BRANCHES[0];
/** First calendar year the node can be started (the player may start one year ahead of minYear). */
export const opensIn = (n: ResearchNode): number => n.minYear - EARLY;

/** Timeline columns: every calendar year that a node opens in. */
const FIRST_YEAR = Math.min(...RESEARCH.map((n) => n.minYear));
const LAST_YEAR = Math.max(...RESEARCH.map((n) => n.minYear));
export const YEARS: number[] = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
export const NODES_BY_YEAR = new Map<number, ResearchNode[]>(
  YEARS.map((y) => [y, RESEARCH.filter((n) => n.minYear === y)] as const),
);

/** "Cheaper every year (-30%/yr)" and its floor, straight from the diffusion constants. */
export const CHEAPER_PCT = Math.round((1 - DIFFUSION_PER_YEAR) * 100);
export const FLOOR_PCT = Math.round((1 - DIFFUSION_FLOOR) * 100);

/** Everything the screen needs, computed once per render from the game state. */
export interface ResearchView {
  year: number;
  done: Set<Id>;
  avail: Set<Id>;
  current: ResearchNode | null;
  progress: number;
  /** Effective cost of the current topic, or 0 when idle. */
  currentCost: number;
  progressFrac: number;
  remainingRP: number;
  perDay: number;
  /** Lag in years: the oldest open idea you have not finished, measured against today. 0 when up to date. */
  behind: number;
  oldestOpen: ResearchNode | null;
  /** RP still owed on every open node (minYear reached) that is not done, at today's prices. */
  backlogRP: number;
  backlogCount: number;
  nextNode: ResearchNode | null;
  stats: Map<BranchTab, { done: number; total: number }>;
  stateOf: (n: ResearchNode) => NodeState;
  costOf: (n: ResearchNode) => number;
}

export function buildView(s: GameState): ResearchView {
  const year = calendarYear(s.day);
  const done = new Set(s.research.completed);
  const avail = new Set(availableResearch(s).map((n) => n.id));
  const currentId = s.research.current;
  const current = currentId ? NODE_BY_ID.get(currentId) ?? null : null;
  const perDay = researchPointsPerDay(s);
  const progress = s.research.progress;
  const costOf = (n: ResearchNode) => effectiveResearchCost(s, n);
  const currentCost = current ? costOf(current) : 0;
  const progressFrac = current && currentCost > 0 ? Math.min(1, progress / currentCost) : 0;
  const remainingRP = current ? Math.max(0, currentCost - progress) : 0;

  const stateOf = (n: ResearchNode): NodeState => {
    if (done.has(n.id)) return 'done';
    if (currentId === n.id) return 'active';
    if (avail.has(n.id)) return 'available';
    if (n.prereqs.every((p) => done.has(p))) return 'early';
    return 'locked';
  };

  const open = RESEARCH.filter((n) => n.minYear <= year && !done.has(n.id));
  const oldestOpen = open.reduce<ResearchNode | null>((a, n) => (!a || n.minYear < a.minYear ? n : a), null);
  const behind = oldestOpen ? Math.max(0, year - oldestOpen.minYear) : 0;
  const backlogRP = open.reduce((acc, n) => acc + costOf(n), 0);

  const nextNode =
    RESEARCH.filter((n) => avail.has(n.id) && n.id !== currentId).sort((a, b) => costOf(a) - costOf(b) || a.tier - b.tier)[0] ?? null;

  const stats = new Map<BranchTab, { done: number; total: number }>();
  stats.set('all', { done: done.size, total: RESEARCH.length });
  for (const b of RESEARCH_BRANCHES) stats.set(b, { done: 0, total: 0 });
  for (const n of RESEARCH) {
    const st = stats.get(branchOf(n))!;
    st.total++;
    if (done.has(n.id)) st.done++;
  }

  return {
    year,
    done,
    avail,
    current,
    progress,
    currentCost,
    progressFrac,
    remainingRP,
    perDay,
    behind,
    oldestOpen,
    backlogRP,
    backlogCount: open.length,
    nextNode,
    stats,
    stateOf,
    costOf,
  };
}

/** Years a node has been on the market past its opening year (0 for the opening year and before). */
export function ageOf(view: ResearchView, n: ResearchNode): number {
  return Math.max(0, view.year - n.minYear);
}

/** True when the node is past its year and the price is still falling (not yet at the floor). */
export function isCheaperNow(view: ResearchView, n: ResearchNode): boolean {
  return ageOf(view, n) > 0 && !view.done.has(n.id);
}

/** "12 days" at the given rate, or a plain line when nothing is produced. */
export function etaText(rp: number, perDay: number): string {
  if (perDay <= 0) return 'No output yet';
  if (rp <= 0) return 'Now';
  return fmtDays(rp / perDay);
}
