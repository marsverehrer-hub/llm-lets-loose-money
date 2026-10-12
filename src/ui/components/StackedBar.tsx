import { useState } from 'preact/hooks';
import { formatMoney } from '../../sim/util';

export interface BreakdownItem {
  label: string;
  value: number;
  color: string;
}

export interface StackedBarProps {
  items: BreakdownItem[];
  /** Value formatter. Default formatMoney. */
  format?: (v: number) => string;
  emptyText?: string;
  /** Legend rows with value and share. Default true. */
  showLegend?: boolean;
  class?: string;
}

/**
 * One horizontal segmented bar (share of total) plus an optional legend.
 * Zero and negative items are skipped. Used for revenue and expense breakdowns.
 * v10: hovering (or tapping, or focusing with the keyboard) a segment or its legend row dims the rest and
 * shows that item's value and share on a detail line.
 */
export function StackedBar({ items, format = (v) => formatMoney(v), emptyText = 'Nothing booked yet today.', showLegend = true, class: cls }: StackedBarProps) {
  const [active, setActive] = useState<string | null>(null);
  const rows = items.filter((i) => isFinite(i.value) && i.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (rows.length === 0 || total <= 0) {
    return <div class={`small muted ${cls ?? ''}`}>{emptyText}</div>;
  }
  const on = rows.find((r) => r.label === active) ?? null;
  const pctOf = (v: number) => Math.round((v / total) * 100);
  const hoverOn = (label: string) => () => setActive(label);
  const hoverOff = () => setActive(null);
  return (
    <div class={`stack ${cls ?? ''}`} style={{ gap: '12px' }}>
      <div class="stacked" role="img" aria-label="Breakdown">
        {rows.map((r) => (
          <div
            key={r.label}
            class={`stacked-seg ${on && on.label !== r.label ? 'dim' : ''}`}
            tabIndex={0}
            title={`${r.label}: ${format(r.value)}`}
            onPointerEnter={hoverOn(r.label)}
            onPointerLeave={hoverOff}
            onPointerDown={hoverOn(r.label)}
            onFocus={hoverOn(r.label)}
            onBlur={hoverOff}
            style={{ width: `${((r.value / total) * 100).toFixed(2)}%`, '--c': r.color } as any}
          />
        ))}
      </div>
      <div class="stacked-detail small" aria-live="polite">
        {on ? (
          <>
            <span class="swatch" style={{ '--c': on.color } as any} /> {on.label}: <b class="num">{format(on.value)}</b>{' '}
            <span class="num muted">{pctOf(on.value)}%</span>
          </>
        ) : (
          <span class="muted">&nbsp;</span>
        )}
      </div>
      {showLegend && (
        <div class="breakdown">
          {rows.map((r) => (
            <div
              class={`breakdown-row ${on && on.label === r.label ? 'on' : ''} ${on && on.label !== r.label ? 'dim' : ''}`}
              key={r.label}
              onPointerEnter={hoverOn(r.label)}
              onPointerLeave={hoverOff}
            >
              <span class="swatch" style={{ '--c': r.color } as any} />
              <span class="label">{r.label}</span>
              <span class="val">{format(r.value)}</span>
              <span class="pct">{pctOf(r.value)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
