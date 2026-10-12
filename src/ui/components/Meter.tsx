import { clamp } from './format';

export interface MeterProps {
  value: number;
  /** Top of the scale. Default 100. */
  max?: number;
  label?: string;
  /** Dim line under the bar. */
  caption?: string;
  class?: string;
}

const CELLS = 20;

/** Segmented level readout: LABEL ........ 82 / 100, then a 20-cell bar. */
export function Meter({ value, max = 100, label = 'AI hype', caption, class: cls }: MeterProps) {
  const frac = max > 0 && isFinite(value) ? clamp(value / max, 0, 1) : 0;
  const lit = Math.round(frac * CELLS);
  const tone = frac >= 0.75 ? 'hot' : frac >= 0.4 ? 'warm' : 'cold';
  return (
    <div class={`meter meter-${tone} ${cls ?? ''}`}>
      <div class="meter-head">
        <span class="meter-label">{label}</span>
        <span class="meter-value">
          {Math.round(isFinite(value) ? value : 0)}
          <span class="faint"> / {max}</span>
        </span>
      </div>
      <div class="meter-cells" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
        {Array.from({ length: CELLS }, (_, i) => (
          <span key={i} class={i < lit ? 'on' : ''} />
        ))}
      </div>
      {caption && <div class="meter-caption">{caption}</div>}
    </div>
  );
}
