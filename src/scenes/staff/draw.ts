// Staff scene drawing: the department props the scene kit does not have (red-team corner, demo screen, phone desk,
// tripod, posters, the safety shield). Wall-mounted props stay under the room's wall height (ROOM_WALL in layout.ts).
// Colours come from the live theme (src/office/kit/theme.ts).
import { project } from '../../office/iso';
import { Ctx, floorTile, glow, isoBlock, planeY, poly } from '../../office/draw/prims';
import { block, desk } from '../../office/kit/props';
import { T, alpha, mix } from '../../office/kit/theme';

/** Desk with nobody at it: monitor switched off. */
export function drawEmptyDesk(c: Ctx, x: number, y: number): void {
  desk(c, x, y, '', false, 0, 0);
}

/** Safety shield on the back wall at y, standing at x. */
export function drawShield(c: Ctx, x: number, y: number, fill: string): void {
  const { g, p } = c;
  const at = (px: number, z: number): [number, number] => project(p, px, y + 0.02, z);
  const outer = [at(x + 0.1, 27), at(x + 0.8, 27), at(x + 0.8, 18), at(x + 0.45, 7), at(x + 0.1, 18)];
  poly(g, outer.flat(), fill);
  const inner = [at(x + 0.2, 24), at(x + 0.7, 24), at(x + 0.7, 18), at(x + 0.45, 11), at(x + 0.2, 18)];
  poly(g, inner.flat(), T.bg1);
}

/** Red-team corner: a red tinted patch of floor with low partitions on its front and right edges. */
export function drawRedTeam(c: Ctx, x: number, y: number, w: number, d: number): void {
  floorTile(c, x, y, w, d, alpha(T.down, 0.16));
  const wall = mix(T.down, T.bg3, 0.45);
  block(c, x, y + d - 0.1, w, 0.1, 0, 10, wall, false);
  block(c, x + w - 0.1, y, 0.1, d, 0, 10, wall, false);
}

/** Wall-mounted demo screen with a bar chart that moves. */
export function drawScreen(c: Ctx, x: number, y: number, w: number, seed: number, t: number): void {
  const { g, p } = c;
  planeY(c, x, x + w, y, 9, 28, '#16181c');
  planeY(c, x + 0.05, x + w - 0.05, y + 0.005, 10.5, 26.5, T.screen);
  const n = 5;
  const inner = w - 0.3;
  const slot = inner / n;
  const bw = slot / 1.6;
  for (let i = 0; i < n; i++) {
    const bx = x + 0.15 + i * slot + (slot - bw) / 2;
    const k = 0.35 + 0.6 * Math.abs(Math.sin(t * (0.8 + i * 0.13) + seed + i * 1.1));
    planeY(c, bx, bx + bw, y + 0.02, 11.5, 11.5 + 13 * k, alpha(T.up, 0.9));
  }
  if (p.scale > 0.45) {
    const [cx, cy] = project(p, x + w / 2, y, 18);
    glow(g, cx, cy, 26 * p.scale, T.up, 0.06);
  }
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
    isoBlock(c, x + lx, y + ly, 0.07, 0.07, 0, 10, T.metalDark);
  }
  block(c, x, y, 1.1, 0.7, 10, 12, T.desk);
  block(c, x + 0.2, y + 0.18, 0.22, 0.16, 12, 14, T.metalDark, false);
  block(c, x + 0.16, y + 0.4, 0.3, 0.07, 14, 16, T.metalDark, false);
  const [lx, ly] = project(p, x + 0.75, y + 0.3, 13);
  g.fillStyle = alpha(T.up, Math.sin(t * 5) > 0 ? 1 : 0.3);
  g.beginPath();
  g.arc(lx, ly, 1.6 * p.scale, 0, Math.PI * 2);
  g.fill();
}

/** Camera on a tripod with a blinking record light. */
export function drawTripod(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  const top = project(p, x, y, 30);
  g.save();
  g.strokeStyle = T.metalDark;
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
  block(c, x - 0.12, y - 0.08, 0.26, 0.2, 28, 34, '#1d1e22', false);
  isoBlock(c, x + 0.14, y - 0.02, 0.1, 0.08, 30, 32, T.metal);
  const [rx, ry] = project(p, x - 0.08, y - 0.08, 36);
  g.fillStyle = alpha(T.down, 0.5 + 0.5 * Math.sin(t * 4));
  g.beginPath();
  g.arc(rx, ry, 1.6 * p.scale, 0, Math.PI * 2);
  g.fill();
}

/** Poster on the back wall at y: a coloured sheet with simple graphic blocks (no words). */
export function drawPoster(c: Ctx, x: number, y: number, seed: number): void {
  const color = [T.hl, T.sota, T.up, T.down][seed % 4];
  const ink = T.bg1;
  planeY(c, x, x + 1.0, y, 6, 28, ink);
  planeY(c, x + 0.06, x + 0.94, y + 0.01, 8, 26, color);
  planeY(c, x + 0.16, x + 0.84, y + 0.02, 12, 13.6, ink);
  planeY(c, x + 0.16, x + (seed % 2 ? 0.66 : 0.5), y + 0.02, 16, 18.4, ink);
  planeY(c, x + 0.16, x + 0.84, y + 0.02, 21, 22.6, ink);
}
