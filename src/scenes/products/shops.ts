// Products scene: storefront drawing. One shopfront per product line on a street, a datacenter hall at the back, and
// empty lots for kinds that are locked or not yet launched. Built from the HQ office kit (src/office) and read-only.
// Each `draw*` call takes a snapshot `Lot` (see scene.ts) plus the frame time; live numbers are read in scene.ts.
import { project } from '../../office/iso';
import { C, shade } from '../../office/palette';
import { drawChair, drawDesk, drawPlant, drawRack } from '../../office/draw/furniture';
import { drawPerson } from '../../office/draw/person';
import { type Ctx, floorLine, floorTile, glow, isoBlock, isoBox, planeY, poly, withAlpha } from '../../office/draw/prims';
import type { ProductKind } from '../../sim/types';

/** Lot footprint and layout on the floor grid. Lots sit in one row behind the street; the datacenter hall is behind them. */
export const LOT_W = 3.6;
export const LOT_D = 3.6;
export const LOT_Y = 5.4;
export const LOT_X0 = 0.6;
export const LOT_PITCH = 4.0;
/** Front edge of the lots (the sidewalk starts here). */
export const FRONT_Y = LOT_Y + LOT_D;
/** Datacenter hall footprint (back wall at DC_Y1, its face is where the serving pipes land). */
export const DC_Y0 = 0.4;
export const DC_Y1 = 3.6;
/** Car lane centre line on the street. */
export const CAR_Y = 9.75;
export const CAR_D = 0.75;
export const KIND_LABEL: Record<ProductKind, string> = { chat: 'Chat', api: 'API', enterprise: 'Enterprise' };
export const SIGN_TEXT: Record<ProductKind, string> = { chat: 'CHAT', api: 'API', enterprise: 'ENTERPRISE' };

export type LotState = 'live' | 'locked' | 'vacant';

/** Everything a lot needs to draw its static shell and figures. Rebuilt only when the signature changes. */
export interface Lot {
  index: number;
  kind: ProductKind;
  /** 0 = first line of the kind, 1 = second line. */
  slot: number;
  x: number;
  y: number;
  state: LotState;
  productId: string | null;
  /** Building height for a live product. */
  H: number;
  /** Chat: people in the queue (0..12). API: server racks (1..3). */
  count: number;
  /** API: developers at the booth (1..3). */
  people: number;
  /** Chat: users per queue figure when the queue is clustered. 0 when the queue is drawn one figure per user. */
  mult: number;
  /** Shutter drop 0 (open) .. 1 (closed). Outages set it to 0.5 or more. */
  drop: number;
  /** API: cable pulse speed. */
  speed: number;
  seed: number;
}

export interface DcSnap {
  hallH: number;
  racks: number;
  label: string;
  training: boolean;
}

type Quad = number[];

const FONT = 'IBM Plex Mono, monospace';

/** Point on a screen quad given as [TL, TR, BR, BL] (from planeY). u runs left to right, v top to bottom. */
function qp(q: Quad, u: number, v: number): [number, number] {
  const tx = q[0] + (q[2] - q[0]) * u;
  const ty = q[1] + (q[3] - q[1]) * u;
  const bx = q[6] + (q[4] - q[6]) * u;
  const by = q[7] + (q[5] - q[7]) * u;
  return [tx + (bx - tx) * v, ty + (by - ty) * v];
}

function qpoly(g: CanvasRenderingContext2D, q: Quad, u0: number, v0: number, u1: number, v1: number, fill: string): void {
  const a = qp(q, u0, v0);
  const b = qp(q, u1, v0);
  const c = qp(q, u1, v1);
  const d = qp(q, u0, v1);
  poly(g, [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], fill);
}

/** Shrink the font until `text` fits `maxW` px. Keeps the office mono face. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, px: number): void {
  let size = Math.max(5, px);
  g.font = `600 ${size}px ${FONT}`;
  while (size > 5 && g.measureText(text).width > maxW) {
    size -= 0.5;
    g.font = `600 ${size}px ${FONT}`;
  }
}

/** Dark sign board on a +y facing plane (the front of a building), with short text centred on it. */
function signPanel(c: Ctx, x0: number, x1: number, fy: number, z0: number, z1: number, text: string, color: string): void {
  const { g, p } = c;
  const q = planeY(c, x0, x1, fy, z0, z1, '#0c0c0c');
  const [cx, cy] = qp(q, 0.5, 0.5);
  g.save();
  const w = Math.abs(q[2] - q[0]);
  fitFont(g, text, w * 0.86, 8.5 * p.scale);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, cx, cy);
  g.restore();
}

