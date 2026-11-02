// Data warehouse layout: a pure function of GameState and the canvas size. Owned sets become crates on shelving islands
// (one per domain), data ops become machine islands (crawler, refinery, loading bay), conveyors and job traffic.
// Islands sit on the kit's staggered lattice. Rebuilt only when its signature changes.
import type { DataDomain, GameState, Id } from '../../sim/types';
import { believedQualityOf, datasetById, isVerifiedData } from '../../sim/systems/data';
import { CRAWLER_TIERS, archiveById, crawlBlocked, crawlYieldPerDayB, crawlerTierById } from '../../sim/systems/dataOps';
import { lattice } from '../kit';

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

// Island geometry (world units; heights in px).
export const CELL = 4.4;
export const ISLE = 3.9;
export const BAYS = 6;
export const LEVELS = 3;
export const DEPTH_SLOTS = 2;
export const SLOTS = BAYS * LEVELS * DEPTH_SLOTS;
export const BOARD_Z = [5, 15, 25];
export const RACK_TOP = 34;
export const BAY_W = 0.56;
export const RACK_LEN = BAYS * BAY_W;
export const RACK_D = 1.3;
export const CRATE_W = 0.46;
export const CRATE_D = 0.52;
export const CRATE_H = 8;
/** Shelving origin inside an island, and the conveyor lanes in front of it. */
const SHELF_X = 0.3;
const SHELF_Y = 0.35;
export const BELT_Y = [2.25, 2.95];

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

/** An island: its slab origin (ISLE square) and its lattice line. */
export interface Isle {
  x: number;
  y: number;
  line: number;
}

export interface BeltView {
  streamId: string;
  name: string;
  domain: DataDomain;
  tokensPerDayB: number;
  /** Conveyor from x0 to x1 at y (world), on its aisle's island. */
  x0: number;
  x1: number;
  y: number;
}

export interface JobView {
  id: Id;
  kind: 'bounty' | 'archive' | 'distill';
  domain: DataDomain;
  doneDay: number;
  label: string;
}

export interface AisleView extends Isle {
  index: number;
  domain: DataDomain;
  /** Shelving origin. */
  sx: number;
  sy: number;
  crates: CrateView[];
  sets: SetView[];
  /** Crates in this domain, including those past the shelf capacity. */
  total: number;
  overflow: number;
  /** Streams feeding this aisle (conveyors) and jobs on their way here (workers carrying boxes). */
  belts: BeltView[];
  jobs: JobView[];
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
  line: number;
}

