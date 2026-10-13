// Sheets for the Compute screen (GAME_DESIGN §21.5): manage a block, rent GPUs, build a datacenter.
// They hold the same actions as before (buy, sell, return, rent, build), only tidier and off the main screen.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../../store';
import { formatMoney } from '../../../sim/util';
import { COMPUTE_TUNING, annualFailureRate, availableDatacenterTiers, availableGpus, gpuAgeYears, gpuById, ownedCostPerGpuDay, resaleFraction } from '../../../sim/systems/compute';
import { DATACENTER_TIERS } from '../../../sim/data/gpus';
import { RESEARCH } from '../../../sim/data/research';
import type { GameState, Id } from '../../../sim/types';
import { HelpTip, Sheet, FlowBar } from '../../components';
import { Empty, fmtDays, fmtRate } from '../panelKit';
import type { RoomBlock, ServerRoom } from './roomModel';

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
  return (
    <div class="cc-sheet">
      <div class="cc-facts">
        <Fact label={isDc ? 'GPUs installed' : 'GPUs rented'} value={isDc ? `${num(b.installed)} of ${num(b.capacity)}` : num(b.installed)} />
        <Fact label="PF/s" value={`${fmtRate(b.pflops)} PF/s`} />
        {isDc && <Fact label="Upkeep" value={`${formatMoney(b.upkeepPerDay)}/day`} />}
        {isDc && <Fact label="Power" value={`${formatMoney(b.powerPerDay)}/day`} />}
      </div>

      {b.building && <p class="cc-note">Under construction: {b.buildDaysLeft} day{b.buildDaysLeft === 1 ? '' : 's'} left. GPUs can be installed once it is finished.</p>}

      {b.installed > 0 && <JobSplit b={b} />}

      {b.gpuMix.length > 0 && (
        <div class="cc-section">
          <h4 class="cc-h">{isDc ? 'Installed GPUs' : 'Rented GPUs'}</h4>
          <ul class="cc-rows">
            {b.gpuMix.map((g) => {
              const def = gpuById(g.gpuId);
              const cut = (n: number) => Math.min(n, g.count);
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

/** The fleet's job mix, shared across blocks in proportion (the sim has no per-datacenter split yet). */
function JobSplit({ b }: { b: RoomBlock }) {
  const segments = [
    { id: 'training', label: 'Training', value: b.training, color: 'var(--amber)' },
    ...b.servingBy.map((sh, i) => ({
      id: `serving-${i}`,
      label: sh.name,
      value: sh.gpus,
      color: `var(--blue)`,
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
  return (
    <div class="cc-section">
      <h4 class="cc-h">Install GPUs</h4>
      <div class="cc-buy">
        <select class="select" value={gpu.id} onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}>
          {gpus.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {formatMoney(g.buyPrice)} each
            </option>
          ))}
        </select>
        <StepButtons
          signs="+"
          disabled={(n) => n > free || s.finance.cash < gpu.buyPrice * n}
          title={(n) =>
            n > free ? 'Not enough free slots' : s.finance.cash < gpu.buyPrice * n ? 'Not enough cash' : `Buy ${n} for ${formatMoney(gpu.buyPrice * n)}`
          }
          onStep={(n) => dispatch({ type: 'buyGpus', datacenterId: b.key, gpuId: gpu.id, count: n })}
        />
      </div>
      <p class="cc-note">
        {num(free)} free slot{free === 1 ? '' : 's'} of {num(b.capacity)}.{' '}
        {STEPS.map((n) => `${n} = ${formatMoney(gpu.buyPrice * n)}`).join(' · ')}
      </p>
      {/* v14: owning is cheaper than renting, not free. Show the running cost next to the rent it replaces. */}
      <p class="cc-note">
        Runs at {formatMoney(ownedCostPerGpuDay(gpu, dcTier))}/day each (power, cooling, maintenance) against {formatMoney(gpu.rentPerDay)}/day to rent.
        It fails more often every year it ages.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rent sheet: every GPU you can rent this year, with +/- buttons.
// ---------------------------------------------------------------------------

export function RentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Rent GPUs" subtitle="No upfront cost. Billed every day." onClose={onClose} width={620}>
      {open && <RentBody />}
    </Sheet>
  );
}

export function RentBody() {
  const s = useGame();
  const gpus = availableGpus(s);
  if (gpus.length === 0) return <Empty title="No GPUs listed">Nothing in the catalogue for this year yet.</Empty>;
  return (
    <ul class="cc-rows">
      {gpus.map((g) => {
        const rented = s.compute.rented[g.id] ?? 0;
        return (
          <li key={g.id} class="cc-row cc-row-rent">
            <div class="cc-row-main">
              <b>{g.name}</b>
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
// Build sheet: the datacenter tiers, with cost, time to build and upkeep. Power price is behind Details.
// ---------------------------------------------------------------------------

export function BuildSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Build a datacenter" subtitle="Takes days to build, then upkeep every day." onClose={onClose} width={680}>
      {open && <BuildBody />}
    </Sheet>
  );
}

export function BuildBody() {
  const s = useGame();
  const [name, setName] = useState(() => `DC ${s.compute.datacenters.length + 1}`);
  const open = new Set(availableDatacenterTiers(s).map((t) => t.id));
  const trimmed = name.trim();
  return (
    <div class="cc-sheet">
      <label class="cc-field">
        <span class="cc-fact-k">Name</span>
        <input class="input" type="text" maxLength={32} value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {DATACENTER_TIERS.length === 0 ? (
        <Empty title="No designs yet">Blueprints are still in the drawing office.</Empty>
      ) : (
        <ul class="cc-rows">
          {DATACENTER_TIERS.map((t) => {
            const isOpen = open.has(t.id);
            const research = t.requiresResearch ? RESEARCH.find((r) => r.id === t.requiresResearch)?.name : undefined;
            const afford = s.finance.cash >= t.buildCost;
            const can = isOpen && afford && trimmed.length > 0;
            return (
              <li key={t.id} class={`cc-row cc-row-tier ${isOpen ? '' : 'is-locked'}`}>
                <div class="cc-row-main">
                  <b>{t.name}</b>
                  <span class="cc-row-flavor">{t.flavor}</span>
                  <span class="cc-row-meta">
                    {num(t.maxGpus)} GPU slots · {formatMoney(t.buildCost)} · {fmtDays(t.buildDays)} to build · {formatMoney(t.upkeepPerDay)}/day upkeep
                  </span>
                  {!isOpen && <span class="cc-row-lock">{research ? `Needs ${research}` : `Opens ${t.unlockYear}`}</span>}
                  <details class="cc-more">
                    <summary>Details</summary>
                    <span>Power costs {t.powerPricePerKwh.toFixed(2)} $/kWh here.</span>
                  </details>
                </div>
                <div class="cc-row-actions">
                  <button
                    type="button"
                    class="btn btn-sm"
                    disabled={!can}
                    title={!isOpen ? 'Not available yet' : !afford ? 'Not enough cash' : trimmed ? `Build ${t.name}` : 'Name it first'}
                    onClick={() => dispatch({ type: 'buildDatacenter', tierId: t.id, name: trimmed })}
                  >
                    Build
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

