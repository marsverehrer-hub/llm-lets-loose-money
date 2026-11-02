// Products scene: the player's live products as storefronts along one street, drawn from GameState every frame.
import type { GameState, Product, ProductKind } from '../../sim/types';
import { formatMoney, formatNumber } from '../../sim/util';
import { liveLines, unlockedProductKinds } from '../../sim/systems/products';
import { RESEARCH } from '../../sim/data/research';
import { project, type Projector } from '../../office/iso';
import { type Ctx, glow } from '../../office/draw/prims';
import { T, alpha, syncTheme } from '../../office/kit/theme';
import { type Box2, type HudPart, arrangePods, drawGround, feedMargins, fitTo, hud, tag } from '../../office/kit/frame';
import type { Scene, SceneHit } from '../types';
import {
  CAR_DY,
  DC_D,
  DC_W,
  DcSnap,
  KIND_LABEL,
  LOT_D,
  LOT_IN,
  LOT_W,
  Lot,
  POD_D,
  POD_W,
  dcIntake,
  drawCar,
  drawDown,
  drawFace,
  drawHall,
  drawLot,
  drawStreet,
  drawSuit,
  mood,
  shortNum,
} from './shops';

const KINDS_OF_LOT: ProductKind[] = ['chat', 'chat', 'api', 'api', 'enterprise', 'enterprise'];
const LOT_COUNT = KINDS_OF_LOT.length;
const MAX_COINS = 170;
const MAX_CARS = 8;
const CARS_PER_LOT = 2;
const CAR_SPEED = 4.2;
const CAR_PARK_DX = 1.8;
const CAR_UNLOAD_S = 2.4;
/** Tallest storefront plus its sign, and the pipe run above the roofs. */
const HMAX = 52;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const log10p = (v: number) => Math.log10(1 + Math.max(0, v));

interface StaticItem {
  d: number;
  fn: (c: Ctx, t: number) => void;
}

interface Coin {
  on: boolean;
  lot: number;
  rev: boolean;
  u: number;
  dur: number;
}

interface Car {
  on: boolean;
  lot: number;
  phase: 0 | 1 | 2;
  cx: number;
  t: number;
  seed: number;
}

interface Snapshot {
  sig: string;
  lots: Lot[];
  dc: DcSnap;
  box: Box2;
}

/** Total GPUs owned or rented, the same count the office uses. */
function totalGpus(s: GameState): number {
  let n = 0;
  for (const k in s.compute.rented) n += s.compute.rented[k] ?? 0;
  for (const dc of s.compute.datacenters) for (const k in dc.gpus) n += dc.gpus[k] ?? 0;
  return n;
}

function productIn(s: GameState, L: Lot): Product | undefined {
  if (!L.productId) return undefined;
  return s.products.find((p) => p.id === L.productId && p.active);
}

