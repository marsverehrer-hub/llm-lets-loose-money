// OWNER: CONTRACTS. v8 B2B contract board (GAME_DESIGN §19.4). Offers, bids that resolve after a week, active deals,
// breaches, renewals. Contract definitions live in data/contracts.ts. State is created lazily (s.contracts ??= ...).
import type { ActionHandlers, ActionOf, ActionType, ActiveContract, Capabilities, ContractKind, ContractOffer, ContractReqs, ContractsState, GameState, Id, Model, Rng } from '../types';
import { CAP_IDS } from '../types';
import { makeRng } from '../rng';
import { BENCHMARKS } from '../data/benchmarks';
import { CONTRACT_DEFS, contractDefById, type ContractDef } from '../data/contracts';
import { contractFitMult } from '../bonuses';
import { addExpense, addRevenue, clamp, formatMoney, formatParams, newId, notify, pushNews, yearOf } from '../util';
import { frontierActiveParamsB, playerHoldsCrown, rivalLines } from './classes';
import { competitorCaps, modelCaps, specById } from './capabilities';
import { labInfo, labName } from './labs';
import { marketSalary } from './staff';
import { SCENARIO_FLAGS } from '../data/scenarios'; // v9 scenario

export const CONTRACT_TUNING = {
  /** Open offers at once (renewals are not counted against the cap). */
  MAX_OPEN: 5,
  /** Days between offer rounds, before the brand and reputation speed-up. */
  OFFER_GAP_MIN: 20,
  OFFER_GAP_MAX: 40,
  /** At an average of brand and reputation of 100 the gap shrinks by this share. */
  BRAND_SPEEDUP: 0.4,
  FIRST_OFFER_MIN: 8,
  FIRST_OFFER_MAX: 16,
  /** Days an offer stays open. */
  EXPIRY_MIN: 26,
  EXPIRY_MAX: 34,
  /** Days from bid to decision. */
  BID_DAYS: 7,
  /** Noise on our fit, rolled at bid time. */
  FIT_NOISE_SD: 5,
  /** Half-width of the fit band shown in the UI. */
  FIT_BAND: 8,
  /** Half-width of the rival band shown in the UI. */
  RIVAL_BAND: 5,
  /** Fit of the weak generic bid when no rival qualifies. */
  GENERIC_RIVAL_FIT: 35,
  /** Reputation assumed for rival labs (they have none in the sim). */
  RIVAL_REPUTATION: 50,
  DEFAULT_RIVAL_BRAND: 20,
  /** Weights on brand and reputation in fit (on top of the requirement headroom). */
  BRAND_WEIGHT: 0.3,
  /** v1.0 tuning: the brand term tops out here, so a famous flagship cannot buy every deal (GAME_DESIGN §19.4). */
  BRAND_TERM_CAP: 10,
  REPUTATION_WEIGHT: 0.2,
  /** Consecutive days out of spec before a contract is breached. */
  BREACH_DAYS: 30,
  BREACH_REPUTATION: 8,
  CANCEL_REPUTATION: 3,
  /** Share of the upfront fee refunded on breach or cancellation. */
  REFUND_SHARE: 0.25,
  /** Renewal offers pay this multiple of the old per-year fee. */
  RENEWAL_MULT: 1.2,
  RENEWAL_EXPIRY_DAYS: 30,
  HISTORY_CAP: 40,
};

const T = CONTRACT_TUNING;

// ---------------------------------------------------------------------------
// Requirement checks
// ---------------------------------------------------------------------------

/** One requirement, checked against one model (or described with no model). `h` is headroom 0..1 (0 when not met). */
export interface ReqCheck {
  key: string;
  label: string;
  ok: boolean;
  h: number;
  /** Shown only for released models, so the fog of training holds. Empty otherwise. */
  have: string;
}

type Gate = 'specIds' | 'openWeights' | 'crownOn' | 'clean';
interface Facts {
  active: number;
  caps: Capabilities;
  gates: Record<Gate, boolean>;
}

