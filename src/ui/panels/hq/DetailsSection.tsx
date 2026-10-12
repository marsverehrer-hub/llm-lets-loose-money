// OWNER: ONBOARD (v10 agent 7). Headquarters "Details": the charts, lab focus and full product numbers.
// v10.1: shown inline. Players found the closed drawer one submenu too many.
import { useState } from 'preact/hooks';
import type { GameState } from '../../../sim/types';
import { formatMoney, formatNumber } from '../../../sim/util';
import { Card, LineChart, SERIES, Stat, Tabs, formatPct, signedMoney } from '../../components';
import type { LineSeries } from '../../components';
import { liveHistory } from '../../components/derive';
import { LabFocusCard } from './LabFocusCard';

type Metric = 'cash' | 'flow' | 'valuation';
const METRIC_TITLE: Record<Metric, string> = { cash: 'Cash', flow: 'Revenue vs burn', valuation: 'Valuation' };
const money = (v: number) => formatMoney(v, 1);

function ChartCard({ s }: { s: GameState }) {
  const [metric, setMetric] = useState<Metric>('cash');
  const hist = liveHistory(s);
  const pts = (pick: (h: (typeof hist)[number]) => number) => hist.map((h) => ({ x: h.day, y: pick(h) }));
  const series: LineSeries[] =
    metric === 'cash'
      ? [{ name: 'Cash', color: SERIES.amber, points: pts((h) => h.cash) }]
      : metric === 'valuation'
        ? [{ name: 'Valuation', color: SERIES.amber, points: pts((h) => h.valuation) }]
        : [
            { name: 'Revenue / day', color: SERIES.amber, points: pts((h) => h.revenue) },
            { name: 'Expenses / day', color: SERIES.fg, points: pts((h) => h.expenses) },
          ];
  return (
    <Card
      title={METRIC_TITLE[metric]}
      subtitle="Weekly samples, live"
      actions={
        <Tabs<Metric>
          variant="segmented"
          value={metric}
          onChange={setMetric}
          tabs={[
            { id: 'cash', label: 'Cash' },
            { id: 'flow', label: 'Rev vs burn' },
            { id: 'valuation', label: 'Valuation' },
          ]}
        />
      }
    >
      <LineChart series={series} height={240} yFormat={money} emptyText="First point lands after a week." />
    </Card>
  );
}

function CompanyCard({ s }: { s: GameState }) {
  const users = s.products.filter((p) => p.active).reduce((a, p) => a + p.users, 0);
  return (
    <Card title="Company" subtitle={s.company.isPublic ? 'Public' : 'Private'}>
      <div class="hq-company">
        <Stat label="Valuation" value={s.finance.valuation} format={money} />
        <Stat label="Founder stake" value={s.company.founderEquity} format={(v) => formatPct(v, 1)} />
        <Stat label="Users, all products" value={users} format={(v) => formatNumber(v, 1)} />
        <Stat label="Net per day" value={s.finance.dailyRevenue - s.finance.dailyExpenses} format={(v) => signedMoney(v)} />
      </div>
    </Card>
  );
}

/** The lower half of Headquarters: the money chart, lab focus and company numbers. Always shown, no disclosure. */
export function DetailsSection({ s }: { s: GameState }) {
  return (
    <div class="hq-details-body">
      <ChartCard s={s} />
      <div class="hq-details-grid">
        <LabFocusCard s={s} />
        <CompanyCard s={s} />
      </div>
    </div>
  );
}
