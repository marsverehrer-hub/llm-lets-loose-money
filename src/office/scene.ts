// Office scene: builds a layout from GameState and renders it each frame.
import type { GameState } from '../sim/types';
import { OFFICE_TIERS } from '../sim/data/roles';
import { TILE_H, TILE_W, project, type Projector } from './iso';
import { C, ROLE_LABEL, mix } from './palette';
import { Ctx, floorTile, glow, isoBlock, planeX, planeY, withAlpha } from './draw/prims';
import {
  DESK_W,
  Role,
  drawBoxes,
  drawChair,
  drawCarSpot,
  drawCoffee,
  drawDesk,
  drawFoldingTable,
  drawNeonSign,
  drawPlant,
  drawRack,
  drawSecretCrate,
  drawWhiteboard,
  drawWindow,
} from './draw/furniture';
import { WALL_H, drawFloor, drawNeonStrip, drawWalls } from './draw/room';
import { drawPerson } from './draw/person';
import { Crowd, MAX_PEOPLE, chairOf, type DeskSlot, type Person, type Stops } from './agents';
import { Effects } from './effects';

const ROLE_ORDER: Role[] = ['researcher', 'engineer', 'safety', 'sales', 'marketing'];
const DESK_CAP = 80;
const DX0 = 3.4; // first desk column x
const DY0 = 3.2; // first desk row y
const TIER_NAMES = ["Mom's Garage", 'WeWork Hot Desks', 'SoMa Loft', 'Mission Bay Floors', 'Glass Donut Campus', 'Arcology'];
const TIER_FLOORS: [string, string][] = [
  ['#33302c', '#2c2a26'],
  ['#3a2f22', '#332a1e'],
  ['#2b2824', '#26231f'],
  ['#2a2c2f', '#25272a'],
  ['#2d3133', '#282b2d'],
  ['#2a2622', '#24211e'],
];
const TIER_TRIM = ['#3a3834', '#34312c', '#3a342a', '#2f3132', '#2b2e30', '#3a352e'];

export function tierIndex(s: GameState): number {
  const id = s.company.officeTierId;
  const i = OFFICE_TIERS.findIndex((t) => t.id === id);
  if (i >= 0) return Math.min(5, i);
  const low = id.toLowerCase();
  const rules: [RegExp, number][] = [
    [/arco/, 5],
    [/campus|glass|donut/, 4],
    [/floor|bay|mission/, 3],
    [/loft|soma/, 2],
    [/hot|cowork|wework|desk/, 1],
    [/garage|mom/, 0],
  ];
  for (const [re, n] of rules) if (re.test(low)) return n;
  return 0;
}

export function tierName(s: GameState): string {
  const i = tierIndex(s);
  return OFFICE_TIERS[i]?.name ?? TIER_NAMES[i];
}

export function totalGpus(s: GameState): number {
  let n = 0;
  for (const k in s.compute.rented) n += s.compute.rented[k] ?? 0;
  for (const dc of s.compute.datacenters) for (const k in dc.gpus) n += dc.gpus[k] ?? 0;
  return n;
}

export interface RackSlot { x: number; y: number; }
export interface Scaffold { x: number; y: number; days: number; name: string; }

export interface Layout {
  sig: string;
  tier: number;
  W: number;
  D: number;
  wingX: number;
  wingW: number;
  wingD: number;
  hasWing: boolean;
  extX: number;
  extY: number;
  desks: DeskSlot[];
  salesDesks: DeskSlot[];
  stops: Stops;
  racks: RackSlot[];
  scaffolds: Scaffold[];
  crates: { x: number; y: number }[];
  plants: { x: number; y: number; size: number }[];
  windows: number[];
  neonX: number;
  neonText: string | null;
  coffee: { x: number; y: number };
  headcount: number;
  gpus: number;
  overflow: number;
  garage: boolean;
  floorTone: string;
  floorAlt: string;
  trim: string;
}

