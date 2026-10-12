import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export interface FlowSegment {
  id: string;
  label: string;
  value: number;
  /** CSS color, usually a token like 'var(--blue)'. */
  color: string;
  /** Extra line shown on hover / in the legend, e.g. "Bot chat · 1.2B tok/day". */
  detail?: ComponentChildren;
  /** Draw hatched (e.g. idle, reserved, overflow). */
  hatched?: boolean;
}

export interface FlowBarProps {
  segments: FlowSegment[];
  /** Total the bar represents. Defaults to the sum; pass a larger number to show empty room. */
  total?: number;
  format?: (v: number) => string;
  /** Bar height in px. Default 14. */
  height?: number;
  /** Legend under the bar. Default true. */
  legend?: boolean;
  /** Click a segment (or its legend row). */
  onSelect?: (id: string) => void;
  selected?: string | null;
  class?: string;
}

/**
 * v10: an interactive segmented bar. Hovering, tapping or tabbing to a segment or its legend row highlights both
 * and shows the detail; clicking calls onSelect. Use it for "where does X go" (fleet, payroll, users, revenue).
 * Keyboard: Tab moves through the segments and legend rows; Enter or Space selects.
 */
export function FlowBar({ segments, total, format = (v) => String(Math.round(v)), height = 14, legend = true, onSelect, selected = null, class: cls }: FlowBarProps) {
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const rows = segments.filter((s) => isFinite(s.value) && s.value > 0);
  const sum = rows.reduce((a, r) => a + r.value, 0);
  const whole = Math.max(total ?? sum, sum, 1e-9);
  const focusId = hover ?? focus ?? selected;
  const active = rows.find((r) => r.id === focusId);
  const pick = (id: string) => onSelect?.(id);
  const keyPick = (id: string) => (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
      e.preventDefault();
      pick(id);
    }
  };

  return (
    <div class={`flowbar ${cls ?? ''}`}>
      <div class="flowbar-track" style={{ height: `${height}px` }} role="img" aria-label="Breakdown">
        {rows.map((r) => (
          <div
            key={r.id}
            tabIndex={0}
            role={onSelect ? 'button' : undefined}
            aria-label={`${r.label}: ${format(r.value)}`}
            aria-pressed={onSelect ? selected === r.id : undefined}
            class={`flowbar-seg ${r.hatched ? 'hatched' : ''} ${focusId && focusId !== r.id ? 'dim' : ''} ${onSelect ? 'clickable' : ''} ${selected === r.id ? 'sel' : ''}`}
            style={{ width: `${((r.value / whole) * 100).toFixed(3)}%`, '--c': r.color } as any}
            onPointerEnter={() => setHover(r.id)}
            onPointerLeave={() => setHover(null)}
            onPointerDown={() => setHover(r.id)}
            onFocus={() => setFocus(r.id)}
            onBlur={() => setFocus(null)}
            onKeyDown={keyPick(r.id)}
            onClick={onSelect ? () => pick(r.id) : undefined}
            title={`${r.label}: ${format(r.value)}`}
          />
        ))}
      </div>
      {active && active.detail && <div class="flowbar-detail small">{active.detail}</div>}
      {legend && (
        <div class="flowbar-legend">
          {rows.map((r) => (
            <button
              type="button"
              key={r.id}
              class={`flowbar-key ${focusId === r.id ? 'on' : ''} ${selected === r.id ? 'sel' : ''} ${focusId && focusId !== r.id ? 'dim' : ''}`}
              onPointerEnter={() => setHover(r.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setFocus(r.id)}
              onBlur={() => setFocus(null)}
              onClick={onSelect ? () => pick(r.id) : undefined}
              aria-pressed={onSelect ? selected === r.id : undefined}
              aria-disabled={onSelect ? undefined : true}
            >
              <span class={`swatch ${r.hatched ? 'hatched' : ''}`} style={{ '--c': r.color } as any} />
              <span class="label">{r.label}</span>
              <span class="val num">{format(r.value)}</span>
              <span class="pct num">{Math.round((r.value / whole) * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
