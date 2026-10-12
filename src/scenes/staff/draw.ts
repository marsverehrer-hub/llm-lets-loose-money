// Staff scene drawing: zone props and the few figures the office kit does not have (an empty desk, a slumped
// seated person, the label pill). Everything else comes straight from src/office/draw.
import { project } from '../../office/iso';
import { C, shade } from '../../office/palette';
import { Ctx, floorTile, glow, isoBlock, planeY, poly, withAlpha } from '../../office/draw/prims';
import { DESK_D, DESK_TOP, DESK_W } from '../../office/draw/furniture';

const DESK_LEG_POS: [number, number][] = [
  [0.05, 0.05],
  [DESK_W - 0.13, 0.05],
  [0.05, DESK_D - 0.13],
  [DESK_W - 0.13, DESK_D - 0.13],
];
const SKIN = ['#f1c7a5', '#d9a57c', '#b07a52', '#8d5a3b', '#f6d7bd'];
const HAIR = ['#1a1a1a', '#4b2e1e', '#c7a15a', '#2a2a2a', '#8a6a3a'];
const WALL_TRIM = '#5a2a22';

/** Desk with nobody at it: same legs and top as the office desk, monitor switched off. */
export function drawEmptyDesk(c: Ctx, x: number, y: number): void {
  for (const [lx, ly] of DESK_LEG_POS) isoBlock(c, x + lx, y + ly, 0.08, 0.08, 0, DESK_TOP - 3, C.deskLeg);
  isoBlock(c, x, y, DESK_W, DESK_D, DESK_TOP - 3, DESK_TOP, C.deskTop, C.deskSide, shade(C.deskSide, 0.85));
  isoBlock(c, x + 0.58, y + 0.12, 0.08, 0.08, DESK_TOP, DESK_TOP + 2, C.monitorBezel);
  planeY(c, x + 0.34, x + 0.96, y + 0.1, DESK_TOP + 2, DESK_TOP + 15, C.monitorBezel);
  planeY(c, x + 0.37, x + 0.93, y + 0.1, DESK_TOP + 3.5, DESK_TOP + 13.5, '#0b0a08');
}

/** Safety shield on a wall plane at y, standing at x. */
export function drawShield(c: Ctx, x: number, y: number, fill: string): void {
  const { g, p } = c;
  const at = (px: number, z: number): [number, number] => project(p, px, y, z);
  const outer = [at(x + 0.1, 46), at(x + 0.8, 46), at(x + 0.8, 36), at(x + 0.45, 24), at(x + 0.1, 36)];
  poly(g, outer.flat(), fill);
  const inner = [at(x + 0.2, 42), at(x + 0.7, 42), at(x + 0.7, 36), at(x + 0.45, 29), at(x + 0.2, 36)];
  poly(g, inner.flat(), '#17130a');
}

/** Red-team corner: a red tinted patch of floor with low partitions on its front and right edges. */
export function drawRedTeam(c: Ctx, x: number, y: number, w: number, d: number): void {
  floorTile(c, x, y, w, d, withAlpha(C.red, 0.16));
  isoBlock(c, x, y + d - 0.1, w, 0.1, 0, 10, WALL_TRIM, shade(WALL_TRIM, 0.7), shade(WALL_TRIM, 0.85));
  isoBlock(c, x + w - 0.1, y, 0.1, d, 0, 10, WALL_TRIM, shade(WALL_TRIM, 0.7), shade(WALL_TRIM, 0.85));
}

/** Wall-mounted demo screen with a bar chart that moves. */
export function drawScreen(c: Ctx, x: number, y: number, w: number, seed: number, t: number): void {
  const { g, p } = c;
  planeY(c, x, x + w, y, 24, 48, C.monitorBezel);
  planeY(c, x + 0.05, x + w - 0.05, y, 26, 46, C.monitorScreen);
  const n = 5;
  const inner = w - 0.3;
  const slot = inner / n;
  const bw = slot / 1.6;
  for (let i = 0; i < n; i++) {
    const bx = x + 0.15 + i * slot + (slot - bw) / 2;
    const k = 0.35 + 0.6 * Math.abs(Math.sin(t * (0.8 + i * 0.13) + seed + i * 1.1));
    planeY(c, bx, bx + bw, y + 0.02, 27, 27 + 16 * k, withAlpha(C.green, 0.85));
  }
  const [cx, cy] = project(p, x + w / 2, y, 36);
  glow(g, cx, cy, 30 * p.scale, C.green, 0.07);
}

