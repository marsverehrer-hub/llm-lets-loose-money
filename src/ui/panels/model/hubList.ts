// The open hub's read side for the UI: rival labs' open weights and published datasets. Local helpers with the
// sim's hubModels / hubDatasets signature (C1 in systems/hub.ts), so the screens do not wait on that package.
import type { PillTone } from '../../components/types';
import { labName } from '../../../sim/systems/labs';
import type { GameState, HubLicense, Id, Model, RivalLab, RivalModel } from '../../../sim/types';

export type HubDataset = RivalLab['publishedData'][number];
export interface HubModelRow {
  labId: Id;
  lab: string;
  model: RivalModel;
}
export interface HubDatasetRow {
  labId: Id;
  lab: string;
  data: HubDataset;
}

/** Open-weights models from labs that exist (not unfounded), newest first. */
export function hubModels(s: GameState): HubModelRow[] {
  const rows: HubModelRow[] = [];
  for (const r of s.rivals ?? []) {
    if (r.status === 'unfounded') continue;
    for (const m of r.models) if (m.open) rows.push({ labId: r.id, lab: labName(s, r.id), model: m });
  }
  return rows.sort((a, b) => (b.model.releasedDay ?? b.model.trainedDay) - (a.model.releasedDay ?? a.model.trainedDay));
}

/** Every dataset a lab has published, newest first. */
export function hubDatasets(s: GameState): HubDatasetRow[] {
  const rows: HubDatasetRow[] = [];
  for (const r of s.rivals ?? []) {
    if (r.status === 'unfounded') continue;
    for (const d of r.publishedData) rows.push({ labId: r.id, lab: labName(s, r.id), data: d });
  }
  return rows.sort((a, b) => b.data.day - a.data.day);
}

/** True when this hub model is already in the player's lab. */
export function downloadedModel(s: GameState, labId: Id, modelId: Id): boolean {
  return s.models.some((m: Model) => m.origin?.labId === labId && m.origin?.modelId === modelId);
}

export const LICENSE_TONE: Record<HubLicense, PillTone> = {
  permissive: 'good',
  noncommercial: 'warn',
  research: 'muted',
};

/** What each license lets the player do, in one plain line. */
export const LICENSE_RULE: Record<HubLicense, string> = {
  permissive: 'Use it for anything: products, contracts, release.',
  noncommercial: 'Fine-tune it and release it as open weights. No products, no contracts.',
  research: 'Study it only. No products, no contracts, no release.',
};
