import { project } from '../iso';
import { C, shade } from '../palette';
import { Ctx, isoBlock, isoBox, planeX, planeY, glow, withAlpha, floorLine } from './prims';

export type Role = 'researcher' | 'engineer' | 'safety' | 'sales' | 'marketing';

// Desk footprint (floor units). The person sits at chairX/chairY facing -y (away from viewer's +y edge).
export const DESK_W = 1.3;
export const DESK_D = 0.7;
export const DESK_TOP = 14;
export const CHAIR_DX = 0.45;
export const CHAIR_DY = 0.95;

/** Draw desk legs, slab, keyboard and monitors. `screenGlow` is 0..1 flicker intensity. */
export function drawDesk(c: Ctx, x: number, y: number, role: Role, dual: boolean, flicker: number, t: number): void {
  const { g, p } = c;
  // legs
  isoBlock(c, x + 0.05, y + 0.05, 0.08, 0.08, 0, DESK_TOP - 3, C.deskLeg);
  isoBlock(c, x + DESK_W - 0.13, y + 0.05, 0.08, 0.08, 0, DESK_TOP - 3, C.deskLeg);
  isoBlock(c, x + 0.05, y + DESK_D - 0.13, 0.08, 0.08, 0, DESK_TOP - 3, C.deskLeg);
  isoBlock(c, x + DESK_W - 0.13, y + DESK_D - 0.13, 0.08, 0.08, 0, DESK_TOP - 3, C.deskLeg);
  // tabletop
  isoBlock(c, x, y, DESK_W, DESK_D, DESK_TOP - 3, DESK_TOP, C.deskTop, C.deskSide, shade(C.deskSide, 0.85));

  // keyboard
  isoBlock(c, x + 0.35, y + 0.42, 0.42, 0.14, DESK_TOP, DESK_TOP + 1, C.keyboard, shade(C.keyboard, 0.8), shade(C.keyboard, 0.9));

  // monitors: screen planes face +y, sit on the back edge of the desk
  const screens = dual ? [[x + 0.12, x + 0.6], [x + 0.66, x + 1.14]] : [[x + 0.34, x + 0.96]];
  const base = dual ? [x + 0.36, x + 0.92] : [x + 0.62];
  for (let i = 0; i < screens.length; i++) {
    const bx = base[i];
    isoBlock(c, bx - 0.04, y + 0.12, 0.08, 0.08, DESK_TOP, DESK_TOP + 2, C.monitorBezel); // stand
    const [sx0, sx1] = screens[i];
    const z0 = DESK_TOP + 2;
    const z1 = DESK_TOP + 15;
    planeY(c, sx0, sx1, y + 0.1, z0, z1, C.monitorBezel);
    const inset = 0.03;
    const pts = planeY(c, sx0 + inset, sx1 - inset, y + 0.1, z0 + 1.5, z1 - 1.5, C.monitorScreen);
    // code lines / glow on screen
    const cx = (pts[0] + pts[2]) / 2;
    const cy = (pts[1] + pts[5]) / 2;
    const w = Math.abs(pts[2] - pts[0]);
    const h = Math.abs(pts[5] - pts[1]);
    const accent = role === 'researcher' ? C.amber : C.blue;
    g.save();
    g.globalAlpha = 0.25 + 0.55 * flicker;
    g.fillStyle = accent;
    for (let k = 0; k < 4; k++) {
      const ly = pts[1] + ((k + 1) / 5) * (pts[5] - pts[1]);
      const lw = w * (0.35 + 0.5 * (((k * 37 + i * 11 + Math.floor(t * 3)) % 7) / 7));
      g.fillRect(pts[0] + w * 0.08, ly - h * 0.05, lw, Math.max(1, h * 0.06));
    }
    g.restore();
    glow(g, cx, cy, Math.max(w, h) * 0.9, accent, 0.08 + 0.12 * flicker);
  }

  // role accessories on the desk top
  if (role === 'safety') {
    // caution sign: little triangle standing on desk, left side
    const [sx, sy] = project(p, x + 0.12, y + 0.3, DESK_TOP);
    const s = 4.5 * p.scale;
    g.beginPath();
    g.moveTo(sx, sy - 9 * p.scale);
    g.lineTo(sx + s, sy);
    g.lineTo(sx - s, sy);
    g.closePath();
    g.fillStyle = C.shield;
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(sx - 0.6 * p.scale, sy - 6 * p.scale, 1.2 * p.scale, 3 * p.scale);
  } else if (role === 'sales') {
    // phone + headset
    isoBlock(c, x + 0.1, y + 0.1, 0.18, 0.12, DESK_TOP, DESK_TOP + 2, C.headset);
    const [hx, hy] = project(p, x + 0.5, y + 0.6, DESK_TOP + 2);
    g.beginPath();
    g.strokeStyle = C.headset;
    g.lineWidth = 2 * p.scale;
    g.arc(hx, hy - 1 * p.scale, 5 * p.scale, Math.PI, 0);
    g.stroke();
    g.fillStyle = C.headset;
    g.fillRect(hx - 6 * p.scale, hy - 1 * p.scale, 2.5 * p.scale, 4 * p.scale);
    g.fillRect(hx + 3.5 * p.scale, hy - 1 * p.scale, 2.5 * p.scale, 4 * p.scale);
  } else if (role === 'marketing') {
    // coffee mug + sticky notes
    isoBlock(c, x + 1.0, y + 0.45, 0.12, 0.12, DESK_TOP, DESK_TOP + 3, C.fg);
    isoBlock(c, x + 0.2, y + 0.5, 0.14, 0.1, DESK_TOP, DESK_TOP + 0.6, C.amberDim);
  } else if (role === 'engineer') {
    // little plant on engineer desk
    isoBlock(c, x + 0.05, y + 0.08, 0.1, 0.1, DESK_TOP, DESK_TOP + 3, C.plantPot);
  }
}