const CAP_LABEL: Record<(typeof CAP_IDS)[number], string> = {
  knowledge: 'Knowledge',
  reasoning: 'Reasoning',
  math: 'Maths',
  coding: 'Coding',
  agentic: 'Agentic',
  chat: 'Chat',
  vision: 'Vision',
  safety: 'Safety',
  multilingual: 'Multilingual',
  longContext: 'Long context',
};

/** Headroom on a gate: met counts as half a point of margin, unmet as none. */
const GATE_H = 0.5;

/**
 * Checks every requirement in `reqs`. With `facts` null, only labels come back (all unmet), for describing a deal.
 * Order is fixed so the UI can line chips up: size, capabilities, then gates.
 */
function checkAgainst(reqs: ContractReqs, facts: Facts | null): ReqCheck[] {
  const out: ReqCheck[] = [];
  if (reqs.maxActiveParamsB !== undefined) {
    const max = reqs.maxActiveParamsB;
    const ok = !!facts && facts.active <= max;
    out.push({
      key: 'params',
      label: `At most ${formatParams(max)} active params`,
      ok,
      h: ok && max > 0 ? clamp(1 - facts!.active / max, 0, 1) : 0,
      have: facts ? formatParams(facts.active) : '',
    });
  }
  for (const k of CAP_IDS) {
    const min = reqs.minCaps?.[k];
    if (min === undefined) continue;
    const have = facts ? facts.caps[k] : 0;
    const ok = !!facts && have >= min;
    out.push({
      key: k,
      label: `${CAP_LABEL[k]} ${Math.ceil(min)}+`,
      ok,
      h: ok ? clamp((have - min) / Math.max(1, 100 - min), 0, 1) : 0,
      have: facts ? String(Math.round(have)) : '',
    });
  }
  if (reqs.specIds?.length) {
    const names = reqs.specIds.map((id) => specById(id)?.name ?? id);
    const ok = !!facts && facts.gates.specIds;
    out.push({ key: 'specIds', label: `${names.join(' or ')} fine-tune`, ok, h: ok ? GATE_H : 0, have: '' });
  }
  if (reqs.openWeights) {
    const ok = !!facts && facts.gates.openWeights;
    out.push({ key: 'openWeights', label: 'Open weights', ok, h: ok ? GATE_H : 0, have: '' });
  }
  if (reqs.crownOn?.length) {
    const names = reqs.crownOn.map((id) => BENCHMARKS.find((b) => b.id === id)?.name ?? id);
    const ok = !!facts && facts.gates.crownOn;
    out.push({ key: 'crownOn', label: `Crown on ${names.join(', ')}`, ok, h: ok ? GATE_H : 0, have: '' });
  }
  if (reqs.clean) {
    const ok = !!facts && facts.gates.clean;
    out.push({ key: 'clean', label: 'Clean training data', ok, h: ok ? GATE_H : 0, have: '' });
  }
  return out;
}

/** Requirement checks for one of the player's models. Null model = every check unmet. */
export function checkReqs(s: GameState, model: Model | null | undefined, reqs: ContractReqs): ReqCheck[] {
  if (!model) return checkAgainst(reqs, null);
  const facts: Facts = {
    active: model.activeParamsB ?? model.paramsB,
    caps: modelCaps(model, s),
    gates: {
      specIds: !reqs.specIds?.length || reqs.specIds.some((id) => model.specId === id || (model.lineage ?? []).includes(id)),
      openWeights: model.releaseMode === 'open',
      crownOn: !reqs.crownOn?.length || playerHoldsCrown(s, reqs.crownOn),
      clean: !model.contaminated,
    },
  };
  return checkAgainst(reqs, facts);
}

/** Labels for a deal's requirements, e.g. "At most 3.2B active params", "Chat 48+", "Open weights". */
export function describeReqs(reqs: ContractReqs): string[] {
  return checkAgainst(reqs, null).map((c) => c.label);
}

/**
 * Can this model take the deal? Deprecated models never can. Unreleased models can (a private deployment).
 * `failures` are human-readable; " (have X)" appears only for released models.
 */
