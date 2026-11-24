// A training run, week by week: pay, progress, report, one call. Launch turns a run into a model.
import type { Blueprint, Call, Fx, GameState, Id, Model, Moment, Run, Vec, Verdict } from './types';
import { clamp, pick, rand, randn, sum } from './rand';
import { eligibleEmergences, resolve, RUSH, world } from './resolve';
import { autoPrice, fitOf, leader, projectRevenue } from './demand';
import { labPrice } from './supply';
import { MODALITIES, SEGMENTS, segmentsOf } from './content/modalities';
import { CALLS, emergenceCall, finalCall, midCall, smokeCall, type CallCtx } from './content/calls';
import { emergence, tech } from './content/tech';
import { QUIRKS, RIVAL_LABS } from './content/flavor';

const mean = (v: Vec): number => sum(v) / v.length;
export const money = (n: number): string => {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  return a >= 1e9 ? `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : `${sign}$${Math.round(a / 1e3)}k`;
};

export const trueCap = (run: Run): Vec => run.truth.rest.map((x, i) => x + run.mods.add[i] + (run.truth.g + sum(run.truth.e)) * run.mods.mult);
const beliefCap = (run: Run): Vec => run.belief.rest.map((x, i) => x + run.mods.add[i] + run.belief.g * run.mods.mult);

/** What the lab can see of a running model: a midpoint per axis and one standard deviation. Safe for the UI. */
export function band(run: Run): { mid: Vec; sd: number } {
  const t = trueCap(run), b = beliefCap(run);
  return { mid: t.map((x, i) => x + (b[i] - x) * (1 - run.revealed)), sd: run.sd0 * (1 - run.revealed) + 0.4 };
}

export const runAttrs = (run: Run) => ({
  cost: run.truth.attrs.cost * run.mods.cost, speed: run.truth.attrs.speed * run.mods.speed,
  trust: clamp(run.truth.attrs.trust + run.mods.trust, 0, 1.2),
});

export const weeklyCost = (_s: GameState, run: Run): number => run.cuPerWeek * run.price;

/** A not-yet-real model for projections. */
export function hypModel(s: GameState, run: Run, cap: Vec, price = 1): Model {
  const m: Model = {
    id: 'hyp:' + run.id, lab: run.lab, name: run.name, modality: run.bp.modality, cap, attrs: runAttrs(run), price,
    shipped: s.week, quirks: [], retired: false, arch: run.bp.arch, techniques: run.bp.techniques, params: 0, verdict: 'as expected',
  };
  return m;
}

function sched(run: Run): number {
  const W = run.weeksPlanned, t = run.weeksDone / W, t1 = 1 / W;
  const base = run.weeksDone <= 0 ? 0 : t <= 0.5 ? 0.15 + (0.35 * (t - t1)) / Math.max(1e-6, 0.5 - t1) : 0.5 + (0.3 * (t - 0.5)) / 0.5;
  return clamp(1 - (1 - clamp(base, 0, 0.8)) * (1 - 0.5 * run.r) + run.mods.reveal, 0, 0.93);
}

export function startRun(s: GameState, labId: Id, bp: Blueprint, name: string, handsOn: boolean): Run {
  const id = 'run' + s.nextId++;
  const t = resolve(s, labId, bp, 'true', id);
  const b = resolve(s, labId, bp, 'belief');
  const n = (p: string, sd: number): number => randn(s.seed, s.week, id, p) * sd;
  const run: Run = {
    id, lab: labId, name, bp, handsOn, start: s.week, weeksPlanned: bp.weeks, weeksDone: 0,
    cuPerWeek: bp.compute / bp.weeks, spent: 0, price: labPrice(s, labId) * RUSH[bp.weeks],
    truth: { g: t.g, e: [n('e1', 1.5), n('e2', 1.5), n('e3', 1.2)], rest: t.rest.map((x, i) => x + n('ax' + i, 0.8)), attrs: t.attrs },
    belief: { g: b.g, rest: b.rest },
    mods: { mult: 1, add: [0, 0, 0, 0], trust: 0, cost: 1, speed: 1, reveal: 0 },
    sd0: t.sd0, r: t.r, revealed: 0, extends: 0, instab: t.instab, flops: t.flops,
    forecast: b.g + mean(b.rest), reports: [], call: null, outcome: null, seen: [], flags: [], emergence: null, status: 'running',
  };
  run.revealed = sched(run);
  // At most one emergence per run, planned for a week between the smoke test and the final beat.
  for (const e of eligibleEmergences(s, labId, bp, t.flops)) {
    if (rand(s.seed, s.week, id, 'em:' + e.id) < 0.3) {
      let wk = 2 + Math.floor(rand(s.seed, s.week, id, 'emwk') * Math.max(1, bp.weeks - 3));
      if (wk === Math.ceil(bp.weeks / 2)) wk++;
      run.emergence = { id: e.id, week: Math.min(wk, bp.weeks - 1) };
      break;
    }
  }
  // Experiments reveal hidden synergies and data quality up front, in proportion to how thorough they were.
  if (labId === s.labId) for (const x of t.syn) if (!x.known && rand(s.seed, s.week, id, 'syn:' + x.key) < t.r) learnSyn(s, x.key);
  s.runs[id] = run;
  return run;
}

function learnSyn(s: GameState, key: string): void {
  if (s.known['syn:' + key]) return;
  s.known['syn:' + key] = 1;
  const v = world(s.seed, 'syn:' + key);
  const [a, b] = key.split(':');
  const nameOf = (x: string): string => tech(x)?.name ?? Object.values(MODALITIES).flatMap((m) => m.data).find((d) => d.id === x)?.name ?? x;
  s.log.push({ week: s.week, tone: v > 0 ? 'good' : v < 0 ? 'bad' : 'info', co: s.labId,
    text: `Notebook: ${nameOf(a)} + ${nameOf(b)} ${v > 0 ? 'click together' : v < 0 ? 'fight each other' : 'do nothing special together'}.` });
}

// --- Effects -----------------------------------------------------------------------------------------------------

export interface Chip { text: string; tone: 'good' | 'bad' | 'info' }

/** Readable summary of an effect list, used on option buttons and in outcomes. */
export function fxChips(fx: Fx[], axes: string[]): Chip[] {
  const out: Chip[] = [];
  const pct = (m: number): string => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;
  for (const f of fx) {
    if (f.k === 'weeks') out.push({ text: `${f.n > 0 ? '+' : ''}${f.n} week${Math.abs(f.n) === 1 ? '' : 's'}`, tone: f.n > 0 ? 'bad' : 'good' });
    else if (f.k === 'cap') {
      if (f.mult != null) out.push({ text: `${pct(f.mult)} capability`, tone: f.mult >= 1 ? 'good' : 'bad' });
      if (f.add) {
        if (f.add.every((x) => x === f.add![0])) out.push({ text: `${f.add[0] > 0 ? '+' : ''}${f.add[0]} all skills`, tone: f.add[0] >= 0 ? 'good' : 'bad' });
        else f.add.forEach((x, i) => { if (x) out.push({ text: `${x > 0 ? '+' : ''}${Math.round(x * 10) / 10} ${axes[i]}`, tone: x > 0 ? 'good' : 'bad' }); });
      }
    } else if (f.k === 'attr') {
      if (f.trust) out.push({ text: `Trust ${f.trust > 0 ? 'up' : 'down'}`, tone: f.trust > 0 ? 'good' : 'bad' });
      if (f.cost) out.push({ text: `${pct(f.cost)} serving cost`, tone: f.cost < 1 ? 'good' : 'bad' });
      if (f.speed) out.push({ text: `${pct(f.speed)} speed`, tone: f.speed > 1 ? 'good' : 'bad' });
    } else if (f.k === 'cash') out.push({ text: `${f.n > 0 ? '+' : ''}${money(f.n)}`, tone: f.n > 0 ? 'good' : 'bad' });
    else if (f.k === 'reveal') out.push({ text: 'Sharper forecast', tone: 'good' });
    else if (f.k === 'lab') {
      if (f.talent) out.push({ text: `Talent ${f.talent > 0 ? 'up' : 'down'}`, tone: f.talent > 0 ? 'good' : 'bad' });
      if (f.hype) out.push({ text: `Hype ${f.hype > 0 ? 'up' : 'down'}`, tone: f.hype > 0 ? 'good' : 'bad' });
      if (f.brand) out.push({ text: `Brand ${f.brand > 0 ? 'up' : 'down'}`, tone: f.brand > 0 ? 'good' : 'bad' });
    } else if (f.k === 'flag') { if (f.id === 'contaminated' || f.id === 'teased') out.push({ text: 'May bite at launch', tone: 'bad' }); }
    else if (f.k === 'reroll') out.push({ text: 'Fresh luck', tone: 'info' });
    else if (f.k === 'learn') out.push({ text: `Learn ${tech(f.tech).name}`, tone: 'good' });
    else if (f.k === 'kill') out.push({ text: 'Run ends', tone: 'bad' });
    else if (f.k === 'ship') out.push({ text: 'Launch', tone: 'good' });
    else if (f.k === 'risk') {
      const bad = fxChips(f.bad, axes).map((c) => c.text).join(', ');
      const good = fxChips(f.good, axes).map((c) => c.text).join(', ');
      out.push({ text: `${Math.round(f.p * 100)}% chance: ${bad || 'nothing'}`, tone: 'bad' });
      if (good) out.push({ text: `otherwise: ${good}`, tone: 'good' });
    }
  }
  return out;
}

export function applyFx(s: GameState, run: Run, fx: Fx[], salt: string, roll: { p: number; bad: boolean }[]): void {
  const co = s.companies[run.lab], lab = co.lab!;
  fx.forEach((f, i) => {
    if (f.k === 'weeks') run.weeksPlanned = Math.max(run.weeksDone, run.weeksPlanned + f.n);
    else if (f.k === 'cap') { if (f.mult != null) run.mods.mult *= f.mult; if (f.add) f.add.forEach((x, j) => { run.mods.add[j] += x; }); }
    else if (f.k === 'attr') { run.mods.trust += f.trust ?? 0; run.mods.cost *= f.cost ?? 1; run.mods.speed *= f.speed ?? 1; }
    else if (f.k === 'cash') co.cash += f.n;
    else if (f.k === 'reveal') run.mods.reveal += f.frac;
    else if (f.k === 'lab') { lab.talent = clamp(lab.talent + (f.talent ?? 0), 0.7, 1.3); lab.hype = clamp(lab.hype + (f.hype ?? 0), 0, 1.5); lab.brand = clamp(lab.brand + (f.brand ?? 0), 0, 1); }
    else if (f.k === 'flag') run.flags.push(f.id);
    else if (f.k === 'reroll') run.truth.e[0] = randn(s.seed, s.week, run.id, 'reroll' + run.weeksDone) * 1.5;
    else if (f.k === 'learn') { if (!lab.techniques.includes(f.tech)) lab.techniques.push(f.tech); }
    else if (f.k === 'kill') run.status = 'dead';
    else if (f.k === 'risk') {
      const bad = rand(s.seed, s.week, run.id, `risk:${salt}:${i}:${run.seen.length}`) < f.p;
      roll.push({ p: f.p, bad });
      applyFx(s, run, bad ? f.bad : f.good, salt + i, roll);
    }
  });
  run.revealed = Math.max(run.revealed, sched(run));
}

// --- Calls -------------------------------------------------------------------------------------------------------

function ctxOf(s: GameState, run: Run): CallCtx {
  const segs = segmentsOf(run.bp.modality);
  const b = band(run);
  const proj = projectRevenue(s, run.lab, hypModel(s, run, b.mid));
  const pivots = [...proj.rows].sort((x, y) => y.rev - x.rev).slice(0, 2).map((r) => SEGMENTS[r.seg]);
  // Polish the axis that matters most to the segment this model earns the most in.
  const top = pivots[0] ?? segs[0];
  const bestAxis = top.w.indexOf(Math.max(...top.w));
  let rivalSoon: CallCtx['rivalSoon'] = null;
  for (const r of Object.values(s.runs)) {
    const left = r.weeksPlanned - r.weeksDone;
    if (r.status === 'running' && r.lab !== run.lab && r.bp.modality === run.bp.modality && left <= 3 && (!rivalSoon || left < rivalSoon.weeks)) rivalSoon = { lab: r.lab, weeks: Math.max(1, left) };
  }
  return {
    // A week is worth its compute bill plus part of the profit the model is not earning yet.
    s, run, wk: weeklyCost(s, run) + 0.5 * Math.max(0, proj.profit - projectRevenue(s, run.lab).profit), u: (p) => rand(s.seed, s.week, run.id, p), rivalSoon, pivots, bestAxis,
    reading: run.truth.e[0] + randn(s.seed, s.week, run.id, 'reading') * 0.8,
  };
}

function nextCall(s: GameState, run: Run): Call {
  const c = ctxOf(s, run);
  if (run.weeksDone >= run.weeksPlanned) return { def: 'beat.final', ...finalCall(c) };
  if (run.weeksDone === 1) return { def: 'beat.smoke', ...smokeCall(c) };
  if (run.weeksDone >= Math.ceil(run.bp.weeks / 2) && !run.seen.includes('beat.mid')) return { def: 'beat.mid', ...midCall(c) };
  if (run.emergence && run.weeksDone >= run.emergence.week && !run.seen.includes('emergence')) return { def: 'emergence', ...emergenceCall(c, emergence(run.emergence.id)) };
  // Drawn call: weighted, no repeat within a run.
  const weigh = (ds: typeof CALLS) => ds.map((d) => ({ d, w: d.weight(c) })).filter((x) => x.w > 0);
  let pool = weigh(CALLS.filter((d) => !run.seen.includes(d.id)));
  if (!pool.length) pool = weigh(CALLS); // a very long run has seen everything once
  let x = c.u('draw') * sum(pool.map((p) => p.w));
  const def = (pool.find((p) => (x -= p.w) < 0) ?? pool[0]).d;
  return { def: def.id, ...def.make(c) };
}

export function answerCall(s: GameState, run: Run, option: number): void {
  const call = run.call;
  if (!call || !call.options[option]) return;
  const o = call.options[option];
  const roll: { p: number; bad: boolean }[] = [];
  const before = { ...run.mods, add: [...run.mods.add] };
  const wBefore = run.weeksPlanned, cashBefore = s.companies[run.lab].cash, tBefore = s.companies[run.lab].lab!.techniques.length;
  if (call.def === 'beat.final' && option === 1) run.extends++;
  applyFx(s, run, o.fx, call.def, roll);
  run.seen.push(call.def);
  s.callCount[call.def] = (s.callCount[call.def] ?? 0) + 1;
  // Outcome lines describe what actually happened, including how a risk fell.
  const axes = MODALITIES[run.bp.modality].axes;
  const done: Fx[] = [];
  if (run.weeksPlanned !== wBefore) done.push({ k: 'weeks', n: run.weeksPlanned - wBefore });
  if (Math.abs(run.mods.mult / before.mult - 1) > 1e-9) done.push({ k: 'cap', mult: run.mods.mult / before.mult });
  const dAdd = run.mods.add.map((x, i) => Math.round((x - before.add[i]) * 10) / 10);
  if (dAdd.some((x) => x)) done.push({ k: 'cap', add: dAdd });
  if (run.mods.trust !== before.trust) done.push({ k: 'attr', trust: run.mods.trust - before.trust });
  const dCash = s.companies[run.lab].cash - cashBefore;
  if (dCash) done.push({ k: 'cash', n: dCash });
  const lab = s.companies[run.lab].lab!;
  if (lab.techniques.length > tBefore) done.push({ k: 'learn', tech: lab.techniques[lab.techniques.length - 1] });
  if (run.status === 'dead') done.push({ k: 'kill' });
  run.outcome = { title: call.title, picked: o.label, lines: fxChips(done, axes).map((c) => c.text), roll: roll[0] };
  run.call = null;
  if (run.status === 'dead') s.log.push({ week: s.week, text: `${run.name} was killed after ${run.weeksDone} weeks.`, tone: 'info', co: run.lab });
  if (o.fx.some((f) => f.k === 'ship')) launch(s, run);
}

/** One week of a run. Hands-on runs get a call; delegated runs resolve through the CEO. */
export function runTick(s: GameState, run: Run): void {
  if (run.status !== 'running') return;
  const co = s.companies[run.lab];
  const cost = weeklyCost(s, run);
  co.cash -= cost;
  run.spent += cost;
  run.weeksDone++;
  run.revealed = Math.max(run.revealed, sched(run));
  const b = band(run);
  const t = Math.min(1, run.weeksDone / run.weeksPlanned);
  const final = 2.9 - (run.truth.g + sum(run.truth.e)) / 76;
  run.reports.push({
    week: s.week, mid: mean(b.mid), sd: b.sd, note: '',
    loss: final + (4.2 - final) * Math.exp(-4 * t) + randn(s.seed, s.week, run.id, 'loss') * 0.02,
  });
  if (run.handsOn) {
    run.outcome = null;
    run.call = nextCall(s, run);
    const auto = s.standing[run.call.def];
    if (auto != null && run.call.options[auto]) answerCall(s, run, auto);
    return;
  }
  // Delegated: incidents shave a little, good CEOs lose less, and the model ships when training ends.
  if (rand(s.seed, s.week, run.id, 'auto') < 0.1 + 0.25 * run.instab) {
    run.mods.mult *= 1 - 0.03 * rand(s.seed, s.week, run.id, 'autoloss') * (1.3 - co.ceo.skill);
    if (rand(s.seed, s.week, run.id, 'autoslip') < 0.3) run.weeksPlanned++;
  }
  if (run.emergence && run.weeksDone === run.emergence.week) {
    const e = emergence(run.emergence.id);
    run.mods.add[e.axis] += e.add;
    if (e.bad) run.mods.trust -= 0.1;
    run.flags.push('em:' + e.id);
  }
  if (run.weeksDone >= run.weeksPlanned) launch(s, run);
}

// --- Launch ------------------------------------------------------------------------------------------------------

export function launch(s: GameState, run: Run): Model {
  const co = s.companies[run.lab], lab = co.lab!;
  const mine = run.lab === s.labId && run.handsOn;
  const segs = segmentsOf(run.bp.modality);
  const before = band(run);
  run.revealed = 1;
  const cap = trueCap(run);
  const actual = mean(cap);
  const z = (actual - run.forecast) / Math.max(1.5, run.sd0);
  const verdict: Verdict = z > 1.5 ? 'banger' : z > 0.5 ? 'solid' : z >= -0.5 ? 'as expected' : z >= -1.5 ? 'mid' : 'dud';

  const attrs = runAttrs(run);
  const u = rand(s.seed, s.week, run.id, 'quirks');
  const quirks = [...new Set(Array.from({ length: u < 0.45 ? 0 : u < 0.85 ? 1 : 2 }, (_, i) => pick(QUIRKS, rand(s.seed, s.week, run.id, 'quirk' + i)).id))];
  for (const q of quirks) { const d = QUIRKS.find((x) => x.id === q)!; attrs.trust = clamp(attrs.trust + d.trust, 0, 1.2); lab.hype = clamp(lab.hype + d.hype, 0, 1.5); }
  const scandal = run.flags.includes('contaminated') && rand(s.seed, s.week, run.id, 'scandal') < 0.35;
  if (scandal) { attrs.trust = clamp(attrs.trust - 0.3, 0, 1.2); lab.brand = clamp(lab.brand - 0.1, 0, 1); }

  // Who held the crowns before this model existed.
  const prior = segs.map((d) => leader(s, d.id, run.lab));
  const def = RIVAL_LABS.find((r) => r.id === run.lab);
  const count = Object.values(s.models).filter((m) => m.lab === run.lab).length;
  const model: Model = {
    id: 'm' + s.nextId++, lab: run.lab, name: run.handsOn ? run.name : `${def?.series ?? co.name.split(' ')[0]} ${count + 1}`, modality: run.bp.modality,
    cap, attrs, price: 1, shipped: s.week, quirks, retired: false, arch: run.bp.arch, techniques: run.bp.techniques,
    params: Math.sqrt(run.flops / 120) * Math.pow(4, run.bp.sizeBias), verdict,
  };
  s.models[model.id] = model;
  model.price = autoPrice(s, model);
  run.status = 'shipped';

  const rows = segs.map((d, i) => {
    const score = fitOf(d, cap), mid = fitOf(d, before.mid);
    return { seg: d.id, score, lo: mid - 1.3 * before.sd, hi: mid + 1.3 * before.sd, leader: prior[i].lab, leaderScore: prior[i].fit, crown: score > prior[i].fit };
  });
  const won = rows.filter((r) => r.crown).length;
  const fresh = Math.min(1, (s.week - lab.lastLaunch) / 12);
  lab.hype = clamp(lab.hype + (0.12 * won + 0.1 * Math.max(0, z)) * fresh - (verdict === 'dud' ? 0.1 : 0), 0, 1.5);
  lab.brand = clamp(lab.brand + 0.03 * won, 0, 1);
  if (run.flags.includes('teased') && (verdict === 'mid' || verdict === 'dud')) { lab.hype = clamp(lab.hype - 0.25, 0, 1.5); lab.brand = clamp(lab.brand - 0.03, 0, 1); }
  if (run.flags.includes('published')) for (const c of Object.values(s.companies)) if (c.lab && c.id !== run.lab) c.lab.talent = clamp(c.lab.talent + 0.01, 0.7, 1.3);
  let promise: 'hit' | 'miss' | null = null;
  if (run.bp.promise) {
    promise = fitOf(SEGMENTS[run.bp.promise.seg], cap) >= run.bp.promise.target ? 'hit' : 'miss';
    lab.hype = clamp(lab.hype + (promise === 'hit' ? 0.3 : -0.3), 0, 1.5);
    lab.brand = clamp(lab.brand + (promise === 'hit' ? 0.04 : -0.06), 0, 1);
  }
  lab.lastLaunch = s.week;
  lab.maxCompute = Math.max(lab.maxCompute, run.bp.compute);
  for (const k of ['arch:' + run.bp.arch, ...run.bp.techniques.map((t) => 'tech:' + t), ...run.flags.filter((f) => f.startsWith('em:'))]) if (!lab.history.includes(k)) lab.history.push(k);

  // The market only learns the last piece of news on launch day: the move is the surprise against last week's band.
  const surprise = clamp(0.06 * ((actual - mean(before.mid)) / 1.2) + 0.03 * won - (scandal ? 0.1 : 0), -0.25, 0.35);
  co.price *= 1 + surprise;
  const rivalMoves: { co: Id; pct: number }[] = [];
  for (const c of Object.values(s.companies)) {
    if (!c.lab || c.id === run.lab || !Object.values(s.models).some((m) => m.lab === c.id && m.modality === run.bp.modality)) continue;
    const pct = -0.3 * surprise;
    c.price *= 1 + pct;
    rivalMoves.push({ co: c.id, pct });
  }

  if (mine) {
    for (const x of resolve(s, run.lab, run.bp, 'true', run.id).syn) learnSyn(s, x.key);
    for (const [kind, share] of Object.entries(run.bp.mix)) if (share >= 0.2 && !s.known['dq:' + kind]) {
      s.known['dq:' + kind] = 1;
      const v = world(s.seed, 'dq:' + kind);
      if (Math.abs(v) > 0.04) s.log.push({ week: s.week, tone: v > 0 ? 'good' : 'bad', co: run.lab, text: `Notebook: ${MODALITIES[run.bp.modality].data.find((d) => d.id === kind)!.name} turned out ${v > 0 ? 'cleaner' : 'dirtier'} than the label said.` });
    }
    const proj = projectRevenue(s, run.lab);
    const flips = segs.flatMap((d) => {
      const seg = s.segments[d.id];
      const gain = Math.round((proj.rows.find((r) => r.seg === d.id)?.share ?? 0) * seg.accounts.length) - seg.accounts.filter((a) => a === run.lab).length;
      const takeable = seg.accounts.map((a, i) => ({ a, i })).filter((x) => x.a !== run.lab).sort((x, y) => (seg.share[y.a ?? ''] ?? 0) - (seg.share[x.a ?? ''] ?? 0));
      return takeable.slice(0, Math.max(0, gain)).map((x) => ({ account: d.accounts[x.i], seg: d.id, from: x.a }));
    });
    const m: Moment = { kind: 'launch', model: model.id, lab: run.lab, rows, verdict, forecast: run.forecast, actual, quirks, flips,
      rev: proj.rev, profit: proj.profit, move: surprise, rivalMoves, promise, scandal };
    s.moments.push(m);
  }
  s.log.push({ week: s.week, co: run.lab, tone: mine ? 'good' : won ? 'bad' : 'info',
    text: `${co.name} ships ${model.name}${won ? ` and takes ${won} crown${won === 1 ? '' : 's'}` : ''}. Verdict: ${verdict}.` });
  return model;
}
