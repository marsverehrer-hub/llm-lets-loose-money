// Auto-pause (GAME_DESIGN §18.4). After each simulated day the store asks autoPauseCheck() whether an enabled
// trigger fired. It diffs the state against the snapshot taken after the previous day, so it only reports changes
// that happened during a tick. The store does the pausing (setSpeed 0) and the notify. Multiplayer never auto-pauses.
// Settings are per viewer: localStorage `llm-lets-loose-money/autopause`.
import { useEffect, useState } from 'preact/hooks';
import type { GameState, Id, NoticeKind } from '../sim/types';
import { DATASETS } from '../sim/data/datasets';
import { RESEARCH } from '../sim/data/research';
import { runwayDays } from '../sim/systems/finance';
import { formatDays } from './components/format';

export type AutoPauseTrigger = 'training' | 'research' | 'funding' | 'rival' | 'runway' | 'outage' | 'data';

/** Menu order and labels. Sentence case; the menu shows them as checkboxes under "Pause when…". */
export const AUTOPAUSE_TRIGGERS: { id: AutoPauseTrigger; label: string }[] = [
  { id: 'training', label: 'Training finishes' },
  { id: 'research', label: 'Research completes with an empty queue' },
  { id: 'funding', label: 'Funding offer arrives' },
  { id: 'rival', label: 'A rival overtakes your best model' },
  { id: 'runway', label: 'Runway under 60 days' },
  { id: 'outage', label: 'A product has an outage' },
  { id: 'data', label: 'A dataset deal is sniped' },
];

const STORAGE_KEY = 'llm-lets-loose-money/autopause';
const DEFAULTS: Record<AutoPauseTrigger, boolean> = {
  training: true,
  research: false,
  funding: true,
  rival: true,
  runway: true,
  outage: false,
  data: false,
};

const RUNWAY_PAUSE_DAYS = 60;
/** A product counts as in outage below this served fraction (products.ts reports 1 when fully served). */
const OUTAGE_SERVED = 0.95;

function readSettings(): Record<AutoPauseTrigger, boolean> {
  const out = { ...DEFAULTS };
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const t of AUTOPAUSE_TRIGGERS) if (typeof parsed[t.id] === 'boolean') out[t.id] = parsed[t.id] as boolean;
    }
  } catch {
    // Blocked storage or a corrupt value: keep the defaults.
  }
  return out;
}

let settings = readSettings();
const listeners = new Set<() => void>();

export function getAutoPause(): Readonly<Record<AutoPauseTrigger, boolean>> {
  return settings;
}

export function setAutoPause(id: AutoPauseTrigger, on: boolean): void {
  settings = { ...settings, [id]: on };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not persisted, but it still applies for this session.
  }
  for (const l of listeners) l();
}

/** Subscribes a component to setting changes and returns the current settings. */
export function useAutoPause(): Readonly<Record<AutoPauseTrigger, boolean>> {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return settings;
}

interface Snapshot {
  trainingId: Id | null;
  modelsTrained: number;
  researchCurrent: Id | null;
  researchDone: number;
  offerKey: string | null;
  releases: Map<Id, number>;
  /** Best rival overall before the day: only a rival that newly passes you pauses, not every release while you trail. */
  rivalBest: number;
  runway: number;
  outages: Set<Id>;
  lost: Set<Id>;
}

let snap: Snapshot | null = null;
/** The state object the snapshot belongs to. A new game or a loaded save starts a fresh baseline. */
let snapOf: GameState | null = null;

function takeSnapshot(s: GameState): Snapshot {
  const releases = new Map<Id, number>();
  for (const c of s.competitors) releases.set(c.id, c.modelsReleased);
  const outages = new Set<Id>();
  for (const p of s.products) if (p.active && p.servedFraction < OUTAGE_SERVED) outages.add(p.id);
  const offer = s.finance.pendingOffer;
  return {
    trainingId: s.training?.id ?? null,
    modelsTrained: s.stats.modelsTrained,
    researchCurrent: s.research.current,
    researchDone: s.research.completed.length,
    offerKey: offer ? `${offer.roundName}|${offer.investor}|${offer.expiresDay}` : null,
    releases,
    rivalBest: s.competitors.reduce((m, c) => (c.model ? Math.max(m, c.model.overall) : m), -Infinity),
    runway: runwayDays(s),
    outages,
    lost: new Set(s.data.lost ?? []),
  };
}

/** Best released, non-deprecated model overall. 0 when the player has none yet. */
function bestReleasedOverall(s: GameState): number {
  let best = 0;
  for (const m of s.models) if (m.releasedDay !== null && !m.deprecated && m.overall > best) best = m.overall;
  return best;
}

interface Reason {
  text: string;
  bad: boolean;
}

/**
 * Call after every simulated day. Returns the line to log and toast when an enabled trigger fired, or null.
 * The snapshot is refreshed every call, so disabled triggers never fire later from a stale diff.
 */
export function autoPauseCheck(s: GameState): { text: string; kind: NoticeKind } | null {
  if (s.mp) {
    snap = null;
    snapOf = null;
    return null;
  }
  const now = takeSnapshot(s);
  const prev = snapOf === s ? snap : null;
  snap = now;
  snapOf = s;
  if (!prev) return null;

  const on = settings;
  const reasons: Reason[] = [];

  if (on.training && prev.trainingId !== null && s.training?.id !== prev.trainingId && s.stats.modelsTrained > prev.modelsTrained) {
    // A cancelled run leaves no new model behind, so the count tells a finish from a cancel.
    const made = s.models[s.models.length - 1];
    reasons.push({ text: `${made ? made.name : 'Training'} finished training`, bad: false });
  }

  if (on.research && prev.researchCurrent !== null && s.research.current === null && s.research.completed.length > prev.researchDone && (s.research.queue?.length ?? 0) === 0) {
    const done = s.research.completed[s.research.completed.length - 1];
    const node = RESEARCH.find((n) => n.id === done);
    reasons.push({ text: `Research complete${node ? `: ${node.name}` : ''}, queue empty`, bad: false });
  }

  if (on.funding && now.offerKey !== null && now.offerKey !== prev.offerKey && s.finance.pendingOffer) {
    const o = s.finance.pendingOffer;
    reasons.push({ text: `${o.investor} makes a ${o.roundName} offer`, bad: false });
  }

  if (on.rival) {
    const best = bestReleasedOverall(s);
    for (const c of s.competitors) {
      const before = prev.releases.get(c.id) ?? c.modelsReleased;
      if (c.modelsReleased > before && c.model && c.model.overall > best && prev.rivalBest <= best) {
        reasons.push({ text: `${c.model.name} beats your best model`, bad: true });
      }
    }
  }

  if (on.runway && prev.runway >= RUNWAY_PAUSE_DAYS && now.runway < RUNWAY_PAUSE_DAYS) {
    reasons.push({ text: `Runway is down to ${formatDays(now.runway)}`, bad: true });
  }

  if (on.outage) {
    for (const p of s.products) {
      if (now.outages.has(p.id) && !prev.outages.has(p.id)) reasons.push({ text: `${p.name} has an outage`, bad: true });
    }
  }

  if (on.data) {
    for (const id of now.lost) {
      if (prev.lost.has(id)) continue;
      const def = DATASETS.find((d) => d.id === id);
      reasons.push({ text: `A rival signed ${def ? def.name : 'a dataset'}`, bad: true });
    }
  }

  if (reasons.length === 0) return null;
  return {
    text: `Paused: ${reasons.map((r) => r.text).join('; ')}`,
    kind: reasons.some((r) => r.bad) ? 'bad' : 'info',
  };
}