/** Roll-down shutter over a front opening. drop 0 is open, 1 is closed. Covers the top `drop` share of the opening. */
function shutter(c: Ctx, x0: number, x1: number, fy: number, zTop: number, drop: number): void {
  if (drop <= 0.001) return;
  const zLow = zTop - zTop * Math.min(1, drop);
  planeY(c, x0, x1, fy, zLow, zTop, '#4a463f');
  const n = Math.floor((zTop - zLow) / 1.6);
  for (let k = 1; k < n; k++) {
    const z = zLow + k * 1.6;
    planeY(c, x0, x1, fy + 0.005, z, z + 0.45, '#2c2a25');
  }
}

/** Small tag on the floor with a dark box, for "x N" counts. Screen space. */
function tag(c: Ctx, x: number, y: number, text: string, color: string): void {
  const { g, p } = c;
  g.save();
  g.font = `600 ${Math.max(7, 9 * p.scale)}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 8;
  const h = Math.max(12, 12 * p.scale);
  g.fillStyle = 'rgba(0,0,0,0.85)';
  g.fillRect(Math.round(x - w / 2), Math.round(y - h), w, h);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y - h / 2);
  g.restore();
}

/** Cable from a terminal to a rack, drooping in screen space, with light pulses running along it. */
function cable(c: Ctx, a: [number, number], b: [number, number], speed: number, t: number, seed: number): void {
  const { g, p } = c;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2 + 26 * p.scale;
  g.save();
  g.strokeStyle = withAlpha(C.fgDim, 0.42);
  g.lineWidth = Math.max(1, 1.1 * p.scale);
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.quadraticCurveTo(mx, my, b[0], b[1]);
  g.stroke();
  g.restore();
  for (let k = 0; k < 2; k++) {
    const u = (t * speed + seed * 0.31 + k * 0.5) % 1;
    const v = 1 - u;
    const px = v * v * a[0] + 2 * v * u * mx + u * u * b[0];
    const py = v * v * a[1] + 2 * v * u * my + u * u * b[1];
    glow(g, px, py, 5 * p.scale, k ? C.blue : C.green, 0.9);
  }
}

/** A person in the queue, with a phone glint at the hand. */
function queuer(c: Ctx, px: number, py: number, seed: number): void {
  const { g, p } = c;
  drawPerson(c, { x: px, y: py, role: 'safety', seed, sitting: false, typing: false, walkPhase: 0, highlight: false, t: 0 });
  const [bx, by] = project(p, px, py, 0);
  const s = p.scale;
  g.fillStyle = '#9fd0ff';
  g.fillRect(bx + 3.2 * s, by - 11 * s, 2.2 * s, 3.4 * s);
}

/* ---------- chat: consumer app store kiosk with a queue ---------- */

function drawChat(c: Ctx, L: Lot, t: number): void {
  const { x, y } = L;
  const W = LOT_W;
  const H = L.H;
  floorTile(c, x, y, W, LOT_D, '#2c2823');
  const bx = x + 0.2;
  const by = y + 0.2;
  const bw = W - 0.4;
  const bd = 1.8;
  const fy = by + bd;
  isoBox(c, bx, by, bw, bd, H, '#37312a', '#1f1c18', '#2a2622');

  // Screen with an app grid. Dims while the shop is shut.
  const scr = planeY(c, bx + 0.3, bx + bw - 0.3, fy + 0.01, 3, H - 2, '#120d07');
  const hues = [C.amber, C.blue, C.green, C.fgDim];
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 4; k++) {
      const u0 = (k + 0.18) / 4;
      const u1 = (k + 0.82) / 4;
      const v0 = (r + 0.2) / 3;
      const v1 = (r + 0.8) / 3;
      const hue = hues[(r * 4 + k + L.seed) % 4];
      const a = L.drop > 0 ? 0.1 : 0.32 + 0.36 * (0.5 + 0.5 * Math.sin(t * 1.7 + r * 1.3 + k * 2.1 + L.seed));
      qpoly(c.g, scr, u0, v0, u1, v1, withAlpha(hue, a));
    }
  }
  shutter(c, bx + 0.25, bx + bw - 0.25, fy + 0.03, H - 1, L.drop);
  signPanel(c, bx, bx + bw, fy + 0.02, H + 1, H + 4.5, SIGN_TEXT.chat, C.amber);

  // Counter and till at the front right corner.
  isoBlock(c, x + W - 1.05, fy, 0.75, 0.42, 0, 6, '#4f4334', '#2e2820', '#3b3328');
  const [tx, ty] = project(c.p, x + W - 0.67, fy + 0.2, 6.6);
  glow(c.g, tx, ty, 6 * c.p.scale, C.amber, 0.35);

  // Queue: up to 6 in the first row, then a second row behind it.
  for (let k = 0; k < L.count; k++) {
    const row = k < 6 ? 0 : 1;
    const i = row ? k - 6 : k;
    const px = x + 0.45 + i * 0.42 + row * 0.2;
    const py = y + 2.95 + row * 0.42;
    queuer(c, px, py, L.seed + k * 3);
  }
  if (L.mult > 0) {
    const [qx, qy] = project(c.p, x + 1.4, y + 3.75, 0);
    tag(c, qx, qy, `×${shortNum(L.mult)}`, C.amber);
  }
}

/* ---------- api: developer terminal booth with cables to racks ---------- */

function drawApi(c: Ctx, L: Lot, t: number): void {
  const { p } = c;
  const { x, y } = L;
  floorTile(c, x, y, LOT_W, LOT_D, '#2a2622');
  const bx = x + 0.2;
  const by = y + 0.2;
  const bw = 1.9;
  const bd = 1.2;
  const H = 16;
  const fy = by + bd;
  isoBox(c, bx, by, bw, bd, H, '#312b25', '#1e1a16', '#29241f');
  planeY(c, bx + 0.25, bx + bw - 0.25, fy + 0.01, 11, 12.2, withAlpha(C.blue, 0.55));
  shutter(c, bx + 0.15, bx + bw - 0.15, fy + 0.03, H - 1, L.drop);
  signPanel(c, bx, bx + bw, fy + 0.02, H + 1, H + 4.5, SIGN_TEXT.api, C.blue);

  // Racks standing behind the booth, to the right.
  for (let k = 0; k < L.count; k++) drawRack(c, x + 2.2 + k * 0.45, y + 0.3, 0, false, t, L.seed + k);

  // Terminal desk and the developer at it.
  const dx = x + 0.3;
  const dy = y + 2.0;
  drawDesk(c, dx, dy, 'engineer', true, 0.55 + 0.45 * Math.sin(t * 3 + L.seed), t);
  const cx = dx + 0.45 + 0.2;
  const cy = dy + 0.95 + 0.2;
  drawChair(c, cx - 0.2, cy - 0.2);
  if (L.people > 0) {
    drawPerson(c, { x: cx, y: cy, role: 'engineer', seed: L.seed, sitting: true, typing: true, walkPhase: 0, highlight: false, t });
  }
  for (let k = 1; k < L.people; k++) {
    drawPerson(c, { x: x + 2.25 + (k - 1) * 0.5, y: y + 3.0, role: 'engineer', seed: L.seed + k * 5, sitting: false, typing: false, walkPhase: 0, highlight: false, t });
  }

  // Cables from the terminal to each rack top.
  const from = project(p, dx + 0.9, dy + 0.1, 26);
  for (let k = 0; k < L.count; k++) {
    const to = project(p, x + 2.2 + k * 0.45 + 0.22, y + 0.3 + 0.22, 34);
    cable(c, from, to, L.speed, t, L.seed + k);
  }
}

/* ---------- enterprise: corporate tower with a lobby ---------- */

function drawEnt(c: Ctx, L: Lot, t: number): void {
  const { g, p } = c;
  const { x, y } = L;
  const W = LOT_W;
  const H = L.H;
  floorTile(c, x, y, W, LOT_D, '#2c2823');
  // plaza in front of the lobby
  floorTile(c, x, y + 2.4, W, 1.2, '#38332c');
  const tx0 = x + 0.25;
  const tx1 = x + W - 0.25;
  const fy = y + 2.4;
  isoBox(c, tx0, y + 0.25, tx1 - tx0, fy - (y + 0.25), H, '#2e2d30', '#1b1a1d', '#252427');

  // Lobby band: dark interior with a warm ceiling strip and the door.
  planeY(c, tx0 + 0.15, tx1 - 0.15, fy + 0.01, 0, 9, '#1a1410');
  planeY(c, tx0 + 0.4, tx1 - 0.4, fy + 0.015, 7.6, 8.4, withAlpha(C.amber, 0.45));
  planeY(c, x + 1.35, x + 2.25, fy + 0.02, 0, 7, withAlpha(C.amber, 0.38));
  const [dxp, dyp] = project(p, x + 1.8, fy, 3.5);
  glow(g, dxp, dyp, 13 * p.scale, C.amber, 0.22);
  shutter(c, tx0 + 0.15, tx1 - 0.15, fy + 0.03, 9, L.drop);

  // Office windows, some lit.
  const wStep = (tx1 - tx0 - 0.6) / 3;
  let row = 0;
  for (let z = 11; z + 2.6 < H - 3; z += 3.6) {
    for (let col = 0; col < 3; col++) {
      const wx0 = tx0 + 0.3 + col * wStep + 0.08;
      const wx1 = wx0 + wStep - 0.16;
      const lit = (L.seed + row * 7 + col * 3) % 5 < 3;
      const flick = lit ? 0.3 + 0.08 * Math.sin(t * 0.8 + row + col) : 0;
      planeY(c, wx0, wx1, fy + 0.01, z, z + 2.4, lit ? withAlpha(C.amber, flick) : '#1d1b18');
    }
    row++;
  }
  signPanel(c, tx0, tx1, fy + 0.02, H + 1, H + 4.5, SIGN_TEXT.enterprise, C.amber);

  // Reception desk in the plaza, a plant by the door.
  isoBlock(c, x + 0.5, y + 2.6, 0.8, 0.32, 0, 4.5, '#4f4334', '#2e2820', '#3b3328');
  drawPlant(c, x + 3.1, y + 2.9, 1);
}

/* ---------- locked and vacant lots ---------- */

function dashedEdge(c: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.floor(len / 0.5));
  for (let k = 0; k < n; k += 2) {
    const a = k / n;
    const b = Math.min(1, (k + 1) / n);
    floorLine(c, x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, 0.2, color, 1);
  }
}

function drawEmpty(c: Ctx, L: Lot): void {
  const { x, y } = L;
  const W = LOT_W;
  const D = LOT_D;
  if (L.state === 'locked') {
    floorTile(c, x, y, W, D, '#1a1816');
    const edge = 'rgba(232,228,220,0.16)';
    dashedEdge(c, x, y, x + W, y, edge);
    dashedEdge(c, x + W, y, x + W, y + D, edge);
    dashedEdge(c, x, y + D, x + W, y + D, edge);
    dashedEdge(c, x, y, x, y + D, edge);
    isoBlock(c, x + 0.4, y + 0.45, 0.08, 0.08, 0, 8, '#4a4640');
    isoBlock(c, x + W - 0.48, y + 0.45, 0.08, 0.08, 0, 8, '#4a4640');
    signPanel(c, x + 0.4, x + W - 0.4, y + 0.5, 8, 13, 'COMING SOON', C.fgDim);
  } else {
    floorTile(c, x, y, W, D, '#24201c');
    const edge = withAlpha(C.amberDim, 0.4);
    dashedEdge(c, x, y, x + W, y, edge);
    dashedEdge(c, x + W, y, x + W, y + D, edge);
    dashedEdge(c, x, y + D, x + W, y + D, edge);
    dashedEdge(c, x, y, x, y + D, edge);
    isoBlock(c, x + 0.4, y + 0.45, 0.08, 0.08, 0, 8, '#4a4640');
    isoBlock(c, x + W - 0.48, y + 0.45, 0.08, 0.08, 0, 8, '#4a4640');
    signPanel(c, x + 0.4, x + W - 0.4, y + 0.5, 8, 13, 'FOR LEASE', C.amberDim);
  }
}

/** Draw one lot's static shell and its figures (queue, racks, staff). */
export function drawLot(c: Ctx, L: Lot, t: number): void {
  if (L.state !== 'live') return drawEmpty(c, L);
  if (L.kind === 'chat') drawChat(c, L, t);
  else if (L.kind === 'api') drawApi(c, L, t);
  else drawEnt(c, L, t);
}

/* ---------- street and datacenter ---------- */

/** Slab, sidewalk, road, lane marks and street lamps. */
export function drawStreet(c: Ctx): void {
  const { g, p } = c;
  floorTile(c, -0.8, -0.6, 26.4, 12.6, '#12100d');
  floorTile(c, -0.4, FRONT_Y, 25.6, 0.4, '#2b2722');
  floorTile(c, -0.4, FRONT_Y + 0.4, 25.6, 2.2, '#1b1915');
  for (let x = -0.2; x < 25; x += 1.6) floorLine(c, x, 10.95, x + 0.8, 10.95, 0.05, withAlpha(C.amberDim, 0.35), 1);
  for (const lx of [-0.2, 7.8, 15.8, 23.8]) {
    isoBlock(c, lx, FRONT_Y + 0.1, 0.12, 0.12, 0, 16, '#3a3631', '#2a2722', '#33302b');
    const [sx, sy] = project(p, lx + 0.06, FRONT_Y + 0.16, 16);
    glow(g, sx, sy, 12 * p.scale, C.amber, 0.22);
  }
}

/** The datacenter hall at the back. Its racks grow with GPUs. Serving pipes end on its face. */
export function drawHall(c: Ctx, dc: DcSnap, t: number): void {
  const H = dc.hallH;
  isoBox(c, 0.2, DC_Y0, 24.2, DC_Y1 - DC_Y0, H, '#25221e', '#17150f', '#1d1a16');
  planeY(c, 0.6, 23.8, DC_Y1 + 0.01, H - 6, H - 4.6, withAlpha(C.amber, 0.25));
  signPanel(c, 19.2, 23.6, DC_Y1 + 0.02, H + 1, H + 4.5, dc.label, C.amber);
  const n = dc.racks;
  for (let k = 0; k < n; k++) {
    const rx = n <= 1 ? 12 : 1.0 + k * (22.2 / (n - 1));
    drawRack(c, rx, DC_Y1 + 0.3, dc.training ? 0.6 : 0, dc.training, t, k);
  }
}

/** Short number for "x N" tags: 950K, 1.2M, 12. */
export function shortNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${Math.round(a)}`;
}

