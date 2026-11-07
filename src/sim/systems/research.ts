// OWNER: Agent A. Research tree progression.
import type { ActionHandlers, GameState, Rng, ResearchNode } from '../types';
import { RESEARCH, RESEARCH_TRACKS, trackStepOf } from '../data/research';
import { getBonuses } from '../bonuses';
import { calendarYear, formatMoney, notify, pushNews, trySpend, yearOf } from '../util';
import { roleStrength } from './staff';
import { internalResearchMult } from './release';
import { communityResearchMult } from './scenario'; // v9 scenario

/**
 * v1.0 research cost (GAME_DESIGN §18.2): node.cost is the base. Real cost = base x MULT x (1 + TIER_STEP x tier), so the
 * late tree gets steeper. researchCost is the BASE price only. Anything that compares progress with a cost must use
 * effectiveResearchCost (v10 diffusion, below).
 */
export const RESEARCH_COST_TUNING = {
  MULT: 1.2,
  TIER_STEP: 0.08,
};

/** Base research points a node takes (rounded). Ignores diffusion. Use effectiveResearchCost for real progress. */
export function researchCost(node: ResearchNode): number {
  return Math.round(node.cost * RESEARCH_COST_TUNING.MULT * (1 + RESEARCH_COST_TUNING.TIER_STEP * node.tier));
}

/**
 * v10 knowledge diffusion (GAME_DESIGN §21.2). Published papers make an idea cheaper the further the calendar is past
 * its minYear: factor = max(DIFFUSION_FLOOR, DIFFUSION_PER_YEAR ^ max(0, calendarYear - minYear)).
 * Being early stays expensive; catching up is cheap. Each year is -30% until the floor.
 */
export const DIFFUSION_PER_YEAR = 0.7;
export const DIFFUSION_FLOOR = 0.25;

export function diffusionFactor(s: GameState, node: ResearchNode): number {
  const age = Math.max(0, calendarYear(s.day) - node.minYear);
  return Math.max(DIFFUSION_FLOOR, Math.pow(DIFFUSION_PER_YEAR, age));
}

/** What a node costs the player right now (RP): base x diffusion. Every progress-vs-cost comparison goes through here. */
export function effectiveResearchCost(s: GameState, node: ResearchNode): number {
  return Math.round(researchCost(node) * diffusionFactor(s, node));
}

export const RESEARCH_TUNING = {
  /** A node with minYear Y can be started from year Y - EARLY_YEARS (the player may get ahead of history). */
  EARLY_YEARS: 1,
  /** Flat research strength contributed by each hired star researcher (their bonuses apply on top). */
  STAR_RESEARCHER_STRENGTH: 1.5,
  /** Idle lab: share of research output banked for the next topic. */
  BACKLOG_RATE: 0.75,
  /** The bank holds at most this many days of current output. */
  BACKLOG_CAP_DAYS: 120,
};

/** Most research points the idle bank can hold: BACKLOG_CAP_DAYS of current output. */
export function backlogCap(s: GameState): number {
  return RESEARCH_TUNING.BACKLOG_CAP_DAYS * researchPointsPerDay(s);
}

export function isResearched(s: GameState, id: string): boolean {
  return s.research.completed.includes(id);
}

function nodeById(id: string): ResearchNode | undefined {
  return RESEARCH.find((n) => n.id === id);
}

/** True when a node's prerequisites are done and its year gate is open. Does not check completion. */
function canStart(s: GameState, node: ResearchNode): boolean {
  return node.prereqs.every((p) => isResearched(s, p)) && yearOf(s.day) + RESEARCH_TUNING.EARLY_YEARS >= node.minYear;
}

/** Nodes whose prereqs are done, not yet researched, and minYear reached (the current node is included). */
export function availableResearch(s: GameState): ResearchNode[] {
  return RESEARCH.filter((n) => !isResearched(s, n.id) && canStart(s, n));
}

export function researchPointsPerDay(s: GameState): number {
  const starResearchers = s.staff.stars.filter((st) => st.hiredDay !== null && st.role === 'researcher').length;
  const strength = roleStrength(s, 'researcher') + starResearchers * RESEARCH_TUNING.STAR_RESEARCHER_STRENGTH;
  // v6: the best internally deployed model speeds research up (GAME_DESIGN §17.7).
  return strength * getBonuses(s).researchSpeed * internalResearchMult(s) * communityResearchMult(s); // v9 scenario: community research
}

