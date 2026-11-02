// Pit Wall colours for the camera feeds (v18 scene kit). Read from the CSS tokens in src/ui/theme.css at draw time,
// so the feeds follow the dark and the light theme. Everything else in the kit derives its surfaces from `T`.
// Light comes from the upper left: tops are brightest, faces toward +x (lower right on screen) are mid, faces toward
// +y (lower left) are darkest. `face()` gives those three tones for any base colour.

export type RGB = [number, number, number];

const parsed = new Map<string, RGB>();

/** Parse '#rgb', '#rrggbb', 'rgb(...)' or 'rgba(...)'. Unknown strings read as mid grey. */
export function rgb(c: string): RGB {
  let v = parsed.get(c);
  if (v) return v;
  const s = c.trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s.slice(1, 7);
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    const p = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : [128, 128, 128];
    v = [p[0] || 0, p[1] || 0, p[2] || 0];
  }
  parsed.set(c, v);
  return v;
}

const memo = new Map<string, string>();
function remember(key: string, make: () => string): string {
  let v = memo.get(key);
  if (v === undefined) {
    if (memo.size > 6000) memo.clear();
    v = make();
    memo.set(key, v);
  }
  return v;
}
const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Multiply a colour (0.5 darker, 1.3 lighter). */
export function shade(c: string, f: number): string {
  return remember(`s${c}|${f}`, () => {
    const [r, g, b] = rgb(c);
    return `rgb(${cl(r * f)},${cl(g * f)},${cl(b * f)})`;
  });
}

/** Linear blend from a to b. */
export function mix(a: string, b: string, t: number): string {
  return remember(`m${a}|${b}|${t.toFixed(3)}`, () => {
    const A = rgb(a);
    const B = rgb(b);
    return `rgb(${cl(A[0] + (B[0] - A[0]) * t)},${cl(A[1] + (B[1] - A[1]) * t)},${cl(A[2] + (B[2] - A[2]) * t)})`;
  });
}

/** The colour with an alpha. */
export function alpha(c: string, a: number): string {
  return remember(`a${c}|${a.toFixed(3)}`, () => {
    const [r, g, b] = rgb(c);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  });
}

