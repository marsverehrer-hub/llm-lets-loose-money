// Marketing street scene. Layout (floor units, x to the right, y toward the viewer):
//   back row of lots along y=0..3 (their +y facades face the street), a left column along x=0..2.6,
//   a street along y=3.2..5.6, a sidewalk to y=6.8, and a plaza in front with the marketing office.
import { TILE_H, TILE_W, hashStr, project, type Projector } from '../../office/iso';
import { C, shade, mix } from '../../office/palette';
import { floorLine, floorTile, glow, isoBlock, isoBox, planeX, planeY, poly, withAlpha, type Ctx } from '../../office/draw/prims';
import { CHAIR_DX, CHAIR_DY, drawChair, drawDesk, drawPlant, type Role } from '../../office/draw/furniture';
import { drawPerson } from '../../office/draw/person';
import { COMPETITORS } from '../../sim/data/competitors';
import { CAMPAIGNS } from '../../sim/data/campaigns';
import { MAX_ACTIVE_CAMPAIGNS } from '../../sim/systems/market';
import { formatMoney } from '../../sim/util';
import { ROLE_IDS, type CampaignDef, type Competitor, type GameState } from '../../sim/types';
import type { Scene } from '../types';

const W = 18; // block width along x
const D = 12; // block depth along y
const LEFT_X1 = 2.6; // the left column ends here; the street runs from here to W
const STREET_Y0 = 3.2;
const STREET_Y1 = 5.6;
const WALK_Y1 = 6.8;
const TOP = 84; // headroom above the ground for the tallest lot's top edge (fit only)
const FONT = 'IBM Plex Mono, monospace';

const BUS_LEN = 2.4;
const BUS_DEP = 1.2;
const BUS_H = 22;
const BUS_Y0 = 3.7;
const BUS_SPEED = 0.8; // floor units per second
const BLIMP_X0 = [0, 7.5];
const OFFICE = { x0: 7.0, x1: 14.6, y0: 7.6, y1: 11.2, h: 36 };
const OFFICE_KEY = 22; // painter key: after the sidewalk crowd behind it, before the blimp layer
const DESK_MAX = 8;

type SurfaceKind = 'billboard' | 'stadium' | 'blimp' | 'bus';
interface Surface {
  kind: SurfaceKind;
  lot: number; // index into LOTS for billboards and the stadium screen, -1 for floating and street ads
}

interface LotDef {
  side: 'back' | 'left';
  x0: number;
  y0: number;
  w: number;
  d: number;
  H: number; // full height
  order: number; // build order
}

// Back row first (facades face +y), then the left column (facades face +x).
const LOTS: LotDef[] = [
  { side: 'back', x0: 2.8, y0: 0, w: 3.6, d: 3.0, H: 72, order: 0 },
  { side: 'left', x0: 0, y0: 3.2, w: 2.6, d: 2.8, H: 112, order: 1 },
  { side: 'back', x0: 6.6, y0: 0, w: 3.6, d: 3.0, H: 98, order: 2 },
  { side: 'back', x0: 10.4, y0: 0, w: 3.6, d: 3.0, H: 64, order: 3 },
  { side: 'back', x0: 14.2, y0: 0, w: 3.6, d: 3.0, H: 86, order: 4 },
  { side: 'left', x0: 0, y0: 6.2, w: 2.6, d: 3.0, H: 80, order: 5 },
];
const STADIUM_LOT = LOTS.findIndex((L) => L.side === 'left' && L.order === 1);

const SHORT_NAME: Record<string, string> = {
  billboard_101: 'Billboard 101',
  podcast_tour: 'Podcast tour',
  cryptic_tweet: 'Cryptic tweet',
  hackathon: 'Hackathon',
  superbowl: 'Super Bowl',
  conference_keynote: 'Keynote',
  agi_blog: 'AGI essay',
  influencer_deal: 'Influencer',
};

const CAMPAIGN_BY_ID = new Map<string, CampaignDef>(CAMPAIGNS.map((d) => [d.id, d]));
const WALK_ROLES: Role[] = ['engineer', 'researcher', 'safety', 'sales', 'marketing'];
const HYPE_LINES = ['!!', 'wow', 'soon', 'GO', 'hype'];

/** Which kind of screen a campaign runs on, by its cost. */
function kindOf(def: CampaignDef): SurfaceKind {
  if (def.cost >= 1_000_000) return 'stadium';
  if (def.cost >= 250_000) return 'blimp';
  if (def.cost >= 100_000) return 'billboard';
  return 'bus';
}

type Ad =
  | { t: 'campaign'; def: CampaignDef; daysLeft: number }
  | { t: 'rival'; comp: Competitor; name: string; color: string }
  | { t: 'house' };

interface Face {
  axis: 'x' | 'y'; // 'y': plane y = f spanning x a0..a1 (faces +y); 'x': plane x = f spanning y a0..a1
  a0: number;
  a1: number;
  f: number;
}

interface Hit {
  id: string;
  pts: number[];
}

interface Bay {
  lot: number;
  a0: number;
  a1: number;
  branded: boolean;
}

