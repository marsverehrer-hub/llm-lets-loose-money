// v19: serving work. Quantized variants (int8 / int4) and per-model latency. Package C3 fills this in.
import type { ActionHandlers, GameState, Model } from '../types';

/** Milliseconds per output token for a model (C3). */
export function latencyMs(_s: GameState, _m: Model): number {
  return 0;
}

export const handlers: ActionHandlers = {};
