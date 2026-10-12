// OWNER: ONBOARD (v10 agent 7). Headquarters "Products at a glance": revenue per day per live product as bars.
import type { GameState } from '../../../sim/types';
import { formatMoney, formatNumber } from '../../../sim/util';
import { BarList, Button, Card, EmptyState, Pill, SERIES } from '../../components';
import type { BarRow } from '../../components';
import { KIND_LABEL } from '../../components/derive';
import { navigate } from '../../nav';

const KIND_COLOR: Record<string, string> = { api: SERIES.amber, chat: SERIES.blue, enterprise: SERIES.yellow };

export function ProductsCard({ s }: { s: GameState }) {
  const live = s.products.filter((p) => p.active);
  const rows: BarRow[] = live.map((p) => ({
    id: String(p.id),
    label: p.name,
    sub: `${KIND_LABEL[p.kind] ?? p.kind} · ${formatNumber(p.users, 1)} users`,
    value: p.revenuePerDay,
    color: KIND_COLOR[p.kind],
    extra: p.servedFraction < 1 ? <Pill tone="bad" title="Some users are not being served. Buy compute.">Short</Pill> : undefined,
  }));

  return (
    <Card
      title="Products"
      code="PRD"
      subtitle={live.length ? `${live.length} live` : 'Nothing shipped'}
      actions={
        <Button variant="ghost" size="sm" onClick={() => navigate('products')}>
          Manage
        </Button>
      }
    >
      {rows.length > 0 ? (
        <BarList rows={rows} format={(v) => `${formatMoney(v, 1)}/d`} />
      ) : (
        <EmptyState
          title="Nothing shipped"
          text="A model in a drawer earns nothing."
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('products')}>
              Open Products
            </Button>
          }
        />
      )}
    </Card>
  );
}