/** The layout and figures for the current state and frame (available CSS px). Pure function of its inputs. */
function snapshot(s: GameState, aw: number, ah: number): Snapshot {
  const unlocked = unlockedProductKinds(s);
  const lots: Lot[] = [];
  let sig = '';
  for (let i = 0; i < LOT_COUNT; i++) {
    const kind = KINDS_OF_LOT[i];
    const slot = i % 2;
    const p = liveLines(s, kind)[slot];
    const L: Lot = {
      index: i,
      kind,
      slot,
      x: 0,
      y: 0,
      state: p ? 'live' : unlocked.includes(kind) ? 'vacant' : 'locked',
      productId: p ? p.id : null,
      H: 0,
      count: 0,
      people: 0,
      mult: 0,
      drop: 0,
      speed: 0.4,
      seed: i * 11 + slot * 5,
    };
    if (p) {
      const users = p.users;
      const cost = p.servingCostPerDay ?? 0;
      const served = p.servedFraction;
      L.drop = served < 1 ? clamp(0.5 + 0.5 * (1 - served), 0.5, 1) : 0;
      L.speed = 0.25 + 0.6 * clamp(log10p(p.mtokPerDay) / 6, 0, 1);
      if (kind === 'chat') {
        L.H = 14 + 16 * clamp(log10p(users) / 7, 0, 1);
        L.count = users > 0 ? clamp(Math.round(2 + 1.8 * log10p(users)), 1, 12) : 0;
        L.mult = L.count > 0 && users / L.count > 1.5 ? users / L.count : 0;
      } else if (kind === 'api') {
        L.H = 16;
        L.count = clamp(1 + Math.round(log10p(cost) / 1.5), 1, 3);
        L.people = users > 0 ? clamp(Math.round(log10p(users)), 1, 3) : 0;
      } else {
        L.H = 26 + 18 * clamp(log10p(users) / 7, 0, 1);
      }
    }
    lots.push(L);
    sig += `${kind}${slot}${L.state}${L.productId ?? '-'}|${L.H.toFixed(1)}|${L.count}|${L.people}|${L.mult ? L.mult.toPrecision(1) : 0}|${L.drop.toFixed(2)}|${L.speed.toFixed(2)};`;
  }
  const gpus = totalGpus(s);
  const g = clamp(log10p(gpus) / 5, 0, 1);
  const dc: DcSnap = {
    x: 0,
    y: 0,
    racks: Math.min(18, 2 + Math.round(Math.log2(1 + gpus) * 0.8 * (0.6 + 0.4 * g))),
    label: gpus > 0 ? `${formatNumber(gpus, 1)} GPUs` : 'Rented cloud',
    training: !!s.training,
  };
  // Storefront pods across the frame, the datacenter last.
  const specs = lots.map((L) => ({ w: POD_W, d: POD_D, h: L.state === 'live' ? L.H + 6 : 14 }));
  specs.push({ w: DC_W, d: DC_D, h: HMAX });
  const plan = arrangePods(specs, aw, ah, 1.4, 1.2, 3);
  lots.forEach((L, i) => {
    L.x = plan.x[i] + LOT_IN;
    L.y = plan.y[i] + LOT_IN;
  });
  dc.x = plan.x[LOT_COUNT];
  dc.y = plan.y[LOT_COUNT];
  plan.box.y0 -= HMAX - 30;
  sig += `|dc${dc.racks}|${dc.label}|${dc.training}|${plan.rows}|${plan.x.join(',')}|${plan.y.join(',')}`;
  return { sig, lots, dc, box: plan.box };
}

