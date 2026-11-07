// Refinery: quality gains from cleaning an owned set, with diminishing returns per pass.
import type { GameState, Id } from '../../types';
import { GPUS } from '../../data/gpus';
import { datasetById, DATA_TUNING } from '../data';
import { calendarYear } from '../../util';
import { DATAOPS_TUNING } from './tuning';
import { costEra } from './era';
import { refineLevelDef, type RefineLevelDef } from './catalogue';
import { crawlSetId } from './crawler';
import { pct } from './format';

const T = DATAOPS_TUNING;

function cheapestPfDayPrice(year: number): number {
  let best = Infinity;
  for (const g of GPUS) if (g.unlockYear <= year && g.pflops > 0) best = Math.min(best, g.rentPerDay / g.pflops);
  return Number.isFinite(best) ? best : 0;
}

/** True while a set is still being fed, so refining it would freeze a moving target. */
function isGrowing(s: GameState, id: Id): boolean {
  if (id === crawlSetId(calendarYear(s.day))) return true;
  if (id === DATA_TUNING.USER_CHATS_ID && s.data.userDataOptIn) return true;
  return (s.dataOps?.streams ?? []).some((st) => st.datasetId === id && st.endDay > s.day);
}

// ---------------------------------------------------------------------------
// 2. Refinery
// ---------------------------------------------------------------------------

export type RefineQuote =
  | { ok: true; level: RefineLevelDef; from: number; quality: number; gain: number; tokensB: number; days: number; cost: number; passes: number }
  | { ok: false; reason: string };

function refineCost(s: GameState, days: number): number {
  const year = calendarYear(s.day);
  const cloud = s.compute.totalPflops * T.REFINE_CLUSTER_SHARE * cheapestPfDayPrice(year) * days;
  return Math.max(cloud, days * T.REFINE_MIN_COST_PER_DAY * costEra(year));
}

/** What refining an owned set at this level would do. Diminishing returns: each pass gains half of the last. */
export function refineQuote(s: GameState, datasetId: Id, level: number): RefineQuote {
  const lvl = refineLevelDef(level);
  if (!lvl) return { ok: false, reason: 'Pick light, standard or deep.' };
  const d = datasetById(s, datasetId);
  if (!d) return { ok: false, reason: 'Unknown dataset.' };
  if (!s.data.owned.includes(datasetId)) return { ok: false, reason: `You don't own ${d.name} yet.` };
  if (isGrowing(s, datasetId)) return { ok: false, reason: `${d.name} is still growing. Refine it once its feed stops.` };
  const jobs = s.dataOps?.jobs ?? [];
  if (jobs.some((j) => j.kind === 'refine' && j.datasetId === datasetId)) return { ok: false, reason: `${d.name} is already in the refinery.` };
  if (jobs.filter((j) => j.kind === 'refine').length >= T.REFINE_SLOTS) return { ok: false, reason: 'Both refinery lines are busy.' };
  const passes = s.data.refined?.[datasetId]?.passes ?? 0;
  const quality = Math.min(T.REFINE_CAP, d.quality + lvl.gain * T.REFINE_DIMINISH ** passes);
  const gain = quality - d.quality;
  if (gain < T.REFINE_MIN_GAIN) return { ok: false, reason: `Nothing left to gain on ${d.name} at ${pct(d.quality)}.` };
  return {
    ok: true,
    level: lvl,
    from: d.quality,
    quality,
    gain,
    tokensB: d.tokensB * (1 - lvl.shrink),
    days: lvl.days,
    cost: refineCost(s, lvl.days),
    passes,
  };
}
