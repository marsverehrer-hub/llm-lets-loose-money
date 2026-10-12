// Tangible deltas for choice results. Each resolve snapshots the concrete state (cash, GPUs, staff, datasets,
// models, datacenters, stars, training days) before the effect and diffs it after. The UI shows these instead of
// hidden stats (brand, hype, reputation, morale...), which move silently.
import type { GameState, RoleId, RunIncidentChoice, EventChoice, TangibleDelta, TrainingRun } from '../types';
import { ROLE_IDS } from '../types';
import { formatMoney } from '../util';
import { GPUS } from '../data/gpus';
import { datasetById } from './data';
import { trainingRatePerDay } from './capabilities';
import { runConfig } from './trainingMath';

const MINUS = '−';
const ROLE_LABEL: Record<RoleId, string> = {
  researcher: 'Researchers',
  engineer: 'Engineers',
  safety: 'Safety researchers',
  sales: 'Sales reps',
  marketing: 'Marketers',
};

/** Concrete state at one moment. Plain data, so it can be diffed without touching the live state. */
export interface TangibleSnapshot {
  cash: number;
  gpus: Record<string, number>;    // gpuId -> rented + owned in datacenters
  roles: Record<RoleId, number>;   // headcount per role
  datasets: string[];              // owned dataset ids
  models: number;
  datacenters: number;
  stars: number;                   // hired stars
  /** Run only: days the run is stalled, flops done, and flops per day (to turn flops into days). */
  stall: number;
  done: number;
  rate: number;
}

/** Concrete state now. Pass the training run when the decision is a run incident. */
export function snapshotTangible(s: GameState, run?: TrainingRun | null): TangibleSnapshot {
  const gpus: Record<string, number> = {};
  for (const [id, n] of Object.entries(s.compute.rented)) gpus[id] = (gpus[id] ?? 0) + n;
  for (const d of s.compute.datacenters) {
    for (const [id, n] of Object.entries(d.gpus)) gpus[id] = (gpus[id] ?? 0) + n;
  }
  const roles = {} as Record<RoleId, number>;
  for (const id of ROLE_IDS) roles[id] = s.staff.roles[id].count;
  return {
    cash: s.finance.cash,
    gpus,
    roles,
    datasets: [...s.data.owned],
    models: s.models.length,
    datacenters: s.compute.datacenters.length,
    stars: s.staff.stars.filter((x) => x.hiredDay !== null).length,
    stall: run?.stallDays ?? 0,
    done: run?.doneFlops ?? 0,
    rate: run ? trainingRatePerDay(s, runConfig(s, run)) : 0,
  };
}

const signed = (d: number, text: string) => `${d < 0 ? MINUS : '+'}${text}`;

/** The tangible changes between a snapshot and the state now. Empty when nothing concrete moved. */
export function diffTangible(before: TangibleSnapshot, s: GameState, run?: TrainingRun | null): TangibleDelta[] {
  const out: TangibleDelta[] = [];
  const after = snapshotTangible(s, run);

  const cash = after.cash - before.cash;
  if (Math.abs(cash) >= 1) out.push({ label: 'Cash', value: signed(cash, formatMoney(Math.abs(cash))) });

  const gpuIds = new Set([...Object.keys(before.gpus), ...Object.keys(after.gpus)]);
  for (const id of gpuIds) {
    const d = (after.gpus[id] ?? 0) - (before.gpus[id] ?? 0);
    if (d === 0) continue;
    const name = GPUS.find((g) => g.id === id)?.name ?? id;
    out.push({ label: 'GPUs', value: `${signed(d, String(Math.abs(d)))} ${name}` });
  }

  for (const id of ROLE_IDS) {
    const d = after.roles[id] - before.roles[id];
    if (d !== 0) out.push({ label: ROLE_LABEL[id], value: signed(d, String(Math.abs(d))) });
  }

  for (const id of after.datasets) {
    if (!before.datasets.includes(id)) out.push({ label: 'Dataset', value: `+${datasetById(s, id)?.name ?? id}` });
  }
  for (const id of before.datasets) {
    if (!after.datasets.includes(id)) out.push({ label: 'Dataset', value: `${MINUS}${datasetById(s, id)?.name ?? id}` });
  }

  const models = after.models - before.models;
  if (models !== 0) out.push({ label: 'Models', value: signed(models, String(Math.abs(models))) });

  const dcs = after.datacenters - before.datacenters;
  if (dcs !== 0) out.push({ label: 'Datacenters', value: signed(dcs, String(Math.abs(dcs))) });

  const stars = after.stars - before.stars;
  if (stars !== 0) out.push({ label: 'Star hires', value: signed(stars, String(Math.abs(stars))) });

  if (run) {
    const stall = after.stall - before.stall;
    if (stall > 0) out.push({ label: 'Training delay', value: `+${Math.round(stall)} days` });
    if (before.rate > 0) {
      const days = Math.round((after.done - before.done) / before.rate);
      if (days !== 0) out.push({ label: 'Training', value: `${signed(days, `${Math.abs(days)} days`)}` });
    }
  }
  return out;
}

/** Resolve an event choice's hint (a string or a function of state). */
export function eventHint(c: Pick<EventChoice, 'hint'>, s: GameState): string | undefined {
  if (!c.hint) return undefined;
  if (typeof c.hint === 'string') return c.hint;
  try {
    return c.hint(s) || undefined;
  } catch {
    return undefined;
  }
}

/** Resolve a run incident choice's hint (a string or a function of state and run). */
export function incidentHint(c: Pick<RunIncidentChoice, 'hint'>, s: GameState, run: TrainingRun): string | undefined {
  if (!c.hint) return undefined;
  if (typeof c.hint === 'string') return c.hint;
  try {
    return c.hint(s, run) || undefined;
  } catch {
    return undefined;
  }
}
