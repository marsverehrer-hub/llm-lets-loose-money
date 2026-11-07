// Sheets for the Compute screen (GAME_DESIGN §21.5): manage a block, rent GPUs, build a datacenter.
// They hold the same actions as before (buy, sell, return, rent, build), only tidier and off the main screen.
import { calendarYear } from '../../../sim/util';
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../../store';
import { formatMoney } from '../../../sim/util';
import { COMPUTE_TUNING, datacenterPue, datacenterTierById, annualFailureRate, availableDatacenterTiers, availableGpus, gpuAgeYears, gpuById, ownedCostPerGpuDay, resaleFraction } from '../../../sim/systems/compute';
import { usedMarket, gpuPriceMult } from '../../../sim/systems/supply';
import { DATACENTER_TIERS } from '../../../sim/data/gpus';
import { RESEARCH } from '../../../sim/data/research';
import type { GameState, Id, SiteId } from '../../../sim/types';
import { HelpTip, Select, Sheet, FlowBar } from '../../components';
import { ConfirmButton, Empty, fmtDays, fmtRate } from '../panelKit';
import type { RoomBlock, ServerRoom } from './roomModel';
import {
  CLASS_LABEL,
  INTERCONNECT_COST_SHARE,
  INTERCONNECT_NAME,
  SITE_IDS,
  SITE_TABLE,
  allocationLeft,
  fmtDay,
  gpuClass,
  hallMw,
  interconnectOf,
  nextQuarterDay,
  preorderDeposit,
  siteLockReason,
  siteMwCap,
  siteOpen,
  unitPrice,
} from './gpuUi';

const STEPS = [1, 8, 64];

function num(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

function gpuCount(v: number): string {
  const n = Math.round(v);
  return `${num(n)} GPU${n === 1 ? '' : 's'}`;
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div class="cc-fact">
      <span class="cc-fact-k">{label}</span>
      <b class={`cc-fact-v ${tone ?? ''}`}>{value}</b>
    </div>
  );
}

