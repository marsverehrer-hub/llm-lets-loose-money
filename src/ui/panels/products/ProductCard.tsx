// One live product as a visual card: users, revenue against serving cost, the margin bar, model and price.
// Satisfaction, auto-upgrade and shut down sit in the card footer (v10.1: no Details popover).
import { useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { formatMoney } from '../../../sim/util';
import { previewDemand } from '../../../sim/systems/market';

import { BUYER_TIERS } from '../../../sim/types';
import type { BuyerTier, GameState, Product, ProductKind } from '../../../sim/types';
import { Card, Meter, Pill, Sparkline } from '../../components';
import { ConfirmButton, Range, fmtCount, fmtPct, fmtPrice, logToValue, sig2, valueToLog } from '../panelKit';
import { KINDS, TIER_HINT, TIER_LABEL, economics, modelName, modelOption, priceRange, releasedModels, type ProductWithHistory } from './productsKit';

const TIER_COLOR: Record<BuyerTier, string> = {
  premium: 'var(--amber)',
  mainstream: 'var(--blue)',
  budget: 'var(--fg-3)',
};

/** Users split by buyer tier, as one stacked bar with a count per tier. */
function TierBar({ tierUsers, userWord }: { tierUsers?: Partial<Record<BuyerTier, number>>; userWord: string }) {
  const parts = BUYER_TIERS.map((t) => Math.max(0, tierUsers?.[t] ?? 0));
  const total = parts.reduce((a, b) => a + b, 0);
  const label = BUYER_TIERS.map((t, i) => `${TIER_LABEL[t]} ${total > 0 ? Math.round((parts[i] / total) * 100) : 0}%`).join(', ');
  return (
    <div class="pr-tiers" aria-label={`Buyer tiers, ${userWord}: ${label}`}>
      <div class="pr-tierbar" role="img" aria-label={label}>
        {BUYER_TIERS.map((t, i) => (
          <i key={t} style={`width:${total > 0 ? (parts[i] / total) * 100 : 0}%;background:${TIER_COLOR[t]}`} />
        ))}
      </div>
      <div class="pr-tier-legend">
        {BUYER_TIERS.map((t, i) => (
          <span key={t} title={TIER_HINT[t]}>
            <i class="pr-swatch" style={`background:${TIER_COLOR[t]}`} />
            {TIER_LABEL[t]} <b class="num">{fmtCount(parts[i])}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Revenue and serving cost per day, and the margin as a bar with a centre line: green to the right, red to the left. */
function Economics({ revenue, cost, margin }: { revenue: number; cost: number; margin: number }) {
  const scale = Math.max(revenue, cost, Math.abs(margin), 1);
  const half = Math.min(50, (Math.abs(margin) / scale) * 50);
  const pos = margin >= 0;
  const left = pos ? 50 : 50 - half;
  return (
    <div class="pr-econ">
      <dl class="pr-econ-rows">
        <div>
          <dt>Revenue / day</dt>
          <dd class="num">{formatMoney(revenue)}</dd>
        </div>
        <div>
          <dt>Serving cost / day</dt>
          <dd class="num">{formatMoney(cost)}</dd>
        </div>
      </dl>
      <div class="pr-margin" role="img" aria-label={`Margin ${formatMoney(margin)} a day`}>
        <i class="pr-margin-mid" />
        <i class={`pr-margin-fill ${pos ? 'pos' : 'neg'}`} style={`left:${left.toFixed(2)}%;width:${half.toFixed(2)}%`} />
      </div>
      <div class="pr-margin-label">
        <span>Margin</span>
        <b class="num" style={`color:${pos ? 'var(--up)' : 'var(--down)'}`}>
          {pos ? '+' : ''}
          {formatMoney(margin)}/day
        </b>
      </div>
    </div>
  );
}

export function LiveProductCard({ s, product }: { s: GameState; product: Product }) {
  const kind: ProductKind = product.kind;
  const info = KINDS[kind];
  const range = priceRange(s, kind);
  const models = releasedModels(s);
  const current = s.models.find((m) => m.id === product.modelId) ?? null;
  const [draft, setDraft] = useState<number | null>(null);
  const shownPrice = draft ?? product.price;
  const served = product.servedFraction;
  const outage = served < 0.98;
  // Re-pricing this line: it competes against the other lines of its kind, not against its own old price.
  const preview = current && draft !== null ? previewDemand(s, kind, current.id, draft, product.id) : null;
  const modelOptions = current && !models.some((m) => m.id === current.id) ? [current, ...models] : models;
  const { revenue, cost, margin } = economics(product);
  const history = (product as ProductWithHistory).usersHistory;

  return (
    <Card
      class="pr-card"
      title={product.name}
      subtitle={`${info.label} · ${current ? current.name : modelName(s, product.modelId)}`}
      actions={<Pill tone={outage ? 'bad' : 'good'}>{outage ? 'Outage' : 'Live'}</Pill>}
    >
      <div class="pr-top">
        <div class="pr-users">
          <span class="pr-big num">{fmtCount(product.users)}</span>
          <span class="pr-users-k">{info.userWord}</span>
        </div>
        {history && history.length > 1 && (
          <div class="pr-spark" aria-label={`${info.userWord} over time`}>
            <Sparkline values={history} height={28} />
          </div>
        )}
      </div>

      <TierBar tierUsers={product.tierUsers} userWord={info.userWord} />
      <Economics revenue={revenue} cost={cost} margin={margin} />

      {outage && <div class="pr-outage">Only {fmtPct(served)} of demand is being served right now.</div>}

      <div class="pr-form">
        <div class="pr-row">
          <span class="pr-k">Model</span>
          <select
            class="select"
            value={product.modelId ?? ''}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v) dispatch({ type: 'updateProduct', productId: product.id, modelId: v });
            }}
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {modelOption(m, kind)}
                {m.deprecated ? ' (retired)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div class="pr-row">
          <span class="pr-k">Price</span>
          <div class="pr-price">
            <div class="pr-price-line">
              <Range
                label="Price"
                min={0}
                max={1000}
                step={1}
                stepBy={10}
                value={Math.round(valueToLog(shownPrice, range.min, range.max) * 1000)}
                onInput={(v) => setDraft(sig2(logToValue(v / 1000, range.min, range.max)))}
                onChange={(v) => {
                  const p = sig2(logToValue(v / 1000, range.min, range.max));
                  setDraft(null);
                  if (p !== product.price) dispatch({ type: 'updateProduct', productId: product.id, price: p });
                }}
              />
              <span class="pr-readout num">{fmtPrice(shownPrice, info.unit)}</span>
            </div>
            {preview && (
              <div class="pr-note">
                At {fmtPrice(draft!, info.unit)}: about {fmtCount(preview.users)} {info.userWord}, {formatMoney(preview.revenuePerDay)}/day. Let go of the
                slider to apply.
              </div>
            )}
          </div>
        </div>
      </div>

      <div class="pr-foot pr-foot-inline">
        <Meter label="Satisfaction" value={product.satisfaction} max={100} caption="Users stay when this is high." />
        <div class="pr-foot-row">
          <label class="pr-check" title="Switches to any released model more than 1 point stronger.">
            <input
              type="checkbox"
              class="check"
              checked={!!product.autoUpgrade}
              onChange={(e) =>
                dispatch({
                  type: 'setProductAutoUpgrade',
                  productId: product.id,
                  on: (e.currentTarget as HTMLInputElement).checked,
                })
              }
            />
            <span>Auto-upgrade model</span>
          </label>
          <ConfirmButton
            class="pn-btn--sm"
            label="Shut down"
            confirmLabel="Shut it down for good?"
            onConfirm={() => dispatch({ type: 'shutdownProduct', productId: product.id })}
          />
        </div>
      </div>
    </Card>
  );
}