/** Mood from satisfaction: happy, mixed or grumpy. */
export function mood(sat: number): 'happy' | 'mixed' | 'grumpy' {
  return sat >= 65 ? 'happy' : sat >= 40 ? 'mixed' : 'grumpy';
}

/** Face disc in screen space: a happy, neutral or grumpy face in a border of the mood colour. */
export function drawFace(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, sat: number): void {
  const m = mood(sat);
  const col = m === 'happy' ? C.green : m === 'mixed' ? C.amber : C.red;
  g.save();
  g.fillStyle = '#0a0a0a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = Math.max(1, r * 0.18);
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.arc(cx - r * 0.35, cy - r * 0.2, r * 0.13, 0, Math.PI * 2);
  g.arc(cx + r * 0.35, cy - r * 0.2, r * 0.13, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = Math.max(1, r * 0.16);
  g.beginPath();
  if (m === 'happy') g.arc(cx, cy + r * 0.05, r * 0.5, Math.PI * 0.15, Math.PI * 0.85);
  else if (m === 'grumpy') g.arc(cx, cy + r * 0.85, r * 0.5, Math.PI * 1.15, Math.PI * 1.85);
  else {
    g.moveTo(cx - r * 0.4, cy + r * 0.4);
    g.lineTo(cx + r * 0.4, cy + r * 0.4);
  }
  g.stroke();
  g.restore();
}

/** Red blinking DOWN board for an outage. Screen space, office pill style. */
export function drawDown(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  g.save();
  g.font = `600 ${11}px ${FONT}`;
  const text = 'DOWN';
  const w = Math.ceil(g.measureText(text).width) + 14;
  const h = 18;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.globalAlpha = 1;
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(C.red, 0.95);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  g.fillStyle = C.red;
  g.globalAlpha = 0.55 + 0.45 * (Math.sin(t * 5) > 0 ? 1 : 0.2);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, px + w / 2, py + h / 2 - 0.5);
  g.restore();
}

/** Body colour for a car, from a small palette of dark hexes. */
export function carColor(seed: number): string {
  const opts = ['#2f3640', '#3a2f2a', '#26302c', '#33363d'];
  return opts[Math.abs(seed) % opts.length];
}

/** A car drawn at centre x `cx` on the car lane. */
export function drawCar(c: Ctx, cx: number, seed: number): void {
  const body = carColor(seed);
  isoBox(c, cx - 0.75, CAR_Y, 1.5, CAR_D, 2.4, body, shade(body, 0.7), shade(body, 0.85));
  isoBlock(c, cx - 0.4, CAR_Y + 0.08, 0.85, CAR_D - 0.16, 2.4, 3.8, '#4a5560', shade('#4a5560', 0.7), shade('#4a5560', 0.85));
}

/** Suit walking on the sidewalk, in front of the lobby. */
export function drawSuit(c: Ctx, x: number, y: number, seed: number, t: number): void {
  drawPerson(c, { x, y, role: 'marketing', seed, sitting: false, typing: false, walkPhase: 2 + t * 9, highlight: false, t });
}

