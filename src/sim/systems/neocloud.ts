// v16 (GAME_DESIGN §26.4): the player as a compute provider. Dedicate datacenter halls to the neocloud, sell them
// on-demand at a price you set, sign multi-month capacity deals with NPC customers (rival labs, startups,
// enterprises), keep the SLA, and build a reputation. Revenue books under `cloud`, SLA credits under `sla`.
// Dedicated halls leave the own fleet (compute.ts) but keep paying power, hardware ops and upkeep there.
// State is created by the first neocloud action (or the Neocloud scenario), so games that never touch it draw nothing.
import type { ActionHandlers, CapacityContract, CapacityCustomerKind, CapacityOffer, GameState, Id, NeocloudState, Rng } from '../types';
import { GPUS } from '../data/gpus';
import { CLOUD_PROVIDERS } from '../data/clouds';
import { makeRng } from '../rng';
import { addExpense, addRevenue, clamp, formatMoney, newId, notify, pushNews, yearOf } from '../util';
import { datacenterRunningCostPerDay, gpuById, refreshFleet } from './compute';
import { inCrunch } from './cloudMarket';
import { labName } from './labs';

export const NEOCLOUD_TUNING = {
  /** Market price of a GPU-day = rentPerDay × MARKET_BASE × age factor × demand index (× any rent shock). */
  MARKET_BASE: 0.75,
  /** Once a newer generation ships, an older GPU drops to NEWER_GEN_DROP, then loses AGE_DECAY per year (floor AGE_FLOOR). */
  NEWER_GEN_DROP: 0.85,
  AGE_DECAY: 0.78,
  AGE_FLOOR: 0.08,
  /** Demand index = (DEMAND_BASE + DEMAND_HYPE × aiHype/100) × (1 + CRUNCH_DEMAND per provider in a crunch). */
  DEMAND_BASE: 0.8,
  DEMAND_HYPE: 0.4,
  CRUNCH_DEMAND: 0.1,
  /** On-demand utilization target = BASE_UTIL × demand × priceMult^-ELASTICITY × reputation factor, at most MAX_UTIL. */
  BASE_UTIL: 0.72,
  MAX_UTIL: 0.97,
  ELASTICITY: 2.5,
  /** Utilization moves this share of the way to its target each day (customers arrive and churn gradually). */
  CHURN_RATE: 0.1,
  /** GPUs the on-demand market will rent from you = DEPTH_BASE × DEPTH_GROWTH^(years since 2017) × demand × reputation factor. */
  DEPTH_BASE: 200,
  DEPTH_GROWTH: 2,
  /** Idle GPUs listed from the other halls are interruptible, so they sell at this share of the price. */
  IDLE_PRICE: 0.6,
  /** InfiniBand halls sell at this premium, and lab deals this big need them. */
  IB_PREMIUM: 1.15,
  IB_MIN_GPUS: 256,
  PRICE_MIN: 0.5,
  PRICE_MAX: 2,
  /** Reputation: start, daily gain while every deal holds its SLA, daily loss per deal below it, and one-off hits. */
  START_REP: 50,
  REP_GAIN: 0.04,
  REP_BREACH: 0.5,
  REP_TERMINATE: 8,
  REP_CANCEL: 10,
  /** Credit owed for each GPU-day missed while below the SLA, as a multiple of its price. */
  SLA_CREDIT: 2,
  /** Consecutive days below the SLA before the customer walks. */
  BREACH_TERMINATE_DAYS: 14,
  /** Cancelling a deal refunds this many days of it. */
  CANCEL_DAYS: 30,
  FIRST_OFFER_DAYS: 5,
  OFFER_GAP_MIN: 10,
  OFFER_GAP_MAX: 25,
  MAX_OFFERS: 4,
  OFFER_EXPIRY_DAYS: 21,
  /** A startup customer runs out of runway with this chance per day. */
  STARTUP_FAIL_PER_DAY: 1 / 700,
  /** A finished deal comes back as a renewal offer with chance RENEW_BASE × reputation/100. */
  RENEW_BASE: 0.9,
  SAMPLE_DAYS: 7,
  HISTORY_CAP: 200,
};
const T = NEOCLOUD_TUNING;

