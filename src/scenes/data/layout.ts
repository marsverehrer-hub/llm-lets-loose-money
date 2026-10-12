// Data warehouse layout: a pure function of GameState. Owned sets become crates on shelving aisles (one aisle per
// domain), data ops become machines, belts and job traffic. Rebuilt only when its signature changes.
import type { DataDomain, GameState, Id } from '../../sim/types';
import { believedQualityOf, datasetById, isVerifiedData } from '../../sim/systems/data';
import { CRAWLER_TIERS, archiveById, crawlBlocked, crawlYieldPerDayB, crawlerTierById } from '../../sim/systems/dataOps';

export type P = [number, number];

/** Short labels for aisles and tips. */
export const DOMAIN_NAME: Record<DataDomain, string> = {
  general: 'General', code: 'Code', math: 'Maths', science: 'Science', medical: 'Medical', legal: 'Legal',
  finance: 'Finance', multilingual: 'Multilingual', creative: 'Creative', dialogue: 'Dialogue', vision: 'Vision',
  audio: 'Audio', video: 'Video', gaming: 'Gaming', robotics: 'Robotics', safety: 'Safety', news: 'News',
};
const DOMAIN_ORDER: DataDomain[] = [
  'general', 'code', 'math', 'science', 'medical', 'legal', 'finance', 'multilingual', 'creative', 'dialogue',
  'vision', 'audio', 'video', 'gaming', 'robotics', 'safety', 'news',
];

/** The unit is picked so the whole warehouse stays near this many crates; each set gets tokens / unit crates. */
export const CRATE_TARGET = 80;
const RISKY_LEGAL = 0.25;
const RISKY_REPUTATION = 0.2;
const LEGAL_HIGH = 0.3;

// Shelving geometry (world units; heights in px, same as the office kit).
export const BAYS = 6;
export const LEVELS = 3;
export const DEPTH_SLOTS = 2;
export const SLOTS = BAYS * LEVELS * DEPTH_SLOTS;
export const BOARD_Z = [6, 18, 30];
export const RACK_TOP = 40;
export const BAY_W = 0.9;
export const RACK_LEN = BAYS * BAY_W;
export const RACK_D = 1.6;
export const CRATE_W = 0.74;
export const CRATE_D = 0.66;
export const CRATE_H = 9;
export const CELL_W = RACK_LEN + 1.6;
export const CELL_D = RACK_D + 0.8;
export const X0 = 1.0;
export const Y0 = 3.2;

// Fixed zones. The building starts at x = 0; outside (x < 0) the pipe and belts come in.
export const MIN_X = -2.8;
export const CRAWLER_BOX = { x0: 1.0, y0: 0.7, x1: 2.9, y1: 2.0 };
export const REFINERY_BOX = { x0: 3.5, y0: 0.7, x1: 5.6, y1: 2.0 };
export const REFINE_LANE_X = [4.2, 5.0];
export const LANE_STREAM = [2.25, 2.4];
export const LANE_WORKER = 2.7;
export const LANE_FORK = 2.95;
const DOCK_Y = { y0: 2.45, y1: 3.05 };
export const WORKER_MAX = 6;
export const TRIP_S = 9;

export interface SetView {
  id: Id;
  name: string;
  domain: DataDomain;
  tokensB: number;
  crates: number;
  q: number;
  verified: boolean;
  /** Unverified or risky: yellow warning tag. */
  warn: boolean;
  risky: boolean;
  /** Scrape-sourced with high legal risk: red "legal" sticker. */
  legal: boolean;
}

export interface CrateView {
  x: number;
  y: number;
  z0: number;
  color: string;
  warn: boolean;
  legal: boolean;
}

export interface AisleView {
  index: number;
  domain: DataDomain;
  x: number;
  y: number;
  crates: CrateView[];
  sets: SetView[];
  /** Crates in this domain, including those past the shelf capacity. */
  total: number;
  overflow: number;
}

export interface BeltView {
  streamId: string;
  name: string;
  domain: DataDomain;
  path: P[];
  aisle: number;
  tokensPerDayB: number;
}

