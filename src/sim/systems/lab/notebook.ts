// The lab notebook: per-save lab knowledge, hidden per-game offsets, emergence thresholds and shared cap helpers.

import type { Capabilities, DataKind, EmergenceDef, GameState, Rng } from '../../types';
import { CAP_IDS } from '../../types';
import type { LabKnowledge } from '../../types';
import { RUN_TUNING } from '../../data/runTuning';
import { EMERGENCES } from '../../data/emergences';
import { pickCopy } from '../../data/evalCopy';
import { calendarYear } from '../../util';
import { isResearched } from '../research';
import { hashNormal, hashUniform } from '../data';
import type { mixRows, RunPhysics } from '../trainingMath';
import { LR_ARCHS, LAB_TUNING } from './tuning';

// ---------------------------------------------------------------------------
// The lab notebook and the hidden world
// ---------------------------------------------------------------------------

/** The lab notebook, created on first use. Also fills the hidden per-game offsets (seeded, so the same save always rolls the same world). */
export function labOf(s: GameState): LabKnowledge {
  s.lab ??= { runsByArch: {}, largestFlops: 0, sweeps: {}, discoveries: {}, verifiedData: [], lrOffsets: {}, emergenceJitter: {}, forecastErrors: [] };
  const lab = s.lab;
  lab.runsByArch ??= {};
  lab.sweeps ??= {};
  lab.discoveries ??= {};
  lab.verifiedData ??= [];
  lab.lrOffsets ??= {};
  lab.emergenceJitter ??= {};
  lab.forecastErrors ??= [];
  for (const arch of LR_ARCHS) lab.lrOffsets[arch] ??= hashNormal(s.seed, `lr:${arch}`, RUN_TUNING.LR_OPT_OFFSET_SD);
  for (const def of EMERGENCES) lab.emergenceJitter[def.id] ??= (2 * hashUniform(s.seed, `em:${def.id}`) - 1) * def.jitter;
  return lab;
}

/** Per-game threshold jitter of an emergence (log10). */
function jitterOf(s: GameState, def: EmergenceDef): number {
  return s.lab?.emergenceJitter?.[def.id] ?? (2 * hashUniform(s.seed, `em:${def.id}`) - 1) * def.jitter;
}

/** The true threshold for an emergence in this game, in log10 effective compute. */
export function emergenceThresholdOf(s: GameState, def: EmergenceDef): number {
  return def.threshold + jitterOf(s, def);
}

/** log10 of effective training compute for resolved physics: 6 · effParams · effTokens · dataQuality (billions). */
export function effLog10(p: Pick<RunPhysics, 'effParamsB' | 'effTokens' | 'dataQuality'>): number {
  return LAB_TUNING.EFF_COMPUTE_LOG10_CONST + Math.log10(Math.max(1e-12, p.effParamsB)) + Math.log10(Math.max(1e-12, p.effTokens)) + Math.log10(Math.max(1e-12, p.dataQuality));
}

/** Share of each data kind in a mix, from mixRows. */
export function shareMap(rows: ReturnType<typeof mixRows>): Partial<Record<DataKind, number>> {
  const out: Partial<Record<DataKind, number>> = {};
  for (const r of rows) out[r.kind] = r.share;
  return out;
}

/** Whether an emergence's non-compute requirements (year, research, data share) hold for this run. */
export function requirementsMet(s: GameState, def: EmergenceDef, shares: Partial<Record<DataKind, number>>): boolean {
  if (def.minYear !== undefined && calendarYear(s.day) < def.minYear) return false;
  if (def.requiresResearch && !isResearched(s, def.requiresResearch)) return false;
  if (def.requiresKind && (shares[def.requiresKind.kind] ?? 0) < def.requiresKind.minShare) return false;
  return true;
}

export function sumCapAdd(a: Partial<Capabilities>, b: Partial<Capabilities>): Partial<Capabilities> {
  const out: Partial<Capabilities> = { ...a };
  for (const k of CAP_IDS) if (b[k] !== undefined) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
}

export function scaleCapAdd(a: Partial<Capabilities>, f: number): Partial<Capabilities> {
  const out: Partial<Capabilities> = {};
  for (const k of CAP_IDS) if (a[k] !== undefined) out[k] = (a[k] ?? 0) * f;
  return out;
}

// ---------------------------------------------------------------------------
// Helpers for daily ticks and actions
// ---------------------------------------------------------------------------

/** A deterministic pick from copy lines, keyed on the state (labTick has no rng of its own). */
export function pickFrom(s: GameState, key: string, lines: string[], vars: Record<string, string | number>): string {
  const rng = { pick: <T,>(arr: readonly T[]) => arr[Math.floor(hashUniform(s.seed, key) * arr.length)] } as unknown as Rng;
  return pickCopy(rng, lines, vars);
}
