// OWNER: Agent A. Research tree progression.
import type { ActionHandlers, GameState, Rng, ResearchNode } from '../types';
import { RESEARCH } from '../data/research';
import { getBonuses } from '../bonuses';
import { calendarYear, notify, pushNews, yearOf } from '../util';
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
};

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
  const id = s.research.current;
  if (!id) {
    s.research.progress = 0;
    return;
  }
  const node = nodeById(id);
  if (!node || isResearched(s, id)) {
    s.research.current = null;
    s.research.progress = 0;
    return;
  }
  s.research.progress += s.research.pointsPerDay;
  if (s.research.progress >= effectiveResearchCost(s, node)) completeNode(s, node);
}

function completeNode(s: GameState, node: ResearchNode): void {
  s.research.completed.push(node.id);
  s.research.current = null;
  s.research.progress = 0;
  notify(s, `Research complete: ${node.icon} ${node.name}`, 'milestone');
  pushNews(s, `${s.company.name} finishes "${node.name}". ${node.description}`, 'milestone');
  if (node.unlocksProduct) notify(s, `New product line unlocked: ${node.unlocksProduct}.`, 'good');
}

export const handlers: ActionHandlers = {
  setResearch: (s, a) => {
    if (a.nodeId === null) {
      if (s.research.current) notify(s, 'Research paused. Progress on the current topic is lost.', 'info');
      s.research.current = null;
      s.research.progress = 0;
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
    if (s.research.current) notify(s, `Switched topics. Progress on the previous one is lost.`, 'info');
    s.research.current = node.id;
    s.research.progress = 0;
    notify(s, `Now researching ${node.name} (${effectiveResearchCost(s, node)} RP).`, 'info');
  },
};
