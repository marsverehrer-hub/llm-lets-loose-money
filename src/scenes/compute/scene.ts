// Compute scene: the player's compute as an isometric campus. Every hall, the training cluster, the product edge and
// the cloud stand on their own raised slab, laid out on the kit's staggered lattice and fitted to the canvas, so the
// campus fills a wide strip and a phone alike. Reads GameState every frame; the layout rebuilds only when its
// signature or the canvas size changes. Cells are drawn line by line (back to front), so no global sort is needed.
import type { FleetBreakdown, GameState } from '../../sim/types';
import { DATACENTER_TIERS } from '../../sim/data/gpus';
import { fleetFor, gpuById, priorityOf, rentMultiplier, runActive } from '../../sim/systems/compute';
import { formatMoney } from '../../sim/util';
import type { Scene, SceneHit } from '../types';
import { Tags, background, cnt, fitIso, frac, hitBox, hud, iso, outline, palette, prand, type Box3, type Ctx, type Proj } from '../kit';
import { AISLE, BURST_Z, CLOUD_Z, PRODUCT_H, RACK_D, buildLayout, engineersOf, installedOf, rentedOf, type HallLayout, type Layout } from './layout';
import { drawBuilding, drawBurst, drawCloud, drawFlow, drawHall, drawPod, drawProducts, type Frame, type Walker } from './draw';

const MAX_WALKERS = 28;

interface Hit {
  id: string;
  box: Box3;
}

function fleetOf(s: GameState): FleetBreakdown {
  return s.compute.fleet ?? fleetFor(s, priorityOf(s), runActive(s));
}

/** Changes whenever the drawn structure changes. Checked a few times a second. */
function sigOf(s: GameState, fleet: FleetBreakdown): string {
  let sig = '';
  const leased = s.neocloud?.dedicated ?? [];
  for (const dc of s.compute.datacenters) {
    sig += `${dc.id}.${dc.tierId}.${dc.buildDaysLeft > 0 ? `b${Math.ceil(dc.buildDaysLeft / 5)}` : 'o'}.${installedOf(dc)}.${dc.liquid ? 1 : 0}${dc.infiniband ? 1 : 0}${leased.includes(dc.id) ? 1 : 0};`;
  }
  const live = s.products.filter((p) => p.active).length;
  sig += `|r${rentedOf(s)}|t${s.training ? Math.round(fleet.trainingGpus) : -1}|b${fleet.burstPflops > 1e-6 ? 1 : 0}`;
  sig += `|p${s.products.length}:${live}|e${Math.min(MAX_WALKERS, engineersOf(s))}`;
  return sig;
}

/** Rates and PFLOP/s: keep small numbers readable. */
const rate = (n: number): string => {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n).toLocaleString('en-US');
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
};
const money = (v: number, digits = 1): string => formatMoney(v, digits);

const SHORT_TIER: Record<string, string> = { closet: 'Closet', colo: 'Colo', hyperscale: 'Hyperscale', cathedral: 'Cathedral' };

