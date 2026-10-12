// Shared helpers and small presentational pieces for the gameplay panels.
// Owner: panels agent. Panel-specific styling lives in panels.css (.pn-* classes).
import { useEffect, useState } from 'preact/hooks';
import type { Bonuses, Rng, Scores } from '../../sim/types';
import { formatNumber } from '../../sim/util';
import { PanelHeader as SharedPanelHeader, useIsMobile } from '../components';

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'muted';

/** UI-only RNG (for name suggestions). Never touches the saved sim rngState. */
export function uiRng(): Rng {
  const next = () => Math.random();
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: (p) => next() < p,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(1e-9, next());
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Log-scale slider helpers. t in [0,1] <-> value in [min,max]. */
export function logToValue(t: number, min: number, max: number): number {
  return Math.exp(Math.log(min) + clamp01(t) * (Math.log(max) - Math.log(min)));
}
export function valueToLog(v: number, min: number, max: number): number {
  const c = Math.min(max, Math.max(min, v));
  return (Math.log(c) - Math.log(min)) / (Math.log(max) - Math.log(min));
}
/** Round to two significant digits so slider values read nicely ("7.1B", "420M"). */
export function sig2(v: number): number {
  return v > 0 ? Number(v.toPrecision(2)) : 0;
}

export function fmtCount(v: number, digits = 1): string {
  return formatNumber(v, digits).replace(/\.0(?=[A-Za-z]|$)/, '');
}
/** Compute rates (PFLOP/s): keep precision for small fleets. */
export function fmtRate(v: number): string {
  if (v >= 1000) return fmtCount(v, 1);
  if (v >= 10) return v.toFixed(1);
  if (v >= 0.1) return v.toFixed(2);
  if (v > 0) return Number(v.toPrecision(2)).toString();
  return '0';
}
export function fmtTokens(tokensB: number): string {
  return `${fmtCount(tokensB * 1e9)} tokens`;
}
export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
export function fmtPrice(v: number, unit: string): string {
  const n = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `$${n}${unit}`;
}
export function fmtDays(d: number): string {
  if (!isFinite(d) || d < 0) return '—';
  if (d < 1) return '< 1 day';
  if (d < 60) {
    const r = Math.round(d);
    return `${r} day${r === 1 ? '' : 's'}`;
  }
  if (d < 730) return `${Math.round(d / 30)} months`;
  return `${(d / 365).toFixed(1)} years`;
}
export function fmtSigned(v: number, digits = 0): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
}
export function fmtMult(m: number): string {
  const pct = Math.round((m - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

export const BONUS_LABELS: Record<keyof Bonuses, string> = {
  trainingSpeed: 'training speed',
  inferenceEfficiency: 'inference efficiency',
  dataQuality: 'data quality',
  researchSpeed: 'research speed',
  safety: 'safety',
  brand: 'brand',
  sales: 'enterprise sales',
  releaseHype: 'release hype',
  finetuneCost: 'fine-tune cost',
  budgetAppeal: 'budget appeal',
  crownValue: 'crown value',
  openPenalty: 'open-weights user loss',
  valuation: 'valuation',
  contractFit: 'contract fit',
};
export const SCORE_LABELS: Record<keyof Scores, string> = {
  reasoning: 'Reasoning',
  coding: 'Coding',
  chat: 'Chat',
  safety: 'Safety',
};

/** Panel header: [CODE <GO>] TITLE sub, amber rule underneath. Wraps the shared PanelHeader. */
export function PanelHeader(props: { code?: string; title: string; sub?: string; children?: any }) {
  return <SharedPanelHeader code={props.code} title={props.title} subtitle={props.sub} actions={props.children} />;
}

/** Window container. Extra props (e.g. data-owned, data-state) are forwarded to the element. */
export function Card(props: { class?: string; glow?: boolean; children?: any; [attr: string]: any }) {
  const { class: cls, glow, children, ...rest } = props;
  return (
    <section {...rest} class={`pn-card ${glow ? 'pn-card--glow' : ''} ${cls ?? ''}`}>
      {children}
    </section>
  );
}

/** Flat progress bar. Tone picks the fill colour. */
export function Bar(props: { value: number; max?: number; tone?: Tone; class?: string; title?: string }) {
  const max = props.max ?? 1;
  const pct = clamp01(max > 0 ? props.value / max : 0) * 100;
  return (
    <div class={`pn-bar ${props.class ?? ''}`} data-tone={props.tone ?? 'accent'} title={props.title}>
      <i style={{ width: `${pct.toFixed(2)}%` }} />
    </div>
  );
}

export function Meter(props: { label: string; value: number; max?: number; tone?: Tone; format?: (v: number) => string }) {
  const max = props.max ?? 100;
  return (
    <div class="pn-meter">
      <div class="pn-meter-head">
        <span>{props.label}</span>
        <b>{props.format ? props.format(props.value) : Math.round(props.value)}</b>
      </div>
      <Bar value={props.value} max={max} tone={props.tone} />
    </div>
  );
}

export function ScoreBars(props: { scores: Scores; overall?: number; compact?: boolean }) {
  const keys = Object.keys(SCORE_LABELS) as (keyof Scores)[];
  return (
    <div class={`pn-scores ${props.compact ? 'pn-scores--compact' : ''}`}>
      {keys.map((k) => (
        <div class="pn-score-row" key={k}>
          <span>{SCORE_LABELS[k]}</span>
          <Bar value={props.scores[k]} max={100} tone="accent" />
          <b>{Math.round(props.scores[k])}</b>
        </div>
      ))}
      {props.overall !== undefined && (
        <div class="pn-score-row pn-score-row--overall">
          <span>Overall</span>
          <Bar value={props.overall} max={100} tone="good" />
          <b>{Math.round(props.overall)}</b>
        </div>
      )}
    </div>
  );
}

/** Progress as a row of square cells, with the value beside it. `size` and `stroke` are kept for compatibility. */
export function Ring(props: { value: number; size?: number; stroke?: number; children?: any }) {
  const lit = Math.round(clamp01(props.value) * 8);
  return (
    <span class="pn-ring">
      <span class="pn-ring-cells" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} class={i < lit ? 'on' : ''} />
        ))}
      </span>
      {props.children !== undefined && <span>{props.children}</span>}
    </span>
  );
}

