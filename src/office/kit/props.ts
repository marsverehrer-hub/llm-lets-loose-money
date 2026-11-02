// Scene kit, props: rooms and furniture in the Pit Wall look (graphite floors, brushed-silver furniture, racing
// yellow only for the team's own highlights). Same floor grid and desk footprint as the original office kit, so
// layouts built for src/office/draw/* work unchanged. Colours come from `T` (theme.ts) at draw time.
import { project } from '../iso';
import { type Ctx, floorTile, glow, isoBlock, planeX, planeY } from '../draw/prims';
import { T, alpha, mix, shade } from './theme';

export const DESK_W = 1.3;
export const DESK_D = 0.7;
export const DESK_TOP = 14;
/** Seat of the chair in front (+y) of a desk at (x, y): where a sitting person is drawn. */
export const SEAT_DX = 0.65;
export const SEAT_DY = 1.15;

/** Box from z0 to z1, lit from the upper left, with a hairline on its top edges for a crisp read. */
export function block(c: Ctx, x: number, y: number, w: number, d: number, z0: number, z1: number, base: string, edge = true): void {
  isoBlock(c, x, y, w, d, z0, z1, base, shade(base, 0.62), shade(base, 0.8));
  if (!edge || c.p.scale < 0.45) return;
  const { g, p } = c;
  const a = project(p, x, y + d, z1);
  const b = project(p, x + w, y + d, z1);
  const e = project(p, x + w, y, z1);
  g.strokeStyle = alpha(shade(base, 1.35), 0.55);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.lineTo(e[0], e[1]);
  g.stroke();
}

/** Soft contact shadow on the floor under a footprint. */
export function shadowOn(c: Ctx, x: number, y: number, w: number, d: number, k = 1): void {
  floorTile(c, x + 0.06, y + 0.1, w + 0.1, d + 0.1, alpha('#000000', (T.dark ? 0.32 : 0.1) * k));
}

/** Floor slab with a visible edge, tiled top. `cell` is the tile size in floor units. */
export function slab(c: Ctx, x: number, y: number, w: number, d: number, top: string, alt: string, cell = 1, thick = 3): void {
  isoBlock(c, x, y, w, d, -thick, 0, top, shade(T.slab, 0.9), T.slab);
  if (top === alt) return;
  const nx = Math.ceil(w / cell);
  const ny = Math.ceil(d / cell);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if ((i + j) % 2 === 0) continue;
      floorTile(c, x + i * cell, y + j * cell, Math.min(cell, w - i * cell), Math.min(cell, d - j * cell), alt);
    }
  }
}

export interface RoomOpts {
  wallH?: number;
  floor?: string;
  floorAlt?: string;
  cell?: number;
  wall?: string;
  /** Window strips on the back wall (x positions, 1.6 wide), with the sky colours. */
  windows?: number[];
  sky?: [string, string];
  /** Racing-yellow pinstripe along the wall base: the team's own rooms. */
  livery?: boolean;
  /** Tint over the floor (department colour). */
  tint?: string;
}

