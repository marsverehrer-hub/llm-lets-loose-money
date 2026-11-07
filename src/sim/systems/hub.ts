// v19: the open hub. Rival labs' open-weights models and published datasets, which the player can download and use.
import type { ActionHandlers, CustomDataset, GameState, HubLicense, Id, Model, RivalLab, RivalModel } from '../types';
import { COMPETITORS } from '../data/competitors';
import { calendarYear, newId, notify, pushNews } from '../util';
import { contextWindowK, evaluateModel, modalitiesFor, overallScore, scoresFromCaps } from './capabilities';
import { frontierQuality } from './market';
import { chinchillaLoss } from './trainingMath';
import { hashUniform } from './data';

type HubUse = 'product' | 'contract' | 'release';
type Published = RivalLab['publishedData'][number];

/** Legal risk a downloaded dataset carries (feeds the lawsuit weight). */
const LEGAL_RISK: Record<HubLicense, number> = { permissive: 0, noncommercial: 0.3, research: 0.5 };

/**
 * What a license allows. Models without an origin are always fine. Noncommercial weights may be released (the release
 * gate also wants mode 'open'), but never sold or put under contract. Research weights can do none of the three.
 */
export function licenseAllows(license: HubLicense | undefined, use: HubUse): boolean {
  if (!license || license === 'permissive') return true;
  if (license === 'noncommercial') return use === 'release';
  return false;
}

/** True when this model may be used for `use` (models without an origin are always fine). */
export function modelAllows(m: Model, use: HubUse): boolean {
  return licenseAllows(m.origin?.license, use);
}

/** The refusal notice when a hub license forbids putting this model on a product, or null when it may ship. */
export function productRefusal(m: Model): string | null {
  if (modelAllows(m, 'product')) return null;
  return `${m.origin?.license} weights can't be sold. Fine-tune and release your own, or pick a permissive model.`;
}

function labName(labId: Id): string {
  return COMPETITORS.find((d) => d.id === labId)?.name ?? labId;
}

export interface HubModel { labId: Id; lab: string; model: RivalModel }
export interface HubDataset { labId: Id; lab: string; data: Published }

/** Open-weights models from labs that exist (active, acquired or bankrupt), newest first. */
export function hubModels(s: GameState): HubModel[] {
  const out: HubModel[] = [];
  for (const lab of s.rivals ?? []) {
    if (lab.status === 'unfounded') continue;
    for (const model of lab.models) if (model.open) out.push({ labId: lab.id, lab: labName(lab.id), model });
  }
  return out.sort((a, b) => (b.model.releasedDay ?? 0) - (a.model.releasedDay ?? 0));
}

/** Datasets rival labs published for anyone to use. */
export function hubDatasets(s: GameState): HubDataset[] {
  const out: HubDataset[] = [];
  for (const lab of s.rivals ?? []) for (const data of lab.publishedData) out.push({ labId: lab.id, lab: labName(lab.id), data });
  return out;
}

function downloadModel(s: GameState, labId: Id, modelId: Id): void {
  const hit = hubModels(s).find((h) => h.labId === labId && h.model.id === modelId);
  if (!hit) {
    notify(s, 'That model is not on the hub.', 'bad');
    return;
  }
  const name = `${hit.model.name} (${hit.lab})`;
  if (s.models.some((m) => m.origin?.labId === labId && m.origin.modelId === modelId)) {
    notify(s, `${name} is already in your lab.`, 'info');
    return;
  }
  const rm = hit.model;
  const license: HubLicense = rm.license ?? 'research';
  const caps = { ...rm.caps };
  const scores = scoresFromCaps(caps);
  const model: Model = {
    id: newId(s, 'm'),
    name,
    paramsB: rm.paramsB,
    tokensB: rm.tokensB,
    datasetIds: [...(rm.datasetIds ?? [])],
    techniques: [],
    finalLoss: chinchillaLoss(rm.paramsB, rm.tokensB, rm.dataQuality),
    scores,
    overall: overallScore(scores),
    elo: rm.elo,
    trainedDay: s.day,
    releasedDay: null,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: contextWindowK(s),
    modalities: modalitiesFor(caps, []),
    activeParamsB: rm.paramsB,
    inferenceMult: 1,
    origin: { labId, modelId, license },
  };
  evaluateModel(s, model);
  s.models.push(model);
  notify(s, `Downloaded ${name}. It cost nothing. It is yours to fine-tune, distil or merge, and to release or sell where the license allows.`, 'good');
}

