// Headquarters key numbers: one tile per number that decides something, each with its trend and a link to the
// screen where you act on it.
import type { ComponentChildren } from 'preact';
import type { PanelId } from '../../App';
import { runwayDays } from '../../../sim/systems/finance';
import type { FinanceSample, GameState } from '../../../sim/types';
import { formatMoney, formatNumber } from '../../../sim/util';
import { HelpTip, Popover, Sparkline, Waterfall, signedMoney } from '../../components';
import type { WaterfallStep } from '../../components';
import { liveHistory } from '../../components/derive';
import { navigate } from '../../nav';
import { PANEL_INFO } from '../../unlocks';
import { runwayLabel } from '../../shell/fmt';
import { runwayTone } from './runway';

/** Samples are weekly: the trend covers about six months, the change compares with four weeks ago. */
const TREND = 26;
const BACK = 4;

interface Tile {
  id: string;
  label: string;
  help: ComponentChildren;
  value: string;
  tone?: 'good' | 'bad' | 'warn';
  /** Change versus four weeks ago, already formatted, with its direction. */
  change?: { text: string; up: boolean; good: boolean };
  trend: number[];
  panel: PanelId;
}

function change(series: number[], fmt: (v: number) => string, upIsGood = true): Tile['change'] {
  if (series.length <= BACK) return undefined;
  const now = series[series.length - 1];
  const then = series[series.length - 1 - BACK];
  const d = now - then;
  if (!isFinite(d) || Math.abs(d) < 1e-9) return undefined;
  return { text: fmt(Math.abs(d)), up: d > 0, good: d > 0 === upIsGood };
}

/** Users by product, live. The tile shows the last weekly sample, so the total here can run a little ahead of it. */
function UsersByProduct({ s }: { s: GameState }) {
  const steps: WaterfallStep[] = s.products.filter((p) => p.active && p.users > 0).map((p) => ({ id: String(p.id), label: p.name, value: p.users }));
  return (
    <>
      <Waterfall steps={steps} end={{ label: 'Total' }} format={(v) => formatNumber(v, 1)} />
      <p class="small muted">Active products, right now.</p>
    </>
  );
}

export function KpiStrip({ s }: { s: GameState }) {
  const hist: FinanceSample[] = liveHistory(s).slice(-TREND);
  const col = (pick: (h: FinanceSample) => number) => hist.map(pick);
  const cash = col((h) => h.cash);
  const net = col((h) => h.revenue - h.expenses);
  const rev = col((h) => h.revenue);
  const users = col((h) => h.users);
  const val = col((h) => h.valuation);
  const runway = runwayDays(s);
  const netNow = s.finance.dailyRevenue - s.finance.dailyExpenses;
  const m = (v: number) => formatMoney(v, 1);

  const tiles: Tile[] = [
    {
      id: 'cash',
      label: 'Cash',
      help: 'Money in the bank. Hit zero and stay there for 30 days and the lab is bankrupt.',
      value: formatMoney(s.finance.cash, 2),
      change: change(cash, m),
      trend: cash,
      panel: 'finance',
    },
    {
      id: 'net',
      label: 'Profit per day',
      help: 'Revenue minus every cost, per day. Negative is normal early on: that is what funding is for.',
      value: signedMoney(netNow),
      tone: netNow >= 0 ? 'good' : 'bad',
      change: change(net, m),
      trend: net,
      panel: 'finance',
    },
    {
      id: 'runway',
      label: 'Runway',
      help: 'How long your cash lasts at today’s burn. Under four months, raise money or cut costs.',
      value: runwayLabel(runway),
      tone: runwayTone(runway) === 'good' ? undefined : runwayTone(runway),
      trend: cash,
      panel: 'finance',
    },
    {
      id: 'rev',
      label: 'Revenue per day',
      help: 'What products, contracts and data sales earned yesterday.',
      value: formatMoney(s.finance.dailyRevenue, 1),
      change: change(rev, m),
      trend: rev,
      panel: 'products',
    },
    {
      id: 'users',
      label: 'Users',
      help: 'People using your products. More users means more revenue, and more GPUs to serve them.',
      value: formatNumber(users[users.length - 1] ?? 0, 1),
      change: change(users, (v) => formatNumber(v, 1)),
      trend: users,
      panel: 'market',
    },
    {
      id: 'val',
      label: s.company.isPublic ? 'Market cap' : 'Valuation',
      help: 'What investors think the lab is worth. It sets how much each funding round raises.',
      value: formatMoney(s.finance.valuation, 1),
      change: change(val, m),
      trend: val,
      panel: 'finance',
    },
  ];

  // A fresh game has no history yet: one row of plain figures reads better than six empty trend cards.
  if (s.finance.history.length === 0)
    return (
      <div class="kpi-plain">
        {tiles.map((t) => (
          <div key={t.id} class="kpi-plain-item">
            <span class="kpi-plain-label">{t.label}</span>
            <span class={`kpi-plain-value num ${t.tone ?? ''}`}>{t.value}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div class="kpi-strip">
      {tiles.map((t) => (
        <div key={t.id} class={`kpi kpi-${t.id}`}>
          <span class="kpi-label">
            {t.label}
            <HelpTip>{t.help}</HelpTip>
            {t.id === 'users' && (
              <Popover label="By product" width={300} align="right" class="kpi-users-pop">
                <UsersByProduct s={s} />
              </Popover>
            )}
          </span>
          <button type="button" class="kpi-hit" onClick={() => navigate(t.panel)} aria-label={`${t.label} ${t.value}. Open ${PANEL_INFO[t.panel].label}`}>
            <span class={`kpi-value num ${t.tone ?? ''}`}>{t.value}</span>
            <span class="kpi-change">
              {t.change ? (
                <span class={t.change.good ? 'good' : 'bad'}>
                  {t.change.up ? '▲' : '▼'} {t.change.text}
                  <span class="faint"> in 4 weeks</span>
                </span>
              ) : (
                <span class="faint">No trend yet</span>
              )}
            </span>
            <Sparkline values={t.trend} height={30} fill color={t.tone === 'bad' ? 'var(--down)' : 'var(--accent)'} class="kpi-spark" />
          </button>
        </div>
      ))}
    </div>
  );
}
