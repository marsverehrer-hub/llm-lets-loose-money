// Compute scene drawing: halls, racks, pod, cloud platform, products, scaffolding and the terminal-style pill.
// Same primitives and palette as the HQ office (src/office). Racks keep their projected Path2D paths between frames;
// the scene refreshes them only when the camera fit changes.
import type { Ctx } from '../../office/draw/prims';
import { floorTile, glow, isoBlock, planeX, planeY, withAlpha } from '../../office/draw/prims';
import { project, type Projector } from '../../office/iso';
import { C, shade } from '../../office/palette';
import {
  BURST_Z,
  CLOUD_Z,
  LEDS,
  PRODUCT_H,
  RACK_FOOT,
  type CloudLayout,
  type HallLayout,
  type ProductsLayout,
  type RackDraw,
} from './layout';

/** Per-frame values shared by every drawable. */
export interface Frame {
  t: number;
  /** LED rows lit amber (training) and blue (serving). The rest are dark (idle). */
  nA: number;
  nB: number;
  training: boolean;
}

const RACK_TOP = C.rackBody;
const RACK_LEFT = shade(C.rackBody, 0.75);
const RACK_RIGHT = shade(C.rackBody, 0.9);

function pathOf(pts: number[][]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return p;
}

/** Screen paths for the three visible faces of a block. Same geometry as isoBlock. */
function blockPaths(p: Projector, x: number, y: number, w: number, d: number, z0: number, z1: number) {
  const P = (px: number, py: number, pz: number) => project(p, px, py, pz);
  const a = P(x, y, z1);
  const b = P(x + w, y, z1);
  const c = P(x + w, y + d, z1);
  const e = P(x, y + d, z1);
  const b1 = P(x + w, y, z0);
  const b2 = P(x + w, y + d, z0);
  const b3 = P(x, y + d, z0);
  return {
    top: pathOf([a, b, c, e]),
    left: pathOf([e, c, b2, b3]),
    right: pathOf([b, c, b2, b1]),
  };
}

/** Recompute a rack's screen paths for the current projection. */
export function refreshRack(p: Projector, r: RackDraw): void {
  const b = blockPaths(p, r.x, r.y, RACK_FOOT, RACK_FOOT, r.z, r.z + r.h);
  r.top = b.top;
  r.left = b.left;
  r.right = b.right;
  r.leds = [];
  // LED rows sit on the +y face (the left-facing side the viewer sees).
  for (let i = 0; i < LEDS; i++) {
    const z = r.z + 2 + (i * (r.h - 4)) / LEDS;
    const pts = [
      project(p, r.x + 0.06, r.y + RACK_FOOT, z),
      project(p, r.x + RACK_FOOT - 0.06, r.y + RACK_FOOT, z),
      project(p, r.x + RACK_FOOT - 0.06, r.y + RACK_FOOT, z + 1.3),
      project(p, r.x + 0.06, r.y + RACK_FOOT, z + 1.3),
    ];
    r.leds.push(pathOf(pts));
  }
}

/** Server rack. Non-pod racks take their LED mix from the fleet; pod racks pulse amber. */
export function drawRack(c: Ctx, r: RackDraw, f: Frame): void {
  const g = c.g;
  g.fillStyle = RACK_TOP;
  g.fill(r.top);
  g.fillStyle = RACK_LEFT;
  g.fill(r.left);
  g.fillStyle = RACK_RIGHT;
  g.fill(r.right);
  if (r.pod) {
    g.fillStyle = C.amber;
    for (let i = 0; i < LEDS; i++) {
      g.globalAlpha = 0.5 + 0.45 * (0.5 + 0.5 * Math.sin(f.t * 5 + r.seed + i * 0.7));
      g.fill(r.leds[i]);
    }
  } else {
    for (let i = 0; i < LEDS; i++) {
      const slot = (i + r.seed) % LEDS;
      let color: string;
      if (slot < f.nA) color = C.amber;
      else if (slot < f.nA + f.nB) color = C.blue;
      else continue;
      // One LED dims at a time so a busy rack still ticks over.
      const blink = (Math.floor(f.t * (2 + (r.seed % 3)) + i + r.seed) % 4) === 0;
      g.globalAlpha = blink ? 0.3 : 0.85;
      g.fillStyle = color;
      g.fill(r.leds[i]);
    }
  }
  g.globalAlpha = 1;
}

