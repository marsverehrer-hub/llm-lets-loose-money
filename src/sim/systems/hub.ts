// v19: the open hub. Rival labs' open-weights models and published datasets, which the player can download and use.
// Package C1 fills this in.
import type { ActionHandlers, GameState, HubLicense, Model } from '../types';

/** What a use needs from a license (C1). */
export function licenseAllows(_license: HubLicense | undefined, _use: 'product' | 'contract' | 'release'): boolean {
  return true;
}

/** True when this model may be used for `use` (models without an origin are always fine). */
export function modelAllows(m: Model, use: 'product' | 'contract' | 'release'): boolean {
  return licenseAllows(m.origin?.license, use);
}

export const handlers: ActionHandlers = {};

export function hubTick(_s: GameState): void {}
