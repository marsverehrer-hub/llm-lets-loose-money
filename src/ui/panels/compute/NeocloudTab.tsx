// v16 Neocloud (GAME_DESIGN §26.4): sell your own halls as a compute provider. Halls, price, deals on offer, live deals
// and revenue. Built from shared components only; the visual style comes from them.
import { dispatch, useGame } from '../../store';
import { formatDate, formatMoney } from '../../../sim/util';
import { gpuById } from '../../../sim/systems/compute';
import { NEOCLOUD_TUNING, demandIndex, freeForDeal, marketGpuPrice, neocloudDay } from '../../../sim/systems/neocloud';
import type { CapacityContract, CapacityOffer, Datacenter, GameState } from '../../../sim/types';
import { Button, DataTable, HelpTip, LineChart, Pill, SERIES, Slider, Stat } from '../../components';
import { ConfirmButton, Empty } from '../panelKit';

function num(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
function gpuName(id: string): string {
  return gpuById(id)?.name ?? id;
}
function mix(dc: Datacenter): string {
  const parts = Object.entries(dc.gpus)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${num(n)} ${gpuName(g)}`);
  return parts.length > 0 ? parts.join(', ') : 'Empty';
}

export function NeocloudTab() {
  const s = useGame();
  const n = s.neocloud;
  const halls = s.compute.datacenters.filter((d) => d.buildDaysLeft <= 0);
  if (halls.length === 0) {
    return (
      <Empty title="No halls to sell">
        Build a datacenter and install GPUs first. Then dedicate it here and sell its capacity to labs, startups and enterprises.
      </Empty>
    );
  }
  const day = neocloudDay(s);
  const revenue = day.contractRevenue + day.onDemandRevenue + day.idleRevenue;
  const dedicated = new Set(n?.dedicated ?? []);
  const gens = Object.keys({ ...day.onDemand, ...Object.fromEntries(day.deliveries.map((d) => [d.contract.gpuId, 1])) });

  return (
    <div class="cc-sheet">
      <div class="grid-kpi">
        <Stat label="Revenue / day" value={revenue} format={(v) => formatMoney(v)} tone={revenue > 0 ? 'good' : 'muted'} />
        <Stat label="Halls cost / day" value={day.hallCostPerDay} format={(v) => formatMoney(v)} hint="Power, hardware ops, upkeep" />
        <Stat label="SLA credits / day" value={day.credits} format={(v) => formatMoney(v)} tone={day.credits > 0 ? 'bad' : 'muted'} />
        <Stat label="On-demand use" value={`${Math.round((n?.utilization ?? 0) * 100)}%`} hint={`Heading to ${Math.round(day.targetUtilization * 100)}%`} />
        <Stat label="Reputation" value={Math.round(n?.reputation ?? NEOCLOUD_TUNING.START_REP)} hint="Out of 100" />
        <Stat label="GPUs sold" value={`${num(day.contractedGpus)} / ${num(day.dedicatedGpus)}`} hint="Under contract / dedicated" />
      </div>

      <div class="cc-section">
        <h4 class="cc-h">
          Halls{' '}
          <HelpTip>
            A dedicated hall leaves your own fleet: it no longer trains or serves for you, but still pays its power, hardware ops and upkeep.
            Deals run only on dedicated halls. Taking a hall back while deals run on it breaks their SLA.
          </HelpTip>
        </h4>
        <DataTable
          label="Halls"
          rows={halls}
          rowKey={(d) => d.id}
          columns={[
            { key: 'n', label: 'Hall', primary: true, cell: (d) => d.name },
            { key: 'g', label: 'GPUs', cell: (d) => mix(d) },
            {
              key: 'u',
              label: 'Upgrades',
              cell: (d) => (
                <span class="row-wrap">
                  {d.infiniband && <Pill tone="info">InfiniBand</Pill>}
                  {d.liquid && <Pill tone="cyan">liquid</Pill>}
                </span>
              ),
            },
            {
              key: 'a',
              label: '',
              cell: (d) => (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => dispatch({ type: 'setNeocloudHall', datacenterId: d.id, dedicated: !dedicated.has(d.id) })}
                >
                  {dedicated.has(d.id) ? 'Take back' : 'Dedicate'}
                </Button>
              ),
            },
          ]}
        />
        <div class="row-wrap">
          <Button size="sm" onClick={() => dispatch({ type: 'setNeocloudListIdle', on: !n?.listIdle })}>
            {n?.listIdle ? 'Stop listing idle GPUs' : 'List idle GPUs'}
          </Button>
          <span class="cc-note">
            Idle GPUs in your other halls sell at {Math.round(NEOCLOUD_TUNING.IDLE_PRICE * 100)}% of the price: your own runs take them back
            without notice.{n?.listIdle ? ` Listed now: ${num(Object.values(day.idle).reduce((a, b) => a + b, 0))}.` : ''}
          </span>
        </div>
      </div>

      <div class="cc-section">
        <h4 class="cc-h">
          On-demand price{' '}
          <HelpTip>
            The market price falls every time a newer GPU ships, and rises with AI hype and when the big clouds run out. Price above the market and
            fewer customers stay; below it and the halls fill up.
          </HelpTip>
        </h4>
        <div class="cc-buy">
          <Slider
            label="Price vs market"
            value={n?.priceMult ?? 1}
            min={NEOCLOUD_TUNING.PRICE_MIN}
            max={NEOCLOUD_TUNING.PRICE_MAX}
            step={0.05}
            onChange={(v) => dispatch({ type: 'setNeocloudPrice', mult: v })}
          />
          <span class="num">×{(n?.priceMult ?? 1).toFixed(2)}</span>
          <span class="cc-note">Demand index {demandIndex(s).toFixed(2)}</span>
        </div>
        {gens.length > 0 && (
          <DataTable
            label="Market prices"
            rows={gens}
            rowKey={(g) => g}
            columns={[
              { key: 'g', label: 'GPU', primary: true, cell: (g) => gpuName(g) },
              { key: 'm', label: 'Market / GPU-day', num: true, cell: (g) => formatMoney(marketGpuPrice(s, g), 1) },
              { key: 'y', label: 'Your price', num: true, cell: (g) => formatMoney(marketGpuPrice(s, g) * (n?.priceMult ?? 1), 1) },
              { key: 'l', label: 'On-demand GPUs', num: true, cell: (g) => num(day.onDemand[g] ?? 0) },
            ]}
          />
        )}
      </div>

      <Offers s={s} offers={n?.offers ?? []} />
      <Deals s={s} contracts={n?.contracts ?? []} delivered={new Map(day.deliveries.map((d) => [d.contract.id, d.share]))} />

      {(n?.history.length ?? 0) > 1 && (
        <div class="cc-section">
          <h4 class="cc-h">Cloud revenue per day</h4>
          <LineChart
            height={160}
            yFormat={(v) => formatMoney(v)}
            series={[{ name: 'Revenue / day', color: SERIES.amber, points: (n?.history ?? []).map((h) => ({ x: h.day, y: h.revenue })) }]}
          />
        </div>
      )}
    </div>
  );
}

function Offers({ s, offers }: { s: GameState; offers: CapacityOffer[] }) {
  return (
    <div class="cc-section">
      <h4 class="cc-h">Deals on offer</h4>
      <DataTable
        label="Deals on offer"
        rows={offers}
        rowKey={(o) => o.id}
        empty={<p class="cc-note">No offers right now. Dedicate a hall: customers ask every few weeks, more often with a good reputation.</p>}
        columns={[
          {
            key: 'c',
            label: 'Customer',
            primary: true,
            cell: (o) => (
              <span class="row-wrap">
                {o.customer} <Pill tone={o.kind === 'lab' ? 'warn' : 'muted'}>{o.kind}</Pill>
                {o.renewal && <Pill tone="good">renewal</Pill>}
              </span>
            ),
          },
          { key: 'g', label: 'GPUs', cell: (o) => `${num(o.count)} ${gpuName(o.gpuId)}${o.needsInfiniband ? ' (InfiniBand)' : ''}` },
          { key: 'm', label: 'Months', num: true, cell: (o) => o.months },
          { key: 'p', label: 'Per GPU-day', num: true, cell: (o) => formatMoney(o.price, 1) },
          { key: 'sla', label: 'SLA', num: true, cell: (o) => `${(o.sla * 100).toFixed(0)}%` },
          { key: 'v', label: 'Per day', num: true, cell: (o) => formatMoney(o.count * o.price) },
          {
            key: 'a',
            label: '',
            cell: (o) => {
              const free = freeForDeal(s, o.gpuId, o.needsInfiniband);
              return (
                <span class="row-wrap">
                  <Button
                    size="sm"
                    disabled={free < o.count}
                    title={free < o.count ? `Only ${num(free)} free in ${o.needsInfiniband ? 'InfiniBand ' : ''}dedicated halls` : `Expires ${formatDate(o.expiresDay)}`}
                    onClick={() => dispatch({ type: 'acceptCapacityDeal', offerId: o.id })}
                  >
                    Sign
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'declineCapacityDeal', offerId: o.id })}>
                    Decline
                  </Button>
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
}

function Deals({ s, contracts, delivered }: { s: GameState; contracts: CapacityContract[]; delivered: Map<string, number> }) {
  return (
    <div class="cc-section">
      <h4 class="cc-h">Live deals</h4>
      <DataTable
        label="Live deals"
        rows={contracts}
        rowKey={(c) => c.id}
        empty={<p class="cc-note">No live deals.</p>}
        columns={[
          { key: 'c', label: 'Customer', primary: true, cell: (c) => c.customer },
          { key: 'g', label: 'GPUs', cell: (c) => `${num(c.count)} ${gpuName(c.gpuId)}` },
          { key: 'p', label: 'Per GPU-day', num: true, cell: (c) => formatMoney(c.price, 1) },
          {
            key: 'd',
            label: 'Delivered',
            num: true,
            cell: (c) => {
              const share = delivered.get(c.id) ?? c.delivered;
              return <Pill tone={share + 1e-9 >= c.sla ? 'good' : 'bad'}>{`${Math.floor(share * 100)}% / ${(c.sla * 100).toFixed(0)}%`}</Pill>;
            },
          },
          { key: 'e', label: 'Ends', cell: (c) => formatDate(c.endDay) },
          {
            key: 'a',
            label: '',
            cell: (c) => (
              <ConfirmButton
                class="btn-sm"
                tone="default"
                label="Cancel"
                confirmLabel="Cancel deal?"
                title={`Refund ${formatMoney(NEOCLOUD_TUNING.CANCEL_DAYS * c.count * c.price)} and lose ${NEOCLOUD_TUNING.REP_CANCEL} reputation`}
                onConfirm={() => dispatch({ type: 'cancelCapacityDeal', contractId: c.id })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
