// v19: evals and safety cases. A per-model safety-case score, and jailbreak incidents after release. Package C5.
import type { GameState, Model, Rng } from '../types';

/** Safety-case score 0..100 for a model (C5). */
export function safetyCase(_s: GameState, _m: Model): number {
  return 50;
}

export function safetyTick(_s: GameState, _rng: Rng): void {}