/** A cutaway room: slab, the two back walls with a thickness cap, a skirting line and optional windows. */
export function room(c: Ctx, x: number, y: number, w: number, d: number, o: RoomOpts = {}): void {
  const H = o.wallH ?? 30;
  const t = 0.18;
  slab(c, x, y, w, d, o.floor ?? T.floor, o.floorAlt ?? T.floorAlt, o.cell ?? 1);
  if (o.tint) floorTile(c, x, y, w, d, o.tint);
  const wall = o.wall ?? T.wall;
  // Left wall (along y, inner face toward +x), then the back wall (along x, inner face toward +y).
  isoBlock(c, x - t, y - t, t, d + t, 0, H, T.wallTop, shade(wall, 0.7), shade(wall, 0.92));
  isoBlock(c, x, y - t, w, t, 0, H, T.wallTop, shade(wall, 0.8), shade(wall, 0.7));
  planeX(c, x, y, y + d, 0, 1.6, shade(wall, 0.72));
  planeY(c, x, x + w, y, 0, 1.6, shade(wall, 0.62));
  if (o.livery) {
    planeX(c, x + 0.005, y, y + d, 2.2, 2.9, T.hl);
    planeY(c, x, x + w, y + 0.005, 2.2, 2.9, T.hl);
  }
  if (o.windows && H >= 24) {
    const [top, bot] = o.sky ?? [T.bg3, T.bg2];
    for (const wx of o.windows) {
      if (wx + 1.6 > x + w - 0.2) continue;
      planeY(c, wx, wx + 1.6, y + 0.01, H * 0.36, H * 0.86, shade(wall, 0.55));
      const q = planeY(c, wx + 0.08, wx + 1.52, y + 0.02, H * 0.4, H * 0.82, top);
      const grd = c.g.createLinearGradient(q[0], q[1], q[6], q[7]);
      grd.addColorStop(0, top);
      grd.addColorStop(1, bot);
      c.g.beginPath();
      c.g.moveTo(q[0], q[1]);
      for (let k = 2; k < 8; k += 2) c.g.lineTo(q[k], q[k + 1]);
      c.g.closePath();
      c.g.fillStyle = grd;
      c.g.fill();
      planeY(c, wx + 0.78, wx + 0.82, y + 0.03, H * 0.4, H * 0.82, shade(wall, 0.55));
    }
  }
}

/** Low glass partition along the front (+y) edge of a meeting room, from x0 to x1. */
export function glassFront(c: Ctx, x0: number, x1: number, y: number, h: number): void {
  planeY(c, x0, x1, y, 0, h, T.glass);
  planeY(c, x0, x1, y, h - 0.8, h, alpha(T.metal, 0.7));
  planeY(c, x0, x1, y, 0, 0.8, alpha(T.metal, 0.5));
}

/** Low glass partition along the right (+x) edge, from y0 to y1. */
export function glassSide(c: Ctx, x: number, y0: number, y1: number, h: number): void {
  planeX(c, x, y0, y1, 0, h, T.glass);
  planeX(c, x, y0, y1, h - 0.8, h, alpha(T.metal, 0.7));
}

