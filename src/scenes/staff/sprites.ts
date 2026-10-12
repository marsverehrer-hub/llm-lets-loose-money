// Desk sprites: each desk and its chair is painted once into a small offscreen canvas and then blitted every frame.
// That keeps the per-frame cost low (the office desk draws a glow gradient per monitor). Sprites are rebuilt only
// when the projection, the device pixel ratio or the layout changes. Screens are static here; the bars, racks and
// LEDs in the zones still move.
import { project, type Projector } from '../../office/iso';
import { drawChair, drawDesk } from '../../office/draw/furniture';
import type { Ctx } from '../../office/draw/prims';
import type { DeskSpot } from './layout';
import { drawEmptyDesk } from './draw';

interface Entry {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen-space padding around a desk sprite, for the small accessories that stick out of the footprint. */
const PAD = 8;

export class DeskSprites {
  private cache = new Map<string, Entry>();
  private frameKey = '';
  private dpr = 1;

  /** Forget every sprite (call when the layout changes). */
  reset(): void {
    this.cache.clear();
  }

  /** Call once per frame: drops the sprites when the projection or the pixel ratio has moved. */
  frame(p: Projector, dpr: number): void {
    this.dpr = dpr;
    const k = `${p.ox.toFixed(2)}|${p.oy.toFixed(2)}|${p.scale.toFixed(4)}|${dpr}`;
    if (k !== this.frameKey) {
      this.frameKey = k;
      this.cache.clear();
    }
  }

  /** Blit one desk (and its chair) at its depth. */
  draw(c: Ctx, d: DeskSpot): void {
    const key = `${d.key}|${d.x}|${d.y}|${d.kind}|${d.role}`;
    let e = this.cache.get(key);
    if (!e) {
      e = this.build(c.p, this.dpr, d);
      this.cache.set(key, e);
    }
    c.g.drawImage(e.canvas, e.x, e.y, e.w, e.h);
  }

  private build(p: Projector, dpr: number, d: DeskSpot): Entry {
    const corners: [number, number][] = [];
    for (const [wx, wy] of [
      [d.x - 0.1, d.y - 0.1],
      [d.x + 1.5, d.y - 0.1],
      [d.x - 0.1, d.y + 1.7],
      [d.x + 1.5, d.y + 1.7],
    ] as [number, number][]) {
      for (const z of [0, 34]) corners.push(project(p, wx, wy, z));
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of corners) {
      x0 = Math.min(x0, sx);
      y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx);
      y1 = Math.max(y1, sy);
    }
    const ox = Math.floor(x0 - PAD);
    const oy = Math.floor(y0 - PAD);
    const w = Math.ceil(x1 + PAD) - ox;
    const h = Math.ceil(y1 + PAD) - oy;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * dpr));
    canvas.height = Math.max(1, Math.ceil(h * dpr));
    const g = canvas.getContext('2d');
    if (g) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c: Ctx = { g, p: { ox: p.ox - ox, oy: p.oy - oy, scale: p.scale } };
      if (d.kind === 'empty' || !d.role) drawEmptyDesk(c, d.x, d.y);
      else drawDesk(c, d.x, d.y, d.role, d.role === 'engineer', 0.6, 0);
      drawChair(c, d.x + 0.45, d.y + 0.95);
    }
    return { canvas, x: ox, y: oy, w, h };
  }
}
