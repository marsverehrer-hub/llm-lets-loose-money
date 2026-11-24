// Offers that land on the Desk. Each builds a call-shaped card from the current state, or returns null if it does not fit.
import type { Call, CallOption, Company, Fx, GameState, Id } from '../types';
import { pick } from '../rand';
import { dataCost } from '../apply';
import { marketCap } from '../books';
import { fitOf, leader, segDef } from '../demand';
import { money } from '../run';
import { suppliers } from '../supply';
import { MODALITIES, SEGMENTS } from './modalities';
import { tech } from './tech';
import { PUBLISHERS } from './flavor';

export interface OfferCtx { s: GameState; lab: Company; u: (p: string) => number }
export interface OfferDef { id: Id; big: boolean; weight: (c: OfferCtx) => number; make: (c: OfferCtx) => { from: Id | null; call: Omit<Call, 'def'> } | null }

const opt = (label: string, note: string, ...fx: Fx[]): CallOption => ({ label, note, fx });
const no = (label = 'Decline', note = 'Not this time.'): CallOption => ({ label, note, fx: [] });
const myModels = (s: GameState) => Object.values(s.models).filter((m) => m.lab === s.labId && !m.retired);
const bestFit = (s: GameState, segId: Id): number => myModels(s).filter((m) => m.modality === segDef(s, segId).modality).reduce((b, m) => Math.max(b, fitOf(segDef(s, segId), m.cap)), 0);
const rivals = (s: GameState) => Object.values(s.companies).filter((c) => c.lab && c.id !== s.labId);
const mySegs = (s: GameState): Id[] => Object.keys(s.segments).filter((id) => myModels(s).some((m) => m.modality === segDef(s, id).modality));
const r1 = (x: number): number => Math.round(x);