/** Desk with monitors, keyboard and a few role items. `glowAmt` 0..1 drives the screen; `screen` tints it. */
export function desk(c: Ctx, x: number, y: number, role: string, dual: boolean, glowAmt: number, t: number, screen?: string): void {
  const { g, p } = c;
  const top = T.desk;
  const leg = T.metalDark;
  shadowOn(c, x, y, DESK_W, DESK_D, 0.8);
  isoBlock(c, x + 0.04, y + 0.06, 0.07, DESK_D - 0.12, 0, DESK_TOP - 1.2, leg);
  isoBlock(c, x + DESK_W - 0.11, y + 0.06, 0.07, DESK_D - 0.12, 0, DESK_TOP - 1.2, leg);
  block(c, x, y, DESK_W, DESK_D, DESK_TOP - 1.2, DESK_TOP, top);
  // keyboard and mouse
  isoBlock(c, x + 0.36, y + 0.44, 0.46, 0.13, DESK_TOP, DESK_TOP + 0.7, mix(T.metal, T.bg3, 0.4));
  isoBlock(c, x + 0.92, y + 0.47, 0.08, 0.1, DESK_TOP, DESK_TOP + 0.6, T.metalDark);
  const ink = screen ?? (role === 'researcher' ? T.warn : role === 'engineer' ? '#7fb2ff' : role === 'sales' ? T.up : T.fg2);
  const spans = dual ? [[x + 0.1, x + 0.6], [x + 0.68, x + 1.18]] : [[x + 0.33, x + 0.97]];
  for (let i = 0; i < spans.length; i++) {
    const [a, b] = spans[i];
    const mid = (a + b) / 2;
    isoBlock(c, mid - 0.05, y + 0.14, 0.1, 0.08, DESK_TOP, DESK_TOP + 2.4, T.metalDark);
    block(c, a, y + 0.06, b - a, 0.05, DESK_TOP + 2.4, DESK_TOP + 13.5, '#16181c', false);
    const q = planeY(c, a + 0.03, b - 0.03, y + 0.115, DESK_TOP + 3.3, DESK_TOP + 12.7, T.screen);
    if (glowAmt > 0.02) {
      const w = q[2] - q[0];
      const h = q[5] - q[1];
      g.save();
      g.globalAlpha = 0.35 + 0.55 * glowAmt;
      g.fillStyle = ink;
      const tick = Math.floor(t * 2.5);
      for (let k = 0; k < 4; k++) {
        const ly = q[1] + ((k + 0.8) / 5) * h;
        const lw = w * (0.25 + 0.5 * (((k * 37 + i * 11 + tick) % 7) / 7));
        g.fillRect(q[0] + w * 0.12, ly - h * 0.035 + (q[3] - q[1]) * (0.12 + (0.5 * lw) / w), lw, Math.max(1, h * 0.07));
      }
      g.restore();
      if (p.scale > 0.5) glow(g, (q[0] + q[2]) / 2, (q[1] + q[5]) / 2, Math.max(w, h) * 0.9, ink, 0.05 + 0.08 * glowAmt);
    }
  }
  if (role === 'safety') {
    const [sx, sy] = project(p, x + 0.13, y + 0.32, DESK_TOP);
    const s = 4 * p.scale;
    g.beginPath();
    g.moveTo(sx, sy - 8 * p.scale);
    g.lineTo(sx + s, sy);
    g.lineTo(sx - s, sy);
    g.closePath();
    g.fillStyle = T.hl;
    g.fill();
  } else if (role === 'sales') {
    isoBlock(c, x + 0.08, y + 0.1, 0.2, 0.14, DESK_TOP, DESK_TOP + 1.6, T.metalDark);
  } else if (role === 'marketing') {
    isoBlock(c, x + 1.08, y + 0.44, 0.12, 0.12, DESK_TOP, DESK_TOP + 2.6, T.fg);
    isoBlock(c, x + 0.12, y + 0.48, 0.16, 0.12, DESK_TOP, DESK_TOP + 0.4, T.hl);
  } else if (role === 'engineer') {
    isoBlock(c, x + 1.06, y + 0.45, 0.12, 0.12, DESK_TOP, DESK_TOP + 2.6, T.down);
  } else if (role === 'researcher') {
    isoBlock(c, x + 0.08, y + 0.42, 0.22, 0.18, DESK_TOP, DESK_TOP + 1.4, T.fg2);
  }
}

/** Office chair in front of a desk: graphite shell, silver column. (x, y) is the chair's back corner. */
export function chair(c: Ctx, x: number, y: number): void {
  const seat = T.chair;
  isoBlock(c, x + 0.17, y + 0.17, 0.06, 0.06, 0, 5.5, T.metal);
  isoBlock(c, x + 0.02, y + 0.1, 0.36, 0.06, 0, 0.6, T.metalDark);
  block(c, x, y, 0.4, 0.4, 5.5, 8, seat, false);
  isoBlock(c, x + 0.03, y - 0.04, 0.34, 0.08, 8, 18, seat, shade(seat, 0.7), shade(seat, 0.85));
}

/** Potted plant. `size` 1 is desk height. */
export function plant(c: Ctx, x: number, y: number, size = 1, seed = 0): void {
  const { g, p } = c;
  const s = size;
  shadowOn(c, x - 0.16 * s, y - 0.16 * s, 0.32 * s, 0.32 * s, 0.8);
  block(c, x - 0.15 * s, y - 0.15 * s, 0.3 * s, 0.3 * s, 0, 7 * s, T.pot, false);
  const [px, py] = project(p, x, y, 7 * s);
  const r = 5.2 * s * p.scale;
  const leaf = (dx: number, dy: number, rr: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(px + dx * r, py + dy * r, rr * r * 0.75, rr * r, 0, 0, Math.PI * 2);
    g.fill();
  };
  const tall = seed % 2 === 0;
  leaf(-0.7, -0.8, 0.8, T.plantDark);
  leaf(0.75, -0.9, 0.75, T.plantDark);
  leaf(0, tall ? -2.1 : -1.5, 1.05, T.plant);
  leaf(-0.55, -1.2, 0.8, T.plant);
  leaf(0.6, -1.3, 0.7, shade(T.plant, 1.12));
  leaf(0.15, tall ? -2.6 : -1.9, 0.45, shade(T.plant, 1.3));
}

