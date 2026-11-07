// Archives: digitising lost collections, copyright claims and their settlement costs.
import type { GameState, Id } from '../../types';
import { calendarYear } from '../../util';
import { DATAOPS_TUNING } from './tuning';
import { costEra } from './era';
import { archiveById, type ArchiveDef } from './catalogue';
import { ops } from './state';

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// 6. Archives
// ---------------------------------------------------------------------------

export function archiveSetId(id: string): string {
  return `archive_${id}`;
}

export type ArchiveQuote = { ok: true; def: ArchiveDef; cost: number; days: number } | { ok: false; reason: string };

export function archiveQuote(s: GameState, archiveId: string): ArchiveQuote {
  const def = archiveById(archiveId);
  if (!def) return { ok: false, reason: 'Pick a real archive.' };
  const year = calendarYear(s.day);
  if (year < def.unlockYear) return { ok: false, reason: `${def.name} opens for digitising in ${def.unlockYear}.` };
  if ((s.data.custom ?? []).some((c) => c.id === archiveSetId(def.id))) return { ok: false, reason: `${def.name} is already digitised.` };
  const jobs = s.dataOps?.jobs ?? [];
  if (jobs.some((j) => j.kind === 'archive' && j.archiveId === def.id)) return { ok: false, reason: `${def.name} is already being scanned.` };
  if (jobs.filter((j) => j.kind === 'archive').length >= T.ARCHIVE_MAX_JOBS) return { ok: false, reason: 'Both scanning rigs are busy.' };
  return { ok: true, def, cost: def.cost * costEra(year), days: def.days };
}

/** The first owned archive set that is risky enough to draw a copyright claim and has not had one yet. */
export function archiveClaimTarget(s: GameState): ArchiveDef | undefined {
  const claimed = s.dataOps?.claimedArchives ?? [];
  for (const id of s.data.owned) {
    const ds = s.data.custom?.find((c) => c.id === id);
    if (ds?.source !== 'archive' || ds.legalRisk < T.ARCHIVE_CLAIM_RISK) continue;
    const def = archiveById(id.replace(/^archive_/, ''));
    if (def && !claimed.includes(def.id)) return def;
  }
  return undefined;
}

export function markArchiveClaimed(s: GameState, archiveId: string): void {
  const o = ops(s);
  if (!o.claimedArchives.includes(archiveId)) o.claimedArchives.push(archiveId);
}

export function archiveSettleCost(s: GameState): number {
  return T.ARCHIVE_SETTLE_2017 * costEra(calendarYear(s.day));
}
export function archiveFightLossCost(s: GameState): number {
  return T.ARCHIVE_FIGHT_LOSS_2017 * costEra(calendarYear(s.day));
}
