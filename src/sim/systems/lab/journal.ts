// Journal and stats: the emergence journal with hidden rows and the lab stats summary.

import type { EmergenceDef, GameState, Id } from '../../types';
import { EMERGENCES } from '../../data/emergences';
import { LAB_TUNING } from './tuning';

// ---------------------------------------------------------------------------
// Journal and stats
// ---------------------------------------------------------------------------

export interface JournalRow {
  def: EmergenceDef;
  found: { day: number; modelId: Id; threshold: number } | null;
  /** Vague hint for undiscovered rows ("somewhere past 10^23 FLOP") or null. */
  hint: string | null;
}

/** All emergences: discovered ones with details, undiscovered as hidden rows (the UI shows "???" for those). */
export function emergenceJournal(s: GameState): JournalRow[] {
  const disc = s.lab?.discoveries ?? {};
  const knownThresholds = EMERGENCES.filter((d) => disc[d.id]).map((d) => disc[d.id].threshold);
  return EMERGENCES.map((def) => {
    const d = disc[def.id];
    if (d) return { def, found: { day: d.day, modelId: d.modelId, threshold: d.threshold }, hint: null };
    const near = knownThresholds.some((t) => Math.abs(t - def.threshold) <= LAB_TUNING.HINT_WINDOW);
    return { def, found: null, hint: near ? `somewhere past 10^${Math.floor(def.threshold)} effective FLOP` : null };
  });
}

export interface LabStats {
  runsByArch: Record<Id, number>;
  largestFlops: number;
  verified: number;
  discovered: number;
  undiscovered: number;
  /** Mean |actual - forecast| over the last runs, or null with no history. */
  forecastError: number | null;
}

export function labStats(s: GameState): LabStats {
  const lab = s.lab;
  const disc = lab?.discoveries ?? {};
  const discovered = EMERGENCES.filter((d) => disc[d.id]).length;
  const errs = lab?.forecastErrors ?? [];
  return {
    runsByArch: { ...(lab?.runsByArch ?? {}) },
    largestFlops: lab?.largestFlops ?? 0,
    verified: lab?.verifiedData.length ?? 0,
    discovered,
    undiscovered: EMERGENCES.length - discovered,
    forecastError: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
  };
}
