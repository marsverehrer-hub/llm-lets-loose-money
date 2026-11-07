// v19: labs are founded (at most RIVAL_TUNING.MAX_ACTIVE active), go bankrupt, or get acquired. Package B3.
import type { CompetitorDef, GameState, RivalLab } from '../../types';
import type { Rng } from '../../types';

/** Daily lifecycle step for every lab (founding queue, bankruptcy, acquisitions). B3 fills this in. */
export function lifecycleDay(_s: GameState, _rng: Rng): void {}

/** Whether a founded-by-year lab may open now (the active cap). B3 fills this in. */
export function canActivate(_s: GameState, _def: CompetitorDef): boolean {
  return true;
}

/** A fresh lab record for a definition (B3 sets starting cash, GPUs and staff from the def and the year). */
export function newRivalLab(def: CompetitorDef): RivalLab {
  return {
    id: def.id,
    status: 'unfounded',
    foundedDay: null,
    cash: def.startCash ?? 0,
    negativeDays: 0,
    totalRaised: 0,
    gpusRented: { ...(def.startGpus ?? {}) },
    gpusOwned: {},
    staff: { research: 2, engineering: 1, safety: 0, sales: 0 },
    research: [],
    researching: null,
    rp: 0,
    datasets: [],
    run: null,
    models: [],
    ready: null,
    publishedData: [],
    plan: null,
    planHistory: [],
    log: [],
  };
}
