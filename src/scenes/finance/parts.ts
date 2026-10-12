// Drawing parts for the treasury room. Each draws in iso space through a Ctx, like the office furniture.
import { floorTile, glow, isoBlock, isoBox, planeX, planeY, poly, withAlpha, type Ctx } from '../../office/draw/prims';
import { project, type Projector } from '../../office/iso';
import { C } from '../../office/palette';
import { drawBoxes, drawChair, drawPlant } from '../../office/draw/furniture';
import { formatMoney } from '../../sim/util';
import type { GameState } from '../../sim/types';
import { BIN, BOARD, BUS, CHAIN_ANCHOR, CRATES, DOOR, PLANTS, SAFE, SLOT, TABLE, VAULT, type Lane, type Pt } from './plan';

export const TREAS = {
  carpetA: '#1f2a24',
  carpetB: '#1b251f',
  vaultFloor: '#17191c',
  steel: '#2c3136',
  steelLight: '#4a5058',
  steelRail: '#60666d',
  wood: '#4f4334',
  woodTop: '#6e5d48',
  gold: '#e0a93f',
  cashA: '#3c9a63',
  cashB: '#2f7f51',
  trim: '#34312c',
  iron: '#aab0b8',
  safeTop: '#4a5058',
  safeLeft: '#2b3036',
  safeRight: '#3a3f46',
  safeDoor: '#5b626a',
  binTop: '#40454c',
  binLeft: '#2a2e33',
  binRight: '#34383e',
  belt: '#121416',
  beltTop: '#2c3339',
  beltDash: '#4b555e',
  screen: '#050805',
  paper: '#e8e4dc',
  hatch: '#101214',
  door: '#0e0f10',
};

const TAU = Math.PI * 2;

/** Gold pallet with `bars` bars, two to a layer, alternating direction. */
export function drawSlot(c: Ctx, x: number, y: number, bars: number): void {
  const S = SLOT.size;
  isoBlock(c, x, y, S, S, 0, 1.2, TREAS.wood);
  let k = 0;
  for (let layer = 0; k < bars; layer++) {
    const z0 = 1.2 + layer * 2;
    const z1 = z0 + 1.8;
    const n = Math.min(2, bars - k);
    k += n;
    for (let b = 0; b < n; b++) {
      const o = 0.02 + b * 0.37;
      if (layer % 2 === 0) isoBlock(c, x + 0.02, y + o, S - 0.04, 0.34, z0, z1, TREAS.gold);
      else isoBlock(c, x + o, y + 0.02, 0.34, S - 0.04, z0, z1, TREAS.gold);
    }
  }
}

/** A cash stack of `layers` bundled layers, banded in two greens. */
export function drawCashStack(c: Ctx, x: number, y: number, layers: number): void {
  for (let l = 0; l < layers; l++) {
    const z0 = l * 2.2;
    isoBlock(c, x, y, 0.55, 0.55, z0, z0 + 2, l % 2 ? TREAS.cashB : TREAS.cashA);
  }
}

/** Vault floor and the room's back-wall panel behind the vault. */
export function drawVaultFloor(c: Ctx): void {
  floorTile(c, VAULT.x0, 0, VAULT.x1 - VAULT.x0, VAULT.y1, TREAS.vaultFloor, 0.05);
}

/** Things drawn before the people: the back panel, the vault's left wall, the door and the revenue hatch. */
export function drawShell(c: Ctx): void {
  planeY(c, VAULT.x0, VAULT.x1, 0.03, 0, VAULT.h, '#262a2e');
  isoBlock(c, VAULT.x0 - 0.2, 0, 0.2, VAULT.y1, 0, VAULT.h, TREAS.steel);
  // front door, left wall
  planeX(c, 0.03, DOOR.y0 - 0.25, DOOR.y1 + 0.25, 0, 26, TREAS.trim);
  planeX(c, 0.05, DOOR.y0, DOOR.y1, 0, 23, TREAS.door);
  // revenue hatch, left wall
  planeX(c, 0.03, 5.4, 7.0, 0, 13, TREAS.trim);
  planeX(c, 0.05, 5.5, 6.9, 0.5, 12.5, TREAS.hatch);
}