export function meetsReqs(s: GameState, model: Model | null | undefined, reqs: ContractReqs): { ok: boolean; failures: string[] } {
  if (!model) return { ok: false, failures: ['no such model'] };
  if (model.deprecated) return { ok: false, failures: ['model is deprecated'] };
  const failures = checkReqs(s, model, reqs)
    .filter((c) => !c.ok)
    .map((c) => (c.have && model.releasedDay !== null ? `${c.label} (have ${c.have})` : c.label));
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

/**
 * Fit = contractFit x (sum of normalised requirement margins + 0.3 brand + 0.2 reputation).
 * Margins are 100 x headroom, averaged over the requirements so deals with more terms do not score higher.
 */
function fitFrom(checks: ReqCheck[], brand: number, reputation: number, contractFit: number): number {
  const mean = checks.length ? checks.reduce((a, c) => a + c.h, 0) / checks.length : 0;
  return contractFit * (100 * mean + Math.min(T.BRAND_TERM_CAP, T.BRAND_WEIGHT * brand) + T.REPUTATION_WEIGHT * reputation);
}

/** The player's expected fit with this model, before the bid noise. */
export function expectedFit(s: GameState, offer: ContractOffer, model: Model): number {
  return fitFrom(checkReqs(s, model, offer.reqs), s.company.brand, s.company.reputation, contractFitMult(s, offer.kind));
}

/** Band the UI shows for a model on an open offer: expected fit, plus or minus FIT_BAND. */
export function fitBand(s: GameState, offerId: Id, modelId: Id): { low: number; high: number } {
  const offer = s.contracts?.offers.find((o) => o.id === offerId);
  const model = s.models.find((m) => m.id === modelId);
  if (!offer || !model) return { low: 0, high: 0 };
  const e = expectedFit(s, offer, model);
  return { low: Math.max(0, e - T.FIT_BAND), high: Math.max(0, e + T.FIT_BAND) };
}

/** Best rival on an offer, from the offer's last refresh. Lab is the lab's display name, or null for the generic bid. */
export function rivalBand(offer: ContractOffer, s?: GameState): { low: number; high: number; lab: string | null } {
  const lab = offer.rivalLab ? (s ? labName(s, offer.rivalLab) : offer.rivalLab) : null;
  return { low: Math.max(0, offer.rivalFit - T.RIVAL_BAND), high: offer.rivalFit + T.RIVAL_BAND, lab };
}

/**
 * The model to show chips for: the best qualifying one by fit. If none qualifies, the one failing the fewest checks.
 */
export function bestModelFor(s: GameState, offer: ContractOffer): { model: Model | null; qualifies: boolean } {
  let best: { m: Model; fit: number } | null = null;
  let closest: { m: Model; misses: number } | null = null;
  for (const m of s.models) {
    if (m.deprecated) continue;
    const misses = checkReqs(s, m, offer.reqs).filter((c) => !c.ok).length;
    if (misses === 0) {
      const fit = expectedFit(s, offer, m);
      if (!best || fit > best.fit) best = { m, fit };
    } else if (!closest || misses < closest.misses) {
      closest = { m, misses };
    }
  }
  if (best) return { model: best.m, qualifies: true };
  return { model: closest?.m ?? null, qualifies: false };
}

/** Revenue from active contracts, $ per year. */
export function contractRevenuePerDay(s: GameState): number {
  let total = 0;
  for (const a of s.contracts?.active ?? []) total += a.offer.perYear / 365;
  return total;
}

/** Headline value of a deal: upfront plus every year's pay. */
export function dealValue(o: ContractOffer): number {
  return o.upfront + o.perYear * o.years;
}

/**
 * Best qualifying rival for a set of requirements, looked at the same way as the player: rival flagships at the frontier
 * size, and rival small or medium lines at their own size. A rival qualifies on size and capabilities only (GAME_DESIGN §19.4).
 * Its gate headroom is what it actually has: no fine-tunes, open weights only from open-release labs, a crown only where it
 * holds one. With no qualifier, the weak generic bid applies.
 */
export function rivalFor(s: GameState, reqs: ContractReqs): { fit: number; lab: Id | null } {
  const year = yearOf(s.day);
  const flagship = frontierActiveParamsB(year);
  const best = { fit: -Infinity, lab: null as Id | null };
  const consider = (lab: Id, active: number, caps: Capabilities, brand: number, gates: Record<Gate, boolean>) => {
    const checks = checkAgainst(reqs, { active, caps, gates });
    const sizeAndCaps = checks.filter((c) => c.key === 'params' || (CAP_IDS as readonly string[]).includes(c.key));
    if (!sizeAndCaps.every((c) => c.ok)) return;
    const fit = fitFrom(checks, brand, T.RIVAL_REPUTATION, 1);
    if (fit > best.fit) {
      best.fit = fit;
      best.lab = lab;
    }
  };
  const crownsOf = (lab: Id) => (s.classes?.crowns ?? []).filter((c) => c.holder === lab).map((c) => c.benchId);
  for (const c of s.competitors) {
    if (!c.active || !c.model || c.human) continue;
    const info = labInfo(s, c.id);
    if (!info || info.human) continue;
    const caps = c.model.caps ?? competitorCaps(c.model.scores, info.personality, null, year);
    const held = crownsOf(c.id);
    const gates: Record<Gate, boolean> = {
      specIds: false,
      openWeights: info.personality === 'open',
      crownOn: !!reqs.crownOn?.some((b) => held.includes(b)),
      clean: true,
    };
    consider(c.id, flagship, caps, c.brand, gates);
  }
  for (const line of rivalLines(s)) {
    const comp = s.competitors.find((c) => c.id === line.labId);
    const info = labInfo(s, line.labId);
    const caps = line.caps ?? competitorCaps(line.scores, info?.personality ?? null, null, year);
    const held = crownsOf(line.labId);
    const gates: Record<Gate, boolean> = {
      specIds: false,
      openWeights: info?.personality === 'open',
      crownOn: !!reqs.crownOn?.some((b) => held.includes(b)),
      clean: true,
    };
    consider(line.labId, line.activeParamsB, caps, comp?.brand ?? T.DEFAULT_RIVAL_BRAND, gates);
  }
  return best.lab ? { fit: best.fit, lab: best.lab } : { fit: T.GENERIC_RIVAL_FIT, lab: null };
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/** Creates s.contracts on first use. */
function ensure(s: GameState, rng: Rng): ContractsState {
  if (!s.contracts) {
    s.contracts = {
      offers: [],
      active: [],
      history: [],
      nextOfferDay: s.day + rng.int(T.FIRST_OFFER_MIN, T.FIRST_OFFER_MAX),
      pending: [],
    };
  }
  s.contracts.pending ??= [];
  return s.contracts;
}

function record(s: GameState, cs: ContractsState, entry: { client: string; title: string; outcome: ContractsState['history'][number]['outcome']; value: number; winner?: string }): void {
  cs.history.unshift({ day: s.day, ...entry });
  if (cs.history.length > T.HISTORY_CAP) cs.history.length = T.HISTORY_CAP;
}

function pickDef(cs: ContractsState, rng: Rng, year: number): ContractDef | null {
  const taken = new Set([...cs.offers.map((o) => o.defId), ...cs.active.map((a) => a.offer.defId)]);
  const pool = CONTRACT_DEFS.filter((d) => year >= d.minYear && year <= d.maxYear && !taken.has(d.id));
  if (!pool.length) return null;
  const total = pool.reduce((a, d) => a + d.weight, 0);
  let x = rng.next() * total;
  for (const d of pool) {
    x -= d.weight;
    if (x < 0) return d;
  }
  return pool[pool.length - 1];
}

function makeOffer(s: GameState, rng: Rng, def: ContractDef, client: string, o: { renewal?: boolean } = {}): ContractOffer {
  const year = yearOf(s.day);
  const v = def.value(year);
  const mult = o.renewal ? T.RENEWAL_MULT : 1;
  const reqs = def.reqs(s, year);
  const rival = rivalFor(s, reqs);
  return {
    id: newId(s, 'co'),
    defId: def.id,
    kind: def.kind as ContractKind,
    client,
    title: def.title.replace('{client}', client),
    blurb: def.blurb,
    reqs,
    upfront: v.upfront * mult,
    perYear: v.perYear * mult,
    years: v.years,
    supportEngineers: def.supportEngineers,
    expiresDay: s.day + (o.renewal ? T.RENEWAL_EXPIRY_DAYS : rng.int(T.EXPIRY_MIN, T.EXPIRY_MAX)),
    rivalFit: rival.fit,
    rivalLab: rival.lab,
  };
}

function cadenceDays(s: GameState, rng: Rng): number {
  const avg = (s.company.brand + s.company.reputation) / 2;
  const speed = clamp(1 - (T.BRAND_SPEEDUP * avg) / 100, 0.6, 1);
  return Math.max(1, Math.round(rng.range(T.OFFER_GAP_MIN, T.OFFER_GAP_MAX) * speed));
}

/**
 * Contracts draw from their own random stream, kept in s.flags, so adding them does not shift the rolls of the
 * rest of the sim (a system that consumed the shared stream would change every seeded outcome after it).
 */
const RNG_FLAG = 'contracts.rng';
function withContractRng<T>(s: GameState, fn: (rng: Rng) => T): T {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x2c1b3c6d) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

function expireOffers(s: GameState, cs: ContractsState): void {
  const biddingOn = new Set((cs.pending ?? []).map((b) => b.offerId));
  const keep: ContractOffer[] = [];
  for (const o of cs.offers) {
    if (!biddingOn.has(o.id) && s.day >= o.expiresDay) {
      record(s, cs, { client: o.client, title: o.title, outcome: 'expired', value: dealValue(o) });
    } else {
      keep.push(o);
    }
  }
  cs.offers = keep;
}

function signContract(s: GameState, cs: ContractsState, offer: ContractOffer, model: Model): void {
  // v9 scenario: government contracts won (Sovereign AI goal)
  if (offer.kind === 'government') s.flags[SCENARIO_FLAGS.govContracts] = (s.flags[SCENARIO_FLAGS.govContracts] ?? 0) + 1;
  const active: ActiveContract = {
    id: newId(s, 'ct'),
    offer,
    modelId: model.id,
    startDay: s.day,
    endDay: s.day + Math.round(offer.years * 365),
    breachDays: 0,
  };
  cs.active.push(active);
  addRevenue(s, 'contracts', offer.upfront);
  notify(s, `${offer.client} signs with ${s.company.name}: ${model.name} takes "${offer.title}".`, 'good');
  pushNews(s, `${offer.client} signs ${s.company.name} for ${offer.title.toLowerCase()}.`, 'good');
  record(s, cs, { client: offer.client, title: offer.title, outcome: 'won', value: dealValue(offer) });
}

function loseBid(s: GameState, cs: ContractsState, offer: ContractOffer): void {
  const lab = offer.rivalLab ? labName(s, offer.rivalLab) : 'a cheaper vendor';
  notify(s, `${offer.client} picks ${lab}. Your bid lost on fit.`, 'bad');
  pushNews(s, `${offer.client} picks ${lab}.`, 'info');
  record(s, cs, { client: offer.client, title: offer.title, outcome: 'lost', value: dealValue(offer), winner: lab });
}

/** Decides every bid whose day has come. */
function resolveBids(s: GameState, cs: ContractsState): void {
  for (const bid of [...(cs.pending ?? [])]) {
    if (s.day < bid.decideDay) continue;
    cs.pending = (cs.pending ?? []).filter((b) => b.id !== bid.id);
    const offer = cs.offers.find((o) => o.id === bid.offerId);
    if (!offer) continue;
    cs.offers = cs.offers.filter((o) => o.id !== offer.id);
    const model = s.models.find((m) => m.id === bid.modelId);
    if (!meetsReqs(s, model, offer.reqs).ok || !model) {
      notify(s, `Bid for ${offer.client} withdrawn: ${model?.name ?? 'the model'} no longer qualifies.`, 'bad');
      record(s, cs, { client: offer.client, title: offer.title, outcome: 'lost', value: dealValue(offer) });
      continue;
    }
    if (bid.fit > offer.rivalFit) signContract(s, cs, offer, model);
    else loseBid(s, cs, offer);
  }
}

function breach(s: GameState, cs: ContractsState, a: ActiveContract): void {
  cs.active = cs.active.filter((x) => x.id !== a.id);
  const refund = T.REFUND_SHARE * a.offer.upfront;
  addExpense(s, 'contracts', refund);
  s.company.reputation = clamp(s.company.reputation - T.BREACH_REPUTATION, 0, 100);
  record(s, cs, { client: a.offer.client, title: a.offer.title, outcome: 'breached', value: dealValue(a.offer) });
  notify(s, `${a.offer.client} ends "${a.offer.title}" after ${T.BREACH_DAYS} days out of spec. Refund ${formatMoney(refund)}, reputation down ${T.BREACH_REPUTATION}.`, 'bad');
  pushNews(s, `${a.offer.client} drops ${s.company.name}. The model stopped qualifying.`, 'bad');
}

function complete(s: GameState, cs: ContractsState, a: ActiveContract, rng: Rng, stillQualifies: boolean): void {
  cs.active = cs.active.filter((x) => x.id !== a.id);
  record(s, cs, { client: a.offer.client, title: a.offer.title, outcome: 'completed', value: dealValue(a.offer) });
  notify(s, `${a.offer.client} wraps up "${a.offer.title}".`, 'good');
  const def = contractDefById(a.offer.defId);
  if (stillQualifies && def) {
    cs.offers.push(makeOffer(s, rng, def, a.offer.client, { renewal: true }));
    notify(s, `${a.offer.client} wants to renew at ${T.RENEWAL_MULT}x.`, 'info');
  }
}

/** Daily pay and support cost for active deals, breach countdown, and completion. */
function tickActive(s: GameState, cs: ContractsState, rng: Rng): void {
  const engineerDaily = (marketSalary(s, 'engineer') * s.staff.roles.engineer.salaryLevel) / 365;
  for (const a of [...cs.active]) {
    const o = a.offer;
    addRevenue(s, 'contracts', o.perYear / 365);
    if (o.supportEngineers > 0) addExpense(s, 'staff', o.supportEngineers * engineerDaily);
    const model = s.models.find((m) => m.id === a.modelId);
    const fine = meetsReqs(s, model, o.reqs).ok;
    if (fine) {
      a.breachDays = 0;
    } else {
      a.breachDays += 1;
      if (a.breachDays === 1) notify(s, `${o.client} warns: ${model?.name ?? 'the assigned model'} no longer meets "${o.title}". ${T.BREACH_DAYS} days to fix it.`, 'bad');
    }
    if (a.breachDays >= T.BREACH_DAYS) {
      breach(s, cs, a);
      continue;
    }
    if (s.day >= a.endDay) complete(s, cs, a, rng, fine);
  }
}

function spawnOffers(s: GameState, rng: Rng, cs: ContractsState): void {
  const year = yearOf(s.day);
  const room = T.MAX_OPEN - cs.offers.length;
  const want = rng.chance(0.4) ? 2 : 1;
  for (let i = 0; i < Math.min(room, want); i++) {
    const def = pickDef(cs, rng, year);
    if (!def) break;
    cs.offers.push(makeOffer(s, rng, def, rng.pick(def.clients)));
  }
  // Board full: look again in a few days rather than waiting a whole cycle.
  cs.nextOfferDay = s.day + (room > 0 ? cadenceDays(s, rng) : 5);
}

function runTick(s: GameState, rng: Rng): void {
  const cs = ensure(s, rng);
  expireOffers(s, cs);
  for (const o of cs.offers) {
    const r = rivalFor(s, o.reqs);
    o.rivalFit = r.fit;
    o.rivalLab = r.lab;
  }
  resolveBids(s, cs);
  tickActive(s, cs, rng);
  if (s.day >= cs.nextOfferDay) spawnOffers(s, rng, cs);
}

export function contractsTick(s: GameState, _rng: Rng): void {
  withContractRng(s, (rng) => runTick(s, rng));
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

/** Player actions run on the contract stream too, so a bid's noise never touches the rest of the sim. */
function isolated<K extends ActionType>(fn: (s: GameState, a: ActionOf<K>, rng: Rng) => void): (s: GameState, a: ActionOf<K>) => void {
  return (s, a) => withContractRng(s, (rng) => fn(s, a, rng));
}

export const handlers: ActionHandlers = {
  bidContract: isolated<'bidContract'>((s, a, rng) => {
    const cs = ensure(s, rng);
    const offer = cs.offers.find((o) => o.id === a.offerId);
    if (!offer) {
      notify(s, 'That offer has already gone.', 'bad');
      return;
    }
    if (cs.pending!.some((b) => b.offerId === offer.id)) {
      notify(s, `Already bidding for ${offer.client}.`, 'info');
      return;
    }
    const model = s.models.find((m) => m.id === a.modelId);
    const v = meetsReqs(s, model, offer.reqs);
    if (!v.ok || !model) {
      notify(s, `${model?.name ?? 'That model'} can't take this deal: ${v.failures.join(', ')}.`, 'bad');
      return;
    }
    const fit = expectedFit(s, offer, model) + rng.normal(0, T.FIT_NOISE_SD);
    cs.pending!.push({ id: newId(s, 'cb'), offerId: offer.id, modelId: model.id, bidDay: s.day, decideDay: s.day + T.BID_DAYS, fit });
    notify(s, `Bid in for ${offer.client} with ${model.name}. Decision in ${T.BID_DAYS} days.`, 'info');
  }),

  declineContract: isolated<'declineContract'>((s, a, rng) => {
    const cs = ensure(s, rng);
    const offer = cs.offers.find((o) => o.id === a.offerId);
    if (!offer) {
      notify(s, 'That offer has already gone.', 'bad');
      return;
    }
    if (cs.pending!.some((b) => b.offerId === offer.id)) {
      notify(s, `A bid is already in for ${offer.client}. Wait for the decision.`, 'info');
      return;
    }
    cs.offers = cs.offers.filter((o) => o.id !== offer.id);
    record(s, cs, { client: offer.client, title: offer.title, outcome: 'declined', value: dealValue(offer) });
    notify(s, `Declined ${offer.client}. They have moved on.`, 'info');
  }),

  reassignContract: isolated<'reassignContract'>((s, a, rng) => {
    const cs = ensure(s, rng);
    const c = cs.active.find((x) => x.id === a.contractId);
    if (!c) {
      notify(s, 'That contract is no longer active.', 'bad');
      return;
    }
    const model = s.models.find((m) => m.id === a.modelId);
    const v = meetsReqs(s, model, c.offer.reqs);
    if (!v.ok || !model) {
      notify(s, `${model?.name ?? 'That model'} can't cover ${c.offer.client}: ${v.failures.join(', ')}.`, 'bad');
      return;
    }
    c.modelId = model.id;
    c.breachDays = 0;
    notify(s, `${c.offer.client} moves "${c.offer.title}" to ${model.name}.`, 'good');
  }),

  cancelContract: isolated<'cancelContract'>((s, a, rng) => {
    const cs = ensure(s, rng);
    const c = cs.active.find((x) => x.id === a.contractId);
    if (!c) {
      notify(s, 'That contract is no longer active.', 'bad');
      return;
    }
    cs.active = cs.active.filter((x) => x.id !== c.id);
    const refund = T.REFUND_SHARE * c.offer.upfront;
    addExpense(s, 'contracts', refund);
    s.company.reputation = clamp(s.company.reputation - T.CANCEL_REPUTATION, 0, 100);
    record(s, cs, { client: c.offer.client, title: c.offer.title, outcome: 'cancelled', value: dealValue(c.offer) });
    notify(s, `Cancelled ${c.offer.client}. Refund ${formatMoney(refund)}, reputation down ${T.CANCEL_REPUTATION}.`, 'bad');
  }),
};