export interface JobView {
  id: Id;
  kind: 'bounty' | 'archive' | 'distill';
  domain: DataDomain;
  aisle: number;
  path: P[];
  doneDay: number;
  label: string;
}

export interface RefineView {
  lane: number;
  name: string;
  level: number;
  doneDay: number;
}

export interface CrawlerView {
  name: string;
  tierIdx: number;
  h: number;
  online: boolean;
  building: boolean;
  blocked: boolean;
  flowing: boolean;
}

export interface HitBox {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z1: number;
}

export interface Layout {
  sig: string;
  W: number;
  D: number;
  unit: number;
  totalTokensB: number;
  totalCrates: number;
  sets: SetView[];
  aisles: AisleView[];
  belts: BeltView[];
  jobs: JobView[];
  refines: RefineView[];
  crawler: CrawlerView | null;
  /** Each aisle index that holds crates, with its forklift route to the training door. */
  forkSources: { aisle: number; path: P[] }[];
  doorX: number;
  dock: { x0: number; y0: number; x1: number; y1: number };
  dockBoxes: number;
  hits: HitBox[];
}

function jobDomain(j: { kind: string; domain?: DataDomain; archiveId?: Id }): DataDomain {
  if (j.kind === 'bounty' && j.domain) return j.domain;
  if (j.kind === 'archive' && j.archiveId) return archiveById(j.archiveId)?.domain ?? 'general';
  return 'general';
}

function collectSets(s: GameState): SetView[] {
  const out: SetView[] = [];
  const seen = new Set<string>();
  for (const id of s.data.owned) {
    if (seen.has(id)) continue;
    seen.add(id);
    const d = datasetById(s, id);
    if (!d) continue;
    const verified = isVerifiedData(s, id);
    const risky = d.legalRisk >= RISKY_LEGAL || (d.reputationRisk ?? 0) >= RISKY_REPUTATION;
    const scrape = (d.acquisition ?? 'purchase') === 'scrape';
    out.push({
      id,
      name: d.name,
      domain: d.domain ?? 'general',
      tokensB: Math.max(0, d.tokensB),
      crates: 1,
      q: believedQualityOf(s, d),
      verified,
      warn: !verified || risky,
      risky,
      legal: scrape && d.legalRisk >= LEGAL_HIGH,
    });
  }
  return out;
}

