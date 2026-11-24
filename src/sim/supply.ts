// The supply chain behind the compute price: power feeds fabs, fabs make chips, chips fill clouds, clouds rent to labs.
// The tightest layer sets how much compute exists, and pockets most of the scarcity premium.
import type { Company, GameState, Id, Layer } from './types';
import { clamp, rand } from './rand';
import { sharesOf } from './stock';
import { money } from './run';

export const LAYERS: Layer[] = ['power', 'fab', 'chips', 'cloud'];
/** How a dollar of compute spending splits across the layers in normal times. */
export const SHARE: Record<string, number> = { cloud: 0.35, chips: 0.3, fab: 0.2, power: 0.15 };
/** Weeks between deciding to build and the capacity arriving. Long lead times are why crunches last. */
export const LEAD: Record<string, number> = { cloud: 8, chips: 12, power: 36, fab: 48 };
export const LAYER_NAME: Record<string, string> = { cloud: 'Clouds', chips: 'Chip designers', fab: 'Fabs', power: 'Power' };
const POSTURE = { '-1': { w: 1.3, p: 0.85 }, '0': { w: 1, p: 1 }, '1': { w: 0.75, p: 1.15 } };
const BUILD = [0.004, 0.03, 0.06]; // weekly capacity growth by build lever
export const CONTRACT_WEEKS = 48;
export const CONTRACT_MARKUP = 1.15;
const OWNED_PRICE = 0.6; // a wholly-owned cloud serves its parent at cost, as a share of the base price

export const basePrice = (week: number): number => 10_000 * Math.pow(0.9885, week); // hardware gets ~43% cheaper a year
export const suppliers = (s: GameState, layer?: Layer): Company[] => Object.values(s.companies).filter((c) => c.plant && (!layer || c.layer === layer));
export const layerCapacity = (s: GameState, layer: Layer): number => suppliers(s, layer).reduce((a, c) => a + c.plant!.capacity, 0);

/** Serving and training prices after the discount from the lab's own chips. */
export const servePrice = (s: GameState, labId: Id): number => labPrice(s, labId) * (s.companies[labId]?.lab?.hw.infer ?? 1);
export const trainPrice = (s: GameState, labId: Id): number => labPrice(s, labId) * (s.companies[labId]?.lab?.hw.train ?? 1);

/** What a lab pays per compute-week: last week's blend of owned capacity, contract and spot. */
export const labPrice = (s: GameState, labId: Id): number => s.companies[labId]?.lab?.cuPrice || s.market.computePrice;
/** Clouds a lab owns outright. Only full ownership earns the at-cost transfer price. */
export const ownedClouds = (s: GameState, labId: Id): Company[] => suppliers(s, 'cloud').filter((c) => sharesOf(s, labId, c.id) >= 0.9 * c.shares);
/** True when the player sets this company's levers: personal control, or control through the lab they run. */
export function playerControls(s: GameState, coId: Id): boolean {
  const half = 0.5 * s.companies[coId].shares;
  return sharesOf(s, s.playerId, coId) >= half || (s.helm && sharesOf(s, s.labId, coId) >= half);
}

