// OWNER: v10 SERVE agent. Fleet priority, own-GPU serving vs cloud burst, per-product serving cost (GAME_DESIGN §21.1).
// The split math lives in compute.ts, next to the capacity readers. This file owns the priority picture for the UI, the
// daily serving tick (the burst bill and each product's serving cost) and the priority action.
import type { ActionHandlers, FleetBreakdown, FleetPriority, GameState, Rng } from '../types';
import { addExpense } from '../util';
import { applyPriority, fleetFor, priorityOf, refreshFleet, runActive } from './compute';

export { SERVING_TUNING } from './compute';

export const FLEET_PRIORITIES: FleetPriority[] = ['serving', 'balanced', 'training'];

export function fleetPriority(s: GameState): FleetPriority {
  return priorityOf(s);
}

/** Today's fleet picture. The serving tick writes it once per day; before the first tick it is computed on the fly. */
export function fleetBreakdown(s: GameState): FleetBreakdown {
  return s.compute.fleet ?? fleetFor(s, priorityOf(s), runActive(s));
}

/** What the fleet would look like under another priority today, for the picker's preview. Pure: does not mutate state. */
export function previewFleet(s: GameState, priority: FleetPriority): FleetBreakdown {
  return fleetFor(s, FLEET_PRIORITIES.includes(priority) ? priority : priorityOf(s), runActive(s));
}

/**
 * Daily serving. Refreshes the fleet picture, books the cloud burst under `serving`, and gives each product its serving
 * cost (its own GPUs' power share plus its burst). Runs after productsTick, so every product's demand is current.
 */
export function servingTick(s: GameState, _rng?: Rng): void {
  const fleet = refreshFleet(s);
  const byProduct = new Map(fleet.slices.map((sl) => [sl.productId, sl]));
  for (const p of s.products) {
    const sl = p.active ? byProduct.get(p.id) : undefined;
    p.servingCostPerDay = sl ? sl.ownCostPerDay + sl.burstCostPerDay : 0;
  }
  addExpense(s, 'serving', fleet.burstCostPerDay);
}

export const handlers: ActionHandlers = {
  setFleetPriority: (s, a) => {
    if (!FLEET_PRIORITIES.includes(a.priority)) return;
    applyPriority(s, a.priority);
  },
};