function hallTip(h: HallLayout, s: GameState, f: FleetBreakdown): string {
  const tier = DATACENTER_TIERS.find((t) => t.id === h.dc.tierId);
  const slots = tier?.maxGpus ?? 0;
  const head = `${h.dc.name} · ${h.tierName}`;
  if (!h.built) {
    return [
      head,
      `Under construction: ${Math.ceil(h.dc.buildDaysLeft)} days left (${Math.round(h.progress * 100)}% built)`,
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
  const lines = [
    head,
    `${cnt(h.installed)} of ${cnt(slots)} GPU slots · ${cnt(h.filledRacks)} of ${cnt(h.racks.length)} racks (×${cnt(h.gpusPerRack)} GPUs each)`,
    modelLine,
    `${rate(pflops)} PFLOP/s`,
  ];
  const extras = [h.liquid ? 'Liquid cooled' : 'Air cooled', h.infiniband ? 'InfiniBand fabric' : ''].filter(Boolean).join(' · ');
  lines.push(extras);
  if (h.leased) {
    lines.push(`Dedicated to your neocloud: sold to customers (${Math.round((s.neocloud?.utilization ?? 0) * 100)}% busy, purple LEDs)`);
  } else {
    const tot = f.totalGpus;
    const fT = tot > 0 ? f.trainingGpus / tot : 0;
    const fS = tot > 0 ? f.servingGpus / tot : 0;
    const fI = tot > 0 ? f.idleGpus / tot : 0;
    lines.push(`Mix here: ${cnt(h.installed * fT)} training · ${cnt(h.installed * fS)} serving · ${cnt(h.installed * fI)} idle`);
    lines.push('LEDs: yellow training · green serving · dim idle');
  }
  lines.push(`Upkeep ${money(tier?.upkeepPerDay ?? 0)}/day · power ${money(power)}/day`);
  return lines.join('\n');
}

export class ComputeScene implements Scene {
  private cssW = 0;
  private cssH = 0;
  private readonly proj: Proj = { ox: 0, oy: 0, s: 1 };
  private readonly frame: Frame = { t: 0, fT: 0, fS: 0, util: 0, live: false };
  /** Static layer (floors, walls, racks, cooling, trays): redrawn only when the layout, size or theme changes. */
  private staticCv: HTMLCanvasElement | null = null;
  private staticKey = '';
  private lay: Layout | null = null;
  private sig = '';
  private sizeKey = '';
  private sigTimer = 0;
  private hits: Hit[] = [];
  private hover: string | null = null;
  private state: GameState | null = null;
  private time = 0;
  private readonly tags = new Tags();

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.sigTimer = 0;
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

  private rebuild(s: GameState, fleet: FleetBreakdown, sig: string): void {
    const L = buildLayout(s, fleet, this.cssW, this.cssH);
    this.lay = L;
    this.sig = sig;
    this.sizeKey = `${this.cssW}x${this.cssH}`;
    fitIso(this.proj, L.bounds, this.cssW, this.cssH);
    const hits: Hit[] = [];
    if (L.cloud) {
      if (L.cloud.rentedGpus > 0) hits.push({ id: 'cloud:rented', box: L.cloud.box });
      if (L.cloud.burst) hits.push({ id: 'cloud:burst', box: L.cloud.burstBox });
    }
    for (const h of L.halls) hits.push({ id: `dc:${h.dc.id}`, box: h.box });
    if (L.pod) hits.push({ id: 'training', box: L.pod.box });
    // Front lines last, so hit tests (back to front through the list) find the nearest piece first.
    const line = (id: string): number => {
      if (id.startsWith('dc:')) return L.halls.find((h) => `dc:${h.dc.id}` === id)?.line ?? 0;
      if (id === 'training') return L.pod?.line ?? 0;
      return L.cloud?.line ?? 0;
    };
    hits.sort((a, b) => line(a.id) - line(b.id));
    this.hits = hits;
  }

  /** Engineers walk the front aisle of the finished halls, back and forth (nothing stands in front of them there). */
  private walkers(L: Layout, t: number): Map<HallLayout, Walker[]> {
    const out = new Map<HallLayout, Walker[]>();
    const built = L.halls.filter((h) => h.built && h.rows > 0);
    if (!built.length) return out;
    // Small halls hold a couple of people; big ones more.
    const cap = (h: HallLayout) => Math.max(2, Math.min(5, Math.floor(h.perRow / 3)));
    const room = built.reduce((a, h) => a + cap(h), 0);
    const n = Math.min(MAX_WALKERS, L.engineers, room);
    for (let e = 0; e < n; e++) {
      let h = built[e % built.length];
      for (let k = 0; k < built.length && (out.get(h)?.length ?? 0) >= cap(h); k++) h = built[(e + k + 1) % built.length];
      const r = h.rows - 1;
      const ph = prand(e * 12.9 + 3);
      const span = h.perRow * 0.5;
      const u = frac(t * (0.6 / Math.max(1, span)) + ph);
      const back = u > 0.5;
      const pause = Math.abs(u - 0.25) < 0.04 || Math.abs(u - 0.75) < 0.04;
      const k = back ? 2 - 2 * u : 2 * u;
      const x = h.rowX + 0.2 + (span - 0.4) * Math.min(1, Math.max(0, (k - 0.5) * 1.1 + 0.5));
      const y = h.rowY[r] + RACK_D + AISLE * (0.35 + 0.3 * prand(e * 3.3));
      const list = out.get(h) ?? [];
      list.push({ x, y, walk: t * 7 + ph * 6.28, moving: !pause });
      out.set(h, list);
    }
    return out;
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
      if (!this.lay || sig !== this.sig || this.sizeKey !== `${this.cssW}x${this.cssH}`) this.rebuild(s, fleet, sig);
    }
    const L = this.lay as Layout;
    const pal = palette();
    const c: Ctx = { g, p: this.proj, pal };

    const f = this.frame;
    f.t = t;
    const tot = fleet.totalGpus;
    f.fT = tot > 0 ? fleet.trainingGpus / tot : 0;
    f.fS = tot > 0 ? fleet.servingGpus / tot : 0;
    f.util = s.neocloud?.utilization ?? 0;

    // Static layer from the cache; it is rebuilt on a new layout, size, pixel ratio or theme.
    const dpr = g.getTransform().a || 1;
    const key = `${this.sig}|${this.cssW}x${this.cssH}@${dpr}|${pal.bg}`;
    if (!this.staticCv || key !== this.staticKey) {
      const cv = this.staticCv ?? document.createElement('canvas');
      cv.width = Math.max(1, Math.round(this.cssW * dpr));
      cv.height = Math.max(1, Math.round(this.cssH * dpr));
      const sg = cv.getContext('2d');
      if (sg) {
        sg.setTransform(dpr, 0, 0, dpr, 0, 0);
        f.live = false;
        this.drawCells({ g: sg, p: this.proj, pal }, L, f, t);
      }
      this.staticCv = cv;
      this.staticKey = key;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.staticCv, 0, 0);
    g.restore();
    f.live = true;
    this.drawCells(c, L, f, t);

    this.drawOverlay(c, L, s, fleet, t);
  }

  /** Cells, line by line (back to front), in one pass: static (cached) or live. */
  private drawCells(c: Ctx, L: Layout, f: Frame, t: number): void {
    if (!f.live) background(c, this.cssW, this.cssH);
    const walk = f.live ? this.walkers(L, t) : null;
    for (let line = 0; line < L.lines; line++) {
      if (L.cloud && L.cloud.line === line) drawCloud(c, L.cloud, f);
      for (const h of L.halls) {
        if (h.line !== line) continue;
        if (h.built) drawHall(c, h, f, walk?.get(h) ?? []);
        else drawBuilding(c, h, t, f.live);
      }
      if (L.pod && L.pod.line === line) drawPod(c, L.pod, f);
      if (L.products && L.products.line === line) drawProducts(c, L.products, t, f.live);
    }
  }

  /** Flows, tags, hover outline and the HUD. Drawn after the cells. */
  private drawOverlay(c: Ctx, L: Layout, s: GameState, fleet: FleetBreakdown, t: number): void {
    const { g, p, pal } = c;
    const sc = p.s;

    if (L.products) {
      const pr = L.products;
      const [tx, ty] = iso(p, pr.x0 + pr.w / 2, pr.y0 + pr.d / 2, PRODUCT_H + 2);
      if (fleet.servingPflops > 0) {
        let src: HallLayout | null = null;
        for (const h of L.halls) if (h.built && !h.leased && (!src || h.installed > src.installed)) src = h;
        if (src) {
          const [ax, ay] = iso(p, src.x0 + src.w / 2, src.y0 + src.d / 2, src.look.rackH + 6);
          drawFlow(c, ax, ay, tx, ty, pal.up, t, 0);
        }
      }
      if (L.cloud && L.cloud.burst) {
        const cl = L.cloud;
        const [ax, ay] = iso(p, cl.x0 + cl.w / 2, cl.y0 + cl.d / 2, BURST_Z);
        drawFlow(c, ax, ay, tx, ty, pal.fg3, t, 0.5);
      }
    }
    if (L.cloud && L.cloud.burst) drawBurst(c, L.cloud, t);

    if (this.hover) {
      const hit = this.hits.find((h) => h.id === this.hover);
      if (hit) outline(c, hit.box);
    }

    // Tags: one per piece, hung above its back corner; the tag layer keeps them apart.
    const small = sc < 0.42;
    const tags = this.tags;
    for (const h of L.halls) {
      const [x, y] = iso(p, h.x0 + 0.4, h.y0 + 0.4, h.look.wallH + 2);
      if (!h.built) {
        tags.add(x, y, small ? 'Building' : h.dc.name, {
          tone: pal.warn,
          sub: `${Math.ceil(h.dc.buildDaysLeft)}d left`,
          progress: h.progress,
          small,
          leader: 6,
        }, 5);
        continue;
      }
      const bits = [SHORT_TIER[h.dc.tierId] ?? h.tierName, `${cnt(h.installed)} GPU`];
      if (h.liquid) bits.push('Liquid');
      if (h.infiniband) bits.push('IB');
      tags.add(x, y, h.leased ? `Neocloud · ${h.dc.name}` : h.dc.name, {
        tone: h.leased ? pal.sota : pal.hl,
        sub: small ? `${cnt(h.installed)}` : bits.join(' · '),
        small,
        leader: 6,
        alpha: this.hover && this.hover !== `dc:${h.dc.id}` ? 0.8 : 1,
      }, this.hover === `dc:${h.dc.id}` ? 20 : 4);
    }
    const run = s.training;
    if (L.pod && run) {
      const pod = L.pod;
      const pct = run.totalFlops > 0 ? Math.min(1, Math.max(0, run.doneFlops / run.totalFlops)) : 0;
      const [x, y] = iso(p, pod.x0 + 0.4, pod.y0 + 0.4, 28);
      tags.add(x, y, `Training ${run.name}`, { solid: true, sub: `${Math.round(pct * 100)}%`, progress: pct, small, leader: 6 }, 12);
    }
    if (L.cloud && L.cloud.rentedGpus > 0) {
      const cl = L.cloud;
      const [x, y] = iso(p, cl.x0 + 0.3, cl.y0 + 0.3, CLOUD_Z + 16);
      tags.add(x, y, 'Cloud', { tone: pal.blue, sub: `${cnt(cl.rentedGpus)} GPU rented`, small, leader: 4 }, 3);
    }
    if (L.cloud && L.cloud.burst) {
      const cl = L.cloud;
      const [x, y] = iso(p, cl.x0 + cl.w / 2, cl.y0 + cl.d / 2, BURST_Z + 14);
      tags.add(x, y, 'Burst', { tone: pal.fg3, sub: `${rate(fleet.burstPflops)} PF/s`, small }, 1);
    }
    if (L.products) {
      const pr = L.products;
      const [x, y] = iso(p, pr.x0 + pr.w / 2, pr.y0 + pr.d / 2, PRODUCT_H + 12);
      tags.add(x, y, 'Products', { tone: pal.up, sub: `${cnt(pr.live)} live`, small }, 2);
    }
    const empty = L.halls.length === 0 && !L.pod && !L.cloud && !L.products;
    if (empty) tags.add(this.cssW / 2, this.cssH / 2 + 8, 'No datacenters yet', { tone: pal.hl }, 30);
    tags.flush(g, pal, this.cssW, this.cssH);

    const shown = [...this.walkers(L, t).values()].reduce((a, l) => a + l.length, 0);
    const extra = L.engineers - shown;
    const gpus = Math.round(fleet.totalGpus);
    hud(g, pal, this.cssW, this.cssH, `${cnt(gpus)} GPUs · ${cnt(L.halls.length)} halls · ${cnt(L.engineers)} engineers${extra > 0 ? ` (${cnt(extra)} off camera)` : ''}`);
  }

  hitTest(x: number, y: number): SceneHit | null {
    if (!this.state || !this.lay) return null;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (hitBox(this.proj, h.box, x, y)) return { id: h.id, label: this.tip(h.id) };
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
      const rackLine = !L.pod || L.pod.gpus <= 0 ? 'No GPUs on the run yet' : L.pod.gpusPerRack > 1 ? `×${cnt(L.pod.gpusPerRack)} GPUs per rack` : 'One GPU per rack';
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
      return [`Cloud rental · ${cnt(rentedOf(s))} GPUs`, models || 'No rentals', `${rate(pflops)} PFLOP/s`, `Rent ${money(rent)}/day`].join('\n');
    }
    const dcId = id.startsWith('dc:') ? id.slice(3) : '';
    const h = L.halls.find((x) => x.dc.id === dcId);
    return h ? hallTip(h, s, f) : '';
  }
}
