// Numbers and words for the treasury scene: log scales, short labels and the hover tips. Read-only over GameState.
import type { GameState } from '../../sim/types';
import { BALANCE } from '../../sim/balance';
import { canIpo, maxLoan, runwayDays } from '../../sim/systems/finance';
import { formatDate, formatMoney } from '../../sim/util';

/** A vault holding this much is full. Beyond it the vault stays full and shows x N. */
export const VAULT_FULL = 1e12;
/** Below this the vault has no bars at all. */
export const VAULT_FIRST = 1e4;

export const REV_LABEL: Record<string, string> = {
  api: 'API',
  chat: 'Chat app',
  enterprise: 'Enterprise',
  contracts: 'Contracts',
  grant: 'Grants',
  data: 'Data sales',
  other: 'Other',
};

export const EXP_LABEL: Record<string, string> = {
  compute: 'Compute',
  serving: 'Serving',
  power: 'Power',
  payroll: 'Payroll',
  staff: 'Staff',
  office: 'Office',
  data: 'Data',
  research: 'Research',
  marketing: 'Marketing',
  legal: 'Legal',
  interest: 'Interest',
  capex: 'Buildings',
  events: 'Events',
  contracts: 'Contracts',
};

/** Vault fill 0..1 on a log scale from VAULT_FIRST (0) to VAULT_FULL (1). Negative cash is an empty vault. */
export function vaultFill(cash: number): number {
  if (!(cash > 0)) return 0;
  const lo = Math.log10(VAULT_FIRST);
  const hi = Math.log10(VAULT_FULL);
  return Math.min(1, Math.max(0, (Math.log10(cash) - lo) / (hi - lo)));
}

/** Item count on a log scale: 0 at or below `lo`, `perDecade` items per factor of ten, capped. */
export function logCount(v: number, lo: number, perDecade: number, cap: number): number {
  if (!(v > 0)) return 0;
  return Math.min(cap, Math.max(0, Math.round((Math.log10(v) - Math.log10(lo)) * perDecade)));
}

/** Expense categories with money today, biggest first. */
export function expenseRows(s: GameState): { key: string; value: number }[] {
  const out: { key: string; value: number }[] = [];
  for (const key of Object.keys(s.finance.expenseBreakdown)) {
    const value = s.finance.expenseBreakdown[key] ?? 0;
    if (value > 0) out.push({ key, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

function signed(v: number): string {
  return `${v < 0 ? '-' : '+'}${formatMoney(Math.abs(v))}`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : '0%';
}

function duration(days: number): string {
  if (!isFinite(days)) return 'no end in sight';
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

/** Hover text for a SceneHit id. Values are read fresh from the state the scene last drew. */
export function tipFor(id: string, s: GameState): string {
  const f = s.finance;
  if (id === 'cash') {
    if (f.cash < 0) {
      return `Overdrawn by ${formatMoney(-f.cash)}\nNegative for ${f.negativeCashDays} of ${BALANCE.BANKRUPT_NEGATIVE_DAYS} days\nThe vault is locked and the collector is at the door`;
    }
    const net = f.dailyRevenue - f.dailyExpenses;
    const runway = runwayDays(s);
    const outlook = isFinite(runway) ? `Runway ${duration(runway)}` : 'Profitable at this run-rate';
    return `Cash ${formatMoney(f.cash)}\nNet ${signed(net)}/day\n${outlook}`;
  }
  if (id === 'revenue') {
    const rows = Object.keys(f.revenueBreakdown)
      .map((k) => ({ label: REV_LABEL[k] ?? k, value: f.revenueBreakdown[k] ?? 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
    const head = `Revenue ${formatMoney(f.dailyRevenue)}/day in`;
    if (!rows.length) return `${head}\nNothing earned yet. Products earn here.`;
    return [head, ...rows.map((r) => `${r.label} ${formatMoney(r.value)}`)].join('\n');
  }
  if (id.startsWith('expense:')) {
    const key = id.slice('expense:'.length);
    const v = f.expenseBreakdown[key] ?? 0;
    return `${EXP_LABEL[key] ?? key}: ${formatMoney(v)}/day\n${pct(v, f.dailyExpenses)} of ${formatMoney(f.dailyExpenses)}/day out`;
  }
  if (id === 'investors') {
    const n = f.roundsRaised.length;
    const lines = [`${n} round${n === 1 ? '' : 's'} raised, ${formatMoney(f.totalRaised)} in total`];
    const log = f.roundLog ?? [];
    const last = log[log.length - 1];
    if (last) lines.push(`Last: ${last.name}, ${formatMoney(last.amount)} at ${formatMoney(last.postMoney)} post-money (${formatDate(last.day)})`);
    else if (n) lines.push(`Last: ${f.roundsRaised[n - 1]}`);
    else lines.push('No investors yet');
    return lines.join('\n');
  }
  if (id === 'offer') {
    const o = f.pendingOffer;
    if (!o) return 'No term sheet on the table';
    const stake = (o.amount / (o.preMoney + o.amount)) * 100;
    const left = Math.max(0, o.expiresDay - s.day);
    return `${o.roundName} term sheet from ${o.investor}\n${formatMoney(o.amount)} for ${stake.toFixed(1)}%, ${formatMoney(o.preMoney)} pre-money\nExpires in ${left} days. Click to review`;
  }
  if (id === 'stock') {
    if (!s.company.isPublic) {
      const ipo = canIpo(s);
      return ipo.ok ? `Private. Valuation ${formatMoney(f.valuation)}\nReady to list` : `Private. ${ipo.reason}`;
    }
    const price = s.company.stockPrice;
    const first = f.history.find((h) => h.stockPrice > 0);
    const move = first && first.stockPrice > 0 ? ` (${((price / first.stockPrice - 1) * 100).toFixed(1)}% on the chart)` : '';
    return `${s.company.name}: $${price.toFixed(2)} a share${move}\nMarket value ${formatMoney(f.valuation)}`;
  }
  if (id === 'debt') {
    const room = Math.max(0, maxLoan(s) - f.debt);
    if (!(f.debt > 0)) return `No debt\nCredit room ${formatMoney(room)}`;
    return `Debt ${formatMoney(f.debt)} at ${(f.loanRatePerYear * 100).toFixed(0)}% a year\nInterest ${formatMoney((f.debt * f.loanRatePerYear) / 365)}/day\nCredit room ${formatMoney(room)}`;
  }
  return '';
}