/** Vault posts at the open front. */
export function drawPost(c: Ctx, x: number, y: number): void {
  isoBlock(c, x - 0.12, y - 0.12, 0.24, 0.24, 0, VAULT.h + 1, TREAS.steelLight);
}

export function drawRightWall(c: Ctx): void {
  isoBlock(c, VAULT.x1, 0, 0.2, VAULT.y1, 0, VAULT.h, TREAS.steel);
}

/** Closed gate: drawn last, only while cash is negative. */
export function drawGate(c: Ctx): void {
  const { x0, x1, y1, h } = VAULT;
  for (let i = 0; i <= 8; i++) {
    const gx = x0 + ((x1 - x0) * i) / 8;
    isoBlock(c, gx - 0.04, y1 - 0.04, 0.08, 0.08, 0, h, '#7d848b');
  }
  planeY(c, x0, x1, y1 - 0.02, 8, 9.2, TREAS.steelRail);
  planeY(c, x0, x1, y1 - 0.02, 19, 20.2, TREAS.steelRail);
  planeY(c, x0, x1, y1 - 0.02, 28.6, 30, TREAS.steelRail);
}

/** Investors' table: a top on four legs, with a stack of papers in front of each seat. */
export function drawTable(c: Ctx): void {
  const { x, y, w, d, z } = TABLE;
  isoBlock(c, x, y, w, d, z - 1.5, z, TREAS.woodTop);
  const ins = 0.12;
  for (const [lx, ly] of [
    [x + ins, y + ins],
    [x + w - ins - 0.16, y + ins],
    [x + ins, y + d - ins - 0.16],
    [x + w - ins - 0.16, y + d - ins - 0.16],
  ]) {
    isoBlock(c, lx, ly, 0.16, 0.16, 0, z - 1.5, TREAS.wood);
  }
}

/** One seated investor's chair and paper stack. */
export function drawSeat(c: Ctx, seat: Pt): void {
  drawChair(c, seat[0] - 0.2, seat[1] - 0.2);
  const px = Math.min(TABLE.x + TABLE.w - 0.25, Math.max(TABLE.x + 0.25, seat[0]));
  const py = Math.min(TABLE.y + TABLE.d - 0.25, Math.max(TABLE.y + 0.25, seat[1]));
  isoBlock(c, px - 0.12, py - 0.1, 0.24, 0.2, TABLE.z, TABLE.z + 0.7, TREAS.paper);
}

/** Expense chute: a bin at the end of its lane. Its label is placed by the scene, so labels can avoid each other. */
export function drawBin(c: Ctx, lane: Lane): void {
  const y0 = lane.y0 + 0.05;
  const y1 = lane.y1 - 0.05;
  isoBox(c, BIN.x0, y0, BIN.x1 - BIN.x0, y1 - y0, BIN.h, TREAS.binTop, TREAS.binLeft, TREAS.binRight);
}

/** Screen position of a bin's label (on its top), and the label's font size. */
export function binLabelAt(p: Projector, lane: Lane): Pt {
  return project(p, (BIN.x0 + BIN.x1) / 2, lane.yc, BIN.h);
}

/** Crates from the bank, stacked by the vault's cash. */
export function drawCrates(c: Ctx, n: number): void {
  drawBoxes(c, CRATES[0], CRATES[1], n);
}

export function drawPlants(c: Ctx): void {
  PLANTS.forEach(([x, y], i) => drawPlant(c, x, y, 1 + (i % 2) * 0.25));
}

/**
 * The debt safe. A plain steel box with a dial on its visible front. Chained (with a band round it) while debt is
 * outstanding. Open and empty once the debt is clear.
 */
