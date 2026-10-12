export interface SparklineProps {
  values: number[];
  /** Pixel height; the width stretches to its container. Default 22. */
  height?: number;
  color?: string;
  /** @deprecated no area fills in the terminal theme */
  fill?: boolean;
  strokeWidth?: number;
  class?: string;
}

/** Tiny inline SVG trend line. Renders a dotted flat line when there are fewer than 2 values. */
export function Sparkline({ values, height = 22, color = 'var(--amber)', strokeWidth = 1.25, class: cls }: SparklineProps) {
  const vals = values.filter((v) => isFinite(v));
  const W = 100;
  const H = height;
  if (vals.length < 2) {
    return (
      <svg class={`spark ${cls ?? ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: `${H}px` }}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--line-2)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" />
      </svg>
    );
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const n = vals.length;
  const d = vals
    .map((v, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - 2 - ((v - min) / span) * (H - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg class={`spark ${cls ?? ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: `${H}px` }}>
      <path d={d} fill="none" stroke={color} stroke-width={strokeWidth} vector-effect="non-scaling-stroke" />
    </svg>
  );
}
