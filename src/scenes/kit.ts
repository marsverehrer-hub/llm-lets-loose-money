// v18 scene kit: the shared "Pit Wall" look for the isometric camera feeds (compute, data, research, models).
// One projection, one light (from the upper left: top faces brightest, +y faces lit, +x faces in shade), a palette read
// from the theme tokens, slanted caps tags, a ground grid that fills the frame, and an auto-fit camera that scales and
// centres the content to the canvas at any size. Scenes lay their pieces out on a staggered lattice (`lattice`) so a
// wide strip and a phone both fill up.
export const TW = 40;
export const TH = 20;

export interface Proj {
  ox: number;
  oy: number;
  s: number;
}

export interface Ctx {
  g: CanvasRenderingContext2D;
  p: Proj;
  pal: Pal;
}

export function iso(p: Proj, x: number, y: number, z = 0): [number, number] {
  return [p.ox + (x - y) * (TW / 2) * p.s, p.oy + ((x + y) * (TH / 2) - z) * p.s];
}

// ---------------------------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------------------------

type RGB = [number, number, number];
const rgbCache = new Map<string, RGB>();

function rgbOf(c: string): RGB {
  const hit = rgbCache.get(c);
  if (hit) return hit;
  let out: RGB = [128, 128, 128];
  const s = c.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isFinite(n)) out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((v) => parseFloat(v));
      out = [p[0] || 0, p[1] || 0, p[2] || 0];
    }
  }
  if (rgbCache.size > 512) rgbCache.clear();
  rgbCache.set(c, out);
  return out;
}

const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function mix(a: string, b: string, t: number): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return `rgb(${cl(A[0] + (B[0] - A[0]) * t)},${cl(A[1] + (B[1] - A[1]) * t)},${cl(A[2] + (B[2] - A[2]) * t)})`;
}

export function shade(c: string, f: number): string {
  const A = rgbOf(c);
  return `rgb(${cl(A[0] * f)},${cl(A[1] * f)},${cl(A[2] * f)})`;
}

export function alpha(c: string, a: number): string {
  const A = rgbOf(c);
  return `rgba(${A[0]},${A[1]},${A[2]},${Math.max(0, Math.min(1, a))})`;
}

/** Three faces of a block under the scene light: top, +y face (lit, screen left) and +x face (shade, screen right). */
export interface Tri {
  t: string;
  l: string;
  r: string;
}

export function tri(top: string, lit = 0.8, dark = 0.62): Tri {
  return { t: top, l: shade(top, lit), r: shade(top, dark) };
}

export interface Pal {
  light: boolean;
  bg: string;
  bg1: string;
  bg2: string;
  bg3: string;
  line: string;
  line2: string;
  fg: string;
  fg2: string;
  fg3: string;
  fg4: string;
  hl: string;
  onHl: string;
  accent: string;
  up: string;
  down: string;
  warn: string;
  sota: string;
  blue: string;
  /** Ground grid lines across the whole frame. */
  grid: string;
  /** Raised slabs every piece stands on, and the hairline rim on their top edges. */
  slab: Tri;
  rim: string;
  /** Floor tile seams on a slab. */
  seam: string;
  /** Walls of the cutaway rooms. */
  wall: Tri;
  /** Hardware: graphite bodies with brushed-silver tops and trim. */
  metal: Tri;
  steel: Tri;
  silver: string;
  /** Unlit LED. */
  ledOff: string;
  /** Tag fill and its text. */
  tagBg: string;
  tagFg: string;
  tagSub: string;
  /** Cardboard for crates. */
  card: string;
  /** People. */
  skin: string;
  hair: string;
}

const FALLBACK: Record<string, string> = {
  '--bg': '#0b0b0c',
  '--bg-1': '#141416',
  '--bg-2': '#1c1c1f',
  '--bg-3': '#27272b',
  '--line': '#26262a',
  '--line-2': '#3c3c42',
  '--fg': '#f4f5f7',
  '--fg-2': '#c4c8cf',
  '--fg-3': '#8b9099',
  '--fg-4': '#50535a',
  '--hl': '#ffd000',
  '--on-hl': '#111111',
  '--accent': '#ffd000',
  '--up': '#2bdc6a',
  '--down': '#ff3b4e',
  '--warn': '#ff9f1c',
  '--sota': '#b65cff',
  '--blue': '#aeb5c0',
};

