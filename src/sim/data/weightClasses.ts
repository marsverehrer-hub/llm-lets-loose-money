// OWNER: CLASSES. Weight-class tables (GAME_DESIGN §19.2). Pure data and arithmetic with no imports from systems,
// so capabilities.ts (efficiency benchmarks) and classes.ts (classification, rival lines) share one source without
// an import cycle. classes.ts re-exports everything here.
import type { Personality, WeightClass } from '../types';

/**
 * Frontier ACTIVE params (B) by calendar year, log-interpolated between anchors.
 *
 * Calibration (scripts/bot.ts traced over 2017-2023 by seed): the scripted frontier bot trains
 * 4-9B in 2017, 45-66B in 2018 and 60B MoE in 2020, then 300-425B active MoE runs in 2021. Rival flagships are set to
 * this curve times a personality factor. The bot's 2021 MoE runs sit above the curve on purpose: the open class is
 * any size, so an outsized run still lands in the open class and does not shift the lower thresholds.
 * Small: up to 23B active in 2024 (the UI example line).
 */
const FRONTIER_ANCHORS: [number, number][] = [
  [2017, 6],
  [2018, 14],
  [2019, 28],
  [2020, 60],
  [2021, 150],
  [2022, 165],
  [2023, 178],
  [2024, 184],
  [2025, 230],
  [2026, 300],
  [2028, 540],
  [2030, 900],
  [2032, 1500],
];
/** Growth per year after the last anchor. */
const FRONTIER_GROWTH_AFTER = 1.3;

const frontierMemo = new Map<number, number>();
/** Active params (B) of a typical frontier model in that year. Memoised: classification calls it per model per day. */
export function frontierActiveParamsB(year: number): number {
  let v = frontierMemo.get(year);
  if (v === undefined) {
    if (frontierMemo.size > 4096) frontierMemo.clear();
    v = frontierActiveParamsCurve(year);
    frontierMemo.set(year, v);
  }
  return v;
}

function frontierActiveParamsCurve(year: number): number {
  const a = FRONTIER_ANCHORS;
  if (year <= a[0][0]) return a[0][1];
  const [lastYear, lastValue] = a[a.length - 1];
  if (year >= lastYear) return lastValue * Math.pow(FRONTIER_GROWTH_AFTER, year - lastYear);
  for (let i = 0; i < a.length - 1; i++) {
    const [y0, v0] = a[i];
    const [y1, v1] = a[i + 1];
    if (year <= y1) {
      const t = (year - y0) / (y1 - y0);
      return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * t);
    }
  }
  return lastValue;
}

/** Upper active-param bound (B) of each limited class in that year: nano <= F/40, small <= F/8, medium <= F/3. */
export function classThresholds(year: number): { nano: number; small: number; medium: number } {
  const f = frontierActiveParamsB(year);
  return { nano: f / 40, small: f / 8, medium: f / 3 };
}

/** Upper bound of the nano class in that year (the reference size for efficiency benchmarks). */
export function nanoThresholdB(year: number): number {
  return frontierActiveParamsB(year) / 40;
}

/** Position in the class ladder. A model of rank r competes in every class of rank >= r. */
export const CLASS_RANK: Record<WeightClass, number> = { nano: 0, small: 1, medium: 2, open: 3 };

/**
 * Quality gap (overall points) between a lab's flagship and its class line, by class. Interpolated linearly between
 * the anchor years and held flat outside them. Distillation matures, so the gap shrinks.
 */
const GAP_POINTS: Record<'nano' | 'small' | 'medium', [number, number][]> = {
  nano: [[2019, 24], [2026, 13], [2032, 9]],
  small: [[2019, 15], [2026, 7], [2032, 4]],
  medium: [[2019, 7], [2026, 3], [2032, 2]],
};

export function classGap(cls: 'nano' | 'small' | 'medium', year: number): number {
  const pts = GAP_POINTS[cls];
  if (year <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, g0] = pts[i];
    const [y1, g1] = pts[i + 1];
    if (year <= y1) return g0 + ((g1 - g0) * (year - y0)) / (y1 - y0);
  }
  return pts[pts.length - 1][1];
}

/**
 * Active size of a rival flagship as a share of the frontier, by personality. Rival flagships have no published
 * size, so this estimate drives their class and their efficiency scores. Open and price labs ship lean MoE models.
 */
export const RIVAL_ACTIVE_FACTOR: Record<Personality, number> = {
  research: 1,
  hype: 1,
  safety: 1,
  chaos: 1,
  open: 0.7,
  price: 0.5,
};

/** Active params (B) estimated for a rival flagship released in `year` by a lab with this personality. */
export function rivalActiveParamsB(personality: Personality, year: number): number {
  return frontierActiveParamsB(year) * (RIVAL_ACTIVE_FACTOR[personality] ?? 1);
}
