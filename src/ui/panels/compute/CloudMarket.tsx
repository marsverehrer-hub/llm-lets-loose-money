// v16 Cloud providers (GAME_DESIGN §26.1, §26.2): compare providers for one GPU, rent on-demand or spot, reserve for a
// term, and see every cloud lease you hold. Built from shared components only; the visual style comes from them.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../../store';
import { formatMoney, formatDate, yearOf } from '../../../sim/util';
import { availableGpus, gpuById } from '../../../sim/systems/compute';
import { CLOUD_PROVIDERS, DEFAULT_PROVIDER_ID, providerById, type CloudProviderDef } from '../../../sim/data/clouds';
import {
  CLOUD_TERMS,
  cloudOf,
  earlyExitPenalty,
  inCrunch,
  leasePrice,
  leaseUp,
  onDemandPrice,
  preemptChance,
  providerQuota,
  providerUsage,
  quotaLeft,
  reservedPrice,
  spotPrice,
  stockedFrom,
  stocks,
} from '../../../sim/systems/cloudMarket';
import type { CloudTerm, GameState, GpuDef, Id } from '../../../sim/types';
import { Button, DataTable, HelpTip, Pill, Select } from '../../components';
import { ConfirmButton, Empty } from '../panelKit';

function num(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
function price(v: number): string {
  return Number.isFinite(v) ? formatMoney(v, 1) : '-';
}

interface ProviderRow {
  p: CloudProviderDef;
  open: boolean;
  stocked: boolean;
  stockNote: string;
}

function stockNote(p: CloudProviderDef, g: GpuDef, year: number): string {
  if (year < p.openYear) return `Opens ${p.openYear}`;
  if (stocks(p, g, year)) return 'In stock';
  const from = stockedFrom(p, g);
  return year < from ? `From ${Math.ceil(from)}` : 'Retired';
}

export function CloudMarket() {
  const s = useGame();
  const gpus = availableGpus(s);
  const [gpuId, setGpuId] = useState<Id | null>(null);
  const [pid, setPid] = useState<Id>(DEFAULT_PROVIDER_ID);
  const [count, setCount] = useState(8);
  const gpu = gpus.find((g) => g.id === gpuId) ?? gpus[gpus.length - 1];
  if (!gpu) return <Empty title="No GPUs listed">Nothing in the catalogue for this year yet.</Empty>;
  const year = yearOf(s.day);
  const rows: ProviderRow[] = CLOUD_PROVIDERS.map((p) => ({
    p,
    open: year >= p.openYear,
    stocked: stocks(p, gpu, year),
    stockNote: stockNote(p, gpu, year),
  }));
  const sel = providerById(pid) ?? CLOUD_PROVIDERS[0];

  return (
    <div class="cc-sheet">
      <div class="cc-buy">
        <Select
          value={gpu.id}
          ariaLabel="GPU"
          onChange={(v) => setGpuId(v)}
          options={gpus.map((g) => ({ value: g.id, label: `${g.name} · list ${formatMoney(g.rentPerDay)}/day` }))}
        />
        <HelpTip>
          Prices are per GPU per day. Quotas grow every year and halve in a crunch. A new generation is scarce for its first year. Spot is
          cheap but can be preempted; reserved terms are cheap but billed whether you use them or not.
        </HelpTip>
      </div>

      <DataTable
        label="Cloud providers"
        rows={rows}
        rowKey={(r) => r.p.id}
        rowClass={(r) => (r.p.id === sel.id ? 'sel' : '')}
        mobile="scroll"
        columns={[
          {
            key: 'name',
            label: 'Provider',
            primary: true,
            cell: (r) => (
              <span class="row-wrap">
                <Button size="sm" variant={r.p.id === sel.id ? 'default' : 'ghost'} onClick={() => setPid(r.p.id)} title={r.p.flavor}>
                  {r.p.name}
                </Button>
                <Pill tone="muted">{r.p.kind}</Pill>
                {inCrunch(s, r.p.id) && <Pill tone="bad">crunch</Pill>}
              </span>
            ),
          },
          { key: 'od', label: 'On-demand', num: true, cell: (r) => (r.p.onDemand ? price(onDemandPrice(s, r.p, gpu)) : '-') },
          { key: 'spot', label: 'Spot', num: true, cell: (r) => price(spotPrice(s, r.p, gpu)) },
          { key: 'r12', label: '1-yr', num: true, cell: (r) => price(reservedPrice(s, r.p, gpu, 12)) },
          { key: 'r36', label: '3-yr', num: true, cell: (r) => price(reservedPrice(s, r.p, gpu, 36)) },
          { key: 'stock', label: 'Stock', cell: (r) => <Pill tone={r.stocked ? 'good' : 'muted'}>{r.stockNote}</Pill> },
          {
            key: 'quota',
            label: 'Yours / quota',
            num: true,
            cell: (r) => (r.open ? `${num(providerUsage(s, r.p.id))} / ${num(providerQuota(s, r.p))}` : '-'),
          },
        ]}
      />

      <ProviderOrder s={s} p={sel} gpu={gpu} count={count} setCount={setCount} />
      <Leases s={s} />
    </div>
  );
}

function ProviderOrder({ s, p, gpu, count, setCount }: { s: GameState; p: CloudProviderDef; gpu: GpuDef; count: number; setCount: (n: number) => void }) {
  const left = quotaLeft(s, p, gpu);
  const n = Math.max(1, Math.floor(count) || 1);
  const od = onDemandPrice(s, p, gpu);
  const spot = spotPrice(s, p, gpu);
  const leaseKind = (kind: 'ondemand' | 'spot') =>
    kind === 'ondemand' && p.id === DEFAULT_PROVIDER_ID
      ? s.compute.rented[gpu.id] ?? 0
      : cloudOf(s).leases.filter((l) => l.providerId === p.id && l.gpuId === gpu.id && l.kind === kind).reduce((a, l) => a + l.count, 0);
  const haveOd = leaseKind('ondemand');
  const haveSpot = leaseKind('spot');
  const afford = (perDay: number) => s.finance.cash >= perDay;
  return (
    <div class="cc-section">
      <h4 class="cc-h">
        {p.name} · {gpu.name}
      </h4>
      <p class="cc-note">{p.flavor}</p>
      <div class="cc-facts">
        <div class="cc-fact">
          <span class="cc-fact-k">Quota left</span>
          <b class="cc-fact-v">{num(left)} GPUs</b>
        </div>
        <div class="cc-fact">
          <span class="cc-fact-k">You hold here</span>
          <b class="cc-fact-v">
            {num(haveOd)} on-demand · {num(haveSpot)} spot
          </b>
        </div>
        {p.spot && (
          <div class="cc-fact">
            <span class="cc-fact-k">Spot preemption</span>
            <b class="cc-fact-v">{(preemptChance(s, p) * 100).toFixed(0)}% a day</b>
          </div>
        )}
      </div>
      <div class="cc-buy">
        <label class="cc-field">
          <span class="cc-fact-k">GPUs</span>
          <input
            class="input"
            type="number"
            min={1}
            step={1}
            value={n}
            onInput={(e) => setCount(Number((e.currentTarget as HTMLInputElement).value))}
          />
        </label>
      </div>
      <div class="row-wrap">
        {p.onDemand && (
          <Button
            size="sm"
            variant="primary"
            disabled={left < 1 || !afford(od * Math.min(n, left))}
            title={`${num(Math.min(n, left))} at ${formatMoney(od * Math.min(n, left))}/day`}
            onClick={() => dispatch({ type: 'rentCloud', providerId: p.id, gpuId: gpu.id, count: n })}
          >
            Rent on-demand
          </Button>
        )}
        {p.spot && (
          <Button
            size="sm"
            disabled={left < 1 || !afford(spot * Math.min(n, left))}
            title={`${num(Math.min(n, left))} at ${formatMoney(spot * Math.min(n, left))}/day, can be preempted`}
            onClick={() => dispatch({ type: 'rentCloud', providerId: p.id, gpuId: gpu.id, count: n, spot: true })}
          >
            Rent spot
          </Button>
        )}
        {CLOUD_TERMS.filter((t) => p.reserved[t] !== undefined).map((t: CloudTerm) => {
          const r = reservedPrice(s, p, gpu, t);
          return (
            <Button
              key={t}
              size="sm"
              disabled={n > left || s.finance.cash < r * n * 30}
              title={`${num(n)} for ${t} months at ${formatMoney(r * n)}/day (${Math.round((p.reserved[t] ?? 0) * 100)}% off). Needs a month of the bill in cash.`}
              onClick={() => dispatch({ type: 'commitCloud', providerId: p.id, gpuId: gpu.id, count: n, months: t })}
            >
              Reserve {t === 12 ? '1 yr' : '3 yr'}
            </Button>
          );
        })}
        {haveOd > 0 && (
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'rentCloud', providerId: p.id, gpuId: gpu.id, count: -Math.min(n, haveOd) })}>
            Return {num(Math.min(n, haveOd))}
          </Button>
        )}
        {haveSpot > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => dispatch({ type: 'rentCloud', providerId: p.id, gpuId: gpu.id, count: -Math.min(n, haveSpot), spot: true })}
          >
            Return {num(Math.min(n, haveSpot))} spot
          </Button>
        )}
      </div>
    </div>
  );
}

