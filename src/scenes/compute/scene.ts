// Compute scene: the player's compute as an isometric datacenter, framed like the HQ office camera (src/office).
// Reads GameState every frame. Layout rebuilds only when its signature changes, and screen paths only when the camera
// fit changes. Drawables are sorted by a group key (draw order of the halls) and walkers are merged in by depth.
import type { FleetBreakdown, GameState } from '../../sim/types';
import { DATACENTER_TIERS } from '../../sim/data/gpus';
import { fleetFor, gpuById, priorityOf, rentMultiplier, runActive } from '../../sim/systems/compute';
import { formatMoney } from '../../sim/util';
import { TILE_H, TILE_W, prand, project, type Projector } from '../../office/iso';
import { C } from '../../office/palette';
import { drawPerson } from '../../office/draw/person';
import type { Ctx } from '../../office/draw/prims';
import { glow } from '../../office/draw/prims';
import type { Scene, SceneHit } from '../types';
import {
  CLOUD_TOP,
  CLOUD_Z,
  LEDS,
  POD_H,
  PRODUCT_H,
  buildLayout,
  engineersOf,
  installedOf,
  rentedOf,
  type HallLayout,
  type Layout,
  type RackDraw,
} from './layout';
import {
  drawBurstCloud,
  drawCloudPlatform,
  drawCloudShadow,
  drawFlow,
  drawHallFloor,
  drawHallWalls,
  drawLabel,
  drawPill,
  drawPodSlab,
  drawProducts,
  drawRack,
  drawScaffold,
  refreshRack,
  burstCenter,
  type Frame,
} from './draw';

interface Item {
  key: number;
  fn: (c: Ctx, f: Frame) => void;
}

interface Walker {
  seed: number;
  group: number;
  hall: HallLayout | null;
  lane: number;
  phase: number;
  x: number;
  y: number;
  walk: number;
  key: number;
}

interface Box {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Sort key: group (draw order), then the local depth x + y, offset so it stays positive. */
const key = (group: number, local: number): number => group * 10000 + local + 2000;
const MAX_WALKERS = 24;
const FRONT_WALK_GROUP = 1002;
const POD_GROUP = 1000;
const PRODUCT_GROUP = 1001;
const CLOUD_GROUP = -1;

function fleetOf(s: GameState): FleetBreakdown {
  return s.compute.fleet ?? fleetFor(s, priorityOf(s), runActive(s));
}

/** Changes whenever the drawn structure changes. Checked a few times a second. */
function sigOf(s: GameState, fleet: FleetBreakdown): string {
  let sig = '';
  for (const dc of s.compute.datacenters) {
    sig += `${dc.id}.${dc.tierId}.${dc.buildDaysLeft > 0 ? 'b' : 'o'}.${installedOf(dc)};`;
  }
  const live = s.products.filter((p) => p.active).length;
  sig += `|r${rentedOf(s)}|t${s.training ? Math.round(fleet.trainingGpus) : -1}|b${fleet.burstPflops > 1e-6 ? 1 : 0}`;
  sig += `|p${s.products.length}:${live}|e${engineersOf(s)}`;
  return sig;
}

/** Counts, rounded with separators. */
const cnt = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');
/** Rates and PFLOP/s: keep small numbers readable. */
const rate = (n: number): string => {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n).toLocaleString('en-US');
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
};
const money = (v: number, digits = 1): string => formatMoney(v, digits);

function hallTip(h: HallLayout, s: GameState, f: FleetBreakdown): string {
  const tier = DATACENTER_TIERS.find((t) => t.id === h.dc.tierId);
  const slots = tier?.maxGpus ?? 0;
  const head = `${h.dc.name} · ${h.tierName}`;
  if (!h.built) {
    return [
      head,
      `Under construction: ${Math.ceil(h.dc.buildDaysLeft)} days left`,
      `Room for ${cnt(slots)} GPUs once online`,
      `Upkeep ${money(tier?.upkeepPerDay ?? 0)}/day once online`,
    ].join('\n');
  }
  let pflops = 0;
  let power = 0;
  const models: [string, number][] = [];
  for (const [gid, n] of Object.entries(h.dc.gpus)) {
    const gpu = gpuById(gid);
    if (!gpu || n <= 0) continue;
    pflops += n * gpu.pflops;
    power += n * gpu.powerKw * 24 * (tier?.powerPricePerKwh ?? 0);
    models.push([gpu.name, n]);
  }
  models.sort((a, b) => b[1] - a[1]);
  const modelLine = models.length
    ? models
        .slice(0, 3)
        .map(([name, n]) => `${name} ×${cnt(n)}`)
        .join(', ')
    : 'No GPUs installed yet';
  const tot = f.totalGpus;
  const fT = tot > 0 ? f.trainingGpus / tot : 0;
  const fS = tot > 0 ? f.servingGpus / tot : 0;
  const fI = tot > 0 ? f.idleGpus / tot : 0;
  const racks = `${cnt(h.racks.length)} racks${h.rackSize > 1 ? ` (×${cnt(h.rackSize)} GPUs each)` : ''}`;
  return [
    head,
    `${cnt(h.installed)} of ${cnt(slots)} GPU slots · ${racks}`,
    modelLine,
    `${rate(pflops)} PFLOP/s`,
    `Mix here: ${cnt(h.installed * fT)} training · ${cnt(h.installed * fS)} serving · ${cnt(h.installed * fI)} idle`,
    `Upkeep ${money(tier?.upkeepPerDay ?? 0)}/day · power ${money(power)}/day`,
  ].join('\n');
}

