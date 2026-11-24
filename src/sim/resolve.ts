// Blueprint physics. One function, two modes: 'true' is what the run will do, 'belief' is what the lab expects.
import type { Attrs, Blueprint, GameState, Id, Modality, Vec } from './types';
import { clamp, rand, randn } from './rand';
import { MODALITIES } from './content/modalities';
import { arch, archsOf, EMERGENCES, TECHS, tech, type EmergenceDef, type TechDef } from './content/tech';

export const K_F = 5e18; // FLOPs per compute-week
export const N_REF = 3e9; // params of a "normal" model at the start of the game
export const C0 = 0.015; // compute units to serve one unit of demand at N_REF
export const RUSH: Record<number, number> = { 4: 1.25, 6: 1, 8: 0.85 }; // price multiplier by run length
export const SLOTS = 3;
export const DIFFUSION = 0.35;

/** Best average capability a rival shipped at least 12 weeks ago. */
export function frontier(s: GameState, m: Modality, notLab: Id): number {
  let best = 0;
  for (const x of Object.values(s.models)) {
    if (x.modality !== m || x.lab === notLab || x.shipped > s.week - 12) continue;
    best = Math.max(best, x.cap.reduce((p, v) => p + v, 0) / 4);
  }
  return best;
}

/** Hidden per-game truths, derived from the seed. Never stored, never shown until discovered. */
export function world(seed: number, key: string): number {
  if (key.startsWith('dq:')) return randn(seed, 0, key, 'world') * 0.07;
  if (key.startsWith('syn:')) { const u = rand(seed, 0, key, 'world'); return u < 0.25 ? -3 : u > 0.75 ? 3 : 0; }
  if (key.startsWith('synax:')) return Math.floor(rand(seed, 0, key, 'world') * 4);
  return 0;
}

export function dataUnique(s: GameState, labId: Id, m: Modality, kind: Id): number {
  const def = MODALITIES[m].data.find((d) => d.id === kind)!;
  const level = s.companies[labId].lab?.data[kind] ?? 0;
  return def.unique * Math.pow(1.017, s.week) * (1 + 0.6 * level);
}

export function availableTechs(s: GameState, labId: Id, m: Modality): TechDef[] {
  const own = s.companies[labId].lab?.techniques ?? [];
  return TECHS.filter((t) => t.mods.includes(m) && (t.week <= s.week || own.includes(t.id)));
}

/** Pairs whose hidden synergy this blueprint is exposed to: technique pairs, and techniques with heavy data kinds. */
export function synergyKeys(bp: Blueprint): string[] {
  const ts = [...bp.techniques].sort();
  const keys: string[] = [];
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) keys.push(`${ts[i]}:${ts[j]}`);
  for (const [kind, share] of Object.entries(bp.mix)) if (share >= 0.3) for (const t of ts) keys.push(`${t}:${kind}`);
  return keys;
}

export function noveltyOf(s: GameState, labId: Id, bp: Blueprint): number {
  const lab = s.companies[labId].lab!;
  let n = 0.2;
  if (!lab.history.includes('arch:' + bp.arch)) n += 0.25;
  for (const t of bp.techniques) if (!lab.history.includes('tech:' + t)) n += 0.15;
  if (bp.compute > 3 * lab.maxCompute) n += 0.2;
  return clamp(n, 0.2, 1);
}

export interface Resolved {
  g: number; rest: Vec; attrs: Attrs;
  N: number; D: number; flops: number; q: number; repeat: number;
  novelty: number; r: number; sd0: number; instab: number;
  syn: { key: string; value: number; axis: number; known: boolean }[];
}