/** Walls, back to front: the back walls of the cutaway hall. Style follows the tier. */
export function drawHallWalls(c: Ctx, h: HallLayout): void {
  const { x0, y0, w, d, look } = h;
  const H = look.wallH;
  const L = C.wallLeft;
  const R = C.wallRight;
  const T = C.wallTrim;
  switch (look.style) {
    case 'closet': {
      planeX(c, x0, y0, y0 + d, 0, H, R);
      planeY(c, x0, x0 + w, y0, 0, H, L);
      planeY(c, x0, x0 + w, y0 + 0.02, H - 1.2, H, T);
      planeX(c, x0 + 0.02, y0, y0 + d, H - 1.2, H, T);
      // Door and a vent grille on the back wall.
      planeY(c, x0 + w - 1.1, x0 + w - 0.5, y0 + 0.03, 0, H * 0.7, '#0c0b0a');
      planeY(c, x0 + 0.5, x0 + 1.5, y0 + 0.03, H * 0.62, H * 0.62 + 2.2, '#0c0b0a');
      break;
    }
    case 'cage': {
      // Colo cage: open lattice, so the racks show through.
      const lat = withAlpha(C.fgDim, 0.42);
      for (let z = 0; z <= H; z += 3) {
        line3(c, x0, y0, z, x0, y0 + d, z, lat);
        line3(c, x0, y0, z, x0 + w, y0, z, lat);
      }
      for (let v = y0; v <= y0 + d + 0.01; v += 0.75) line3(c, x0, v, 0, x0, v, H, lat);
      for (let u = x0; u <= x0 + w + 0.01; u += 0.75) line3(c, u, y0, 0, u, y0, H, lat);
      line3(c, x0, y0, H, x0, y0 + d, H, C.fgDim);
      line3(c, x0, y0, H, x0 + w, y0, H, C.fgDim);
      line3(c, x0 + w, y0, 0, x0 + w, y0, H, C.fgDim);
      line3(c, x0, y0 + d, 0, x0, y0 + d, H, C.fgDim);
      break;
    }
    case 'campus': {
      planeX(c, x0, y0, y0 + d, 0, H, R);
      planeY(c, x0, x0 + w, y0, 0, H, L);
      // Window bands, alternating blue and amber.
      for (const z of [H * 0.3, H * 0.62]) {
        for (let u = x0 + 0.4; u < x0 + w - 1.0; u += 1.5) planeY(c, u, u + 0.9, y0 + 0.02, z, z + 2.2, withAlpha(C.blue, 0.55));
        for (let v = y0 + 0.4; v < y0 + d - 1.0; v += 1.5) planeX(c, x0 + 0.02, v, v + 0.9, z, z + 2.2, withAlpha(C.amber, 0.45));
      }
      planeY(c, x0, x0 + w, y0 + 0.02, H - 1.5, H, T);
      planeX(c, x0 + 0.02, y0, y0 + d, H - 1.5, H, T);
      break;
    }
    case 'cathedral': {
      planeX(c, x0, y0, y0 + d, 0, H, R);
      planeY(c, x0, x0 + w, y0, 0, H, L);
      for (let u = x0 + 1; u < x0 + w - 0.4; u += 2) isoBlock(c, u, y0, 0.45, 0.45, 0, H, T);
      for (let v = y0 + 1; v < y0 + d - 0.4; v += 2) isoBlock(c, x0, v, 0.45, 0.45, 0, H, T);
      // Amber crown and a spire on the back corner. Visible from orbit.
      planeY(c, x0, x0 + w, y0 + 0.02, H - 3, H - 1, withAlpha(C.amber, 0.6));
      planeX(c, x0 + 0.02, y0, y0 + d, H - 3, H - 1, withAlpha(C.amber, 0.5));
      isoBlock(c, x0 + 0.1, y0 + 0.1, 0.9, 0.9, H, H + 20, T);
      const [sx, sy] = project(c.p, x0 + 0.55, y0 + 0.55, H + 20);
      glow(c.g, sx, sy, 24 * c.p.scale, C.amber, 0.45);
      break;
    }
  }
}