/** A group of +/- buttons for one GPU type. */
function StepButtons({
  signs,
  disabled,
  title,
  onStep,
}: {
  signs: '+' | '−';
  disabled: (n: number) => boolean;
  title: (n: number) => string;
  onStep: (n: number) => void;
}) {
  return (
    <div class="cc-steps" role="group">
      {STEPS.map((n) => (
        <button key={n} type="button" class="btn btn-sm" disabled={disabled(n)} title={title(n)} onClick={() => onStep(n)}>
          {signs}
          {n}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block sheet: what one datacenter, the cloud rental or the cloud burst is doing, and its controls.
// ---------------------------------------------------------------------------

export function BlockSheet({
  s,
  room,
  blockKey,
  onClose,
  onRent,
}: {
  s: GameState;
  room: ServerRoom;
  blockKey: string | null;
  onClose: () => void;
  onRent: () => void;
}) {
  const b = blockKey ? room.blocks.find((x) => x.key === blockKey) ?? null : null;
  return (
    <Sheet open={!!blockKey} title={b ? b.name : 'Block'} subtitle={b ? b.sub : undefined} onClose={onClose} width={560}>
      {b ? (
        <BlockBody s={s} room={room} b={b} onRent={onRent} />
      ) : (
        <Empty title="Gone">This block is no longer on the server room.</Empty>
      )}
    </Sheet>
  );
}

function BlockBody({ s, room, b, onRent }: { s: GameState; room: ServerRoom; b: RoomBlock; onRent: () => void }) {
  if (b.kind === 'burst') {
    return (
      <div class="cc-sheet">
        <div class="cc-facts">
          <Fact label="PF/s bought" value={`${fmtRate(b.pflops)} PF/s`} />
          <Fact label="Cost per day" value={formatMoney(room.burstCostPerDay)} tone={room.burstCostPerDay > 0 ? 'warn' : undefined} />
          <Fact label="Price" value={`${formatMoney(room.burstPricePerPflopDay)} per PF/s-day`} />
        </div>
        <p class="cc-note">
          Cloud burst serves what your own GPUs cannot. Nothing here to manage: add GPUs, or change the fleet priority under the room.
        </p>
      </div>
    );
  }
  const isDc = b.kind === 'dc';
  const hall = isDc ? s.compute.datacenters.find((d) => d.id === b.key) : undefined;
  return (
    <div class="cc-sheet">
      <div class="cc-facts">
        <Fact label={isDc ? 'GPUs installed' : 'GPUs rented'} value={isDc ? `${num(b.installed)} of ${num(b.capacity)}` : num(b.installed)} />
        <Fact label="PF/s" value={`${fmtRate(b.pflops)} PF/s`} />
        {isDc && <Fact label="Upkeep" value={`${formatMoney(b.upkeepPerDay)}/day`} />}
        {isDc && <Fact label="Power" value={`${formatMoney(b.powerPerDay)}/day`} />}
        {hall && <Fact label="Site" value={SITE_TABLE[hall.site ?? 'grid'].name} />}
      </div>

      {b.building && <p class="cc-note">Under construction: {b.buildDaysLeft} day{b.buildDaysLeft === 1 ? '' : 's'} left. GPUs can be installed once it is finished.</p>}

      {b.installed > 0 && <JobSplit b={b} />}

      {b.gpuMix.length > 0 && (
        <div class="cc-section">
          <h4 class="cc-h">{isDc ? 'Installed GPUs' : 'Rented GPUs'}</h4>
          <ul class="cc-rows">
            {b.gpuMix.map((g) => {
              const def = gpuById(g.gpuId);
              // v16: the rental block shows every provider; these buttons return the default provider's on-demand GPUs.
              const cut = (n: number) => Math.min(n, isDc ? g.count : s.compute.rented[g.gpuId] ?? 0);
              // v14: installed GPUs age. Older ones fail more often and resell for less.
              const dc = isDc ? s.compute.datacenters.find((d) => d.id === b.key) : undefined;
              const age = dc ? gpuAgeYears(s, dc, g.gpuId) : 0;
              const resale = resaleFraction(age);
              return (
                <li key={g.gpuId} class="cc-row">
                  <div class="cc-row-main">
                    <b>{g.name}</b>
                    <span class="cc-row-meta">
                      {num(g.count)} · {fmtRate((def?.pflops ?? 0) * g.count)} PF/s
                      {dc && ` · ${age.toFixed(1)} yr old · ${Math.round(annualFailureRate(age) * 100)}% fail/yr`}
                    </span>
                  </div>
                  <div class="cc-row-actions">
                    <StepButtons
                      signs="−"
                      disabled={(n) => b.building || cut(n) < 1}
                      title={(n) =>
                        isDc
                          ? b.building
                            ? 'Wait until the datacenter is finished'
                            : `Sell ${cut(n)} for ${formatMoney((def?.buyPrice ?? 0) * resale * cut(n))} (${Math.round(resale * 100)}% of new)`
                          : `Return ${cut(n)} to the cloud`
                      }
                      onStep={(n) =>
                        isDc
                          ? dispatch({ type: 'sellGpus', datacenterId: b.key, gpuId: g.gpuId, count: cut(n) })
                          : dispatch({ type: 'rentGpus', gpuId: g.gpuId, count: -cut(n) })
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isDc && !b.building && <BuyGpus s={s} b={b} />}
      {isDc && <HallOptions s={s} dcId={b.key} />}

      {!isDc && (
        <div class="cc-section">
          <button type="button" class="btn btn-primary" onClick={onRent}>
            Rent more GPUs
          </button>
        </div>
      )}
    </div>
  );
}

/** v16 (GAME_DESIGN §26.3, §26.4): one-off upgrades and the neocloud switch for one datacenter. */
function HallOptions({ s, dcId }: { s: GameState; dcId: Id }) {
  const dc = s.compute.datacenters.find((d) => d.id === dcId);
  const tier = dc ? datacenterTierById(dc.tierId) : undefined;
  if (!dc || !tier) return null;
  const liquidCost = tier.buildCost * COMPUTE_TUNING.LIQUID_COST_SHARE;
  const fabric = interconnectOf(dc);
  const nvCost = tier.buildCost * INTERCONNECT_COST_SHARE.nvlink;
  const ibCost = tier.buildCost * INTERCONNECT_COST_SHARE.infiniband;
  const mw = hallMw(dc);
  const mwCap = siteMwCap(dc);
  const mwPct = Math.min(100, (mw / mwCap) * 100);
  const dedicated = !!s.neocloud?.dedicated.includes(dc.id);
  return (
    <div class="cc-section">
      <h4 class="cc-h">Hall options</h4>
      <div class="cc-mw">
        <span class="cc-fact-k">
          Power at {SITE_TABLE[dc.site ?? 'grid'].name}: {mw.toFixed(1)} of {num(mwCap)} MW
        </span>
        <div class="cc-mw-bar" role="meter" aria-label="Megawatts used" aria-valuemin={0} aria-valuemax={mwCap} aria-valuenow={Math.round(mw)}>
          <i class={mw >= mwCap ? 'is-full' : ''} style={{ width: `${mwPct}%` }} />
        </div>
      </div>
      <div class="cc-fabric">
        <span class="cc-fact-k">Interconnect</span>
        <b class="cc-fact-v">{INTERCONNECT_NAME[fabric]}</b>
        <div class="cc-steps" role="group">
          {fabric === 'pcie' && (
            <button
              type="button"
              class="btn btn-sm"
              disabled={s.finance.cash < nvCost}
              title={`${formatMoney(nvCost)}: clusters up to 2,048 GPUs`}
              onClick={() => dispatch({ type: 'setInterconnect', datacenterId: dc.id, tier: 'nvlink' })}
            >
              Upgrade to NVLink-ish · {formatMoney(nvCost)}
            </button>
          )}
          {fabric !== 'infiniband' && (
            <button
              type="button"
              class="btn btn-sm"
              disabled={s.finance.cash < ibCost}
              title={`${formatMoney(ibCost)}: clusters without a cap, and neocloud customers pay more`}
              onClick={() => dispatch({ type: 'setInterconnect', datacenterId: dc.id, tier: 'infiniband' })}
            >
              Upgrade to InfiniBand-ish · {formatMoney(ibCost)}
            </button>
          )}
        </div>
      </div>
      <div class="cc-steps" role="group">
        <button
          type="button"
          class="btn btn-sm"
          disabled={dc.liquid || s.finance.cash < liquidCost}
          title={dc.liquid ? 'Installed' : `${formatMoney(liquidCost)}: PUE ×${COMPUTE_TUNING.LIQUID_PUE_MULT}, failures ×${COMPUTE_TUNING.LIQUID_FAIL_MULT}`}
          onClick={() => dispatch({ type: 'upgradeDatacenter', datacenterId: dc.id, upgrade: 'liquid' })}
        >
          {dc.liquid ? 'Liquid cooled' : 'Liquid cooling'}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          title={dedicated ? 'Return this hall to your own fleet' : 'Sell this hall to cloud customers (Neocloud tab)'}
          onClick={() => dispatch({ type: 'setNeocloudHall', datacenterId: dc.id, dedicated: !dedicated })}
        >
          {dedicated ? 'Take back from neocloud' : 'Dedicate to neocloud'}
        </button>
      </div>
      <p class="cc-note">
        PUE {datacenterPue(dc).toFixed(2)}. Liquid cooling costs {formatMoney(liquidCost)}. Fabric upgrades cost a share of the hall's build price.
      </p>
    </div>
  );
}

/** The fleet's job mix, shared across blocks in proportion (the sim has no per-datacenter split yet). */
function JobSplit({ b }: { b: RoomBlock }) {
  const segments = [
    { id: 'training', label: 'Training', value: b.training, color: 'var(--mpl-2)' },
    ...b.servingBy.map((sh, i) => ({
      id: `serving-${i}`,
      label: sh.name,
      value: sh.gpus,
      color: 'var(--mpl-1)',
    })),
    { id: 'idle', label: 'Idle', value: b.idle, color: 'var(--fg-3)' },
  ].filter((x) => x.value > 0);
  return (
    <div class="cc-section">
      <h4 class="cc-h">
        What the GPUs do{' '}
        <HelpTip>
          Each block gets the fleet's job mix in proportion. The sim does not yet say which datacenter runs training, so this is an even split, not a map.
        </HelpTip>
      </h4>
      <FlowBar segments={segments.map((x) => ({ ...x, detail: `${x.label}: ${gpuCount(x.value)}` }))} format={(v) => gpuCount(v)} legend />
    </div>
  );
}

function BuyGpus({ s, b }: { s: GameState; b: RoomBlock }) {
  const gpus = availableGpus(s);
  const [pick, setPick] = useState<Id | null>(null);
  const gpu = gpus.find((g) => g.id === pick) ?? gpus[gpus.length - 1] ?? null;
  const free = Math.max(0, b.capacity - b.installed);
  const dcTier = s.compute.datacenters.find((d) => d.id === b.key)?.tierId ?? 'colo';
  if (!gpu) return <Empty title="No GPUs for sale">Nothing in the catalogue for this year yet.</Empty>;
  const price = unitPrice(s, gpu);
  const left = allocationLeft(s, gpu);
  const rationed = Number.isFinite(left);
  const used = usedMarket(s, gpu.id);
  const day = nextQuarterDay(s.day);
  const preorders = (s.preorders ?? []).filter((p) => p.datacenterId === b.key);
  const mult = gpuPriceMult(s, gpu.id);
  const cls = gpuClass(gpu);
  return (
    <div class="cc-section">
      <h4 class="cc-h">Install GPUs</h4>
      <div class="cc-buy">
        <Select
          value={gpu.id}
          ariaLabel="GPU to install"
          onChange={(v) => setPick(v)}
          options={gpus.map((g) => ({ value: g.id, label: `${g.name} · ${formatMoney(unitPrice(s, g))} each` }))}
        />
        <StepButtons
          signs="+"
          disabled={(n) => n > free || n > left || s.finance.cash < price * n}
          title={(n) =>
            n > free
              ? 'Not enough free slots'
              : n > left
                ? 'The vendor is sold out this quarter: pre-order instead'
                : s.finance.cash < price * n
                  ? 'Not enough cash'
                  : `Buy ${n} for ${formatMoney(price * n)}`
          }
          onStep={(n) => dispatch({ type: 'buyGpus', datacenterId: b.key, gpuId: gpu.id, count: n })}
        />
      </div>
      <p class="cc-note">
        {num(free)} free slot{free === 1 ? '' : 's'} of {num(b.capacity)}.{' '}
        {STEPS.map((n) => `${n} = ${formatMoney(price * n)}`).join(' · ')}
      </p>
      <p class="cc-note">
        <span class={`pill cc-class cc-class-${cls}`}>{CLASS_LABEL[cls]}</span> Allocation left this quarter:{' '}
        {rationed ? num(left) : 'no limit'} · list ×{mult.toFixed(1)}
        {mult > 1.05 ? ', demand is high' : ''}
      </p>
      {rationed && (
        <div class="cc-step-line">
          <span class="cc-step-label">Pre-order for {fmtDay(day)}</span>
          <StepButtons
            signs="+"
            disabled={(n) => n > free || s.finance.cash < preorderDeposit(s, gpu, n)}
            title={(n) =>
              n > free
                ? 'Not enough free slots'
                : `Deposit ${formatMoney(preorderDeposit(s, gpu, n))} (30%). Delivered ${fmtDay(day)}, before walk-in buyers`
            }
            onStep={(n) => dispatch({ type: 'preorderGpus', gpuId: gpu.id, count: n, datacenterId: b.key })}
          />
        </div>
      )}
      {used.count > 0 && (
        <div class="cc-step-line">
          <span class="cc-step-label">
            Buy used · {num(used.count)} at {formatMoney(used.price)} each
          </span>
          <StepButtons
            signs="+"
            disabled={(n) => n > used.count || n > free || s.finance.cash < used.price * n}
            title={(n) => `Buy ${Math.min(n, used.count)} used for ${formatMoney(used.price * Math.min(n, used.count))}, two years old`}
            onStep={(n) => dispatch({ type: 'buyUsedGpus', datacenterId: b.key, gpuId: gpu.id, count: Math.min(n, used.count) })}
          />
        </div>
      )}
      {preorders.length > 0 && (
        <div class="cc-section">
          <h4 class="cc-h">Pre-orders</h4>
          <ul class="cc-rows">
            {preorders.map((p) => (
              <li key={p.id} class="cc-row">
                <div class="cc-row-main">
                  <b>{gpuById(p.gpuId)?.name ?? p.gpuId}</b>
                  <span class="cc-row-meta">
                    {num(p.count)} · delivers {fmtDay(p.deliverDay)} · deposit {formatMoney(p.deposit)}
                  </span>
                </div>
                <div class="cc-row-actions">
                  <button type="button" class="btn btn-sm" title="Refunds half the deposit" onClick={() => dispatch({ type: 'cancelPreorder', id: p.id })}>
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* v14: owning is cheaper than renting, not free. Show the running cost next to the rent it replaces. */}
      <p class="cc-note">
        Runs at {formatMoney(ownedCostPerGpuDay(gpu, dcTier))}/day each (power, cooling, maintenance) against {formatMoney(gpu.rentPerDay)}/day to rent.
        It fails more often every year it ages.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rent: every GPU you can rent this year, with +/- buttons (the Rent tab of "Get more GPUs").
// ---------------------------------------------------------------------------

export function RentBody() {
  const s = useGame();
  // Cards older than six years drop off the shelf unless you still rent some; the newest are listed first.
  const year = calendarYear(s.day);
  const gpus = availableGpus(s)
    .filter((g) => year - g.unlockYear <= 6 || (s.compute.rented[g.id] ?? 0) > 0)
    .reverse();
  if (gpus.length === 0) return <Empty title="No GPUs listed">Nothing in the catalogue for this year yet.</Empty>;
  return (
    <ul class="cc-rows">
      {gpus.map((g) => {
        const rented = s.compute.rented[g.id] ?? 0;
        return (
          <li key={g.id} class="cc-row cc-row-rent">
            <div class="cc-row-main">
              <b>
                {g.name} <span class={`pill cc-class cc-class-${gpuClass(g)}`}>{CLASS_LABEL[gpuClass(g)]}</span>
              </b>
              <span class="cc-row-meta">
                {fmtRate(g.pflops)} PF/s · {formatMoney(g.rentPerDay)}/day each · you rent {num(rented)}
              </span>
              <span class="cc-row-flavor">{g.flavor}</span>
            </div>
            <div class="cc-row-actions">
              <div class="cc-step-line">
                <span class="cc-step-label">Rent</span>
                <StepButtons
                  signs="+"
                  disabled={() => false}
                  title={(n) => `Rent ${n} at ${formatMoney(g.rentPerDay * n)}/day`}
                  onStep={(n) => dispatch({ type: 'rentGpus', gpuId: g.id, count: n })}
                />
              </div>
              <div class="cc-step-line">
                <span class="cc-step-label">Return</span>
                <StepButtons
                  signs="−"
                  disabled={(n) => Math.min(n, rented) < 1}
                  title={(n) => (rented === 0 ? 'No rented GPUs of this type' : `Return ${Math.min(n, rented)} to the cloud`)}
                  onStep={(n) => dispatch({ type: 'rentGpus', gpuId: g.id, count: -Math.min(n, rented) })}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Build: the datacenter tiers, with cost, time to build and upkeep (the Build tab). Power price is behind Details.
// ---------------------------------------------------------------------------

export function BuildBody() {
  const s = useGame();
  const [name, setName] = useState(() => `DC ${s.compute.datacenters.length + 1}`);
  const [site, setSite] = useState<SiteId>('grid');
  const info = SITE_TABLE[site];
  const siteOk = siteOpen(s, site);
  const open = new Set(availableDatacenterTiers(s).map((t) => t.id));
  const trimmed = name.trim();
  return (
    <div class="cc-sheet">
      <label class="cc-field">
        <span class="cc-fact-k">Name</span>
        <input class="input" type="text" maxLength={32} value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="cc-field">
        <span class="cc-fact-k">Site</span>
        <Select
          value={site}
          ariaLabel="Site"
          block
          onChange={(v) => setSite(v as SiteId)}
          options={SITE_IDS.map((id) => {
            const why = siteLockReason(s, id);
            const x = SITE_TABLE[id];
            return {
              value: id,
              label: `${x.name} · power ×${x.powerPriceMult} · ${num(x.mwCap)} MW${why ? ` (${why})` : ''}`,
              disabled: !!why,
            };
          })}
        />
        <p class="cc-note">
          {info.flavor} Power ×{info.powerPriceMult}, builds ×{info.buildDaysMult} as long, caps at {num(info.mwCap)} MW, outages about{' '}
          {(info.outagePerDay * 100).toFixed(2)}% a day.
        </p>
      </div>
      {DATACENTER_TIERS.length === 0 ? (
        <Empty title="No designs yet">Blueprints are still in the drawing office.</Empty>
      ) : (
        <ul class="cc-rows">
          {DATACENTER_TIERS.map((t) => {
            const isOpen = open.has(t.id);
            const research = t.requiresResearch ? RESEARCH.find((r) => r.id === t.requiresResearch)?.name : undefined;
            const afford = s.finance.cash >= t.buildCost;
            const can = isOpen && siteOk && afford && trimmed.length > 0;
            return (
              <li key={t.id} class={`cc-row cc-row-tier ${isOpen ? '' : 'is-locked'}`}>
                <div class="cc-row-main">
                  <b>{t.name}</b>
                  <span class="cc-row-flavor">{t.flavor}</span>
                  <span class="cc-row-meta">
                    {num(t.maxGpus)} GPU slots · {formatMoney(t.buildCost)} · {fmtDays(t.buildDays * info.buildDaysMult)} to build at {info.name} ·{' '}
                    {formatMoney(t.upkeepPerDay)}/day upkeep
                  </span>
                  {!isOpen && <span class="cc-row-lock">{research ? `Needs ${research}` : `Opens ${t.unlockYear}`}</span>}
                  <details class="cc-more">
                    <summary>Details</summary>
                    <span>Power costs {(t.powerPricePerKwh * info.powerPriceMult).toFixed(2)} $/kWh at {info.name}.</span>
                  </details>
                </div>
                <div class="cc-row-actions">
                  {/* v17.2: a datacenter spends a big share of the cash, so it takes a second click. */}
                  <ConfirmButton
                    class="btn-sm cc-build"
                    tone="default"
                    label="Build"
                    confirmLabel={`Spend ${formatMoney(t.buildCost)}${s.finance.cash > 0 ? ` (${Math.round((t.buildCost / s.finance.cash) * 100)}% of cash)` : ''}?`}
                    disabled={!can}
                    title={!isOpen ? 'Not available yet' : !siteOk ? 'This site is not open yet' : !afford ? 'Not enough cash' : trimmed ? `Build ${t.name}` : 'Name it first'}
                    onConfirm={() => dispatch({ type: 'buildDatacenter', tierId: t.id, name: trimmed, site })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

