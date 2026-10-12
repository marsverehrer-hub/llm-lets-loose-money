import { getBonuses } from '../../sim/bonuses';
import type { FinanceSample, GameState } from '../../sim/types';
import { ROLE_IDS } from '../../sim/types';

/** Finance history plus a live sample for today, so charts move every day instead of every week. */
export function liveHistory(s: GameState): FinanceSample[] {
  const h = s.finance.history;
  const last = h[h.length - 1];
  if (last && last.day === s.day) return h;
  const users = s.products.filter((p) => p.active).reduce((a, p) => a + p.users, 0);
  return [
    ...h,
    {
      day: s.day,
      cash: s.finance.cash,
      revenue: s.finance.dailyRevenue,
      expenses: s.finance.dailyExpenses,
      valuation: s.finance.valuation,
      users,
      stockPrice: s.company.stockPrice,
    },
  ];
}

/** Total people on payroll across all roles. */
export function headcount(s: GameState): number {
  return ROLE_IDS.reduce((a, r) => a + s.staff.roles[r].count, 0);
}

/**
 * Progress and ETA of the active training run. The ETA is an estimate:
 * current training PFLOPS times training speed and researcher strength.
 */
export function trainingStatus(s: GameState): { frac: number; days: number } | null {
  const t = s.training;
  if (!t) return null;
  const frac = t.totalFlops > 0 ? Math.min(1, Math.max(0, t.doneFlops / t.totalFlops)) : 0;
  const r = s.staff.roles.researcher;
  const researcherStrength = r.count * r.skill * (0.6 + (0.8 * s.staff.morale) / 100);
  const perDay = s.compute.trainingPflops * 1e15 * 86400 * getBonuses(s).trainingSpeed * (1 + 0.03 * Math.sqrt(Math.max(0, researcherStrength)));
  const days = perDay > 0 ? Math.max(0, (t.totalFlops - t.doneFlops) / perDay) + (t.overheadLeft ?? 0) : Infinity;
  return { frac, days };
}

export const KIND_LABEL: Record<string, string> = { api: 'API', chat: 'Chat', enterprise: 'Enterprise' };
export const KIND_TONE: Record<string, 'violet' | 'cyan' | 'info'> = { api: 'violet', chat: 'cyan', enterprise: 'info' };
