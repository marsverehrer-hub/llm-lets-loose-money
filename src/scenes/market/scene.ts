// Market scene: the AI market as an isometric town. Three districts (Consumers: houses and cafes; Developers:
// lofts and garages; Enterprise: glass towers). Each lot takes the colour of the lab that serves it, in proportion
// to that segment's user share. Every lab has an HQ tower on the rim, taller with valuation. Hype sets the sky.
import type { GameState, Segment } from '../../sim/types';
import { TILE_H, TILE_W, hashStr, prand, project, type Projector } from '../../office/iso';
import { C, mix, shade } from '../../office/palette';
import { type Ctx, floorLine, floorTile, glow, isoBlock, isoBox, planeX, planeY, poly, withAlpha } from '../../office/draw/prims';
import { clamp, formatMoney, formatNumber } from '../../sim/util';
import type { Scene, SceneHit } from '../types';
import { COLS, PLAYER_KEY, SEGMENTS, SEG_NAME, buildView, type LabRec, type MarketView } from './view';

const REFRESH_S = 0.25;
/** Ground slab and the town proper (roads and districts live in 0..ROAD_MAX). */
const SLAB_MIN = -2;
const SLAB_MAX = 18;
const ROAD_MAX = 16;
/** Top-left lot of each district. Enterprise at the back, Consumers left, Developers right. */
const ORIGIN: Record<Segment, [number, number]> = { enterprise: [0, 0], developer: [9, 0], consumer: [0, 9] };
/** HQ slots on the rim, clockwise from the front corner (slot 0 is you). */
const RING: [number, number][] = [[17, 17], [8, 17], [-1, 17], [-1, 8], [-1, -1], [8, -1], [17, -1], [17, 8]];
/** Height above the ground that the fit leaves room for (the tallest HQ). */
const TOWN_H = 130;
const UNCLAIMED = '#4a463f';
const ROAD = '#1b1917';
const ROAD_LINE = '#2e2a25';
const WINDOW_LIT = '#ffc66b';
const FLOOR: Record<Segment, [string, string]> = {
  consumer: ['#2b2824', '#26231f'],
  developer: ['#2a2c2f', '#25272a'],
  enterprise: ['#2d3133', '#282b2d'],
};
const SKY_TOP: [string, string] = ['#202225', '#2a1a0c'];
const SKY_BOTTOM: [string, string] = ['#34373b', '#6e4215'];
const BALLOON_COLORS = [C.amber, C.blue, C.green, C.red, C.yellow, C.fgDim];