export class ComputeScene implements Scene {
  private cssW = 0;
  private cssH = 0;
  private readonly proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private readonly ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private readonly frame: Frame = { t: 0, nA: 0, nB: 0, training: false };
  private lay: Layout | null = null;
  private sig = '';
  private sigTimer = 0;
  private items: Item[] = [];
  private racks: RackDraw[] = [];
  private walkers: Walker[] = [];
  private boxes: Box[] = [];
  private state: GameState | null = null;
  private time = 0;

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
  }

  /** Fit the world into the canvas (CSS px) and centre it. */
  private fit(): void {
    const L = this.lay;
    if (!L) return;
    const b = L.bounds;
    const pad = 12;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const span = b.xmax - b.xmin + (b.ymax - b.ymin);
    const zTop = Math.max(1, b.zmax);
    const s = Math.min(availW / ((span * TILE_W) / 2), availH / ((span * TILE_H) / 2 + zTop), 2.6);
    const sc = Math.max(0.2, s);
    const cx = (b.xmin + b.xmax) / 2;
    const cy = (b.ymin + b.ymax) / 2;
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - ((cx - cy) * TILE_W) / 2 * sc;
    this.proj.oy = this.cssH / 2 - (((cx + cy) * TILE_H) / 2 - zTop / 2) * sc;
    this.refreshScreen();
  }

  /** Screen paths for racks and the hit boxes. Runs after every fit and layout rebuild. */
  private refreshScreen(): void {
    const L = this.lay;
    if (!L) return;
    const p = this.proj;
    for (const r of this.racks) refreshRack(p, r);
    const boxes: Box[] = [];
    if (L.cloud && L.cloud.rentedGpus > 0) {
      const cl = L.cloud;
      boxes.push(this.boxOf('cloud:rented', [cl.x0, cl.y0, cl.x0 + cl.w, cl.y0 + cl.d], CLOUD_Z - 4, CLOUD_TOP));
    }
    for (const h of L.halls) {
      const top = h.look.wallH + (h.look.style === 'cathedral' ? 20 : 0);
      boxes.push(this.boxOf(`dc:${h.dc.id}`, [h.x0, h.y0, h.x0 + h.w, h.y0 + h.d], 0, top));
    }
    if (L.pod) {
      const pod = L.pod;
      boxes.push(this.boxOf('training', [pod.x0, pod.y0, pod.x0 + pod.w, pod.y0 + pod.d], 0, POD_H));
    }
    if (L.cloud && L.cloud.burst) {
      const [wx, wy, wz] = burstCenter(L.cloud);
      const [cx, cy] = project(p, wx, wy, wz);
      const s = p.scale;
      boxes.push({ id: 'cloud:burst', x0: cx - 32 * s, y0: cy - 28 * s, x1: cx + 32 * s, y1: cy + 16 * s });
    }
    this.boxes = boxes;
  }

  private boxOf(id: string, r: [number, number, number, number], z0: number, z1: number): Box {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const [ax, ay, bx, by] = r;
    for (const x of [ax, bx]) {
      for (const y of [ay, by]) {
        for (const z of [z0, z1]) {
          const [sx, sy] = project(this.proj, x, y, z);
          if (sx < x0) x0 = sx;
          if (sx > x1) x1 = sx;
          if (sy < y0) y0 = sy;
          if (sy > y1) y1 = sy;
        }
      }
    }
    return { id, x0, y0, x1, y1 };
  }

  /** Rebuild layout, draw items and walkers. Called when the signature changes. */
  private rebuild(s: GameState, fleet: FleetBreakdown, sig: string): void {
    const L = buildLayout(s, fleet);
    this.lay = L;
    this.sig = sig;
    this.racks = [];
    this.items = [];
    for (const h of L.halls) {
      if (h.built) {
        this.items.push({ key: key(h.group, -1000), fn: (c) => drawHallWalls(c, h) });
        for (const r of h.racks) {
          this.racks.push(r);
          this.items.push({ key: key(h.group, r.x + r.y), fn: (c, f) => drawRack(c, r, f) });
        }
      } else {
        this.items.push({ key: key(h.group, -500), fn: (c) => drawScaffold(c, h) });
      }
    }
    if (L.cloud) {
      const cl = L.cloud;
      this.items.push({ key: key(CLOUD_GROUP, -1000), fn: (c) => drawCloudPlatform(c, cl) });
      for (const r of cl.racks) {
        this.racks.push(r);
        this.items.push({ key: key(CLOUD_GROUP, r.x + r.y), fn: (c, f) => drawRack(c, r, f) });
      }
    }
    if (L.pod) {
      for (const r of L.pod.racks) {
        this.racks.push(r);
        this.items.push({ key: key(POD_GROUP, r.x + r.y), fn: (c, f) => drawRack(c, r, f) });
      }
    }
    if (L.products) {
      const pr = L.products;
      this.items.push({ key: key(PRODUCT_GROUP, -1000), fn: (c, f) => drawProducts(c, pr, f) });
    }
    this.items.sort((a, b) => a.key - b.key);
    this.walkers = this.makeWalkers(L);
    this.fit();
  }

  private makeWalkers(L: Layout): Walker[] {
    const n = Math.min(MAX_WALKERS, L.engineers);
    const built = L.halls.filter((h) => h.built);
    const out: Walker[] = [];
    for (let e = 0; e < n; e++) {
      const seed = (e * 37 + 11) % 997;
      const phase = prand(e * 12.9 + 3);
      if (built.length) {
        const h = built[e % built.length];
        const lane = Math.floor(e / built.length) % h.laneX.length;
        out.push({ seed, group: h.group, hall: h, lane, phase, x: 0, y: 0, walk: 0, key: 0 });
      } else {
        out.push({ seed, group: FRONT_WALK_GROUP, hall: null, lane: 0, phase, x: 0, y: 0, walk: 0, key: 0 });
      }
    }
    return out;
  }

  /** Engineers walk the aisles of the finished halls, back and forth. With no hall, they walk the front. */
  private updateWalkers(L: Layout, t: number): void {
    for (const w of this.walkers) {
      if (w.hall) {
        const h = w.hall;
        const a = h.y0 + 0.5;
        const b = h.y0 + h.d - 0.5;
        const speed = 0.5 / (2 * (b - a));
        const u = frac(t * speed + w.phase);
        w.x = h.laneX[w.lane] + 0.05 * ((w.seed % 3) - 1);
        w.y = a + (b - a) * (1 - Math.abs(2 * u - 1));
      } else {
        const u = frac(t * 0.35 + w.phase);
        w.x = 0.5 + (1 - Math.abs(2 * u - 1)) * 10;
        w.y = L.frontY + (w.seed % 2) * 0.5;
      }
      w.walk = t * 5.5 + w.phase * 6.28 + 0.2;
      w.key = key(w.group, w.x + w.y + 0.1);
    }
    this.walkers.sort((a, b) => a.key - b.key);
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.time += dt;
    const t = this.time;
    this.state = s;
    const fleet = fleetOf(s);
    this.sigTimer -= dt;
    if (!this.lay || this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      const sig = sigOf(s, fleet);
      if (!this.lay || sig !== this.sig) this.rebuild(s, fleet, sig);
    }
    const L = this.lay as Layout;

    // Fleet mix for the LEDs: the rack rows are split between training (amber), serving (blue) and idle (dark).
    const f = this.frame;
    f.t = t;
    f.training = !!s.training;
    const tot = fleet.totalGpus;
    let nA = tot > 0 ? Math.round((fleet.trainingGpus / tot) * LEDS) : 0;
    let nB = tot > 0 ? Math.round((fleet.servingGpus / tot) * LEDS) : 0;
    nA = Math.max(0, Math.min(LEDS, nA));
    nB = Math.max(0, Math.min(LEDS - nA, nB));
    f.nA = nA;
    f.nB = nB;

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    // Ground: slabs, pads and shadows.
    for (const h of L.halls) drawHallFloor(c, h);
    if (L.cloud) drawCloudShadow(c, L.cloud);
    if (L.pod) drawPodSlab(c, L.pod.x0, L.pod.y0, L.pod.w, L.pod.d);
    if (L.products) {
      const pr = L.products;
      drawPodSlab(c, pr.x0, pr.y0, pr.w, pr.d);
    }

    // Walkers merged into the sorted items by depth.
    this.updateWalkers(L, t);
    const people = this.walkers;
    let pi = 0;
    for (const it of this.items) {
      while (pi < people.length && people[pi].key < it.key) {
        this.drawWalker(c, people[pi], t);
        pi++;
      }
      it.fn(c, f);
    }
    for (; pi < people.length; pi++) this.drawWalker(c, people[pi], t);

    this.drawOverlay(g, L, s, fleet, t);
  }

  private drawWalker(c: Ctx, w: Walker, t: number): void {
    drawPerson(c, {
      x: w.x,
      y: w.y,
      role: 'engineer',
      seed: w.seed,
      sitting: false,
      typing: false,
      walkPhase: w.walk,
      highlight: false,
      t,
    });
  }

  /** Lights, flows, labels and the HUD. Drawn after the sorted items. */
  private drawOverlay(g: CanvasRenderingContext2D, L: Layout, s: GameState, fleet: FleetBreakdown, t: number): void {
    const p = this.proj;
    const sc = p.scale;

    g.save();
    g.globalCompositeOperation = 'lighter';
    if (L.pod) {
      const [px, py] = project(p, L.pod.x0 + L.pod.w / 2, L.pod.y0 + L.pod.d / 2, POD_H * 0.6);
      glow(g, px, py, 110 * sc, C.amber, 0.14 + 0.07 * Math.sin(t * 2.2));
    }
    g.restore();

    // Flows into the product side: own GPUs serving (blue) and cloud burst (grey dashes).
    if (L.products) {
      const pr = L.products;
      const [tx, ty] = project(p, pr.x0 + pr.w / 2, pr.y0 + pr.d / 2, PRODUCT_H + 2);
      if (fleet.servingPflops > 0) {
        let src: HallLayout | null = null;
        for (const h of L.halls) if (h.built && (!src || h.x0 > src.x0)) src = h;
        if (src) {
          const [ax, ay] = project(p, src.x0 + src.w / 2, src.y0 + src.d / 2, src.look.wallH + 4);
          drawFlow(g, p, ax, ay, tx, ty, C.blue, t, 0.0);
        }
      }
      if (L.cloud && L.cloud.burst) {
        const [wx, wy, wz] = burstCenter(L.cloud);
        const [ax, ay] = project(p, wx, wy, wz);
        drawFlow(g, p, ax, ay, tx, ty, C.fgDim, t, 0.5);
      }
    }
    if (L.cloud && L.cloud.burst) drawBurstCloud(g, p, L.cloud, t);

    // Labels: pod pill, cloud, cluster sizes, scaffolds, products, overflow and the empty state.
    // Captions are small: on a phone-sized canvas they would only be noise, so they drop out there.
    const captions = sc >= 0.4;
    const pod = L.pod;
    const run = s.training;
    if (pod && run) {
      const pct = run.totalFlops > 0 ? Math.min(1, Math.max(0, run.doneFlops / run.totalFlops)) : 0;
      // The run's pill hangs over the front of the pod.
      const [px, py] = project(p, pod.x0 + pod.w / 2, pod.y0 + pod.d + 0.4, POD_H + 6);
      drawPill(g, px, py, `Training ${run.name} ${Math.round(pct * 100)}%`, C.amber, pct, t);
    }
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const h of L.halls) {
      if (h.built) {
        if (captions && h.rackSize > 1) {
          const [lx, ly] = project(p, h.x0 + h.w / 2, h.y0 + h.d + 0.35, 0);
          drawLabel(g, lx, ly, `×${cnt(h.rackSize)}/rack`, C.fgDim);
        }
      } else {
        const [lx, ly] = project(p, h.x0 + h.w / 2, h.y0 + h.d / 2, h.look.wallH + 8);
        g.font = '600 10px IBM Plex Mono, monospace';
        drawLabel(g, lx, ly, `building · ${Math.ceil(h.dc.buildDaysLeft)}d left`, C.amber);
        g.font = '10px IBM Plex Mono, monospace';
      }
    }
    if (captions && L.cloud && L.cloud.rentedGpus > 0) {
      const cl = L.cloud;
      const [lx, ly] = project(p, cl.x0 + cl.w / 2, cl.y0 + cl.d + 0.5, CLOUD_Z + 1);
      drawLabel(g, lx, ly, `cloud rental · ${cnt(cl.rentedGpus)} GPUs`, C.fgDim);
    }
    if (captions && L.products) {
      const pr = L.products;
      const [lx, ly] = project(p, pr.x0 + pr.w / 2, pr.y0 + pr.d / 2, PRODUCT_H + 4);
      drawLabel(g, lx, ly, `products · ${cnt(pr.live)} live`, C.fgDim);
    }
    g.restore();

    const extra = L.engineers - MAX_WALKERS;
    if (extra > 0) {
      // On the ground between the pod and the products, clear of the run pill.
      const [ox, oy] = pod
        ? project(p, pod.x0 + pod.w + 1.2, pod.y0 + pod.d + 0.6, 0)
        : project(p, 0, L.frontY + 1.4, 0);
      drawPill(g, ox, oy, `+${cnt(extra)} more engineers`, C.amber);
    }
    const empty = L.halls.length === 0 && !L.pod && !L.cloud && !L.products;
    if (empty) {
      const [ex, ey] = project(p, (L.bounds.xmin + L.bounds.xmax) / 2, (L.bounds.ymin + L.bounds.ymax) / 2, 0);
      drawPill(g, ex, ey, 'no datacenters yet', C.amber);
    }

    // HUD, bottom right (like the office).
    const gpus = Math.round(fleet.totalGpus);
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(`${cnt(gpus)} GPUS · ${cnt(L.halls.length)} HALLS`.toUpperCase(), this.cssW - 10, this.cssH - 8);
    g.restore();
  }

  hitTest(x: number, y: number): SceneHit | null {
    if (!this.state || !this.lay) return null;
    // The boxes are in draw order, so test from the front.
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
        return { id: b.id, label: this.tip(b.id) };
      }
    }
    return null;
  }

  private tip(id: string): string {
    const s = this.state;
    const L = this.lay;
    if (!s || !L) return '';
    const f = fleetOf(s);
    if (id === 'training') {
      const run = s.training;
      if (!run) return '';
      const pct = run.totalFlops > 0 ? Math.min(100, (run.doneFlops / run.totalFlops) * 100) : 0;
      const rackLine =
        !L.pod || L.pod.gpus <= 0
          ? 'No GPUs on the run yet'
          : L.pod.rackSize > 1
            ? `×${cnt(L.pod.rackSize)} GPUs per rack`
            : 'One GPU per rack';
      return [
        `Training: ${run.name}`,
        `${Math.round(pct)}% done · ${rate(run.paramsB)}B parameters`,
        `${cnt(f.trainingGpus)} GPUs · ${rate(f.trainingPflops)} PFLOP/s`,
        `Day ${s.day - run.startedDay} of the run · ${rackLine}`,
      ].join('\n');
    }
    if (id === 'cloud:burst') {
      return [
        `Cloud burst · ${rate(f.burstPflops)} PFLOP/s`,
        'Demand that own GPUs cannot cover is bought here',
        `${money(f.burstCostPerDay)}/day at ${money(f.burstPricePerPflopDay, 2)} per PFLOP/s-day`,
      ].join('\n');
    }
    if (id === 'cloud:rented') {
      let pflops = 0;
      let rent = 0;
      const parts: [string, number][] = [];
      for (const [gid, n] of Object.entries(s.compute.rented)) {
        const gpu = gpuById(gid);
        if (!gpu || n <= 0) continue;
        pflops += n * gpu.pflops;
        rent += n * gpu.rentPerDay * rentMultiplier(s);
        parts.push([gpu.name, n]);
      }
      parts.sort((a, b) => b[1] - a[1]);
      const models = parts
        .slice(0, 3)
        .map(([name, n]) => `${name} ×${cnt(n)}`)
        .join(', ');
      return [
        `Cloud rental · ${cnt(rentedOf(s))} GPUs`,
        models || 'No rentals',
        `${rate(pflops)} PFLOP/s`,
        `Rent ${money(rent)}/day`,
      ].join('\n');
    }
    const dcId = id.startsWith('dc:') ? id.slice(3) : '';
    const h = L.halls.find((x) => x.dc.id === dcId);
    return h ? hallTip(h, s, f) : '';
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}