export function drawSafe(c: Ctx, scale: number, debtOn: boolean, chains: number, t: number): void {
  const { g, p } = c;
  const x = SAFE.x;
  const y = SAFE.y;
  const w = SAFE.w * scale;
  const d = SAFE.d * scale;
  const h = SAFE.h * scale;
  isoBox(c, x, y, w, d, h, TREAS.safeTop, TREAS.safeLeft, TREAS.safeRight);
  if (debtOn) {
    // front door and dial
    planeY(c, x + w * 0.12, x + w * 0.88, y + d + 0.01, h * 0.15, h * 0.85, TREAS.safeDoor);
    const [dx, dy] = project(p, x + w * 0.5, y + d + 0.02, h * 0.5);
    g.beginPath();
    g.arc(dx, dy, 3.2 * p.scale, 0, TAU);
    g.fillStyle = '#20242a';
    g.fill();
    g.strokeStyle = TREAS.iron;
    g.lineWidth = 1 * p.scale;
    g.stroke();
    // steel band that the chains wrap
    planeY(c, x, x + w, y + d + 0.03, h * 0.5, h * 0.5 + 1.6, TREAS.iron);
    planeX(c, x + w + 0.03, y, y + d, h * 0.5, h * 0.5 + 1.6, TREAS.safeRight);
    // chains from the anchor on the wall to the safe's front-left edge
    const A = project(p, CHAIN_ANCHOR[0], CHAIN_ANCHOR[1], CHAIN_ANCHOR[2]);
    const B = project(p, x + 0.02, y + d, h * 0.55);
    for (let k = 0; k < chains; k++) {
      const off = (k - (chains - 1) / 2) * 4 * p.scale;
      drawChain(g, [A[0] + off, A[1]], [B[0] + off, B[1]], p.scale, t + k);
    }
    // status lamp: red while in debt
    const [lx, ly] = project(p, x + w, y + d * 0.5, h - 2);
    g.beginPath();
    g.arc(lx, ly, 1.6 * p.scale, 0, TAU);
    g.fillStyle = Math.sin(t * 4) > 0 ? C.red : '#5a2a25';
    g.fill();
  } else {
    // open door, empty, with a green lamp
    planeY(c, x + w * 0.12, x + w * 0.88, y + d + 0.01, h * 0.15, h * 0.85, '#0b0c0d');
    const [lx, ly] = project(p, x + w, y + d * 0.5, h - 2);
    g.beginPath();
    g.arc(lx, ly, 1.6 * p.scale, 0, TAU);
    g.fillStyle = C.green;
    g.fill();
  }
}

/** A sagging row of chain links between two screen points. */
function drawChain(g: CanvasRenderingContext2D, A: Pt, B: Pt, sc: number, phase: number): void {
  const dist = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const n = Math.max(4, Math.round(dist / (4 * sc)));
  const sag = 5 * sc;
  g.save();
  g.strokeStyle = TREAS.iron;
  g.lineWidth = 1 * sc;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = A[0] + (B[0] - A[0]) * u;
    const y = A[1] + (B[1] - A[1]) * u + sag * Math.sin(Math.PI * u) + Math.sin(phase * 0.8 + i) * 0.2 * sc;
    const vertical = i % 2 === 0;
    g.beginPath();
    if (vertical) g.ellipse(x, y, 1.1 * sc, 2.3 * sc, 0, 0, TAU);
    else g.ellipse(x, y, 2.3 * sc, 1.1 * sc, 0, 0, TAU);
    g.stroke();
  }
  g.restore();
}

/** A belt as a dark strip with moving dashes. `phase` in 0..1 advances the dashes. */
export function beltStroke(c: Ctx, pts: Pt[], phase: number): void {
  const { g, p } = c;
  const sc = p.scale;
  const path = (): void => {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [sx, sy] = project(p, x, y, 0.3);
      if (i) g.lineTo(sx, sy);
      else g.moveTo(sx, sy);
    });
  };
  g.save();
  g.lineJoin = 'round';
  path();
  g.strokeStyle = TREAS.belt;
  g.lineWidth = 9 * sc;
  g.stroke();
  path();
  g.strokeStyle = TREAS.beltTop;
  g.lineWidth = 6.5 * sc;
  g.stroke();
  path();
  g.setLineDash([3 * sc, 4 * sc]);
  g.lineDashOffset = -phase * 7 * sc;
  g.strokeStyle = TREAS.beltDash;
  g.lineWidth = 1.2 * sc;
  g.stroke();
  g.restore();
}

