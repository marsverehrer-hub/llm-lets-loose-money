// Deal flow: offers on the Desk, the agreements they create, app partnerships, and side projects on shipped models.
import type { Agreement, Fx, GameState, Id, Model } from './types';
import { clamp, rand, randn, sum } from './rand';
import { autoPrice, fitOf, leader, projectRevenue } from './demand';
import { money } from './run';
import { labPrice, playerControls } from './supply';
import { SEGMENTS, segmentsOf } from './content/modalities';
import { OFFERS } from './content/offers';

export const MAX_OFFERS = 2;
export const OFFER_WEEKS = 2;
const AGREE_WEEKS = 48;

/** Apps renew their default model when the deal runs out. A player who controls an app points it at their own lab. */
export function appsTick(s: GameState): void {
  for (const c of Object.values(s.companies)) {
    const a = c.app;
    if (!a) continue;
    if (a.partner && !s.companies[a.partner]) a.partner = null;
    if (s.helm && playerControls(s, c.id) && a.partner !== s.labId) {
      Object.assign(a, { partner: s.labId, exclusive: true, cut: 0.1, until: s.week + AGREE_WEEKS });
      s.log.push({ week: s.week, co: c.id, tone: 'good', text: `${c.name} now sends its users to your models.` });
      continue;
    }
    if (a.partner && a.until > s.week) continue;
    const seg = Object.keys(a.reach).sort((x, y) => a.reach[y] - a.reach[x])[0];
    const lead = leader(s, seg).lab;
    if (lead !== a.partner) s.log.push({ week: s.week, co: c.id, tone: lead === s.labId ? 'good' : 'info', text: `${c.name} switches its default model to ${lead ? s.companies[lead].name : 'nobody'}.` });
    Object.assign(a, { partner: lead, exclusive: false, cut: 0.2, until: s.week + AGREE_WEEKS });
  }
}

/** New offers arrive, old ones expire. Called after the week counter moves on. */
export function offersTick(s: GameState): void {
  s.offers = s.offers.filter((o) => o.expires > s.week);
  if (!s.helm || s.offers.length >= MAX_OFFERS || rand(s.seed, s.week, 'offer', 'arrive') > 0.75) return;
  const lab = s.companies[s.labId];
  const ctx = { s, lab, u: (p: string) => rand(s.seed, s.week, 'offer', p) };
  const open = new Set(s.offers.map((o) => o.kind));
  let pool = OFFERS.filter((d) => !open.has(d.id)).map((d) => ({ d, w: d.weight(ctx) })).filter((x) => x.w > 0);
  // Draw by weight; a kind that has nothing to offer right now is dropped and the draw repeats.
  for (let tries = 0; pool.length; tries++) {
    let x = rand(s.seed, s.week, 'offer', 'kind' + tries) * sum(pool.map((p) => p.w));
    const def = (pool.find((p) => (x -= p.w) < 0) ?? pool[0]).d;
    const made = def.make(ctx);
    if (!made) { pool = pool.filter((p) => p.d !== def); continue; }
    s.offers.push({ id: 'offer' + s.nextId++, kind: def.id, from: made.from, expires: s.week + OFFER_WEEKS, big: def.big, call: { def: def.id, ...made.call } });
    return;
  }
}

