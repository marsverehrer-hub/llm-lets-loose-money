// v19: every 1 January each active lab announces a yearly plan; plans tilt the brain. Package B4.
import type { GameState, RivalLab, RivalPlanId } from '../../types';
import type { Rng } from '../../types';

/** How a plan tilts a lab's brain. 1 = neutral. */
export interface PlanMods {
  /** Multiplier on how much compute it buys. */
  compute: number;
  /** Multiplier on its prices. */
  price: number;
  /** Added to openBias. */
  open: number;
  /** Capability skew added to its releases. */
  capSkew: Partial<Record<'reasoning' | 'coding' | 'chat' | 'safety' | 'agentic' | 'knowledge', number>>;
  /** Multiplier on its release cadence (lower = more often). */
  cadence: number;
  /** Multiplier on poaching weight. */
  poach: number;
}

export const NEUTRAL_MODS: PlanMods = { compute: 1, price: 1, open: 0, capSkew: {}, cadence: 1, poach: 1 };

/** Run on 1 January: pick and announce plans. B4 fills this in. */
export function plansYear(_s: GameState, _rng: Rng): void {}

/** The tilt for a lab's current plan. B4 fills this in. */
export function planMods(_lab: RivalLab): PlanMods {
  return NEUTRAL_MODS;
}

export const PLAN_NAME: Record<RivalPlanId, string> = {
  agents: 'All-in on agents',
  price_war: 'Price war',
  open_everything: 'Open everything',
  safety_first: 'Safety first',
  scale: 'Scale at all costs',
  enterprise: 'Go enterprise',
  media: 'Pivot to media',
  steady: 'Steady as she goes',
};
