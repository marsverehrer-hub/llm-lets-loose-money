import type { Company, GameState, LabState } from './types';
import { aiBlueprint } from './ai';
import { fairValue } from './books';
import { basePrice, supplyTick } from './supply';
import { demandTick, fitOf, segDef } from './demand';
import { launch, startRun } from './run';
import { SEGMENTS } from './content/modalities';
import { APPS, RIVAL_LABS, SUPPLIERS, TYCOONS } from './content/flavor';
import { appsTick } from './offers';

export const SAVE_VERSION = 7;
export const SAVE_KEY = 'llm-lets-loose-money/v2/save';
const SHARES = 100e6;

const lab = (brand: number): LabState => ({ techniques: [], data: {}, talent: 1, brand, hype: 0.1, lastLaunch: -99, history: [], maxCompute: 0, raceWins: 0, cuPrice: 0, cuUsed: 0, research: { rate: 0, points: 0, aim: null }, hw: { train: 1, infer: 1 } });
const company = (c: Partial<Company> & Pick<Company, 'id' | 'name' | 'tagline' | 'color' | 'ceo' | 'cash'>): Company => ({
  layer: 'lab', shares: SHARES, price: 1, hist: [], debt: 0, rev: 0, cost: 0, rev8: 0, ni8: 0, revGrowth: 0, negWeeks: 0, raisedAt: -99, payout: 0.05, pill: false, integrationUntil: 0, ...c,
});

export function newGame(seed: number, name = 'Loose Money Labs'): GameState {
  const s: GameState = {
    v: SAVE_VERSION, seed, week: 0, playerId: 'you', labId: 'lab', helm: true,
    actors: { you: { id: 'you', name: 'You', cash: 5e6, isPlayer: true } },
    companies: {}, holdings: [{ owner: 'you', company: 'lab', shares: SHARES * 0.6 }], orders: [], deals: [], traded: {},
    models: {}, runs: {}, segments: {},
    market: { sentiment: 0, computePrice: basePrice(0), scarcity: 1, base: basePrice(0), binding: 'cloud', capacity: {}, demand: 0 }, contracts: [], offers: [], agreements: [], projects: [], leaks: {}, endings: [], chips: {},
    known: {}, standing: {}, callCount: {}, moments: [], log: [], tutorial: 0, over: false, nextId: 1,
  };
  s.companies.lab = company({ id: 'lab', name, tagline: "IPO'd on a pitch deck.", color: '#ff5d73', cash: 20e6,
    ceo: { name: 'You', style: 'hype', skill: 0.5, ego: 0.5 }, lab: { ...lab(0.1), hype: 0.3 }, payout: 0 });
  for (const d of RIVAL_LABS) s.companies[d.id] = company({ id: d.id, name: d.name, tagline: d.tagline, color: d.color, cash: d.cash, ceo: d.ceo, lab: lab(0.25) });
  for (const d of Object.values(SEGMENTS)) if (!d.unlockWeek) s.segments[d.id] = { id: d.id, size: d.size, fit0: 40, share: {}, accounts: d.accounts.map(() => null), gen: 0 };

  // Rivals open the game with one shipped model each, built by the same engine.
  for (const d of RIVAL_LABS) {
    const run = startRun(s, d.id, aiBlueprint(s, s.companies[d.id], d.modality, d.start), 'internal', false);
    run.weeksDone = run.weeksPlanned;
    launch(s, run);
    s.companies[d.id].lab!.lastLaunch = -Math.floor(seed % 5) - RIVAL_LABS.indexOf(d);
  }
  for (const seg of Object.values(s.segments)) {
    const def = segDef(s, seg.id);
    seg.fit0 = Math.max(40, ...Object.values(s.models).filter((m) => m.modality === def.modality).map((m) => fitOf(def, m.cap)));
  }
  for (const d of SUPPLIERS) s.companies[d.id] = company({ id: d.id, name: d.name, tagline: d.tagline, color: d.color, cash: d.cash, ceo: d.ceo, layer: d.layer,
    plant: { capacity: d.capacity, queue: [], posture: 0, capex: 1, blocked: [], decreeUntil: 0, ...(d.layer === 'chips' ? { gen: 1 } : {}) } });
  for (const d of APPS) s.companies[d.id] = company({ id: d.id, name: d.name, tagline: d.tagline, color: d.color, cash: d.cash, ceo: d.ceo, layer: 'app',
    app: { reach: d.reach, base: d.base, partner: null, exclusive: false, cut: 0.2, until: 0 } });
  appsTick(s); // each app picks a default lab
  let flow = demandTick(s);
  for (let i = 0; i < 12; i++) flow = demandTick(s);
  // One dry run of the chain gives suppliers their opening revenue and sets the opening price; then undo its side effects.
  const use = Object.fromEntries(Object.entries(flow).map(([id, f]) => [id, f.cu + 40]));
  const cash = Object.fromEntries(Object.values(s.companies).map((c) => [c.id, c.cash]));
  Object.assign(flow, supplyTick(s, use), supplyTick(s, use));
  for (const c of Object.values(s.companies)) { c.cash = cash[c.id]; if (c.plant) c.plant.queue = []; }
  for (const co of Object.values(s.companies)) {
    co.rev = co.rev8 = flow[co.id]?.rev ?? 0;
    co.ni8 = co.rev - (flow[co.id]?.cogs ?? 0) - (co.lab ? 100_000 + 0.12 * co.rev : 0);
    co.cost = co.rev - co.ni8;
    co.price = Math.max(0.2, fairValue(s, co) / co.shares);
    co.hist = [co.price];
  }
  // Rival tycoons open with stakes in two labs each, bought from the float at the opening price.
  TYCOONS.forEach((t, i) => {
    s.actors[t.id] = { id: t.id, name: t.name, cash: t.cash, isPlayer: false, persona: { greed: t.greed, risk: t.risk, ego: t.ego, blurb: t.blurb } };
    for (const k of [i, i + 3]) {
      const co = s.companies[RIVAL_LABS[k % RIVAL_LABS.length].id];
      s.holdings.push({ owner: t.id, company: co.id, shares: co.shares * (0.06 + 0.02 * (k % 3)) });
    }
  });
  s.log = [{ week: 0, tone: 'info', text: `${name} lists on the stock exchange with no product, no revenue and a very good slide deck.` }];
  return s;
}