/** Customer profiles: share of the hall's GPUs they want, terms, SLA and price premium. */
const CUSTOMER: Record<CapacityCustomerKind, { size: [number, number]; months: number[]; sla: number; premium: number }> = {
  lab: { size: [0.4, 1], months: [6, 12, 24], sla: 0.97, premium: 1.05 },
  startup: { size: [0.1, 0.35], months: [3, 6], sla: 0.95, premium: 1.1 },
  enterprise: { size: [0.15, 0.5], months: [12, 24], sla: 0.99, premium: 1 },
};
const STARTUPS = ['Prompt & Circumstance', 'Hallucinate.io', 'AgentSmith Inc.', 'Vectorly', 'Tokenomics Ltd', 'Wrapper Co', 'Rizzoning Labs', 'Synergy.ai'];
const ENTERPRISES = ['Megabank of Amerigo', 'Initech Holdings', 'Globex Insurance', 'Umbrella Health', 'Acme Logistics', 'Ministry of Forms'];

/** A fresh neocloud business. `dedicated` halls start dedicated. */
export function startNeocloud(s: GameState, dedicated: Id[] = []): NeocloudState {
  return {
    dedicated: [...dedicated],
    listIdle: false,
    priceMult: 1,
    reputation: T.START_REP,
    utilization: 0,
    offers: [],
    contracts: [],
    nextOfferDay: s.day + T.FIRST_OFFER_DAYS,
    history: [],
    totalRevenue: 0,
    totalCredits: 0,
  };
}
function ensureNeocloud(s: GameState): NeocloudState {
  const n = (s.neocloud ??= startNeocloud(s));
  n.dedicated ??= [];
  n.offers ??= [];
  n.contracts ??= [];
  n.history ??= [];
  return n;
}

// ---------------------------------------------------------------------------
// Market (pure)
// ---------------------------------------------------------------------------

/** How hungry the market is for GPUs today: AI hype, plus spill-over from providers in a crunch. */
export function demandIndex(s: GameState): number {
  const crunches = CLOUD_PROVIDERS.filter((p) => inCrunch(s, p.id)).length;
  return (T.DEMAND_BASE + (T.DEMAND_HYPE * clamp(s.market.aiHype, 0, 100)) / 100) * (1 + T.CRUNCH_DEMAND * crunches);
}

/** Share of its launch price a GPU still fetches: full until a newer generation ships, then it decays. */
export function ageFactor(gpuId: Id, year: number): number {
  const g = gpuById(gpuId);
  if (!g) return 0;
  // Only a later and faster card makes this one old news (a budget or rival card does not).
  const newer = GPUS.find((x) => x.unlockYear > g.unlockYear && x.unlockYear <= year && x.pflops > g.pflops);
  return newer ? T.NEWER_GEN_DROP * Math.max(T.AGE_FLOOR, T.AGE_DECAY ** (year - newer.unlockYear)) : 1;
}

/** What the market pays a neocloud for one GPU-day of this generation today. */
export function marketGpuPrice(s: GameState, gpuId: Id): number {
  const g = gpuById(gpuId);
  const year = yearOf(s.day);
  if (!g || year < g.unlockYear) return 0;
  return g.rentPerDay * T.MARKET_BASE * ageFactor(gpuId, year) * demandIndex(s) * (s.flags['rentMult'] ?? 1);
}

function repFactor(rep: number): number {
  return 0.75 + (0.5 * clamp(rep, 0, 100)) / 100;
}

type Counts = Record<Id, number>;
function add(m: Counts, k: Id, v: number): void {
  if (v > 0) m[k] = (m[k] ?? 0) + v;
}
function total(m: Counts): number {
  let n = 0;
  for (const v of Object.values(m)) n += v;
  return n;
}

