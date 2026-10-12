import { useEffect, useRef, useState } from 'preact/hooks';
import { formatNumber } from '../../sim/util';
import { monthYear, niceScale, withAlpha, yearLabel } from './format';
import { canvasPixelRatio, toCssPx, useUiScale } from '../uiScale';

export interface LinePoint {
  /** Horizontal value: a day number for dated charts, or an index. */
  x: number;
  y: number;
}

export interface LineSeries {
  name: string;
  color: string;
  points: LinePoint[];
  /** @deprecated no area fills in the terminal theme */
  fill?: boolean;
  dashed?: boolean;
  /** Stroke width in px. Default 2. */
  width?: number;
}

export interface LineChartProps {
  series: LineSeries[];
  /** Pixel height. Default 220. */
  height?: number;
  /** Y-axis and tooltip number formatter. Default formatNumber. */
  yFormat?: (v: number) => string;
  /**
   * X-axis label formatter. Default: calendar year for spans over 2 years,
   * "Mar 2019" otherwise (treats x as a day number since 2017-01-01).
   */
  xFormat?: (x: number) => string;
  /** Show the colour legend. Default true when there is more than one series. */
  legend?: boolean;
  emptyText?: string;
  /** Force the y-axis bounds. */
  yMin?: number;
  yMax?: number;
  /** Draw a dashed horizontal reference line at this y (e.g. 0). */
  refLine?: number;
  class?: string;
}