export function Chip(props: { tone?: Tone; title?: string; children?: any }) {
  return (
    <span class="pn-chip" data-tone={props.tone ?? 'muted'} title={props.title}>
      {props.children}
    </span>
  );
}

/** Readout: caps label, value, optional dim sub line. */
export function Stat(props: { label: string; value: any; sub?: any; tone?: Tone }) {
  return (
    <div class="pn-stat" data-tone={props.tone ?? 'muted'}>
      <div class="pn-stat-label">{props.label}</div>
      <div class="pn-stat-value">{props.value}</div>
      {props.sub !== undefined && <div class="pn-stat-sub">{props.sub}</div>}
    </div>
  );
}

/** One dim uppercase line for empty lists. `icon` is accepted but never rendered (terminal theme). */
export function Empty(props: { icon?: string; title: string; children?: any }) {
  return (
    <div class="pn-empty">
      <div class="pn-empty-title">{props.title}</div>
      {props.children !== undefined && <div class="pn-empty-body">{props.children}</div>}
    </div>
  );
}

/** Bordered status line. `icon` is accepted but never rendered (terminal theme). */
export function Banner(props: { tone?: Tone; icon?: string; children?: any }) {
  return (
    <div class="pn-banner" data-tone={props.tone ?? 'warn'} role="status">
      {props.children}
    </div>
  );
}

/** Two-click destructive button: first click arms it, second confirms. Disarms after 3s. */
export function ConfirmButton(props: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  class?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      class={`pn-btn pn-btn--danger ${armed ? 'is-armed' : ''} ${props.class ?? ''}`}
      disabled={props.disabled}
      title={props.title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          props.onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? props.confirmLabel ?? 'Confirm' : props.label}
    </button>
  );
}

/** Loss curve: one thin amber line, one sample per simulated day. Dashed line for the predicted final loss. */
export function LossChart(props: { values: number[]; predicted?: number }) {
  const W = 560;
  const H = 150;
  const L = 40;
  const R = 12;
  const T = 10;
  const B = 20;
  const values = props.values;
  if (values.length < 2) {
    return <div class="pn-chart-empty">Loss curve starts after the first simulated day</div>;
  }
  const all = props.predicted !== undefined ? [...values, props.predicted] : values;
  let hi = Math.max(...all);
  let lo = Math.min(...all);
  if (hi - lo < 1e-6) {
    hi += 0.05;
    lo -= 0.05;
  }
  const n = values.length;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [hi, (hi + lo) / 2, lo];
  const last = values[n - 1];
  return (
    <svg class="pn-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Training loss curve">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} class="pn-grid-line" />
          <text x={L - 6} y={y(t) + 3} text-anchor="end" class="pn-axis">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {props.predicted !== undefined && (
        <>
          <line x1={L} x2={W - R} y1={y(props.predicted)} y2={y(props.predicted)} class="pn-pred-line" />
          <text x={W - R} y={y(props.predicted) - 4} text-anchor="end" class="pn-axis">
            predicted {props.predicted.toFixed(3)}
          </text>
        </>
      )}
      <polyline points={line} class="pn-loss-line" />
      <rect class="pn-loss-dot" x={x(n - 1) - 2} y={y(last) - 2} width="4" height="4" />
      <text x={L} y={H - 4} class="pn-axis">
        day 1
      </text>
      <text x={W - R} y={H - 4} text-anchor="end" class="pn-axis">
        day {n}
      </text>
    </svg>
  );
}

