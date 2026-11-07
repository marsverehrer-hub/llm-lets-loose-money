// Distilling a rival API: quotes, the cease and desist strike system, and collapse risk.
import type { GameState, Id } from '../../types';
import { frontierQuality } from '../market';
import { labName } from '../labs';
import { addExpense, calendarYear, clamp, notify, pushNews } from '../../util';
import { DATAOPS_TUNING } from './tuning';
import { costEra } from './era';
import { ops } from './state';
import { usd } from './format';

const T = DATAOPS_TUNING;

// ---------------------------------------------------------------------------
// 5. Distilling a rival's API
// ---------------------------------------------------------------------------

export type DistillQuote =
  | { ok: true; labId: Id; labName: string; modelName: string; overall: number; tokensB: number; quality: number; days: number; cost: number; collapseRisk: number }
  | { ok: false; reason: string };

/** Collapse risk of synthetic data from a model this far behind the frontier. Same curve as syntheticQuote. */
function collapseRiskFor(gap: number): number {
  return gap > 10 ? clamp(0.6 + (gap - 10) / 50, 0.6, 0.95) : clamp(0.05 + Math.max(0, gap) / 60, 0.05, 0.25);
}

export function distillQuote(s: GameState, labId: Id, tokensB: number): DistillQuote {
  const o = s.dataOps;
  if (s.day < (o?.distillBannedUntil ?? 0)) {
    return { ok: false, reason: `Distilling is banned for another ${(o?.distillBannedUntil ?? 0) - s.day} days after the last letter.` };
  }
  const rival = s.competitors.find((c) => c.id === labId && c.active && !c.human);
  if (!rival) return { ok: false, reason: 'That lab is not in the market yet.' };
  const name = labName(s, labId);
  if (!rival.model) return { ok: false, reason: `${name} has no released model worth copying.` };
  if (!Number.isFinite(tokensB) || tokensB < T.DISTILL_MIN_B || tokensB > T.DISTILL_MAX_B) {
    return { ok: false, reason: `Distilled batches run ${T.DISTILL_MIN_B}B to ${T.DISTILL_MAX_B}B tokens.` };
  }
  if ((o?.jobs ?? []).filter((j) => j.kind === 'distill').length >= T.DISTILL_MAX_JOBS) {
    return { ok: false, reason: 'Both distillation jobs are running. Wait for one to land.' };
  }
  const year = calendarYear(s.day);
  const overall = rival.model.overall;
  return {
    ok: true,
    labId,
    labName: name,
    modelName: rival.model.name,
    overall,
    tokensB,
    quality: clamp((overall / 100) * T.DISTILL_QUALITY_SCALE, 0.2, 0.9),
    days: clamp(Math.ceil(tokensB / 4), 3, 90),
    cost: tokensB * T.DISTILL_COST_PER_B_2017 * costEra(year),
    collapseRisk: collapseRiskFor(frontierQuality(year) - overall),
  };
}

/** Record one cease and desist strike. Every Nth strike is a lawsuit. Returns the new strike count. */
export function applyTosStrike(s: GameState): number {
  const o = ops(s);
  s.flags.tosStrikes = (s.flags.tosStrikes ?? 0) + 1;
  const n = s.flags.tosStrikes;
  s.company.reputation = clamp(s.company.reputation + T.TOS_STRIKE_REP, 0, 100);
  o.tosExposure = 0;
  o.tosPending = false;
  notify(s, `Strike ${n} on the terms of service. Word is getting around.`, 'bad');
  if (n % T.TOS_LAWSUIT_EVERY === 0) {
    const cost = T.TOS_LAWSUIT_COST_2017 * costEra(calendarYear(s.day));
    addExpense(s, 'legal', cost);
    s.stats.lawsuits += 1;
    pushNews(s, `A lab sues over the terms of service. Strike ${n} is now a lawsuit. Cost ${usd(cost)}.`, 'bad');
    notify(s, `Strike ${n} is a lawsuit: ${usd(cost)}.`, 'bad');
  }
  return n;
}
