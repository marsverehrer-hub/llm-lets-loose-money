// v22: the player's yearly plan. Announce one per calendar year; the Annual Report's ledger judges it on 1 January.
import type { ActionHandlers, AnnualLedger, GameState, PlayerPlanId } from '../types';
import { calendarYear, clamp, notify, pushNews } from '../util';
import { ensureBoard } from './board';

export const PLAYER_PLANS: Record<PlayerPlanId, { name: string; promise: string }> = {
  ship_twice: { name: 'Ship twice', promise: 'Release at least two models this year.' },
  profitable: { name: 'Profitable year', promise: 'Earn more than you spend over the year.' },
  open_weights: { name: 'Open weights', promise: 'Release at least one open-weights model this year.' },
  top3: { name: 'Top 3', promise: 'Reach the top three of the Arena this year.' },
};

const PLAN_TUNING = {
  BRAND_STEP: 3,
  /** Board confidence step, which moves valuation the same way the board goals do. */
  CONFIDENCE_STEP: 4,
};

/** Where the year stands on a plan's promise. Zero with no ledger yet (before the first day of the game ticks). */
export function planStanding(s: GameState, id: PlayerPlanId, L: AnnualLedger | undefined): { value: number; met: boolean } {
  if (!L) return { value: 0, met: false };
  switch (id) {
    case 'ship_twice': {
      const value = s.stats.modelsReleased - L.releasedAt;
      return { value, met: value >= 2 };
    }
    case 'profitable': {
      const value = s.stats.totalRevenue - L.revenueAt - L.expenses;
      return { value, met: value > 0 };
    }
    case 'open_weights': {
      const value = s.models.filter((m) => m.releasedDay !== null && m.releasedDay >= L.from && m.releaseMode === 'open').length;
      return { value, met: value >= 1 };
    }
    case 'top3': {
      const value = L.bestRank ?? 99;
      return { value, met: value <= 3 };
    }
  }
}

/** Run by the Annual Report on 1 January, before the year's ledger is filed: keeps or breaks the year's plan. */
export function settlePlayerPlan(s: GameState, L: AnnualLedger): void {
  const p = s.playerPlan;
  if (!p || p.year !== L.year || p.kept !== undefined) return;
  const kept = planStanding(s, p.id, L).met;
  p.kept = kept;
  const sign = kept ? 1 : -1;
  s.company.brand = clamp(s.company.brand + sign * PLAN_TUNING.BRAND_STEP, 0, 100);
  const b = ensureBoard(s);
  b.confidence = clamp(b.confidence + sign * PLAN_TUNING.CONFIDENCE_STEP, 0, 100);
  const line = `${s.company.name} ${kept ? 'keeps' : 'misses'} its ${L.year} promise: ${PLAYER_PLANS[p.id].name.toLowerCase()}.`;
  pushNews(s, line, kept ? 'good' : 'bad');
  notify(s, line, kept ? 'good' : 'bad');
}

export const handlers: ActionHandlers = {
  announcePlan: (s, a) => {
    const year = calendarYear(s.day);
    if (s.playerPlan?.year === year) {
      notify(s, `The ${year} plan is already announced. One promise a year.`, 'info');
      return;
    }
    s.playerPlan = { id: a.planId, year };
    notify(s, `Announced for ${year}: ${PLAYER_PLANS[a.planId].name}. ${PLAYER_PLANS[a.planId].promise}`, 'info');
  },
};