const PAD = { l: 60, r: 14, t: 14, b: 26 };
/** Read a theme token at draw time so canvas charts follow dark/light themes. */
function tok(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const defaultY = (v: number) => formatNumber(v, 1);

function domainOf(series: LineSeries[]) {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  let n = 0;
  for (const s of series) {
    for (const p of s.points) {
      if (!isFinite(p.x) || !isFinite(p.y)) continue;
      n++;
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
  }
  return { n, xmin, xmax, ymin, ymax };
}

interface Geometry {
  xmin: number;
  xmax: number;
  sc: ReturnType<typeof niceScale>;
  pw: number;
  ph: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  xFromPx: (px: number) => number;
}

function geometry(series: LineSeries[], w: number, h: number, yMin?: number, yMax?: number, refLine?: number): Geometry | null {
  const d = domainOf(series);
  if (d.n === 0) return null;
  const xmin = d.xmin;
  const xmax = d.xmax - xmin < 1e-9 ? xmin + 1 : d.xmax;
  let lo = yMin ?? d.ymin;
  let hi = yMax ?? d.ymax;
  if (refLine !== undefined) {
    lo = Math.min(lo, refLine);
    hi = Math.max(hi, refLine);
  }
  // Money charts look honest when they start at zero, unless the data is far from zero.
  if (yMin === undefined && lo >= 0 && lo < hi * 0.5) lo = 0;
  const sc = niceScale(lo, hi, 4);
  const pw = Math.max(1, w - PAD.l - PAD.r);
  const ph = Math.max(1, h - PAD.t - PAD.b);
  const span = sc.hi - sc.lo || 1;
  return {
    xmin,
    xmax,
    sc,
    pw,
    ph,
    X: (x) => PAD.l + ((x - xmin) / (xmax - xmin)) * pw,
    Y: (y) => PAD.t + (1 - (y - sc.lo) / span) * ph,
    xFromPx: (px) => xmin + ((px - PAD.l) / pw) * (xmax - xmin),
  };
}

function nearest(points: LinePoint[], x: number): LinePoint | null {
  let best: LinePoint | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.abs(p.x - x);
    if (d < bestD && isFinite(p.y)) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Every distinct sample x across the series, ascending. */
function sampleXs(series: LineSeries[]): number[] {
  const set = new Set<number>();
  for (const s of series) for (const p of s.points) if (isFinite(p.x) && isFinite(p.y)) set.add(p.x);
  return Array.from(set).sort((a, b) => a - b);
}

/** The sample x closest to x (keyboard and drag land on real samples). */
function snapX(series: LineSeries[], x: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const xv of sampleXs(series)) {
    const d = Math.abs(xv - x);
    if (d < bestD) {
      bestD = d;
      best = xv;
    }
  }
  return best;
}

function pickXFormat(xFormat: ((x: number) => string) | undefined, spanDays: number): (x: number) => string {
  if (xFormat) return xFormat;
  return spanDays > 730 ? yearLabel : monthYear;
}

interface DrawOpts {
  yFormat: (v: number) => string;
  xFormat?: (x: number) => string;
  yMin?: number;
  yMax?: number;
  refLine?: number;
  hover: number | null;
}

/** Canvas cannot read var(); swap token references for their current values. */
function resolveColor(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  return m ? tok(m[1], '#8a909c') : c;
}

function draw(canvas: HTMLCanvasElement, w: number, h: number, series0: LineSeries[], opts: DrawOpts) {
  const series = series0.map((s) => ({ ...s, color: resolveColor(s.color) }));
  // Backing store = CSS size x device pixel ratio x UI zoom, so the chart stays sharp at 150% and 225%.
  const dpr = canvasPixelRatio();
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const g = geometry(series, w, h, opts.yMin, opts.yMax, opts.refLine);
  if (!g) return;
  const { X, Y, sc, pw, ph, xmin, xmax } = g;
  const xFmt = pickXFormat(opts.xFormat, xmax - xmin);
  const bottom = PAD.t + ph;

  // grid + y labels
  ctx.font = '12px "IBM Plex Mono", ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  for (const t of sc.ticks) {
    const y = Math.round(Y(t)) + 0.5;
    if (y < PAD.t - 1 || y > bottom + 1) continue;
    ctx.strokeStyle = tok('--line', '#2b3038');
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(PAD.l + pw, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = tok('--fg-3', '#8a909c');
    ctx.fillText(opts.yFormat(t), PAD.l - 10, y);
  }

  // x labels
  const nx = Math.max(2, Math.min(6, Math.floor(pw / 110)));
  ctx.textBaseline = 'top';
  ctx.fillStyle = tok('--fg-3', '#8a909c');
  for (let i = 0; i <= nx; i++) {
    const xv = xmin + ((xmax - xmin) * i) / nx;
    ctx.textAlign = i === 0 ? 'left' : i === nx ? 'right' : 'center';
    ctx.fillText(xFmt(xv), X(xv), bottom + 9);
  }

  // reference line
  if (opts.refLine !== undefined) {
    const y = Math.round(Y(opts.refLine)) + 0.5;
    ctx.strokeStyle = tok('--fg-2', '#b3b8c2');
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(PAD.l + pw, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // series
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.l - 1, PAD.t - 4, pw + 2, ph + 8);
  ctx.clip();
  series.forEach((s, si) => {
    const pts = s.points.filter((p) => isFinite(p.x) && isFinite(p.y));
    if (pts.length === 0) return;
    const showFill = false; // terminal theme: no area fills
    if (showFill && pts.length > 1) {
      const grad = ctx.createLinearGradient(0, PAD.t, 0, bottom);
      grad.addColorStop(0, withAlpha(s.color, 0.3));
      grad.addColorStop(1, withAlpha(s.color, 0));
      ctx.beginPath();
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      ctx.lineTo(X(pts[pts.length - 1].x), bottom);
      ctx.lineTo(X(pts[0].x), bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(X(pts[0].x), Y(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 1.5;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (pts.length === 1) {
      ctx.fillStyle = s.color;
      ctx.fillRect(X(pts[0].x) - 2, Y(pts[0].y) - 2, 4, 4);
    }
  });
  ctx.restore();

  // hover crosshair + markers
  if (opts.hover !== null && isFinite(opts.hover)) {
    const hx = Math.round(X(opts.hover)) + 0.5;
    ctx.strokeStyle = tok('--amber', '#f2a94e');
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(hx, PAD.t);
    ctx.lineTo(hx, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    // Highlighted point per series: a filled dot with a ring in the series colour.
    for (const s of series) {
      const p = nearest(s.points, opts.hover);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = tok('--bg-1', '#181b20');
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = s.color;
      ctx.stroke();
    }
  }
}

let chartSeq = 0;

/**
 * Canvas line chart. Multiple series, DPR-aware, gradient fill, hover tooltip.
 * x values are day numbers by default (see xFormat). Redraws on resize and data change.
 */
export function LineChart({
  series,
  height = 220,
  yFormat = defaultY,
  xFormat,
  legend,
  emptyText = 'Not enough data yet. Give it a few days.',
  yMin,
  yMax,
  refLine,
  class: cls,
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const { zoom } = useUiScale();
  const idRef = useRef(0);
  if (!idRef.current) idRef.current = ++chartSeq;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const d = domainOf(series);
  const hasData = d.n > 0;
  // Signature of everything that affects drawing. Keeps 60fps re-renders cheap.
  const sig = [
    width,
    height,
    zoom,
    hover,
    yMin,
    yMax,
    refLine,
    d.xmin,
    d.xmax,
    series.map((s) => `${s.color}|${s.points.length}|${s.points.reduce((a, p) => a + (isFinite(p.y) ? p.y : 0), 0)}`).join(','),
  ].join('|');

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !hasData || width <= 0) return;
    draw(c, width, height, series, { yFormat, xFormat, yMin, yMax, refLine, hover });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  /** Nearest sample x to a viewport x (mouse, pen or touch). Null when outside the plot. */
  const pick = (clientX: number): void => {
    const c = canvasRef.current;
    if (!c || !hasData || width <= 0) return;
    const rect = c.getBoundingClientRect();
    // Pointer px are visual; the chart geometry is in CSS px of the zoomed root.
    const px = toCssPx(clientX - rect.left);
    const g = geometry(series, width, height, yMin, yMax, refLine);
    if (!g) return;
    if (px < PAD.l - 12 || px > PAD.l + g.pw + 12) {
      setHover(null);
      return;
    }
    setHover(snapX(series, g.xFromPx(px)));
  };

  // A tap on a phone leaves the tip up until the next tap elsewhere (touch has no mouseleave).
  useEffect(() => {
    if (hover === null) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [hover === null]);

  /** Arrow keys step through the samples; Escape clears. */
  const onKey = (e: KeyboardEvent) => {
    if (!hasData) return;
    if (e.key === 'Escape') {
      setHover(null);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const xs = sampleXs(series);
    if (xs.length === 0) return;
    e.preventDefault();
    let i: number;
    if (hover === null) i = e.key === 'ArrowLeft' ? xs.length - 1 : 0;
    else {
      const cur = xs.indexOf(snapX(series, hover) ?? xs[0]);
      i = Math.min(xs.length - 1, Math.max(0, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
    }
    setHover(xs[i]);
  };

  const g = hover !== null && hasData && width > 0 ? geometry(series, width, height, yMin, yMax, refLine) : null;
  const hx = g && hover !== null ? g.X(hover) : 0;
  const flip = g !== null && hx > width * 0.6;
  const showLegend = legend ?? series.length > 1;
  const xFmt = pickXFormat(xFormat, d.xmax - d.xmin);

  return (
    <div class={`chart-wrap ${cls ?? ''}`}>
      <div class="chart" ref={wrapRef} style={{ height: `${height}px` }}>
        {hasData ? (
          <canvas
            ref={canvasRef}
            class="chart-canvas"
            data-chart={idRef.current}
            tabIndex={0}
            role="img"
            aria-label={`${series.map((s) => s.name).join(', ')} chart. Use the arrow keys to read values.`}
            onPointerDown={(e) => pick(e.clientX)}
            onPointerMove={(e) => {
              // Touch only tracks while a finger is down (drag); the page can still scroll vertically.
              if (e.pointerType !== 'touch' || e.buttons > 0) pick(e.clientX);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setHover(null);
            }}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          />
        ) : (
          <div class="chart-empty">{emptyText}</div>
        )}
        {g && hover !== null && (
          <div class="chart-tip" style={flip ? { right: `${width - hx + 12}px` } : { left: `${hx + 12}px` }}>
            <div class="chart-tip-title">{xFmt(hover)}</div>
            {series.map((s) => {
              const p = nearest(s.points, hover);
              if (!p) return null;
              return (
                <div class="chart-tip-row" key={s.name}>
                  <span class="swatch" style={{ '--c': s.color } as any} />
                  <span>{s.name}</span>
                  <b>{yFormat(p.y)}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showLegend && hasData && (
        <div class="chart-legend">
          {series.map((s) => (
            <span class="chart-legend-item" key={s.name}>
              <span class="swatch" style={{ '--c': s.color } as any} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
