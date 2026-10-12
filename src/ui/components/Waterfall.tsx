import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { formatMoney } from '../../sim/util';

export interface WaterfallStep {
  id: string;
  label: ComponentChildren;
  /** Signed change: a gain is positive, a cost negative. A 'subtotal' ignores this and shows the running total. */
  value: number;
  /** 'subtotal' draws the running total from zero (e.g. "Revenue" after the product lines). Default 'step'. */
  kind?: 'step' | 'subtotal';
  /** Bar colour. Default green for gains, red for costs, dim for subtotals. */
  color?: string;
  /** Dim line shown when the row is picked. */
  detail?: ComponentChildren;
}

export interface WaterfallProps {
  /** Optional first bar: a starting amount drawn from zero. */
  start?: { label: ComponentChildren; value: number; color?: string };
  steps: WaterfallStep[];
  /** Optional last bar: the running total from zero. Pass null to omit it. Default label "Total". */
  end?: { label: ComponentChildren; color?: string } | null;
  /** Formats amounts. Default formatMoney with one decimal. */
  format?: (v: number) => string;
  class?: string;
}

interface Row {
  id: string;
  label: ComponentChildren;
  kind: 'start' | 'step' | 'subtotal' | 'end';
  from: number;
  to: number;
  delta: number;
  running: number;
  color: string;
  detail?: ComponentChildren;
}

/**
 * v10: a waterfall from a start through signed steps to a total, drawn as horizontal rows so it reads on a phone.
 * Each bar sits where the running total moved. Hover, tap or tab to a row for its amount and the running total.
 */
export function Waterfall({ start, steps, end = { label: 'Total' }, format = (v) => formatMoney(v, 1), class: cls }: WaterfallProps) {
  const [active, setActive] = useState<string | null>(null);
  const rows: Row[] = [];
  let run = start && isFinite(start.value) ? start.value : 0;
  if (start) {
    rows.push({ id: '__start', label: start.label, kind: 'start', from: 0, to: run, delta: run, running: run, color: start.color ?? 'var(--fg-2)' });
  }
  for (const st of steps) {
    if (st.kind === 'subtotal') {
      rows.push({ id: st.id, label: st.label, kind: 'subtotal', from: 0, to: run, delta: 0, running: run, color: st.color ?? 'var(--fg-2)', detail: st.detail });
      continue;
    }
    const v = isFinite(st.value) ? st.value : 0;
    const next = run + v;
    rows.push({
      id: st.id,
      label: st.label,
      kind: 'step',
      from: run,
      to: next,
      delta: v,
      running: next,
      color: st.color ?? (v >= 0 ? 'var(--up)' : 'var(--down)'),
      detail: st.detail,
    });
    run = next;
  }
  if (end) {
    rows.push({ id: '__end', label: end.label, kind: 'end', from: 0, to: run, delta: run, running: run, color: end.color ?? (run >= 0 ? 'var(--amber)' : 'var(--down)') });
  }
  if (rows.length === 0) return null;

  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(0, ...rows.map((r) => Math.max(r.from, r.to)));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${format(Math.abs(v))}`;
  const on = rows.find((r) => r.id === active) ?? null;

  return (
    <div class={`wf ${cls ?? ''}`}>
      <ol class="wf-rows" aria-label="Waterfall">
        {rows.map((r) => {
          const left = pos(Math.min(r.from, r.to));
          const width = Math.max(0.6, pos(Math.max(r.from, r.to)) - left);
          const isOn = on?.id === r.id;
          const dim = on !== null && !isOn;
          return (
            <li
              key={r.id}
              class={`wf-row wf-${r.kind} ${isOn ? 'on' : ''} ${dim ? 'dim' : ''}`}
              tabIndex={0}
              onPointerEnter={() => setActive(r.id)}
              onPointerLeave={() => setActive(null)}
              onPointerDown={() => setActive(r.id)}
              onFocus={() => setActive(r.id)}
              onBlur={() => setActive(null)}
            >
              <span class="wf-label">{r.label}</span>
              <span class="wf-track" aria-hidden="true">
                <span class="wf-zero" style={{ left: `${pos(0)}%` }} />
                <span class="wf-bar" style={{ left: `${left}%`, width: `${width}%`, '--c': r.color } as any} />
              </span>
              <span class={`wf-val num ${r.kind === 'step' ? (r.delta >= 0 ? 'good' : 'bad') : ''}`}>
                {r.kind === 'step' ? signed(r.delta) : format(r.running)}
              </span>
            </li>
          );
        })}
      </ol>
      <div class="wf-readout small" aria-live="polite">
        {on ? (
          <>
            <span class="wf-readout-label">{on.label}</span>
            {on.kind === 'step' ? (
              <span>
                {signed(on.delta)}, running total <b class="num">{format(on.running)}</b>
              </span>
            ) : (
              <span>
                Total <b class="num">{format(on.running)}</b>
              </span>
            )}
            {on.detail && <span class="wf-readout-detail">{on.detail}</span>}
          </>
        ) : (
          <span class="muted">Hover or tap a row for its amount.</span>
        )}
      </div>
    </div>
  );
}
