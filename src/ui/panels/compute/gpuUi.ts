// v19: helpers for the GPU, hall and silicon screens. Display only; the engine does the charging and refusing.
import { calendarYear, dayToDate } from '../../../sim/util';
import { SUPPLY_TUNING, gpuAllocationLeft, isAllocationExempt } from '../../../sim/systems/scaleLimits';
import { customChipPrice } from '../../../sim/systems/chipRnd';
import { datacenterPue, gpuById } from '../../../sim/systems/compute';
import { gpuPriceMult } from '../../../sim/systems/supply';
import { isResearched, researchPointsPerDay } from '../../../sim/systems/research';
import { RESEARCH } from '../../../sim/data/research';
import type { Datacenter, GameState, GpuDef, Interconnect, SiteId } from '../../../sim/types';
import { SITES } from '../../../sim/data/sites';

export interface SiteInfo {
  name: string;
  powerPriceMult: number;
  buildDaysMult: number;
  mwCap: number;
  outagePerDay: number;
  unlockYear: number;
  requiresResearch?: string;
  flavor: string;
}

export const SITE_TABLE: Record<SiteId, SiteInfo> = SITES;

export const SITE_IDS: SiteId[] = ['grid', 'hydro', 'solar', 'nuclear'];

/** A site is open once its year and research gate are met. */
export function siteOpen(s: GameState, id: SiteId): boolean {
  const site = SITE_TABLE[id];
  return calendarYear(s.day) >= site.unlockYear && (!site.requiresResearch || isResearched(s, site.requiresResearch));
}

/** Name of the research a locked site needs, or the year it opens. */
export function siteLockReason(s: GameState, id: SiteId): string | null {
  if (siteOpen(s, id)) return null;
  const site = SITE_TABLE[id];
  if (site.requiresResearch) {
    const node = RESEARCH.find((r) => r.id === site.requiresResearch);
    return `Needs ${node?.name ?? site.requiresResearch}`;
  }
  return `Opens ${site.unlockYear}`;
}

/** The interconnect of a hall (missing = pcie, or infiniband when the old flag is set). */
export function interconnectOf(dc: Datacenter): Interconnect {
  return dc.interconnect ?? (dc.infiniband ? 'infiniband' : 'pcie');
}

export const INTERCONNECT_NAME: Record<Interconnect, string> = { pcie: 'PCIe', nvlink: 'NVLink-ish', infiniband: 'InfiniBand-ish' };

/** Build-cost share each fabric upgrade costs (D3). */
export const INTERCONNECT_COST_SHARE: Record<Exclude<Interconnect, 'pcie'>, number> = { nvlink: 0.1, infiniband: 0.25 };

/** Hall megawatts: Σ GPUs × kW × PUE / 1000 (the same figure D3 caps). */
export function hallMw(dc: Datacenter): number {
  let kw = 0;
  for (const [gpuId, count] of Object.entries(dc.gpus)) kw += (gpuById(gpuId)?.powerKw ?? 0) * count;
  return (kw * datacenterPue(dc)) / 1000;
}

/** Megawatts the hall's site allows. */
export function siteMwCap(dc: Datacenter): number {
  return SITE_TABLE[dc.site ?? 'grid'].mwCap;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates read `14 Mar 2019` (DESIGN.md). */
export function fmtDay(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** First day of the next allocation quarter: when pre-orders are delivered. */
export function nextQuarterDay(day: number): number {
  return (Math.floor(day / SUPPLY_TUNING.QUARTER_DAYS) + 1) * SUPPLY_TUNING.QUARTER_DAYS; // same rule as supply.ts nextAllocationDay
}

/** Only datacenter (vendor) cards are rationed; consumer, workstation and custom cards are not. */
export const allocationExempt = isAllocationExempt;

/** GPUs of this card the vendor can still sell this quarter (Infinity when exempt; the engine's own rule). */
export function allocationLeft(s: GameState, g: GpuDef): number {
  return gpuAllocationLeft(s, g.id);
}

/** List price for one card right now: the buy price times the demand multiplier (D1). */
export function unitPrice(s: GameState, g: GpuDef): number {
  return g.class === 'custom' ? customChipPrice(s, g.id) : g.buyPrice * gpuPriceMult(s, g.id); // what buyGpus charges
}

/** Pre-order deposit: 30% of the price at order time (D1). */
export function preorderDeposit(s: GameState, g: GpuDef, count: number): number {
  return 0.3 * unitPrice(s, g) * count;
}

export const CLASS_LABEL: Record<NonNullable<GpuDef['class']>, string> = {
  consumer: 'consumer',
  workstation: 'workstation',
  datacenter: 'datacenter',
  custom: 'own silicon',
};

export function gpuClass(g: GpuDef): NonNullable<GpuDef['class']> {
  return g.class ?? 'datacenter';
}

// ---------------------------------------------------------------------------
// Own silicon (D4)
// ---------------------------------------------------------------------------

/** Share of the lab's research points the design takes each day (D4). */
export const CHIP_DESIGN_SHARE = 0.2;
/** Tape-out success odds (D4). */
export const TAPEOUT_ODDS = 0.7;
/** Cash to start a programme: $500M × generation (D4). */
export const CHIP_START_COST = 500_000_000;

/** The generation the next programme will produce. */
export function nextChipGeneration(s: GameState): number {
  return (s.chip?.generation ?? 0) + 1;
}

export function chipProgrammeCost(gen: number): number {
  return CHIP_START_COST * gen;
}

/** True while a programme is in design, tape-out or fab. */
export function chipRunning(s: GameState): boolean {
  const p = s.chip?.phase;
  return p === 'design' || p === 'tapeout' || p === 'fab';
}

/**
 * Why a programme cannot start yet, or null. Local gate: year 2024 and the closest existing research node
 * (custom_silicon is not in the tree; neuromorphic_chips is). D4 owns the real gate.
 */
export function chipGateReason(s: GameState): string | null {
  if (calendarYear(s.day) < 2024) return 'Opens 2024';
  const gate = RESEARCH.find((r) => r.id === 'custom_silicon') ?? RESEARCH.find((r) => r.id === 'neuromorphic_chips');
  if (gate && !isResearched(s, gate.id)) return `Needs ${gate.name}`;
  return null;
}

/** Days until the design finishes at the current research rate, or null before there is any research. */
export function chipDesignDaysLeft(s: GameState): number | null {
  const c = s.chip;
  if (!c || c.phase !== 'design') return null;
  const perDay = CHIP_DESIGN_SHARE * researchPointsPerDay(s);
  if (perDay <= 0) return null;
  return Math.max(0, Math.ceil((c.rpNeeded - c.rpDone) / perDay));
}
