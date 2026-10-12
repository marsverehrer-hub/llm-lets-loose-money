import { useState } from 'preact/hooks';

export interface RadarAxis {
  /** Stable key used in each series' values. */
  id: string;
  /** Short axis label, e.g. "Reasoning". */
  label: string;
}

export interface RadarSeries {
  /** Legend name, e.g. "Loosey-2" or "Best rival". */
  name: string;
  /** CSS colour, usually a token: 'var(--amber)'. */
  color: string;
  /** Value per axis id. Missing axes count as 0. */
  values: Record<string, number>;
  /** Dashed outline, e.g. for an expectation or a rival. */
  dashed?: boolean;
}

export interface RadarProps {
  axes: RadarAxis[];
  series: RadarSeries[];
  /** Scale top: a value equal to max sits on the outer ring. Default 100. */
  max?: number;
  /** Formats values in the readout. Default rounds to a whole number. */
  format?: (v: number) => string;
  /** Largest drawn width in px. The shape scales down on phones. Default 340. */
  size?: number;
  /** Accessible name. */
  label?: string;
  class?: string;
}

const VW = 400;
const VH = 340;
const CX = VW / 2;
const CY = VH / 2 + 4;
const R = 100;
const RINGS = [0.25, 0.5, 0.75, 1];

/**
 * v10: a capability shape. One spoke per axis, one outline per series. Hover (or tap and drag) across the chart to
 * pick an axis: its value for each series shows on the vertices and in the readout. Arrow keys move the pick.
 */
export function Radar({ axes, series, max = 100, format = (v) => String(Math.round(v)), size = 340, label = 'Capability shape', class: cls }: RadarProps) {
  const [active, setActive] = useState<number | null>(null);
  const n = axes.length;
  if (n < 3) {
    return <div class="small muted">Need at least three axes to draw a shape.</div>;
  }
  const step = (2 * Math.PI) / n;
  const angle = (i: number) => -Math.PI / 2 + i * step;
  const at = (i: number, f: number): [number, number] => [CX + Math.cos(angle(i)) * R * f, CY + Math.sin(angle(i)) * R * f];
  const frac = (v: number) => Math.min(1, Math.max(0, (isFinite(v) ? v : 0) / max));
  const valueOf = (s: RadarSeries, i: number) => {
    const v = s.values[axes[i].id];
    return isFinite(v) ? v : 0;
  };

  /** Axis index under a viewport point, or null at the centre. */
  const axisAt = (e: PointerEvent): number | null => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * VW - CX;
    const y = ((e.clientY - r.top) / r.height) * VH - CY;
    if (Math.hypot(x, y) < 14) return null;
    let a = Math.atan2(y, x) + Math.PI / 2;
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.round(a / step) % n;
  };

  const act = active;
  return (
    <div class={`radar ${cls ?? ''}`}>
      <div class="radar-legend small">
        {series.map((s) => (
          <span key={s.name} class="radar-key">
            <span class={`radar-key-mark ${s.dashed ? 'dashed' : ''}`} style={{ '--c': s.color } as any} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        class="radar-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label={`${label}. ${axes.map((a) => a.label).join(', ')}. Use the arrow keys to read each axis.`}
        tabIndex={0}
        style={{ maxWidth: `${size}px` }}
        onPointerDown={(e) => setActive(axisAt(e))}
        onPointerMove={(e) => {
          if (e.pointerType !== 'touch' || e.buttons > 0) setActive(axisAt(e));
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null);
        }}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(act === null ? 0 : (act + 1) % n);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(act === null ? n - 1 : (act - 1 + n) % n);
          } else if (e.key === 'Escape') {
            setActive(null);
          }
        }}
      >
        {RINGS.map((f) => (
          <polygon key={f} class={`radar-ring ${f === 1 ? 'outer' : ''}`} points={axes.map((_, i) => at(i, f).join(',')).join(' ')} />
        ))}
        {axes.map((a, i) => {
          const [x2, y2] = at(i, 1);
          return <line key={a.id} class={`radar-spoke ${act === i ? 'on' : ''}`} x1={CX} y1={CY} x2={x2} y2={y2} />;
        })}
        {series.map((s) => {
          const pts = axes.map((_, i) => at(i, frac(valueOf(s, i))).join(',')).join(' ');
          return (
            <g key={s.name} style={{ '--c': s.color } as any}>
              <polygon class={`radar-shape ${s.dashed ? 'dashed' : ''}`} points={pts} />
              {axes.map((a, i) => {
                const [x, y] = at(i, frac(valueOf(s, i)));
                return <circle key={a.id} class={`radar-dot ${act === i ? 'on' : ''}`} cx={x} cy={y} r={act === i ? 4.5 : 2.5} />;
              })}
            </g>
          );
        })}
        {axes.map((a, i) => {
          const c = Math.cos(angle(i));
          const sn = Math.sin(angle(i));
          const x = CX + c * (R + 18);
          const y = CY + sn * (R + 18) + 4;
          const anchor = c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle';
          return (
            <text key={a.id} class={`radar-label ${act === i ? 'on' : ''}`} x={x} y={y} text-anchor={anchor}>
              {a.label}
            </text>
          );
        })}
        {act !== null &&
          series.map((s) => {
            const v = valueOf(s, act);
            const [x, y] = at(act, frac(v));
            const c = Math.cos(angle(act));
            const sn = Math.sin(angle(act));
            const anchor = c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle';
            return (
              <text key={`v-${s.name}`} class="radar-value" x={x + c * 12} y={y + sn * 12 + 4} text-anchor={anchor} style={{ fill: s.color }}>
                {format(v)}
              </text>
            );
          })}
      </svg>
      <div class="radar-readout small" aria-live="polite">
        {act !== null ? (
          <>
            <span class="radar-readout-axis">{axes[act].label}</span>
            {series.map((s) => (
              <span key={s.name} class="radar-readout-item">
                <span class="radar-key-mark" style={{ '--c': s.color } as any} />
                {s.name} <b class="num">{format(valueOf(s, act))}</b>
              </span>
            ))}
          </>
        ) : (
          <span class="muted">Hover an axis for its values.</span>
        )}
      </div>
    </div>
  );
}