let palCache: Pal | null = null;
let palKey = '';
let palAt = 0;

/** The palette from the theme tokens. Cheap to call every frame: it re-reads the tokens on a theme change or every 2 s. */
export function palette(): Pal {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const key = root?.getAttribute('data-theme') ?? '';
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (palCache && key === palKey && now - palAt < 2000) return palCache;
  palKey = key;
  palAt = now;
  const cs = root && typeof getComputedStyle !== 'undefined' ? getComputedStyle(root) : null;
  const v = (n: string) => (cs?.getPropertyValue(n).trim() || FALLBACK[n]) as string;
  const bg = v('--bg');
  const light = key === 'light' || (rgbOf(bg)[0] + rgbOf(bg)[1] + rgbOf(bg)[2]) / 3 > 140;
  const bg1 = v('--bg-1');
  const bg2 = v('--bg-2');
  const bg3 = v('--bg-3');
  const line = v('--line');
  const line2 = v('--line-2');
  const fg = v('--fg');
  const fg3 = v('--fg-3');
  const fg4 = v('--fg-4');
  // Hardware stays graphite in both themes (racks are black in daylight too); its top catches the light.
  const metalTop = light ? '#5b5f68' : '#50535b';
  palCache = {
    light,
    bg,
    bg1,
    bg2,
    bg3,
    line,
    line2,
    fg,
    fg2: v('--fg-2'),
    fg3,
    fg4,
    hl: v('--hl'),
    onHl: v('--on-hl'),
    accent: v('--accent'),
    up: v('--up'),
    down: v('--down'),
    warn: v('--warn'),
    sota: v('--sota'),
    blue: v('--blue'),
    grid: alpha(light ? line2 : line2, light ? 0.35 : 0.32),
    slab: light ? { t: bg1, l: bg3, r: shade(bg3, 0.88) } : { t: mix(bg2, bg3, 0.55), l: bg1, r: mix(bg, bg1, 0.4) },
    rim: light ? alpha(fg4, 0.9) : alpha(fg3, 0.55),
    seam: light ? alpha(line2, 0.55) : alpha(bg, 0.55),
    wall: light ? { t: line2, l: mix(bg3, line2, 0.4), r: shade(bg3, 0.9) } : { t: line2, l: mix(bg2, line2, 0.35), r: mix(bg1, bg2, 0.5) },
    metal: { t: metalTop, l: light ? '#2b2d33' : '#25262b', r: light ? '#1d1e22' : '#18191c' },
    steel: tri(light ? '#9aa0aa' : '#7d828c', 0.78, 0.6),
    silver: light ? '#c9ccd2' : '#b9bec7',
    ledOff: light ? '#3a3c42' : '#303238',
    tagBg: light ? alpha(bg1, 0.96) : alpha(bg1, 0.92),
    tagFg: fg,
    tagSub: fg3,
    card: light ? '#b89466' : '#9c7a4f',
    skin: '#d9b08c',
    hair: '#2a211b',
  };
  return palCache;
}

// ---------------------------------------------------------------------------------------------------------------
// Primitives (world space)
// ---------------------------------------------------------------------------------------------------------------

function quad(g: CanvasRenderingContext2D, a: number[], b: number[], c: number[], d: number[]): void {
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.lineTo(c[0], c[1]);
  g.lineTo(d[0], d[1]);
  g.closePath();
}

