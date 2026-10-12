// View model for the Data screen: catalogue filters and sort, the merged risk reading, the hero numbers and the
// owned-token items that feed the treemap. Pure; the sim is read, never written.
import type { DataAcquisition, DataDomain, DataKind, DatasetDef, GameState, Id } from '../../../sim/types';
import type { DatasetRow, DatasetStatus } from '../../../sim/systems/data';
import { datasetById } from '../../../sim/systems/data';
import { believedQuality, isVerified } from '../../../sim/systems/lab';
import { defaultConfig } from '../../../sim/data/trainingOptions';
import { mixRows, mixedQuality } from '../../../sim/systems/trainingMath';
import { acqOf, riskLevel, valueOf } from './labels';
import { clamp } from '../../../sim/util';

/** Status filter. "shelf" is the default: what you own, plus what you can buy now. */
export type StatusFilter = 'shelf' | 'all' | DatasetStatus;
export type SortKey = 'tokens' | 'quality' | 'cost' | 'value' | 'name';

export const SORT_KEYS: SortKey[] = ['tokens', 'quality', 'cost', 'value', 'name'];
export const SORT_LABEL: Record<SortKey, string> = {
  tokens: 'Tokens',
  quality: 'Quality',
  cost: 'Cost',
  value: 'Quality per dollar',
  name: 'Name',
};

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  shelf: 'Owned and buyable now',
  all: 'Everything',
  owned: 'Owned',
  available: 'Available',
  pending: 'In flight',
  locked: 'Locked',
  lost: 'Lost to rivals',
};
export const STATUS_FILTER_KEYS = Object.keys(STATUS_FILTER_LABEL) as StatusFilter[];

export interface CatalogueView {
  status: StatusFilter;
  acq: 'all' | DataAcquisition;
  kind: 'all' | DataKind;
  domain: 'all' | DataDomain;
  verif: 'all' | 'verified' | 'unverified';
  query: string;
  sort: SortKey;
  desc: boolean;
}

export const DEFAULT_VIEW: CatalogueView = {
  status: 'shelf',
  acq: 'all',
  kind: 'all',
  domain: 'all',
  verif: 'all',
  query: '',
  sort: 'tokens',
  desc: true,
};

/** The keys the Filters popover owns. Sort and search are not filters, so they do not count. */
const FILTER_KEYS = ['status', 'acq', 'kind', 'domain', 'verif'] as const;

/** Number of filters set away from their default. This is the badge on the Filters button. */
export function activeFilterCount(v: CatalogueView): number {
  return FILTER_KEYS.filter((k) => v[k] !== DEFAULT_VIEW[k]).length;
}

/** True when the Clear link has something to clear. */
export function hasSomethingToClear(v: CatalogueView): boolean {
  return activeFilterCount(v) > 0 || v.query.trim() !== '';
}

/** Filters and search back to default, keeping the sort the player chose. */
export function clearedView(v: CatalogueView): CatalogueView {
  return { ...DEFAULT_VIEW, sort: v.sort, desc: v.desc };
}

function statusMatches(f: StatusFilter, status: DatasetStatus): boolean {
  if (f === 'all') return true;
  if (f === 'shelf') return status === 'owned' || status === 'available';
  return status === f;
}

