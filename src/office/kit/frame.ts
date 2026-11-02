// Scene kit, framing: the auto-fit camera, the pod row layout, the graphite ground behind everything, Pit Wall tags
// and the HUD line. Screen coordinates are CSS px. World coordinates are the office iso grid (src/office/iso.ts).
import { TILE_H, TILE_W, type Projector } from '../iso';
import { T, alpha } from './theme';

/** Screen rectangle. */
export interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function emptyBox(): Box2 {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

/** Grow `b` by the screen box (scale 1, origin 0) of a world box from z0 to z1. */
export function addWorldBox(b: Box2, x: number, y: number, w: number, d: number, z0: number, z1: number): Box2 {
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const left = (x - (y + d)) * hw;
  const right = (x + w - y) * hw;
  const top = (x + y) * hh - z1;
  const bottom = (x + w + y + d) * hh - z0;
  if (left < b.x0) b.x0 = left;
  if (right > b.x1) b.x1 = right;
  if (top < b.y0) b.y0 = top;
  if (bottom > b.y1) b.y1 = bottom;
  return b;
}

export interface Margins {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** Room for the camera chips: label and REC at the top, date and Hide at the bottom (their corners stay free). */
export function feedMargins(W: number, H: number): Margins {
  const small = H < 200;
  return { t: small ? 16 : 22, r: 10, b: small ? 18 : 24, l: 10 };
}

/** Auto-fit camera: scale and centre a scale-1 screen box `b` inside W x H minus the margins. */
export function fitTo(p: Projector, b: Box2, W: number, H: number, m: Margins = feedMargins(W, H), max = 2.6, min = 0.18): void {
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const aw = Math.max(20, W - m.l - m.r);
  const ah = Math.max(20, H - m.t - m.b);
  const s = Math.max(min, Math.min(max, aw / bw, ah / bh));
  p.scale = s;
  p.ox = m.l + (aw - bw * s) / 2 - b.x0 * s;
  p.oy = m.t + (ah - bh * s) / 2 - b.y0 * s;
}

/** One diorama in a pod row: floor footprint (w along x, d along y), height above the floor and room for a tag. */
export interface PodSpec {
  w: number;
  d: number;
  /** Tallest thing in the pod, z units (px at scale 1). */
  h: number;
  /** Extra px above the back corner (a tag), at scale 1. */
  top?: number;
}

export interface PodPlan {
  /** World origin (back corner) of each pod, on whole grid units. */
  x: number[];
  y: number[];
  /** Row of each pod. */
  row: number[];
  rows: number;
  /** Scale-1 screen box of everything. */
  box: Box2;
}

function podW(p: PodSpec): number {
  return (p.w + p.d) * (TILE_W / 2);
}
function podH(p: PodSpec): number {
  return (p.w + p.d) * (TILE_H / 2) + p.h + (p.top ?? 0);
}

/** Split pods (in order) into `rows` rows of about equal width. */
function splitRows(pods: PodSpec[], rows: number, gapPx: number): number[][] {
  const total = pods.reduce((a, p) => a + podW(p) + gapPx, 0);
  const target = total / rows;
  const out: number[][] = [[]];
  let acc = 0;
  pods.forEach((p, i) => {
    const w = podW(p) + gapPx;
    const cur = out[out.length - 1];
    const left = pods.length - i;
    const rowsLeft = rows - out.length;
    if (cur.length > 0 && rowsLeft > 0 && (acc + w / 2 > target || left <= rowsLeft)) {
      out.push([i]);
      acc = w;
    } else {
      cur.push(i);
      acc += w;
    }
  });
  return out;
}

/**
 * Lay pods out as rows across the screen (each row runs along the world's x - y diagonal, which is screen
 * horizontal), choosing the row count that gives the biggest picture in an `aw` x `ah` frame. Pods keep their order.
 */
export function arrangePods(pods: PodSpec[], aw: number, ah: number, gap = 2, rowGap = 1.6, maxRows = 4): PodPlan {
  const n = pods.length;
  const gapPx = gap * (TILE_W / 2);
  let best: number[][] = [pods.map((_, i) => i)];
  let bestS = -1;
  for (let r = 1; r <= Math.min(n, maxRows); r++) {
    const rows = splitRows(pods, r, gapPx);
    const wMax = Math.max(...rows.map((row) => row.reduce((a, i) => a + podW(pods[i]), 0) + gapPx * (row.length - 1)));
    const hSum = rows.reduce((a, row) => a + Math.max(...row.map((i) => podH(pods[i]))), 0) + rowGap * TILE_H * (rows.length - 1);
    const s = Math.min(aw / wMax, ah / hSum);
    // A new row has to win clearly: rows cost depth cues, and the phone frame is the only one that needs them.
    if (s > bestS * 1.06) {
      bestS = s;
      best = rows;
    }
  }
  const x: number[] = new Array(n).fill(0);
  const y: number[] = new Array(n).fill(0);
  const row: number[] = new Array(n).fill(0);
  const widths = best.map((r) => r.reduce((a, i) => a + podW(pods[i]), 0) + gapPx * (r.length - 1));
  const wMax = Math.max(...widths);
  let base = 0;
  best.forEach((r, ri) => {
    const rh = Math.max(...r.map((i) => podH(pods[i])));
    base += rh;
    let left = (wMax - widths[ri]) / 2;
    for (const i of r) {
      const p = pods[i];
      // Left extreme (x, y + d) sits at `left`; the front corner (x + w, y + d) sits on the row's baseline.
      const u = left / (TILE_W / 2) + p.d; // x - y
      const v = base / (TILE_H / 2) - p.w - p.d; // x + y
      x[i] = Math.round((u + v) / 2);
      y[i] = Math.round((v - u) / 2);
      row[i] = ri;
      left += podW(p) + gapPx;
    }
    base += rowGap * TILE_H;
  });
  const box = emptyBox();
  pods.forEach((p, i) => addWorldBox(box, x[i], y[i], p.w, p.d, 0, p.h + (p.top ?? 0)));
  return { x, y, row, rows: best.length, box };
}

/** Floor point under a screen point at height z. */
export function floorAt(p: Projector, sx: number, sy: number, z = 0): [number, number] {
  const u = (sx - p.ox) / ((TILE_W / 2) * p.scale);
  const v = (sy - p.oy + z * p.scale) / ((TILE_H / 2) * p.scale);
  return [(u + v) / 2, (v - u) / 2];
}

/**
 * The graphite ground under every feed: fills the whole canvas, carries the floor grid out to the edges and fades
 * toward the top like a far wall, so nothing is left black. `step` is the grid pitch in floor units.
 */
export function drawGround(g: CanvasRenderingContext2D, p: Projector, W: number, H: number, step = 2): void {
  g.fillStyle = T.ground;
  g.fillRect(0, 0, W, H);
  const corners = [floorAt(p, 0, 0), floorAt(p, W, 0), floorAt(p, 0, H), floorAt(p, W, H)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x0 = Math.floor(Math.min(...xs) / step) * step;
  const x1 = Math.ceil(Math.max(...xs) / step) * step;
  const y0 = Math.floor(Math.min(...ys) / step) * step;
  const y1 = Math.ceil(Math.max(...ys) / step) * step;
  const hw = (TILE_W / 2) * p.scale;
  const hh = (TILE_H / 2) * p.scale;
  if ((x1 - x0) / step + (y1 - y0) / step < 600) {
    g.beginPath();
    for (let x = x0; x <= x1; x += step) {
      g.moveTo(p.ox + (x - y0) * hw, p.oy + (x + y0) * hh);
      g.lineTo(p.ox + (x - y1) * hw, p.oy + (x + y1) * hh);
    }
    for (let y = y0; y <= y1; y += step) {
      g.moveTo(p.ox + (x0 - y) * hw, p.oy + (x0 + y) * hh);
      g.lineTo(p.ox + (x1 - y) * hw, p.oy + (x1 + y) * hh);
    }
    g.strokeStyle = T.groundLine;
    g.lineWidth = 1;
    g.stroke();
  }
  // Haze toward the top of the frame, and a soft vignette at the sides.
  const haze = g.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, alpha(T.bg, T.dark ? 0.85 : 0.55));
  haze.addColorStop(0.45, alpha(T.bg, 0));
  haze.addColorStop(1, alpha(T.bg, T.dark ? 0.25 : 0));
  g.fillStyle = haze;
  g.fillRect(0, 0, W, H);
  const side = g.createLinearGradient(0, 0, W, 0);
  const e = Math.min(0.12, 60 / Math.max(1, W));
  side.addColorStop(0, alpha(T.bg, 0.6));
  side.addColorStop(e, alpha(T.bg, 0));
  side.addColorStop(1 - e, alpha(T.bg, 0));
  side.addColorStop(1, alpha(T.bg, 0.6));
  g.fillStyle = side;
  g.fillRect(0, 0, W, H);
}

export interface TagOpts {
  /** A figure after the label, in the condensed face. */
  value?: string;
  /** Racing-yellow (or any colour) fill with dark text: the player's own thing, or the selection. */
  solid?: boolean;
  /** 0..1 progress rule along the bottom. */
  progress?: number;
  /** Font size px (default 11). */
  size?: number;
  /** Text colour (default the theme text). */
  ink?: string;
  /** Where (x, y) sits on the tag: its bottom centre (default) or its centre. */
  anchor?: 'bottom' | 'center';
  /** 'left': x is the tag's left edge instead of its centre. Tags never leave the canvas either way. */
  align?: 'center' | 'left';
  /** A short stem from the tag down to the anchor point, px. */
  stem?: number;
  alpha?: number;
}

function setFont(g: CanvasRenderingContext2D, weight: number, size: number): void {
  g.font = `${weight} ${size}px ${T.figure}`;
}

/** Width a tag would take, px. */
export function tagWidth(g: CanvasRenderingContext2D, text: string, o: TagOpts = {}): number {
  const fs = o.size ?? 11;
  g.save();
  setFont(g, 600, fs);
  let w = g.measureText(text.toUpperCase()).width * 1.06;
  if (o.value) {
    setFont(g, 700, fs);
    w += g.measureText(o.value).width + fs * 0.5;
  }
  g.restore();
  return Math.ceil(w + fs * 1.6 + 4);
}

/**
 * Pit Wall tag: a slanted caps label with a bar in `color` on its leading edge (or a solid fill), drawn in screen
 * space. Returns its rectangle for hit tests.
 */
export function tag(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, o: TagOpts = {}): Box2 {
  const fs = o.size ?? 11;
  const label = text.toUpperCase();
  const h = Math.round(fs + 7);
  const sl = Math.round(h * 0.32);
  const w = tagWidth(g, label, o);
  const stem = o.stem ?? 0;
  const cw = g.canvas.width / (g.getTransform().a || 1);
  const want = o.align === 'left' ? x : x - w / 2;
  const left = Math.round(Math.max(3, Math.min(cw - w - 3, want)));
  const top = Math.round(o.anchor === 'center' ? y - h / 2 : y - h - stem);
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  if (stem > 0) {
    g.fillStyle = color;
    g.fillRect(Math.round(Math.max(left + 2, Math.min(left + w - 2, x))) - 0.5, top + h, 1, stem);
  }
  g.beginPath();
  g.moveTo(left + sl, top);
  g.lineTo(left + w, top);
  g.lineTo(left + w - sl, top + h);
  g.lineTo(left, top + h);
  g.closePath();
  g.fillStyle = o.solid ? color : T.tagBg;
  g.fill();
  if (!o.solid) {
    g.strokeStyle = alpha(T.fg3, T.dark ? 0.35 : 0.45);
    g.lineWidth = 1;
    g.stroke();
    // Leading bar in the livery colour.
    g.beginPath();
    g.moveTo(left + sl, top);
    g.lineTo(left + sl + 4, top);
    g.lineTo(left + 4, top + h);
    g.lineTo(left, top + h);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }
  if (o.progress !== undefined) {
    const pw = Math.max(0, Math.min(1, o.progress)) * (w - sl - 6);
    g.fillStyle = o.solid ? T.onHl : T.hl;
    g.fillRect(left + sl * 0.2 + 5, top + h - 2, pw, 2);
  }
  const ink = o.ink ?? (o.solid ? T.onHl : T.tagFg);
  g.fillStyle = ink;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  setFont(g, 600, fs);
  const ty = top + h / 2 + 0.5;
  let tx = left + sl * 0.5 + 8;
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${(fs * 0.06).toFixed(1)}px`;
  g.fillText(label, tx, ty);
  if (o.value) {
    tx += g.measureText(label).width + fs * 0.5;
    setFont(g, 700, fs);
    g.fillStyle = o.solid ? T.onHl : color;
    g.fillText(o.value, tx, ty);
  }
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
  g.restore();
  return { x0: left, y0: top, x1: left + w, y1: top + h };
}

/** One HUD segment: text and colour. */
export type HudPart = [string, string];

/**
 * The feed's HUD line, bottom centre between the date chip and the Hide button: condensed caps on a slanted strip.
 * Segments drop from the end when the frame is too narrow.
 */
export function hud(g: CanvasRenderingContext2D, W: number, H: number, parts: HudPart[]): void {
  if (!parts.length) return;
  const room = Math.max(60, W - 2 * (W < 520 ? 104 : 140));
  g.save();
  let fs = W < 520 ? 10.5 : 11.5;
  let use = parts.slice();
  const measure = () => {
    setFont(g, 600, fs);
    return use.reduce((a, [t]) => a + g.measureText(t.toUpperCase()).width, 0) + (use.length - 1) * fs * 1.4;
  };
  let tw = measure();
  while (tw > room && use.length > 1) {
    use = use.slice(0, -1);
    tw = measure();
  }
  if (tw > room) {
    fs = Math.max(8.5, fs * (room / tw));
    tw = measure();
  }
  const h = fs + 7;
  const sl = h * 0.32;
  const x0 = Math.round(W / 2 - tw / 2 - 10);
  const y0 = Math.round(H - h - 7);
  g.beginPath();
  g.moveTo(x0 + sl, y0);
  g.lineTo(x0 + tw + 20, y0);
  g.lineTo(x0 + tw + 20 - sl, y0 + h);
  g.lineTo(x0, y0 + h);
  g.closePath();
  g.fillStyle = T.tagBg;
  g.fill();
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  let x = x0 + 10;
  use.forEach(([t, c], i) => {
    if (i > 0) {
      g.fillStyle = T.fg4;
      g.fillRect(Math.round(x + fs * 0.45), y0 + 5, 1, h - 10);
      x += fs * 1.4;
    }
    g.fillStyle = c;
    g.fillText(t.toUpperCase(), x, y0 + h / 2 + 0.5);
    x += g.measureText(t.toUpperCase()).width;
  });
  g.restore();
}
