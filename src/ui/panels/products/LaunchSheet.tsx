// Launch a product (and a second line of a kind). A sheet, so the main screen stays about what is live.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../../store';
import { formatMoney } from '../../../sim/util';
import { previewDemand } from '../../../sim/systems/market';
import type { TierPreview } from '../../../sim/systems/market';
import { defaultPrice, launchFee, liveLines, MAX_LINES_PER_KIND, unlockedProductKinds } from '../../../sim/systems/products';
import { modelInferenceCapacityMtok } from '../../../sim/systems/compute';
import { RESEARCH } from '../../../sim/data/research';
import { BUYER_TIERS, SEGMENT_OF } from '../../../sim/types';
import type { BuyerTier, GameState, Id, Model, Product, ProductKind } from '../../../sim/types';
import { Sheet } from '../../components';
import { Empty, fmtCount, fmtPct, fmtPrice, logToValue, Range, sig2, valueToLog } from '../panelKit';
import { navigate } from '../../nav';
import { KINDS, TIER_HINT, TIER_LABEL, modelOption, priceRange, releasedModels } from './productsKit';

const LINE_PAIR = (name: string) => (/\blite\b/i.test(name) ? 'Pro' : 'Lite');

/** The buyer tiers' share at this price, for the launch preview. */
function TierGrid({ tiers }: { tiers: Record<BuyerTier, TierPreview> }) {
  return (
    <div class="pr-tier-grid">
      {BUYER_TIERS.map((t) => (
        <div key={t} class="pr-tier-cell" title={TIER_HINT[t]}>
          <span>
            <i class="pr-swatch" style={`background:${t === 'premium' ? 'var(--amber)' : t === 'mainstream' ? 'var(--blue)' : 'var(--fg-3)'}`} />
            {TIER_LABEL[t]}
          </span>
          <b class="num">{fmtPct(tiers[t].share)}</b>
          <span class="pr-note">of {fmtPct(tiers[t].weight)} buyers</span>
        </div>
      ))}
    </div>
  );
}

/** Which kind's sheet is open, and the first live line for a second-line launch. */
export function LaunchSheet({ kind, onClose }: { kind: ProductKind | null; onClose: () => void }) {
  const s = useGame();
  const first = kind ? liveLines(s, kind)[0] : undefined;
  const info = kind ? KINDS[kind] : null;
  return (
    <Sheet
      open={!!kind}
      title={info ? (first ? `Second ${info.label} line` : `Launch a ${info.label} product`) : 'Launch'}
      subtitle={info ? `Launch fee ${formatMoney(kind ? launchFee(s, kind) : 0)}` : undefined}
      onClose={onClose}
      width={560}
    >
      {kind && <LaunchForm s={s} kind={kind} first={first} onDone={onClose} />}
    </Sheet>
  );
}

