// The open hub for the UI: license pills and rules, plus the sim's hub lists (systems/hub.ts).
import type { PillTone } from '../../components/types';
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

// The read side lives in the sim (systems/hub.ts); the UI re-exports it under its row names.
export { hubModels, hubDatasets } from '../../../sim/systems/hub';

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
