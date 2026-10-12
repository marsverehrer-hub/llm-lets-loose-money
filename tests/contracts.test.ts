// v8 B2B contract board (GAME_DESIGN §19.4): offers, size-gated qualification, bids that resolve after a week, revenue, breach.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { CONTRACT_DEFS, contractDefById } from '../src/sim/data/contracts';
import { classThresholds } from '../src/sim/systems/classes';
import { frontierQuality } from '../src/sim/systems/market';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, ContractOffer, GameState, Model } from '../src/sim/types';
import {
  contractRevenuePerDay,
  describeReqs,
  fitBand,
  meetsReqs,
  rivalBand,
} from '../src/sim/systems/contracts';

/** Day number for a calendar date, day 0 = 2017-01-01 (matches util.dayToDate). */
function dayOf(year: number): number {
  return Math.round((Date.UTC(year, 0, 1) - Date.UTC(2017, 0, 1)) / 86_400_000);
}

function lab(seed: number, day = 0): GameState {
  const s = createInitialState(seed, 'Contracts');
  s.finance.cash = 1e13;
  s.tutorialStep = -1;
  s.day = day;
  return s;
}

/** Clears the things that block the sim (events, incidents, reveals, moments) so ticks advance. */
function clearBlockers(s: GameState): void {
  if (s.events.pending && s.events.pending.result === undefined) {
    dispatch(s, { type: 'resolveEvent', choice: 0 });
    dispatch(s, { type: 'clearEventResult' });
  }
  if (s.pendingReveal) dispatch(s, { type: 'dismissReveal' });
  if (s.pendingMoment) dispatch(s, { type: 'dismissMoment' });
}

function advance(s: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    clearBlockers(s);
    tick(s);
  }
}

/** A model with every capability at `caps` and a given active size. Released unless `released` is false. */
function addModel(s: GameState, o: { name: string; activeParamsB: number; caps: number; released?: boolean; deprecated?: boolean }): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, o.caps])) as Capabilities;
  caps.vision = 0;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: o.name,
    paramsB: o.activeParamsB,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: o.caps, coding: o.caps, chat: o.caps, safety: o.caps },
    overall: o.caps,
    elo: 800 + 8 * o.caps,
    trainedDay: s.day,
    releasedDay: o.released === false ? null : s.day,
    deprecated: o.deprecated ?? false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: 128,
    modalities: ['text'],
    contaminated: false,
    config: defaultConfig(s),
    activeParamsB: o.activeParamsB,
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
    releaseMode: 'full',
  };
  s.models.push(m);
  return m;
}

/** Puts an offer directly on the board, using the real definition's requirements for the current year. */
function putOffer(s: GameState, defId: string, client?: string): ContractOffer {
  const def = contractDefById(defId)!;
  const year = 2017 + s.day / 365.25;
  const v = def.value(year);
  const cs = (s.contracts ??= { offers: [], active: [], history: [], nextOfferDay: s.day + 999, pending: [] });
  const offer: ContractOffer = {
    id: `co${++s.idCounter}`,
    defId,
    kind: def.kind,
    client: client ?? def.clients[0],
    title: def.title.replace('{client}', client ?? def.clients[0]),
    blurb: def.blurb,
    reqs: def.reqs(s, year),
    upfront: v.upfront,
    perYear: v.perYear,
    years: v.years,
    supportEngineers: def.supportEngineers,
    expiresDay: s.day + 30,
    rivalFit: 0,
    rivalLab: null,
  };
  cs.offers.push(offer);
  return offer;
}

describe('contract definitions', () => {
  it('has about fourteen defs covering every kind, with parody client pools', () => {
    expect(CONTRACT_DEFS.length).toBeGreaterThanOrEqual(14);
    const kinds = new Set(CONTRACT_DEFS.map((d) => d.kind));
    for (const k of ['ondevice', 'onprem', 'vertical', 'government', 'npc', 'grant', 'agentic']) expect(kinds.has(k as never)).toBe(true);
    for (const d of CONTRACT_DEFS) expect(d.clients.length).toBeGreaterThan(0);
  });

  it('pays early deals in the $0.1-2M range and late deals in the $5M+ range', () => {
    const early = CONTRACT_DEFS.map((d) => d.value(2018).perYear);
    const late = CONTRACT_DEFS.filter((d) => d.minYear <= 2026).map((d) => d.value(2026).perYear);
    expect(Math.min(...early)).toBeGreaterThanOrEqual(0.1e6);
    expect(Math.max(...early)).toBeLessThanOrEqual(2e6);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(5e6 * 0.99);
  });
});