/** Relative luminance 0..1 (sRGB, rough). */
export function luma(c: string): number {
  const [r, g, b] = rgb(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Top, +x face and +y face tones for a base colour, lit from the upper left. */
export function face(c: string): [string, string, string] {
  return [c, shade(c, 0.8), shade(c, 0.62)];
}

export interface Theme {
  dark: boolean;
  /** Token colours. */
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
  /** Racing yellow fill (the team colour) and the readable accent for text and edges. */
  hl: string;
  accent: string;
  onHl: string;
  up: string;
  down: string;
  warn: string;
  sota: string;
  blue: string;
  /** Derived surfaces. */
  ground: string;
  groundLine: string;
  floor: string;
  floorAlt: string;
  slab: string;
  wall: string;
  wallTop: string;
  metal: string;
  metalDark: string;
  desk: string;
  chair: string;
  screen: string;
  glass: string;
  plant: string;
  plantDark: string;
  pot: string;
  wood: string;
  cardboard: string;
  lamp: string;
  shadow: string;
  /** Pit Wall tag: backing and text. */
  tagBg: string;
  tagFg: string;
  /** Font stacks. */
  figure: string;
  display: string;
}

const DARK = {
  bg: '#0b0b0c',
  bg1: '#141416',
  bg2: '#1c1c1f',
  bg3: '#27272b',
  line: '#26262a',
  line2: '#3c3c42',
  fg: '#f4f5f7',
  fg2: '#c4c8cf',
  fg3: '#8b9099',
  fg4: '#50535a',
  hl: '#ffd000',
  accent: '#ffd000',
  onHl: '#111111',
  up: '#2bdc6a',
  down: '#ff3b4e',
  warn: '#ff9f1c',
  sota: '#b65cff',
  blue: '#aeb5c0',
};
type Tokens = typeof DARK;

const TOKEN_NAMES: Record<keyof Tokens, string> = {
  bg: '--bg',
  bg1: '--bg-1',
  bg2: '--bg-2',
  bg3: '--bg-3',
  line: '--line',
  line2: '--line-2',
  fg: '--fg',
  fg2: '--fg-2',
  fg3: '--fg-3',
  fg4: '--fg-4',
  hl: '--hl',
  accent: '--accent',
  onHl: '--on-hl',
  up: '--up',
  down: '--down',
  warn: '--warn',
  sota: '--sota',
  blue: '--blue',
};

function derive(k: Tokens): Theme {
  const dark = luma(k.bg) < 0.5;
  const base = {
    ...k,
    dark,
    figure: "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif",
    display: "'Titillium Web', 'Barlow', system-ui, sans-serif",
    plant: dark ? '#3e8a57' : '#3f9a5e',
    plantDark: dark ? '#26583a' : '#2a6e43',
    pot: dark ? '#5b5f68' : '#8d929b',
    wood: dark ? '#6b5a47' : '#b39776',
    cardboard: dark ? '#7d6648' : '#c2a274',
    lamp: '#ffe6a6',
    tagFg: k.fg,
  };
  if (dark) {
    return {
      ...base,
      ground: mix(k.bg, k.bg2, 0.55),
      groundLine: alpha(k.line2, 0.32),
      floor: mix(k.bg3, k.fg4, 0.34),
      floorAlt: mix(k.bg3, k.fg4, 0.2),
      slab: k.bg1,
      wall: mix(k.bg3, k.fg4, 0.5),
      wallTop: k.line2,
      metal: k.fg2,
      metalDark: k.fg4,
      desk: mix(k.fg2, k.fg3, 0.35),
      chair: mix(k.bg1, k.bg2, 0.5),
      screen: '#0a0c10',
      glass: alpha(k.fg2, 0.16),
      shadow: 'rgba(0,0,0,0.42)',
      tagBg: alpha(k.bg1, 0.92),
    };
  }
  return {
    ...base,
    ground: mix(k.bg, k.bg3, 0.45),
    groundLine: alpha(k.line2, 0.5),
    floor: k.bg1,
    floorAlt: k.bg2,
    slab: mix(k.bg3, k.line2, 0.5),
    wall: mix(k.bg3, k.bg2, 0.3),
    wallTop: k.fg4,
    metal: k.fg3,
    metalDark: k.fg2,
    desk: k.bg1,
    chair: k.fg3,
    screen: '#15181e',
    glass: alpha('#9fb3c8', 0.28),
    shadow: 'rgba(11,14,21,0.2)',
    tagBg: alpha(k.bg1, 0.95),
  };
}

/** The live theme. Call `syncTheme()` at the top of a frame; read `T.*` while drawing. */
export const T: Theme = derive(DARK);

let stamp = 0;
let lastRead = -Infinity;
let lastAttr: string | null = null;
let lastKey = '';

/**
 * Refresh `T` from the CSS tokens when the theme attribute changes, and at most every 2 s otherwise (the system
 * scheme can flip too). Returns a stamp that changes whenever the colours change, for cache signatures.
 */
export function syncTheme(now = Date.now()): number {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return stamp;
  const el = document.documentElement;
  const attr = el.getAttribute('data-theme');
  if (attr === lastAttr && now - lastRead < 2000) return stamp;
  lastAttr = attr;
  lastRead = now;
  const cs = getComputedStyle(el);
  const k = { ...DARK };
  for (const key of Object.keys(TOKEN_NAMES) as (keyof Tokens)[]) {
    const v = cs.getPropertyValue(TOKEN_NAMES[key]).trim();
    if (v && (v[0] === '#' || v.startsWith('rgb'))) k[key] = v;
  }
  const sig = Object.values(k).join('|');
  if (sig !== lastKey) {
    lastKey = sig;
    Object.assign(T, derive(k));
    stamp++;
  }
  return stamp;
}

/** Role colours for people (shirts) and department livery: categorical, tuned per theme. */
export function roleColor(role: string): string {
  const d = T.dark;
  switch (role) {
    case 'researcher':
      return d ? '#ff9f1c' : '#d27400';
    case 'engineer':
      return d ? '#5b9bff' : '#2f6fdc';
    case 'safety':
      return d ? '#e8e04a' : '#a99a00';
    case 'sales':
      return d ? '#2bdc6a' : '#12994a';
    case 'marketing':
      return d ? '#c06bff' : '#8a3fd1';
    default:
      return T.fg3;
  }
}

/**
 * A neutral surface tone for a luminance `l` (0 black .. 0.32 light) of the original warm-dark art: graphite in the
 * dark theme, pale concrete in the light one (an architectural model). Keeps light and dark parts in order.
 */
export function tone(l: number): string {
  const k = Math.max(0, Math.min(1, l / 0.32));
  return T.dark ? mix(T.bg, mix(T.fg4, T.fg3, 0.2), k) : mix(mix(T.fg4, T.fg3, 0.3), T.bg1, k);
}

/**
 * The keys of the original office palette (src/office/palette.ts `C`), read live from the theme, so scenes written
 * against that palette switch over with one import. Use `shade` and `mix` from this module with it (they take rgb()).
 */
export const TC = {
  get bgTop() { return T.bg; },
  get bgBottom() { return T.ground; },
  get floorA() { return T.floor; },
  get floorB() { return T.floorAlt; },
  get floorEdge() { return T.slab; },
  get wallLeft() { return T.wall; },
  get wallRight() { return shade(T.wall, 0.8); },
  get wallTrim() { return T.wallTop; },
  get deskTop() { return T.desk; },
  get deskSide() { return shade(T.desk, 0.7); },
  get deskLeg() { return T.metalDark; },
  get chairSeat() { return T.chair; },
  get chairBack() { return shade(T.chair, 1.15); },
  get monitorBezel() { return '#16181c'; },
  get monitorScreen() { return T.screen; },
  get keyboard() { return T.metalDark; },
  get plant() { return T.plant; },
  get plantPot() { return T.pot; },
  get coffeeBody() { return T.metal; },
  get coffeeAccent() { return T.down; },
  get rackBody() { return T.dark ? '#1d1f24' : '#3a3d44'; },
  get rackFrame() { return T.metalDark; },
  get whiteboard() { return T.dark ? '#e9ebee' : '#ffffff'; },
  get whiteboardFrame() { return T.metal; },
  get windowFrame() { return T.metalDark; },
  get shield() { return T.hl; },
  get headset() { return T.metalDark; },
  get amberDim() { return T.dark ? shade(T.hl, 0.7) : T.accent; },
  get amber() { return T.hl; },
  get blue() { return T.blue; },
  get green() { return T.up; },
  get red() { return T.down; },
  get yellow() { return T.warn; },
  get fg() { return T.fg; },
  get fgDim() { return T.fg2; },
  get textDim() { return T.fg3; },
};