/** Lane floor: a flat strip from the bus to the bin, with a moving centre dash. */
export function laneFloor(c: Ctx, lane: Lane, phase: number): void {
  const { g, p } = c;
  const x0 = BUS.x;
  const x1 = BIN.x0;
  const a = project(p, x0, lane.y0, 0.2);
  const b = project(p, x1, lane.y0, 0.2);
  const cc = project(p, x1, lane.y1, 0.2);
  const d = project(p, x0, lane.y1, 0.2);
  poly(g, [a[0], a[1], b[0], b[1], cc[0], cc[1], d[0], d[1]], TREAS.beltTop);
  g.save();
  g.setLineDash([3 * p.scale, 4 * p.scale]);
  g.lineDashOffset = -phase * 7 * p.scale;
  const m0 = project(p, x0, lane.yc, 0.25);
  const m1 = project(p, x1, lane.yc, 0.25);
  g.beginPath();
  g.moveTo(m0[0], m0[1]);
  g.lineTo(m1[0], m1[1]);
  g.strokeStyle = TREAS.beltDash;
  g.lineWidth = Math.max(0.8, 1 * p.scale);
  g.stroke();
  g.restore();
}

/** The expense bus: the strip along x = BUS.x that the lanes branch from. */
export function drawBus(c: Ctx, phase: number): void {
  const { g, p } = c;
  const a = project(p, BUS.x - 0.3, BUS.y0, 0.2);
  const b = project(p, BUS.x + 0.3, BUS.y0, 0.2);
  const cc = project(p, BUS.x + 0.3, BUS.y1, 0.2);
  const d = project(p, BUS.x - 0.3, BUS.y1, 0.2);
  poly(g, [a[0], a[1], b[0], b[1], cc[0], cc[1], d[0], d[1]], TREAS.belt);
  g.save();
  g.setLineDash([3 * p.scale, 4 * p.scale]);
  g.lineDashOffset = phase * 7 * p.scale;
  const m0 = project(p, BUS.x, BUS.y0, 0.25);
  const m1 = project(p, BUS.x, BUS.y1, 0.25);
  g.beginPath();
  g.moveTo(m0[0], m0[1]);
  g.lineTo(m1[0], m1[1]);
  g.strokeStyle = TREAS.beltDash;
  g.lineWidth = Math.max(0.8, 1 * p.scale);
  g.stroke();
  g.restore();
}

/** One coin on a belt, lying flat above the floor. */
export function coin(g: CanvasRenderingContext2D, sx: number, sy: number, sc: number, color: string): void {
  g.beginPath();
  g.ellipse(sx, sy, 2.6 * sc, 1.6 * sc, 0, 0, TAU);
  g.fillStyle = color;
  g.fill();
}

/**
 * The stock ticker on the back wall. Private: a PRIVATE placard. Public: price, change and a mini chart of the
 * share prices in `vals` (oldest first), plus a scan line and a LIVE dot.
 */
