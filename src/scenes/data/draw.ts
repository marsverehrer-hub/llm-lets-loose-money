// Drawing for the data warehouse: shelving aisles, crates, the crawler and refinery, belts, the training door, and
// the workers and forklift that move data. Statics are built once per layout signature; movers are rebuilt per frame.
import type { GameState } from '../../sim/types';
import { project, type Projector } from '../../office/iso';
import { C } from '../../office/palette';
import { drawPerson } from '../../office/draw/person';
import { Ctx, floorTile, glow, isoBlock, planeX, planeY, withAlpha } from '../../office/draw/prims';
import {
  BOARD_Z,
  CRATE_D,
  CRATE_H,
  CRATE_W,
  CRAWLER_BOX,
  DOMAIN_NAME,
  LANE_FORK,
  MIN_X,
  RACK_D,
  RACK_LEN,
  RACK_TOP,
  REFINE_LANE_X,
  REFINERY_BOX,
  TRIP_S,
  WORKER_MAX,
  alongPath,
  pathLength,
  type AisleView,
  type CrawlerView,
  type Layout,
  type P,
} from './layout';

export interface Item {
  d: number;
  fn: (c: Ctx, t: number) => void;
}

const METAL = '#3a3834';
const METAL_SIDE = '#2a2826';
const METAL_RIGHT = '#33312d';
const STEEL_DARK = '#1a1816';
const UPRIGHT = '#4a4640';
const PALLET = '#6b5636';
const BELT_TOP = '#26241f';
const BELT_RAIL = '#5a5650';
const CARD = '#8a7050';
const CARD_STREAM = '#6f8497';
const PIPE_Y = 1.35;
const PIPE_Z = 12;
const PIPE_END = CRAWLER_BOX.x0 - 0.15;

/** Pill in screen space, same look as the office labels. */
export function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, alpha = 1): void {
  g.save();
  g.font = '600 11px IBM Plex Mono, monospace';
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = 20;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.globalAlpha = alpha;
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  g.fillStyle = C.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, px + w / 2, py + h / 2 - 0.5);
  g.restore();
}

/** Scale a hex colour (#rrggbb) and return hex, so isoBlock can derive its side faces. */
function hexScale(hex: string, f: number): string {
  const p = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${ch((p >> 16) & 255)}${ch((p >> 8) & 255)}${ch(p & 255)}`;
}

/** One crate: flat-shaded iso block with a lighter tape strip, plus the optional warning tag and legal sticker. */
function drawCrate(c: Ctx, x: number, y: number, z0: number, w: number, d: number, h: number, color: string, warn: boolean, legal: boolean): void {
  const { g, p } = c;
  isoBlock(c, x, y, w, d, z0, z0 + h, color);
  isoBlock(c, x + w / 2 - 0.04, y, 0.08, d, z0 + h, z0 + h + 0.4, hexScale(color, 1.35), hexScale(color, 1.0), hexScale(color, 1.15));
  const front = y + d + 0.01;
  if (warn) planeY(c, x + 0.07, x + 0.2, front, z0 + 0.8, z0 + 3.8, C.yellow);
  if (legal) {
    planeY(c, x + 0.24, x + w - 0.06, front, z0 + 4.5, z0 + 8, C.red);
    if (p.scale >= 0.5) {
      const [sx, sy] = project(p, x + (0.24 + w - 0.06) / 2, front, z0 + 6.2);
      g.save();
      g.font = `600 ${Math.max(5, 6 * p.scale)}px IBM Plex Mono, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = C.fg;
      g.fillText('legal', sx, sy);
      g.restore();
    }
  }
}

