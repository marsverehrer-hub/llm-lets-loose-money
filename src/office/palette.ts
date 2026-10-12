// Office palette: the terminal theme. Warm, desaturated interiors on black, amber
// accents and screen glow, green/red status LEDs. Mirrors the theme.css tokens.

export const C = {
  bg: '#0a0a0a',
  bgTop: '#0a0a0a',
  bgBottom: '#000000',
  floorA: '#2b2824',
  floorB: '#26231f',
  floorEdge: '#1a1816',
  wallLeft: '#1d1c1a',
  wallRight: '#171614',
  wallTrim: '#34312c',
  deskTop: '#6e5d48',
  deskSide: '#4f4334',
  deskLeg: '#2a2622',
  chairSeat: '#2a2a2a',
  chairBack: '#3a3a3a',
  monitorBezel: '#0d0d0d',
  monitorScreen: '#17110a',
  keyboard: '#2a2a2a',
  plant: '#4f6b4a',
  plantPot: '#7a5a3a',
  coffeeBody: '#d8d4cc',
  coffeeAccent: '#ff5a4f',
  rackBody: '#151515',
  rackFrame: '#2a2a2a',
  whiteboard: '#d9d4c7',
  whiteboardFrame: '#5a5650',
  windowFrame: '#2a2a2a',
  shield: '#ffa630',
  headset: '#1f1f1f',
  /** Warm secondary accent (was neon pink). */
  amberDim: '#b8741a',
  /** Primary accent: amber. Screen glow, training, labels. */
  amber: '#ffa630',
  /** Info accent (was cyan). */
  blue: '#5aa9ff',
  green: '#3fd47f',
  red: '#ff5a4f',
  yellow: '#ffe14d',
  /** Primary text on dark. */
  fg: '#e8e4dc',
  fgDim: '#a9a49a',
  textDim: '#6e6a63',
} as const;

export const ROLE_COLOR: Record<string, string> = {
  researcher: '#ffa630',
  engineer: '#5aa9ff',
  safety: '#ffe14d',
  sales: '#3fd47f',
  marketing: '#a9a49a',
};

export const ROLE_LABEL: Record<string, string> = {
  researcher: 'Researcher',
  engineer: 'Engineer',
  safety: 'Safety',
  sales: 'Sales',
  marketing: 'Marketing',
};

/** Linear blend of two hex colors (#rrggbb). t in 0..1. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Shade a hex color by factor (0.5 = darker, 1.5 = lighter). */
export function shade(hex: string, f: number): string {
  const p = parseInt(hex.slice(1), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((p >> 16) & 255) * f);
  const g = cl(((p >> 8) & 255) * f);
  const b = cl((p & 255) * f);
  return `rgb(${r},${g},${b})`;
}
