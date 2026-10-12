// Shared controls for the pre-training wizard and the Models panel: bands, charts, sliders, number fields and option tiles.
// Markup classes md-* live in ../models.css; wizard layout classes tw-* live in ./train.css.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { clamp, niceScale, Slider as ShellSlider, useIsMobile } from '../../components';
import type { Id, SweepPoint } from '../../../sim/types';
import type { OptionRow } from '../../../sim/data/trainingOptions';
import { LR_MAX, LR_MIN, r0, tradeoffs } from './model';
import type { ShapeRow } from './model';
import '../models.css';
import './train.css';

/** Pixel width of an element, so SVG charts draw at true size and their text stays 12px. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(240, Math.floor(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A forecast or checkpoint band: a range from low to high, with a mid tick. Numbers are mono. */
export function BandBar({
  low,
  mid,
  high,
  label,
  variant,
}: {
  low: number;
  mid?: number | null;
  high: number;
  label?: string;
  variant?: 'mini' | 'lg';
}) {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const pad = Math.max(3, (hi - lo) * 0.6);
  const d0 = lo - pad;
  const span = hi - lo + 2 * pad;
  const at = (v: number): number => clamp((v - d0) / span, 0, 1) * 100;
  const hasMid = mid !== null && mid !== undefined && isFinite(mid);
  const midAt = hasMid ? at(mid as number) : 0;
  return (
    <div class={`md-band ${variant ? `md-band-${variant}` : ''}`} role="img" aria-label={label ?? `Range ${r0(lo)} to ${r0(hi)}${hasMid ? `, mid ${r0(mid as number)}` : ''}`}>
      <div class="md-band-track">
        <span class="md-band-range" style={`left:${at(lo).toFixed(2)}%;width:${(at(hi) - at(lo)).toFixed(2)}%`} />
        {hasMid && <span class="md-band-mid" style={`left:${midAt.toFixed(2)}%`} />}
      </div>
      <div class="md-band-nums">
        <span class="num md-band-lo">{r0(lo)}</span>
        {hasMid && (
          <span class="num md-band-midnum" style={`left:${midAt.toFixed(2)}%`}>
            {r0(mid as number)}
          </span>
        )}
        <span class="num md-band-hi">{r0(hi)}</span>
      </div>
    </div>
  );
}