export function resolve(s: GameState, labId: Id, bp: Blueprint, mode: 'true' | 'belief', runKey = ''): Resolved {
  const lab = s.companies[labId].lab!;
  const mod = MODALITIES[bp.modality];
  const a = arch(bp.arch);
  const ts = bp.techniques.map(tech);
  const truth = mode === 'true';
  const knows = (key: string): boolean => truth || !!s.known[key] || labId !== s.labId;

  // Scale: split the scale compute between parameters and tokens.
  const Cs = Math.max(1e-6, bp.compute * bp.split.scale * a.eff * ts.reduce((m, t) => m * (t.computeMult ?? 1), 1));
  const flops = K_F * Cs;
  const nStar = Math.sqrt(flops / 120);
  const N = nStar * Math.pow(4, bp.sizeBias);
  const D = (20 * nStar) / Math.pow(4, bp.sizeBias);

  // Data: unique tokens count fully, repeats count half. Quality is believed until the lab has trained on the kind.
  let dEff = 0, q = 0, repeated = 0;
  const focus: Vec = [0, 0, 0, 0];
  for (const d of mod.data) {
    const share = bp.mix[d.id] ?? 0;
    if (share <= 0) continue;
    const want = D * share;
    const unique = Math.min(want, dataUnique(s, labId, bp.modality, d.id));
    dEff += unique + 0.5 * (want - unique);
    repeated += want - unique;
    const level = lab.data[d.id] ?? 0;
    q += share * clamp(d.q + 0.04 * level + (knows('dq:' + d.id) ? world(s.seed, 'dq:' + d.id) : 0), 0.2, 1);
    d.A.forEach((x, i) => { focus[i] += share * x; });
  }
  const loss = 1.69 + 406.4 / Math.pow(N, 0.34) + 410.7 / Math.pow(dEff * (0.5 + q), 0.28);
  const G = (100 * (2.856 - loss)) / (2.856 - 1.537);

  // Experiments: buy information, and recover part of a hidden tuning loss that grows with novelty.
  const novelty = noveltyOf(s, labId, bp);
  const r = 1 - Math.exp(-(bp.compute * bp.split.exp) / (0.08 * Math.max(1e-6, bp.compute * bp.split.scale)));
  const u = truth ? rand(s.seed, s.week, runKey, 'tune') : 0.5;
  const tau = 1 - 0.1 * novelty * u * (1 - r);
  const g0 = G * tau + (lab.talent - 1) * 15;

  // Everything additive: data shape, architecture, techniques, size tilt, post-training, hidden synergies.
  const rest: Vec = focus.map((f) => clamp(6 * Math.log2(4 * Math.max(f, 1e-3)), -12, 9));
  const addV = (v: Vec | undefined, k = 1): void => { if (v) v.forEach((x, i) => { rest[i] += x * k; }); };
  addV(a.cap);
  for (const t of ts) addV(t.cap);
  addV(mod.sizeTilt, bp.sizeBias);
  const pf = 1 - Math.exp(-(bp.split.post / Math.max(1e-6, bp.split.scale)) / 0.08);
  let distill = 1;
  if (bp.post === 'distill') { distill = 1 - 0.4 * pf; addV([-2, -2, -2, -2], pf); }
  else rest.forEach((_, i) => { rest[i] += (i === bp.post ? 4 : -1) * pf; });
  const syn = synergyKeys(bp).map((key) => ({
    key, value: world(s.seed, 'syn:' + key), axis: world(s.seed, 'synax:' + key), known: knows('syn:' + key),
  }));
  for (const x of syn) if (x.known) rest[x.axis] += x.value;
  // Diffusion: everyone learns from what the frontier shipped a quarter ago, so laggards close part of the gap for free.
  const own = g0 + rest.reduce((p, x) => p + x, 0) / 4;
  const g = g0 + DIFFUSION * Math.max(0, frontier(s, bp.modality, labId) - own);

  const rel = N / N_REF;
  const attrs: Attrs = {
    cost: C0 * a.cost * Math.pow(rel, 0.7) * ts.reduce((m, t) => m * (t.cost ?? 1), 1) * distill,
    speed: a.speed * Math.pow(rel, -0.3) * ts.reduce((m, t) => m * (t.speed ?? 1), 1),
    trust: clamp(0.7 + ts.reduce((m, t) => m + (t.trust ?? 0), 0), 0, 1.2),
  };
  const instab = a.instab + ts.reduce((m, t) => m + (t.instab ?? 0), 0) + 0.1 * Math.max(0, Math.log10(rel));
  return {
    g, rest, attrs, N, D, flops, q, repeat: repeated / D, novelty, r,
    sd0: Math.sqrt(3.4 + Math.pow(3 * novelty * (1 - r), 2)), instab, syn,
  };
}

/** Emergences this blueprint is big enough to trigger and the lab has not seen yet. */
export function eligibleEmergences(s: GameState, labId: Id, bp: Blueprint, flops: number): EmergenceDef[] {
  const seen = s.companies[labId].lab!.history;
  return EMERGENCES.filter((e) => e.mods.includes(bp.modality) && e.at <= Math.log10(flops) && !seen.includes('em:' + e.id));
}

export function defaultBlueprint(s: GameState, labId: Id, m: Modality, compute: number): Blueprint {
  const data = MODALITIES[m].data;
  const mix = Object.fromEntries(data.map((d) => [d.id, 1 / data.length]));
  return { modality: m, arch: archsOf(m)[0].id, compute, weeks: 6, split: { scale: 0.85, exp: 0.1, post: 0.05 }, sizeBias: 0, mix, techniques: [], post: 0 };
}

export function validate(s: GameState, labId: Id, bp: Blueprint): string | null {
  const mod = MODALITIES[bp.modality];
  if (!mod) return 'Unknown modality.';
  if (mod.unlockWeek > s.week) return `${mod.name} models are not possible yet.`;
  if (!(bp.compute >= 20)) return 'A run needs at least 20 compute-weeks.';
  if (![4, 6, 8].includes(bp.weeks)) return 'Runs last 4, 6 or 8 weeks.';
  const sp = bp.split;
  if (Math.abs(sp.scale + sp.exp + sp.post - 1) > 0.01 || sp.scale < 0.5 || sp.exp < 0 || sp.post < 0) return 'The compute split must add up, with at least half on scale.';
  const mixSum = Object.values(bp.mix).reduce((x, y) => x + y, 0);
  if (Math.abs(mixSum - 1) > 0.01 || Object.keys(bp.mix).some((k) => !mod.data.some((d) => d.id === k) || bp.mix[k] < 0)) return 'The data mix must add up to 100%.';
  if (!arch(bp.arch)?.mods.includes(bp.modality)) return 'That architecture does not fit this kind of model.';
  if (bp.techniques.length > SLOTS || new Set(bp.techniques).size !== bp.techniques.length) return `At most ${SLOTS} different techniques.`;
  const avail = availableTechs(s, labId, bp.modality).map((t) => t.id);
  if (bp.techniques.some((t) => !avail.includes(t))) return 'A technique is not available yet.';
  if (Math.abs(bp.sizeBias) > 1) return 'Size bias out of range.';
  if (bp.post !== 'distill' && !(bp.post >= 0 && bp.post < 4)) return 'Pick an axis to polish.';
  return null;
}
