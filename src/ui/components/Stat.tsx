import type { ComponentChildren } from 'preact';
import { formatNumber } from '../../sim/util';
import { AnimatedNumber } from './AnimatedNumber';
import { Sparkline } from './Sparkline';
import { toneOfDelta } from './format';
import type { Tone } from './types';

export interface StatProps {
  label: ComponentChildren;
  /** Numbers tween (use `format` to control the text). Strings render as-is. */
  value: number | string;
  format?: (n: number) => string;
  /** Change since last period. Sign drives the colour. */
  delta?: number | null;
  /** Custom delta text, e.g. "+$12K/day". Overrides the default signed number. */
  deltaText?: string;
  /** Up is bad (e.g. burn rate). */
  invertDelta?: boolean;
  /** Small grey line under the value. */
  hint?: ComponentChildren;
  /** Colours the value text. */
  tone?: Tone;
  /** Trend line drawn under the value. */
  spark?: number[];
  sparkColor?: string;
  /** @deprecated Terminal theme renders no icons. */
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Flash green/red when a numeric value rises/falls. */
  flash?: boolean;
  class?: string;
}

/** KPI tile: label, animated value, optional delta, hint and sparkline. Put inside a Card. */
export function Stat(p: StatProps) {
  const size = p.size ?? 'md';
  const tone = toneOfDelta(p.delta, p.invertDelta);
  const hasDelta = p.delta != null && isFinite(p.delta);
  const arrow = hasDelta && p.delta !== 0 ? (p.delta! > 0 ? '▲ ' : '▼ ') : '';
  const deltaText = p.deltaText ?? (hasDelta ? `${arrow}${p.delta! > 0 ? '+' : ''}${formatNumber(p.delta!, 1)}` : '');
  const valueEl = typeof p.value === 'number' ? <AnimatedNumber value={p.value} format={p.format} flash={p.flash} /> : p.value;
  const valueTone = p.tone && p.tone !== 'default' ? p.tone : '';
  return (
    <div class={`stat stat-${size} ${p.class ?? ''}`}>
      <div class="stat-label">
        <span class="ellipsis">{p.label}</span>
      </div>
      <div class="stat-value-row">
        <span class={`stat-value ${valueTone}`}>{valueEl}</span>
        {hasDelta && <span class={`stat-delta ${tone}`}>{deltaText}</span>}
      </div>
      {p.hint != null && <div class="stat-hint">{p.hint}</div>}
      {p.spark && p.spark.length > 0 && (
        <div class="stat-spark">
          <Sparkline values={p.spark} color={p.sparkColor} height={22} />
        </div>
      )}
    </div>
  );
}
