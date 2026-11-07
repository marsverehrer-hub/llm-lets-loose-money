// v19: the rival "brain". Each week a lab picks actions with the same economy as the player: raise, buy or rent GPUs,
// hire, research, buy data, train (real scaling physics), release (closed or open), publish data, price. Package B2.
import type { CompetitorDef, Competitor, GameState, RivalLab } from '../../types';
import type { Rng } from '../../types';

/** One week of decisions and progress for an active lab. B2 fills this in. */
export function brainWeek(_s: GameState, _lab: RivalLab, _def: CompetitorDef, _rng: Rng): void {}

/**
 * The quality a rival release should have. `frontierBase` is what the old fixed curve would give (frontier + offset +
 * difficulty + catch-up + boosts). B2 blends in the lab's own trained model (RIVAL_TUNING.ANCHOR).
 */
export function rivalBase(_s: GameState, _def: CompetitorDef, _c: Competitor, frontierBase: number): number {
  return frontierBase;
}

/**
 * Called at the end of every rival release (competitors.ts releaseModel), after c.model is set. B2 records the
 * RivalModel in the lab's catalogue (real size and data if it came from a run), decides open weights and logs it.
 */
export function onRivalRelease(_s: GameState, _def: CompetitorDef, _c: Competitor): void {}
