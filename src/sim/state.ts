import type { Company, GameState, LabState } from './types';
import { aiBlueprint } from './ai';
import { computePrice, fairValue } from './books';
import { demandTick, fitOf } from './demand';
import { launch, startRun } from './run';
import { SEGMENTS } from './content/modalities';
import { RIVAL_LABS } from './content/flavor';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'llm-lets-loose-money/v2/save';
const SHARES = 100e6;

const lab = (brand: number): LabState => ({ techniques: [], data: {}, talent: 1, brand, hype: 0.1, lastLaunch: -99, history: [], maxCompute: 0, raceWins: 0 });
const company = (c: Partial<Company> & Pick<Company, 'id' | 'name' | 'tagline' | 'color' | 'ceo' | 'cash'>): Company => ({
  layer: 'lab', shares: SHARES, price: 1, hist: [], debt: 0, rev: 0, cost: 0, rev8: 0, ni8: 0, revGrowth: 0, negWeeks: 0, raisedAt: -99, ...c,
});

export function newGame(seed: number, name = 'Loose Money Labs'): GameState {
  const s: GameState = {
    v: SAVE_VERSION, seed, week: 0, playerId: 'you', labId: 'lab',
    actors: { you: { id: 'you', name: 'You', cash: 0, isPlayer: true } },
    companies: {}, holdings: [{ owner: 'you', company: 'lab', shares: SHARES * 0.6 }],
    models: {}, runs: {}, segments: {},
    market: { sentiment: 0, ...computeStart() },
    known: {}, standing: {}, callCount: {}, moments: [], log: [], tutorial: 0, over: false, nextId: 1,
  };
  s.companies.lab = company({ id: 'lab', name, tagline: "IPO'd on a pitch deck.", color: '#ff5d73', cash: 20e6,
    ceo: { name: 'You', style: 'hype', skill: 0.5, ego: 0.5 }, lab: { ...lab(0.1), hype: 0.3 } });
  for (const d of RIVAL_LABS) s.companies[d.id] = company({ id: d.id, name: d.name, tagline: d.tagline, color: d.color, cash: d.cash, ceo: d.ceo, lab: lab(0.25) });
  for (const d of Object.values(SEGMENTS)) s.segments[d.id] = { id: d.id, size: d.size, fit0: 40, share: {}, accounts: d.accounts.map(() => null) };

  // Rivals open the game with one shipped model each, built by the same engine.
  for (const d of RIVAL_LABS) {
    const run = startRun(s, d.id, aiBlueprint(s, s.companies[d.id], d.modality, d.start), 'internal', false);
    run.weeksDone = run.weeksPlanned;
    launch(s, run);
    s.companies[d.id].lab!.lastLaunch = -Math.floor(seed % 5) - RIVAL_LABS.indexOf(d);
  }
  for (const seg of Object.values(s.segments)) {
    const def = SEGMENTS[seg.id];
    seg.fit0 = Math.max(...Object.values(s.models).filter((m) => m.modality === def.modality).map((m) => fitOf(def, m.cap)));
  }
  let flow = demandTick(s);
  for (let i = 0; i < 12; i++) flow = demandTick(s);
  for (const co of Object.values(s.companies)) {
    co.rev = co.rev8 = flow[co.id]?.rev ?? 0;
    co.ni8 = co.rev - (flow[co.id]?.cogs ?? 0) - 100_000 - 0.12 * co.rev;
    co.cost = co.rev - co.ni8;
    co.price = Math.max(0.2, fairValue(s, co) / co.shares);
    co.hist = [co.price];
  }
  s.log = [{ week: 0, tone: 'info', text: `${name} lists on the stock exchange with no product, no revenue and a very good slide deck.` }];
  return s;
}

function computeStart(): { computePrice: number; scarcity: number } {
  const p = computePrice(0, 420);
  return { computePrice: p.price, scarcity: p.scarcity };
}
