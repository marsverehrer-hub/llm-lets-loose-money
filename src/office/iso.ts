// Isometric projection helpers. World units: x/y on the floor grid, z = height.
// Screen: sx = ox + (x - y) * TW/2, sy = oy + (x + y) * TH/2 - z.

export const TILE_W = 40;
export const TILE_H = 20;

export interface Projector {
  ox: number;
  oy: number;
  scale: number; // device-pixel scale applied on top of TILE_W/H
}

export function project(p: Projector, x: number, y: number, z = 0): [number, number] {
  const sx = p.ox + (x - y) * (TILE_W / 2) * p.scale;
  const sy = p.oy + (x + y) * (TILE_H / 2) * p.scale - z * p.scale;
  return [sx, sy];
}

/** Depth key for painter's algorithm: anything further "down-screen" draws later. */
export function depth(x: number, y: number, z = 0): number {
  return x + y + z * 0.001;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Cheap deterministic pseudo-random from a seed (for stable decor per desk). */
export function prand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