export function researchTick(s: GameState, _rng: Rng): void {
  s.research.pointsPerDay = researchPointsPerDay(s);
  // v17.3: adopted papers land on their day, whatever the lab is working on.
  for (const a of [...(s.research.adopting ?? [])]) {
    if (s.day < a.doneDay) continue;
    s.research.adopting = (s.research.adopting ?? []).filter((x) => x !== a);
    const node = nodeById(a.nodeId);
    if (node && !isResearched(s, node.id)) completeNode(s, node, 'adopted');
  }
  const id = s.research.current;
  if (!id) {
    s.research.progress = 0;
    // Idle labs bank part of their output for the next topic (setResearch picks it up), up to the cap.
    s.research.banked = Math.min(backlogCap(s), (s.research.banked ?? 0) + RESEARCH_TUNING.BACKLOG_RATE * s.research.pointsPerDay);
    return;
  }
  const node = nodeById(id);
  if (!node || isResearched(s, id)) {
    s.research.current = null;
    s.research.progress = 0;
    return;
  }
  s.research.progress += s.research.pointsPerDay;
  const cost = effectiveResearchCost(s, node);
  if (s.research.progress >= cost) {
    const overflow = s.research.progress - cost;
    completeNode(s, node);
    if (overflow > 0) s.research.banked = Math.min(backlogCap(s), (s.research.banked ?? 0) + overflow);
  }
}

function completeNode(s: GameState, node: ResearchNode, how: 'researched' | 'adopted' = 'researched'): void {
  s.research.completed.push(node.id);
  if (s.research.current === node.id) {
    s.research.current = null;
    s.research.progress = 0;
  }
  if (s.research.partial) delete s.research.partial[node.id];
  notify(s, `${how === 'adopted' ? 'Paper adopted' : 'Research complete'}: ${node.icon} ${node.name}`, 'milestone');
  pushNews(s, `${s.company.name} finishes "${node.name}". ${node.description}`, 'milestone');
  if (node.unlocksProduct) notify(s, `New product line unlocked: ${node.unlocksProduct}.`, 'good');
}

export const handlers: ActionHandlers = {
  setResearch: (s, a) => {
    if (a.nodeId === null) {
      if (s.research.current) notify(s, 'Research paused. Progress is kept for when you come back to it.', 'info');
      shelve(s);
      return;
    }
    const node = nodeById(a.nodeId);
    if (!node) {
      notify(s, 'Unknown research topic.', 'bad');
      return;
    }
    if (isResearched(s, node.id)) {
      notify(s, `${node.name} is already done.`, 'info');
      return;
    }
    if (s.research.current === node.id) return;
    const missing = node.prereqs.filter((p) => !isResearched(s, p)).map((p) => nodeById(p)?.name ?? p);
    if (missing.length > 0) {
      notify(s, `${node.name} needs first: ${missing.join(', ')}.`, 'bad');
      return;
    }
    if (yearOf(s.day) + RESEARCH_TUNING.EARLY_YEARS < node.minYear) {
      notify(s, `${node.name} is too far ahead of its time. It opens in ${node.minYear - RESEARCH_TUNING.EARLY_YEARS}.`, 'bad');
      return;
    }
    if (s.research.current) notify(s, `Switched topics. Progress on the previous one is kept.`, 'info');
    shelve(s);
    s.research.current = node.id;
    // v17.3: pick up where the lab left off, plus anything banked while idle.
    s.research.progress = (s.research.partial?.[node.id] ?? 0) + (s.research.banked ?? 0);
    if (s.research.partial) delete s.research.partial[node.id];
    s.research.banked = 0;
    notify(s, `Now researching ${node.name} (${effectiveResearchCost(s, node)} RP).`, 'info');
  },

  adoptPaper: (s, a) => {
    const node = nodeById(a.nodeId);
    const q = node ? adoptQuote(s, node) : null;
    if (!node || !q) {
      notify(s, 'Unknown research topic.', 'bad');
      return;
    }
    if (!q.ok) {
      notify(s, q.reason, 'bad');
      return;
    }
    if (!trySpend(s, 'research', q.price, `adopting ${node.name}`)) return;
    (s.research.adopting ??= []).push({ nodeId: node.id, doneDay: s.day + q.days });
    notify(s, `Adopting the published ${node.name} paper: ${q.days} days, ${formatMoney(q.price)}.`, 'info');
  },

  setResearchAutoPick: (s, a) => {
    s.research.autoPick = a.on;
  },
};

