// Products scene: storefront drawing. Each product line is a storefront pod (its lot, a sidewalk and a stretch of
// street); the datacenter that serves them is a pod of its own. Empty lots show the kinds that are locked or not yet
// launched. Built from the scene kit (src/office/kit) and read-only. Each `draw*` call takes a snapshot `Lot` (see
// scene.ts) plus the frame time; live numbers are read in scene.ts. Coordinates are absolute floor units.
import { project } from '../../office/iso';
import { type Ctx, floorLine, floorTile, glow, isoBlock, planeY, poly } from '../../office/draw/prims';
import { block, chair, desk, plant, rack, room, shadowOn } from '../../office/kit/props';
import { person } from '../../office/kit/person';
import { tag } from '../../office/kit/frame';
import { T, alpha, mix, roleColor, shade } from '../../office/kit/theme';
import type { ProductKind } from '../../sim/types';

/** Lot footprint. A storefront pod is the lot, a sidewalk and the street in front of it. */
export const LOT_W = 3.6;
export const LOT_D = 3.6;
/** Pod size around a lot, and where the lot sits in it. */
export const POD_W = 4.2;
export const POD_D = 6.0;
export const LOT_IN = 0.3;
/** Car lane centre, measured from the lot's back edge. */
export const CAR_DY = 4.07;
export const CAR_D = 0.75;
/** Datacenter pod size. */
export const DC_W = 5.4;
export const DC_D = 4.6;
export const KIND_LABEL: Record<ProductKind, string> = { chat: 'Chat', api: 'API', enterprise: 'Enterprise' };
export const SIGN_TEXT: Record<ProductKind, string> = { chat: 'CHAT', api: 'API', enterprise: 'ENTERPRISE' };

export type LotState = 'live' | 'locked' | 'vacant';

/** Everything a lot needs to draw its static shell and figures. Rebuilt only when the signature changes. */
export interface Lot {
  index: number;
  kind: ProductKind;
  /** 0 = first line of the kind, 1 = second line. */
  slot: number;
  /** Lot back corner (floor units). */
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
  /** Pod back corner. */
  x: number;
  y: number;
  racks: number;
  label: string;
  training: boolean;
}

type Quad = number[];

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

/** Building shell colour: graphite in the dark theme, pale concrete in the light one. */
function shell(): string {
  return T.dark ? mix(T.bg3, T.fg4, 0.45) : mix(T.bg3, T.fg4, 0.25);
}