export interface Layout {
  sig: string;
  unit: number;
  totalTokensB: number;
  totalCrates: number;
  sets: SetView[];
  aisles: AisleView[];
  jobs: JobView[];
  refines: RefineView[];
  crawler: CrawlerView | null;
  crawlerIsle: Isle | null;
  refineryIsle: Isle;
  bayIsle: Isle;
  dockBoxes: number;
  lines: number;
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

export function buildLayout(s: GameState, W: number, H: number): Layout {
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

  const c = ops?.crawler;
  const nOps = c ? 3 : 2;
  const cells = lattice(nOps + order.length, CELL, 0.5, 40, W, H);
  const lines = cells.length ? cells[cells.length - 1].line + 1 : 1;
  const isleAt = (k: number): Isle => {
    const cc = cells[k] ?? { x: 0, y: 0, line: 0 };
    return { x: cc.x + (CELL - ISLE) / 2, y: cc.y + (CELL - ISLE) / 2, line: cc.line };
  };
  let k = 0;
  const crawlerIsle = c ? isleAt(k++) : null;
  const refineryIsle = isleAt(k++);
  const bayIsle = isleAt(k++);

  const jobViews: JobView[] = jobs.map((j) => {
    const domain = jobDomain(j);
    let label: string;
    if (j.kind === 'bounty') label = `Bounty, ${DOMAIN_NAME[domain]}, ${j.tokensB.toFixed(1)}B tokens`;
    else if (j.kind === 'archive') label = `Archive: ${archiveById(j.archiveId)?.name ?? j.archiveId}`;
    else label = `Distillation from ${j.modelName}`;
    return { id: j.id, kind: j.kind as JobView['kind'], domain, doneDay: j.doneDay, label };
  });

  const aisles: AisleView[] = order.map((domain, i) => {
    const isle = isleAt(k + i);
    const sx = isle.x + SHELF_X;
    const sy = isle.y + SHELF_Y;
    const domSets = sets.filter((v) => v.domain === domain);
    const crates: CrateView[] = [];
    let filled = 0;
    let total = 0;
    for (const v of domSets) {
      for (let q = 0; q < v.crates; q++) {
        total++;
        if (filled >= SLOTS) continue;
        const idx = filled++;
        const bay = Math.floor(idx / (LEVELS * DEPTH_SLOTS));
        const r = idx % (LEVELS * DEPTH_SLOTS);
        const level = Math.floor(r / DEPTH_SLOTS);
        const depth = r % DEPTH_SLOTS;
        crates.push({
          x: sx + 0.05 + bay * BAY_W,
          y: sy + 0.08 + (1 - depth) * 0.6,
          z0: BOARD_Z[level],
          color: qualityColor(v.q),
          warn: q === 0 && v.warn,
          legal: q === 0 && v.legal,
        });
      }
    }
    // Back slots first so the front crates draw over them; low boards first.
    crates.sort((a, b) => a.y - b.y || a.z0 - b.z0 || a.x - b.x);
    const belts: BeltView[] = streams
      .filter((st) => st.domain === domain)
      .map((st, n) => ({
        streamId: st.id,
        name: st.name,
        domain: st.domain,
        tokensPerDayB: st.tokensPerDayB,
        x0: isle.x + 0.15,
        x1: isle.x + ISLE - 0.3,
        y: isle.y + BELT_Y[n % BELT_Y.length],
      }));
    return {
      ...isle,
      index: i,
      domain,
      sx,
      sy,
      crates,
      sets: domSets,
      total,
      overflow: Math.max(0, total - SLOTS),
      belts,
      jobs: jobViews.filter((j) => j.domain === domain),
    };
  });

  const refines: RefineView[] = refineJobs.slice(0, 2).map((j, lane) => ({
    lane,
    name: datasetById(s, j.datasetId)?.name ?? j.datasetId,
    level: j.level,
    doneDay: j.doneDay,
  }));

  let crawler: CrawlerView | null = null;
  if (c) {
    const tierIdx = Math.max(0, CRAWLER_TIERS.findIndex((t) => t.id === c.tier));
    const building = s.day < c.onlineDay;
    const blocked = crawlBlocked(s);
    crawler = {
      name: crawlerTierById(c.tier)?.name ?? c.tier,
      tierIdx,
      h: 22 + tierIdx * 6,
      online: !building,
      building,
      blocked,
      flowing: !building && !blocked && crawlYieldPerDayB(s) > 0,
    };
  }

  const hits: HitBox[] = [];
  for (const a of aisles) {
    hits.push({ id: `domain:${a.domain}`, x0: a.x, y0: a.y, x1: a.x + ISLE, y1: a.sy + RACK_D + 0.3, z1: RACK_TOP, line: a.line });
    for (const b of a.belts) hits.push({ id: `stream:${b.streamId}`, x0: b.x0, y0: b.y - 0.3, x1: b.x1, y1: b.y + 0.3, z1: 8, line: a.line + 0.5 });
  }
  if (crawler && crawlerIsle) {
    hits.push({ id: 'crawler', x0: crawlerIsle.x, y0: crawlerIsle.y, x1: crawlerIsle.x + ISLE, y1: crawlerIsle.y + ISLE, z1: crawler.h + 18, line: crawlerIsle.line });
  }
  hits.push({ id: 'refinery', x0: refineryIsle.x, y0: refineryIsle.y, x1: refineryIsle.x + ISLE, y1: refineryIsle.y + ISLE, z1: 36, line: refineryIsle.line });
  hits.push({ id: 'jobs', x0: bayIsle.x, y0: bayIsle.y + 1.7, x1: bayIsle.x + 2.0, y1: bayIsle.y + ISLE, z1: 18, line: bayIsle.line + 0.5 });
  hits.sort((a, b) => a.line - b.line);

  const sig = [
    unit,
    `${W}x${H}`,
    aisles.map((a) => `${a.domain}:${a.crates.length}:${a.overflow}`).join(','),
    sets.map((v) => `${v.id}:${v.crates}:${Math.round(v.q * 100)}:${v.warn ? 1 : 0}:${v.legal ? 1 : 0}`).join(','),
    streams.map((b) => b.id).join(','),
    jobViews.map((j) => j.id).join(','),
    refines.map((r) => `${r.lane}:${r.name}:${r.level}`).join(','),
    crawler ? `${crawler.tierIdx}:${crawler.building}:${crawler.blocked}:${crawler.flowing}` : '-',
  ].join('|');

  return {
    sig,
    unit,
    totalTokensB,
    totalCrates,
    sets,
    aisles,
    jobs: jobViews,
    refines,
    crawler,
    crawlerIsle,
    refineryIsle,
    bayIsle,
    dockBoxes: Math.min(6, jobViews.length),
    lines,
    hits,
  };
}

// Quality ramp: dark brown for weak sets, cardboard in the middle, pale gold for the best.
const QUALITY_STOPS: [number, string][] = [
  [0, '#4a3a2b'],
  [0.5, '#8a6a44'],
  [0.8, '#c09656'],
  [1, '#ead39a'],
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