/** Ground slab under a finished hall, or the dirt pad under one being built. */
export function drawHallFloor(c: Ctx, h: HallLayout): void {
  const top = h.built ? h.look.floor : '#3a2f22';
  isoBlock(c, h.x0 - 0.12, h.y0 - 0.12, h.w + 0.24, h.d + 0.24, -0.6, 0, top, '#1b1a18', '#201e1b');
}

/** Scaffolding for a hall under construction (same look as the office building frame). */
export function drawScaffold(c: Ctx, h: HallLayout): void {
  const { x0, y0, w, d } = h;
  const H = h.look.wallH;
  const pole = '#b45309';
  const post = 0.08;
  isoBlock(c, x0, y0, post, post, 0, H, pole);
  isoBlock(c, x0 + w - post, y0, post, post, 0, H, pole);
  isoBlock(c, x0, y0 + d - post, post, post, 0, H, pole);
  isoBlock(c, x0 + w - post, y0 + d - post, post, post, 0, H, pole);
  for (const z of [H * 0.33, H * 0.66, H]) {
    planeY(c, x0, x0 + w, y0 + d, z, z + 1.2, '#d97706');
    planeX(c, x0 + w, y0, y0 + d, z, z + 1.2, '#b45309');
  }
}

/** Floating cloud rental platform: a slab high above the ground. */
export function drawCloudPlatform(c: Ctx, cl: CloudLayout): void {
  isoBlock(c, cl.x0, cl.y0, cl.w, cl.d, CLOUD_Z - 4, CLOUD_Z, '#2a2824', '#1d1c1a', '#171614');
  planeY(c, cl.x0, cl.x0 + cl.w, cl.y0 + cl.d, CLOUD_Z - 4, CLOUD_Z - 3, C.amberDim);
}

/** Shadow of the floating platform on the ground. */
export function drawCloudShadow(c: Ctx, cl: CloudLayout): void {
  floorTile(c, cl.x0 + 0.4, cl.y0 + 0.4, cl.w - 0.8, cl.d - 0.8, 'rgba(0,0,0,0.5)', 0);
}

/** Pod slab under the training cluster, with an amber front rim. */
export function drawPodSlab(c: Ctx, x0: number, y0: number, w: number, d: number): void {
  isoBlock(c, x0 - 0.15, y0 - 0.15, w + 0.3, d + 0.3, -0.6, 0, '#2a2219', '#1e1812', '#241d15');
  planeY(c, x0 - 0.15, x0 + w + 0.15, y0 + d + 0.15, 0, 0.6, withAlpha(C.amber, 0.6));
}

/** The product side: a block with blinking panels, one per live product (up to 12). */
export function drawProducts(c: Ctx, pr: ProductsLayout, f: Frame): void {
  const { x0, y0, w, d } = pr;
  isoBlock(c, x0, y0, w, d, 0, PRODUCT_H, '#1d1b18', '#151412', '#191714');
  const n = Math.min(12, Math.max(1, pr.live));
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / 3);
    const col = k % 3;
    const z = 4 + row * 4.2;
    const u = x0 + 0.3 + col * 0.95;
    c.g.globalAlpha = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(f.t * 3 + k));
    planeY(c, u, u + 0.7, y0 + d, z, z + 2.4, C.blue);
  }
  c.g.globalAlpha = 1;
}