/** Lab HQ height in z units: about 48 at $10M valuation, 120 at $100B. */
function hqHeight(valuation: number): number {
  const h = 48 + 18 * Math.log10(Math.max(valuation, 1e6) / 1e7);
  return Math.round(clamp(h, 40, 130) / 4) * 4;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(v >= 0.1 ? 0 : 1)}%`;
}

function hypeWord(v: number): string {
  if (v >= 80) return 'Feverish';
  if (v >= 60) return 'Hot';
  if (v >= 40) return 'Warm';
  if (v >= 20) return 'Cooling';
  return 'Frozen';
}

/** Screen-space bounding box of a box footprint (x, y, w, d) from z 0 to h. */
function bboxOf(p: Projector, x: number, y: number, w: number, d: number, h: number): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [dx, dy] of [[0, 0], [w, 0], [w, d], [0, d]]) {
    for (const z of [0, h]) {
      const [sx, sy] = project(p, x + dx, y + dy, z);
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy;
      if (sy > y1) y1 = sy;
    }
  }
  return [x0, y0, x1, y1];
}

type Box = [number, number, number, number];

interface HitRef {
  kind: 'lab' | 'seg' | 'hype';
  key?: string;
  seg?: Segment;
  box: Box;
}

interface Led {
  x: number;
  y: number;
  color: string;
  phase: number;
  rate: number;
}

interface Flag {
  x: number;
  y: number;
  color: string;
  seed: number;
}

interface DrawItem {
  d: number;
  fn: (c: Ctx) => void;
}

/** Small label in the office's terminal style: black box, hairline frame, mono text. */
function pill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  g.save();
  g.font = '600 10px IBM Plex Mono, monospace';
  const w = Math.ceil(g.measureText(text).width) + 12;
  const h = 16;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  g.fillStyle = '#000000';
  g.fillRect(px, py, w, h);
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  g.fillStyle = C.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, px + w / 2, py + h / 2 + 0.5);
  g.restore();
}

export class MarketScene implements Scene {
  private view: MarketView | null = null;
  private sig = '';
  private sigTimer = 0;
  private time = 0;
  private cssW = 0;
  private cssH = 0;
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private cache: HTMLCanvasElement | null = null;
  private rects: Partial<Record<Segment, { x0: number; y0: number; x1: number; y1: number }>> = {};
  private hits: HitRef[] = [];
  private leds: Led[] = [];
  private flags: Flag[] = [];
  private you: [number, number] | null = null;

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
    // Rebuild the cached town at the new size on the next frame.
    this.sigTimer = 0;
  }

  /** Fit the town into the canvas (CSS px). The rim sits at -2..18 on the floor grid. */
  private fit(): void {
    const pad = 10;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    // Horizontal: x - y spans -20..20 on the slab. Vertical: x + y spans -4..36, plus the tallest HQ above it.
    const sW = availW / (40 * (TILE_W / 2));
    const sH = availH / (40 * (TILE_H / 2) + TOWN_H);
    const s = clamp(Math.min(sW, sH, 2.4), 0.3, 2.4);
    const spare = availH - (40 * (TILE_H / 2) + TOWN_H) * s;
    this.proj.scale = s;
    this.proj.ox = this.cssW / 2;
    // The back corner (x + y = -4) sits TOWN_H below the top pad, so the tallest HQ clears it.
    this.proj.oy = pad + spare / 2 + (TOWN_H + 4 * (TILE_H / 2)) * s;
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.time += dt;
    const t = this.time;
    const dpr = g.getTransform().a || 1;

    this.sigTimer -= dt;
    if (!this.view || this.sigTimer <= 0) {
      this.sigTimer = REFRESH_S;
      const v = buildView(s);
      this.view = v;
      const sig = this.signature(v, dpr);
      if (sig !== this.sig) {
        this.sig = sig;
        this.buildCache(v, dpr);
      }
    }
    const v = this.view as MarketView;
    const W = this.cssW;
    const H = this.cssH;
    const tH = v.hype / 100;

    // Sky: grey and flat in a winter, warm dusk when hype runs hot.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mix(SKY_TOP[0], SKY_TOP[1], tH));
    sky.addColorStop(1, mix(SKY_BOTTOM[0], SKY_BOTTOM[1], tH));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalCompositeOperation = 'lighter';
    glow(g, W / 2, H * 0.12, W * 0.5, C.amber, 0.12 * tH);
    g.restore();
    const fog = clamp(1 - v.hype / 35, 0, 1);
    if (fog > 0) {
      g.fillStyle = `rgba(200,200,200,${(0.05 * fog).toFixed(3)})`;
      for (let k = 0; k < 3; k++) {
        const y = H * (0.12 + 0.12 * k) + Math.sin(t * 0.08 + k * 2) * 5;
        g.fillRect(0, y, W, H * 0.06);
      }
    }

    // Balloons rise with hype (none in a winter), behind the town.
    const nB = v.hype < 25 ? 0 : Math.round(2 + ((v.hype - 25) / 75) * 16);
    for (let i = 0; i < nB; i++) {
      const seed = i * 17.3 + 1;
      const bx = (0.06 + 0.88 * prand(seed)) * W + Math.sin(t * 0.15 + seed) * 12;
      const by = H * (0.04 + 0.16 * prand(seed + 5)) + Math.sin(t * 0.5 + seed) * 3;
      const r = 3.5 + 2 * prand(seed + 9);
      g.beginPath();
      g.ellipse(bx, by, r, r * 1.2, 0, 0, Math.PI * 2);
      g.fillStyle = BALLOON_COLORS[i % BALLOON_COLORS.length];
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.moveTo(bx, by + r * 1.2);
      g.lineTo(bx, by + r * 1.2 + 9);
      g.strokeStyle = withAlpha(C.fg, 0.3);
      g.lineWidth = 1;
      g.stroke();
    }

    // The town, cached as one bitmap.
    if (this.cache) g.drawImage(this.cache, 0, 0, W, H);

    // Blinking lit windows and LEDs.
    for (const L of this.leds) {
      const b = 0.5 + 0.5 * Math.sin(t * L.rate + L.phase);
      g.globalAlpha = 0.25 + 0.75 * b * b;
      g.fillStyle = L.color;
      g.fillRect(L.x - 1, L.y - 1, 2, 2);
    }
    g.globalAlpha = 1;

    // HQ flags, flapping.
    const sc = this.proj.scale;
    for (const f of this.flags) {
      const wv = Math.sin(t * 3 + f.seed) * 1.5 * sc;
      const fw = 9 * sc;
      const fh = 5 * sc;
      poly(g, [f.x, f.y, f.x + fw, f.y + wv, f.x + fw, f.y + fh + wv, f.x, f.y + fh], f.color);
    }
    // Your HQ is highlighted.
    if (this.you) {
      glow(g, this.you[0], this.you[1], 40 * sc, C.fg, 0.1 + 0.05 * Math.sin(t * 2));
    }

    // Walkers on the roads: more of them as hype rises.
    const nW = Math.round(1 + 14 * tH);
    g.fillStyle = C.fgDim;
    for (let i = 0; i < nW; i++) {
      const seed = i * 0.618 + 0.13;
      const p = (t * (0.02 + 0.03 * prand(seed * 91.7)) + prand(seed * 13.1)) % 1;
      const along = -0.5 + 17 * p;
      const [wx, wy] = i % 2 === 0 ? [along, 8] : [8, along];
      const [sx, sy] = project(this.proj, wx, wy, 1);
      g.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }

  hitTest(x: number, y: number): SceneHit | null {
    if (!this.view) return null;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      const b = h.box;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return this.tip(h);
    }
    // Ground: invert the projection at z = 0 to find the lot coordinates.
    const s = this.proj.scale;
    const u = (x - this.proj.ox) / ((TILE_W / 2) * s); // x - y
    const w = (y - this.proj.oy) / ((TILE_H / 2) * s); // x + y
    const wx = (u + w) / 2;
    const wy = (w - u) / 2;
    for (const seg of SEGMENTS) {
      const r = this.rects[seg];
      if (r && wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1) return this.tip({ kind: 'seg', seg, box: [0, 0, 0, 0] });
    }
    return this.tip({ kind: 'hype', box: [0, 0, 0, 0] });
  }

  private tip(h: HitRef): SceneHit {
    const v = this.view as MarketView;
    if (h.kind === 'lab' && h.key) {
      const lab = v.byKey.get(h.key);
      if (!lab) return { id: 'hype', label: 'Lab' };
      return { id: `lab:${lab.key}`, label: this.labTip(lab, h.seg) };
    }
    if (h.kind === 'seg' && h.seg) {
      const sr = v.segs[h.seg];
      const lines = [`${SEG_NAME[h.seg]} market`, `Size ${formatNumber(sr.tam, 1)} customers`, `Your share ${pct(sr.playerShare)}`];
      const leader = sr.leader;
      lines.push(leader ? `Leader ${leader.key === PLAYER_KEY ? 'you' : leader.name} ${pct(leader.share)}` : 'Nobody selling yet');
      return { id: `segment:${h.seg}`, label: lines.join('\n') };
    }
    return { id: 'hype', label: `AI hype ${Math.round(v.hype)} (${hypeWord(v.hype)})\nBusy skies when hot, grey in a winter` };
  }

  private labTip(lab: LabRec, seg?: Segment): string {
    const lines = [lab.isPlayer ? `${lab.name} (you)` : lab.name];
    lines.push(lab.elo !== null ? `Arena Elo ${Math.round(lab.elo)}${lab.rank ? ` · #${lab.rank}` : ''}` : 'No model in the arena yet');
    lines.push(`Users ${formatNumber(lab.users, 1)}`);
    if (seg) lines.push(`${SEG_NAME[seg]} share ${pct(lab.share[seg])}`);
    else lines.push(`Valuation ${formatMoney(lab.valuation)}`);
    return lines.join('\n');
  }

  private signature(v: MarketView, dpr: number): string {
    const parts: (string | number)[] = [this.cssW, this.cssH, dpr, Math.round(v.hype / 10)];
    for (const seg of SEGMENTS) {
      const sr = v.segs[seg];
      parts.push(seg, sr.n, sr.owner.map((k) => k ?? '-').join(','), Math.round(sr.scale * 20));
    }
    for (const lab of v.labs) parts.push(lab.key, lab.slot, hqHeight(lab.valuation));
    return parts.join('|');
  }

  /** Rebuild the static town into the offscreen bitmap (only when the layout signature changes). */
  private buildCache(v: MarketView, dpr: number): void {
    const W = this.cssW;
    const H = this.cssH;
    if (!this.cache) this.cache = document.createElement('canvas');
    this.cache.width = Math.max(1, Math.round(W * dpr));
    this.cache.height = Math.max(1, Math.round(H * dpr));
    const g = this.cache.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    this.hits = [];
    this.leds = [];
    this.flags = [];
    this.you = null;
    this.rects = {};
    const c: Ctx = { g, p: this.proj };
    const litP = 0.12 + 0.55 * (v.hype / 100);
    const items: DrawItem[] = [];

    // Slab and roads.
    isoBlock(c, SLAB_MIN, SLAB_MIN, SLAB_MAX - SLAB_MIN, SLAB_MAX - SLAB_MIN, -4, 0, C.floorEdge, '#131110', '#0f0d0c');
    floorTile(c, 0, 0, ROAD_MAX, ROAD_MAX, ROAD);
    floorLine(c, 8, -0.5, 8, 16.5, 0.02, ROAD_LINE, 2);
    floorLine(c, -0.5, 8, 16.5, 8, 0.02, ROAD_LINE, 2);

    // Your HQ plinth belongs on the ground, so it goes in before any building.
    const [ys, yt] = RING[0];
    floorTile(c, ys - 1.1, yt - 1.1, 2.2, 2.2, withAlpha(C.fg, 0.12));

    // Lots: ground first, then the buildings, depth-sorted with the HQs.
    for (const seg of SEGMENTS) {
      const sr = v.segs[seg];
      const [ox, oy] = ORIGIN[seg];
      const [f0, f1] = FLOOR[seg];
      this.rects[seg] = { x0: ox, y0: oy, x1: ox + Math.min(COLS, sr.n), y1: oy + Math.max(1, Math.ceil(sr.n / COLS)) };
      for (let i = 0; i < sr.n; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const wx = ox + col;
        const wy = oy + row;
        const owner = sr.owner[i];
        const lab = owner ? v.byKey.get(owner) : undefined;
        const L = lab ? lab.color : UNCLAIMED;
        floorTile(c, wx, wy, 1, 1, (col + row) % 2 ? f1 : f0);
        if (lab) floorTile(c, wx, wy, 1, 1, withAlpha(lab.color, 0.22));
        const hash = hashStr(`${seg}:${i}`);
        const h2 = hashStr(`${seg}:${i}:h`);
        const key = lab?.key;
        items.push({
          d: wx + wy + 1,
          fn: (cc) => {
            let box: Box;
            if (seg === 'consumer') {
              box = hash < 0.28 ? this.cafe(cc, wx, wy, L, 8 + 3 * h2) : this.house(cc, wx, wy, L, 11 + 8 * h2, `${seg}${i}`, litP);
            } else if (seg === 'developer') {
              box = hash < 0.3 ? this.garage(cc, wx, wy, L, 7 + 2 * h2) : this.loft(cc, wx, wy, L, 16 + 18 * h2, `${seg}${i}`, litP, v.hype);
            } else {
              box = this.tower(cc, wx, wy, L, (34 + 58 * h2) * sr.scale, `${seg}${i}`, litP, v.hype);
            }
            this.hits.push({ kind: key ? 'lab' : 'seg', key, seg, box });
          },
        });
      }
    }

    // HQ towers on the rim.
    for (const lab of v.labs) {
      const [sx, sy] = RING[lab.slot] ?? RING[0];
      const h = hqHeight(lab.valuation);
      items.push({ d: sx + sy + 0.5, fn: (cc) => this.hq(cc, lab, sx, sy, h, litP) });
    }

    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.fn(c);

    // District names, in the roads beside each district.
    // On the sidewalks at the outer edge, clear of the towers.
    const names: [Segment, number, number][] = [
      ['enterprise', -1.6, 3.5],
      ['developer', 17.6, 3.5],
      ['consumer', -1.6, 12.5],
    ];
    for (const [seg, x, y] of names) {
      const [px, py] = project(this.proj, x, y, 0);
      pill(g, px, py, SEG_NAME[seg].toUpperCase(), C.fgDim);
    }
  }

  private led(p: Projector, x: number, y: number, z: number, color: string, rate: number, seed: string): void {
    const [sx, sy] = project(p, x, y, z);
    this.leds.push({ x: sx, y: sy, color, phase: hashStr(seed) * Math.PI * 2, rate });
  }

  /** Windows on a face facing +y (at y), spanning x0..x1 and heights z0..z1 in a cols x rows grid. */
  private winY(c: Ctx, x0: number, x1: number, y: number, z0: number, z1: number, cols: number, rows: number, seed: string, litP: number): void {
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        if (hashStr(`${seed}|${r}|${k}`) > litP) continue;
        const ax = x0 + ((x1 - x0) * (k + 0.22)) / cols;
        const bx = x0 + ((x1 - x0) * (k + 0.78)) / cols;
        const az = z0 + ((z1 - z0) * (r + 0.25)) / rows;
        const bz = z0 + ((z1 - z0) * (r + 0.7)) / rows;
        planeY(c, ax, bx, y, az, bz, WINDOW_LIT);
        if (hashStr(`${seed}|L|${r}|${k}`) < 0.1) this.led(c.p, (ax + bx) / 2, y, (az + bz) / 2, WINDOW_LIT, 1.2, `${seed}${r}${k}`);
      }
    }
  }

  /** Windows on a face facing +x (at x), spanning y0..y1. */
  private winX(c: Ctx, x: number, y0: number, y1: number, z0: number, z1: number, cols: number, rows: number, seed: string, litP: number): void {
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        if (hashStr(`${seed}|${r}|${k}`) > litP) continue;
        const ay = y0 + ((y1 - y0) * (k + 0.22)) / cols;
        const by = y0 + ((y1 - y0) * (k + 0.78)) / cols;
        const az = z0 + ((z1 - z0) * (r + 0.25)) / rows;
        const bz = z0 + ((z1 - z0) * (r + 0.7)) / rows;
        planeX(c, x, ay, by, az, bz, WINDOW_LIT);
      }
    }
  }

  /** Floor bands on the two visible faces of a tower or loft. */
  private bands(c: Ctx, x: number, y: number, w: number, d: number, h: number, step: number, L: string): void {
    for (let z = step; z < h - 1; z += step) {
      planeY(c, x + 0.02, x + w - 0.02, y + d + 0.004, z, z + 0.4, shade(L, 1.3));
      planeX(c, x + w + 0.004, y + 0.02, y + d - 0.02, z, z + 0.4, shade(L, 1.3));
    }
  }

  private house(c: Ctx, x: number, y: number, L: string, h: number, seed: string, litP: number): Box {
    const ox = x + 0.17;
    const oy = y + 0.17;
    const w = 0.66;
    isoBox(c, ox, oy, w, w, h, shade(L, 0.4), shade(L, 0.34), shade(L, 0.46));
    isoBlock(c, ox - 0.05, oy - 0.05, w + 0.1, w + 0.1, h, h + 3.5, L, shade(L, 0.62), shade(L, 0.8));
    this.winY(c, ox + 0.1, ox + w - 0.1, oy + w, h * 0.25, h * 0.7, 2, 2, `${seed}y`, litP);
    this.winX(c, ox + w, oy + 0.1, oy + w - 0.1, h * 0.25, h * 0.7, 2, 2, `${seed}x`, litP);
    return bboxOf(c.p, ox - 0.05, oy - 0.05, w + 0.1, w + 0.1, h + 3.5);
  }

  private cafe(c: Ctx, x: number, y: number, L: string, h: number): Box {
    const ox = x + 0.15;
    const oy = y + 0.15;
    const w = 0.7;
    isoBox(c, ox, oy, w, w, h, L, shade(L, 0.42), shade(L, 0.6));
    // Striped awning over the front, warm windows below it.
    const az = h * 0.38;
    for (let k = 0; k < 4; k++) {
      planeY(c, ox + 0.06 + k * 0.15, ox + 0.06 + (k + 1) * 0.15, oy + w + 0.01, az, az + 2, k % 2 ? '#efe6d2' : L);
    }
    planeY(c, ox + 0.08, ox + w - 0.08, oy + w + 0.01, 1.2, az - 0.6, '#f0a040');
    planeX(c, ox + w + 0.01, oy + 0.08, oy + w - 0.08, 1.2, az - 0.6, '#f0a040');
    // Sign on the roof, lit in the lab colour.
    isoBlock(c, ox + 0.2, oy + 0.2, 0.3, 0.3, h, h + 2.4, C.fg, '#3a3733', '#2e2c29');
    this.led(c.p, ox + 0.35, oy + 0.35, h + 1.2, L, 1.5, `${ox}${oy}cafe`);
    return bboxOf(c.p, ox, oy, w, w, h + 2.4);
  }

  private loft(c: Ctx, x: number, y: number, L: string, h: number, seed: string, litP: number, hype: number): Box {
    const ox = x + 0.15;
    const oy = y + 0.15;
    const w = 0.7;
    isoBox(c, ox, oy, w, w, h, L, shade(L, 0.42), shade(L, 0.6));
    this.bands(c, ox, oy, w, w, h, 4.5, L);
    this.winY(c, ox + 0.06, ox + w - 0.06, oy + w, 3, h - 2, 3, Math.max(1, Math.floor((h - 5) / 4)), `${seed}y`, litP);
    this.winX(c, ox + w, oy + 0.06, oy + w - 0.06, 3, h - 2, 3, Math.max(1, Math.floor((h - 5) / 4)), `${seed}x`, litP);
    // Rooftop: a dark cap with a green strip LED, the co-working tell.
    isoBlock(c, ox + 0.12, oy + 0.12, w - 0.24, w - 0.24, h, h + 1.4, '#2b2b2b', '#1f1f1f', '#262626');
    this.led(c.p, ox + w / 2, oy + w / 2, h + 1.4, C.green, 1 + hype / 60, `${seed}roof`);
    return bboxOf(c.p, ox, oy, w, w, h + 1.4);
  }

  private garage(c: Ctx, x: number, y: number, L: string, h: number): Box {
    const ox = x + 0.15;
    const oy = y + 0.15;
    const w = 0.7;
    isoBox(c, ox, oy, w, w, h, L, shade(L, 0.4), shade(L, 0.62));
    // Roll-up door, and a screen glowing green inside the front.
    planeY(c, ox + 0.14, ox + w - 0.14, oy + w + 0.01, 0.6, h * 0.55, '#0e0d0c');
    this.led(c.p, ox + w / 2, oy + w + 0.02, h * 0.8, C.green, 4, `${ox}${oy}garage`);
    return bboxOf(c.p, ox, oy, w, w, h);
  }

  private tower(c: Ctx, x: number, y: number, L: string, h: number, seed: string, litP: number, hype: number): Box {
    const ox = x + 0.15;
    const oy = y + 0.15;
    const w = 0.7;
    isoBox(c, ox, oy, w, w, h, L, shade(L, 0.36), shade(L, 0.56));
    this.bands(c, ox, oy, w, w, h, 4.2, L);
    const rows = Math.max(1, Math.floor((h - 7) / 4.2));
    this.winY(c, ox + 0.04, ox + w - 0.04, oy + w, 4, h - 3, 2, rows, `${seed}y`, litP);
    this.winX(c, ox + w, oy + 0.04, oy + w - 0.04, 4, h - 3, 2, rows, `${seed}x`, litP);
    // Crown: a slightly lighter block with an amber beacon.
    isoBlock(c, ox + 0.12, oy + 0.12, w - 0.24, w - 0.24, h, h + 3, shade(L, 1.1), shade(L, 0.6), shade(L, 0.8));
    this.led(c.p, ox + w / 2, oy + w / 2, h + 3, C.amber, 0.8 + hype / 50, `${seed}beacon`);
    return bboxOf(c.p, ox, oy, w, w, h + 3);
  }

  /** A lab HQ: a big tower on the rim, with its flag. You get a light top, a pole sign and a YOU label. */
  private hq(c: Ctx, lab: LabRec, sx: number, sy: number, h: number, litP: number): void {
    const x0 = sx - 0.7;
    const y0 = sy - 0.7;
    const w = 1.4;
    const L = lab.color;
    isoBox(c, x0, y0, w, w, h, L, shade(L, 0.42), shade(L, 0.62));
    this.bands(c, x0, y0, w, w, h, 5, L);
    const rows = Math.max(1, Math.floor((h - 8) / 5));
    this.winY(c, x0 + 0.1, x0 + w - 0.1, y0 + w, 4, h - 4, 3, rows, `hq${lab.key}y`, litP + 0.2);
    this.winX(c, x0 + w, y0 + 0.1, y0 + w - 0.1, 4, h - 4, 3, rows, `hq${lab.key}x`, litP + 0.2);
    isoBlock(c, x0 + 0.25, y0 + 0.25, w - 0.5, w - 0.5, h, h + 6, L, shade(L, 0.6), shade(L, 0.8));
    isoBlock(c, sx - 0.03, sy - 0.03, 0.06, 0.06, h + 6, h + 18, '#8a847a', '#5a554e', '#6a655e');
    const [fx, fy] = project(c.p, sx, sy, h + 18);
    this.flags.push({ x: fx, y: fy, color: L, seed: lab.slot * 1.7 });
    if (lab.isPlayer) {
      this.you = [fx, fy];
      // The label sits above the flag.
      pill(c.g, fx, fy - 8, 'YOU', C.fg);
    }
    const box = bboxOf(c.p, x0, y0, w, w, h + 18);
    box[2] += 14 * this.proj.scale; // the flag flies to the right
    this.hits.push({ kind: 'lab', key: lab.key, box });
  }
}