/** Office chair in front of a desk. */
export function drawChair(c: Ctx, cx: number, cy: number): void {
  isoBlock(c, cx, cy, 0.4, 0.4, 5, 9, C.chairSeat, shade(C.chairSeat, 0.7), shade(C.chairSeat, 0.85));
  isoBlock(c, cx + 0.04, cy - 0.06, 0.32, 0.08, 9, 19, C.chairBack, shade(C.chairBack, 0.7), shade(C.chairBack, 0.85));
  isoBlock(c, cx + 0.18, cy + 0.18, 0.05, 0.05, 0, 5, C.deskLeg);
}

/** Whiteboard with scribbled equations, standing against the back wall at y. */
export function drawWhiteboard(c: Ctx, x: number, y: number, w: number, seed: number): void {
  const { g, p } = c;
  isoBlock(c, x, y - 0.06, w, 0.06, 0, 2, C.whiteboardFrame); // tray
  planeY(c, x, x + w, y, 22, 52, C.whiteboardFrame);
  const pts = planeY(c, x + 0.04, x + w - 0.04, y, 24, 50, C.whiteboard);
  const x0 = pts[6];
  const x1 = pts[2];
  const top = pts[1];
  const bot = pts[5];
  g.save();
  g.strokeStyle = C.amber;
  g.lineWidth = 1 * p.scale;
  g.globalAlpha = 0.85;
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const yy = top + ((r + 1) / (rows + 1)) * (bot - top);
    g.beginPath();
    let xx = x0 + 2 * p.scale;
    g.moveTo(xx, yy);
    let k = 0;
    while (xx < x1 - 4 * p.scale) {
      const step = (3 + ((seed * 13 + r * 7 + k * 5) % 6)) * p.scale;
      xx += step;
      g.lineTo(xx, yy + (((seed + k + r) % 3) - 1) * 1.2 * p.scale);
      k++;
    }
    g.stroke();
  }
  // a little "∫" / "E=mc²"-style glyph
  g.fillStyle = C.blue;
  g.font = `${Math.max(6, 7 * p.scale)}px IBM Plex Mono, monospace`;
  g.fillText(seed % 2 ? '∑ θ²' : '∫ e^x', x0 + (x1 - x0) * 0.55, top + (bot - top) * 0.85);
  g.restore();
}

/** Plant in a pot. */
export function drawPlant(c: Ctx, x: number, y: number, size = 1): void {
  const { g, p } = c;
  isoBlock(c, x - 0.12 * size, y - 0.12 * size, 0.24 * size, 0.24 * size, 0, 6 * size, C.plantPot, shade(C.plantPot, 0.7), shade(C.plantPot, 0.85));
  const [px, py] = project(p, x, y, 6 * size);
  const r = 7 * size * p.scale;
  g.fillStyle = C.plant;
  g.beginPath();
  g.arc(px, py - r * 0.9, r, 0, Math.PI * 2);
  g.arc(px - r * 0.8, py - r * 0.2, r * 0.7, 0, Math.PI * 2);
  g.arc(px + r * 0.8, py - r * 0.3, r * 0.75, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(C.plant, 1.3);
  g.beginPath();
  g.arc(px - r * 0.3, py - r * 1.2, r * 0.35, 0, Math.PI * 2);
  g.fill();
}

/** Coffee machine on a little counter, with a red light. */
export function drawCoffee(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  isoBlock(c, x, y, 0.7, 0.45, 0, 10, C.deskSide, shade(C.deskSide, 0.7), shade(C.deskSide, 0.85));
  isoBlock(c, x + 0.1, y + 0.08, 0.5, 0.3, 10, 22, C.coffeeBody, shade(C.coffeeBody, 0.7), shade(C.coffeeBody, 0.85));
  const [lx, ly] = project(p, x + 0.35, y + 0.4, 17);
  const blink = Math.sin(t * 4) > 0 ? 1 : 0.35;
  g.fillStyle = withAlpha(C.coffeeAccent, blink);
  g.beginPath();
  g.arc(lx, ly, 1.8 * p.scale, 0, Math.PI * 2);
  g.fill();
  const [mx, my] = project(p, x + 0.35, y + 0.5, 0);
  g.fillStyle = '#6b3f1f';
  g.fillRect(mx - 1.5 * p.scale, my - 6 * p.scale, 3 * p.scale, 4 * p.scale);
}

/** Server rack: tall block with LED strips. `lit` 0..1 is training intensity; `ledT` drives blinking. */
export function drawRack(c: Ctx, x: number, y: number, lit: number, training: boolean, t: number, seed: number): void {
  const { g, p } = c;
  const H = 34;
  isoBlock(c, x, y, 0.45, 0.45, 0, H, C.rackBody, shade(C.rackBody, 0.75), shade(C.rackBody, 0.9));
  // LED strip on the +y face and +x face
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const z = 3 + r * 5;
    const on = ((Math.floor(t * (3 + (seed % 3))) + r + seed) % 3) !== 0;
    const col = training ? (r % 2 ? C.amber : C.blue) : (on ? C.green : C.amber);
    const alpha = training ? 0.55 + 0.45 * Math.sin(t * 5 + r + seed) : (on ? 0.9 : 0.25);
    planeY(c, x + 0.06, x + 0.39, y + 0.45, z, z + 1.6, withAlpha(col, alpha));
    planeX(c, x + 0.45, y + 0.06, y + 0.39, z, z + 1.2, withAlpha(col, alpha * 0.7));
  }
  if (training && lit > 0) {
    const [cx, cy] = project(p, x + 0.22, y + 0.22, H / 2);
    glow(g, cx, cy, 26 * p.scale, C.amber, 0.25 * lit);
  }
}

