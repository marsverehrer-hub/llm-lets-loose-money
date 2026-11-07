// v19: GPU supply. Pre-orders, a waitlist when the vendor runs dry, price spikes from demand, a used market fed by
// bankrupt labs and sellers. The vendor allocation (scaleLimits.ts) is shared with the rival labs. Package D1.
import type { ActionHandlers, GameState, Rng } from '../types';

/** Multiplier on a GPU's buy price from demand over supply (1 = list price). D1 fills this in. */
export function gpuPriceMult(_s: GameState, _gpuId: string): number {
  return 1;
}

/** Used GPUs on the market for a model, and their price per GPU. D1 fills this in. */
export function usedMarket(_s: GameState, _gpuId: string): { count: number; price: number } {
  return { count: 0, price: 0 };
}

export const handlers: ActionHandlers = {};

export function supplyTick(_s: GameState, _rng: Rng): void {}
