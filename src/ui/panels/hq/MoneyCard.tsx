// OWNER: ONBOARD (v10 agent 7). Headquarters "Money": where last day's revenue came from and where the cash went.
import { useState } from 'preact/hooks';
import type { FlowSegment } from '../../components';
import { Card, FlowBar, HelpTip, SERIES_ORDER, Stat, formatDays, signedMoney } from '../../components';
import { runwayDays } from '../../../sim/systems/finance';
import type { GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';

const REVENUE_LABEL: Record<string, string> = {
  api: 'API',
  chat: 'Chat app',
  enterprise: 'Enterprise',
  contracts: 'Contracts',
  grant: 'Grants',
  data: 'Data sales',
  other: 'Other',
};

const EXPENSE_LABEL: Record<string, string> = {
  compute: 'Compute and cloud',
  serving: 'Serving (cloud)',
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
  contracts: 'Contract delivery',
  other: 'Other',
};

/** Largest first, one colour per slice in series order. Unknown keys show their raw name. */
function slices(book: Record<string, number>, names: Record<string, string>): FlowSegment[] {
  return Object.entries(book)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, value], i) => ({ id, label: names[id] ?? id, value, color: SERIES_ORDER[i % SERIES_ORDER.length] }));
}

/** Phones show the four biggest slices (two lines of the legend grid); the rest sit behind "Show all". CSS hides them. */
const PHONE_ROWS = 4;

function Flow({ label, total, rows, empty }: { label: string; total: number; rows: FlowSegment[]; empty: string }) {
  const [more, setMore] = useState(false);
  return (
    <div class={`hq-flow ${more ? 'is-open' : ''}`}>
      <div class="hq-flow-head">
        <span class="hq-flow-label">{label}</span>
        <span class="num">{formatMoney(total, 1)}/d</span>
      </div>
      {rows.length > 0 ? <FlowBar segments={rows} format={(v) => formatMoney(v, 1)} height={12} /> : <div class="faint small">{empty}</div>}
      {rows.length > PHONE_ROWS && (
        <button type="button" class="btn hq-flow-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export function MoneyCard({ s }: { s: GameState }) {
  const inRows = slices(s.finance.revenueBreakdown, REVENUE_LABEL);
  const outRows = slices(s.finance.expenseBreakdown, EXPENSE_LABEL);
  const net = s.finance.dailyRevenue - s.finance.dailyExpenses;
  const runway = runwayDays(s);
  const runwayTone = !isFinite(runway) ? 'good' : runway < 180 ? 'bad' : runway < 540 ? 'warn' : 'good';

  return (
    <Card title="Money" subtitle="Last day">
      <div class="hq-money">
        <Flow label="In" total={s.finance.dailyRevenue} rows={inRows} empty="No revenue yet. Products earn here." />
        <Flow label="Out" total={s.finance.dailyExpenses} rows={outRows} empty="Nothing spent yet." />
        <div class="hq-money-foot">
          <Stat label="Net per day" value={net} format={(v) => signedMoney(v)} tone={net >= 0 ? 'good' : 'bad'} />
          <Stat
            label={
              <>
                Runway
                <HelpTip>Days until cash runs out at today's burn. Profit means the lab pays for itself.</HelpTip>
              </>
            }
            value={isFinite(runway) ? formatDays(runway) : 'Profit'}
            tone={runwayTone}
          />
        </div>
      </div>
    </Card>
  );
}