/** Dark LED sign board on a +y facing plane (the front of a building), with short text on it, slanted to match. */
function signPanel(c: Ctx, x0: number, x1: number, fy: number, z0: number, z1: number, text: string, color: string): void {
  const { g, p } = c;
  const q = planeY(c, x0, x1, fy, z0, z1, '#0d0e10');
  planeY(c, x0, x1, fy + 0.004, z0, z0 + 0.5, color);
  const [cx, cy] = qp(q, 0.5, 0.5);
  g.save();
  const w = Math.abs(q[2] - q[0]);
  let size = Math.max(5, 8.5 * p.scale);
  g.font = `700 ${size}px ${T.figure}`;
  while (size > 5 && g.measureText(text).width > w * 0.86) {
    size -= 0.5;
    g.font = `700 ${size}px ${T.figure}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.translate(cx, cy);
  g.transform(1, (q[3] - q[1]) / Math.max(1, q[2] - q[0]), 0, 1, 0, 0);
  g.fillText(text, 0, 0.5);
  g.restore();
}

/** Roll-down shutter over a front opening. drop 0 is open, 1 is closed. Covers the top `drop` share of the opening. */
function shutter(c: Ctx, x0: number, x1: number, fy: number, zTop: number, drop: number): void {
  if (drop <= 0.001) return;
  const zLow = zTop - zTop * Math.min(1, drop);
  planeY(c, x0, x1, fy, zLow, zTop, T.metal);
  const n = Math.floor((zTop - zLow) / 1.6);
  for (let k = 1; k < n; k++) {
    const z = zLow + k * 1.6;
    planeY(c, x0, x1, fy + 0.005, z, z + 0.45, T.metalDark);
  }
}

/** Cable from a terminal to a rack, drooping in screen space, with light pulses running along it. */
function cable(c: Ctx, a: [number, number], b: [number, number], speed: number, t: number, seed: number): void {
  const { g, p } = c;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2 + 22 * p.scale;
  g.save();
  g.strokeStyle = alpha(T.fg3, 0.6);
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
    g.fillStyle = k ? roleColor('engineer') : T.up;
    g.fillRect(px - 1.5 * p.scale, py - 1.5 * p.scale, 3 * p.scale, 3 * p.scale);
  }
}

/** A person in the queue, looking at their phone. */
function queuer(c: Ctx, px: number, py: number, seed: number, t: number): void {
  const { g, p } = c;
  const shirts = [T.fg2, roleColor('engineer'), roleColor('marketing'), roleColor('sales'), T.warn];
  person(c, { x: px, y: py, role: '', shirt: shirts[seed % shirts.length], seed, back: true, t });
  const [bx, by] = project(p, px, py, 0);
  const s = p.scale;
  g.fillStyle = alpha('#9fd0ff', 0.9);
  g.fillRect(bx + 3.2 * s, by - 12 * s, 2 * s, 3 * s);
}

/* ---------- chat: consumer app store kiosk with a queue ---------- */

function drawChat(c: Ctx, L: Lot, t: number): void {
  const { x, y } = L;
  const W = LOT_W;
  const H = L.H;
  const bx = x + 0.2;
  const by = y + 0.2;
  const bw = W - 0.4;
  const bd = 1.8;
  const fy = by + bd;
  shadowOn(c, bx, by, bw, bd);
  block(c, bx, by, bw, bd, 0, H, shell());

  // Screen with an app grid. Dims while the shop is shut.
  const scr = planeY(c, bx + 0.3, bx + bw - 0.3, fy + 0.01, 3, H - 2, T.screen);
  const hues = [T.hl, roleColor('engineer'), T.up, T.fg2];
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 4; k++) {
      const hue = hues[(r * 4 + k + L.seed) % 4];
      const a = L.drop > 0 ? 0.12 : 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.7 + r * 1.3 + k * 2.1 + L.seed));
      qpoly(c.g, scr, (k + 0.18) / 4, (r + 0.2) / 3, (k + 0.82) / 4, (r + 0.8) / 3, alpha(hue, a));
    }
  }
  shutter(c, bx + 0.25, bx + bw - 0.25, fy + 0.03, H - 1, L.drop);
  signPanel(c, bx, bx + bw, fy + 0.02, H + 1, H + 4.5, SIGN_TEXT.chat, T.hl);

  // Counter and till at the front right corner.
  block(c, x + W - 1.05, fy, 0.75, 0.42, 0, 6, T.desk);
  const [tx, ty] = project(c.p, x + W - 0.67, fy + 0.2, 6.6);
  glow(c.g, tx, ty, 6 * c.p.scale, T.hl, 0.35);

  // Queue: up to 6 in the first row, then a second row behind it.
  for (let k = 0; k < L.count; k++) {
    const row = k < 6 ? 0 : 1;
    const i = row ? k - 6 : k;
    queuer(c, x + 0.45 + i * 0.42 + row * 0.2, y + 2.95 + row * 0.42, L.seed + k * 3, t);
  }
  if (L.mult > 0) {
    const [qx, qy] = project(c.p, x + 1.5, y + 3.0, 30);
    tag(c.g, qx, qy, `×${shortNum(L.mult)}`, T.hl, { size: 10 });
  }
}

/* ---------- api: developer terminal booth with cables to racks ---------- */

function drawApi(c: Ctx, L: Lot, t: number): void {
  const { p } = c;
  const { x, y } = L;
  const bx = x + 0.2;
  const by = y + 0.2;
  const bw = 1.9;
  const bd = 1.2;
  const H = 16;
  const fy = by + bd;
  const blue = roleColor('engineer');
  shadowOn(c, bx, by, bw, bd);
  block(c, bx, by, bw, bd, 0, H, shell());
  planeY(c, bx + 0.25, bx + bw - 0.25, fy + 0.01, 11, 12.2, alpha(blue, 0.8));
  shutter(c, bx + 0.15, bx + bw - 0.15, fy + 0.03, H - 1, L.drop);
  signPanel(c, bx, bx + bw, fy + 0.02, H + 1, H + 4.5, SIGN_TEXT.api, blue);

  // Racks standing behind the booth, to the right.
  for (let k = 0; k < L.count; k++) rack(c, x + 2.2 + k * 0.45, y + 0.3, 0, false, t, L.seed + k);

  // Terminal desk and the developer at it.
  const dx = x + 0.3;
  const dy = y + 2.0;
  desk(c, dx, dy, 'engineer', true, 0.55 + 0.45 * Math.sin(t * 3 + L.seed), t);
  const cx = dx + 0.65;
  const cy = dy + 1.15;
  chair(c, cx - 0.2, cy - 0.2);
  if (L.people > 0) person(c, { x: cx, y: cy, role: 'engineer', seed: L.seed, sitting: true, typing: true, back: true, t });
  for (let k = 1; k < L.people; k++) {
    person(c, { x: x + 2.25 + (k - 1) * 0.5, y: y + 3.0, role: 'engineer', seed: L.seed + k * 5, t });
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
  // plaza in front of the lobby
  floorTile(c, x, y + 2.4, W, 1.2, mix(T.floor, T.metal, 0.12));
  const tx0 = x + 0.25;
  const tx1 = x + W - 0.25;
  const fy = y + 2.4;
  const glassTone = T.dark ? mix(T.bg3, '#5a7390', 0.35) : mix(T.bg3, '#8aa4c0', 0.45);
  shadowOn(c, tx0, y + 0.25, tx1 - tx0, fy - (y + 0.25));
  block(c, tx0, y + 0.25, tx1 - tx0, fy - (y + 0.25), 0, H, glassTone);

  // Lobby band: interior with a warm ceiling strip and the door.
  planeY(c, tx0 + 0.15, tx1 - 0.15, fy + 0.01, 0, 9, T.dark ? '#16181c' : '#3a3e46');
  planeY(c, tx0 + 0.4, tx1 - 0.4, fy + 0.015, 7.6, 8.4, alpha(T.lamp, 0.7));
  planeY(c, x + 1.35, x + 2.25, fy + 0.02, 0, 7, alpha(T.lamp, 0.45));
  const [dxp, dyp] = project(p, x + 1.8, fy, 3.5);
  glow(g, dxp, dyp, 13 * p.scale, T.lamp, 0.2);
  shutter(c, tx0 + 0.15, tx1 - 0.15, fy + 0.03, 9, L.drop);

  // Office windows, some lit; mullions on the side face.
  const wStep = (tx1 - tx0 - 0.6) / 3;
  let row = 0;
  for (let z = 11; z + 2.6 < H - 3; z += 3.6) {
    for (let col = 0; col < 3; col++) {
      const wx0 = tx0 + 0.3 + col * wStep + 0.08;
      const wx1 = wx0 + wStep - 0.16;
      const lit = (L.seed + row * 7 + col * 3) % 5 < 3;
      const flick = lit ? 0.55 + 0.1 * Math.sin(t * 0.8 + row + col) : 0;
      planeY(c, wx0, wx1, fy + 0.01, z, z + 2.4, lit ? alpha(T.lamp, flick) : shade(glassTone, 0.7));
    }
    row++;
  }
  signPanel(c, tx0, tx1, fy + 0.02, H + 1, H + 4.5, SIGN_TEXT.enterprise, T.fg);

  // Reception desk in the plaza, a plant by the door.
  block(c, x + 0.5, y + 2.6, 0.8, 0.32, 0, 4.5, T.desk);
  plant(c, x + 3.1, y + 2.9, 1, L.seed);
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
  const locked = L.state === 'locked';
  floorTile(c, x, y, W, D, locked ? T.slab : mix(T.floor, T.floorAlt, 0.5));
  const edge = locked ? alpha(T.fg3, 0.5) : alpha(T.hl, 0.6);
  dashedEdge(c, x, y, x + W, y, edge);
  dashedEdge(c, x + W, y, x + W, y + D, edge);
  dashedEdge(c, x, y + D, x + W, y + D, edge);
  dashedEdge(c, x, y, x, y + D, edge);
  isoBlock(c, x + 0.4, y + 0.45, 0.08, 0.08, 0, 8, T.metalDark);
  isoBlock(c, x + W - 0.48, y + 0.45, 0.08, 0.08, 0, 8, T.metalDark);
  signPanel(c, x + 0.4, x + W - 0.4, y + 0.5, 8, 13, locked ? 'COMING SOON' : 'FOR LEASE', locked ? T.fg3 : T.hl);
}

/** Draw one lot's static shell and its figures (queue, racks, staff). */
export function drawLot(c: Ctx, L: Lot, t: number): void {
  if (L.state !== 'live') return drawEmpty(c, L);
  if (L.kind === 'chat') drawChat(c, L, t);
  else if (L.kind === 'api') drawApi(c, L, t);
  else drawEnt(c, L, t);
}

/* ---------- street and datacenter ---------- */

/** A lot's own ground: slab, lot paving, sidewalk, its stretch of road with lane marks, and a street lamp. */
export function drawStreet(c: Ctx, L: Lot): void {
  const { g, p } = c;
  const x0 = L.x - LOT_IN;
  const y0 = L.y - LOT_IN;
  const front = L.y + LOT_D;
  isoBlock(c, x0, y0, POD_W, POD_D, -3, 0, T.floorAlt, shade(T.slab, 0.9), T.slab);
  floorTile(c, L.x, L.y, LOT_W, LOT_D, T.floor);
  floorTile(c, x0, front, POD_W, 0.4, mix(T.floor, T.metal, 0.18));
  floorTile(c, x0, front + 0.4, POD_W, 1.6, T.dark ? '#141518' : '#c4c7cd');
  const lane = front + 1.2;
  for (let x = x0 + 0.2; x < x0 + POD_W - 0.4; x += 1.4) floorLine(c, x, lane, x + 0.7, lane, 0.05, alpha(T.hl, 0.55), 1);
  isoBlock(c, x0 + 0.1, front + 0.1, 0.1, 0.1, 0, 18, T.metalDark);
  isoBlock(c, x0 + 0.1, front + 0.1, 0.5, 0.1, 18, 19, T.metalDark);
  const [sx, sy] = project(p, x0 + 0.5, front + 0.15, 17.5);
  g.fillStyle = T.lamp;
  g.fillRect(sx - 1.5 * p.scale, sy - 0.8 * p.scale, 3 * p.scale, 1.6 * p.scale);
  glow(g, sx, sy, 12 * p.scale, T.lamp, T.dark ? 0.18 : 0.08);
}

/** The datacenter pod: a server room whose racks grow with GPUs. Serving pipes end at its intake. */
export function drawHall(c: Ctx, dc: DcSnap, t: number): void {
  room(c, dc.x, dc.y, DC_W, DC_D, { wallH: 40, floor: T.dark ? '#1a1c20' : '#d3d6db', floorAlt: T.dark ? '#16181b' : '#cbcfd5', cell: 0.5 });
  const n = dc.racks;
  const cols = Math.min(6, Math.max(2, Math.ceil(n / 3)));
  for (let k = 0; k < n; k++) {
    const rx = dc.x + 0.5 + (k % cols) * 0.78;
    const ry = dc.y + 0.4 + Math.floor(k / cols) * 1.1;
    rack(c, rx, ry, dc.training ? 0.6 : 0, dc.training, t, k, 36);
  }
}

/** Intake point of the datacenter (floor units, z): where the serving pipes land. */
export function dcIntake(dc: DcSnap): [number, number, number] {
  return [dc.x, dc.y + DC_D * 0.5, 40];
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
  const col = m === 'happy' ? T.up : m === 'mixed' ? T.warn : T.down;
  g.save();
  g.fillStyle = T.bg1;
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

/** Blinking DOWN tag over a product in an outage. */
export function drawDown(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  tag(g, x, y, 'Down', T.down, { solid: true, ink: '#ffffff', alpha: Math.sin(t * 5) > 0 ? 1 : 0.55 });
}

const CAR_COLORS = ['#3a4250', '#6a2f33', '#2f4a3d', '#4a4d55'];

/** A car at centre x `cx` on a lot's lane. */
export function drawCar(c: Ctx, cx: number, laneY: number, seed: number): void {
  const body = CAR_COLORS[Math.abs(seed) % CAR_COLORS.length];
  shadowOn(c, cx - 0.75, laneY, 1.5, CAR_D);
  block(c, cx - 0.75, laneY, 1.5, CAR_D, 0.8, 3.2, body, false);
  block(c, cx - 0.4, laneY + 0.08, 0.85, CAR_D - 0.16, 3.2, 4.8, mix(body, '#0b0c0e', 0.3), false);
  planeY(c, cx - 0.35, cx + 0.4, laneY + CAR_D - 0.08, 3.3, 4.6, T.glass);
}

/** Suit walking on the sidewalk, in front of the lobby. */
export function drawSuit(c: Ctx, x: number, y: number, seed: number, t: number): void {
  person(c, { x, y, role: '', shirt: T.dark ? '#2d3340' : '#3a4250', seed, walk: 2 + t * 9, back: true, t });
}