/** GPUs in finished dedicated halls, by GPU id, and the InfiniBand part of them. */
export function dedicatedPool(s: GameState): { all: Counts; ib: Counts } {
  const all: Counts = {};
  const ib: Counts = {};
  const ids = s.neocloud?.dedicated ?? [];
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft > 0 || !ids.includes(dc.id)) continue;
    for (const [g, n] of Object.entries(dc.gpus)) {
      add(all, g, n);
      if (dc.infiniband) add(ib, g, n);
    }
  }
  return { all, ib };
}

/** Idle GPUs of the other (own-fleet) halls, listed when listIdle is on: installed GPUs × the fleet's idle share. */
export function idlePool(s: GameState): Counts {
  const out: Counts = {};
  const n = s.neocloud;
  const fleet = s.compute.fleet;
  if (!n?.listIdle || !fleet || !(fleet.totalPflops > 0)) return out;
  const share = clamp(fleet.idlePflops / fleet.totalPflops, 0, 1);
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft > 0 || n.dedicated.includes(dc.id)) continue;
    for (const [g, c] of Object.entries(dc.gpus)) add(out, g, Math.floor(c * share));
  }
  return out;
}

export interface Delivery {
  contract: CapacityContract;
  delivered: number;
  share: number;
}

/** Today's neocloud picture. Pure: reads state, writes nothing. Revenue uses the current (smoothed) utilization. */
export interface NeocloudDay {
  deliveries: Delivery[];
  /** Dedicated GPUs left after the deals, sold on-demand, by GPU id; and the InfiniBand part. */
  onDemand: Counts;
  onDemandIb: Counts;
  /** Idle own-fleet GPUs listed (interruptible). */
  idle: Counts;
  dedicatedGpus: number;
  contractedGpus: number;
  listedGpus: number;
  targetUtilization: number;
  contractRevenue: number;
  onDemandRevenue: number;
  idleRevenue: number;
  credits: number;
  /** Power, hardware ops and upkeep of the dedicated halls (booked by compute.ts under their own lines). */
  hallCostPerDay: number;
}

export function neocloudDay(s: GameState): NeocloudDay {
  const n = s.neocloud;
  const pool = dedicatedPool(s);
  const all = { ...pool.all };
  const ib = { ...pool.ib };
  const deliveries: Delivery[] = [];
  // InfiniBand deals first, so ordinary deals do not take the halls they need. Then by signing order.
  const order = [...(n?.contracts ?? [])].sort((a, b) => Number(b.needsInfiniband) - Number(a.needsInfiniband) || a.startDay - b.startDay);
  for (const c of order) {
    let got = 0;
    if (c.needsInfiniband) {
      got = Math.min(c.count, ib[c.gpuId] ?? 0);
      ib[c.gpuId] = (ib[c.gpuId] ?? 0) - got;
    } else {
      const plain = Math.max(0, (all[c.gpuId] ?? 0) - (ib[c.gpuId] ?? 0));
      const fromPlain = Math.min(c.count, plain);
      const fromIb = Math.min(c.count - fromPlain, ib[c.gpuId] ?? 0);
      ib[c.gpuId] = (ib[c.gpuId] ?? 0) - fromIb;
      got = fromPlain + fromIb;
    }
    all[c.gpuId] = (all[c.gpuId] ?? 0) - got;
    deliveries.push({ contract: c, delivered: got, share: c.count > 0 ? got / c.count : 1 });
  }
  const onDemand: Counts = {};
  const onDemandIb: Counts = {};
  for (const [g, v] of Object.entries(all)) add(onDemand, g, v);
  for (const [g, v] of Object.entries(ib)) add(onDemandIb, g, v);
  const idle = idlePool(s);
  const listed = total(onDemand) + total(idle);

  const rep = n?.reputation ?? T.START_REP;
  const demand = demandIndex(s);
  const priceMult = n?.priceMult ?? 1;
  let target = clamp(T.BASE_UTIL * demand * priceMult ** -T.ELASTICITY * repFactor(rep), 0, T.MAX_UTIL);
  const depth = T.DEPTH_BASE * T.DEPTH_GROWTH ** Math.max(0, yearOf(s.day) - 2017) * demand * repFactor(rep);
  if (listed > 0) target = Math.min(target, depth / listed);
  const util = n?.utilization ?? 0;

  let contractRevenue = 0;
  let credits = 0;
  for (const d of deliveries) {
    contractRevenue += d.delivered * d.contract.price;
    if (d.share + 1e-9 < d.contract.sla) credits += (d.contract.count - d.delivered) * d.contract.price * T.SLA_CREDIT;
  }
  let onDemandRevenue = 0;
  for (const [g, v] of Object.entries(onDemand)) {
    const ibShare = v > 0 ? (onDemandIb[g] ?? 0) / v : 0;
    onDemandRevenue += v * marketGpuPrice(s, g) * priceMult * util * (1 + ibShare * (T.IB_PREMIUM - 1));
  }
  let idleRevenue = 0;
  for (const [g, v] of Object.entries(idle)) idleRevenue += v * marketGpuPrice(s, g) * priceMult * util * T.IDLE_PRICE;

  let hallCostPerDay = 0;
  for (const dc of s.compute.datacenters) if (n?.dedicated.includes(dc.id)) hallCostPerDay += datacenterRunningCostPerDay(dc);

  return {
    deliveries,
    onDemand,
    onDemandIb,
    idle,
    dedicatedGpus: total(pool.all),
    contractedGpus: deliveries.reduce((a, d) => a + d.contract.count, 0),
    listedGpus: listed,
    targetUtilization: target,
    contractRevenue,
    onDemandRevenue,
    idleRevenue,
    credits,
    hallCostPerDay,
  };
}

