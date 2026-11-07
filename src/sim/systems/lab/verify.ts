// Data verification: believed versus true dataset quality, audit quotes and the copy for a surprise.

import type { DatasetDef, GameState, Id } from '../../types';
import { believedQualityOf, datasetById, isVerifiedData, trueQualityOf } from '../data';
import { DATA_SURPRISE_COPY } from '../../data/evalCopy';
import { LAB_TUNING } from './tuning';
import { labOf, pickFrom } from './notebook';

// ---------------------------------------------------------------------------
// Data verification
// ---------------------------------------------------------------------------

/** Quality the lab believes: claimed until verified, then the true value. */
export function believedQuality(s: GameState, def: DatasetDef): number {
  return believedQualityOf(s, def);
}

export function isVerified(s: GameState, datasetId: Id): boolean {
  return isVerifiedData(s, datasetId);
}

/** True quality minus claimed, only once verified (else null). */
export function dataSurprise(s: GameState, datasetId: Id): number | null {
  if (!isVerifiedData(s, datasetId)) return null;
  const d = datasetById(s, datasetId);
  return d ? trueQualityOf(s, d) - d.quality : null;
}

export function auditQuote(s: GameState, datasetId: Id): { cost: number; days: number } {
  const d = datasetById(s, datasetId);
  return { cost: Math.round(Math.max(LAB_TUNING.AUDIT_MIN, LAB_TUNING.AUDIT_FRACTION * (d?.cost ?? 0))), days: LAB_TUNING.AUDIT_DAYS };
}

/** Day an audit finishes, if one is running. */
export function auditDoneDay(s: GameState, datasetId: Id): number | null {
  return s.flags[`audit.${datasetId}`] ?? null;
}

/** Verify the sets a finished run used. Returns the sets that were newly verified, with their surprise. */
export function verifyRunDatasets(s: GameState, datasetIds: readonly Id[]): { id: Id; name: string; claimed: number; truth: number; surprise: number }[] {
  const lab = labOf(s);
  const out: { id: Id; name: string; claimed: number; truth: number; surprise: number }[] = [];
  for (const id of new Set(datasetIds)) {
    if (lab.verifiedData.includes(id)) continue;
    const d = datasetById(s, id);
    if (!d) continue;
    lab.verifiedData.push(id);
    const truth = trueQualityOf(s, d);
    out.push({ id, name: d.name, claimed: d.quality, truth, surprise: truth - d.quality });
  }
  return out;
}

/** The copy tone for a data surprise. */
export function surpriseTone(surprise: number): 'worse' | 'same' | 'better' {
  if (surprise < -LAB_TUNING.DATA_SURPRISE_EPS) return 'worse';
  if (surprise > LAB_TUNING.DATA_SURPRISE_EPS) return 'better';
  return 'same';
}

/** Lines for a verified set, picked deterministically from the state. */
export function dataSurpriseLine(s: GameState, key: string, item: { name: string; claimed: number; truth: number }): { text: string; kind: 'good' | 'bad' | 'info' } {
  const tone = surpriseTone(item.truth - item.claimed);
  const text = pickFrom(s, key, DATA_SURPRISE_COPY[tone], { name: item.name, true: item.truth.toFixed(2), claimed: item.claimed.toFixed(2) });
  return { text, kind: tone === 'worse' ? 'bad' : tone === 'better' ? 'good' : 'info' };
}