/** Whiteboard on feet against the wall at y, w wide. Scribbles in marker colours. */
export function whiteboard(c: Ctx, x: number, y: number, w: number, seed: number): void {
  const { g, p } = c;
  isoBlock(c, x + 0.05, y, 0.05, 0.05, 0, 22, T.metal);
  isoBlock(c, x + w - 0.1, y, 0.05, 0.05, 0, 22, T.metal);
  planeY(c, x, x + w, y + 0.06, 20, 46, T.metal);
  const q = planeY(c, x + 0.05, x + w - 0.05, y + 0.07, 21, 45, T.dark ? '#e9ebee' : '#ffffff');
  const x0 = q[6];
  const x1 = q[2];
  const top = q[1];
  const bot = q[5];
  const slope = (q[3] - q[1]) / Math.max(1, q[2] - q[0]);
  g.save();
  g.lineWidth = Math.max(1, 0.9 * p.scale);
  const inks = ['#2f6fdc', '#20232a', '#d0342c'];
  for (let r = 0; r < 3; r++) {
    g.strokeStyle = inks[(seed + r) % 3];
    const yy = top + ((r + 1) / 4.2) * (bot - top);
    g.beginPath();
    let xx = x0 + 3 * p.scale;
    g.moveTo(xx, yy + (xx - x0) * slope);
    let k = 0;
    const end = x0 + (x1 - x0) * (0.55 + 0.35 * (((seed * 7 + r * 3) % 5) / 5));
    while (xx < end) {
      xx += (2.5 + ((seed * 13 + r * 7 + k * 5) % 5)) * p.scale;
      g.lineTo(xx, yy + (xx - x0) * slope + (((seed + k + r) % 3) - 1) * 1.1 * p.scale);
      k++;
    }
    g.stroke();
  }
  g.restore();
}

/** Server rack: graphite cabinet, silver rails, status LEDs. Training lights it up in the team colour. */
export function rack(c: Ctx, x: number, y: number, lit: number, training: boolean, t: number, seed: number, H = 34): void {
  const { g, p } = c;
  shadowOn(c, x, y, 0.45, 0.45);
  block(c, x, y, 0.45, 0.45, 0, H, T.dark ? '#1d1f24' : '#3a3d44');
  planeY(c, x + 0.03, x + 0.07, y + 0.451, 1, H - 1, T.metal);
  planeY(c, x + 0.38, x + 0.42, y + 0.451, 1, H - 1, T.metal);
  const rows = Math.max(3, Math.floor(H / 5.6));
  for (let r = 0; r < rows; r++) {
    const z = 2.5 + r * ((H - 4) / rows);
    planeY(c, x + 0.09, x + 0.36, y + 0.452, z, z + 2.6, T.dark ? '#121418' : '#25282e');
    const on = (Math.floor(t * (2 + (seed % 3))) + r + seed) % 4 !== 0;
    const col = training ? (r % 2 ? T.hl : T.up) : on ? T.up : T.fg4;
    const a = training ? 0.6 + 0.4 * Math.sin(t * 6 + r + seed) : on ? 0.95 : 0.5;
    planeY(c, x + 0.27, x + 0.33, y + 0.455, z + 0.7, z + 1.9, alpha(col, a));
    planeX(c, x + 0.452, y + 0.1, y + 0.36, z + 0.8, z + 1.4, alpha(T.fg4, 0.6));
  }
  if (training && lit > 0 && p.scale > 0.4) {
    const [cx, cy] = project(p, x + 0.22, y + 0.45, H / 2);
    glow(g, cx, cy, 22 * p.scale, T.hl, 0.18 * lit);
  }
}