/** Moves the current topic's progress to the shelf so switching or pausing never throws work away. */
function shelve(s: GameState): void {
  const cur = s.research.current;
  if (cur && s.research.progress > 0) (s.research.partial ??= {})[cur] = s.research.progress;
  s.research.current = null;
  s.research.progress = 0;
}

// ---------------------------------------------------------------------------
// v17.3 (GAME_DESIGN §30): recommended next topic and adopting published papers
// ---------------------------------------------------------------------------

/**
 * The opening a small lab should follow (cheap speed-up, then the road to the Chat product), then the track steps
 * interleaved round by round so every goal advances a little.
 */
const OPENING = ['transformers', 'mixed_precision', 'scaling_laws', 'instruction_tuning'];
const RECOMMEND_ORDER: string[] = (() => {
  const out: string[] = [...OPENING];
  const longest = Math.max(...RESEARCH_TRACKS.map((t) => t.steps.length));
  for (let i = 0; i < longest; i++) for (const t of RESEARCH_TRACKS) if (t.steps[i] && !out.includes(t.steps[i].id)) out.push(t.steps[i].id);
  return out;
})();

export interface Recommendation {
  node: ResearchNode;
  /** Plain label of the topic. */
  label: string;
  /** Why it matters, in player terms. */
  why: string;
  /** Track name, or null for a "More upgrades" topic. */
  track: string | null;
}

/** The next topic worth doing: the first startable track step, or the cheapest startable topic. Null when none. */
export function recommendedResearch(s: GameState): Recommendation | null {
  const busy = new Set([s.research.current, ...(s.research.queue ?? []), ...(s.research.adopting ?? []).map((a) => a.nodeId)]);
  const open = availableResearch(s).filter((n) => !busy.has(n.id));
  for (const id of RECOMMEND_ORDER) {
    const node = open.find((n) => n.id === id);
    if (!node) continue;
    const st = trackStepOf(id)!;
    return { node, label: st.label, why: st.why, track: st.track.name };
  }
  const cheapest = open.sort((a, b) => effectiveResearchCost(s, a) - effectiveResearchCost(s, b))[0];
  return cheapest ? { node: cheapest, label: cheapest.name, why: cheapest.effectText ?? cheapest.description, track: null } : null;
}

export const ADOPT_TUNING = {
  /** A paper can be adopted this many calendar years after its topic's minYear (once it is published). */
  PUBLISHED_AFTER_YEARS: 1,
  /** Cash per research point of today's (diffused) cost, growing per year after 2017. */
  CASH_PER_RP: 450,
  CASH_GROWTH_PER_YEAR: 1.1,
  /** Days to absorb the paper: BASE + RP / RP_PER_DAY, capped. */
  BASE_DAYS: 10,
  RP_PER_DAY: 30,
  MAX_DAYS: 45,
  /** Papers adopted at the same time. */
  MAX_PARALLEL: 2,
};

export interface AdoptQuote {
  ok: boolean;
  reason: string;
  price: number;
  days: number;
}

/** What adopting a published topic costs and takes, and whether it is possible today. */
export function adoptQuote(s: GameState, node: ResearchNode): AdoptQuote {
  const T = ADOPT_TUNING;
  const rp = effectiveResearchCost(s, node);
  const price = Math.round(rp * T.CASH_PER_RP * T.CASH_GROWTH_PER_YEAR ** Math.max(0, calendarYear(s.day) - 2017));
  const days = Math.min(T.MAX_DAYS, Math.round(T.BASE_DAYS + rp / T.RP_PER_DAY));
  const no = (reason: string) => ({ ok: false, reason, price, days });
  if (isResearched(s, node.id)) return no(`${node.name} is already done.`);
  if ((s.research.adopting ?? []).some((a) => a.nodeId === node.id)) return no(`${node.name} is already being adopted.`);
  const published = node.minYear + T.PUBLISHED_AFTER_YEARS;
  if (calendarYear(s.day) < published) return no(`Nobody has published ${node.name} yet. Papers come out in ${published}.`);
  const missing = node.prereqs.filter((p) => !isResearched(s, p)).map((p) => nodeById(p)?.name ?? p);
  if (missing.length > 0) return no(`${node.name} builds on ${missing.join(', ')} first.`);
  if ((s.research.adopting ?? []).length >= T.MAX_PARALLEL) return no(`Your team can absorb ${T.MAX_PARALLEL} papers at a time.`);
  if (s.finance.cash < price) return no(`Adopting ${node.name} costs ${formatMoney(price)}.`);
  return { ok: true, reason: '', price, days };
}