function applyOfferFx(s: GameState, fx: Fx[], salt: string, rolls: boolean[]): void {
  const co = s.companies[s.labId], lab = co.lab!;
  fx.forEach((f, i) => {
    if (f.k === 'cash') co.cash += f.n;
    else if (f.k === 'lab') { lab.talent = clamp(lab.talent + (f.talent ?? 0), 0.7, 1.3); lab.hype = clamp(lab.hype + (f.hype ?? 0), 0, 1.5); lab.brand = clamp(lab.brand + (f.brand ?? 0), 0, 1); }
    else if (f.k === 'learn') { if (!lab.techniques.includes(f.tech)) lab.techniques.push(f.tech); }
    else if (f.k === 'agree') s.agreements.push({ ...f.a, id: 'ag' + s.nextId++ });
    else if (f.k === 'partner') { const a = s.companies[f.app]?.app; if (a) Object.assign(a, { partner: s.labId, exclusive: f.exclusive, cut: f.cut, until: s.week + f.weeks }); }
    else if (f.k === 'dataLevel') lab.data[f.kind] = Math.min(3, (lab.data[f.kind] ?? 0) + 1);
    else if (f.k === 'contract') { if (!s.contracts.some((k) => k.lab === s.labId)) s.contracts.push({ lab: s.labId, units: f.units, price: f.price, until: s.week + f.weeks }); }
    else if (f.k === 'rival') { const r = s.companies[f.co]?.lab; if (r) r.talent = clamp(r.talent + f.talent, 0.7, 1.3); }
    else if (f.k === 'license') {
      const m = s.models[f.model];
      if (m && s.companies[f.to]) {
        // The licensee tunes it up before selling it.
        const copy: Model = { ...structuredClone(m), id: 'm' + s.nextId++, lab: f.to, name: `${m.name} (licensed)`, shipped: s.week, retired: false, cap: m.cap.map((c) => c + 4) };
        s.models[copy.id] = copy;
        copy.price = autoPrice(s, copy);
      }
    } else if (f.k === 'risk') {
      const bad = rand(s.seed, s.week, salt, 'risk' + i) < f.p;
      rolls.push(bad);
      applyOfferFx(s, bad ? f.bad : f.good, salt + i, rolls);
    }
  });
}

/** Cash an option costs up front (risky branches not counted). */
export const upfront = (fx: Fx[]): number => -fx.reduce((a, f) => a + (f.k === 'cash' && f.n < 0 ? f.n : 0), 0);

export function answerOffer(s: GameState, offerId: Id, option: number): void {
  const o = s.offers.find((x) => x.id === offerId);
  const opt = o?.call.options[option];
  if (!o || !opt) return;
  s.offers = s.offers.filter((x) => x.id !== offerId);
  const rolls: boolean[] = [];
  applyOfferFx(s, opt.fx, o.id, rolls);
  const walked = rolls[0] === true && o.kind === 'enterprise';
  s.log.push({ week: s.week, co: o.from ?? s.labId, tone: walked ? 'bad' : opt.fx.length ? 'good' : 'info',
    text: walked ? `${o.call.title.split(' wants')[0]} walked away.` : opt.fx.length ? `Deal: ${opt.label.toLowerCase()} (${o.call.title.toLowerCase()}).` : `You passed: ${o.call.title.toLowerCase()}.` });
}

/** Agreements pay, come due, and expire. Returns money flows to add to this week's books. */
export function agreementsTick(s: GameState, flow: Record<Id, { rev: number; cogs: number; cu: number }>): void {
  const add = (id: Id, rev: number, cogs: number): void => { const e = (flow[id] ??= { rev: 0, cogs: 0, cu: 0 }); e.rev += rev; e.cogs += cogs; };
  const keep: Agreement[] = [];
  for (const a of s.agreements) {
    const co = s.companies[a.lab];
    if (!co) continue;
    if (a.kind === 'supply') {
      const def = SEGMENTS[a.seg!];
      const best = Object.values(s.models).filter((m) => m.lab === a.lab && !m.retired && m.modality === def.modality).reduce((b, m) => Math.max(b, fitOf(def, m.cap)), 0);
      if (!a.met && best >= a.target!) {
        a.met = true;
        a.until = s.week + AGREE_WEEKS;
        s.log.push({ week: s.week, co: a.lab, tone: 'good', text: `${a.account} goes live on your model: ${money(a.pay)} a week for a year.` });
      }
      if (!a.met && s.week > a.due!) {
        co.cash -= 4 * a.pay;
        if (co.lab) co.lab.brand = clamp(co.lab.brand - 0.05, 0, 1);
        s.log.push({ week: s.week, co: a.lab, tone: 'bad', text: `You missed ${a.account}'s deadline and paid ${money(4 * a.pay)} in penalties.` });
        continue;
      }
      if (a.met) add(a.lab, a.pay, 0);
    } else if (a.kind === 'royalty') {
      const payer = a.other ? s.companies[a.other] : null;
      if (payer) { const fee = a.pay * payer.rev; add(a.lab, fee, 0); add(payer.id, 0, fee); }
    }
    if (a.kind === 'supply' && !a.met) { keep.push(a); continue; }
    if (a.until > s.week) keep.push(a);
  }
  s.agreements = keep;
}