/** Kitchen counter along the back wall at y: cabinets, worktop, coffee machine and a fridge. */
export function kitchen(c: Ctx, x: number, y: number, w: number, t: number): void {
  const { g, p } = c;
  block(c, x, y, 0.75, 0.7, 0, 30, T.metal);
  planeY(c, x + 0.36, x + 0.39, y + 0.71, 14, 26, T.metalDark);
  block(c, x + 0.8, y, w - 0.8, 0.6, 0, 11, T.dark ? T.bg3 : T.fg4);
  block(c, x + 0.8, y - 0.02, w - 0.8, 0.64, 11, 12.2, T.desk);
  block(c, x + 1.0, y + 0.08, 0.42, 0.34, 12.2, 21, T.dark ? '#2a2c31' : '#4a4e56');
  const [lx, ly] = project(p, x + 1.2, y + 0.42, 18);
  g.fillStyle = Math.sin(t * 3) > 0 ? T.down : alpha(T.down, 0.35);
  g.fillRect(lx - 1, ly - 1, 2, 2);
  for (let k = 0; k < Math.floor((w - 1.6) / 0.35); k++) {
    isoBlock(c, x + 1.6 + k * 0.35, y + 0.2, 0.12, 0.12, 12.2, 14.4, [T.fg, T.hl, T.fg2][k % 3]);
  }
}

/** Meeting table with chairs on both long sides. Footprint x, y, w, d. */
export function meetingTable(c: Ctx, x: number, y: number, w: number, d: number): void {
  const n = Math.max(1, Math.floor(w / 0.75));
  for (let k = 0; k < n; k++) chair(c, x + 0.2 + k * (w / n), y - 0.55);
  shadowOn(c, x, y, w, d);
  isoBlock(c, x + w / 2 - 0.1, y + d / 2 - 0.1, 0.2, 0.2, 0, 12, T.metalDark);
  block(c, x, y, w, d, 12, 13.6, T.dark ? mix(T.wood, T.bg3, 0.2) : T.wood);
}

/** Front-row chairs of a meeting table (drawn after the people sitting at it). */
export function meetingChairsFront(c: Ctx, x: number, y: number, w: number, d: number): void {
  const n = Math.max(1, Math.floor(w / 0.75));
  for (let k = 0; k < n; k++) {
    const cx = x + 0.2 + k * (w / n);
    isoBlock(c, cx + 0.17, y + d + 0.35, 0.06, 0.06, 0, 5.5, T.metal);
    block(c, cx, y + d + 0.2, 0.4, 0.4, 5.5, 8, T.chair, false);
    isoBlock(c, cx + 0.03, y + d + 0.56, 0.34, 0.08, 8, 16, T.chair);
  }
}

/** Two-seat sofa facing +y. */
export function sofa(c: Ctx, x: number, y: number, w: number, col: string): void {
  shadowOn(c, x, y, w, 0.7);
  block(c, x, y, w, 0.7, 0, 5, shade(col, 0.85), false);
  block(c, x, y, w, 0.2, 5, 11, col, false);
  block(c, x, y + 0.2, 0.18, 0.5, 5, 8, col, false);
  block(c, x + w - 0.18, y + 0.2, 0.18, 0.5, 5, 8, col, false);
}

/** Ping-pong table (the loft perk nobody uses). */
export function pingPong(c: Ctx, x: number, y: number): void {
  shadowOn(c, x, y, 1.6, 0.9);
  isoBlock(c, x + 0.2, y + 0.4, 0.1, 0.1, 0, 10, T.metalDark);
  isoBlock(c, x + 1.3, y + 0.4, 0.1, 0.1, 0, 10, T.metalDark);
  block(c, x, y, 1.6, 0.9, 10, 11, T.dark ? '#1f6b4a' : '#2e8a60');
  planeX(c, x + 0.8, y, y + 0.9, 11, 13.2, alpha(T.fg, 0.8));
}

/**
 * Wall sign: a dark plate with a coloured top rule and text in `color`. On the back wall (plane y, from x to x + w)
 * or, with `left`, on the left wall (plane x, from y to y + w).
 */