/** Thin 3D line between two world points. */
export function line3(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string): void {
  const a = project(c.p, x0, y0, z0);
  const b = project(c.p, x1, y1, z1);
  const g = c.g;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.strokeStyle = color;
  g.lineWidth = Math.max(0.5, 1 * c.p.scale);
  g.stroke();
}

/** Where the burst cloud hangs, in world space. */
export function burstCenter(cl: CloudLayout): [number, number, number] {
  return [cl.x0 + cl.w / 2, cl.y0 + cl.d / 2, BURST_Z];
}

/** The dashed burst cloud: four puffs, dashed outlines, drifting dashes. Screen space. */
export function drawBurstCloud(g: CanvasRenderingContext2D, p: Projector, cl: CloudLayout, t: number): void {
  const [wx, wy, wz] = burstCenter(cl);
  const [cx, cy] = project(p, wx, wy, wz);
  const s = p.scale;
  const puffs: [number, number, number][] = [
    [-14, 3, 11],
    [-3, -5, 15],
    [11, -1, 12],
    [3, 6, 10],
  ];
  g.save();
  g.strokeStyle = C.fgDim;
  g.lineWidth = Math.max(1, 1.2 * s);
  g.setLineDash([Math.max(2, 4 * s), Math.max(2, 4 * s)]);
  g.lineDashOffset = -t * 14;
  for (const [ox, oy, r] of puffs) {
    g.beginPath();
    g.arc(cx + ox * s, cy + oy * s, r * s, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/** A dashed flow of data from a to b, arching up. Dots travel along it. */
export function drawFlow(g: CanvasRenderingContext2D, p: Projector, ax: number, ay: number, bx: number, by: number, color: string, t: number, phase: number): void {
  const s = p.scale;
  const cx = (ax + bx) / 2;
  const cy = Math.min(ay, by) - 70 * s;
  g.save();
  g.strokeStyle = color;
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(1, 1.2 * s);
  g.setLineDash([Math.max(2, 4 * s), Math.max(2, 5 * s)]);
  g.lineDashOffset = -t * 18;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo(cx, cy, bx, by);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  g.globalAlpha = 0.95;
  for (let k = 0; k < 3; k++) {
    const u = (t * 0.22 + phase + k / 3) % 1;
    const iu = 1 - u;
    const x = iu * iu * ax + 2 * iu * u * cx + u * u * bx;
    const y = iu * iu * ay + 2 * iu * u * cy + u * u * by;
    g.beginPath();
    g.arc(x, y, Math.max(1.2, 1.8 * s), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Keeps a box of width w centred on x inside the canvas (CSS px). */
function clampCentre(g: CanvasRenderingContext2D, x: number, w: number): number {
  const cw = g.canvas.clientWidth;
  if (!(cw > 0)) return x;
  const lo = 6 + w / 2;
  const hi = cw - 6 - w / 2;
  return hi < lo ? cw / 2 : Math.min(hi, Math.max(lo, x));
}

/** Small text label, centred on x and kept inside the canvas. Used for the rare captions. */
export function drawLabel(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  const w = g.measureText(text).width;
  g.fillStyle = color;
  g.fillText(text, clampCentre(g, x, w), y);
}

/** Terminal-style pill: black box, amber hairline, optional progress rule. Same as the office label. */
export function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, progress?: number, t = 0): void {
  g.save();
  g.font = '600 11px IBM Plex Mono, monospace';
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = 20;
  const px = Math.round(clampCentre(g, x, w) - w / 2);
  const py = Math.max(4, Math.round(y - h));
  g.globalAlpha = 1;
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  if (progress !== undefined) {
    g.fillStyle = C.amber;
    g.fillRect(px + 1, py + h - 3, Math.max(0, (w - 2) * progress), 2);
  }
  g.fillStyle = C.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = 0.85 + 0.15 * Math.sin(t * 3);
  g.fillText(text, px + w / 2, py + h / 2 - 0.5);
  g.restore();
}