/** Cardboard boxes (garage/hot desk clutter). */
export function drawBoxes(c: Ctx, x: number, y: number, n: number): void {
  const cardboard = '#8a6d4f';
  for (let i = 0; i < n; i++) {
    const bx = x + (i % 2) * 0.5;
    const by = y + Math.floor(i / 2) * 0.45;
    const h = 8 + (i % 3) * 4;
    isoBox(c, bx, by, 0.42, 0.4, h, shade(cardboard, 1.1), shade(cardboard, 0.75), shade(cardboard, 0.9));
  }
}

/** The "secret" crate for unreleased models: black with an amber strap and a red stamp. */
export function drawSecretCrate(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  isoBox(c, x, y, 0.55, 0.5, 12, '#1a1a1a', '#0e0e0e', '#121212');
  planeY(c, x + 0.1, x + 0.45, y + 0.5, 4, 8, '#1a1a1a');
  const [sx, sy] = project(p, x + 0.28, y + 0.5, 6);
  g.save();
  g.fillStyle = C.red;
  g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 6);
  g.font = `bold ${Math.max(5, 5.5 * p.scale)}px IBM Plex Mono, monospace`;
  g.textAlign = 'center';
  g.fillText('TOP SECRET', sx, sy);
  g.restore();
  glow(g, sx, sy - 6 * p.scale, 14 * p.scale, C.red, 0.12);
}

/** Folding table + chairs (garage). */
export function drawFoldingTable(c: Ctx, x: number, y: number): void {
  isoBlock(c, x, y, 1.0, 0.6, 12, 14, '#8a8478', '#6e685c', '#7a7468');
  isoBlock(c, x + 0.1, y + 0.1, 0.05, 0.05, 0, 12, C.deskLeg);
  isoBlock(c, x + 0.85, y + 0.45, 0.05, 0.05, 0, 12, C.deskLeg);
}

/** Painted dashed parking spot for the car (garage tier). */
export function drawCarSpot(c: Ctx, x: number, y: number, w: number, d: number): void {
  const col = 'rgba(248,250,252,0.22)';
  floorLine(c, x, y, x + w, y, 0.2, col, 1.2);
  floorLine(c, x + w, y, x + w, y + d, 0.2, col, 1.2);
  floorLine(c, x, y + d, x + w, y + d, 0.2, col, 1.2);
  floorLine(c, x, y, x, y + d, 0.2, col, 1.2);
}

/** Flat signage board on a wall plane facing +y at (x..x+w, y). Static lettering, no glow. */
export function drawNeonSign(c: Ctx, x: number, y: number, w: number, text: string, color: string, _t: number): void {
  const { g, p } = c;
  planeY(c, x, x + w, y, 34, 42, '#0c0c0c');
  const [cx, cy] = project(p, x + w / 2, y, 38);
  g.save();
  g.font = `600 ${Math.max(8, 10 * p.scale)}px IBM Plex Mono, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, cx, cy);
  g.restore();
}

/** Window on a wall plane facing +y, showing a vertical sky gradient. */
export function drawWindow(c: Ctx, x: number, y: number, w: number, skyTop: string, skyBottom: string): void {
  const { g, p } = c;
  planeY(c, x, x + w, y, 18, 40, C.windowFrame);
  const pts = planeY(c, x + 0.05, x + w - 0.05, y, 20, 38, skyTop);
  const grd = g.createLinearGradient(pts[0], pts[1], pts[0], pts[5]);
  grd.addColorStop(0, skyTop);
  grd.addColorStop(1, skyBottom);
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  g.lineTo(pts[2], pts[3]);
  g.lineTo(pts[4], pts[5]);
  g.lineTo(pts[6], pts[7]);
  g.closePath();
  g.fill();
}
