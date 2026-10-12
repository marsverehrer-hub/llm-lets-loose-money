import type { ComponentChildren } from 'preact';
import { clamp } from './format';
import type { ProgressTone } from './types';

export interface ProgressBarProps {
  /** Current amount. Fraction of `max`. */
  value: number;
  /** Full scale. Default 1 (so value is a 0..1 fraction). */
  max?: number;
  tone?: ProgressTone;
  /** Left caption above the bar. */
  label?: ComponentChildren;
  /** Right caption above the bar (monospace). */
  right?: ComponentChildren;
  striped?: boolean;
  height?: number;
  class?: string;
}

export function ProgressBar({ value, max = 1, tone = 'accent', label, right, striped, height = 8, class: cls }: ProgressBarProps) {
  const frac = max > 0 && isFinite(value) ? clamp(value / max, 0, 1) : 0;
  return (
    <div class={`progress-wrap ${cls ?? ''}`}>
      {(label != null || right != null) && (
        <div class="progress-meta">
          <span>{label}</span>
          <span class="num">{right}</span>
        </div>
      )}
      <div
        class={`progress ${striped ? 'progress-striped' : ''}`}
        style={{ height: `${height}px` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
      >
        <div class={`progress-bar ${tone === 'accent' ? '' : tone}`} style={{ width: `${(frac * 100).toFixed(2)}%` }} />
      </div>
    </div>
  );
}