/** Block between z0 and z1 on the footprint (x, y, w, d), lit from the upper left. `rim` draws a hairline on the top's front edges. */
export function box(c: Ctx, x: number, y: number, w: number, d: number, z0: number, z1: number, f: Tri, rim?: string): void {
  const { g, p } = c;
  const a = iso(p, x, y, z1);
  const b = iso(p, x + w, y, z1);
  const cc = iso(p, x + w, y + d, z1);
  const e = iso(p, x, y + d, z1);
  const b1 = iso(p, x + w, y, z0);
  const b2 = iso(p, x + w, y + d, z0);
  const b3 = iso(p, x, y + d, z0);
  g.fillStyle = f.l;
  quad(g, e, cc, b2, b3);
  g.fill();
  g.fillStyle = f.r;
  quad(g, b, cc, b2, b1);
  g.fill();
  g.fillStyle = f.t;
  quad(g, a, b, cc, e);
  g.fill();
  if (rim) {
    g.strokeStyle = rim;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(e[0], e[1]);
    g.lineTo(cc[0], cc[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
}

/** Vertical face looking toward +y (screen lower left), x0..x1 at y, z0..z1. */
export function faceY(c: Ctx, x0: number, x1: number, y: number, z0: number, z1: number, fill: string): void {
  const { g, p } = c;
  quad(g, iso(p, x0, y, z1), iso(p, x1, y, z1), iso(p, x1, y, z0), iso(p, x0, y, z0));
  g.fillStyle = fill;
  g.fill();
}

/** Vertical face looking toward +x (screen lower right), y0..y1 at x, z0..z1. */
export function faceX(c: Ctx, x: number, y0: number, y1: number, z0: number, z1: number, fill: string): void {
  const { g, p } = c;
  quad(g, iso(p, x, y0, z1), iso(p, x, y1, z1), iso(p, x, y1, z0), iso(p, x, y0, z0));
  g.fillStyle = fill;
  g.fill();
}

/** Flat quad at height z. */
export function flat(c: Ctx, x: number, y: number, w: number, d: number, z: number, fill: string): void {
  const { g, p } = c;
  quad(g, iso(p, x, y, z), iso(p, x + w, y, z), iso(p, x + w, y + d, z), iso(p, x, y + d, z));
  g.fillStyle = fill;
  g.fill();
}

/** Thin line between two world points; width in screen px (scaled, at least `min`). */
export function line3(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, w = 1, min = 0.75): void {
  const { g, p } = c;
  const a = iso(p, x0, y0, z0);
  const b = iso(p, x1, y1, z1);
  g.strokeStyle = color;
  g.lineWidth = Math.max(min, w * p.s);
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

/** Raised slab with tile seams every `tile` units and a silver rim: the floor every piece stands on. */
export function slab(c: Ctx, x: number, y: number, w: number, d: number, h: number, tile: number, top?: Tri, seam?: string): void {
  const { g, p, pal } = c;
  box(c, x, y, w, d, -h, 0, top ?? pal.slab, pal.rim);
  if (tile > 0 && p.s * tile * TH > 4) {
    g.strokeStyle = seam ?? pal.seam;
    g.lineWidth = 1;
    g.beginPath();
    for (let u = x + tile; u < x + w - 1e-6; u += tile) {
      const a = iso(p, u, y, 0);
      const b = iso(p, u, y + d, 0);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    for (let v = y + tile; v < y + d - 1e-6; v += tile) {
      const a = iso(p, x, v, 0);
      const b = iso(p, x + w, v, 0);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    g.stroke();
  }
}

/** Soft contact shadow on the ground under a floating or standing footprint. */
export function shadow(c: Ctx, x: number, y: number, w: number, d: number, a = 0.28): void {
  flat(c, x, y, w, d, 0, alpha(c.pal.light ? '#0b0e15' : '#000000', a));
}

/** A person standing or walking at (x, y): legs, torso in `shirt`, head. About 15 units tall. Seated: torso only, lower. */
export function person(c: Ctx, x: number, y: number, shirt: string, walk: number, moving: boolean, accent?: string, sit = false): void {
  const { g, p, pal } = c;
  const [fx, fy0] = iso(p, x, y, 0);
  const s = p.s;
  if (s < 0.25) return;
  const sw = moving ? Math.sin(walk) * 1.6 * s : 0;
  const fy = sit ? fy0 - 1.5 * s : fy0;
  if (!sit) {
    g.fillStyle = alpha('#000000', pal.light ? 0.16 : 0.35);
    g.beginPath();
    g.ellipse(fx, fy, 3.6 * s, 1.6 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#26272c';
    g.fillRect(fx - 2 * s + sw * 0.4, fy - 6.5 * s, 1.6 * s, 6.5 * s);
    g.fillRect(fx + 0.4 * s - sw * 0.4, fy - 6.5 * s, 1.6 * s, 6.5 * s);
  }
  g.fillStyle = shirt;
  g.fillRect(fx - 2.6 * s, fy - 12.5 * s, 5.2 * s, 6.4 * s);
  if (accent) {
    g.fillStyle = accent;
    g.fillRect(fx - 2.6 * s, fy - 10 * s, 5.2 * s, 1.1 * s);
  }
  g.fillStyle = shade(shirt, 0.72);
  g.fillRect(fx + 1.4 * s, fy - 12.5 * s, 1.2 * s, 6.4 * s);
  g.fillStyle = pal.skin;
  g.beginPath();
  g.arc(fx, fy - 14.6 * s, 2.1 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = pal.hair;
  g.beginPath();
  g.arc(fx, fy - 15.2 * s, 2.15 * s, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
}

// ---------------------------------------------------------------------------------------------------------------
// Frame: background, fit and layout
// ---------------------------------------------------------------------------------------------------------------

/** Background: the theme's base and a faint iso ground grid across the whole frame (pit garage floor). */
export function background(c: Ctx, W: number, H: number, step = 2): void {
  const { g, p, pal } = c;
  // The grid is many full-width antialiased lines: draw it once per size, camera and theme, then blit the bitmap.
  const dpr = g.getTransform().a || 1;
  const key = `${W}x${H}@${dpr}|${p.ox.toFixed(1)},${p.oy.toFixed(1)},${p.s.toFixed(4)}|${pal.bg}|${pal.grid}|${step}`;
  let cv = bgCache.get(key);
  if (!cv && typeof document !== 'undefined') {
    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    const bg = cv.getContext('2d');
    if (bg) {
      bg.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintBackground(bg, p, pal, W, H, step);
    }
    if (bgCache.size >= 6) bgCache.delete(bgCache.keys().next().value as string);
    bgCache.set(key, cv);
  }
  if (cv) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(cv, 0, 0);
    g.restore();
  } else {
    paintBackground(g, p, pal, W, H, step);
  }
}

const bgCache = new Map<string, HTMLCanvasElement>();

function paintBackground(g: CanvasRenderingContext2D, p: Proj, pal: Pal, W: number, H: number, step: number): void {
  g.fillStyle = pal.bg;
  g.fillRect(0, 0, W, H);
  const u = step * (TW / 2) * p.s; // screen x per world unit along either axis
  if (u < 6) return;
  g.strokeStyle = pal.grid;
  g.lineWidth = 1;
  g.beginPath();
  // Lines of constant x and constant y are the two diagonals; draw both families across the canvas.
  const k = 0.5; // slope (TH / TW)
  const span = W * k + H;
  const off0 = (p.oy - p.ox * k) % (u * k * 2);
  for (let b = off0 - span; b < span + H; b += u * k * 2) {
    g.moveTo(0, b);
    g.lineTo(W, b + W * k);
  }
  const off1 = (p.oy + p.ox * k) % (u * k * 2);
  for (let b = off1 - span; b < span + H; b += u * k * 2) {
    g.moveTo(0, b);
    g.lineTo(W, b - W * k);
  }
  g.stroke();
}

/** A world box to fit: footprint plus height range. */
export interface Box3 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface Margins {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** Margins that clear the camera overlays (label top left, REC top right, date and Hide at the bottom). */
export function frameMargins(W: number, H: number): Margins {
  const phone = W < 520;
  return { t: phone ? 34 : Math.min(40, H * 0.15), r: phone ? 10 : 18, b: phone ? 34 : Math.min(36, H * 0.14), l: phone ? 10 : 18 };
}

/** Screen bounds of the boxes at scale 1, origin 0. */
export function screenBounds(boxes: Box3[]): { x0: number; y0: number; x1: number; y1: number } {
  const p: Proj = { ox: 0, oy: 0, s: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    for (const x of [b.x0, b.x1])
      for (const y of [b.y0, b.y1])
        for (const z of [b.z0, b.z1]) {
          const [sx, sy] = iso(p, x, y, z);
          if (sx < x0) x0 = sx;
          if (sx > x1) x1 = sx;
          if (sy < y0) y0 = sy;
          if (sy > y1) y1 = sy;
        }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0, y0, x1, y1 };
}

/** The auto-fit camera: scale and centre the boxes into W x H inside the margins. Returns the scale. */
export function fitIso(p: Proj, boxes: Box3[], W: number, H: number, m: Margins = frameMargins(W, H), maxS = 2.4): number {
  const b = screenBounds(boxes);
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const aw = Math.max(20, W - m.l - m.r);
  const ah = Math.max(20, H - m.t - m.b);
  const s = Math.max(0.05, Math.min(aw / bw, ah / bh, maxS));
  p.s = s;
  p.ox = m.l + (aw - bw * s) / 2 - b.x0 * s;
  p.oy = m.t + (ah - bh * s) / 2 - b.y0 * s;
  return s;
}

/** A cell on the staggered lattice: its world origin and its depth line (draw lines in increasing order). */
export interface Cell {
  x: number;
  y: number;
  line: number;
}

/**
 * Lay n square cells of side `cell` (gap `gap` between them) out on a staggered lattice: each depth line runs across
 * the screen, the next line sits half a step lower and nests into the gaps. Tries every line count and keeps the one
 * whose bounds (cells `zTop` tall) fit W x H at the largest scale. Cells come back in reading order.
 */
export function lattice(n: number, cell: number, gap: number, zTop: number, W: number, H: number, maxLines = 99): Cell[] {
  if (n <= 0) return [];
  const pitch = cell + gap;
  const m = frameMargins(W, H);
  const aw = Math.max(20, W - m.l - m.r);
  const ah = Math.max(20, H - m.t - m.b);
  let best: Cell[] = [];
  let bestS = -1;
  for (let lines = 1; lines <= Math.min(n, maxLines); lines++) {
    const per = Math.ceil(n / lines);
    const cells: Cell[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.floor(i / per);
      const inLine = Math.min(per, n - k * per);
      const idx = i - k * per;
      // Column index u has the parity of the line; short lines are centred by an even shift.
      const u = 2 * idx + (k % 2) + 2 * Math.floor((per - inLine) / 2) - per;
      const x = ((u + k) / 2) * pitch;
      const y = ((k - u) / 2) * pitch;
      cells.push({ x, y, line: k });
    }
    const b = screenBounds(cells.map((c) => ({ x0: c.x, y0: c.y, x1: c.x + cell, y1: c.y + cell, z0: 0, z1: zTop })));
    const s = Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0));
    if (s > bestS * 1.04) {
      bestS = s;
      best = cells;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Tags (screen space)
// ---------------------------------------------------------------------------------------------------------------

export const TAG_FONT = '"Barlow Condensed", "Titillium Web", "Barlow", system-ui, sans-serif';

export interface TagOpts {
  /** Edge colour (team yellow by default). */
  tone?: string;
  /** Fill the whole tag in the tone (the player's highlight), dark text on it. */
  solid?: boolean;
  /** Second, quieter part after the label (a figure). */
  sub?: string;
  /** 0..1: a thin progress rule under the tag. */
  progress?: number;
  /** Small variant (13 px tall). */
  small?: boolean;
  /** Draw a leader line down to the anchor this many px. */
  leader?: number;
  /** Anchor is the left end instead of the centre. */
  left?: boolean;
  alpha?: number;
  /** Only measure: return the box, draw nothing. */
  measure?: boolean;
}

/** A Pit Wall tag: slanted, caps, condensed, with a coloured edge. (x, y) is the bottom centre. Returns its screen box. */
export function tag(g: CanvasRenderingContext2D, pal: Pal, x: number, y: number, text: string, o: TagOpts = {}): { x0: number; y0: number; x1: number; y1: number } {
  const small = !!o.small;
  const h = small ? 14 : 17;
  const fs = small ? 10 : 11.5;
  const sl = small ? 4 : 5;
  const tone = o.tone ?? pal.hl;
  g.save();
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  const ls = g as unknown as { letterSpacing?: string };
  if ('letterSpacing' in g) ls.letterSpacing = '0.6px';
  g.font = `700 ${fs}px ${TAG_FONT}`;
  const main = text.toUpperCase();
  const wMain = g.measureText(main).width;
  let wSub = 0;
  const sub = o.sub ? o.sub.toUpperCase() : '';
  if (sub) {
    g.font = `600 ${fs}px ${TAG_FONT}`;
    wSub = g.measureText(sub).width + 6;
  }
  const edge = small ? 3 : 4;
  const w = Math.ceil(wMain + wSub + edge + sl * 2 + 8);
  const cw = g.canvas.clientWidth || g.canvas.width;
  let x0 = o.left ? x : x - w / 2;
  x0 = Math.max(4, Math.min(cw - w - 4, x0));
  const lead = o.leader ?? 0;
  const y1 = Math.round(y - lead);
  const y0 = y1 - h;
  x0 = Math.round(x0);
  if (o.measure) {
    if ('letterSpacing' in g) ls.letterSpacing = '0px';
    g.restore();
    return { x0, y0, x1: x0 + w, y1: y1 + lead };
  }
  if (lead > 0) {
    g.strokeStyle = alpha(tone, 0.75);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, y1);
    g.lineTo(Math.round(x) + 0.5, y);
    g.stroke();
  }
  const path = (a: number, b: number) => {
    g.beginPath();
    g.moveTo(a + sl, y0);
    g.lineTo(b + sl, y0);
    g.lineTo(b, y1);
    g.lineTo(a, y1);
    g.closePath();
  };
  path(x0, x0 + w);
  g.fillStyle = o.solid ? tone : pal.tagBg;
  g.fill();
  if (!o.solid) {
    path(x0, x0 + edge);
    g.fillStyle = tone;
    g.fill();
  }
  if (o.progress !== undefined) {
    const pw = (w - sl) * Math.max(0, Math.min(1, o.progress));
    g.fillStyle = o.solid ? pal.onHl : tone;
    g.fillRect(x0, y1 - 2, pw, 2);
  }
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `700 ${fs}px ${TAG_FONT}`;
  g.fillStyle = o.solid ? pal.onHl : pal.tagFg;
  const tx = x0 + edge + sl / 2 + 4;
  const ty = y0 + h / 2 + 0.5;
  g.fillText(main, tx, ty);
  if (sub) {
    g.font = `600 ${fs}px ${TAG_FONT}`;
    g.fillStyle = o.solid ? alpha(pal.onHl, 0.7) : pal.tagSub;
    g.fillText(sub, tx + wMain + 6, ty);
  }
  if ('letterSpacing' in g) ls.letterSpacing = '0px';
  g.restore();
  return { x0, y0, x1: x0 + w, y1 };
}

interface PendingTag {
  x: number;
  y: number;
  text: string;
  o: TagOpts;
  pri: number;
}

/**
 * Collects a frame's tags and draws them without overlaps: higher priority first; a tag that collides drops its
 * figure, then climbs on a longer leader, and is left out if it still does not fit (priority 10 and up always draws).
 * The camera overlays (label top left, REC top right, date and Hide at the bottom) are kept clear.
 */
export class Tags {
  private list: PendingTag[] = [];
  private kept: { x0: number; y0: number; x1: number; y1: number }[] = [];

  /** Keep a screen rectangle clear of tags this frame (a screen with text on it, say). */
  reserve(x0: number, y0: number, x1: number, y1: number): void {
    this.kept.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }

  add(x: number, y: number, text: string, o: TagOpts = {}, pri = 0): void {
    this.list.push({ x, y, text, o, pri });
  }

  flush(g: CanvasRenderingContext2D, pal: Pal, W: number, H: number): void {
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [
      { x0: 0, y0: 0, x1: 200, y1: 32 },
      { x0: W - 84, y0: 0, x1: W, y1: 32 },
      { x0: 0, y0: H - 32, x1: 120, y1: H },
      { x0: W - 70, y0: H - 34, x1: W, y1: H },
      ...this.kept,
    ];
    this.kept.length = 0;
    const hits = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      b.y0 < 2 || taken.some((t) => b.x0 < t.x1 + 2 && b.x1 > t.x0 - 2 && b.y0 < t.y1 + 1 && b.y1 > t.y0 - 1);
    this.list.sort((a, b) => b.pri - a.pri);
    for (const it of this.list) {
      const lead = it.o.leader ?? 0;
      const tries: TagOpts[] = [it.o];
      if (it.o.sub) tries.push({ ...it.o, sub: undefined });
      const base = tries.slice();
      for (const step of [1, 2, -1]) {
        for (const t of base) tries.push({ ...t, leader: Math.max(0, lead + step * (t.small ? 16 : 19)) });
      }
      let done = false;
      for (const t of tries) {
        const b = tag(g, pal, it.x, it.y, it.text, { ...t, measure: true });
        const box = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 - (t.leader ?? 0) };
        if (hits(box)) continue;
        tag(g, pal, it.x, it.y, it.text, t);
        taken.push(box);
        done = true;
        break;
      }
      if (!done && it.pri >= 10) {
        const b = tag(g, pal, it.x, it.y, it.text, it.o);
        taken.push(b);
      }
    }
    this.list.length = 0;
  }
}

/** Readout line in the frame's bottom right, left of the Hide button: caps, condensed, quiet. */
export function hud(g: CanvasRenderingContext2D, pal: Pal, W: number, H: number, text: string): void {
  if (W < 520) return;
  g.save();
  g.font = `600 11px ${TAG_FONT}`;
  const ls = g as unknown as { letterSpacing?: string };
  if ('letterSpacing' in g) ls.letterSpacing = '0.8px';
  g.textAlign = 'right';
  g.textBaseline = 'alphabetic';
  g.fillStyle = pal.fg3;
  g.fillText(text.toUpperCase(), W - 72, H - 13);
  if ('letterSpacing' in g) ls.letterSpacing = '0px';
  g.restore();
}

/** Racing-yellow selection outline around a world box (hover). */
export function outline(c: Ctx, b: Box3, color?: string): void {
  const { g, p, pal } = c;
  const P = (x: number, y: number, z: number) => iso(p, x, y, z);
  const pts = [
    P(b.x0, b.y0, b.z1),
    P(b.x1, b.y0, b.z1),
    P(b.x1, b.y0, b.z0),
    P(b.x1, b.y1, b.z0),
    P(b.x0, b.y1, b.z0),
    P(b.x0, b.y1, b.z1),
  ];
  g.save();
  g.strokeStyle = color ?? pal.hl;
  g.lineWidth = 1.5;
  g.setLineDash([5, 3]);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.stroke();
  g.restore();
}

/** Is (x, y) inside the screen silhouette of a world box? (The hexagon of its visible faces.) */
export function hitBox(p: Proj, b: Box3, x: number, y: number): boolean {
  const P = (wx: number, wy: number, wz: number) => iso(p, wx, wy, wz);
  const hex = [P(b.x0, b.y0, b.z1), P(b.x1, b.y0, b.z1), P(b.x1, b.y0, b.z0), P(b.x1, b.y1, b.z0), P(b.x0, b.y1, b.z0), P(b.x0, b.y1, b.z1)];
  let sign = 0;
  for (let i = 0; i < hex.length; i++) {
    const [ax, ay] = hex[i];
    const [bx, by] = hex[(i + 1) % hex.length];
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cr === 0) continue;
    const sg = cr > 0 ? 1 : -1;
    if (sign === 0) sign = sg;
    else if (sg !== sign) return false;
  }
  return true;
}

/** Counts with separators. */
export const cnt = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');

export function prand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function frac(x: number): number {
  return x - Math.floor(x);
}