/** Pure function of state: the static room plan. */
export function buildLayout(s: GameState): Layout {
  const tier = tierIndex(s);
  const counts = ROLE_ORDER.map((r) => Math.max(0, Math.floor(s.staff.roles[r]?.count ?? 0)));
  const headcount = counts.reduce((a, b) => a + b, 0);
  const seq: Role[] = [];
  ROLE_ORDER.forEach((r, i) => {
    for (let k = 0; k < counts[i] && seq.length < DESK_CAP; k++) seq.push(r);
  });
  const deskN = seq.length;
  const perRow = Math.min(10, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, deskN)) * 1.3)));
  const rows = Math.max(1, Math.ceil(Math.max(1, deskN) / perRow));
  const desks: DeskSlot[] = seq.map((role, i) => ({
    x: DX0 + (i % perRow) * 1.8,
    y: DY0 + Math.floor(i / perRow) * 2.6,
    role,
    index: i,
  }));
  const garage = tier === 0;
  const W = Math.max(9, DX0 + perRow * 1.8 + 0.8 + (garage ? 3.0 : 0));
  const D = Math.max(6.5, DY0 + rows * 2.6 + 0.6);

  const gpus = totalGpus(s);
  const dcs = s.compute.datacenters;
  const dcBuilding = dcs.filter((d) => d.buildDaysLeft > 0);
  const racksN = gpus > 0 ? Math.min(28, Math.round(Math.log2(1 + gpus) * 1.2)) : 0;
  const hasWing = gpus > 0 || dcs.length > 0;
  const cols = Math.max(1, Math.ceil(Math.sqrt(racksN)));
  const wrows = Math.max(1, Math.ceil(racksN / cols));
  const wingX = W + 1.2;
  const wingW = 1.6 + cols * 0.9 + 0.5;
  const wingD = Math.max(D, 2.0 + wrows * 0.9);
  const racks: RackSlot[] = [];
  for (let i = 0; i < racksN; i++) {
    racks.push({ x: wingX + 0.8 + (i % cols) * 0.9, y: 1.6 + Math.floor(i / cols) * 0.9 });
  }
  const scaffolds: Scaffold[] = dcBuilding.map((dc, k) => ({
    x: wingX + 0.3 + k * 2.0,
    y: wingD + 0.3,
    days: dc.buildDaysLeft,
    name: dc.name,
  }));

  const unreleased = s.models.filter((m) => m.releasedDay === null).length;
  const crates: { x: number; y: number }[] = [];
  for (let i = 0; i < Math.min(3, unreleased); i++) crates.push({ x: 0.4 + i * 0.62, y: D - 1.5 });

  const plantN = Math.min(8, 1 + tier * 2);
  const plants: { x: number; y: number; size: number }[] = [];
  for (let k = 0; k < plantN; k++) {
    plants.push({ x: 0.45, y: 1.4 + (k * (D - 2.6)) / Math.max(1, plantN), size: 1 + (k % 2) * 0.25 });
  }

  const windows: number[] = [];
  for (let x = 4.8; x + 1.6 < W - 0.4; x += 2.4) {
    windows.push(x);
    if (garage) break;
  }

  const marketing = counts[4];
  const neonText = marketing > 0 ? 'GO VIRAL' : tier >= 1 ? 'WE ARE HIRING' : null;

  const coffee = { x: 0.75, y: 3.4 };
  const board = new Map<number, { x: number; y: number }>();
  for (const d of desks) {
    if (d.role === 'researcher') board.set(d.index, { x: d.x + 0.65, y: d.y - 0.5 });
  }
  const stops: Stops = { coffee: { x: 1.5, y: coffee.y + 0.3 }, corridorX: 1.5, board };

  const extX = hasWing ? wingX + wingW : W;
  const extY = Math.max(D, hasWing ? wingD : 0) + (scaffolds.length ? 1.9 : 0);

  const [floorTone, floorAlt] = TIER_FLOORS[tier];
  const sig = [counts.join(','), tier, gpus, dcs.length, dcBuilding.length, unreleased, neonText ?? '-'].join('|');

  return {
    sig,
    tier,
    W,
    D,
    wingX,
    wingW,
    wingD,
    hasWing,
    extX,
    extY,
    desks,
    salesDesks: desks.filter((d) => d.role === 'sales'),
    stops,
    racks,
    scaffolds,
    crates,
    plants,
    windows,
    neonX: 0.8,
    neonText,
    coffee,
    headcount,
    gpus,
    overflow: Math.max(0, headcount - MAX_PEOPLE),
    garage,
    floorTone,
    floorAlt,
    trim: TIER_TRIM[tier],
  };
}

interface Env {
  training: boolean;
  night: number;
  skyTop: string;
  skyBottom: string;
}

interface StaticItem {
  d: number;
  fn: (c: Ctx, t: number, env: Env) => void;
}