export const OFFERS: OfferDef[] = [
  { id: 'enterprise', big: true, weight: (c) => (myModels(c.s).length ? 1.2 : 0), make: (c) => {
    const s = c.s;
    const segs = mySegs(s);
    if (!segs.length) return null;
    const segId = pick(segs, c.u('seg')), def = segDef(s, segId);
    const account = pick(def.accounts, c.u('acct'));
    const target = r1(Math.max(bestFit(s, segId), leader(s, segId).fit - 3) + 2 + 4 * c.u('target'));
    const due = 6 + Math.floor(8 * c.u('due'));
    const pay = Math.round((0.03 + 0.03 * c.u('pay')) * s.segments[segId].size * def.pRef / 1e4) * 1e4;
    const deal = (p: number): Fx => ({ k: 'agree', a: { kind: 'supply', lab: s.labId, other: null, until: 0, pay: p, seg: segId, target, due: s.week + due, met: false, account } });
    return { from: null, call: {
      title: `${account} wants a model`, body: `They will pay ${money(pay)} a week for a year if you score ${target} on ${def.bench} within ${due} weeks. You score ${r1(bestFit(s, segId))} today. Miss it and you owe them ${money(4 * pay)}.`,
      options: [
        opt('Sign', 'Now you have a deadline.', deal(pay)),
        opt('Hold out for more', 'They might walk.', { k: 'risk', p: 0.45, bad: [], good: [deal(Math.round(pay * 1.4))] }),
        no(),
      ] } };
  } },
  { id: 'distribution', big: true, weight: (c) => (myModels(c.s).length ? 1 : 0), make: (c) => {
    const s = c.s;
    const segs = new Set(mySegs(s));
    const apps = Object.values(s.companies).filter((x) => x.app && x.app.partner !== s.labId && x.app.until - s.week <= 6 && Object.keys(x.app.reach).some((k) => segs.has(k)));
    if (!apps.length) return null;
    const app = pick(apps, c.u('app'));
    const value = Object.entries(app.app!.reach).reduce((a, [k, r]) => a + (segs.has(k) ? r * s.segments[k].size * segDef(s, k).pRef : 0), 0);
    const fee = Math.round((8 * value) / 1e5) * 1e5;
    const where = Object.keys(app.app!.reach).map((k) => segDef(s, k).name.toLowerCase()).join(' and ');
    return { from: app.id, call: {
      title: `${app.name} is picking a default model`, body: `Its ${where} users go to whatever it ships by default. ${app.app!.partner ? `Today that is ${s.companies[app.app!.partner]?.name ?? 'nobody'}.` : 'Right now nobody.'} The deal runs a year.`,
      options: [
        opt('Go exclusive', `A ${money(fee)} signing fee, and a small cut for them.`, { k: 'cash', n: -fee }, { k: 'partner', app: app.id, exclusive: true, cut: 0.15, weeks: 48 }),
        opt('Share the shelf', 'No fee, a much bigger cut, half the users.', { k: 'partner', app: app.id, exclusive: false, cut: 0.4, weeks: 48 }),
        no('Let a rival have it'),
      ] } };
  } },
  { id: 'data', big: false, weight: (c) => (myModels(c.s).length ? 0.7 : 0.4), make: (c) => {
    const s = c.s;
    const mods = [...new Set(myModels(s).map((m) => m.modality))];
    const kinds = (mods.length ? mods : ['lang' as const]).flatMap((m) => MODALITIES[m].data).filter((d) => (c.lab.lab!.data[d.id] ?? 0) < 3
      && !s.agreements.some((a) => a.kind === 'data' && a.data === d.id && a.until > s.week));
    if (!kinds.length) return null;
    const k = pick(kinds, c.u('kind'));
    const pub = pick(PUBLISHERS, c.u('pub'));
    const base = dataCost(s, k.cost, c.lab.lab!.data[k.id] ?? 0);
    return { from: null, call: {
      title: `${pub} is selling ${k.name.toLowerCase()}`, body: `A big archive, freshly "licensed". Exclusive means your rivals train on scraps of it for a year.`,
      options: [
        opt('Buy it exclusively', 'Expensive, and your rivals feel it.', { k: 'cash', n: -Math.round(4 * base) }, { k: 'dataLevel', kind: k.id }, { k: 'agree', a: { kind: 'data', lab: s.labId, other: null, until: s.week + 48, pay: 0, data: k.id } }),
        opt('Buy a shared licence', 'A little under the shop price.', { k: 'cash', n: -Math.round(0.85 * base) }, { k: 'dataLevel', kind: k.id }),
        no(),
      ] } };
  } },
  { id: 'talent', big: false, weight: () => 0.6, make: (c) => {
    const s = c.s;
    const rs = rivals(s);
    if (!rs.length) return null;
    const r = pick(rs, c.u('rival'));
    const secret = r.lab!.techniques.find((t) => tech(t).week > s.week && !c.lab.lab!.techniques.includes(t));
    const bonus = Math.round(Math.max(5e6 * (1 + s.week / 48), 0.5 * Math.max(0, c.lab.rev)) / 1e5) * 1e5;
    return { from: r.id, call: {
      title: `A ${r.name} researcher wants out`, body: secret ? `They worked on ${tech(secret).name}, which ${r.name} has not shipped yet. They would bring the notes.` : `Senior, cranky, very good. ${r.name} will feel it.`,
      options: [
        opt('Hire them', 'Pay the signing bonus.', { k: 'cash', n: -bonus }, { k: 'lab', talent: 0.015 }, { k: 'rival', co: r.id, talent: -0.015 }, ...(secret ? [{ k: 'learn', tech: secret } as Fx] : [])),
        opt('Hire them part-time', 'Cheaper, less of a dent.', { k: 'cash', n: -Math.round(bonus / 2) }, { k: 'lab', talent: 0.006 }),
        no('Pass', 'Loyalty is a value.'),
      ] } };
  } },
  { id: 'license', big: false, weight: (c) => (myModels(c.s).some((m) => c.s.week - m.shipped >= 24) || Object.values(c.s.models).some((m) => m.lab === c.s.labId && m.retired) ? 0.6 : 0), make: (c) => {
    const s = c.s;
    const old = Object.values(s.models).filter((m) => m.lab === s.labId && s.week - m.shipped >= 24 && !m.variantOf);
    const rs = rivals(s);
    if (!old.length || !rs.length) return null;
    const m = pick(old, c.u('model')), r = pick(rs, c.u('rival'));
    const lump = Math.max(1.5e6, Math.round((0.01 * marketCap(r)) / 1e5) * 1e5);
    return { from: r.id, call: {
      title: `${r.name} wants to license ${m.name}`, body: `It is ${s.week - m.shipped} weeks old. They would tune it up and sell it as their own, against you.`,
      options: [
        opt('Sell it outright', 'Cash now.', { k: 'cash', n: lump }, { k: 'license', model: m.id, to: r.id }),
        opt('License it for a royalty', '4% of their revenue for a year.', { k: 'license', model: m.id, to: r.id }, { k: 'agree', a: { kind: 'royalty', lab: s.labId, other: r.id, until: s.week + 48, pay: 0.04 } }),
        no('Refuse', 'Old or not, it is ours.'),
      ] } };
  } },
  { id: 'cloud', big: false, weight: (c) => (!c.s.contracts.some((k) => k.lab === c.s.labId) && c.lab.lab!.cuUsed > 20 ? 0.6 : 0), make: (c) => {
    const s = c.s;
    const clouds = suppliers(s, 'cloud');
    if (!clouds.length) return null;
    const cl = pick(clouds, c.u('cloud'));
    const use = c.lab.lab!.cuUsed;
    return { from: cl.id, call: {
      title: `${cl.name} wants your business`, body: `A year of compute below list price, if you commit. You used ${r1(use)} compute-weeks last week. The spot price is ${money(s.market.computePrice)}.`,
      options: [
        opt('Commit everything', 'The deepest discount.', { k: 'contract', units: r1(use), price: Math.round(s.market.base * 0.85), weeks: 48 }),
        opt('Commit half', 'A smaller bet.', { k: 'contract', units: r1(use / 2), price: Math.round(s.market.base * 0.95), weeks: 48 }),
        no('Stay on spot', 'Gamble on prices falling.'),
      ] } };
  } },
];
