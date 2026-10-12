import { project, TILE_W, TILE_H, type Projector } from '../iso';
import { shade } from '../palette';

export interface Ctx {
  g: CanvasRenderingContext2D;
  p: Projector;
}

/** Filled iso-projected quad from floor-space corners (already projected to screen). */
export function poly(g: CanvasRenderingContext2D, pts: number[], fill: string): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

/** Axis-aligned iso box on the floor: footprint (x,y,w,d) and height h. Draws top, left and right faces. */
export function isoBox(c: Ctx, x: number, y: number, w: number, d: number, h: number, top: string, left?: string, right?: string): void {
  const { g, p } = c;
  const [x0, y0] = project(p, x, y, h);
  const [x1, y1] = project(p, x + w, y, h);
  const [x2, y2] = project(p, x + w, y + d, h);
  const [x3, y3] = project(p, x, y + d, h);
  const [b0x, b0y] = project(p, x, y, 0);
  const [b1x, b1y] = project(p, x + w, y, 0);
  const [b2x, b2y] = project(p, x + w, y + d, 0);
  const [b3x, b3y] = project(p, x, y + d, 0);
  // left-facing (toward +y) and right-facing (toward +x) walls
  poly(g, [x3, y3, x2, y2, b2x, b2y, b3x, b3y], left ?? shade(top, 0.7));
  poly(g, [x1, y1, x2, y2, b2x, b2y, b1x, b1y], right ?? shade(top, 0.85));
  poly(g, [x0, y0, x1, y1, x2, y2, x3, y3], top);
}

/** Iso block between heights z0 (bottom) and z1 (top). Use for slabs, tabletops, shelves. */
export function isoBlock(c: Ctx, x: number, y: number, w: number, d: number, z0: number, z1: number, top: string, left?: string, right?: string): void {
  const { g, p } = c;
  const [x0, y0] = project(p, x, y, z1);
  const [x1, y1] = project(p, x + w, y, z1);
  const [x2, y2] = project(p, x + w, y + d, z1);
  const [x3, y3] = project(p, x, y + d, z1);
  const [b2x, b2y] = project(p, x + w, y + d, z0);
  const [b3x, b3y] = project(p, x, y + d, z0);
  const [b1x, b1y] = project(p, x + w, y, z0);
  poly(g, [x3, y3, x2, y2, b2x, b2y, b3x, b3y], left ?? shade(top, 0.7));
  poly(g, [x1, y1, x2, y2, b2x, b2y, b1x, b1y], right ?? shade(top, 0.85));
  poly(g, [x0, y0, x1, y1, x2, y2, x3, y3], top);
}

/** Vertical plane facing +y (toward viewer's lower-left) spanning x0..x1 at y, heights z0..z1. */
export function planeY(c: Ctx, x0: number, x1: number, y: number, z0: number, z1: number, fill: string): number[] {
  const { g, p } = c;
  const a = project(p, x0, y, z1);
  const b = project(p, x1, y, z1);
  const cc = project(p, x1, y, z0);
  const dd = project(p, x0, y, z0);
  const pts = [a[0], a[1], b[0], b[1], cc[0], cc[1], dd[0], dd[1]];
  poly(g, pts, fill);
  return pts;
}

/** Vertical plane facing +x spanning y0..y1 at x, heights z0..z1. */
export function planeX(c: Ctx, x: number, y0: number, y1: number, z0: number, z1: number, fill: string): number[] {
  const { g, p } = c;
  const a = project(p, x, y0, z1);
  const b = project(p, x, y1, z1);
  const cc = project(p, x, y1, z0);
  const dd = project(p, x, y0, z0);
  const pts = [a[0], a[1], b[0], b[1], cc[0], cc[1], dd[0], dd[1]];
  poly(g, pts, fill);
  return pts;
}

/** Flat floor tile quad at height z. */
export function floorTile(c: Ctx, x: number, y: number, w: number, d: number, fill: string, z = 0): void {
  const { g, p } = c;
  const a = project(p, x, y, z);
  const b = project(p, x + w, y, z);
  const cc = project(p, x + w, y + d, z);
  const dd = project(p, x, y + d, z);
  poly(g, [a[0], a[1], b[0], b[1], cc[0], cc[1], dd[0], dd[1]], fill);
}

/** Line in floor space at height z. */
export function floorLine(c: Ctx, x0: number, y0: number, x1: number, y1: number, z: number, color: string, lw: number): void {
  const { g, p } = c;
  const a = project(p, x0, y0, z);
  const b = project(p, x1, y1, z);
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.strokeStyle = color;
  g.lineWidth = lw * p.scale;
  g.stroke();
}

/** Rounded rectangle path. */
export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Soft glow circle using radial gradient (cheap enough per-frame for a few dozen). */
export function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, withAlpha(color, alpha));
  grd.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Convert '#rrggbb' or 'rgb(...)' to rgba with alpha. */
export function withAlpha(color: string, a: number): string {
  if (color.startsWith('#')) {
    const p = parseInt(color.slice(1), 16);
    return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').slice(0, 3).map((s) => s.trim());
    return `rgba(${parts.join(',')},${a})`;
  }
  return color;
}

export { TILE_W, TILE_H };