// --- Side projects ----------------------------------------------------------------------------------------------

export const PROJECT_WEEKS = { tune: 2, distill: 3 };
export const projectCost = (s: GameState, m: Model, kind: 'tune' | 'distill'): number => (kind === 'tune' ? 0.08 : 0.12) * m.compute * labPrice(s, m.lab);

export function projectCheck(s: GameState, modelId: Id, kind: 'tune' | 'distill', seg: Id | null): string | null {
  const m = s.models[modelId];
  if (!m || m.lab !== s.labId || m.retired) return 'Not one of your models on sale.';
  if (s.projects.some((p) => p.lab === s.labId)) return 'Your team is busy with another side project.';
  if (kind === 'tune' && (!seg || SEGMENTS[seg]?.modality !== m.modality)) return 'Pick a segment for this kind of model.';
  if (s.companies[s.labId].cash < projectCost(s, m, kind)) return 'Not enough cash.';
  return null;
}

export function startProject(s: GameState, modelId: Id, kind: 'tune' | 'distill', seg: Id | null): void {
  const m = s.models[modelId];
  s.companies[s.labId].cash -= projectCost(s, m, kind);
  s.projects.push({ id: 'proj' + s.nextId++, lab: s.labId, model: modelId, kind, seg, done: s.week + PROJECT_WEEKS[kind] });
}

export function projectsTick(s: GameState): void {
  const due = s.projects.filter((p) => p.done <= s.week);
  s.projects = s.projects.filter((p) => p.done > s.week);
  for (const p of due) {
    const m = s.models[p.model];
    if (!m || !s.companies[p.lab]) continue;
    const n = (k: string): number => randn(s.seed, s.week, p.id, k);
    const v: Model = { ...structuredClone(m), id: 'm' + s.nextId++, shipped: s.week, variantOf: m.id, quirks: [...m.quirks] };
    if (p.kind === 'tune') {
      const def = SEGMENTS[p.seg!];
      v.cap = m.cap.map((c, i) => c + 10 * (def.w[i] - 0.25) + 0.5 + 0.8 * n('t' + i));
      v.name = `${m.name} ${def.name.split(/[ &]/)[0]}`;
    } else {
      v.cap = m.cap.map((c, i) => c - 5 + 1.2 * n('d' + i));
      v.attrs = { ...m.attrs, cost: m.attrs.cost * 0.5, speed: m.attrs.speed * 1.4 };
      v.params = m.params / 4;
      v.compute = m.compute / 4;
      v.name = `${m.name} Mini`;
    }
    s.models[v.id] = v;
    v.price = autoPrice(s, v);
    s.log.push({ week: s.week, co: p.lab, tone: 'good', text: `${s.companies[p.lab].name} ships ${v.name}.` });
    if (p.lab === s.labId) s.moments.push({
      kind: 'variant', model: v.id, from: m.id, costBefore: m.attrs.cost, rev: projectRevenue(s, s.labId).rev,
      rows: segmentsOf(m.modality).map((d) => ({ seg: d.id, before: fitOf(d, m.cap), after: fitOf(d, v.cap) })),
    });
  }
}