export function drawBoard(c: Ctx, s: GameState, t: number, vals: number[]): void {
  const { g, p } = c;
  const B = BOARD;
  planeY(c, B.x0 - 0.25, B.x1 + 0.25, 0.02, B.z0 - 2, B.z1 + 2, TREAS.trim);
  planeY(c, B.x0, B.x1, 0.05, B.z0, B.z1, TREAS.screen);
  const P = (x: number, z: number): Pt => project(p, x, 0.06, z);
  const sc = p.scale;
  const cx0 = B.x0 + 0.35;
  const cx1 = B.x1 - 0.35;
  const fs = Math.max(8, 9 * sc);
  g.save();
  g.textBaseline = 'middle';
  g.font = `600 ${fs}px IBM Plex Mono, monospace`;
  g.textAlign = 'left';
  g.fillStyle = C.textDim;
  const [hx, hy] = P(cx0, 46.2);
  g.fillText('STOCK', hx, hy);

  if (!s.company.isPublic) {
    const mid = (cx0 + cx1) / 2;
    const [px, py] = P(mid, 42.5);
    g.textAlign = 'center';
    g.font = `600 ${Math.max(9, 11 * sc)}px IBM Plex Mono, monospace`;
    g.fillStyle = C.textDim;
    g.fillText('PRIVATE', px, py);
    const [vx, vy] = P(mid, 36);
    g.font = `600 ${fs}px IBM Plex Mono, monospace`;
    g.fillStyle = C.textDim;
    g.globalAlpha = 0.7;
    g.fillText(`val. ${formatMoney(s.finance.valuation)}`, vx, vy);
    g.globalAlpha = 1;
    // a dashed flat line where the price would be
    g.setLineDash([3 * sc, 4 * sc]);
    g.strokeStyle = C.textDim;
    g.lineWidth = Math.max(0.8, sc);
    const a = P(cx0, 32);
    const b = P(cx1, 32);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    g.setLineDash([]);
    g.restore();
    return;
  }

  const n = vals.length;
  const up = n < 2 || vals[n - 1] >= vals[0];
  const chartZ0 = 28.5;
  const chartZ1 = 37.5;
  if (n >= 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const zAt = (v: number) => (n === 1 ? (chartZ0 + chartZ1) / 2 : chartZ0 + ((v - lo) / span) * (chartZ1 - chartZ0));
    const color = up ? C.green : C.red;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? cx0 : cx0 + (i / (n - 1)) * (cx1 - cx0);
      const [sx, sy] = P(x, zAt(vals[i]));
      if (i) g.lineTo(sx, sy);
      else g.moveTo(sx, sy);
    }
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, 1.6 * sc);
    g.lineJoin = 'round';
    g.stroke();
    const lastX = n === 1 ? (cx0 + cx1) / 2 : cx1;
    const [ex, ey] = P(lastX, zAt(vals[n - 1]));
    glow(g, ex, ey, 9 * sc, color, 0.5);
    g.beginPath();
    g.arc(ex, ey, 1.8 * sc, 0, TAU);
    g.fillStyle = color;
    g.fill();
  }
  // scan line
  const scanX = cx0 + (((t * 0.25) % 1) * (cx1 - cx0));
  const s0 = P(scanX, 27.5);
  const s1 = P(scanX, 49);
  g.beginPath();
  g.moveTo(s0[0], s0[1]);
  g.lineTo(s1[0], s1[1]);
  g.strokeStyle = withAlpha(C.amber, 0.14);
  g.lineWidth = Math.max(1, sc);
  g.stroke();

  // price and change, against the first sample on the chart
  const price = s.company.stockPrice;
  const first = n >= 1 ? vals[0] : price;
  const change = first > 0 ? (price / first - 1) * 100 : 0;
  g.textAlign = 'left';
  g.font = `600 ${Math.max(9, 11 * sc)}px IBM Plex Mono, monospace`;
  g.fillStyle = C.fg;
  const [qx, qy] = P(cx0, 42.5);
  g.fillText(`$${price.toFixed(2)}`, qx, qy);
  g.textAlign = 'right';
  g.font = `600 ${fs}px IBM Plex Mono, monospace`;
  g.fillStyle = change >= 0 ? C.green : C.red;
  const [rx, ry] = P(cx1, 42.5);
  g.fillText(`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, rx, ry);
  // LIVE dot
  const on = Math.sin(t * 4) > 0 ? 1 : 0.35;
  const [lx, ly] = P(cx1 - 0.2, 46.8);
  glow(g, lx, ly, 6 * sc, C.green, 0.5 * on);
  g.beginPath();
  g.arc(lx, ly, 1.6 * sc, 0, TAU);
  g.fillStyle = C.green;
  g.globalAlpha = on;
  g.fill();
  g.globalAlpha = 1;
  g.restore();
}

/** Screen-space label in the office's pill style. */
export function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  g.save();
  g.font = '600 11px IBM Plex Mono, monospace';
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = 20;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, px + w / 2, py + h / 2 - 0.5);
  g.restore();
}