function drawAisle(c: Ctx, a: AisleView): void {
  const { g, p } = c;
  const { x, y } = a;
  // Back and end panels, then the boards.
  planeY(c, x, x + RACK_LEN, y + 0.02, 0, RACK_TOP, STEEL_DARK);
  planeX(c, x + 0.02, y, y + RACK_D, 0, RACK_TOP, '#1f1d1b');
  for (const bz of BOARD_Z) isoBlock(c, x, y, RACK_LEN, RACK_D, bz - 1.4, bz, METAL, METAL_SIDE, METAL_RIGHT);
  isoBlock(c, x, y + RACK_D - 0.12, 0.12, 0.12, 0, RACK_TOP, UPRIGHT);
  isoBlock(c, x + RACK_LEN - 0.12, y + RACK_D - 0.12, 0.12, 0.12, 0, RACK_TOP, UPRIGHT);
  isoBlock(c, x, y + RACK_D - 0.1, RACK_LEN, 0.1, RACK_TOP - 1.6, RACK_TOP, C.amberDim);

  // Crates in slot order.
  for (const cr of a.crates) drawCrate(c, cr.x, cr.y, cr.z0, CRATE_W, CRATE_D, CRATE_H, cr.color, cr.warn, cr.legal);

  // Past the shelf capacity: a pallet stack at the end, with the real count.
  if (a.overflow > 0) {
    const px = x + RACK_LEN + 0.15;
    const py = y + 0.2;
    isoBlock(c, px, py, 0.9, 1.2, 0, 2, PALLET);
    const stack = Math.min(4, 1 + Math.floor(a.overflow / 20));
    for (let k = 0; k < stack; k++) {
      drawCrate(c, px + 0.08, py + 0.12 + (k % 2) * 0.5, 2 + k * 9, 0.74, 0.5, CRATE_H, C.amberDim, false, false);
    }
    const [lx, ly] = project(p, px + 0.45, py + 0.6, 2 + stack * 9 + 8);
    drawPill(g, lx, ly, `x${a.total}`, C.amber);
  }

  // Domain name at the front-left of the aisle.
  if (p.scale >= 0.45) {
    const [tx, ty] = project(p, x + 0.05, y + RACK_D + 0.3, 0);
    g.save();
    g.font = `600 ${Math.max(7, 8 * p.scale)}px IBM Plex Mono, monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = a.total > 0 ? C.fgDim : C.textDim;
    g.fillText(DOMAIN_NAME[a.domain].toUpperCase(), tx, ty);
    g.restore();
  }
}

function drawCrawler(c: Ctx, cw: CrawlerView): void {
  const { x0, y0, x1, y1 } = CRAWLER_BOX;
  const h = cw.h;
  isoBlock(c, x0, y0, x1 - x0, y1 - y0, 0, h, '#3b3935', '#25231f', '#2d2b27');
  isoBlock(c, x0 + 0.2, y0 + 0.15, 1.2, 0.8, h, h + 7, '#4a4640', '#33302c', '#3d3a35');
  // Intake stub where the pipe enters.
  isoBlock(c, x0 - 0.15, y0 + 0.45, 0.16, 0.4, 8, 14, '#55504a');
  // Status panel on the front face.
  planeY(c, x0 + 0.2, x1 - 0.2, y1 + 0.01, h * 0.35 - 1, h * 0.35 + 6, '#15130f');
}

function drawRefinery(c: Ctx): void {
  const { x0, y0, x1, y1 } = REFINERY_BOX;
  isoBlock(c, x0, y0, x1 - x0, y1 - y0, 0, 22, '#3a3530', '#262220', '#2e2a25');
  isoBlock(c, x0 + 0.35, y0 + 0.25, 0.9, 0.7, 22, 34, '#4a4238', '#362f28', '#423b31');
  isoBlock(c, x1 - 0.6, y0 + 0.2, 0.4, 0.5, 22, 27, '#4f4a43');
  for (const lx of REFINE_LANE_X) isoBlock(c, lx - 0.3, y1 + 0.1, 0.6, 0.45, 0, 4, '#2a2826', '#1d1b19', '#24221f');
}

function drawDock(c: Ctx, x0: number, y0: number, x1: number, n: number): void {
  const pw = (x1 - x0) / 2;
  const pallets = [x0, x0 + pw];
  for (const px of pallets) isoBlock(c, px, y0, pw - 0.05, 0.6, 0, 2, PALLET);
  for (let i = 0; i < n; i++) {
    const px = pallets[i % 2];
    const level = Math.floor(i / 2);
    isoBlock(c, px + 0.08, y0 + 0.1, pw - 0.22, 0.4, 2 + level * 7, 2 + level * 7 + 6.5, CARD);
  }
}

/** Static pieces: shelving, machines and the dock. Sorted by depth. */
export function buildStatics(L: Layout): Item[] {
  const out: Item[] = [];
  for (const a of L.aisles) {
    out.push({ d: a.x + RACK_LEN / 2 + a.y + RACK_D / 2, fn: (c) => drawAisle(c, a) });
  }
  if (L.crawler) {
    const cw = L.crawler;
    out.push({ d: (CRAWLER_BOX.x0 + CRAWLER_BOX.x1 + CRAWLER_BOX.y0 + CRAWLER_BOX.y1) / 2, fn: (c) => drawCrawler(c, cw) });
  }
  out.push({
    d: (REFINERY_BOX.x0 + REFINERY_BOX.x1 + REFINERY_BOX.y0 + REFINERY_BOX.y1) / 2,
    fn: (c) => drawRefinery(c),
  });
  const { dock } = L;
  out.push({
    d: (dock.x0 + dock.x1 + dock.y0 + dock.y1) / 2,
    fn: (c) => drawDock(c, dock.x0, dock.y0, dock.x1, L.dockBoxes),
  });
  out.sort((a, b) => a.d - b.d);
  return out;
}

/** Floor layer: walls are already down; this adds the pipe, belts, and the training door. */
export function drawFloorLayer(c: Ctx, L: Layout, s: GameState): void {
  const { g, p } = c;
  // Pipe from outside into the crawler, on posts.
  if (L.crawler) {
    isoBlock(c, MIN_X + 0.6, PIPE_Y - 0.08, 0.12, 0.14, 0, PIPE_Z, METAL);
    isoBlock(c, -0.9, PIPE_Y - 0.08, 0.12, 0.14, 0, PIPE_Z, METAL);
    const a = project(p, MIN_X, PIPE_Y, PIPE_Z);
    const b = project(p, PIPE_END, PIPE_Y, PIPE_Z);
    g.save();
    g.strokeStyle = '#4a4640';
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5, 2.6 * p.scale);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    g.restore();
  }

  // Belts from outside, one per startup stream.
  for (const b of L.belts) {
    for (let i = 0; i + 1 < b.path.length; i++) {
      const [ax, ay] = b.path[i];
      const [bx, by] = b.path[i + 1];
      const hz = 1.5;
      if (ay === by) {
        const x0 = Math.min(ax, bx);
        const x1 = Math.max(ax, bx);
        floorTile(c, x0, ay - 0.21, x1 - x0, 0.42, BELT_TOP, hz);
        floorTile(c, x0, ay - 0.21, x1 - x0, 0.04, BELT_RAIL, hz + 0.5);
        floorTile(c, x0, ay + 0.17, x1 - x0, 0.04, BELT_RAIL, hz + 0.5);
      } else {
        const y0 = Math.min(ay, by);
        const y1 = Math.max(ay, by);
        floorTile(c, ax - 0.21, y0, 0.42, y1 - y0, BELT_TOP, hz);
        floorTile(c, ax - 0.21, y0, 0.04, y1 - y0, BELT_RAIL, hz + 0.5);
        floorTile(c, ax + 0.17, y0, 0.04, y1 - y0, BELT_RAIL, hz + 0.5);
      }
    }
  }

  // Training door on the back wall.
  const dx = L.doorX;
  planeY(c, dx - 0.8, dx + 0.8, 0.035, 0, 25, C.amberDim);
  planeY(c, dx - 0.7, dx + 0.7, 0.04, 0, 23.5, s.training ? '#2a1d0c' : '#120e09');
}

/** Movers and per-frame items: workers carrying boxes, the forklift, boxes on belts, refinery crates. */
export function buildMovers(L: Layout, s: GameState, t: number): Item[] {
  const out: Item[] = [];

  // Workers carrying boxes in from the dock to the shelves, then walking back empty.
  const nw = Math.min(WORKER_MAX, L.jobs.length);
  for (let k = 0; k < nw; k++) {
    const job = L.jobs[k];
    const u = (t * 0.025 + k * 0.173) % 1;
    const outbound = u < 0.5;
    const v = outbound ? u * 2 : (1 - u) * 2;
    const len = pathLength(job.path);
    const pos = alongPath(job.path, v * len);
    const seed = 3 + k * 7;
    out.push({
      d: pos.x + pos.y,
      fn: (c, tt) => {
        drawPerson(c, {
          x: pos.x,
          y: pos.y,
          role: 'safety',
          seed,
          sitting: false,
          typing: false,
          walkPhase: 1 + tt * 9 + seed,
          highlight: false,
          t: tt,
        });
        if (outbound) isoBlock(c, pos.x + pos.dx * 0.2 - 0.16, pos.y + pos.dy * 0.2 - 0.16, 0.32, 0.32, 9, 16, CARD);
      },
    });
  }

  // Forklift: idle by the wall while no training run is on, otherwise carries crates to the training door.
  let fx = L.W - 1.5;
  let fy = 1.4;
  let fdx = 0;
  let fdy = 1;
  let carry = false;
  if (s.training && L.forkSources.length > 0) {
    const trip = Math.floor(t / TRIP_S) % L.forkSources.length;
    const src = L.forkSources[trip];
    const f = (t % TRIP_S) / TRIP_S;
    const len = pathLength(src.path);
    let pos;
    if (f < 0.42) {
      pos = alongPath(src.path, (f / 0.42) * len);
      carry = true;
    } else if (f < 0.52) {
      pos = alongPath(src.path, len);
    } else {
      pos = alongPath(src.path, (1 - (f - 0.52) / 0.48) * len);
    }
    fx = pos.x;
    fy = pos.y;
    fdx = pos.dx;
    fdy = pos.dy;
  }
  const loaded = carry;
  out.push({
    d: fx + fy,
    fn: (c) => drawForklift(c, fx, fy, fdx, fdy, loaded),
  });

  // Boxes riding the startup stream belts.
  for (const b of L.belts) {
    const len = pathLength(b.path);
    const count = Math.max(1, Math.min(14, Math.round(len / 1.3)));
    for (let k = 0; k < count; k++) {
      const u = (t * 0.22 + k / count) % 1;
      const pos = alongPath(b.path, u * len);
      out.push({
        d: pos.x + pos.y,
        fn: (c) => isoBlock(c, pos.x - 0.2, pos.y - 0.2, 0.4, 0.4, 2, 9, CARD_STREAM),
      });
    }
  }

  // Refinery: a crate feeds each busy line.
  for (let i = 0; i < L.refines.length && i < REFINE_LANE_X.length; i++) {
    const u = (t * 0.2 + i * 0.5) % 1;
    if (u > 0.9) continue;
    const x = REFINE_LANE_X[i];
    const y = LANE_FORK - 0.1 - u * 0.75;
    out.push({
      d: x + y,
      fn: (c) => isoBlock(c, x - 0.2, y - 0.2, 0.4, 0.4, 4, 12, '#b58c4e'),
    });
  }
  return out;
}

function drawForklift(c: Ctx, x: number, y: number, dx: number, dy: number, carry: boolean): void {
  // Body and cab, forks in front along the heading.
  isoBlock(c, x - 0.28, y - 0.22, 0.56, 0.44, 0, 9, C.amberDim);
  isoBlock(c, x - 0.2, y - 0.16, 0.24, 0.32, 9, 16, '#2a2826');
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const fx = x + dx * 0.4;
  const fy = y + dy * 0.4;
  if (horizontal) {
    isoBlock(c, fx - 0.04, fy - 0.2, 0.3, 0.1, 0, 2.5, '#3a3834');
    isoBlock(c, fx - 0.04, fy + 0.1, 0.3, 0.1, 0, 2.5, '#3a3834');
    if (carry) drawCrate(c, fx + 0.04, fy - 0.2, 3, 0.34, 0.4, 8, CARD, false, false);
  } else {
    isoBlock(c, fx - 0.2, fy - 0.04, 0.1, 0.3, 0, 2.5, '#3a3834');
    isoBlock(c, fx + 0.1, fy - 0.04, 0.1, 0.3, 0, 2.5, '#3a3834');
    if (carry) drawCrate(c, fx - 0.2, fy + 0.04, 3, 0.4, 0.34, 8, CARD, false, false);
  }
}

/** Live lights, the pipe flow, refinery sparks and the training glow. Drawn after everything else. */
export function drawOverlay(c: Ctx, L: Layout, s: GameState, t: number): void {
  const { g, p } = c;
  g.save();
  g.globalCompositeOperation = 'lighter';

  // Crawler: pipe flow and status lights.
  if (L.crawler) {
    if (L.crawler.flowing) {
      for (let k = 0; k < 6; k++) {
        const u = (t * 0.5 + k / 6) % 1;
        const x = MIN_X + u * (PIPE_END - MIN_X);
        const [sx, sy] = project(p, x, PIPE_Y, PIPE_Z);
        glow(g, sx, sy, 6 * p.scale, C.amber, 0.35);
      }
    }
    const h = L.crawler.h;
    const color = L.crawler.blocked
      ? C.red
      : L.crawler.building
        ? C.amber
        : L.crawler.flowing
          ? C.green
          : C.textDim;
    const rate = L.crawler.blocked ? 9 : L.crawler.building ? 3 : 2;
    const on = L.crawler.blocked || L.crawler.building || L.crawler.flowing ? 0.5 + 0.5 * Math.sin(t * rate) : 0.3;
    for (const dxl of [0.3, 0.6]) {
      const [sx, sy] = project(p, CRAWLER_BOX.x1 - dxl, CRAWLER_BOX.y1 + 0.02, h * 0.35 + 2.5);
      glow(g, sx, sy, 9 * p.scale, color, 0.45 * on);
    }
  }

  // Refinery: amber while a line is working, with sparks off the tower.
  const refining = L.refines.length > 0;
  for (const dxl of [0.3, 0.6]) {
    const [sx, sy] = project(p, REFINERY_BOX.x0 + dxl, REFINERY_BOX.y1 + 0.02, 16);
    glow(g, sx, sy, 8 * p.scale, refining ? C.amber : C.textDim, refining ? 0.5 + 0.2 * Math.sin(t * 5 + dxl) : 0.15);
  }
  if (refining) {
    for (let k = 0; k < 4; k++) {
      const ph = t * 7 + k * 1.7;
      const sx0 = REFINERY_BOX.x0 + 0.8 + Math.sin(ph) * 0.3;
      const sy0 = REFINERY_BOX.y0 + 0.6 + Math.cos(ph * 0.7) * 0.2;
      const [sx, sy] = project(p, sx0, sy0, 36 + (Math.sin(ph * 1.3) + 1) * 3);
      glow(g, sx, sy, 5 * p.scale, C.amber, 0.5);
    }
  }

  // Training door: glow while a run is on.
  if (s.training) {
    const [dxp, dyp] = project(p, L.doorX, 0.4, 14);
    glow(g, dxp, dyp, 34 * p.scale, C.amber, 0.14 + 0.06 * Math.sin(t * 2));
  }
  g.restore();

  const [lx, ly] = project(p, L.doorX, 0.05, 31);
  drawPill(g, lx, ly, 'training', s.training ? C.amber : C.fgDim);
}

/** Hit-test helper: is (x, y) inside the visible silhouette of a box, given its three visible faces. */
export function boxContains(p: Projector, b: { x0: number; y0: number; x1: number; y1: number; z1: number }, x: number, y: number): boolean {
  const q = (pts: [number, number, number][]) => {
    const out: P[] = [];
    for (const [wx, wy, wz] of pts) out.push(project(p, wx, wy, wz));
    return out;
  };
  const faces = [
    q([[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]]),
    q([[b.x0, b.y1, 0], [b.x1, b.y1, 0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]]),
    q([[b.x1, b.y0, 0], [b.x1, b.y1, 0], [b.x1, b.y1, b.z1], [b.x1, b.y0, b.z1]]),
  ];
  return faces.some((f) => inConvex(f, x, y));
}

function inConvex(poly: P[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cr === 0) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