describe('contracts board', () => {
  it('offers appear over time and never exceed five open', () => {
    const s = lab(11, dayOf(2018));
    addModel(s, { name: 'Tiny', activeParamsB: 1, caps: 60 });
    advance(s, 60);
    expect(s.contracts).toBeDefined();
    const seen = (s.contracts?.offers.length ?? 0) + (s.contracts?.history.length ?? 0);
    expect(seen).toBeGreaterThan(0);
    advance(s, 400);
    expect(s.contracts!.offers.length).toBeLessThanOrEqual(5);
  });

  it('a small model qualifies for on-device deals and a frontier giant does not', () => {
    const s = lab(12, dayOf(2026));
    const year = 2026.5;
    const def = contractDefById('ondevice-phone')!;
    const reqs = def.reqs(s, year);
    const frontierF = frontierQuality(year);
    const small = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: frontierF * 0.8 });
    const giant = addModel(s, { name: 'Gargantua', activeParamsB: classThresholds(year).medium * 4, caps: 99 });
    expect(meetsReqs(s, small, reqs).ok).toBe(true);
    const giantResult = meetsReqs(s, giant, reqs);
    expect(giantResult.ok).toBe(false);
    expect(giantResult.failures.join(' ')).toMatch(/active params/);
  });

  it('deprecated models never qualify', () => {
    const s = lab(13, dayOf(2026));
    const m = addModel(s, { name: 'Old', activeParamsB: 1, caps: 90, deprecated: true });
    expect(meetsReqs(s, m, contractDefById('ondevice-phone')!.reqs(s, 2026.5)).ok).toBe(false);
  });

  it('describes requirements in player terms', () => {
    const labels = describeReqs({ maxActiveParamsB: 3.2, minCaps: { chat: 47.6 }, openWeights: true, specIds: ['doctor'] });
    expect(labels).toContain('At most 3.2B active params');
    expect(labels).toContain('Chat 48+');
    expect(labels).toContain('Open weights');
    expect(labels).toContain('Doctor fine-tune');
  });

  it('bid resolves after a week: a win pays upfront and opens an active contract', () => {
    const s = lab(14, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone', 'Pear Inc.');
    const cashBefore = s.finance.cash;
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: m.id });
    expect(s.contracts!.pending).toHaveLength(1);
    expect(s.contracts!.offers).toHaveLength(1);
    // Force a strong fit so the win does not depend on the noise roll.
    s.contracts!.pending![0].fit = 1000;
    advance(s, 6);
    expect(s.contracts!.pending).toHaveLength(1);
    advance(s, 2);
    expect(s.contracts!.pending).toHaveLength(0);
    expect(s.contracts!.active).toHaveLength(1);
    expect(s.contracts!.offers.find((o) => o.id === offer.id)).toBeUndefined();
    expect(s.finance.cash).toBeGreaterThan(cashBefore);
    expect(s.contracts!.history[0].outcome).toBe('won');
  });

  it('bid resolves after a week: a loss goes to history with the winner named', () => {
    const s = lab(15, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone', 'Samsong');
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: m.id });
    s.contracts!.pending![0].fit = 0;
    advance(s, 8);
    expect(s.contracts!.active).toHaveLength(0);
    expect(s.contracts!.history[0].outcome).toBe('lost');
    expect(s.contracts!.history[0].client).toBe('Samsong');
  });

  it('a model that does not qualify cannot bid', () => {
    const s = lab(16, dayOf(2026));
    const giant = addModel(s, { name: 'Gargantua', activeParamsB: 900, caps: 99 });
    const offer = putOffer(s, 'ondevice-phone');
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: giant.id });
    expect(s.contracts!.pending ?? []).toHaveLength(0);
    expect(s.notifications.some((n) => /can't take this deal/.test(n.text))).toBe(true);
  });

  it('revenue accrues daily at perYear / 365 while a contract is active', () => {
    const s = lab(17, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone');
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: m.id });
    s.contracts!.pending![0].fit = 1000;
    advance(s, 8);
    expect(s.contracts!.active).toHaveLength(1);
    clearBlockers(s);
    tick(s);
    const perDay = s.contracts!.active[0].offer.perYear / 365;
    expect(s.finance.today.revenue.contracts).toBeCloseTo(perDay, 0);
    expect(contractRevenuePerDay(s)).toBeCloseTo(perDay, 6);
  });

  it('breaches after thirty days out of spec, refunds a quarter of the upfront and costs reputation', () => {
    const s = lab(18, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone');
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: m.id });
    s.contracts!.pending![0].fit = 1000;
    advance(s, 8);
    expect(s.contracts!.active).toHaveLength(1);
    const upfront = s.contracts!.active[0].offer.upfront;
    m.deprecated = true;
    advance(s, 29);
    expect(s.contracts!.active).toHaveLength(1);
    expect(s.contracts!.active[0].breachDays).toBeGreaterThan(0);
    const repBefore = s.company.reputation;
    advance(s, 2);
    expect(s.contracts!.active).toHaveLength(0);
    expect(s.contracts!.history[0].outcome).toBe('breached');
    expect(s.company.reputation).toBeLessThan(repBefore);
    expect(upfront).toBeGreaterThan(0);
  });

  it('reassigning a breached contract to a qualifying model cures the countdown', () => {
    const s = lab(19, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const spare = addModel(s, { name: 'Pocket 2B', activeParamsB: 2, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone');
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: m.id });
    s.contracts!.pending![0].fit = 1000;
    advance(s, 8);
    m.deprecated = true;
    advance(s, 5);
    const contractId = s.contracts!.active[0].id;
    dispatch(s, { type: 'reassignContract', contractId, modelId: spare.id });
    advance(s, 3);
    expect(s.contracts!.active[0].modelId).toBe(spare.id);
    expect(s.contracts!.active[0].breachDays).toBe(0);
  });

  it('fit band is the expected fit plus or minus eight, and rival band names the lab', () => {
    const s = lab(20, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone');
    const band = fitBand(s, offer.id, m.id);
    expect(band.high - band.low).toBeCloseTo(16, 6);
    offer.rivalFit = 60;
    offer.rivalLab = 'mistrial';
    const rb = rivalBand(offer, s);
    expect(rb.low).toBe(55);
    expect(rb.high).toBe(65);
    expect(rb.lab).toBe('Mistrial');
  });

  it('declining removes the offer and records it', () => {
    const s = lab(21, dayOf(2026));
    const offer = putOffer(s, 'npc-games');
    dispatch(s, { type: 'declineContract', offerId: offer.id });
    expect(s.contracts!.offers).toHaveLength(0);
    expect(s.contracts!.history[0].outcome).toBe('declined');
  });

  it('cancelling refunds a quarter of the upfront and costs reputation', () => {
    const s = lab(22, dayOf(2026));
    const m = addModel(s, { name: 'Pocket 3B', activeParamsB: 3, caps: 90 });
    const offer = putOffer(s, 'ondevice-phone');
    dispatch(s, { type: 'bidContract', offerId: offer.id, modelId: m.id });
    s.contracts!.pending![0].fit = 1000;
    advance(s, 8);
    const c = s.contracts!.active[0];
    const cashBefore = s.finance.cash;
    const rep = s.company.reputation;
    dispatch(s, { type: 'cancelContract', contractId: c.id });
    expect(s.contracts!.active).toHaveLength(0);
    expect(s.finance.cash).toBeCloseTo(cashBefore - 0.25 * c.offer.upfront, 0);
    expect(s.company.reputation).toBeCloseTo(rep - 3, 6);
  });
});