function downloadDataset(s: GameState, labId: Id, datasetId: Id): void {
  const hit = hubDatasets(s).find((h) => h.labId === labId && h.data.id === datasetId);
  if (!hit) {
    notify(s, 'That dataset is not on the hub.', 'bad');
    return;
  }
  const d = hit.data;
  if (s.data.owned.includes(d.id) || s.data.custom?.some((c) => c.id === d.id)) {
    notify(s, `${d.name} is already yours.`, 'info');
    return;
  }
  const ds: CustomDataset = {
    id: d.id,
    name: d.name,
    kind: d.kind,
    tokensB: d.tokensB,
    quality: d.quality,
    cost: 0,
    legalRisk: LEGAL_RISK[d.license],
    unlockYear: calendarYear(s.day),
    freshnessYear: calendarYear(d.day),
    acquisition: 'open',
    flavor: `Published by ${hit.lab} for anyone to use. ${d.license} license.`,
    // shortcut: CustomDataset has no 'hub' source, so hub sets are filed as 'archive', add 'hub' to the type once the hub grows
    source: 'archive',
    createdDay: s.day,
  };
  s.data.custom ??= [];
  s.data.custom.push(ds);
  s.data.owned.push(d.id);
  notify(s, `${d.name} is in your data library, from ${hit.lab}.`, 'good');
}

export const handlers: ActionHandlers = {
  downloadHubModel: (s, a) => downloadModel(s, a.labId, a.modelId),
  downloadHubDataset: (s, a) => downloadDataset(s, a.labId, a.datasetId),
};

/** The player's best released open-weights model, or null. Rival labs fine-tune this one. */
export function bestOpenModel(s: GameState): Model | null {
  let best: Model | null = null;
  for (const m of s.models) if (m.releasedDay !== null && m.releaseMode === 'open' && !m.deprecated && (!best || m.overall > best.overall)) best = m;
  return best;
}

/**
 * v20 C1: open-weight rivals fine-tune the player's best open model, weekly. Each success is a derivative, which feeds
 * the ecosystem premium (finance) and the support deal (contracts). Hash-keyed rolls keep the player's rng stream untouched.
 */
function ecosystemTick(s: GameState): void {
  const best = bestOpenModel(s);
  if (!best || s.day % 7 !== 0) return;
  const q = frontierQuality(calendarYear(s.day));
  for (const lab of s.rivals ?? []) {
    const def = COMPETITORS.find((d) => d.id === lab.id);
    if (lab.status !== 'active' || !def || (def.kind !== 'open' && (def.openBias ?? 0) < 0.3)) continue;
    const chance = 0.012 * (best.overall / q) ** 2 * (def.kind === 'open' ? 2 : 1);
    if (hashUniform(s.seed, `eco:${lab.id}:${s.day}`) >= chance) continue;
    const eco = (s.ecosystem ??= { derivatives: 0, byLab: {}, lastDay: s.day });
    eco.derivatives += 1;
    eco.byLab[lab.id] = (eco.byLab[lab.id] ?? 0) + 1;
    eco.lastDay = s.day;
    if (eco.derivatives % 5 === 0) pushNews(s, `${labName(lab.id)} ships a fine-tune of ${best.name}. Your weights are now load-bearing.`, 'good');
  }
}

/** Once per lab per month: a rival's open release that beats the player's best released model. */
export function hubTick(s: GameState): void {
  ecosystemTick(s);
  let best = 0;
  for (const m of s.models) if (m.releasedDay !== null && !m.deprecated) best = Math.max(best, m.overall);
  const month = Math.floor(s.day / 30);
  for (const h of hubModels(s)) {
    if (h.model.releasedDay !== s.day || h.model.overall <= best) continue;
    const key = `hubNotice.${h.labId}`;
    if (s.flags[key] === month) continue;
    s.flags[key] = month;
    notify(s, `${h.lab}'s ${h.model.name} is on the hub and beats your best. Download it, fine-tune it, sell it (license permitting).`, 'info');
  }
}

const LICENSE_RANK: Record<HubLicense, number> = { research: 0, noncommercial: 1, permissive: 2 };

/**
 * The origin a model built from others inherits: the strictest hub license among its parents, so fine-tuning,
 * distilling or merging research or noncommercial weights never launders them into something sellable.
 */
export function inheritOrigin(parents: readonly (Model | undefined)[]): Model['origin'] | undefined {
  let pick: Model['origin'] | undefined;
  for (const p of parents) {
    const o = p?.origin;
    if (o && (!pick || LICENSE_RANK[o.license] < LICENSE_RANK[pick.license])) pick = { ...o };
  }
  return pick;
}
