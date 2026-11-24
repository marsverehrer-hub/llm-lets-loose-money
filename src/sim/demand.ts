// Who buys from whom. Each lab offers a segment its best profitable model; share is a logit with an outside option.
import type { GameState, Id, Model, Vec } from './types';
import { dot } from './rand';
import { SEGMENTS, type SegmentDef } from './content/modalities';

export const PRICE_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.6, 2, 2.5];

export const fitOf = (def: SegmentDef, cap: Vec): number => dot(def.w, cap);
export const unitMargin = (s: GameState, def: SegmentDef, m: Model): number =>
  def.pRef * m.price - m.attrs.cost * def.load * s.market.computePrice;

export interface Offer { lab: Id; model: Model; u: number; fit: number }

function utility(s: GameState, def: SegmentDef, m: Model): number {
  const lab = s.companies[m.lab].lab!;
  return fitOf(def, m.cap) / 5 - def.priceSens * Math.log(m.price) + def.speedSens * Math.log(m.attrs.speed)
    + def.trustSens * (m.attrs.trust - 0.7) + lab.brand + 0.5 * lab.hype;
}

/** One offer per lab: its highest-utility model that makes money in this segment. `hyp` adds or replaces a model. */
export function offers(s: GameState, segId: Id, hyp?: Model): Offer[] {
  const def = SEGMENTS[segId];
  const best: Record<Id, Offer> = {};
  const all = Object.values(s.models).filter((m) => m.id !== hyp?.id);
  if (hyp) all.push(hyp);
  for (const m of all) {
    if (m.retired || m.modality !== def.modality || unitMargin(s, def, m) <= 0) continue;
    const o = { lab: m.lab, model: m, u: utility(s, def, m), fit: fitOf(def, m.cap) };
    if (!best[m.lab] || o.u > best[m.lab].u) best[m.lab] = o;
  }
  return Object.values(best);
}

/** The outside option rises half as fast as the frontier: yesterday's miracle is today's baseline. */
function outside(s: GameState, segId: Id, os: Offer[]): number {
  const top = os.reduce((b, o) => Math.max(b, o.fit), s.segments[segId].fit0);
  return 10 + (0.5 * (top - s.segments[segId].fit0)) / 5;
}

export function targets(s: GameState, segId: Id, hyp?: Model): { offers: Offer[]; share: Record<Id, number> } {
  const os = offers(s, segId, hyp);
  const u0 = outside(s, segId, os);
  const z = Math.exp(0) + os.reduce((a, o) => a + Math.exp(o.u - u0), 0);
  return { offers: os, share: Object.fromEntries(os.map((o) => [o.lab, Math.exp(o.u - u0) / z])) };
}

/** Best capability fit per segment among rival labs, for crowns. */
export function leader(s: GameState, segId: Id, notLab?: Id): { lab: Id | null; fit: number } {
  const def = SEGMENTS[segId];
  let out: { lab: Id | null; fit: number } = { lab: null, fit: 0 };
  for (const m of Object.values(s.models)) {
    if (m.retired || m.modality !== def.modality || m.lab === notLab) continue;
    const f = fitOf(def, m.cap);
    if (f > out.fit) out = { lab: m.lab, fit: f };
  }
  return out;
}

export function crowns(s: GameState, labId: Id): Id[] {
  return Object.keys(s.segments).filter((id) => leader(s, id).lab === labId);
}

export interface Projection {
  rows: { seg: Id; share: number; rev: number; profit: number; fit: number; leader: Id | null; leaderFit: number; crown: boolean }[];
  rev: number; profit: number;
}

/** Steady-state weekly revenue of a lab, optionally with a hypothetical model added. The one link from model to money. */
export function projectRevenue(s: GameState, labId: Id, hyp?: Model): Projection {
  const rows: Projection['rows'] = [];
  for (const segId of Object.keys(s.segments)) {
    const def = SEGMENTS[segId];
    if (hyp && def.modality !== hyp.modality) continue;
    const t = targets(s, segId, hyp);
    const o = t.offers.find((x) => x.lab === labId);
    const lead = leader(s, segId, labId);
    const f = hyp ? fitOf(def, hyp.cap) : o?.fit ?? 0;
    const units = (t.share[labId] ?? 0) * s.segments[segId].size;
    rows.push({
      seg: segId, share: t.share[labId] ?? 0, fit: f, leader: lead.lab, leaderFit: lead.fit, crown: f > lead.fit,
      rev: o ? units * def.pRef * o.model.price : 0, profit: o ? units * unitMargin(s, def, o.model) : 0,
    });
  }
  return { rows, rev: rows.reduce((a, r) => a + r.rev, 0), profit: rows.reduce((a, r) => a + r.profit, 0) };
}

export function autoPrice(s: GameState, m: Model): number {
  let best = 1, bestProfit = -Infinity;
  for (const p of PRICE_STEPS) {
    const profit = projectRevenue(s, m.lab, { ...m, price: p }).profit;
    if (profit > bestProfit) { best = p; bestProfit = profit; }
  }
  return best;
}

/** Move shares toward targets, reassign named accounts, and return each lab's revenue, serving cost and compute use. */
export function demandTick(s: GameState): Record<Id, { rev: number; cogs: number; cu: number }> {
  const out: Record<Id, { rev: number; cogs: number; cu: number }> = {};
  for (const [segId, seg] of Object.entries(s.segments)) {
    const def = SEGMENTS[segId];
    const t = targets(s, segId);
    const next: Record<Id, number> = {};
    for (const lab of new Set([...Object.keys(seg.share), ...Object.keys(t.share)])) {
      const v = (seg.share[lab] ?? 0) + (1 - def.inertia) * ((t.share[lab] ?? 0) - (seg.share[lab] ?? 0));
      if (v > 1e-4) next[lab] = v;
    }
    seg.share = next;
    for (const o of t.offers) {
      const units = (next[o.lab] ?? 0) * seg.size;
      const cu = units * def.load * o.model.attrs.cost;
      const e = (out[o.lab] ??= { rev: 0, cogs: 0, cu: 0 });
      e.rev += units * def.pRef * o.model.price;
      e.cogs += cu * s.market.computePrice;
      e.cu += cu;
    }
    reseat(s, segId);
  }
  return out;
}

/** Named accounts follow share: a lab with 40% of a segment holds about 40% of its accounts. */
function reseat(s: GameState, segId: Id): void {
  const seg = s.segments[segId];
  const def = SEGMENTS[segId];
  const n = seg.accounts.length;
  const want: Record<Id, number> = {};
  const labs = Object.keys(seg.share).sort((a, b) => seg.share[b] - seg.share[a]);
  for (const lab of labs) want[lab] = Math.round(seg.share[lab] * n);
  const have: Record<Id, number> = {};
  seg.accounts.forEach((lab, i) => {
    if (!lab) return;
    have[lab] = (have[lab] ?? 0) + 1;
    if (have[lab] > (want[lab] ?? 0)) {
      seg.accounts[i] = null; have[lab]--;
      if (lab === s.labId) s.log.push({ week: s.week, text: `${def.accounts[i]} dropped you.`, tone: 'bad', co: lab });
    }
  });
  for (const lab of labs) {
    while ((have[lab] ?? 0) < want[lab]) {
      const i = seg.accounts.indexOf(null);
      if (i < 0) break;
      seg.accounts[i] = lab;
      have[lab] = (have[lab] ?? 0) + 1;
      if (lab === s.labId) s.log.push({ week: s.week, text: `${def.accounts[i]} signed with you.`, tone: 'good', co: lab });
    }
  }
}