function buildStatics(L: Layout): StaticItem[] {
  const out: StaticItem[] = [];
  for (const desk of L.desks) {
    const { x, y, role, index } = desk;
    if (role === 'researcher') {
      out.push({ d: x + y + 0.53, fn: (c) => drawWhiteboard(c, x, y - 0.12, DESK_W, index) });
    }
    out.push({
      d: x + y + 1.0,
      fn: (c, t, env) => {
        const occ = index < MAX_PEOPLE;
        const fl = occ ? 0.5 + 0.5 * Math.sin(t * (4 + (index % 5)) + index * 1.3) : 0.05;
        drawDesk(c, x, y, role, role === 'engineer', fl, t);
        if (env.night > 0.05) {
          const [lx, ly] = project(c.p, x + 0.65, y + 0.3, 30);
          glow(c.g, lx, ly, 18 * c.p.scale, '#fde68a', 0.12 * env.night);
        }
      },
    });
    const cp = chairOf(desk);
    out.push({ d: x + y + 1.8, fn: (c) => drawChair(c, cp.x - 0.2, cp.y - 0.2) });
  }
  for (const pl of L.plants) out.push({ d: pl.x + pl.y + 0.5, fn: (c) => drawPlant(c, pl.x, pl.y, pl.size) });
  out.push({ d: L.coffee.x + L.coffee.y + 0.9, fn: (c, t) => drawCoffee(c, L.coffee.x, L.coffee.y, t) });
  if (L.garage) {
    out.push({ d: 0.5 + 0.6 + 1.2, fn: (c) => drawBoxes(c, 0.5, 0.6, 3) });
    out.push({ d: L.W - 2.9 + 0.6 + 1.1, fn: (c) => drawFoldingTable(c, L.W - 2.9, 0.6) });
  }
  for (const cr of L.crates) out.push({ d: cr.x + cr.y + 0.5, fn: (c, t) => drawSecretCrate(c, cr.x, cr.y, t) });
  L.racks.forEach((r, i) => {
    out.push({
      d: r.x + r.y + 0.45,
      fn: (c, t, env) => {
        const lit = env.training ? 0.5 + 0.5 * Math.sin(t * 3 + i * 0.7) : 0;
        drawRack(c, r.x, r.y, lit, env.training, t, i);
      },
    });
  });
  for (const sc of L.scaffolds) out.push({ d: sc.x + sc.y + 0.5, fn: (c) => drawScaffold(c, sc.x, sc.y, sc.days) });
  return out;
}

function drawScaffold(c: Ctx, x: number, y: number, days: number): void {
  const { g, p } = c;
  const w = 1.8;
  const d = 0.9;
  const H = 40;
  const pole = '#b45309';
  isoBlock(c, x, y, 0.07, 0.07, 0, H, pole);
  isoBlock(c, x + w - 0.07, y, 0.07, 0.07, 0, H, pole);
  isoBlock(c, x, y + d - 0.07, 0.07, 0.07, 0, H, pole);
  isoBlock(c, x + w - 0.07, y + d - 0.07, 0.07, 0.07, 0, H, pole);
  for (const z of [12, 26, 40]) {
    planeY(c, x, x + w, y + d, z, z + 1.2, '#d97706');
    planeX(c, x + w, y, y + d, z, z + 1.2, '#b45309');
  }
  const [cx, cy] = project(p, x + w / 2, y + d / 2, H + 8);
  g.save();
  g.font = `600 ${Math.max(7, 8 * p.scale)}px IBM Plex Mono, monospace`;
  g.textAlign = 'center';
  g.fillStyle = C.amber;
  g.fillText(`building · ${Math.ceil(days)}d left`, cx, cy);
  g.restore();
}

const SKY_DAY_TOP = '#2a2a2a';
const SKY_DAY_BOTTOM = '#4a4236';
const SKY_NIGHT_TOP = '#050505';
const SKY_NIGHT_BOTTOM = '#14110c';