/** Free dedicated GPUs of one kind for a new deal (InfiniBand halls only when the deal needs them). */
export function freeForDeal(s: GameState, gpuId: Id, needsInfiniband: boolean): number {
  const d = neocloudDay(s);
  return (needsInfiniband ? d.onDemandIb : d.onDemand)[gpuId] ?? 0;
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

function makeOffer(s: GameState, n: NeocloudState, rng: Rng, renewOf?: CapacityContract): CapacityOffer | null {
  let kind: CapacityCustomerKind;
  let gpuId: Id;
  let count: number;
  let months: number;
  let customer: string;
  let labId: Id | undefined;
  if (renewOf) {
    ({ kind, gpuId, count, months, customer, labId } = renewOf);
  } else {
    // Offers are sized to the halls you dedicate (or, before that, to what you have installed).
    const pool = dedicatedPool(s).all;
    const have: Counts = total(pool) > 0 ? pool : {};
    if (total(have) === 0) for (const dc of s.compute.datacenters) if (dc.buildDaysLeft <= 0) for (const [g, c] of Object.entries(dc.gpus)) add(have, g, c);
    const gens = Object.keys(have);
    if (gens.length === 0) return null;
    gpuId = rng.pick(gens);
    const labs = s.competitors.filter((c) => c.active);
    const r = rng.next();
    kind = labs.length > 0 && r < 0.3 ? 'lab' : r < 0.7 ? 'startup' : 'enterprise';
    const prof = CUSTOMER[kind];
    const raw = have[gpuId] * rng.range(prof.size[0], prof.size[1]);
    count = Math.max(1, raw >= 16 ? Math.round(raw / 8) * 8 : Math.round(raw));
    months = rng.pick(prof.months);
    if (kind === 'lab') {
      labId = rng.pick(labs).id;
      customer = labName(s, labId);
    } else customer = rng.pick(kind === 'startup' ? STARTUPS : ENTERPRISES);
  }
  const prof = CUSTOMER[kind];
  const needsInfiniband = kind === 'lab' && count >= T.IB_MIN_GPUS;
  // Longer terms buy a discount; the price is locked for the term, so a long deal signed before the next
  // generation ships keeps paying the old price.
  const term = months >= 24 ? 0.88 : months >= 12 ? 0.94 : 1;
  const price =
    marketGpuPrice(s, gpuId) * prof.premium * term * (0.9 + (0.2 * n.reputation) / 100) * rng.range(0.92, 1.08) * (needsInfiniband ? T.IB_PREMIUM : 1);
  if (!(price > 0)) return null;
  return {
    id: newId(s, 'nco'),
    customer,
    kind,
    labId,
    gpuId,
    count,
    months,
    price,
    sla: prof.sla,
    needsInfiniband,
    expiresDay: s.day + T.OFFER_EXPIRY_DAYS,
    renewal: !!renewOf,
  };
}

// ---------------------------------------------------------------------------
// Daily tick (after servingTick, so the fleet's idle share is today's)
// ---------------------------------------------------------------------------

const RNG_FLAG = 'neocloud.rng';
function withNeoRng<R>(s: GameState, fn: (rng: Rng) => R): R {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x2e0c10d5) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

export function neocloudTick(s: GameState, _rng?: Rng): void {
  if (!s.neocloud) return;
  const n = ensureNeocloud(s);
  n.dedicated = n.dedicated.filter((id) => s.compute.datacenters.some((d) => d.id === id));

  // Utilization drifts toward its target: new customers arrive slowly, unhappy ones churn slowly.
  const target = neocloudDay(s).targetUtilization;
  n.utilization = clamp(n.utilization + (target - n.utilization) * T.CHURN_RATE, 0, 1);
  const day = neocloudDay(s);
  const revenue = day.contractRevenue + day.onDemandRevenue + day.idleRevenue;
  addRevenue(s, 'cloud', revenue);
  addExpense(s, 'sla', day.credits);
  n.totalRevenue += revenue;
  n.totalCredits += day.credits;

  withNeoRng(s, (rng) => {
    const gone = new Set<CapacityContract>();
    for (const d of day.deliveries) {
      const c = d.contract;
      c.delivered = d.share;
      if (d.share + 1e-9 < c.sla) {
        c.breachDays += 1;
        n.reputation -= T.REP_BREACH;
        if (c.breachDays === 1) notify(s, `${c.customer} is getting ${Math.round(d.share * 100)}% of its ${c.count.toLocaleString('en-US')} GPUs (SLA ${Math.round(c.sla * 100)}%). Credits are due every day.`, 'bad');
        if (c.breachDays >= T.BREACH_TERMINATE_DAYS) {
          gone.add(c);
          n.reputation -= T.REP_TERMINATE;
          notify(s, `${c.customer} terminated its capacity deal after ${c.breachDays} days below the SLA.`, 'bad');
          pushNews(s, `${c.customer} walks out on ${s.company.name}'s cloud. "The GPUs were theoretical."`, 'bad');
        }
      } else c.breachDays = 0;
      if (!gone.has(c) && c.kind === 'startup' && rng.chance(T.STARTUP_FAIL_PER_DAY)) {
        gone.add(c);
        notify(s, `${c.customer} ran out of runway and stopped paying for its GPUs. Startups.`, 'info');
      }
    }
    for (const c of n.contracts) {
      if (gone.has(c) || c.endDay > s.day) continue;
      gone.add(c);
      if (rng.chance((T.RENEW_BASE * clamp(n.reputation, 0, 100)) / 100)) {
        const o = makeOffer(s, n, rng, c);
        if (o) {
          n.offers.push(o);
          notify(s, `${c.customer}'s capacity deal ended. They want to renew.`, 'good');
          continue;
        }
      }
      notify(s, `${c.customer}'s capacity deal ended and they moved to another cloud.`, 'info');
    }
    n.contracts = n.contracts.filter((c) => !gone.has(c));
    // Reputation grows slowly while you sell anything and every deal holds its SLA.
    if ((day.deliveries.length > 0 || day.listedGpus > 0) && day.deliveries.every((d) => d.share + 1e-9 >= d.contract.sla)) n.reputation += T.REP_GAIN;

    n.offers = n.offers.filter((o) => o.expiresDay > s.day);
    if (s.day >= n.nextOfferDay) {
      const gap = rng.int(T.OFFER_GAP_MIN, T.OFFER_GAP_MAX) * (1 - (0.3 * clamp(n.reputation, 0, 100)) / 100);
      n.nextOfferDay = s.day + Math.max(1, Math.round(gap));
      if (n.offers.length < T.MAX_OFFERS) {
        const o = makeOffer(s, n, rng);
        if (o) n.offers.push(o);
      }
    }
  });
  n.reputation = clamp(n.reputation, 0, 100);

  if (s.day % T.SAMPLE_DAYS === 0) {
    n.history.push({ day: s.day, revenue, utilization: n.utilization });
    if (n.history.length > T.HISTORY_CAP) n.history.splice(0, n.history.length - T.HISTORY_CAP);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const handlers: ActionHandlers = {
  setNeocloudHall: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc) return notify(s, 'Unknown datacenter.', 'bad');
    const n = ensureNeocloud(s);
    const has = n.dedicated.includes(dc.id);
    if (a.dedicated === has) return;
    if (a.dedicated) {
      n.dedicated.push(dc.id);
      notify(s, `${dc.name} now sells its GPUs to cloud customers. It no longer trains or serves for you.`, 'good');
    } else {
      n.dedicated = n.dedicated.filter((id) => id !== dc.id);
      const short = neocloudDay(s).deliveries.some((d) => d.share + 1e-9 < d.contract.sla);
      notify(s, `${dc.name} is back in your own fleet.${short ? ' Some capacity deals are now below their SLA.' : ''}`, short ? 'bad' : 'info');
    }
    refreshFleet(s);
  },
  setNeocloudListIdle: (s, a) => {
    ensureNeocloud(s).listIdle = !!a.on;
  },
  setNeocloudPrice: (s, a) => {
    if (!Number.isFinite(a.mult)) return;
    ensureNeocloud(s).priceMult = clamp(a.mult, T.PRICE_MIN, T.PRICE_MAX);
  },
  acceptCapacityDeal: (s, a) => {
    const n = ensureNeocloud(s);
    const o = n.offers.find((x) => x.id === a.offerId);
    if (!o) return notify(s, 'That offer is gone.', 'bad');
    const free = freeForDeal(s, o.gpuId, o.needsInfiniband);
    if (free < o.count) {
      const name = gpuById(o.gpuId)?.name ?? o.gpuId;
      return notify(
        s,
        `Need ${o.count.toLocaleString('en-US')} free ${name} in ${o.needsInfiniband ? 'InfiniBand ' : ''}neocloud halls (have ${free.toLocaleString('en-US')}). Dedicate a hall or install more.`,
        'bad',
      );
    }
    const { expiresDay: _e, ...deal } = o;
    n.offers = n.offers.filter((x) => x !== o);
    n.contracts.push({ ...deal, startDay: s.day, endDay: s.day + Math.round((o.months * 365) / 12), breachDays: 0, delivered: 1 });
    notify(s, `Signed ${o.customer}: ${o.count.toLocaleString('en-US')} GPUs for ${o.months} months at ${formatMoney(o.price)}/GPU-day.`, 'good');
  },
  declineCapacityDeal: (s, a) => {
    const n = ensureNeocloud(s);
    n.offers = n.offers.filter((x) => x.id !== a.offerId);
  },
  cancelCapacityDeal: (s, a) => {
    const n = ensureNeocloud(s);
    const c = n.contracts.find((x) => x.id === a.contractId);
    if (!c) return notify(s, 'No such capacity deal.', 'bad');
    const fee = T.CANCEL_DAYS * c.count * c.price;
    addExpense(s, 'sla', fee);
    n.totalCredits += fee;
    n.reputation = clamp(n.reputation - T.REP_CANCEL, 0, 100);
    n.contracts = n.contracts.filter((x) => x !== c);
    notify(s, `Cancelled ${c.customer}'s deal. Refunded ${formatMoney(fee)}; your reputation as a provider took a hit.`, 'bad');
  },
};
