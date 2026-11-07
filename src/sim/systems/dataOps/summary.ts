// Summary numbers for the data ops panel.
import type { GameState } from '../../types';

// ---------------------------------------------------------------------------
// Summary numbers for the panel
// ---------------------------------------------------------------------------

export interface DataOpsSummary {
  crawledB: number;
  soldTotal: number;
  activeStreams: number;
  refinedSets: number;
  strikes: number;
}

export function dataOpsSummary(s: GameState): DataOpsSummary {
  const o = s.dataOps;
  return {
    crawledB: o?.crawledB ?? 0,
    soldTotal: o?.soldTotal ?? 0,
    activeStreams: (o?.streams ?? []).filter((st) => st.endDay > s.day).length,
    refinedSets: Object.keys(s.data.refined ?? {}).length,
    strikes: s.flags.tosStrikes ?? 0,
  };
}