function LaunchForm({ s, kind, first, onDone }: { s: GameState; kind: ProductKind; first?: Product; onDone: () => void }) {
  const info = KINDS[kind];
  const models = releasedModels(s);
  const range = priceRange(s, kind);
  const startPrice = sig2(defaultPrice(s, kind) || s.market.segments[SEGMENT_OF[kind]]?.refPrice || range.min);
  const refPrice = s.market.segments[SEGMENT_OF[kind]]?.refPrice ?? 0;
  const fee = launchFee(s, kind);
  const suggested = first ? `${s.company.name} ${info.label} ${LINE_PAIR(first.name)}` : `${s.company.name} ${info.label}`;

  const [name, setName] = useState(suggested);
  const [modelPick, setModelPick] = useState<Id | null>(null);
  const [price, setPrice] = useState(startPrice);

  const model: Model | null = models.find((m) => m.id === modelPick) ?? models[0] ?? null;
  const preview = model ? previewDemand(s, kind, model.id, price) : null;
  const capacity = model ? modelInferenceCapacityMtok(s, model) : 0;
  const aboveOwn = !!preview && capacity > 0 && preview.mtokPerDay > capacity;
  const cannotAfford = s.finance.cash < fee;

  let blocker = '';
  if (models.length === 0) blocker = 'Release a model first (MDL).';
  else if (!name.trim()) blocker = 'Name the product.';
  else if (cannotAfford) blocker = `Launch fee ${formatMoney(fee)}. Not enough cash.`;

  if (models.length === 0) return <Empty title="No released model">Products need a live model to serve.</Empty>;

  const launch = () => {
    if (blocker || !model) return;
    dispatch({ type: 'launchProduct', kind, name: name.trim().slice(0, 40), modelId: model.id, price });
    onDone();
  };

  return (
    <div class="pr-sheet">
      <p class="pr-note">{info.blurb}</p>
      {first && (
        <p class="pr-note">
          A second line sells to other buyers. Name one Pro for premium buyers and one Lite for budget buyers. It costs half the launch fee.
        </p>
      )}

      <label class="pr-field">
        <span class="pr-k">Name</span>
        <input class="input" type="text" maxLength={40} value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        {!first && <span class="pr-note">Pro for premium buyers, Lite for budget buyers.</span>}
      </label>

      <label class="pr-field">
        <span class="pr-k">Model</span>
        <select class="select" value={model?.id ?? ''} onChange={(e) => setModelPick((e.currentTarget as HTMLSelectElement).value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {modelOption(m, kind)}
            </option>
          ))}
        </select>
      </label>

      <div class="pr-field">
        <span class="pr-k">Price</span>
        <div class="pr-price-line">
          <Range
            label="Price"
            min={0}
            max={1000}
            step={1}
            stepBy={10}
            value={Math.round(valueToLog(price, range.min, range.max) * 1000)}
            onInput={(v) => setPrice(sig2(logToValue(v / 1000, range.min, range.max)))}
          />
          <span class="pr-readout num">{fmtPrice(price, info.unit)}</span>
        </div>
        <span class="pr-note">
          Market reference {fmtPrice(refPrice, info.unit)}. {info.revenueHint}.
        </span>
      </div>

      {preview && (
        <div class="pr-facts">
          <div class="pr-fact">
            <span class="pr-k">Projected {info.userWord}</span>
            <b class="num">{fmtCount(preview.users)}</b>
          </div>
          <div class="pr-fact">
            <span class="pr-k">Revenue / day</span>
            <b class="num" style="color:var(--up)">{formatMoney(preview.revenuePerDay)}</b>
          </div>
          <div class="pr-fact">
            <span class="pr-k">Demand / day</span>
            <b class="num">{fmtCount(preview.mtokPerDay)} Mtok</b>
          </div>
        </div>
      )}
      {preview && <TierGrid tiers={preview.tiers} />}
      {aboveOwn && (
        <p class="pr-note">
          Demand is above what your GPUs can serve on this model ({fmtCount(capacity)} Mtok/day). The rest is bought from the cloud, so it costs more.
        </p>
      )}

      {blocker && <div class="pr-blocker">{blocker}</div>}

      <div class="pr-sheet-foot">
        <span class="pr-note">Launch fee {formatMoney(fee)}</span>
        <button type="button" class="btn btn-primary" disabled={!!blocker} title={blocker || `Pay the ${formatMoney(fee)} launch fee and go live`} onClick={launch}>
          Launch
        </button>
      </div>
    </div>
  );
}

/** The launch tiles on the main screen: one per product kind, with a clear reason when it is locked or full. */
export function LaunchTiles({ s, onLaunch }: { s: GameState; onLaunch: (kind: ProductKind) => void }) {
  const unlocked = unlockedProductKinds(s);
  return (
    <div class="pr-tiles">
      {(['api', 'chat', 'enterprise'] as ProductKind[]).map((kind) => {
        const info = KINDS[kind];
        if (!unlocked.includes(kind)) {
          const node = RESEARCH.find((r) => r.unlocksProduct === kind);
          return (
            <div key={kind} class="pr-tile is-locked">
              <b>{info.label}</b>
              <span class="pr-note">{node ? `Research ${node.name} to unlock.` : 'Keep researching.'}</span>
              <button type="button" class="btn btn-sm" onClick={() => navigate('research')}>
                Open research
              </button>
            </div>
          );
        }
        const lines = liveLines(s, kind).length;
        if (lines >= MAX_LINES_PER_KIND) {
          return (
            <div key={kind} class="pr-tile is-full">
              <b>{info.label}</b>
              <span class="pr-note">Both lines are live. Shut one down to free a slot.</span>
            </div>
          );
        }
        return (
          <button key={kind} type="button" class="pr-tile" onClick={() => onLaunch(kind)}>
            <b>{lines === 1 ? `Second ${info.label} line` : `Launch ${info.label}`}</b>
            <span class="pr-note">{info.blurb}</span>
            <span class="pr-fee num">Fee {formatMoney(launchFee(s, kind))}</span>
          </button>
        );
      })}
    </div>
  );
}
