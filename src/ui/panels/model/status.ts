// OWNER: UI-PAGE. Pure helpers for the model page and the model table: status pills, the lifecycle timeline, leak levels.
// Reads the sim through its public APIs only. Never reads run.hidden, lab.lrOffsets, model.vibes or latentQuirks contents.
import type { PillTone } from '../../components';
import type { GameState, Id, Model } from '../../../sim/types';
import { benchPending } from '../../../sim/systems/vault';
import { tdate } from '../../shell/fmt';

export interface StatusPill {
  label: string;
  tone: PillTone;
  title?: string;
}

/**
 * Status pills. The table uses the short form (Unreleased, Internal, Preview, Live, Open, Leaked, Deprecated).
 * The page header (`full`) adds the dates and the teaser.
 */
export function statusPills(m: Model, full = false): StatusPill[] {
  const out: StatusPill[] = [];
  const released = m.releasedDay !== null;
  if (m.deprecated) out.push({ label: 'Deprecated', tone: 'muted' });
  if (!released) {
    out.push({ label: 'Unreleased', tone: 'warn' });
  } else if (m.releaseMode === 'preview' && m.previewUntil !== undefined) {
    out.push({
      label: full ? `Preview until ${tdate(m.previewUntil)}` : 'Preview',
      tone: 'milestone',
      title: `Limited preview. Ends ${tdate(m.previewUntil)} unless promoted.`,
    });
  } else if (!m.deprecated) {
    out.push({ label: 'Live', tone: 'good' });
  }
  if (released && m.releaseMode === 'open') out.push({ label: full ? 'Open weights' : 'Open', tone: 'info' });
  if (m.internal) out.push({ label: 'Internal', tone: 'info', title: 'Deployed internally to speed research.' });
  if (m.leakedDay !== undefined) out.push({ label: 'Leaked', tone: 'bad', title: `Weights leaked ${tdate(m.leakedDay)}.` });
  if (full && !released && m.teased) out.push({ label: 'Teased', tone: 'milestone' });
  return out;
}

export type TimelineKey = 'trained' | 'benched' | 'arena' | 'teased' | 'released';
export interface TimelineStep {
  key: TimelineKey;
  label: string;
  state: 'done' | 'running' | 'todo';
  /** Date when done, or the countdown when running. */
  when: string;
}

/** Trained, benched, arena, teased, released. Dots fill as each thing happens. */
export function timelineOf(s: GameState, m: Model): TimelineStep[] {
  const released = m.releasedDay !== null;
  const runs = Object.values(m.benchRuns ?? {});
  const firstBench = runs.length > 0 ? Math.min(...runs.map((r) => r.day)) : null;
  const jobs = m.benchJobs ?? [];
  const benchEta = jobs.length > 0 ? Math.max(0, Math.ceil(Math.min(...jobs.map((j) => j.doneDay)) - s.day)) : null;
  const a = m.arena;
  const arenaDone = a !== undefined && s.day >= a.doneDay;
  const arenaRunning = a !== undefined && s.day < a.doneDay;
  const arenaEta = a !== undefined && arenaRunning ? Math.max(1, Math.ceil(a.doneDay - s.day)) : null;

  const benched: TimelineStep =
    released || firstBench !== null
      ? { key: 'benched', label: 'Benched', state: 'done', when: firstBench !== null ? tdate(firstBench) : 'Public' }
      : benchPending(m).length > 0
        ? { key: 'benched', label: 'Benched', state: 'running', when: benchEta !== null ? `Done in ${benchEta}d` : '' }
        : { key: 'benched', label: 'Benched', state: 'todo', when: '' };

  const arena: TimelineStep = arenaDone
    ? { key: 'arena', label: 'Arena', state: 'done', when: tdate(a?.doneDay ?? s.day) }
    : released
      ? { key: 'arena', label: 'Arena', state: 'done', when: 'Public' }
      : arenaRunning
        ? { key: 'arena', label: 'Arena', state: 'running', when: arenaEta !== null ? `Done in ${arenaEta}d` : '' }
        : { key: 'arena', label: 'Arena', state: 'todo', when: '' };

  return [
    { key: 'trained', label: 'Trained', state: 'done', when: tdate(m.trainedDay) },
    benched,
    arena,
    m.teased
      ? { key: 'teased', label: 'Teased', state: 'done', when: tdate(m.teased.day) }
      : { key: 'teased', label: 'Teased', state: 'todo', when: '' },
    released
      ? { key: 'released', label: 'Released', state: 'done', when: tdate(m.releasedDay as number) }
      : { key: 'released', label: 'Released', state: 'todo', when: '' },
  ];
}

export type LeakLevel = 'none' | 'low' | 'medium' | 'high';
/** Daily leak chance to a qualitative level. Thresholds are tuning, not rules. */
export const LEAK_LOW = 0.001;
export const LEAK_HIGH = 0.003;
export function leakLevel(p: number): LeakLevel {
  if (!(p > 0) || !Number.isFinite(p)) return 'none';
  if (p < LEAK_LOW) return 'low';
  if (p < LEAK_HIGH) return 'medium';
  return 'high';
}

/** Days until a running benchmark job for this id finishes, or null when it isn't running. */
export function benchEtaFor(s: GameState, m: Model, id: Id): number | null {
  const job = (m.benchJobs ?? []).find((j) => j.benchIds.includes(id));
  return job ? Math.max(0, Math.ceil(job.doneDay - s.day)) : null;
}

/** "Base › Instruct › Companion", from the spec lineage. */
export function lineageText(s: GameState, m: Model): string {
  const names = (m.lineage ?? []).map((id) => s.models.find((x) => x.id === id)?.name ?? id);
  return ['Base', ...names].join(' › ');
}

/** "Distilled from X" or "Merged from A + B · average", or null for a base model. */
export function derivedText(s: GameState, m: Model): string | null {
  const d = m.derivedFrom;
  if (!d) return null;
  const names = d.ids.map((id) => s.models.find((x) => x.id === id)?.name ?? '—');
  if (d.kind === 'distill') return `Distilled from ${names[0] ?? '—'}`;
  return `Merged from ${names.join(' + ')}${d.method ? ` · ${d.method}` : ''}`;
}