/** Rows that pass the view's filters and search. Does not sort. */
export function filterRows(s: GameState, rows: DatasetRow[], v: CatalogueView): DatasetRow[] {
  const q = v.query.trim().toLowerCase();
  return rows.filter((r) => {
    const d = r.def;
    if (!statusMatches(v.status, r.status)) return false;
    if (v.acq !== 'all' && acqOf(d) !== v.acq) return false;
    if (v.kind !== 'all' && d.kind !== v.kind) return false;
    if (v.domain !== 'all' && (d.domain ?? 'general') !== v.domain) return false;
    if (v.verif !== 'all' && isVerified(s, d.id) !== (v.verif === 'verified')) return false;
    if (q && !`${d.name} ${d.domain ?? 'general'} ${d.kind} ${acqOf(d)}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Rows sorted by the view's key and direction. Returns a new array. */
export function sortRows(s: GameState, rows: DatasetRow[], sort: SortKey, desc: boolean): DatasetRow[] {
  const dir = desc ? -1 : 1;
  if (sort === 'name') return [...rows].sort((a, b) => dir * a.def.name.localeCompare(b.def.name));
  const key = (r: DatasetRow): number => {
    switch (sort) {
      case 'tokens':
        return r.def.tokensB;
      case 'quality':
        return believedQuality(s, r.def);
      case 'cost':
        return r.def.cost;
      default:
        return valueOf(r.def, believedQuality(s, r.def));
    }
  };
  return [...rows].sort((a, b) => dir * (key(a) - key(b)));
}

/**
 * One risk pill for a set. The sim keeps legal and reputation risk apart; the player only needs to know how bad it
 * is, so the pill shows the worse of the two and the tooltip gives both.
 */
export interface MergedRisk {
  label: string;
  tone: ReturnType<typeof riskLevel>['tone'];
  legal: string;
  reputation: string;
}
export function mergedRisk(d: DatasetDef): MergedRisk {
  const legal = d.legalRisk;
  const rep = d.reputationRisk ?? 0;
  const worse = riskLevel(Math.max(legal, rep));
  return {
    label: `${worse.label} risk`,
    tone: worse.tone,
    legal: `${riskLevel(legal).label} (${Math.round(legal * 100)}%)`,
    reputation: `${riskLevel(rep).label} (${Math.round(rep * 100)}%)`,
  };
}

/** Summary numbers for the top of the screen. Each one is something training or a decision reads. */
export interface HeroNumbers {
  /** Unique tokens across every owned set. Training's "unique" count when the wizard uses all owned sets. */
  uniqueTokensB: number;
  /** Quality a training run starts from: the wizard's default mix over every owned set (0..1, before bonuses). */
  avgQuality: number | null;
  /** Owned sets whose quality is still the seller's claim. */
  unverified: number;
  owned: number;
}

export function heroNumbers(s: GameState): HeroNumbers {
  const owned = s.data.owned.filter((id) => datasetById(s, id));
  const uniqueTokensB = owned.reduce((n, id) => n + (datasetById(s, id)?.tokensB ?? 0), 0);
  const avgQuality = owned.length > 0 ? mixedQuality(mixRows(s, owned, defaultConfig(s))) : null;
  const unverified = owned.filter((id) => !isVerified(s, id)).length;
  return { uniqueTokensB, avgQuality, unverified, owned: owned.length };
}

/** One owned set as the treemap sees it. */
export interface OwnedItem {
  id: Id;
  name: string;
  domain: DataDomain;
  kind: DataKind;
  tokensB: number;
  quality: number;
  verified: boolean;
  legalRisk: number;
}

export function ownedItems(s: GameState): OwnedItem[] {
  const out: OwnedItem[] = [];
  for (const id of s.data.owned) {
    const d = datasetById(s, id);
    if (!d) continue;
    out.push({
      id,
      name: d.name,
      domain: d.domain ?? 'general',
      kind: d.kind,
      tokensB: d.tokensB,
      quality: believedQuality(s, d),
      verified: isVerified(s, id),
      legalRisk: d.legalRisk,
    });
  }
  return out;
}

/**
 * Fill for a quality value: the blue token mixed into the panel background, stronger as quality rises. Expressed as
 * colour-mix on tokens, so it follows both themes.
 */
export function qualityShade(q: number): string {
  const pctBlue = Math.round(22 + clamp(q, 0, 1) * 62);
  return `color-mix(in srgb, var(--blue) ${pctBlue}%, var(--bg-3))`;
}

/** Shade ramp for the legend, low to high quality. */
export const SHADE_STEPS = [0.1, 0.3, 0.5, 0.7, 0.9];