export function buildLayout(s: GameState): Layout {
  const sets = collectSets(s);
  const totalTokensB = sets.reduce((a, v) => a + v.tokensB, 0);
  const unit = Math.max(1, 10 ** Math.round(Math.log10(Math.max(1, totalTokensB) / CRATE_TARGET)));
  for (const v of sets) v.crates = v.tokensB > 0 ? Math.max(1, Math.round(v.tokensB / unit)) : 1;
  const totalCrates = sets.reduce((a, v) => a + v.crates, 0);

  const ops = s.dataOps;
  const streams = (ops?.streams ?? []).filter((st) => st.startDay <= s.day && s.day < st.endDay);
  const allJobs = ops?.jobs ?? [];
  const jobs = allJobs.filter((j) => j.kind !== 'refine');
  const refineJobs = allJobs.filter((j): j is Extract<typeof j, { kind: 'refine' }> => j.kind === 'refine');

  // One aisle per domain that has sets, a stream or a job in flight.
  const domains = new Set<DataDomain>();
  for (const v of sets) domains.add(v.domain);
  for (const st of streams) domains.add(st.domain);
  for (const j of jobs) domains.add(jobDomain(j));
  let order = DOMAIN_ORDER.filter((d) => domains.has(d));
  if (order.length === 0) order = ['general'];
  const N = order.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt((N * CELL_D) / CELL_W)));
  const rows = Math.ceil(N / cols);
  const W = Math.max(9.6, X0 + cols * CELL_W + 0.6);
  const D = Y0 + rows * CELL_D + 0.2;
  const doorX = W - 2.6;
  const dock = { x0: W - 2.3, y0: DOCK_Y.y0, x1: W - 0.9, y1: DOCK_Y.y1 };
  const dockX = (dock.x0 + dock.x1) / 2;

  const aisles: AisleView[] = order.map((domain, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = X0 + col * CELL_W;
    const y = Y0 + row * CELL_D;
    const domSets = sets.filter((v) => v.domain === domain);
    const crates: CrateView[] = [];
    let filled = 0;
    let total = 0;
    for (const v of domSets) {
      for (let k = 0; k < v.crates; k++) {
        total++;
        if (filled >= SLOTS) continue;
        const idx = filled++;
        const bay = Math.floor(idx / (LEVELS * DEPTH_SLOTS));
        const r = idx % (LEVELS * DEPTH_SLOTS);
        const level = Math.floor(r / DEPTH_SLOTS);
        const depth = r % DEPTH_SLOTS;
        crates.push({
          x: x + 0.08 + bay * BAY_W,
          y: y + 0.12 + depth * 0.78,
          z0: BOARD_Z[level],
          color: qualityColor(v.q),
          warn: k === 0 && v.warn,
          legal: k === 0 && v.legal,
        });
      }
    }
    return { index: i, domain, x, y, crates, sets: domSets, total, overflow: Math.max(0, total - SLOTS) };
  });
  const aisleOf = new Map<DataDomain, number>();
  aisles.forEach((a) => aisleOf.set(a.domain, a.index));

  const belts: BeltView[] = streams.map((st, k) => {
    const a = aisles[aisleOf.get(st.domain) ?? 0];
    const gx = a.x - 0.4;
    const ly = LANE_STREAM[k % LANE_STREAM.length];
    return {
      streamId: st.id,
      name: st.name,
      domain: st.domain,
      tokensPerDayB: st.tokensPerDayB,
      aisle: a.index,
      path: [[MIN_X, ly], [gx, ly], [gx, a.y + 0.9], [a.x + 0.2, a.y + 0.9]],
    };
  });

  const jobViews: JobView[] = jobs.map((j) => {
    const domain = jobDomain(j);
    const a = aisles[aisleOf.get(domain) ?? 0];
    const gx = a.x - 0.4;
    let label: string;
    if (j.kind === 'bounty') label = `Bounty, ${DOMAIN_NAME[domain]}, ${j.tokensB.toFixed(1)}B tokens`;
    else if (j.kind === 'archive') label = `Archive: ${archiveById(j.archiveId)?.name ?? j.archiveId}`;
    else label = `Distillation from ${j.modelName}`;
    return {
      id: j.id,
      kind: j.kind as JobView['kind'],
      domain,
      aisle: a.index,
      doneDay: j.doneDay,
      label,
      path: [[dockX, LANE_WORKER], [gx, LANE_WORKER], [gx, a.y + 0.9], [a.x + 0.5, a.y + 0.9]],
    };
  });

  const refines: RefineView[] = refineJobs.slice(0, REFINE_LANE_X.length).map((j, lane) => ({
    lane,
    name: datasetById(s, j.datasetId)?.name ?? j.datasetId,
    level: j.level,
    doneDay: j.doneDay,
  }));

  let crawler: CrawlerView | null = null;
  const c = ops?.crawler;
  if (c) {
    const tierIdx = Math.max(0, CRAWLER_TIERS.findIndex((t) => t.id === c.tier));
    const building = s.day < c.onlineDay;
    const blocked = crawlBlocked(s);
    crawler = {
      name: crawlerTierById(c.tier)?.name ?? c.tier,
      tierIdx,
      h: 22 + tierIdx * 8,
      online: !building,
      building,
      blocked,
      flowing: !building && !blocked && crawlYieldPerDayB(s) > 0,
    };
  }

  const forkSources = aisles
    .filter((a) => a.crates.length > 0)
    .map((a) => {
      const gx = a.x - 0.4;
      return {
        aisle: a.index,
        path: [[gx, a.y + 0.9], [gx, LANE_FORK], [doorX, LANE_FORK], [doorX, 0.6]] as P[],
      };
    });

  const hits: HitBox[] = [];
  for (const a of aisles) {
    hits.push({ id: `domain:${a.domain}`, x0: a.x, y0: a.y, x1: a.x + RACK_LEN + 1.1, y1: a.y + RACK_D, z1: RACK_TOP });
  }
  if (crawler) {
    hits.push({ id: 'crawler', x0: CRAWLER_BOX.x0, y0: CRAWLER_BOX.y0, x1: CRAWLER_BOX.x1, y1: CRAWLER_BOX.y1, z1: crawler.h + 7 });
  }
  hits.push({ id: 'refinery', x0: REFINERY_BOX.x0, y0: REFINERY_BOX.y0, x1: REFINERY_BOX.x1, y1: REFINERY_BOX.y1, z1: 34 });
  hits.push({ id: 'jobs', x0: dock.x0, y0: dock.y0, x1: dock.x1, y1: dock.y1, z1: 14 });
  for (const b of belts) {
    for (let i = 0; i + 1 < b.path.length; i++) {
      const [ax, ay] = b.path[i];
      const [bx, by] = b.path[i + 1];
      hits.push({
        id: `stream:${b.streamId}`,
        x0: Math.min(ax, bx) - 0.22,
        y0: Math.min(ay, by) - 0.22,
        x1: Math.max(ax, bx) + 0.22,
        y1: Math.max(ay, by) + 0.22,
        z1: 8,
      });
    }
  }

  const sig = [
    unit,
    W.toFixed(2),
    D.toFixed(2),
    aisles.map((a) => `${a.domain}:${a.crates.length}:${a.overflow}`).join(','),
    sets.map((v) => `${v.id}:${v.crates}:${Math.round(v.q * 100)}:${v.warn ? 1 : 0}:${v.legal ? 1 : 0}`).join(','),
    belts.map((b) => `${b.streamId}:${b.aisle}`).join(','),
    jobViews.map((j) => `${j.id}:${j.aisle}`).join(','),
    refines.map((r) => `${r.lane}:${r.name}:${r.level}`).join(','),
    crawler ? `${crawler.tierIdx}:${crawler.building}:${crawler.blocked}:${crawler.flowing}` : '-',
  ].join('|');

  return {
    sig,
    W,
    D,
    unit,
    totalTokensB,
    totalCrates,
    sets,
    aisles,
    belts,
    jobs: jobViews,
    refines,
    crawler,
    forkSources,
    doorX,
    dock,
    dockBoxes: Math.min(6, jobViews.length),
    hits,
  };
}