interface Walker {
  seed: number;
  role: Role;
  y: number;
  dir: 1 | -1;
  speed: number;
  x0: number;
  phone: boolean;
  talk: boolean;
}

interface DynRef {
  d: number;
  kind: 0 | 1; // 0 bus, 1 walker
  i: number;
}

interface StaticItem {
  d: number;
  fn: (c: Ctx, t: number) => void;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Screen corners (tl, tr, br, bl) of a vertical face between heights z0 and z1. */
function faceQuad(p: Projector, fc: Face, z0: number, z1: number): number[] {
  const P = (a: number, z: number): [number, number] => (fc.axis === 'y' ? project(p, a, fc.f, z) : project(p, fc.f, a, z));
  const A = P(fc.a0, z1);
  const B = P(fc.a1, z1);
  const Cc = P(fc.a1, z0);
  const Dd = P(fc.a0, z0);
  return [A[0], A[1], B[0], B[1], Cc[0], Cc[1], Dd[0], Dd[1]];
}

/** Point at (u, v) inside a screen quad: u across (0..1), v down (0..1). */
function qpt(pts: number[], u: number, v: number): [number, number] {
  const tx = pts[0] + (pts[2] - pts[0]) * u;
  const ty = pts[1] + (pts[3] - pts[1]) * u;
  const bx = pts[6] + (pts[4] - pts[6]) * u;
  const by = pts[7] + (pts[5] - pts[7]) * u;
  return [tx + (bx - tx) * v, ty + (by - ty) * v];
}

/** Sub-rectangle of a screen quad. */
function sub(pts: number[], u0: number, v0: number, u1: number, v1: number): number[] {
  const a = qpt(pts, u0, v0);
  const b = qpt(pts, u1, v0);
  const c2 = qpt(pts, u1, v1);
  const d = qpt(pts, u0, v1);
  return [a[0], a[1], b[0], b[1], c2[0], c2[1], d[0], d[1]];
}

/** Convex hull of screen points (monotone chain), flattened. Gives the silhouette of a box. */
function hull(points: [number, number][]): number[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper).flat();
}

function inside(pts: number[], x: number, y: number): boolean {
  let hit = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2];
    const yi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const yj = pts[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Text fitted into a sub-rectangle of a screen quad. Shrinks until it fits the width. */
function fitText(g: CanvasRenderingContext2D, pts: number[], u0: number, v0: number, u1: number, v1: number, text: string, color: string, maxPx: number): void {
  const wpx = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) * (u1 - u0);
  const hpx = Math.hypot(pts[6] - pts[0], pts[7] - pts[1]) * (v1 - v0);
  if (wpx < 5 || hpx < 4) return;
  let fs = Math.min(maxPx, hpx * 0.75);
  g.font = `600 ${fs.toFixed(1)}px ${FONT}`;
  let shown = text;
  let w = g.measureText(shown).width;
  if (w > wpx * 0.92) {
    fs = Math.max(3.5, (fs * wpx * 0.92) / w);
    g.font = `600 ${fs.toFixed(1)}px ${FONT}`;
    w = g.measureText(shown).width;
    if (w > wpx * 0.92) {
      // still too wide at the smallest size: cut it short, or drop it when nothing readable fits
      const per = w / shown.length;
      const n = Math.floor((wpx * 0.92) / per) - 2;
      if (n < 3) return;
      shown = `${shown.slice(0, n)}..`;
    }
  }
  const [cx, cy] = qpt(pts, (u0 + u1) / 2, (v0 + v1) / 2);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(shown, cx, cy);
}

