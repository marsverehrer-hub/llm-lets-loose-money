// The runway colour rule, shared by Headquarters, Finance and the treasury scene. Under four months is danger,
// under eighteen is caution, beyond that (or profitable) is fine.
export type RunwayTone = 'bad' | 'warn' | 'good';

/** Tone for a runway in days (Infinity means profitable). Mirrors the shell's runwayTone; keep the thresholds here only. */
export function runwayTone(days: number): RunwayTone {
  if (!isFinite(days)) return 'good';
  return days < 180 ? 'bad' : days < 540 ? 'warn' : 'good';
}