// Quality ramp: dark brown for weak sets, cardboard in the middle, pale gold for the best.
const QUALITY_STOPS: [number, string][] = [
  [0, '#33281f'],
  [0.5, '#7a5c3a'],
  [0.8, '#b58c4e'],
  [1, '#e0c88e'],
];
export function qualityColor(q: number): string {
  const v = Math.min(1, Math.max(0, q));
  for (let i = 0; i + 1 < QUALITY_STOPS.length; i++) {
    const [a, ca] = QUALITY_STOPS[i];
    const [b, cb] = QUALITY_STOPS[i + 1];
    if (v <= b) {
      const t = (v - a) / (b - a);
      return lerpHex(ca, cb, t);
    }
  }
  return QUALITY_STOPS[QUALITY_STOPS.length - 1][1];
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

/** Compact token amount: B below 1000, T above. */
export function fmtTokens(tokensB: number): string {
  if (tokensB >= 1000) return `${(tokensB / 1000).toFixed(tokensB >= 10000 ? 0 : 1)}T`;
  if (tokensB >= 10) return `${Math.round(tokensB)}B`;
  return `${tokensB.toFixed(1)}B`;
}

/** Position and heading at distance `dist` along a polyline (clamped to its ends). */
export function alongPath(path: P[], dist: number): { x: number; y: number; dx: number; dy: number } {
  let rest = Math.max(0, dist);
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (rest <= len || i + 2 === path.length) {
      const u = len > 0 ? Math.min(1, rest / len) : 0;
      const dx = len > 0 ? (bx - ax) / len : 0;
      const dy = len > 0 ? (by - ay) / len : 0;
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, dx, dy };
    }
    rest -= len;
  }
  const last = path[path.length - 1];
  return { x: last[0], y: last[1], dx: 0, dy: 0 };
}

export function pathLength(path: P[]): number {
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) n += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return n;
}