export class OfficeScene {
  private layout: Layout | null = null;
  private statics: StaticItem[] = [];
  private sigTimer = 0;
  readonly crowd = new Crowd();
  private effects = new Effects();
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private env: Env = { training: false, night: 0, skyTop: SKY_DAY_TOP, skyBottom: SKY_DAY_BOTTOM };
  private order: Person[] = [];
  private cssW = 0;
  private cssH = 0;
  private lastModels = -1;
  private time = 0;
  private trainLabel = '';
  private trainPct = 0;

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
  }

  /** Fit the scene footprint into the canvas (CSS px). */
  private fit(): void {
    const L = this.layout;
    if (!L) return;
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const X = L.extX;
    const Y = L.extY;
    const s = Math.min(availW / ((X + Y) * TILE_W / 2), availH / ((X + Y) * TILE_H / 2 + WALL_H), 2.6);
    const sc = Math.max(0.35, s);
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - ((X - Y) * TILE_W / 4) * sc;
    this.proj.oy = this.cssH / 2 - ((X + Y) * TILE_H / 4 - WALL_H / 2) * sc;
  }

  private rebuild(s: GameState): void {
    const L = buildLayout(s);
    this.layout = L;
    this.statics = buildStatics(L).sort((a, b) => a.d - b.d);
    this.crowd.sync(L.desks, L.stops);
    this.fit();
  }

  /** Advance simulation-side animation and paint one frame. dt in seconds, nowMs = Date.now(). */
  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, nowMs: number): void {
    this.time += dt;
    const t = this.time;
    // Layout only changes on a state signature change; check a few times a second.
    this.sigTimer -= dt;
    if (!this.layout || this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      const next = buildLayout(s);
      if (!this.layout || next.sig !== this.layout.sig) this.rebuild(s);
    }
    const L = this.layout as Layout;

    // Day/night: fake 2-minute cycle on real time, nudged by the in-game season.
    const cyc = (nowMs / 1000 / 120) % 1;
    const sun = (1 - Math.cos(cyc * Math.PI * 2)) / 2;
    const dayPhase = (s.day % 365) / 365;
    const night = 1 - smooth(0.28 + 0.03 * Math.sin(dayPhase * Math.PI * 2), 0.6, sun);
    const env = this.env;
    env.night = night;
    env.skyTop = mix(SKY_DAY_TOP, SKY_NIGHT_TOP, night);
    env.skyBottom = mix(SKY_DAY_BOTTOM, SKY_NIGHT_BOTTOM, night);
    env.training = !!s.training;

    // Simulation-driven effects
    this.crowd.update(dt);
    this.trackModels(s);
    this.updateTraining(s);

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    const p = this.proj;

    // Background
    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    // Base layer: slabs, floors, walls, windows, neon
    const wingCell = 1;
    drawFloor(c, L.W, L.D, 1, L.floorTone, L.floorAlt);
    if (L.hasWing) drawWingFloor(c, L.wingX, L.wingW, L.wingD, wingCell);
    if (L.garage) drawCarSpot(c, L.W - 2.9, 2.6, 2.4, 3.4);
    drawWalls(c, L.W, L.D, WALL_H, L.trim);
    if (L.hasWing) planeY(c, L.wingX, L.wingX + L.wingW, 0, 0, WALL_H, '#141414');
    for (const wx of L.windows) drawWindow(c, wx, 0.03, 1.6, env.skyTop, env.skyBottom);
    if (L.neonText) drawNeonSign(c, L.neonX, 0.04, 3.4, L.neonText, C.amber, t);
    drawNeonStrip(c, L.W, L.D, WALL_H, t);

    // Props + people, painter's order by x+y
    const people = this.crowd.people;
    const order = this.order;
    order.length = 0;
    for (const pl of people) order.push(pl);
    order.sort((a, b) => a.x + a.y - (b.x + b.y));

    const st = this.statics;
    let si = 0;
    for (const pe of order) {
      const key = pe.x + pe.y + 0.1;
      while (si < st.length && st[si].d <= key) {
        st[si].fn(c, t, env);
        si++;
      }
      const sitting = pe.state === 'sit';
      drawPerson(c, {
        x: pe.x,
        y: pe.y,
        role: pe.role,
        seed: pe.seed,
        sitting,
        typing: sitting,
        walkPhase: pe.state === 'walk' ? pe.walkPhase : 0,
        highlight: false,
        t,
      });
      const [sx, sy] = project(p, pe.x, pe.y, 14);
      pe.sx = sx;
      pe.sy = sy;
    }
    for (; si < st.length; si++) st[si].fn(c, t, env);

    // Night wash + additive lights
    if (night > 0.01) {
      g.fillStyle = `rgba(0,0,0,${(0.5 * night).toFixed(3)})`;
      g.fillRect(0, 0, this.cssW, this.cssH);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    if (night > 0.05) {
      for (const desk of L.desks) {
        const [lx, ly] = project(p, desk.x + 0.65, desk.y + 0.3, WALL_H - 14);
        glow(g, lx, ly, 26 * p.scale, '#fde68a', 0.05 * night);
      }
      for (const wx of L.windows) {
        const [lx, ly] = project(p, wx + 0.8, 0.05, 30);
        glow(g, lx, ly, 40 * p.scale, '#ffa630', 0.08 * night);
      }
    }
    if (env.training && L.hasWing) {
      const [wx, wy] = project(p, L.wingX + L.wingW / 2, L.wingD / 2, 30);
      glow(g, wx, wy, 90 * p.scale, C.amber, 0.22 + 0.08 * Math.sin(t * 2));
      glow(g, wx, wy + 20 * p.scale, 60 * p.scale, C.amberDim, 0.1);
    }
    g.restore();

    // Training label
    if (env.training) this.drawTrainingLabel(g, L, t);

    // Overflow bubble
    if (L.overflow > 0) {
      const [ox, oy] = project(p, DX0, L.D - 0.5, 0);
      drawPill(g, ox, oy, `+${L.overflow} more staff`, C.amber);
    }

    // Money floaters + confetti
    if (s.finance.dailyRevenue > 0 && L.salesDesks.length > 0) {
      const pts = L.salesDesks.map((d) => project(p, d.x + 0.65, d.y + 0.3, 30) as [number, number]);
      this.effects.money(pts, dt, true, '+$');
    } else {
      this.effects.money([], dt, false, '+$');
    }
    this.effects.step(g, dt);

    // HUD, bottom-right (top corners belong to the camera overlay in OfficeView)
    const gpus = L.gpus;
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(`${tierName(s)} · ${L.headcount} STAFF · ${gpus.toLocaleString()} GPUS`.toUpperCase(), this.cssW - 10, this.cssH - 8);
    if (s.finance.cash < 0) {
      const blink = Math.sin(t * 6) > 0 ? 1 : 0.35;
      g.globalAlpha = blink;
      g.fillStyle = C.red;
      g.font = '600 11px IBM Plex Mono, monospace';
      g.fillText('CASH NEGATIVE', this.cssW - 10, this.cssH - 24);
    }
    g.restore();
  }

  /** Confetti burst when a new model appears. */
  private trackModels(s: GameState): void {
    const n = s.models.length;
    if (this.lastModels >= 0 && n > this.lastModels) {
      this.effects.burst(this.cssW / 2, this.cssH * 0.3, 60);
    }
    this.lastModels = n;
  }

  private updateTraining(s: GameState): void {
    const tr = s.training;
    if (!tr) {
      this.trainLabel = '';
      this.trainPct = 0;
      return;
    }
    const pct = tr.totalFlops > 0 ? Math.min(1, Math.max(0, tr.doneFlops / tr.totalFlops)) : 0;
    this.trainPct = pct;
    this.trainLabel = `Training: ${tr.name} ${Math.round(pct * 100)}%`;
  }

  private drawTrainingLabel(g: CanvasRenderingContext2D, L: Layout, t: number): void {
    const p = this.proj;
    const [x, y] = L.hasWing
      ? project(p, L.wingX + L.wingW / 2, 0.8, WALL_H + 10)
      : project(p, L.W / 2, 0.8, WALL_H + 10);
    drawPill(g, x, y, this.trainLabel, C.amber, this.trainPct, t);
  }

  /** Hit-test people against the last drawn frame. */
  hitTest(mx: number, my: number): Person | null {
    const r = 14 * this.proj.scale;
    let best: Person | null = null;
    let bestD = r * r;
    for (const pe of this.crowd.people) {
      const dx = pe.sx - mx;
      const dy = pe.sy - my;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = pe;
      }
    }
    return best;
  }

  roleLabel(pe: Person): string {
    return `${ROLE_LABEL[pe.role] ?? pe.role} · desk ${pe.desk.index + 1}`;
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function drawWingFloor(c: Ctx, x0: number, W: number, D: number, cell: number): void {
  const nx = Math.ceil(W / cell);
  const ny = Math.ceil(D / cell);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      floorTile(c, x0 + i * cell, j * cell, Math.min(cell, W - i * cell), Math.min(cell, D - j * cell), (i + j) % 2 ? '#1c1b19' : '#211f1c');
    }
  }
}

/** Square terminal label in screen space: black box, amber hairline, optional solid progress rule. */
function drawPill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, progress?: number, t = 0): void {
  g.save();
  g.font = '600 11px IBM Plex Mono, monospace';
  const w = Math.ceil(g.measureText(text).width) + 16;
  const h = 20;
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
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