/** Small terminal label in screen space, bottom edge at y. Same look as the office pills. */
function pill(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, fs = 10): void {
  g.save();
  g.globalAlpha = 1;
  g.font = `600 ${fs}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 10;
  const h = fs + 8;
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

/** Paint one ad inside a screen quad. */
function drawAd(g: CanvasRenderingContext2D, pts: number[], ad: Ad | null, company: string, daysFrac: number): void {
  if (!ad) {
    poly(g, pts, '#100f0d');
    fitText(g, pts, 0.1, 0.3, 0.9, 0.7, 'AD SPACE', C.textDim, 9);
    return;
  }
  if (ad.t === 'house') {
    poly(g, pts, '#0c0b09');
    fitText(g, pts, 0.06, 0.18, 0.94, 0.66, company.toUpperCase(), C.amber, 12);
    poly(g, sub(pts, 0.25, 0.76, 0.75, 0.82), C.amberDim);
    return;
  }
  if (ad.t === 'campaign') {
    poly(g, pts, '#0c0b09');
    fitText(g, pts, 0.06, 0.1, 0.94, 0.56, SHORT_NAME[ad.def.id] ?? ad.def.name, C.fg, 11);
    poly(g, sub(pts, 0.06, 0.7, 0.94, 0.82), '#262219');
    poly(g, sub(pts, 0.06, 0.7, 0.06 + 0.88 * daysFrac, 0.82), C.amber);
    return;
  }
  // rival: lab colour fills the panel, a stripe on the left, the lab's name
  poly(g, pts, shade(ad.color, 0.28));
  poly(g, sub(pts, 0, 0, 0.12, 1), ad.color);
  fitText(g, pts, 0.16, 0.2, 0.96, 0.8, ad.name, C.fg, 11);
}

function adId(ad: Ad | null): string | null {
  if (!ad) return null;
  if (ad.t === 'campaign') return `campaign:${ad.def.id}`;
  if (ad.t === 'rival') return `rival:${ad.comp.id}`;
  return 'brand';
}

export class MarketingScene implements Scene {
  private cssW = 0;
  private cssH = 0;
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private time = 0;
  private s: GameState | null = null;

  // eased display values
  private brandShown = 0;
  private hypeShown = 0;
  private lotGrow: number[] = LOTS.map(() => 0);
  private builtTarget = 1;
  private marketing = 0;
  private started = false;

  // per-frame derived values (read by the draw fns and the tips)
  private companyName = '';
  private crowdCount = 0;
  private builtBays = 0;
  private brandedBays = 0;
  private houseCount = 0;

  private surfaces: Surface[] = [];
  private ads: (Ad | null)[] = [];
  private bays: Bay[] = [];
  private bayOrder: number[] = [];
  private busPhase: number[] = [];
  private busSurface: number[] = [];
  private walkers: Walker[] = [];
  private dynPool: DynRef[] = [];
  private dynActive: DynRef[] = [];
  private statics: StaticItem[] = [];
  private hits: Hit[] = [];
  private billboardOf: number[] = LOTS.map(() => -1);
  private stadiumSurface = -1;
  private blimpSurface: number[] = [];

  constructor() {
    // Surfaces: four rooftop billboards on the back lots, the stadium screen, two blimps, four buses.
    LOTS.forEach((L, li) => {
      if (L.side === 'back') {
        this.billboardOf[li] = this.surfaces.length;
        this.surfaces.push({ kind: 'billboard', lot: li });
      }
    });
    this.stadiumSurface = this.surfaces.length;
    this.surfaces.push({ kind: 'stadium', lot: STADIUM_LOT });
    for (let k = 0; k < BLIMP_X0.length; k++) {
      this.blimpSurface.push(this.surfaces.length);
      this.surfaces.push({ kind: 'blimp', lot: -1 });
    }
    const busCount = 4;
    const busSpan = W - LEFT_X1 - BUS_LEN - 0.4;
    for (let i = 0; i < busCount; i++) {
      this.busPhase.push((i * busSpan) / busCount);
      this.busSurface.push(this.surfaces.length);
      this.surfaces.push({ kind: 'bus', lot: -1 });
    }
    this.ads = this.surfaces.map(() => null);

    // Storefront bays along each lot's street-facing side, in a fixed scatter order so brand spreads across the block.
    LOTS.forEach((L, li) => {
      const start = L.side === 'back' ? L.x0 : L.y0;
      const len = L.side === 'back' ? L.w : L.d;
      const n = Math.floor(len / 1.2);
      for (let b = 0; b < n; b++) {
        const a0 = start + (b * len) / n;
        this.bays.push({ lot: li, a0: a0 + 0.06, a1: a0 + len / n - 0.06, branded: false });
      }
    });
    const rank = this.bays.map((_, k) => hashStr(`bay-${k}`));
    this.bayOrder = this.bays.map((_, k) => k).sort((a, b) => rank[a] - rank[b]);

    // Passers-by on the sidewalk. The plaza in front is left clear for the office.
    for (let i = 0; i < 36; i++) {
      this.walkers.push({
        seed: i * 7 + 3,
        role: WALK_ROLES[(i * 3) % WALK_ROLES.length],
        y: 6.1 + hashStr(`wy-${i}`) * 0.6,
        dir: hashStr(`wd-${i}`) > 0.5 ? 1 : -1,
        speed: 0.35 + hashStr(`ws-${i}`) * 0.5,
        x0: hashStr(`wx-${i}`) * (W - LEFT_X1 - 0.8),
        phone: i % 3 === 0,
        talk: i % 4 === 1,
      });
    }
    for (let i = 0; i < busCount + this.walkers.length; i++) {
      const ref: DynRef = { d: 0, kind: i < busCount ? 0 : 1, i: i < busCount ? i : i - busCount };
      this.dynPool.push(ref);
    }

    this.statics = this.buildStatics();
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
  }

  /** Fit the block into the canvas (CSS px): the footprint across, and the tallest tower up. */
  private fit(): void {
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const sc = Math.max(0.35, Math.min(availW / ((W + D) * TILE_W / 2), availH / ((W + D) * TILE_H / 2 + TOP), 2.6));
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - ((W - D) * TILE_W / 4) * sc;
    this.proj.oy = this.cssH / 2 - ((W + D) * TILE_H / 4 - TOP / 2) * sc;
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.time += dt;
    const t = this.time;
    this.s = s;
    this.update(s, dt);
    this.assignAds(s, t);
    this.pickBrandBays();

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    this.hits.length = 0;

    // Background
    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    this.drawGround(c, t);

    // Walkers and buses interleaved with the statics, painter's order by x + y.
    const active = this.dynActive;
    active.length = 0;
    const nBus = this.busPhase.length;
    for (let i = 0; i < nBus; i++) {
      const r = this.dynPool[i];
      r.d = this.busDepth(i, t);
      active.push(r);
    }
    const nWalk = this.walkerCount();
    for (let i = 0; i < nWalk; i++) {
      const r = this.dynPool[nBus + i];
      const w = this.walkers[i];
      r.d = this.walkerX(w, t) + w.y;
      active.push(r);
    }
    active.sort((a, b) => a.d - b.d);

    const st = this.statics;
    let si = 0;
    for (const r of active) {
      while (si < st.length && st[si].d <= r.d) {
        st[si].fn(c, t);
        si++;
      }
      if (r.kind === 0) this.drawBus(c, r.i, t);
      else this.drawWalker(c, this.walkers[r.i], t);
    }
    for (; si < st.length; si++) st[si].fn(c, t);

    // Blimps float above everything, then the office count pill on top of them all.
    for (let k = 0; k < BLIMP_X0.length; k++) this.drawBlimp(c, k, t);
    const O = OFFICE;
    const [lx, ly] = project(this.proj, (O.x0 + O.x1) / 2, O.y0 + 0.5, O.h + 9);
    if (this.marketing === 0) pill(g, lx, ly, 'VACANT', C.textDim);
    else if (this.marketing > DESK_MAX) pill(g, lx, ly, `+${this.marketing - DESK_MAX} more`, C.amber);

    // HUD, bottom right (same place as the office HUD)
    const campaigns = s.market.campaigns.length;
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(`MARKETING · ${this.marketing} STAFF · ${campaigns} OF ${MAX_ACTIVE_CAMPAIGNS} CAMPAIGNS LIVE`, this.cssW - 10, this.cssH - 8);
    g.restore();
  }

  hitTest(x: number, y: number): { id: string; label: string } | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (inside(h.pts, x, y)) return { id: h.id, label: this.labelFor(h.id) };
    }
    return null;
  }

  // -- state -------------------------------------------------------------------

  private update(s: GameState, dt: number): void {
    const k = Math.min(1, dt * 2);
    this.brandShown += (clamp(s.company.brand, 0, 100) - this.brandShown) * k;
    this.hypeShown += (clamp(s.company.hype, 0, 100) - this.hypeShown) * k;
    if (Math.abs(this.brandShown - s.company.brand) < 0.05) this.brandShown = s.company.brand;
    if (Math.abs(this.hypeShown - s.company.hype) < 0.05) this.hypeShown = s.company.hype;
    this.companyName = s.company.name;
    this.marketing = Math.max(0, Math.floor(s.staff.roles.marketing?.count ?? 0));

    // Lots build out as the company grows (log scale on headcount).
    let staff = 0;
    for (const r of ROLE_IDS) staff += Math.max(0, s.staff.roles[r]?.count ?? 0);
    this.builtTarget = clamp(1 + Math.floor(Math.log2(1 + staff) * 0.9), 1, LOTS.length);
    for (let li = 0; li < LOTS.length; li++) {
      const target = LOTS[li].order < this.builtTarget ? 1 : 0;
      // first frame: show what already exists; afterwards new lots rise on screen
      if (!this.started) this.lotGrow[li] = target;
      this.lotGrow[li] += (target - this.lotGrow[li]) * Math.min(1, dt * 1.2);
      if (Math.abs(target - this.lotGrow[li]) < 0.002) this.lotGrow[li] = target;
    }
    if (!this.started) {
      this.brandShown = clamp(s.company.brand, 0, 100);
      this.hypeShown = clamp(s.company.hype, 0, 100);
      this.started = true;
    }
    this.crowdCount = Math.round(3 + (this.hypeShown / 100) * (this.walkers.length - 3));
  }

  private walkerCount(): number {
    return this.crowdCount;
  }

  private visible(j: number): boolean {
    const sf = this.surfaces[j];
    return sf.lot < 0 || this.lotGrow[sf.lot] > 0.9;
  }

  /** Campaigns take their own kind of screen first, then any free visible one. Free screens show our brand, then rivals. */
  private assignAds(s: GameState, t: number): void {
    const ads = this.ads;
    for (let j = 0; j < ads.length; j++) ads[j] = null;
    const taken = new Set<number>();
    const firstFree = (kind: SurfaceKind | null): number => {
      for (let j = 0; j < this.surfaces.length; j++) {
        if (taken.has(j) || !this.visible(j)) continue;
        if (kind === null || this.surfaces[j].kind === kind) return j;
      }
      return -1;
    };
    for (const c of s.market.campaigns) {
      const def = CAMPAIGN_BY_ID.get(c.defId);
      if (!def) continue;
      let j = firstFree(kindOf(def));
      if (j < 0) j = firstFree(null);
      if (j < 0) continue;
      taken.add(j);
      ads[j] = { t: 'campaign', def, daysLeft: c.daysLeft };
    }

    const free: number[] = [];
    for (let j = 0; j < this.surfaces.length; j++) if (!taken.has(j) && this.visible(j)) free.push(j);
    const house = Math.round((this.brandShown / 100) * free.length);
    const rivals = s.competitors
      .filter((c) => c.active)
      .slice()
      .sort((a, b) => b.brand - a.brand);
    const rot = Math.floor(t / 6);
    this.houseCount = 0;
    free.forEach((j, k) => {
      if (k < house) {
        ads[j] = { t: 'house' };
        this.houseCount++;
        return;
      }
      if (rivals.length === 0) return;
      const comp = rivals[(k - house + rot) % rivals.length];
      const def = COMPETITORS.find((d) => d.id === comp.id);
      ads[j] = {
        t: 'rival',
        comp,
        name: def?.name ?? (comp.human ? 'Rival player' : 'Rival lab'),
        color: def?.color ?? C.blue,
      };
    });
  }

  private pickBrandBays(): void {
    let built = 0;
    for (const b of this.bays) if (this.lotGrow[b.lot] > 0.9) built++;
    this.builtBays = built;
    const K = Math.round((clamp(this.brandShown, 0, 100) / 100) * built);
    let k = 0;
    for (const bi of this.bayOrder) {
      const b = this.bays[bi];
      const on = this.lotGrow[b.lot] > 0.9 && k < K;
      b.branded = on;
      if (on) k++;
    }
    this.brandedBays = k;
  }

  // -- static geometry (built once; every value read inside is live) ------------

  private buildStatics(): StaticItem[] {
    const out: StaticItem[] = [];
    LOTS.forEach((L, li) => {
      out.push({ d: L.x0 + L.w / 2 + L.y0 + L.d / 2, fn: (c, t) => this.drawLot(c, li, t) });
    });
    out.push({ d: OFFICE_KEY, fn: (c, t) => this.drawOffice(c, t) });
    for (const x of [4.5, 10.5, 16.5]) {
      out.push({ d: x + 5.75, fn: (c) => drawPlant(c, x, 5.75, 1.1) });
    }
    // planters in the plaza and lamp posts along the curb
    for (const [x, y] of [[4.2, 11.4], [17.2, 11.3]] as const) {
      out.push({ d: x + y, fn: (c) => drawPlant(c, x, y, 1.3) });
    }
    for (const x of [7.5, 13.5]) {
      out.push({ d: x + 5.6, fn: (c) => this.drawLamp(c, x, 5.6) });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  private drawGround(c: Ctx, _t: number): void {
    const { g, p } = c;
    // base slab with an edge, as in the office
    const e = project(p, -0.6, -0.6, -4);
    const f = project(p, W + 0.6, -0.6, -4);
    const h = project(p, W + 0.6, D + 0.6, -4);
    const k = project(p, -0.6, D + 0.6, -4);
    poly(g, [e[0], e[1], f[0], f[1], h[0], h[1], k[0], k[1]], C.floorEdge);
    floorTile(c, 0, 0, W, D, '#2a2723');
    // plaza checker
    for (let x = LEFT_X1; x < W; x++) {
      for (let y = WALK_Y1; y < D; y++) {
        if ((x + y) % 2 === 0) floorTile(c, x, y, 1, 1, '#2d2a25');
      }
    }
    // left column ground
    floorTile(c, 0, 3.0, LEFT_X1, D - 3.0, '#23211d');
    // curb along the back, asphalt, sidewalk
    floorTile(c, LEFT_X1, 3.0, W - LEFT_X1, STREET_Y0 - 3.0, '#3a3731');
    floorTile(c, LEFT_X1, STREET_Y0, W - LEFT_X1, STREET_Y1 - STREET_Y0, '#1c1b19');
    floorTile(c, LEFT_X1, STREET_Y1, W - LEFT_X1, WALK_Y1 - STREET_Y1, '#36332e');
    // curb lines and paving joints
    for (const y of [STREET_Y1, WALK_Y1]) floorLine(c, LEFT_X1, y, W, y, 0.05, withAlpha(C.fg, 0.12), 1);
    for (let x = LEFT_X1 + 2; x < W; x += 2) floorLine(c, x, STREET_Y1, x, WALK_Y1, 0.05, withAlpha(C.fg, 0.05), 1);
    // lane dashes on the street
    for (let x = LEFT_X1 + 0.5; x < W - 0.8; x += 1.6) {
      floorLine(c, x, 4.4, x + 0.8, 4.4, 0.05, withAlpha(C.amberDim, 0.5), 1.2);
    }
    // the crowd area is the sidewalk and plaza
    const crowd = [project(p, LEFT_X1, STREET_Y1, 0), project(p, W, STREET_Y1, 0), project(p, W, D, 0), project(p, LEFT_X1, D, 0)];
    this.hits.push({ id: 'hype', pts: crowd.flat() });
  }

  private drawLot(c: Ctx, li: number, t: number): void {
    const { g, p } = c;
    const L = LOTS[li];
    const grow = this.lotGrow[li];
    const back = L.side === 'back';
    const face: Face = back
      ? { axis: 'y', a0: L.x0, a1: L.x0 + L.w, f: L.y0 + L.d }
      : { axis: 'x', a0: L.y0, a1: L.y0 + L.d, f: L.x0 + L.w };

    if (grow < 0.02) {
      // empty plot with a fence and a sign
      floorTile(c, L.x0, L.y0, L.w, L.d, '#1f1d1a');
      poly(g, faceQuad(p, face, 0, 9), '#2e2b26');
      const sign = faceQuad(p, { ...face, a0: face.a0 + 0.3, a1: face.a1 - 0.3 }, 13, 23);
      poly(g, sign, '#14120f');
      fitText(g, sign, 0.06, 0.12, 0.94, 0.9, 'TO LET', C.amberDim, 10);
      this.hits.push({ id: 'brand', pts: faceQuad(p, face, 0, 23) });
      return;
    }

    const h = L.H * grow;
    const top = '#3b3731';
    const front = '#2c2924';
    const side = '#211f1b';
    const flip = !back; // the facade is the right face on left lots
    isoBox(c, L.x0, L.y0, L.w, L.d, h, top, flip ? side : front, flip ? front : side);

    // windows on the facade (lit ones flicker slowly); the stadium screen takes the top of its lot
    const span = face.a1 - face.a0;
    const cols = Math.max(1, Math.floor(span / 0.9));
    const isStadium = li === STADIUM_LOT;
    for (let col = 0; col < cols; col++) {
      const a0 = face.a0 + 0.22 + col * ((span - 0.44) / cols);
      for (let row = 0; row < 8; row++) {
        const z0 = 24 + row * 9;
        if (z0 + 5 > h - 6) break;
        if (isStadium && z0 > 46) break;
        const lit = hashStr(`w-${li}-${col}-${row}`) > 0.42;
        const flick = lit ? 0.75 + 0.15 * Math.sin(t * 0.7 + col * 1.3 + row * 2.1) : 0;
        const fill = lit ? mix('#3a2a16', '#ffa630', flick * 0.5) : '#121110';
        poly(g, faceQuad(p, { ...face, a0, a1: a0 + 0.5 }, z0, z0 + 5), fill);
      }
    }

    // roof unit
    if (back) isoBlock(c, L.x0 + 0.4, L.y0 + 0.4, 0.8, 0.6, h, h + 5, '#4a463f');

    // storefront bays: shutters when unbranded, awning and sign when branded
    if (grow > 0.9) {
      this.bays.forEach((bay, bi) => {
        if (bay.lot !== li) return;
        const shop: Face = { ...face, a0: bay.a0, a1: bay.a1 };
        const frontQ = faceQuad(p, shop, 0, 9.5);
        if (bay.branded) {
          poly(g, frontQ, mix('#0f0e0c', C.amberDim, 0.3));
          const gl = qpt(frontQ, 0.5, 0.5);
          glow(g, gl[0], gl[1], 16 * p.scale, C.amber, 0.12);
          poly(g, faceQuad(p, shop, 9.5, 13), C.amber);
          poly(g, faceQuad(p, shop, 13, 19), '#0c0b09');
          fitText(g, faceQuad(p, shop, 13, 19), 0.04, 0.12, 0.96, 0.9, this.companyName.toUpperCase(), C.amber, 9);
        } else {
          poly(g, frontQ, '#1a1815');
          for (const z of [2.5, 5, 7.5]) poly(g, faceQuad(p, shop, z, z + 0.5), '#26231e');
          poly(g, faceQuad(p, shop, 13, 19), '#161512');
          poly(g, faceQuad(p, shop, 15.5, 16.2), '#2a2722');
        }
        this.hits.push({ id: 'brand', pts: faceQuad(p, shop, 0, bay.branded ? 19 : 13) });
      });
    }

    // billboard on the roof of a back lot
    const bj = this.billboardOf[li];
    if (bj >= 0 && grow > 0.9) {
      const a0 = L.x0 + 0.12;
      const a1 = L.x0 + L.w - 0.12;
      const z0 = h + 2;
      const z1 = h + 36;
      const bf: Face = { axis: 'y', a0, a1, f: 2.6 };
      poly(g, faceQuad(p, { ...bf, a0: a0 - 0.12, a1: a1 + 0.12 }, z0 - 1.2, z1 + 1.2), '#1d1b18');
      isoBlock(c, a0 + 0.1, 2.5, 0.12, 0.12, h, z0, '#2a2823');
      isoBlock(c, a1 - 0.22, 2.5, 0.12, 0.12, h, z0, '#2a2823');
      const q = faceQuad(p, bf, z0, z1);
      drawAd(g, q, this.ads[bj], this.companyName, this.daysFrac(bj));
      this.pushSurfaceHit(bj, q);
    }

    // stadium screen on the left lot
    const sj = this.stadiumSurface;
    if (isStadium && grow > 0.9) {
      const sf: Face = { axis: 'x', a0: 3.5, a1: 5.7, f: L.x0 + L.w + 0.02 };
      poly(g, faceQuad(p, { ...sf, a0: sf.a0 - 0.12, a1: sf.a1 + 0.12 }, 54, 108), '#15130f');
      const q = faceQuad(p, sf, 56, 106);
      drawAd(g, q, this.ads[sj], this.companyName, this.daysFrac(sj));
      this.pushSurfaceHit(sj, q);
    }

    // scaffold while it rises
    if (grow < 0.98) {
      const pole = '#b45309';
      const hh = h + 4;
      for (let k = 0; k <= 3; k++) {
        const a = face.a0 + (k * (face.a1 - face.a0)) / 3;
        const f0 = { ...face, a0: a, a1: a + 0.08 };
        poly(g, faceQuad(p, f0, 0, hh), pole);
      }
      for (let z = 12; z < hh; z += 12) poly(g, faceQuad(p, face, z, z + 1.2), '#d97706');
    }
  }

  private daysFrac(j: number): number {
    const ad = this.ads[j];
    if (!ad || ad.t !== 'campaign') return 0;
    return clamp(ad.daysLeft / Math.max(1, ad.def.days), 0, 1);
  }

  private pushSurfaceHit(j: number, q: number[]): void {
    const id = adId(this.ads[j]);
    if (id) this.hits.push({ id, pts: q });
  }

  private drawOffice(c: Ctx, t: number): void {
    const { g, p } = c;
    const O = OFFICE;
    const H = O.h;
    const count = this.marketing;
    floorTile(c, O.x0, O.y0, O.x1 - O.x0, O.y1 - O.y0, '#2d2a25');
    // back and left walls only: the front is open, like a cut-away
    planeY(c, O.x0, O.x1, O.y0, 0, H, '#2a2824');
    planeX(c, O.x0, O.y0, O.y1, 0, H, '#211f1b');
    planeY(c, O.x0, O.x1, O.y0, H - 1.5, H, '#3a362f');
    planeX(c, O.x0, O.y0, O.y1, H - 1.5, H, '#34312b');
    planeY(c, O.x0, O.x1, O.y0 + 0.01, 20, 21, withAlpha(C.amberDim, 0.6));

    const sign = faceQuad(p, { axis: 'y', a0: O.x0 + 1.4, a1: O.x1 - 1.4, f: O.y0 + 0.02 }, 26, 33);
    poly(g, sign, '#0c0c0c');
    fitText(g, sign, 0.06, 0.12, 0.94, 0.9, 'MARKETING', C.amber, 11);

    // desks: two rows of four, then a count pill when the team is bigger than the room
    for (let k = 0; k < DESK_MAX; k++) {
      const row = Math.floor(k / 4);
      const col = k % 4;
      const dx = O.x0 + 0.5 + col * 1.7;
      const dy = O.y0 + 0.35 + row * 1.75;
      const occ = k < count;
      const flicker = occ ? 0.5 + 0.5 * Math.sin(t * (4 + (k % 5)) + k * 1.3) : 0.05;
      drawDesk(c, dx, dy, 'marketing', false, flicker, t);
      const cx = dx + CHAIR_DX;
      const cy = dy + CHAIR_DY;
      drawChair(c, cx - 0.2, cy - 0.2);
      if (occ) drawPerson(c, { x: cx, y: cy, role: 'marketing', seed: k * 13 + 5, sitting: true, typing: true, walkPhase: 0, highlight: false, t });
    }
    const corners: [number, number][] = [];
    for (const [x, y] of [[O.x0, O.y0], [O.x1, O.y0], [O.x1, O.y1], [O.x0, O.y1]] as const) {
      corners.push(project(p, x, y, 0), project(p, x, y, H));
    }
    this.hits.push({ id: 'team', pts: hull(corners) });
  }

  // -- dynamic items -------------------------------------------------------------

  private busDepth(i: number, t: number): number {
    return this.busX(i, t) + BUS_LEN / 2 + BUS_Y0 + BUS_DEP / 2;
  }

  private busX(i: number, t: number): number {
    const span = W - LEFT_X1 - BUS_LEN - 0.4;
    return LEFT_X1 + 0.2 + mod(this.busPhase[i] + BUS_SPEED * t, span);
  }

  private drawBus(c: Ctx, i: number, t: number): void {
    const { g, p } = c;
    const bx = this.busX(i, t);
    const j = this.busSurface[i];
    const fade = clamp(Math.min(bx - LEFT_X1, W - (bx + BUS_LEN)) / 0.6, 0, 1);
    g.save();
    g.globalAlpha = fade;
    isoBox(c, bx, BUS_Y0, BUS_LEN, BUS_DEP, BUS_H, '#3b3730', '#24211c', '#1d1b17');
    const front = faceQuad(p, { axis: 'x', a0: BUS_Y0 + 0.12, a1: BUS_Y0 + BUS_DEP - 0.12, f: bx + BUS_LEN + 0.005 }, 10, BUS_H - 4);
    poly(g, front, '#0b0a08');
    const q = faceQuad(p, { axis: 'y', a0: bx + 0.12, a1: bx + BUS_LEN - 0.12, f: BUS_Y0 + BUS_DEP + 0.005 }, 4, BUS_H - 3);
    drawAd(g, q, this.ads[j], this.companyName, this.daysFrac(j));
    g.restore();
    this.pushSurfaceHit(j, q);
  }

  private walkerX(w: Walker, t: number): number {
    const span = W - LEFT_X1 - 0.8;
    return LEFT_X1 + 0.4 + mod(w.x0 + w.dir * w.speed * t, span);
  }

  private drawWalker(c: Ctx, w: Walker, t: number): void {
    const { g, p } = c;
    const x = this.walkerX(w, t);
    drawPerson(c, { x, y: w.y, role: w.role, seed: w.seed, sitting: false, typing: false, walkPhase: 0.5 + t * w.speed * 6, highlight: false, t });
    const s = p.scale;
    const hype = this.hypeShown;
    const [bx, by] = project(p, x, w.y, 0);
    if (w.phone && hype > 25) {
      g.fillStyle = C.fg;
      g.globalAlpha = 0.9;
      g.fillRect(bx + 4 * s, by - 12 * s, 2.4 * s, 3.4 * s);
      g.globalAlpha = 1;
    }
    if (w.talk && hype > 45 && mod(t * 0.4 + w.seed * 0.31, 1) < 0.3) {
      pill(g, bx, by - 30 * s - 4, HYPE_LINES[w.seed % HYPE_LINES.length], C.amber, 9);
    }
  }

  private drawBlimp(c: Ctx, k: number, t: number): void {
    const { g, p } = c;
    const span = W - LEFT_X1 - 4;
    const x = LEFT_X1 + 2 + mod(BLIMP_X0[k] + t * 0.22, span);
    const y = 8.6 + k * 0.9;
    const z = 118 - k * 18;
    const s = p.scale;
    const [cx, cy0] = project(p, x, y, z);
    const cy = cy0 + Math.sin(t * 0.8 + k) * 2 * s;
    const rx = 48 * s;
    const ry = 15 * s;
    const j = this.blimpSurface[k];

    g.fillStyle = '#17150f';
    g.fillRect(cx - rx * 0.2, cy + ry * 0.75, rx * 0.4, ry * 0.45);
    g.beginPath();
    g.fillStyle = '#24211c';
    g.moveTo(cx + rx * 0.7, cy);
    g.lineTo(cx + rx * 1.0, cy - ry * 0.9);
    g.lineTo(cx + rx * 1.0, cy + ry * 0.7);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = '#2e2b25';
    g.fill();
    g.strokeStyle = '#4a463e';
    g.lineWidth = 1;
    g.stroke();

    const panel = [cx - rx * 0.78, cy - ry * 0.5, cx + rx * 0.78, cy - ry * 0.5, cx + rx * 0.78, cy + ry * 0.5, cx - rx * 0.78, cy + ry * 0.5];
    drawAd(g, panel, this.ads[j], this.companyName, this.daysFrac(j));
    this.pushSurfaceHit(j, [cx - rx, cy - ry, cx + rx, cy - ry, cx + rx, cy + ry * 0.75, cx - rx, cy + ry * 0.75]);
  }

  private drawLamp(c: Ctx, x: number, y: number): void {
    const { g, p } = c;
    isoBlock(c, x, y, 0.1, 0.1, 0, 30, '#3a3731');
    isoBlock(c, x - 0.06, y - 0.06, 0.22, 0.22, 30, 32, '#2a2823');
    const [lx, ly] = project(p, x + 0.05, y + 0.05, 30);
    glow(g, lx, ly, 14 * p.scale, C.amber, 0.22);
  }

  // -- tips -----------------------------------------------------------------------

  private labelFor(id: string): string {
    const s = this.s;
    if (!s) return '';
    if (id === 'brand') {
      return `Brand ${Math.round(s.company.brand)} of 100\n${this.brandedBays} of ${this.builtBays} storefronts and ${this.houseCount} screens show ${s.company.name}\nGrows with campaigns and the marketing team`;
    }
    if (id === 'hype') {
      return `Hype ${Math.round(s.company.hype)} of 100\n${this.crowdCount} people on the street\nAI hype cycle at ${Math.round(s.market.aiHype)}`;
    }
    if (id === 'team') {
      return `Marketing team: ${this.marketing} staff\n${s.market.campaigns.length} of ${MAX_ACTIVE_CAMPAIGNS} campaigns live\n${Math.min(DESK_MAX, this.marketing)} of ${DESK_MAX} desks in use`;
    }
    if (id.startsWith('campaign:')) {
      const defId = id.slice('campaign:'.length);
      const def = CAMPAIGN_BY_ID.get(defId);
      if (!def) return '';
      const run = s.market.campaigns.find((x) => x.defId === defId);
      if (!run) return `${def.name}\nNot running`;
      return `${def.name}\n${run.daysLeft} of ${def.days} days left, cost ${formatMoney(def.cost)}\n+${def.brandPerDay} brand and +${def.hypePerDay} hype a day`;
    }
    if (id.startsWith('rival:')) {
      const compId = id.slice('rival:'.length);
      const comp = s.competitors.find((x) => x.id === compId);
      if (!comp) return '';
      const def = COMPETITORS.find((d) => d.id === compId);
      return `${def?.name ?? 'Rival lab'}\nLatest model: ${comp.model?.name ?? 'none yet'}\nBrand ${Math.round(comp.brand)}, ${comp.modelsReleased} models shipped`;
    }
    return '';
  }
}
