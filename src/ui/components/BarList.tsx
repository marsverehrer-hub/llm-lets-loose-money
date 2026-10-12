import type { ComponentChildren } from 'preact';

export interface BarRow {
  id: string;
  label: ComponentChildren;
  value: number;
  /** Bar color. Default var(--fg-3); the player's row (me) defaults to var(--amber). */
  color?: string;
  /** Dim second line under the label. */
  sub?: ComponentChildren;
  /** Right-hand extra cell (e.g. a delta or a pill). */
  extra?: ComponentChildren;
  me?: boolean;
}

export interface BarListProps {
  rows: BarRow[];
  format?: (v: number) => string;
  /** Scale max. Default the largest value. */
  max?: number;
  onSelect?: (id: string) => void;
  selected?: string | null;
  /** Sort descending by value. Default true. */
  sort?: boolean;
  class?: string;
}

/**
 * v10: a ranked list of horizontal bars (label, bar, value). Replaces small tables where the point is
 * "who has more" (market share, revenue per product, team sizes). Rows are focusable; they are clickable when
 * onSelect is set (Enter or Space selects). On phones the bar drops under the label so it keeps its width.
 */
export function BarList({ rows, format = (v) => String(Math.round(v)), max, onSelect, selected = null, sort = true, class: cls }: BarListProps) {
  const list = sort ? [...rows].sort((a, b) => b.value - a.value) : rows;
  const top = Math.max(max ?? 0, ...list.map((r) => r.value), 1e-9);
  return (
    <div class={`barlist ${onSelect ? 'clickable' : ''} ${cls ?? ''}`}>
      {list.map((r) => (
        <div
          key={r.id}
          class={`barlist-row ${r.me ? 'me' : ''} ${selected === r.id ? 'sel' : ''}`}
          onClick={onSelect ? () => onSelect(r.id) : undefined}
          role={onSelect ? 'button' : undefined}
          aria-pressed={onSelect ? selected === r.id : undefined}
          tabIndex={0}
          onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(r.id)) : undefined}
        >
          <div class="barlist-label">
            <div class="barlist-name">{r.label}</div>
            {r.sub && <div class="barlist-sub small">{r.sub}</div>}
          </div>
          <div class="barlist-track">
            <div
              class="barlist-fill"
              style={{ width: `${Math.max(0, (r.value / top) * 100).toFixed(2)}%`, '--c': r.color ?? (r.me ? 'var(--amber)' : 'var(--fg-3)') } as any}
            />
          </div>
          <div class="barlist-val num">{format(r.value)}</div>
          {r.extra !== undefined && <div class="barlist-extra">{r.extra}</div>}
        </div>
      ))}
    </div>
  );
}