/** Phone desk for the sales team: a low desk, a handset and a blinking line light. */
export function drawPhoneDesk(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  for (const [lx, ly] of [
    [0.04, 0.04],
    [1.0, 0.04],
    [0.04, 0.6],
    [1.0, 0.6],
  ]) {
    isoBlock(c, x + lx, y + ly, 0.07, 0.07, 0, 10, C.deskLeg);
  }
  isoBlock(c, x, y, 1.1, 0.7, 10, 13, C.deskTop, C.deskSide, shade(C.deskSide, 0.85));
  isoBlock(c, x + 0.2, y + 0.18, 0.22, 0.16, 13, 15, C.headset, shade(C.headset, 0.7), shade(C.headset, 0.85));
  isoBlock(c, x + 0.16, y + 0.4, 0.3, 0.07, 15, 17, C.headset, shade(C.headset, 0.7), shade(C.headset, 0.85));
  const [lx, ly] = project(p, x + 0.75, y + 0.3, 14);
  g.fillStyle = withAlpha(C.green, Math.sin(t * 5) > 0 ? 1 : 0.3);
  g.beginPath();
  g.arc(lx, ly, 1.6 * p.scale, 0, Math.PI * 2);
  g.fill();
}

/** Camera on a tripod with a blinking record light. */
export function drawTripod(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  const top = project(p, x, y, 34);
  g.save();
  g.strokeStyle = '#3a3834';
  g.lineWidth = Math.max(1, 1.2 * p.scale);
  g.beginPath();
  for (const [dx, dy] of [
    [-0.3, -0.1],
    [0.3, -0.1],
    [0, 0.3],
  ]) {
    const [gx, gy] = project(p, x + dx, y + dy, 0);
    g.moveTo(top[0], top[1]);
    g.lineTo(gx, gy);
  }
  g.stroke();
  g.restore();
  isoBlock(c, x - 0.12, y - 0.08, 0.26, 0.2, 32, 38, '#1d1c1a', '#101010', '#151515');
  isoBlock(c, x + 0.14, y - 0.02, 0.1, 0.08, 34, 36, '#2a2a2a');
  const [rx, ry] = project(p, x - 0.08, y - 0.08, 40);
  g.fillStyle = withAlpha(C.red, 0.5 + 0.5 * Math.sin(t * 4));
  g.beginPath();
  g.arc(rx, ry, 1.6 * p.scale, 0, Math.PI * 2);
  g.fill();
}

/** Poster on a wall plane at y: a coloured sheet with simple graphic blocks (no words). */
export function drawPoster(c: Ctx, x: number, y: number, color: string, seed: number): void {
  planeY(c, x, x + 1.0, y, 18, 44, '#15130f');
  planeY(c, x + 0.06, x + 0.94, y + 0.01, 21, 41, color);
  planeY(c, x + 0.16, x + 0.84, y + 0.02, 26, 28, '#0d0c0a');
  planeY(c, x + 0.16, x + (seed % 2 ? 0.66 : 0.5), y + 0.02, 31, 34, '#0d0c0a');
  planeY(c, x + 0.16, x + 0.84, y + 0.02, 36, 38, '#0d0c0a');
}

/** A seated person hunched over the desk, head down and forward. Used when morale is low. */
export function drawSlumped(c: Ctx, x: number, y: number, body: string, seed: number): void {
  const { g, p } = c;
  const [bx, by] = project(p, x, y, 0);
  const s = p.scale;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(bx, by, 4.2 * s, 1.8 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(body, 0.45);
  g.fillRect(bx - 3.2 * s, by - 6 * s, 6.4 * s, 2.6 * s);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(bx - 3.4 * s, by - 6 * s);
  g.lineTo(bx + 3.4 * s, by - 6 * s);
  g.lineTo(bx + 3.0 * s, by - 12 * s);
  g.lineTo(bx - 2.6 * s, by - 12 * s);
  g.closePath();
  g.fill();
  g.strokeStyle = shade(body, 0.8);
  g.lineWidth = 1.6 * s;
  g.beginPath();
  g.moveTo(bx - 2.8 * s, by - 10 * s);
  g.lineTo(bx - 1.2 * s, by - 7 * s);
  g.moveTo(bx + 2.8 * s, by - 10 * s);
  g.lineTo(bx + 1.2 * s, by - 7 * s);
  g.stroke();
  const hx = bx + 1.6 * s;
  const hy = by - 15.5 * s;
  g.fillStyle = HAIR[(seed >> 2) % HAIR.length];
  g.beginPath();
  g.arc(hx, hy - 0.4 * s, 3.8 * s, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = SKIN[seed % SKIN.length];
  g.beginPath();
  g.arc(hx + 0.6 * s, hy + 1.2 * s, 3.0 * s, 0, Math.PI * 2);
  g.fill();
}

/** Small rounded label in the office's terminal style: black box, hairline frame, mono text. */
export function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, size = 11): void {
  g.save();
  g.font = `600 ${size}px IBM Plex Mono, monospace`;
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = Math.round(size * 1.8);
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.globalAlpha = 1;
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
