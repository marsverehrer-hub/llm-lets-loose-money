// Daily cost (GAME_DESIGN §21.1, §21.5): where the compute money goes each day, as one bar with a line per cost.
import type { GameState } from '../../../sim/types';
import { dailyComputeCost } from '../../../sim/systems/compute';
import { formatMoney } from '../../../sim/util';
import { Card, FlowBar, HelpTip } from '../../components';

export function DailyCost({ s, burstCost }: { s: GameState; burstCost: number }) {
  const cost = dailyComputeCost(s);
  const rows = [
    {
      id: 'rent',
      label: 'Cloud rent',
      value: cost.rent,
      color: 'var(--amber-2)',
      help: 'GPUs you rent in the cloud. No upfront cost, billed every day.',
    },
    {
      id: 'power',
      label: 'Power',
      value: cost.power,
      color: 'var(--yellow)',
      help: 'Electricity for the GPUs installed in your datacenters, plus cooling (PUE 1.1 to 1.6, better in bigger buildings).',
    },
    {
      id: 'hardware',
      label: 'Hardware ops',
      value: cost.hardware,
      color: 'var(--down)',
      help: 'Maintenance contracts, networking, spares and on-call for every GPU you own: about 16% of its price a year. Owning is cheaper than renting, not free.',
    },
    {
      id: 'upkeep',
      label: 'Upkeep',
      value: cost.upkeep,
      color: 'var(--fg-3)',
      help: 'The fixed daily cost of each finished datacenter.',
    },
    {
      id: 'burst',
      label: 'Cloud burst',
      value: burstCost,
      color: 'var(--blue)',
      help: 'Serving that your own GPUs cannot cover, bought from the cloud per PF/s-day. Zero when your GPUs cover every product.',
    },
  ];
  const total = rows.reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0);
  const shown = rows.filter((r) => r.value > 0);
  return (
    <Card code="COST" title="Daily cost" subtitle={`${formatMoney(total)}/day`}>
      {total > 0 ? (
        <>
          <FlowBar
            legend={false}
            height={10}
            format={(v) => formatMoney(v)}
            segments={shown.map((r) => ({
              id: r.id,
              label: r.label,
              value: r.value,
              color: r.color,
              hatched: r.id === 'burst',
              detail: `${r.label}: ${formatMoney(r.value)}/day`,
            }))}
          />
          <ul class="cc-cost-list">
            {rows.map((r) => (
              <li key={r.id} class={r.value > 0 ? '' : 'is-zero'}>
                <i class="cc-swatch" style={`--c:${r.color}`} />
                <span class="cc-cost-name">
                  {r.label} <HelpTip>{r.help}</HelpTip>
                </span>
                <span class="cc-cost-pct">{total > 0 ? `${Math.round((r.value / total) * 100)}%` : ''}</span>
                <b class="num">{formatMoney(r.value)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p class="cc-note">Nothing to pay yet. Rent GPUs or build a datacenter to start.</p>
      )}
    </Card>
  );
}