/** Convex hull (monotone chain) of a flat [x0,y0,x1,y1,...] list. Returns a flat CCW-ish list. */
function convexHull(flat: number[]): number[] {
  const P: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) P.push([flat[i], flat[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const out: number[] = [];
  for (const p of lower.concat(upper)) out.push(p[0], p[1]);
  return out;
}

function insideConvex(h: number[], x: number, y: number): boolean {
  const n = h.length / 2;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = (h[2 * j] - h[2 * i]) * (y - h[2 * i + 1]) - (h[2 * j + 1] - h[2 * i + 1]) * (x - h[2 * i]);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

export class ProductsScene implements Scene {
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private cssW = 1;
  private cssH = 1;
  private time = 0;
  private sigTimer = 0;
  private sig = '';
  private box: Box2 = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private lots: Lot[] = [];
  private dc: DcSnap = { x: 0, y: 0, racks: 2, label: '', training: false };
  private statics: StaticItem[] = [];
  private hulls: number[][] = [];
  private last: GameState | null = null;
  private coins: Coin[] = Array.from({ length: MAX_COINS }, () => ({ on: false, lot: 0, rev: true, u: 0, dur: 1 }));
  private cars: Car[] = Array.from({ length: MAX_CARS }, () => ({ on: false, lot: 0, phase: 0 as const, cx: 0, t: 0, seed: 0 }));
  private carT: number[] = new Array(LOT_COUNT).fill(0);
  private accRev: number[] = new Array(LOT_COUNT).fill(0);
  private accSrv: number[] = new Array(LOT_COUNT).fill(0);
  private flash: number[] = new Array(LOT_COUNT).fill(0);
  private marginColor: string[] = new Array(LOT_COUNT).fill('#888888');
  private tagRects: { box: Box2; lot: number }[] = [];

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.sigTimer = 0;
    this.fit();
    this.rebuildHulls();
  }

  /** Auto-fit camera on the storefront pods. */
  private fit(): void {
    fitTo(this.proj, this.box, this.cssW, this.cssH);
  }

  private rebuildHulls(): void {
    this.hulls = [];
    for (const L of this.lots) {
      const top = L.state === 'live' ? L.H + 10 : 16;
      const pts: number[] = [];
      for (const x of [L.x, L.x + LOT_W]) {
        for (const y of [L.y, L.y + LOT_D]) {
          for (const z of [0, top]) {
            const [sx, sy] = project(this.proj, x, y, z);
            pts.push(sx, sy);
          }
        }
      }
      this.hulls.push(convexHull(pts));
    }
  }

  private rebuild(snap: Snapshot): void {
    this.sig = snap.sig;
    this.lots = snap.lots;
    this.dc = snap.dc;
    this.box = snap.box;
    this.fit();
    const items: StaticItem[] = [];
    const dc = this.dc;
    items.push({ d: dc.x + dc.y, fn: (c, t) => drawHall(c, dc, t) });
    for (const L of this.lots) {
      items.push({ d: L.x + L.y - 0.01, fn: (c) => drawStreet(c, L) });
      items.push({ d: L.x + L.y, fn: (c, t) => drawLot(c, L, t) });
    }
    items.sort((a, b) => a.d - b.d);
    this.statics = items;
    this.rebuildHulls();
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, nowMs: number): void {
    syncTheme(nowMs);
    this.last = s;
    this.time += dt;
    const t = this.time;
    this.sigTimer -= dt;
    if (this.sigTimer <= 0 || this.statics.length === 0) {
      this.sigTimer = 0.25;
      const m = feedMargins(this.cssW, this.cssH);
      const snap = snapshot(s, Math.max(40, this.cssW - m.l - m.r), Math.max(40, this.cssH - m.t - m.b));
      if (snap.sig !== this.sig || this.statics.length === 0) this.rebuild(snap);
    }
    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    drawGround(g, this.proj, this.cssW, this.cssH);

    for (const it of this.statics) it.fn(c, t);

    this.updateCars(s, dt);
    this.drawCars(c, t);
    this.updateFlows(s, dt);
    this.drawPipes(c, s);
    this.drawCoins(c);
    this.drawOverlays(c, s, t);
  }

  /* ---------- cars and suits ---------- */

  private updateCars(s: GameState, dt: number): void {
    for (let i = 0; i < LOT_COUNT; i++) {
      const L = this.lots[i];
      if (!L || L.kind !== 'enterprise') continue;
      const p = productIn(s, L);
      if (!p) {
        this.carT[i] = 0;
        continue;
      }
      this.carT[i] -= dt;
      if (this.carT[i] <= 0) {
        const active = this.cars.filter((k) => k.on && k.lot === i).length;
        const car = this.cars.find((k) => !k.on);
        if (car && active < CARS_PER_LOT) {
          car.on = true;
          car.lot = i;
          car.phase = 0;
          car.cx = L.x - LOT_IN + 0.8;
          car.t = 0;
          car.seed = i * 7 + Math.floor(this.time * 13) % 97;
        }
        // Busier products send cars more often (log scale, a car every 1.2 to 7 s).
        this.carT[i] = clamp(7 - 1.3 * log10p(p.users), 1.2, 7);
      }
    }
    for (const car of this.cars) {
      if (!car.on) continue;
      const L = this.lots[car.lot];
      if (!L) {
        car.on = false;
        continue;
      }
      const park = L.x + CAR_PARK_DX;
      if (car.phase === 0) {
        car.cx += CAR_SPEED * dt;
        if (car.cx >= park) {
          car.cx = park;
          car.phase = 1;
          car.t = 0;
        }
      } else if (car.phase === 1) {
        car.t += dt;
        if (car.t >= CAR_UNLOAD_S) {
          car.phase = 2;
          car.t = 0;
        }
      } else {
        car.cx += CAR_SPEED * dt;
        if (car.cx > L.x + LOT_W + 0.2) car.on = false;
      }
    }
  }

  private drawCars(c: Ctx, t: number): void {
    for (const car of this.cars) {
      if (!car.on) continue;
      const L = this.lots[car.lot];
      if (!L) continue;
      const fade = clamp((car.cx - (L.x - LOT_IN + 0.8)) / 0.6, 0, 1) * clamp((L.x + LOT_W + 0.2 - car.cx) / 0.6, 0, 1);
      c.g.globalAlpha = fade;
      drawCar(c, car.cx, L.y + CAR_DY, car.seed);
      c.g.globalAlpha = 1;
      if (car.phase === 1 && car.t > 0.3 && car.t < 2.1) {
        // Suit steps out at the kerb and walks into the lobby door.
        const u = clamp((car.t - 0.3) / 1.8, 0, 1);
        const y = L.y + 4.1 + (2.55 - 4.1) * u;
        drawSuit(c, car.cx, y, car.seed + 3, t);
      }
    }
  }

  /* ---------- flows: revenue into the tills, serving out to the datacenter ---------- */

  private tillOf(L: Lot): [number, number, number] {
    if (L.kind === 'chat') return [L.x + LOT_W - 0.67, L.y + 2.2, 6.5];
    if (L.kind === 'api') return [L.x + 1.5, L.y + 2.3, 14.5];
    return [L.x + 0.9, L.y + 2.7, 4.5];
  }

  private sourceOf(L: Lot): [number, number, number] {
    if (L.kind === 'chat') return [L.x + 1.6, L.y + 2.95, 8];
    if (L.kind === 'api') return [L.x + 0.95, L.y + 3.15, 10];
    return [L.x + 1.8, L.y + 2.6, 4];
  }

  /** Height of a lot's pipe run, above every roof. */
  private pipeZ(L: Lot): number {
    return HMAX - 4 + L.index * 1.2;
  }

  /** Where a lot's serving pipe runs: up from the till, then across to the datacenter intake. */
  private pipePts(L: Lot): [number, number, number][] {
    const [tx, ty, tz] = this.tillOf(L);
    const z = this.pipeZ(L);
    const [ix, iy, iz] = dcIntake(this.dc);
    return [
      [tx, ty, tz],
      [tx, ty, z],
      [ix, iy + (L.index - 2.5) * 0.25, z],
      [ix, iy + (L.index - 2.5) * 0.25, iz - 6],
    ];
  }

  private spawn(lot: number, rev: boolean): void {
    for (const k of this.coins) {
      if (k.on) continue;
      k.on = true;
      k.lot = lot;
      k.rev = rev;
      k.u = 0;
      k.dur = rev ? 1.2 : 2.6;
      return;
    }
  }

  private updateFlows(s: GameState, dt: number): void {
    for (const k of this.coins) {
      if (!k.on) continue;
      k.u += dt / k.dur;
      if (k.u >= 1) {
        k.on = false;
        if (k.rev) this.flash[k.lot] = 0.25;
      }
    }
    for (let i = 0; i < LOT_COUNT; i++) {
      this.flash[i] = Math.max(0, this.flash[i] - dt);
      const L = this.lots[i];
      const p = L ? productIn(s, L) : undefined;
      if (!L || !p) {
        this.accRev[i] = 0;
        this.accSrv[i] = 0;
        continue;
      }
      const rev = p.revenuePerDay ?? 0;
      const cost = p.servingCostPerDay ?? 0;
      const margin = rev - cost;
      this.marginColor[i] = margin > 0 ? T.up : margin < 0 ? T.down : T.fg2;
      // Coins per second on a log scale: a few for small products, about three a second for the largest.
      const rr = rev > 0 ? clamp(0.6 * log10p(rev) - 1.2, 0, 6) : 0;
      const sr = cost > 0 ? clamp(0.5 * log10p(cost) - 0.6, 0, 4) : 0;
      this.accRev[i] = Math.min(3, this.accRev[i] + rr * dt);
      this.accSrv[i] = Math.min(3, this.accSrv[i] + sr * dt);
      while (this.accRev[i] >= 1) {
        this.accRev[i] -= 1;
        this.spawn(i, true);
      }
      while (this.accSrv[i] >= 1) {
        this.accSrv[i] -= 1;
        this.spawn(i, false);
      }
    }
  }

  /** Pipe runs from each till up to an overhead bus and back to the datacenter wall. */
  private drawPipes(c: Ctx, s: GameState): void {
    const { g, p } = c;
    for (let i = 0; i < LOT_COUNT; i++) {
      const L = this.lots[i];
      if (!L || !productIn(s, L)) continue;
      const pts = this.pipePts(L).map(([x, y, z]) => project(p, x, y, z));
      g.save();
      g.strokeStyle = alpha(this.marginColor[i], 0.45);
      g.lineWidth = Math.max(1, 1.1 * p.scale);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.stroke();
      g.fillStyle = this.marginColor[i];
      g.fillRect(pts[1][0] - 1.5, pts[1][1] - 1.5, 3, 3);
      g.restore();
    }
  }

  private drawCoins(c: Ctx): void {
    const { g, p } = c;
    for (const k of this.coins) {
      if (!k.on) continue;
      const L = this.lots[k.lot];
      if (!L) continue;
      const till = this.tillOf(L);
      let x: number;
      let y: number;
      let z: number;
      if (k.rev) {
        const src = this.sourceOf(L);
        const u = k.u;
        x = src[0] + (till[0] - src[0]) * u;
        y = src[1] + (till[1] - src[1]) * u;
        z = src[2] + (till[2] - src[2]) * u + Math.sin(Math.PI * u) * 14;
      } else {
        // Along the pipe: up (first 20%), across (next 70%), down into the datacenter.
        const P = this.pipePts(L);
        const seg = k.u < 0.2 ? 0 : k.u < 0.9 ? 1 : 2;
        const v = seg === 0 ? k.u / 0.2 : seg === 1 ? (k.u - 0.2) / 0.7 : (k.u - 0.9) / 0.1;
        const a = P[seg];
        const b = P[seg + 1];
        x = a[0] + (b[0] - a[0]) * v;
        y = a[1] + (b[1] - a[1]) * v;
        z = a[2] + (b[2] - a[2]) * v;
      }
      const [sx, sy] = project(p, x, y, z);
      const r = Math.max(1.3, 1.7 * p.scale);
      g.fillStyle = k.rev ? T.hl : this.marginColor[k.lot];
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < LOT_COUNT; i++) {
      if (this.flash[i] <= 0) continue;
      const L = this.lots[i];
      if (!L) continue;
      const [tx, ty, tz] = this.tillOf(L);
      const [sx, sy] = project(p, tx, ty, tz);
      glow(g, sx, sy, 10 * p.scale, T.hl, 0.6 * (this.flash[i] / 0.25));
    }
  }

  /* ---------- screen-space overlays: faces, outage boards, margin lights, HUD ---------- */

  private drawOverlays(c: Ctx, s: GameState, t: number): void {
    const { g, p } = c;
    let liveN = 0;
    let margin = 0;
    this.tagRects = [];
    const small = this.cssW < 520;
    for (let i = 0; i < LOT_COUNT; i++) {
      const L = this.lots[i];
      if (!L) continue;
      const pr = productIn(s, L);
      // Tag on the lot's left corner: the product (in its margin colour) or what the empty lot is for.
      const [lx, ly] = project(p, L.x - LOT_IN + 0.2, L.y - LOT_IN + POD_D - 0.2, 0);
      if (pr) {
        const name = small && pr.name.length > 12 ? `${pr.name.slice(0, 11)}.` : pr.name.length > 20 ? `${pr.name.slice(0, 19)}.` : pr.name;
        const box = tag(g, lx, ly, name, this.marginColor[i], { value: shortNum(pr.users), size: small ? 9.5 : 10.5, align: 'left', anchor: 'center' });
        this.tagRects.push({ box, lot: i });
      } else if (!small) {
        const box = tag(g, lx, ly, `${KIND_LABEL[L.kind]} lot`, L.state === 'locked' ? T.fg4 : T.fg3, { size: 10, align: 'left', anchor: 'center', alpha: 0.8 });
        this.tagRects.push({ box, lot: i });
      }
      if (!pr) continue;
      liveN++;
      const rev = pr.revenuePerDay ?? 0;
      const cost = pr.servingCostPerDay ?? 0;
      margin += rev - cost;
      const frontY = L.kind === 'chat' ? L.y + 2.0 : L.kind === 'api' ? L.y + 1.4 : L.y + 2.4;
      const top = L.H;
      // Satisfaction face at the building's top corner.
      const [fx, fy] = project(p, L.x + LOT_W - 0.1, frontY, top + 4);
      drawFace(g, fx, fy, Math.max(4.5, 5.5 * p.scale), pr.satisfaction);
      if (L.drop > 0) {
        const [dx, dy] = project(p, L.x + LOT_W / 2, L.y + 1.0, top + 9);
        drawDown(g, dx, dy, t);
      }
    }
    // Datacenter tag on its left corner.
    const dc = this.dc;
    const [dx, dy] = project(p, dc.x, dc.y + DC_D, 40);
    tag(g, dx - 2, dy - 3, small ? 'DC' : 'Datacenter', T.up, { value: dc.label, size: small ? 9.5 : 10.5, align: 'left' });
    const parts: HudPart[] =
      liveN === 0
        ? [['No live products', T.fg3]]
        : [
            [`${liveN} live`, T.fg],
            [`Margin ${margin >= 0 ? '+' : ''}${formatMoney(margin)}/day`, margin >= 0 ? T.up : T.down],
          ];
    hud(g, this.cssW, this.cssH, parts);
  }

  /* ---------- hit testing and tips ---------- */

  hitTest(x: number, y: number): SceneHit | null {
    const s = this.last;
    if (!s) return null;
    const onTag = this.tagRects.find((r) => x >= r.box.x0 && x <= r.box.x1 && y >= r.box.y0 && y <= r.box.y1);
    for (let i = this.hulls.length - 1; i >= -1; i--) {
      if (i === -1 && !onTag) break;
      if (i >= 0 && !insideConvex(this.hulls[i], x, y)) continue;
      const L = this.lots[i >= 0 ? i : (onTag as { lot: number }).lot];
      if (!L) return null;
      const p = productIn(s, L);
      if (p) return { id: `product:${p.id}`, label: productTip(s, p) };
      return { id: `lot:${L.kind}`, label: lotTip(s, L) };
    }
    return null;
  }
}

const KIND_NAME: Record<ProductKind, string> = { chat: 'Chat', api: 'API', enterprise: 'Enterprise' };
const UNIT: Record<ProductKind, string> = { chat: '/user/mo', api: '/M tokens', enterprise: '/seat/mo' };

function productTip(s: GameState, p: Product): string {
  const model = s.models.find((m) => m.id === p.modelId)?.name ?? 'no model';
  const rev = p.revenuePerDay ?? 0;
  const cost = p.servingCostPerDay ?? 0;
  const margin = rev - cost;
  const lines = [
    p.name,
    `${KIND_NAME[p.kind]} on ${model}`,
    `Users: ${formatNumber(p.users, 1)}`,
    `Price: $${p.price.toFixed(2)} ${UNIT[p.kind]}`,
    `Revenue: ${formatMoney(rev)}/day`,
    `Serving: ${formatMoney(cost)}/day`,
    `Margin: ${margin >= 0 ? '+' : ''}${formatMoney(margin)}/day`,
    `Satisfaction: ${Math.round(p.satisfaction)} (${mood(p.satisfaction)})`,
  ];
  if (p.servedFraction < 1) lines.push(`OUTAGE: serving ${Math.round(p.servedFraction * 100)}% of demand`);
  return lines.join('\n');
}

function lotTip(s: GameState, L: Lot): string {
  const kind = L.kind;
  if (L.state === 'locked') {
    const research = RESEARCH.find((r) => r.unlocksProduct === kind);
    return `${KIND_LABEL[kind]} lot, locked\nResearch ${research ? `"${research.name}"` : 'the next research'} to open it`;
  }
  if (L.slot === 1 && liveLines(s, kind).length >= 1) {
    return `Empty second ${KIND_LABEL[kind]} lot\nLaunch a second ${KIND_LABEL[kind]} line (half the launch fee)`;
  }
  return `Empty ${KIND_LABEL[kind]} lot\nLaunch a ${KIND_LABEL[kind]} product here`;
}