export function wallSign(c: Ctx, x: number, y: number, w: number, z: number, text: string, color: string, left = false): void {
  const { g, p } = c;
  const plate = T.dark ? '#0d0e10' : '#1c1e22';
  const q = left ? planeX(c, x + 0.03, y, y + w, z, z + 6, plate) : planeY(c, x, x + w, y + 0.03, z, z + 6, plate);
  if (left) planeX(c, x + 0.035, y, y + w, z, z + 0.6, color);
  else planeY(c, x, x + w, y + 0.035, z, z + 0.6, color);
  const [cx, cy] = [(q[0] + q[4]) / 2, (q[1] + q[5]) / 2];
  const fs = Math.max(6, 7.5 * p.scale);
  g.save();
  g.font = `700 ${fs}px ${T.figure}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  // Slope of the plate's top edge, read left to right on screen.
  const ang = q[2] >= q[0] ? Math.atan2(q[3] - q[1], q[2] - q[0]) : Math.atan2(q[1] - q[3], q[0] - q[2]);
  g.translate(cx, cy);
  g.transform(1, Math.tan(ang), 0, 1, 0, 0);
  const maxW = Math.abs(q[2] - q[0]) * 0.9;
  const tw = g.measureText(text).width;
  if (tw > maxW) g.scale(maxW / tw, 1);
  g.fillText(text, 0, 0.5);
  g.restore();
}

/** Stack of cardboard boxes. */
export function boxes(c: Ctx, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const bx = x + (i % 2) * 0.48;
    const by = y + Math.floor(i / 2) * 0.44;
    block(c, bx, by, 0.42, 0.4, 0, 7 + (i % 3) * 3, T.cardboard, false);
  }
}

/** Black crate for an unreleased model, with a red stamp. */
export function secretCrate(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  shadowOn(c, x, y, 0.55, 0.5);
  block(c, x, y, 0.55, 0.5, 0, 11, '#17181b');
  planeY(c, x, x + 0.55, y + 0.505, 5, 6.4, T.hl);
  const [sx, sy] = project(p, x + 0.28, y + 0.5, 8.6);
  g.save();
  g.globalAlpha = 0.65 + 0.35 * Math.sin(t * 5);
  g.fillStyle = T.down;
  g.fillRect(sx - 3 * p.scale, sy - 1.2 * p.scale, 6 * p.scale, 2.4 * p.scale);
  g.restore();
}

/** A parked car facing +x, at (x, y), 1.8 long. */
export function car(c: Ctx, x: number, y: number, col: string): void {
  shadowOn(c, x, y, 1.8, 0.85);
  block(c, x, y, 1.8, 0.85, 1.2, 5.5, col, false);
  block(c, x + 0.4, y + 0.08, 0.95, 0.69, 5.5, 9, mix(col, '#0b0c0e', 0.25), false);
  planeY(c, x + 0.45, x + 1.3, y + 0.77, 5.8, 8.6, T.glass);
  for (const wx of [0.25, 1.3]) isoBlock(c, x + wx, y + 0.78, 0.3, 0.1, 0, 2.4, '#0d0e10');
}

/** Scaffold for a datacenter under construction: yellow-black poles and a progress-free frame. */
export function scaffold(c: Ctx, x: number, y: number, w: number, d: number, H: number): void {
  const pole = T.hl;
  for (const [px, py] of [[0, 0], [w - 0.07, 0], [0, d - 0.07], [w - 0.07, d - 0.07]]) isoBlock(c, x + px, y + py, 0.07, 0.07, 0, H, pole);
  for (let z = 10; z <= H; z += 12) {
    planeY(c, x, x + w, y + d, z, z + 1, shade(pole, 0.8));
    planeX(c, x + w, y, y + d, z, z + 1, shade(pole, 0.65));
  }
  block(c, x + 0.2, y + 0.2, w - 0.4, d - 0.4, 0, 4, T.dark ? T.bg3 : T.fg4, false);
}

/** Tree (outdoor pods). */
export function tree(c: Ctx, x: number, y: number, size = 1): void {
  const { g, p } = c;
  shadowOn(c, x - 0.3 * size, y - 0.3 * size, 0.6 * size, 0.6 * size, 0.9);
  isoBlock(c, x - 0.05, y - 0.05, 0.1, 0.1, 0, 12 * size, T.wood);
  const [px, py] = project(p, x, y, 12 * size);
  const r = 9 * size * p.scale;
  g.fillStyle = T.plantDark;
  g.beginPath();
  g.arc(px, py - r * 0.5, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = T.plant;
  g.beginPath();
  g.arc(px - r * 0.25, py - r * 0.85, r * 0.7, 0, Math.PI * 2);
  g.fill();
}
