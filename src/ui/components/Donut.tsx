import { useState } from 'preact/hooks';

export interface DonutItem {
  label: string;
  value: number;
  color: string;
}

export interface DonutProps {
  items: DonutItem[];
  /** @deprecated kept for API compatibility */
  size?: number;
  /** @deprecated kept for API compatibility */
  thickness?: number;
  /** Headline figure shown above the bar. */
  centerValue?: string;
  centerLabel?: string;
  class?: string;
}

/**
 * Share breakdown. The terminal theme has no donuts: renders a headline,
 * a stacked bar and a ranked legend with percentages.
 * v10: hovering (or tapping, or focusing) a segment or legend row dims the rest and shows its share on a detail line.
 */
export function Donut({ items, centerValue, centerLabel, class: cls }: DonutProps) {
  const [active, setActive] = useState<string | null>(null);
  const rows = items.filter((i) => isFinite(i.value) && i.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const on = rows.find((r) => r.label === active) ?? null;
  const hoverOn = (label: string) => () => setActive(label);
  const hoverOff = () => setActive(null);
  return (
    <div class={`share ${cls ?? ''}`}>
      {(centerValue != null || centerLabel != null) && (
        <div class="share-head">
          {centerLabel != null && <span class="stat-label">{centerLabel}</span>}
          {centerValue != null && <span class="share-value">{centerValue}</span>}
        </div>
      )}
      <div class="stacked">
        {total > 0 &&
          rows.map((r) => (
            <div
              key={r.label}
              class={`stacked-seg ${on && on.label !== r.label ? 'dim' : ''}`}
              tabIndex={0}
              title={`${r.label}: ${((r.value / total) * 100).toFixed(1)}%`}
              onPointerEnter={hoverOn(r.label)}
              onPointerLeave={hoverOff}
              onPointerDown={hoverOn(r.label)}
              onFocus={hoverOn(r.label)}
              onBlur={hoverOff}
              style={{ width: `${(r.value / total) * 100}%`, '--c': r.color } as any}
            />
          ))}
      </div>
      <div class="share-detail small" aria-live="polite">
        {on && total > 0 ? (
          <>
            <span class="swatch" style={{ '--c': on.color } as any} /> {on.label}: <b class="num">{((on.value / total) * 100).toFixed(1)}%</b>
          </>
        ) : (
          <span class="muted">&nbsp;</span>
        )}
      </div>
      <div class="share-legend">
        {rows.map((r) => (
          <div
            key={r.label}
            class={`share-row ${on && on.label === r.label ? 'on' : ''} ${on && on.label !== r.label ? 'dim' : ''}`}
            onPointerEnter={hoverOn(r.label)}
            onPointerLeave={hoverOff}
          >
            <span class="swatch" style={{ '--c': r.color } as any} />
            <span class="ellipsis flex-1">{r.label}</span>
            <span class="num">{((r.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