/** Loss curve: the real loss in solid, and a dashed forecast from the latest point toward the predicted final loss. */
export function LossChart({ history, forecastEnd, totalDays }: { history: number[]; forecastEnd: number | null; totalDays: number }) {
  const [ref, w] = useWidth<HTMLDivElement>(420);
  const H = 132;
  const padL = 44;
  const padR = 52;
  const padT = 10;
  const padB = 20;
  const n = history.length;
  const iw = w - padL - padR;
  const ih = H - padT - padB;
  const xEnd = Math.max(n - 1, totalDays, 1);
  const vals = forecastEnd !== null ? [...history, forecastEnd] : history;
  const sc = niceScale(Math.min(...vals), Math.max(...vals), 3);
  const span = sc.hi - sc.lo || 1;
  const X = (x: number): number => padL + (x / xEnd) * iw;
  const Y = (v: number): number => padT + (1 - (v - sc.lo) / span) * ih;
  const last = n - 1;
  const real = history.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const fcPath =
    forecastEnd !== null && n >= 2
      ? `M${X(last).toFixed(1)} ${Y(history[last]).toFixed(1)} L${X(xEnd).toFixed(1)} ${Y(forecastEnd).toFixed(1)}`
      : null;
  return (
    <div class="md-chart md-loss" ref={ref}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Loss curve against the forecast">
        {sc.ticks.map((t) => (
          <g key={t}>
            <line class="md-grid" x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} />
            <text class="md-ax" x={padL - 6} y={Y(t) + 4} text-anchor="end">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {fcPath && <path class="md-line-fc" d={fcPath} fill="none" />}
        {n >= 2 && <path class="md-line-real" d={real} fill="none" />}
        {n >= 1 && <circle class="md-dot-now" cx={X(last)} cy={Y(history[last])} r={3} />}
        {forecastEnd !== null && n >= 2 && (
          <text class="md-ax md-ax-fc" x={X(xEnd) + 6} y={Y(forecastEnd) + 4}>
            {forecastEnd.toFixed(2)}
          </text>
        )}
        <text class="md-ax" x={padL} y={H - 4}>
          Day 1
        </text>
        <text class="md-ax" x={w - padR} y={H - 4} text-anchor="end">
          {`Day ${Math.round(xEnd) + 1}`}
        </text>
      </svg>
      <div class="md-key-row">
        <span class="md-key md-key-real">Real loss</span>
        {forecastEnd !== null && <span class="md-key md-key-fc">Forecast</span>}
      </div>
    </div>
  );
}

/** LR sweep for one architecture: reading against learning rate. Solid points sit near the current scale, hollow ones do not. */
export function SweepChart({ points, lr, scaleNow }: { points: SweepPoint[]; lr: number; scaleNow: number }) {
  const [ref, w] = useWidth<HTMLDivElement>(420);
  const H = 156;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const iw = w - padL - padR;
  const ih = H - padT - padB;
  const logSpan = Math.log10(LR_MAX / LR_MIN);
  const LX = (v: number): number => padL + clamp(Math.log10(v / LR_MIN) / logSpan, 0, 1) * iw;
  const readings = points.map((p) => p.reading).filter((v) => isFinite(v));
  const sc = readings.length > 0 ? niceScale(Math.min(...readings), Math.max(...readings), 3) : niceScale(0.85, 1.1, 3);
  const span = sc.hi - sc.lo || 1;
  const Y = (v: number): number => padT + (1 - (v - sc.lo) / span) * ih;
  const nowX = LX(clamp(lr, LR_MIN, LR_MAX));
  const labelRight = nowX > padL + iw * 0.7;
  return (
    <div class="md-chart md-sweep" ref={ref}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Learning rate sweep readings">
        {sc.ticks.map((t) => (
          <g key={t}>
            <line class="md-grid" x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} />
            <text class="md-ax" x={padL - 6} y={Y(t) + 4} text-anchor="end">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {[LR_MIN, 0.1, LR_MAX].map((v) => (
          <text key={v} class="md-ax" x={LX(v)} y={H - 6} text-anchor="middle">
            {v < 0.1 ? v.toFixed(2) : v.toFixed(v === LR_MAX ? 0 : 1)}
          </text>
        ))}
        <line class="md-marker" x1={nowX} x2={nowX} y1={padT} y2={padT + ih} />
        <text class="md-ax md-ax-amber" x={labelRight ? nowX - 5 : nowX + 5} y={padT + 10} text-anchor={labelRight ? 'end' : 'start'}>
          {`lr ${lr.toFixed(2)}`}
        </text>
        {points.map((p, i) => {
          const near = Math.abs(p.scale - scaleNow) <= 0.5;
          return <circle key={i} class={near ? 'md-pt-near' : 'md-pt-far'} cx={LX(p.lr)} cy={Y(p.reading)} r={3.5} />;
        })}
      </svg>
    </div>
  );
}

/** Log-free range input with the amber fill driven by --p. */
export function Slider({
  value,
  min,
  max,
  step,
  onInput,
  label,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onInput: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const isPhone = useIsMobile();
  const frac = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  // On phones the shell Slider adds − and + buttons (40px) so a thumb can nudge the value exactly.
  if (isPhone) {
    return <ShellSlider value={value} min={min} max={max} step={step} label={label} disabled={disabled} onChange={onInput} />;
  }
  return (
    <input
      type="range"
      class="slider md-slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      style={`--p:${(frac * 100).toFixed(2)}%`}
      onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}
    />
  );
}

/** Typed number. Edits stay local until blur or Enter, so typing "1." does not fight the store. */
export function NumField({
  value,
  min,
  max,
  label,
  onCommit,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v > 0) onCommit(clamp(v, min, max));
  };
  return (
    <input
      class="input md-num-input"
      type="number"
      min={min}
      max={max}
      step="any"
      disabled={disabled}
      aria-label={label}
      value={draft ?? (Number.isFinite(value) ? String(value) : '')}
      onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
      onChange={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * Capability shape: one column per capability, height = expected (forecast) score, a tick at the flagship's score.
 * Compact draws the footer strip; full draws labels as well.
 */
export function ShapeBars({ rows, compact }: { rows: ShapeRow[] | null; compact?: boolean }) {
  if (!rows) return <div class="tw-faint tw-small">Pick datasets to see the build profile.</div>;
  return (
    <div class={`tw-shape ${compact ? 'is-compact' : ''}`} role="img" aria-label="Expected capability shape against the flagship">
      {rows.map((r) => (
        <div class="tw-shape-col" key={r.id} title={`${r.label} ${Math.round(r.expected)}${r.flagship !== null ? ` · flagship ${Math.round(r.flagship)}` : ''}`}>
          <div class="tw-shape-well">
            <div class="tw-shape-bar" style={`height:${r.expected.toFixed(1)}%`} />
            {r.flagship !== null && <div class="tw-shape-mark" style={`bottom:${r.flagship.toFixed(1)}%`} />}
          </div>
          {!compact && <span class="tw-shape-k">{r.label}</span>}
          {!compact && <span class="num tw-shape-v">{Math.round(r.expected)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Small toggle chip (helper chips and filter toggles). */
export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ComponentChildren; title?: string }) {
  return (
    <button type="button" class={`tw-chip ${on ? 'is-on' : ''}`} aria-pressed={on} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * A group of option tiles. Each tile: name, a dim "Recommended" tag on the default, and 2 to 4 mono trade-off deltas.
 * Locked options collapse into an "N locked" link. Hovering a tile swaps the one detail line below the group.
 */
export function OptionTiles({
  label,
  rows,
  value,
  recommended,
  onPick,
  extra,
}: {
  label: string;
  rows: OptionRow[];
  value: Id;
  recommended: Id;
  onPick: (id: Id) => void;
  /** Rendered inside the selected tile (the MoE expert stepper). */
  extra?: ComponentChildren;
}) {
  const [hover, setHover] = useState<Id | null>(null);
  const [showLocked, setShowLocked] = useState(false);
  const open = rows.filter((r) => r.unlocked);
  const locked = rows.filter((r) => !r.unlocked);
  const focus = rows.find((r) => r.option.id === (hover ?? value)) ?? null;
  return (
    <div class="tw-opts">
      <div class="tw-tiles" role="radiogroup" aria-label={label}>
        {open.map(({ option }) => {
          const on = option.id === value;
          return (
            <div
              key={option.id}
              class={`tw-tile ${on ? 'is-on' : ''}`}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              onClick={() => onPick(option.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(option.id);
                }
              }}
              onMouseEnter={() => setHover(option.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(option.id)}
              onBlur={() => setHover(null)}
            >
              <div class="tw-tile-head">
                <span class="tw-tile-name">{option.name}</span>
                {option.id === recommended && <span class="tw-rec">Recommended</span>}
              </div>
              <div class="tw-trades">
                {tradeoffs(option).map((t, i) => (
                  <span key={i} class={`tw-trade tone-${t.tone}`}>
                    {t.text}
                  </span>
                ))}
              </div>
              {on && extra}
            </div>
          );
        })}
      </div>
      {locked.length > 0 && (
        <div class="tw-locked">
          <button type="button" class="tw-link" aria-expanded={showLocked} onClick={() => setShowLocked(!showLocked)}>
            {`${locked.length} locked`}
          </button>
          {showLocked && (
            <ul class="tw-locked-list">
              {locked.map((r) => (
                <li key={r.option.id}>
                  <span>{r.option.name}</span>
                  <span class="tw-faint"> {r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {focus && <div class="tw-detail">{focus.option.description}</div>}
    </div>
  );
}