/**
 * Slider with optional marker (0..1 position on the track, e.g. the Chinchilla point).
 * On phones it gets − and + buttons that move by `stepBy` (default `step`), so a thumb can nudge it.
 */
export function Range(props: {
  min: number;
  max: number;
  step: number;
  /** Phone step-button size, in slider units. Default: `step`. */
  stepBy?: number;
  value: number;
  onInput?: (v: number) => void;
  onChange?: (v: number) => void;
  disabled?: boolean;
  label: string;
  marker?: number;
  markerLabel?: string;
}) {
  const isPhone = useIsMobile();
  const span = props.max - props.min || 1;
  const pct = clamp01((props.value - props.min) / span) * 100;
  const read = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const hasMarker = props.marker !== undefined;
  const m = hasMarker ? clamp01(props.marker!) : 0;
  const stepBy = props.stepBy ?? props.step;
  const nudge = (d: number) => {
    const v = Math.min(props.max, Math.max(props.min, props.value + d));
    if (v === props.value) return;
    props.onInput?.(v);
    props.onChange?.(v);
  };
  const input = (
    <input
      type="range"
      class="slider pn-range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      disabled={props.disabled}
      aria-label={props.label}
      style={`--p:${pct.toFixed(2)}%`}
      onInput={(e) => props.onInput?.(read(e))}
      onChange={(e) => props.onChange?.(read(e))}
    />
  );
  const marker = hasMarker && (
    <div
      class="pn-marker"
      data-label={props.markerLabel ?? ''}
      data-edge={m > 0.85 ? 'right' : m < 0.15 ? 'left' : 'mid'}
      style={`left:calc(4px + (100% - 8px) * ${m.toFixed(4)})`}
    />
  );
  if (!isPhone) {
    return (
      <div class={`pn-range-wrap ${hasMarker ? 'has-marker' : ''}`}>
        {input}
        {marker}
      </div>
    );
  }
  return (
    <div class="pn-range-wrap pn-range-wrap--phone">
      <div class="slider-row">
        <button
          type="button"
          class="slider-step"
          aria-label={`Decrease ${props.label}`}
          disabled={props.disabled || props.value <= props.min}
          onClick={() => nudge(-stepBy)}
        >
          −
        </button>
        <div class={`pn-range-track ${hasMarker ? 'has-marker' : ''}`}>
          {input}
          {marker}
        </div>
        <button
          type="button"
          class="slider-step"
          aria-label={`Increase ${props.label}`}
          disabled={props.disabled || props.value >= props.max}
          onClick={() => nudge(stepBy)}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Multiplicative bonus chips, e.g. "+50% training speed". */
export function BonusChips(props: { bonuses?: Partial<Bonuses> }) {
  const entries = Object.entries(props.bonuses ?? {}) as [keyof Bonuses, number][];
  if (entries.length === 0) return null;
  return (
    <div class="pn-chips">
      {entries.map(([k, v]) => (
        <Chip key={k} tone={v >= 1 ? 'good' : 'bad'}>
          {fmtMult(v)} {BONUS_LABELS[k]}
        </Chip>
      ))}
    </div>
  );
}

/** Additive score bonus chips, e.g. "+12 coding". */
export function ScoreChips(props: { bonus?: Partial<Scores> }) {
  const entries = Object.entries(props.bonus ?? {}) as [keyof Scores, number][];
  if (entries.length === 0) return null;
  return (
    <div class="pn-chips">
      {entries.map(([k, v]) => (
        <Chip key={k} tone="accent">
          {fmtSigned(v)} {SCORE_LABELS[k].toLowerCase()}
        </Chip>
      ))}
    </div>
  );
}
