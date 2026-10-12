import { project } from '../iso';
import { C, shade } from '../palette';
import { Ctx, floorTile, planeX, planeY, poly } from './prims';

export const WALL_H = 60;

/** Warm checkered floor over a W x D footprint. `cell` = size of one checker square in floor units. */
export function drawFloor(c: Ctx, W: number, D: number, cell: number, tone: string, alt: string): void {
  const { g, p } = c;
  // base slab (slightly larger than the room, a visible edge)
  const e = project(p, -0.6, -0.6, -4);
  const f = project(p, W + 0.6, -0.6, -4);
  const h = project(p, W + 0.6, D + 0.6, -4);
  const k = project(p, -0.6, D + 0.6, -4);
  poly(g, [e[0], e[1], f[0], f[1], h[0], h[1], k[0], k[1]], C.floorEdge);
  const nx = Math.ceil(W / cell);
  const ny = Math.ceil(D / cell);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      floorTile(c, i * cell, j * cell, Math.min(cell, W - i * cell), Math.min(cell, D - j * cell), (i + j) % 2 ? alt : tone);
    }
  }
}

/** Back walls at y=0 (facing +y) and x=0 (facing +x), plus a baseboard trim. */
export function drawWalls(c: Ctx, W: number, D: number, h: number, trim: string): void {
  planeY(c, 0, W, 0, 0, h, C.wallLeft);
  planeX(c, 0, 0, D, 0, h, C.wallRight);
  planeY(c, 0, W, 0.02, 0, 2.5, trim);
  planeX(c, 0.02, 0, D, 0, 2.5, shade(trim, 0.9));
  // crown line
  planeY(c, 0, W, 0, h - 1.5, h, trim);
  planeX(c, 0, 0, D, h - 1.5, h, shade(trim, 0.9));
}

/** Thin amber rule along the top of the back walls. Flat line, no glow. */
export function drawNeonStrip(c: Ctx, W: number, D: number, h: number, t: number): void {
  const { g, p } = c;
  const a = project(p, 0, 0.05, h - 6);
  const b = project(p, W, 0.05, h - 6);
  const cc = project(p, 0.05, 0, h - 6);
  const d = project(p, 0.05, D, h - 6);
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = C.amberDim;
  g.lineWidth = Math.max(1, 1 * p.scale);
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.moveTo(cc[0], cc[1]);
  g.lineTo(d[0], d[1]);
  g.stroke();
  g.restore();
}