interface LeaseRow {
  key: string;
  provider: string;
  gpu: string;
  kind: 'on-demand' | 'spot' | 'reserved';
  count: number;
  perDay: number;
  status: string;
  leaseId?: Id;
  penalty: number;
}

function Leases({ s }: { s: GameState }) {
  const def = providerById(DEFAULT_PROVIDER_ID);
  const rows: LeaseRow[] = [];
  for (const [gid, n] of Object.entries(s.compute.rented)) {
    const g = gpuById(gid);
    if (!g || n <= 0 || !def) continue;
    rows.push({ key: `legacy-${gid}`, provider: def.name, gpu: g.name, kind: 'on-demand', count: n, perDay: n * onDemandPrice(s, def, g), status: 'Daily', penalty: 0 });
  }
  for (const l of cloudOf(s).leases) {
    const kind = l.kind === 'ondemand' ? 'on-demand' : l.kind;
    const status =
      l.kind === 'reserved'
        ? `Ends ${formatDate(l.endDay ?? s.day)}`
        : l.kind === 'spot' && !leaseUp(s, l)
          ? `Preempted until ${formatDate(l.downUntil ?? s.day)}`
          : 'Daily';
    rows.push({
      key: l.id,
      provider: providerById(l.providerId)?.name ?? l.providerId,
      gpu: gpuById(l.gpuId)?.name ?? l.gpuId,
      kind,
      count: l.count,
      perDay: l.count * leasePrice(s, l),
      status,
      leaseId: l.kind === 'reserved' ? l.id : undefined,
      penalty: earlyExitPenalty(s, l),
    });
  }
  return (
    <div class="cc-section">
      <h4 class="cc-h">Your cloud GPUs</h4>
      <DataTable
        label="Your cloud GPUs"
        rows={rows}
        rowKey={(r) => r.key}
        empty={<p class="cc-note">No cloud GPUs. Rent from a provider above.</p>}
        columns={[
          { key: 'p', label: 'Provider', primary: true, cell: (r) => r.provider },
          { key: 'g', label: 'GPU', cell: (r) => r.gpu },
          { key: 'k', label: 'Kind', cell: (r) => <Pill tone={r.kind === 'reserved' ? 'info' : r.kind === 'spot' ? 'warn' : 'default'}>{r.kind}</Pill> },
          { key: 'n', label: 'GPUs', num: true, cell: (r) => num(r.count) },
          { key: 'c', label: 'Per day', num: true, cell: (r) => formatMoney(r.perDay) },
          { key: 's', label: 'Status', cell: (r) => r.status },
          {
            key: 'a',
            label: '',
            cell: (r) =>
              r.leaseId ? (
                <ConfirmButton
                  class="btn-sm"
                  tone="default"
                  label="End early"
                  confirmLabel={`Pay ${formatMoney(r.penalty)}?`}
                  disabled={s.finance.cash < r.penalty}
                  title={`Ending early costs ${formatMoney(r.penalty)} (half of what is left)`}
                  onConfirm={() => dispatch({ type: 'endCloudCommit', leaseId: r.leaseId! })}
                />
              ) : null,
          },
        ]}
      />
    </div>
  );
}
