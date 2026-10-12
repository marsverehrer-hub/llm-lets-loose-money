// Market scene data: turns GameState into what the town draws (districts, plot owners, labs). Reads only.
import type { GameState, Segment } from '../../sim/types';
import { bestPlayerModel, segmentShares } from '../../sim/systems/market';
import { arenaLeaderboard } from '../../sim/systems/competitors';
import { provisionalElo } from '../../sim/systems/lab';
import { labInfo } from '../../sim/systems/labs';
import { clamp } from '../../sim/util';

export const SEGMENTS: Segment[] = ['consumer', 'developer', 'enterprise'];
export const SEG_NAME: Record<Segment, string> = { consumer: 'Consumers', developer: 'Developers', enterprise: 'Enterprise' };
/** Key used for you in owners and labs (competitor ids are used for the AI labs). */
export const PLAYER_KEY = 'player';
/** Your colour: the text colour, as MarketPanel draws your rows (lab colours are data). */
export const PLAYER_COLOR = '#e8e4dc';
/** Lots per row in a district. Districts grow by adding rows. */
export const COLS = 7;
export const MAX_PLOTS = 49;

export interface LabRec {
  key: string;
  name: string;
  color: string;
  isPlayer: boolean;
  /** Ring slot on the town rim (0 = you). */
  slot: number;
  valuation: number;
  /** Arena Elo (you: provisional, as the Market panel shows), null before any model. */
  elo: number | null;
  /** Arena place, 1 = top. Null before any model. */
  rank: number | null;
  modelName: string | null;
  users: number;
  /** Share of each segment's users, 0..1. */
  share: Record<Segment, number>;
}

export interface SegRec {
  seg: Segment;
  tam: number;
  /** Lots built in the district. */
  n: number;
  /** Lab key that serves each lot (index = lot index), null when nobody sells there yet. */
  owner: (string | null)[];
  /** Building height multiplier for this market size (towers grow with the market). */
  scale: number;
  leader: { key: string; name: string; share: number } | null;
  playerShare: number;
}

export interface MarketView {
  hype: number;
  labs: LabRec[];
  byKey: Map<string, LabRec>;
  segs: Record<Segment, SegRec>;
}

/** Lots for a market of `tam` customers: about 6 at $0.2M, 20 at $50M, 28 at $1B. */
export function plotCount(tam: number): number {
  return Math.round(clamp(4 + 6 * Math.log10(Math.max(1, tam) / 1e5), 3, MAX_PLOTS));
}

/** Largest-remainder split of n lots by weight. Lots go to labs in index order, so each lab's land is one block. */
function allocate(rows: { key: string; w: number }[], n: number): (string | null)[] {
  const out: (string | null)[] = new Array(n).fill(null);
  const tot = rows.reduce((t, r) => t + r.w, 0);
  if (tot <= 0 || n <= 0) return out;
  const quota = rows.map((r) => (r.w / tot) * n);
  const cnt = quota.map((q) => Math.floor(q));
  let left = n - cnt.reduce((a, b) => a + b, 0);
  const order = quota.map((q, i) => ({ frac: q - Math.floor(q), i })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < left; k++) cnt[order[k].i]++;
  let p = 0;
  rows.forEach((r, i) => {
    for (let k = 0; k < cnt[i] && p < n; k++) out[p++] = r.key;
  });
  return out;
}

export function buildView(s: GameState): MarketView {
  const hype = clamp(s.market.aiHype, 0, 100);

  // Arena: Elo and place per lab. You show the provisional Elo, as the Market panel does.
  const arena = arenaLeaderboard(s);
  const elo = new Map<string, number>();
  const rank = new Map<string, number>();
  const model = new Map<string, string>();
  arena.forEach((r, i) => {
    const k = r.isPlayer ? PLAYER_KEY : r.id;
    elo.set(k, r.elo);
    rank.set(k, i + 1);
    model.set(k, r.modelName);
  });
  const best = bestPlayerModel(s);
  if (best) elo.set(PLAYER_KEY, provisionalElo(s, best).elo);

  // Users per segment and lab. You are one key however many products you run.
  const perSeg = {} as Record<Segment, Map<string, { name: string; users: number }>>;
  const users = new Map<string, number>();
  for (const seg of SEGMENTS) {
    const acc = new Map<string, { name: string; users: number }>();
    for (const r of segmentShares(s, seg)) {
      const key = r.isPlayer ? PLAYER_KEY : r.id;
      const a = acc.get(key) ?? { name: r.isPlayer ? s.company.name : r.name, users: 0 };
      a.users += Math.max(0, r.users);
      acc.set(key, a);
      users.set(key, (users.get(key) ?? 0) + Math.max(0, r.users));
    }
    perSeg[seg] = acc;
  }

  const labs: LabRec[] = [];
  s.competitors.forEach((c, idx) => {
    if (!c.active) return;
    const info = labInfo(s, c.id);
    if (!info) return;
    labs.push({
      key: c.id,
      name: info.name,
      color: info.color,
      isPlayer: false,
      slot: 1 + (idx % 7),
      valuation: c.valuation ?? 0,
      elo: elo.get(c.id) ?? null,
      rank: rank.get(c.id) ?? null,
      modelName: model.get(c.id) ?? null,
      users: users.get(c.id) ?? 0,
      share: { consumer: 0, developer: 0, enterprise: 0 },
    });
  });
  labs.push({
    key: PLAYER_KEY,
    name: s.company.name,
    color: PLAYER_COLOR,
    isPlayer: true,
    slot: 0,
    valuation: s.finance.valuation ?? 0,
    elo: elo.get(PLAYER_KEY) ?? null,
    rank: rank.get(PLAYER_KEY) ?? null,
    modelName: model.get(PLAYER_KEY) ?? null,
    users: users.get(PLAYER_KEY) ?? 0,
    share: { consumer: 0, developer: 0, enterprise: 0 },
  });
  const byKey = new Map(labs.map((l) => [l.key, l]));

  const segs = {} as Record<Segment, SegRec>;
  for (const seg of SEGMENTS) {
    const acc = perSeg[seg];
    const total = [...acc.values()].reduce((t, a) => t + a.users, 0);
    const rows = [...acc.entries()]
      .filter(([k, a]) => byKey.has(k) && a.users > 0)
      .map(([key, a]) => ({ key, w: a.users }))
      .sort((a, b) => b.w - a.w);
    for (const [k, a] of acc) {
      const lab = byKey.get(k);
      if (lab && total > 0) lab.share[seg] = a.users / total;
    }
    const tam = s.market.segments[seg].tam;
    const n = plotCount(tam);
    const top = rows[0];
    segs[seg] = {
      seg,
      tam,
      n,
      owner: allocate(rows, n),
      scale: 0.9 + 0.1 * clamp(Math.log10(Math.max(1, tam) / 1e6), 0, 4),
      leader: top && total > 0 ? { key: top.key, name: byKey.get(top.key)?.name ?? top.key, share: top.w / total } : null,
      playerShare: total > 0 ? (acc.get(PLAYER_KEY)?.users ?? 0) / total : 0,
    };
  }

  return { hype, labs, byKey, segs };
}