/** One week of the chain. `use` is each lab's compute appetite this week. Returns each supplier's revenue and cost. */
export function supplyTick(s: GameState, use: Record<Id, number>): Record<Id, { rev: number; cogs: number; cu: number }> {
  const flow: Record<Id, { rev: number; cogs: number; cu: number }> = {};
  const D = Object.values(use).reduce((a, b) => a + b, 0);
  const now = s.market.base, sc = s.market.scarcity, binding = s.market.binding;
  const baseline = D * now * Math.min(1, sc), premium = D * now * Math.max(0, sc - 1);
  const spot = s.market.computePrice;

  for (const layer of LAYERS) {
    const cos = suppliers(s, layer);
    const cap = layerCapacity(s, layer);
    const layerRev = baseline * SHARE[layer] + premium * (binding === 'cloud' ? (layer === 'cloud' ? 1 : 0) : layer === binding ? 0.7 : layer === 'cloud' ? 0.3 : 0);
    const weight = (c: Company): number => c.plant!.capacity * POSTURE[c.plant!.posture].w;
    const total = cos.reduce((a, c) => a + weight(c), 0) || 1;
    const util = D / Math.max(1, cap);
    for (const c of cos) {
      const p = c.plant!;
      // Refusing a customer forgoes their business.
      const refused = p.blocked.reduce((a, id) => a + (use[id] ?? 0), 0) / Math.max(1, D);
      let rev = layerRev * (weight(c) / total) * POSTURE[p.posture].p * (1 - refused);
      // Arrivals, then this week's building. Rivals build to their utilisation; the player's companies follow the lever.
      p.capacity += p.queue.filter((q) => q.week <= s.week).reduce((a, q) => a + q.add, 0);
      p.queue = p.queue.filter((q) => q.week > s.week);
      if (!playerControls(s, c.id)) p.capex = util > 0.85 ? 2 : util < 0.55 ? 0 : 1;
      const add = p.capacity * BUILD[p.capex];
      const capex = add * 26 * SHARE[layer] * now;
      const opex = 0.35 * SHARE[layer] * now * p.capacity;
      let cost = opex;
      if (c.cash > capex) { p.queue.push({ week: s.week + LEAD[layer], add }); cost += capex; }
      // A cloud owned outright by a lab serves it at cost; the discount comes out of the cloud's revenue.
      if (layer === 'cloud') for (const lab of Object.values(s.companies)) {
        if (!lab.lab || sharesOf(s, lab.id, c.id) < 0.9 * c.shares) continue;
        rev -= Math.min(use[lab.id] ?? 0, p.capacity) * Math.max(0, spot - OWNED_PRICE * now) * SHARE.cloud;
      }
      flow[c.id] = { rev: Math.max(0, rev), cogs: cost, cu: 0 };
      // Blocking rivals while your lab dominates draws a must-supply decree.
      if (p.blocked.length && playerControls(s, c.id)) {
        const labs = Object.values(s.companies).filter((x) => x.lab);
        const share = (s.companies[s.labId]?.rev ?? 0) / Math.max(1, labs.reduce((a, x) => a + x.rev, 0));
        if (share > 0.35 && rand(s.seed, s.week, c.id, 'decree') < 0.1) {
          p.blocked = [];
          p.decreeUntil = s.week + 96;
          c.cash -= 0.05 * Math.max(0, c.cash);
          s.log.push({ week: s.week, co: c.id, tone: 'bad', text: `Regulators order ${c.name} to serve everyone for two years, and send a fine.` });
        }
      }
    }
  }

  // Next week's price: the tightest layer decides how much compute there is.
  const caps = Object.fromEntries(LAYERS.map((l) => [l, layerCapacity(s, l)]));
  const tight = LAYERS.reduce((a, l) => (caps[l] < caps[a] ? l : a), 'cloud' as Layer);
  // Prices move halfway to the new balance each week: contracts and inventories damp the swings.
  const scarcity = 0.5 * sc + 0.5 * clamp(Math.pow(D / Math.max(1, caps[tight]), 1.5), 0.6, 12);
  const base = basePrice(s.week + 1);
  s.market = { ...s.market, base, scarcity, binding: tight, capacity: caps, demand: D, computePrice: base * scarcity };

  // What each lab pays next week: owned cloud capacity first, then its contract, then spot. Blocked labs pay a surcharge.
  s.contracts = s.contracts.filter((c) => c.until > s.week && s.companies[c.lab]);
  const cloudCap = Math.max(1, caps.cloud);
  for (const lab of Object.values(s.companies)) {
    if (!lab.lab) continue;
    const u = use[lab.id] ?? 0;
    const blockedShare = suppliers(s, 'cloud').reduce((a, c) => a + (c.plant!.blocked.includes(lab.id) ? c.plant!.capacity : 0), 0) / cloudCap;
    const spotNext = base * scarcity * (1 + 0.5 * blockedShare);
    const owned = Math.min(u, ownedClouds(s, lab.id).reduce((a, c) => a + c.plant!.capacity, 0));
    const k = s.contracts.find((c) => c.lab === lab.id);
    const contracted = k ? Math.min(u - owned, k.units) : 0;
    const rest = Math.max(0, u - owned - contracted);
    lab.lab.cuUsed = u;
    lab.lab.cuPrice = u > 0 ? (owned * OWNED_PRICE * base + contracted * (k?.price ?? 0) + rest * spotNext) / u : spotNext;
    if (k) lab.cash -= Math.max(0, k.units - contracted) * k.price; // take-or-pay
  }
  return flow;
}

export function contractCheck(s: GameState, units: number): string | null {
  if (!(units > 0)) return 'Pick an amount.';
  if (s.contracts.some((c) => c.lab === s.labId)) return 'You already have a contract running.';
  if (units > 0.4 * layerCapacity(s, 'cloud')) return 'No cloud will commit that much to one customer.';
  return null;
}

export const contractPrice = (s: GameState): number => s.market.base * CONTRACT_MARKUP;
export const describeContract = (s: GameState, labId: Id): string | null => {
  const k = s.contracts.find((c) => c.lab === labId);
  return k ? `${Math.round(k.units)} compute-weeks a week at ${money(k.price)} each, for ${k.until - s.week} more weeks` : null;
};
