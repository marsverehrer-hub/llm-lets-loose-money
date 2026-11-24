// Read-only selectors for the UI and the bots. Nothing here exposes a run's hidden truth.
import type { Attrs, Blueprint, GameState, Id, Run, Vec } from './types';
import { sum } from './rand';
import { check } from './apply';
import { autoPrice, fitOf, leader, projectRevenue, type Projection } from './demand';
import { resolve, RUSH, world } from './resolve';
import { band, hypModel, weeklyCost } from './run';
import { labPrice } from './supply';
import { MODALITIES, segmentsOf } from './content/modalities';
import { tech } from './content/tech';

export interface BenchRow { seg: Id; lo: number; mid: number; hi: number; leader: Id | null; leaderFit: number }
export interface Forecast {
  error: string | null;
  weeklyCost: number; totalCost: number;
  cap: Vec; sd: number; attrs: Attrs; rows: BenchRow[];
  price: number; profit: [number, number, number]; rev: number; // weekly, low / mid / high
  proj: Projection; params: number; tokens: number; repeat: number; novelty: number; r: number; instab: number;
  reasons: string[];
  syn: { a: string; b: string; value: number; axis: number }[];
}

const shift = (cap: Vec, d: number): Vec => cap.map((x) => x + d);

function benchRows(s: GameState, labId: Id, m: Blueprint['modality'], mid: Vec, sd: number): BenchRow[] {
  return segmentsOf(m).map((d) => {
    const lead = leader(s, d.id, labId);
    const f = fitOf(d, mid);
    return { seg: d.id, lo: f - 1.3 * sd, mid: f, hi: f + 1.3 * sd, leader: lead.lab, leaderFit: lead.fit };
  });
}

const nameOf = (x: string): string => tech(x)?.name ?? Object.values(MODALITIES).flatMap((m) => m.data).find((d) => d.id === x)?.name ?? x;

/** What the lab expects from a blueprint before it starts: capability band, bill, and the money it should make. */
export function forecast(s: GameState, bp: Blueprint): Forecast {
  const b = resolve(s, s.labId, bp, 'belief');
  const cap = b.rest.map((x) => x + b.g);
  const sd = b.sd0 * (1 - 0.5 * b.r) + 0.4;
  const weekly = (bp.compute / bp.weeks) * labPrice(s, s.labId) * RUSH[bp.weeks];
  const hyp = (c: Vec, price = 1) => ({
    id: 'hyp:new', lab: s.labId, name: '', modality: bp.modality, cap: c, attrs: b.attrs, price, shipped: s.week, quirks: [], retired: false,
    arch: bp.arch, techniques: bp.techniques, params: b.N, verdict: 'as expected' as const,
  });
  const base = projectRevenue(s, s.labId).profit;
  const price = autoPrice(s, hyp(cap));
  const mid = projectRevenue(s, s.labId, hyp(cap, price));
  const gain = (c: Vec): number => projectRevenue(s, s.labId, hyp(c, price)).profit - base;
  const reasons: string[] = [];
  if (b.novelty > 0.5 && b.r < 0.5) reasons.push('New territory with thin experiments: wide band, and some quality left on the table.');
  else if (b.novelty > 0.5) reasons.push('New territory for your lab. Experiments are earning their keep.');
  if (b.novelty <= 0.35 && b.r > 0.6) reasons.push('You have built this before. Experiments are mostly wasted here.');
  if (b.repeat > 0.15) reasons.push(`${Math.round(b.repeat * 100)}% of the tokens are repeats. License more data, shift the mix or build a bigger model.`);
  if (b.instab > 0.5) reasons.push('Unstable recipe: expect more incidents mid-run.');
  if (b.attrs.cost * labPrice(s, s.labId) > 0.8 * 400) reasons.push('Too costly to serve cheap segments. It will only sell where prices are high.');
  return {
    error: check(s, { t: 'startRun', bp, name: 'x' }),
    weeklyCost: weekly, totalCost: weekly * bp.weeks, cap, sd, attrs: b.attrs, rows: benchRows(s, s.labId, bp.modality, cap, sd),
    price, profit: [gain(shift(cap, -1.3 * sd)), gain(cap), gain(shift(cap, 1.3 * sd))], rev: mid.rev, proj: mid,
    params: b.N, tokens: b.D, repeat: b.repeat, novelty: b.novelty, r: b.r, instab: b.instab, reasons,
    syn: b.syn.filter((x) => s.known['syn:' + x.key]).map((x) => ({ a: nameOf(x.key.split(':')[0]), b: nameOf(x.key.split(':')[1]), value: x.value, axis: x.axis })),
  };
}

export interface RunView {
  rows: BenchRow[]; mid: Vec; sd: number; weeklyCost: number; weeksLeft: number;
  proj: Projection; profit: number; attrs: Attrs;
}

/** A running model as the lab sees it this week. */
export function runView(s: GameState, run: Run): RunView {
  const b = band(run);
  const m = hypModel(s, run, b.mid);
  m.price = autoPrice(s, m);
  const proj = projectRevenue(s, run.lab, m);
  return {
    rows: benchRows(s, run.lab, run.bp.modality, b.mid, b.sd), mid: b.mid, sd: b.sd, weeklyCost: weeklyCost(s, run),
    weeksLeft: Math.max(0, run.weeksPlanned - run.weeksDone), proj, profit: proj.profit - projectRevenue(s, run.lab).profit, attrs: m.attrs,
  };
}

/** Everything the lab has written in its notebook: known synergies and data surprises. */
export function notebook(s: GameState): { text: string; tone: 'good' | 'bad' | 'info' }[] {
  return Object.keys(s.known).map((k) => {
    const v = world(s.seed, k);
    if (k.startsWith('syn:')) {
      const [a, b] = k.slice(4).split(':');
      const axis = world(s.seed, 'synax:' + k.slice(4));
      const ax = Object.values(MODALITIES).find((m) => m.data.some((d) => d.id === b) || tech(a)?.mods.includes(m.id))?.axes[axis] ?? '';
      return { text: `${nameOf(a)} + ${nameOf(b)}: ${v > 0 ? '+3 ' + ax : v < 0 ? '-3 ' + ax : 'no effect'}`, tone: v > 0 ? 'good' as const : v < 0 ? 'bad' as const : 'info' as const };
    }
    return { text: `${nameOf(k.slice(3))}: ${v > 0.02 ? 'cleaner than labelled' : v < -0.02 ? 'dirtier than labelled' : 'as labelled'}`, tone: v > 0.02 ? 'good' as const : v < -0.02 ? 'bad' as const : 'info' as const };
  });
}

export const meanCap = (cap: Vec): number => sum(cap) / cap.length;
