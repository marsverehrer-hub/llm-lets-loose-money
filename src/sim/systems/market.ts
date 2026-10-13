// OWNER: Agent B. Segment growth, AI hype cycle, attractiveness/shares, marketing campaigns.
// Dependency rule: this module must NOT import products.ts or competitors.ts (they import from here).
import type { ActionHandlers, BenchmarkCategory, BuyerTier, Competitor, GameState, Id, Model, Product, ProductKind, Rng, RivalLineModel, Scores, Segment } from '../types';
import { BUYER_TIERS, KIND_OF, SEGMENT_OF } from '../types';
import { BALANCE } from '../balance';
import { CAMPAIGNS } from '../data/campaigns';
import { classThresholds } from '../data/weightClasses';
import { getBonuses } from '../bonuses';
import type { Bonuses } from '../types';
import { calendarYear, clamp, notify, pushNews, trySpend, yearOf } from '../util';
import { roleStrength } from './staff';
import { marketGrowthMult } from './scenario'; // v9 scenario
import { productFitFor, rivalFlagshipActiveB, sycophancyAttraction } from './capabilities';
import { playerCrownCounts, rivalLines } from './classes';
import { labInfo, labName } from './labs';
import { masteryAppeal, productActiveB, routedQuality, routerModelOf } from './modelLife'; // v15

export interface ShareRow { id: string; name: string; color: string; isPlayer: boolean; users: number; share: number; quality: number; price: number }

export const SEGMENTS: Segment[] = ['consumer', 'developer', 'enterprise'];
export const PLAYER_COLOR = '#7c5cff';
/** Calendar year from which rival labs can ship consumer chat. */
export const CHAT_WORLD_YEAR = 2022;

const CHAT_MOMENT_HYPE = 15;
const BRAND_DECAY_PER_DAY = 0.0006;

/** v10: the marketing team finally does something (GAME_DESIGN §21.5). */
export const MARKETING_TUNING = {
  /** Campaign brand and hype gain × (1 + CAMPAIGN_BOOST · √strength). 25 marketers ≈ +40%. */
  CAMPAIGN_BOOST: 0.08,
  /** Passive brand points per day per √strength (word of mouth, launch posts, conference booths). */
  PASSIVE_BRAND_PER_SQRT: 0.003,
};

/** What the marketing team adds today: campaign multiplier and passive brand points per day. */
export function marketingTeamEffect(s: GameState): { campaignMult: number; brandPerDay: number } {
  const root = Math.sqrt(Math.max(0, roleStrength(s, 'marketing')));
  return { campaignMult: 1 + MARKETING_TUNING.CAMPAIGN_BOOST * root, brandPerDay: MARKETING_TUNING.PASSIVE_BRAND_PER_SQRT * root };
}
const HYPE_DECAY_PER_DAY = 0.02;
const ADOPTION_RELAX_PER_DAY = 0.01;
const HYPE_RELAX_PER_DAY = 0.05;
export const MAX_ACTIVE_CAMPAIGNS = 4;
const TARGETED_CAMPAIGN_BOOST = 0.15;
const MAX_TARGETED_CAMPAIGN_BOOST = 0.45;
const PRICE_FLOOR_FRACTION = 0.01;
/** Multiplayer: while the undercut flag is live, the rival's prices count this much cheaper in our market. */
const MP_UNDERCUT_FLAG = 'mpUndercutUntil';
const MP_UNDERCUT_PRICE_MULT = 0.85;
/** Multiplayer: satisfaction term mirrored from the player formula (playerExtra with satisfaction 70). */
const MP_RIVAL_SATISFACTION_TERM = 0.91;

// Anchor tables: [calendar year, value]. Log-interpolated where marked.
const TAM_POINTS: Record<Segment, [number, number][]> = {
  consumer: [[2017, 50e6], [2023, 1e9], [2030, 3e9], [2040, 4.5e9]],
  developer: [[2017, 2e5], [2025, 3e7], [2040, 1e8]],
  enterprise: [[2017, 5e5], [2030, 5e8], [2040, 9e8]],
};
/** $/Mtok for developer, $/user/month for consumer, $/seat/month for enterprise. */
const PRICE_POINTS: Record<Segment, [number, number][]> = {
  consumer: [[2017, 20], [2026, 20], [2030, 12], [2040, 12]],
  developer: [[2017, 30], [2023, 10], [2026, 6], [2030, 2.5], [2040, 2.5]],
  enterprise: [[2017, 60], [2030, 30], [2040, 30]],
};
/** Share of TAM paying for any LLM product, before the hype/quality/campaign multipliers. */
const ADOPTION_CEILING: Record<Segment, [number, number][]> = {
  consumer: [[2017, 0.0005], [2022, 0.02], [2026, 0.2], [2030, 0.3], [2040, 0.4]],
  developer: [[2017, 0.18], [2023, 0.3], [2030, 0.5], [2040, 0.6]],
  enterprise: [[2017, 0.01], [2023, 0.08], [2030, 0.35], [2040, 0.45]],
};
/** Base AI hype cycle: rises to ~90 in 2024, trough ~55 in 2027, then climbs again. */
const HYPE_BASE: [number, number][] = [
  [2017, 10], [2019, 25], [2021, 40], [2023, 80], [2024.5, 90], [2026, 80], [2027.5, 55], [2030, 70], [2035, 82], [2045, 80],
];
/**
 * Frontier overall by calendar year (see GAME_DESIGN.md section 8). v7 (§18.1): 2017-2021 lifted so a competent
 * player sits near the frontier (within about +5) rather than +25 above it. Monotonic, and it tapers back to the
 * original 2030 anchor (97).
 */
const FRONTIER_POINTS: [number, number][] = [
  [2017, 30], [2017.5, 50], [2018, 60], [2018.5, 71], [2019, 74], [2019.5, 77], [2020, 81], [2021, 86],
  [2022, 89], [2023, 91], [2024, 92.5], [2025, 93.5], [2026, 94.2], [2028, 95.4], [2030, 96.5],
];

/** Piecewise-linear (or log-linear) interpolation; holds the end values outside the table. */
function interp(points: readonly (readonly [number, number])[], x: number, logScale = false): number {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      const t = (x - x0) / (x1 - x0);
      return logScale ? Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t) : y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

/** Frontier quality (0..100 overall) expected for a fractional calendar year. Monotonic, approaches 99. */
export function frontierQuality(year: number): number {
  if (year >= 2030) return 99 - 2.5 * Math.exp(-(year - 2030) / 8);
  return interp(FRONTIER_POINTS, year);
}
export function tamFor(seg: Segment, year: number): number {
  return interp(TAM_POINTS[seg], year, true);
}
export function refPriceFor(seg: Segment, year: number): number {
  return interp(PRICE_POINTS[seg], year, true);
}
/** Millions of tokens per user per day in a segment. */
export function mtokPerUserDay(seg: Segment, year: number): number {
  if (seg === 'consumer') return 0.005 * 1.3 ** Math.max(0, year - 2022);
  if (seg === 'developer') return 0.02 * 1.6 ** Math.max(0, year - 2017);
  return 0.01 * 1.4 ** Math.max(0, year - 2017);
}
/** Segment-relevant quality: chat -> (chat+reasoning)/2, api -> (coding+reasoning)/2, enterprise -> overall. */
export function segQuality(seg: Segment, sc: Scores, overall: number): number {
  if (seg === 'consumer') return (sc.chat + sc.reasoning) / 2;
  if (seg === 'developer') return (sc.coding + sc.reasoning) / 2;
  return overall;
}
/**
 * Attractiveness of one offer in a segment. `extra` carries situational multipliers
 * (reputation, satisfaction, sales, safety) that callers compute.
 */
export function attractiveness(quality: number, price: number, refPrice: number, brand: number, hype: number, extra = 1): number {
  const q = Math.max(0, quality);
  const p = Math.max(PRICE_FLOOR_FRACTION * refPrice, price);
  return (
    (q / 50) ** BALANCE.ATTR_QUALITY_EXP *
    (refPrice / p) ** BALANCE.ATTR_PRICE_EXP *
    (0.5 + brand / 100) *
    (0.8 + hype / 250) *
    extra
  );
}

export function modelById(s: GameState, id: string | null): Model | undefined {
  if (!id) return undefined;
  return s.models.find((m) => m.id === id);
}
/** Best released, non-deprecated player model by overall score. */
export function bestPlayerModel(s: GameState): Model | null {
  let best: Model | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated) continue;
    if (!best || m.overall > best.overall) best = m;
  }
  return best;
}
/** Best overall in the world right now: frontier curve, rival releases, and the player's best. */
export function worldBestOverall(s: GameState, year: number): number {
  let best = frontierQuality(year);
  for (const c of s.competitors) if (c.active && c.model) best = Math.max(best, c.model.overall);
  const p = bestPlayerModel(s);
  if (p) best = Math.max(best, p.overall);
  return best;
}
function campaignDef(id: string) {
  return CAMPAIGNS.find((c) => c.id === id);
}

/** Consumer chat becomes possible for the whole world. Fires once. */
export function triggerChatMoment(s: GameState, who: string): void {
  if ('chatMoment' in s.flags) return;
  s.flags['chatMoment'] = s.day;
  nudgeAiHype(s, CHAT_MOMENT_HYPE);
  pushNews(s, `ChatMoment: ${who} ships a chatbot normal people can use. Grandma is now a prompt engineer.`, 'milestone');
}
/** Big releases and launches push the global hype cycle; the nudge decays over ~30 days. */
export function nudgeAiHype(s: GameState, amount: number): void {
  const cur = s.flags['hypeNudge'] ?? 0;
  s.flags['hypeNudge'] = clamp(cur + amount, -40, 40);
}

/** Player multipliers on attractiveness (reputation, satisfaction, enterprise sales and safety, crowns). */
function playerExtra(s: GameState, seg: Segment, sc: Scores, satisfaction: number, bonuses: Bonuses, crown: number): number {
  let x = (0.7 + (0.3 * s.company.reputation) / 100) * (0.7 + (0.3 * satisfaction) / 100);
  if (seg === 'enterprise') {
    x *= bonuses.sales * (1 + 0.1 * Math.sqrt(Math.max(0, roleStrength(s, 'sales')))) * (0.7 + sc.safety / 200);
  }
  return x * crown;
}

// ---------------------------------------------------------------------------
// v8 buyer tiers and product lines (GAME_DESIGN §19.3)
// ---------------------------------------------------------------------------

export const TIER_TUNING = {
  /** Tier weights are linear between these anchor years and held flat outside them. */
  WEIGHT_FROM_YEAR: 2017,
  WEIGHT_TO_YEAR: 2030,
  WEIGHTS_FROM: { premium: 0.3, mainstream: 0.5, budget: 0.2 } as Record<BuyerTier, number>,
  WEIGHTS_TO: { premium: 0.2, mainstream: 0.45, budget: 0.35 } as Record<BuyerTier, number>,
  PREMIUM_QUALITY_EXP: 3.2,
  /** v1.0 tuning: premium buyers mostly buy quality, so price barely moves them. */
  PREMIUM_PRICE_EXP: 0.4,
  /** Budget quality term is min(cap, (quality / (frontier - offset))^exp). v1.0 tuning: quality matters again. */
  BUDGET_QUALITY_CAP: 1.2,
  BUDGET_QUALITY_OFFSET: 20,
  BUDGET_QUALITY_EXP: 1.2,
  BUDGET_PRICE_EXP: 1.8,
  /** Speed bonus clamp((nanoThreshold * 4 / activeParams)^exp, min, max). */
  BUDGET_SPEED_EXP: 0.12,
  BUDGET_SPEED_MIN: 0.8,
  BUDGET_SPEED_MAX: 1.3,
  /** A rival's budget line is priced at its flagship price times this, by the line's weight class. */
  RIVAL_LINE_PRICE_MULT: { nano: 0.3, small: 0.5, medium: 0.7 } as Record<'nano' | 'small' | 'medium', number>,
  /** Each crown in a segment's categories adds this, capped at CROWN_MULT_CAP, then times crownValue. */
  CROWN_MULT_PER_CROWN: 0.03,
  CROWN_MULT_CAP: 1.15,
};

/** Benchmark categories whose crowns pay each segment. 'language' is the multilingual bucket. */
export const CROWN_CATEGORIES: Record<Segment, (BenchmarkCategory | 'efficiency')[]> = {
  developer: ['coding', 'agentic'],
  enterprise: ['reasoning', 'knowledge', 'safety'],
  consumer: ['chat', 'language'],
};

/** Buyer-tier weights for a calendar year. They always sum to 1. */
export function tierWeights(year: number): Record<BuyerTier, number> {
  const T = TIER_TUNING;
  const t = clamp((year - T.WEIGHT_FROM_YEAR) / (T.WEIGHT_TO_YEAR - T.WEIGHT_FROM_YEAR), 0, 1);
  const lerp = (tier: BuyerTier) => T.WEIGHTS_FROM[tier] + (T.WEIGHTS_TO[tier] - T.WEIGHTS_FROM[tier]) * t;
  return { premium: lerp('premium'), mainstream: lerp('mainstream'), budget: lerp('budget') };
}

/** Crown multiplier on the player's attractiveness in one segment: min(cap, 1 + 0.03 * crowns) * crownValue. */
export function crownMultiplier(s: GameState, seg: Segment, bonuses: Bonuses): number {
  const counts = playerCrownCounts(s);
  const n = CROWN_CATEGORIES[seg].reduce((t, cat) => t + (counts[cat] ?? 0), 0);
  return Math.min(TIER_TUNING.CROWN_MULT_CAP, 1 + TIER_TUNING.CROWN_MULT_PER_CROWN * n) * (bonuses.crownValue ?? 1);
}

/** Inputs to one offer's attractiveness in one tier. */
export interface OfferTerms {
  quality: number;
  price: number;
  refPrice: number;
  brand: number;
  hype: number;
  /** Situational multipliers: reputation, satisfaction, sales, safety, product fit, crowns. */
  extra: number;
  /** Active parameters (B) of the model behind the offer. Drives the budget speed bonus. */
  activeB: number;
  /** Player only: the doctrine's budget appeal. Rivals leave it at 1. */
  budgetAppeal?: number;
}

/**
 * Attractiveness of one offer inside one buyer tier.
 * - mainstream: the classic formula (quality^2.2, price^-1.3).
 * - premium: quality^3.2, price^-0.4, so the best model wins and price matters little.
 * - budget: a capped quality term ((q / (frontier - 20))^1.2, capped at 1.2), price^-1.8, a speed bonus for small active
 *   sizes, times budget appeal (v1.0 tuning, GAME_DESIGN §18.2).
 */
export function tierAttractiveness(tier: BuyerTier, o: OfferTerms, year: number, frontier: number): number {
  if (tier === 'mainstream') return attractiveness(o.quality, o.price, o.refPrice, o.brand, o.hype, o.extra);
  const T = TIER_TUNING;
  const q = Math.max(0, o.quality);
  const p = Math.max(PRICE_FLOOR_FRACTION * o.refPrice, o.price);
  const brandHype = (0.5 + o.brand / 100) * (0.8 + o.hype / 250) * o.extra;
  if (tier === 'premium') return (q / 50) ** T.PREMIUM_QUALITY_EXP * (o.refPrice / p) ** T.PREMIUM_PRICE_EXP * brandHype;
  const qTerm = Math.min(T.BUDGET_QUALITY_CAP, (q / Math.max(1, frontier - T.BUDGET_QUALITY_OFFSET)) ** T.BUDGET_QUALITY_EXP);
  const nano = classThresholds(year).nano;
  const speed = clamp(((nano * 4) / Math.max(1e-6, o.activeB)) ** T.BUDGET_SPEED_EXP, T.BUDGET_SPEED_MIN, T.BUDGET_SPEED_MAX);
  return qTerm * (o.refPrice / p) ** T.BUDGET_PRICE_EXP * speed * brandHype * (o.budgetAppeal ?? 1);
}

/** Per-call context for the tier maths. Build it once per tick or preview, not per offer. */
interface TierCtx {
  year: number;
  frontier: number;
  bonuses: Bonuses;
  chatOpen: boolean;
  weights: Record<BuyerTier, number>;
  crown: Record<Segment, number>;
  /** The best (highest overall) rival line of each lab. Labs without a line are absent. */
  lines: Map<Id, RivalLineModel>;
}

function tierContext(s: GameState): TierCtx {
  const bonuses = getBonuses(s);
  const year = yearOf(s.day);
  const lines = new Map<Id, RivalLineModel>();
  for (const line of rivalLines(s)) {
    const cur = lines.get(line.labId);
    if (!cur || line.overall > cur.overall) lines.set(line.labId, line);
  }
  return {
    year,
    frontier: frontierQuality(year),
    bonuses,
    chatOpen: 'chatMoment' in s.flags,
    weights: tierWeights(year),
    crown: {
      consumer: crownMultiplier(s, 'consumer', bonuses),
      developer: crownMultiplier(s, 'developer', bonuses),
      enterprise: crownMultiplier(s, 'enterprise', bonuses),
    },
    lines,
  };
}

/** One live offer in one buyer tier. A player product or a rival lab can appear in several tiers. */
interface Entrant {
  /** Who owns the offer: a player product id or a competitor id. Users are tracked per owner. */
  entity: string;
  id: string;
  name: string;
  /** Model behind the offer (a rival's budget line shows the line's own name). */
  model: string;
  color: string;
  isPlayer: boolean;
  quality: number;
  price: number;
  /** Attractiveness inside the tier this entrant was built for. */
  a: number;
  /** The owner's users now (product users, or the lab's users in the segment). */
  users: number;
  product: Product | null;
  comp: Competitor | null;
}

/** Live offers in one segment and tier. */
interface TierMarket {
  tier: BuyerTier;
  weight: number;
  entrants: Entrant[];
  total: number;
}

/**
 * Every live offer in a segment for one tier: active player products of the matching kind, then rival flagships.
 * In the budget tier a rival with a line sells that line instead of its flagship.
 */
function tierEntrants(s: GameState, ctx: TierCtx, seg: Segment, tier: BuyerTier, skipPlayer: boolean, replacingId?: string): Entrant[] {
  const kind = KIND_OF[seg];
  const st = s.market.segments[seg];
  const out: Entrant[] = [];
  if (!skipPlayer) {
    for (const p of s.products) {
      if (!p.active || p.kind !== kind || p.id === replacingId) continue;
      const m = modelById(s, p.modelId);
      if (!m) continue;
      // v15: a router shows part of the small model's gap; mastery makes a seasoned model more attractive.
      const small = routerModelOf(s, p);
      const quality = routedQuality(seg, segQuality(seg, m.scores, m.overall), small ? segQuality(seg, small.scores, small.overall) : null, small ? p.router!.share : 0);
      // A specialisation can fit a product kind better or worse (productFit), e.g. a Coder model for the API.
      const extra = playerExtra(s, seg, m.scores, p.satisfaction, ctx.bonuses, ctx.crown[seg]) * productFitFor(m, p.kind) * sycophancyAttraction(m, p.kind) * masteryAppeal(m);
      const a = tierAttractiveness(
        tier,
        { quality, price: p.price, refPrice: st.refPrice, brand: s.company.brand, hype: s.company.hype, extra, activeB: productActiveB(s, p, m), budgetAppeal: ctx.bonuses.budgetAppeal ?? 1 },
        ctx.year,
        ctx.frontier,
      );
      out.push({ entity: p.id, id: p.id, name: p.name, model: m.name, color: PLAYER_COLOR, isPlayer: true, quality, price: p.price, a, users: p.users, product: p, comp: null });
    }
  }
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    if (seg === 'consumer' && !ctx.chatOpen) continue;
    const info = labInfo(s, c.id);
    if (!info) continue;
    const flagshipPrice = c.prices[kind];
    // Multiplayer rival: a kind it does not offer has an infinite price, so it drops out of this segment.
    if (!Number.isFinite(flagshipPrice)) continue;
    let price = flagshipPrice;
    let quality = segQuality(seg, c.model.scores, c.model.overall);
    let activeB = rivalFlagshipActiveB(c);
    let model = c.model.name;
    let hype = s.market.aiHype;
    let extra = seg === 'enterprise' ? 0.7 + c.model.scores.safety / 200 : 1;
    if (info.human) {
      const rival = s.mp?.rival;
      if (!rival) continue;
      hype = rival.hype;
      if (s.day < (s.flags[MP_UNDERCUT_FLAG] ?? -1)) price *= MP_UNDERCUT_PRICE_MULT;
      extra = (0.7 + (0.3 * rival.reputation) / 100) * MP_RIVAL_SATISFACTION_TERM;
      if (seg === 'enterprise') extra *= 0.7 + c.model.scores.safety / 200;
    } else if (tier === 'budget') {
      const line = ctx.lines.get(c.id);
      if (line) {
        price = flagshipPrice * (TIER_TUNING.RIVAL_LINE_PRICE_MULT[line.weightClass as 'nano' | 'small' | 'medium'] ?? 1);
        quality = segQuality(seg, line.scores, line.overall);
        activeB = line.activeParamsB;
        model = line.name;
      }
    }
    const a = tierAttractiveness(tier, { quality, price, refPrice: st.refPrice, brand: c.brand, hype, extra, activeB }, ctx.year, ctx.frontier);
    out.push({ entity: c.id, id: c.id, name: info.name, model, color: info.color, isPlayer: false, quality, price, a, users: c.users[seg], product: null, comp: c });
  }
  return out;
}

/** All three buyer tiers of a segment, in BUYER_TIERS order. */
function tierMarkets(s: GameState, ctx: TierCtx, seg: Segment, skipPlayer: boolean, replacingId?: string): TierMarket[] {
  return BUYER_TIERS.map((tier) => {
    const entrants = tierEntrants(s, ctx, seg, tier, skipPlayer, replacingId);
    return { tier, weight: ctx.weights[tier], entrants, total: entrants.reduce((t, r) => t + r.a, 0) };
  });
}

/** Market shares for a segment among player + competitors (share of all adopters, summed over the tiers). */
export function segmentShares(s: GameState, segment: Segment): ShareRow[] {
  const ctx = tierContext(s);
  const rows = new Map<string, { e: Entrant; share: number }>();
  for (const m of tierMarkets(s, ctx, segment, false)) {
    for (const e of m.entrants) {
      const rec = rows.get(e.entity) ?? { e, share: 0 };
      rec.share += m.total > 0 ? (m.weight * e.a) / m.total : 0;
      // Quality and price are shown from the mainstream offer (the flagship, for a rival).
      if (m.tier === 'mainstream') rec.e = e;
      rows.set(e.entity, rec);
    }
  }
  return [...rows.values()].map(({ e, share }) => ({
    id: e.entity,
    name: e.name,
    color: e.color,
    isPlayer: e.isPlayer,
    users: e.users,
    share,
    quality: e.quality,
    price: e.price,
  }));
}

export interface TierPreview {
  weight: number;
  /** Your share of this tier's buyers (0..1). */
  share: number;
  users: number;
}

function emptyTierPreview(): Record<BuyerTier, TierPreview> {
  return {
    premium: { weight: 0, share: 0, users: 0 },
    mainstream: { weight: 0, share: 0, users: 0 },
    budget: { weight: 0, share: 0, users: 0 },
  };
}

/**
 * Cheap, pure steady-state estimate for a product at this model and price. It competes with the live offers of its kind,
 * except `replacingId`, the product being re-priced (pass it when previewing a change to a live product).
 */
export function previewDemand(
  s: GameState,
  kind: ProductKind,
  modelId: string,
  price: number,
  replacingId?: string,
): { users: number; revenuePerDay: number; mtokPerDay: number; tiers: Record<BuyerTier, TierPreview> } {
  const zero = { users: 0, revenuePerDay: 0, mtokPerDay: 0, tiers: emptyTierPreview() };
  const model = modelById(s, modelId);
  if (!model || !(price > 0)) return zero;
  const seg = SEGMENT_OF[kind];
  const st = s.market.segments[seg];
  const ctx = tierContext(s);
  const quality = segQuality(seg, model.scores, model.overall);
  const extra = playerExtra(s, seg, model.scores, 70, ctx.bonuses, ctx.crown[seg]) * productFitFor(model, kind) * sycophancyAttraction(model, kind);
  const activeB = model.activeParamsB ?? model.paramsB;
  const tiers = emptyTierPreview();
  let users = 0;
  for (const tier of BUYER_TIERS) {
    const mine = tierAttractiveness(
      tier,
      { quality, price, refPrice: st.refPrice, brand: s.company.brand, hype: s.company.hype, extra, activeB, budgetAppeal: ctx.bonuses.budgetAppeal ?? 1 },
      ctx.year,
      ctx.frontier,
    );
    const others = tierEntrants(s, ctx, seg, tier, false, replacingId).reduce((t, r) => t + r.a, 0);
    const share = mine + others > 0 ? mine / (mine + others) : 0;
    const tierUsers = st.tam * st.adoption * ctx.weights[tier] * share;
    tiers[tier] = { weight: ctx.weights[tier], share, users: tierUsers };
    users += tierUsers;
  }
  const mtokPerDay = users * mtokPerUserDay(seg, ctx.year);
  const revenuePerDay = kind === 'api' ? mtokPerDay * price : (users * price) / 30;
  return { users, revenuePerDay, mtokPerDay, tiers };
}

/** One tier's row for the market panel: the weight, your share of that tier's buyers, and the strongest rival there. */
export interface TierBreakdownRow {
  tier: BuyerTier;
  weight: number;
  playerShare: number;
  /** Your users in this tier: adopters x weight x your share. */
  playerUsers: number;
  top: { id: string; name: string; model: string; color: string; share: number } | null;
}

export function tierBreakdown(s: GameState, segment: Segment): TierBreakdownRow[] {
  const ctx = tierContext(s);
  const st = s.market.segments[segment];
  return tierMarkets(s, ctx, segment, false).map((m) => {
    let mine = 0;
    let top: Entrant | undefined;
    for (const e of m.entrants) {
      if (e.isPlayer) mine += e.a;
      else if (!top || e.a > top.a) top = e;
    }
    const playerShare = m.total > 0 ? mine / m.total : 0;
    return {
      tier: m.tier,
      weight: m.weight,
      playerShare,
      playerUsers: st.tam * st.adoption * m.weight * playerShare,
      top: top && m.total > 0 ? { id: top.entity, name: top.name, model: top.model, color: top.color, share: top.a / m.total } : null,
    };
  });
}

/** The live product of a kind with the most users. It represents the kind to other labs (the flagship offer in multiplayer). */
export function primaryProduct(s: GameState, kind: ProductKind): Product | null {
  let best: Product | null = null;
  for (const p of s.products) if (p.active && p.kind === kind && (!best || p.users > best.users)) best = p;
  return best;
}

/** Sets a product's users between market ticks (outage churn) and keeps its tier split in the same proportions. */
export function setProductUsers(p: Product, users: number): void {
  const before = p.users;
  p.users = users;
  if (p.tierUsers && before > 0) {
    for (const t of BUYER_TIERS) p.tierUsers[t] = (p.tierUsers[t] ?? 0) * (users / before);
  }
}

/** The lowest price among live products of a kind. Rivals react to the cheapest price you advertise. */
export function lowestLivePrice(s: GameState, kind: ProductKind): number | undefined {
  let low: number | undefined;
  for (const p of s.products) if (p.active && p.kind === kind && (low === undefined || p.price < low)) low = p.price;
  return low;
}

export function marketTick(s: GameState, rng: Rng): void {
  const year = yearOf(s.day);
  const bonuses = getBonuses(s);

  // 1. AI hype cycle: relax toward base curve + decaying nudges + slow noise.
  const nudge = (s.flags['hypeNudge'] ?? 0) * 0.97;
  const noise = (s.flags['hypeNoise'] ?? 0) * 0.97 + rng.normal(0, 0.6);
  s.flags['hypeNudge'] = nudge;
  s.flags['hypeNoise'] = noise;
  const hypeTarget = clamp(interp(HYPE_BASE, year) + nudge + noise, 0, 100);
  s.market.aiHype = clamp(s.market.aiHype + (hypeTarget - s.market.aiHype) * HYPE_RELAX_PER_DAY, 0, 100);

  // 2. Campaigns tick down and apply brand/hype; player brand and hype decay.
  let brandGain = 0;
  let hypeGain = 0;
  for (const c of s.market.campaigns) {
    const def = campaignDef(c.defId);
    if (def) {
      brandGain += def.brandPerDay * bonuses.brand;
      hypeGain += def.hypePerDay;
    }
    c.daysLeft -= 1;
  }
  for (let i = s.market.campaigns.length - 1; i >= 0; i--) {
    if (s.market.campaigns[i].daysLeft <= 0) s.market.campaigns.splice(i, 1);
  }
  const team = marketingTeamEffect(s);
  brandGain = brandGain * team.campaignMult + team.brandPerDay;
  hypeGain *= team.campaignMult;
  s.company.brand = clamp(s.company.brand * (1 - BRAND_DECAY_PER_DAY) + brandGain, 0, 100);
  s.company.hype = clamp(s.company.hype * (1 - HYPE_DECAY_PER_DAY) + hypeGain, 0, 100);
  if (s.day % 7 === 0) {
    const h = (s.market.history ??= []);
    h.push({ day: s.day, brand: s.company.brand, hype: s.company.hype });
    if (h.length > 600) h.splice(0, h.length - 600);
  }

  // 3. Segment TAM and reference prices by year.
  for (const seg of SEGMENTS) {
    const st = s.market.segments[seg];
    st.tam = tamFor(seg, year) * marketGrowthMult(s); // v9 scenario: difficulty market growth
    st.refPrice = refPriceFor(seg, year);
  }

  // 4. The first chat launch in the world (a rival's, if the player hasn't done it yet).
  if (!('chatMoment' in s.flags) && year >= CHAT_WORLD_YEAR) {
    const rival = s.competitors.find((c) => c.active && c.model !== null);
    if (rival) triggerChatMoment(s, labName(s, rival.id));
  }

  // 5. Adoption drifts toward a target set by market maturity, hype, world quality and campaigns.
  const qualityF = 0.5 + 0.5 * clamp(worldBestOverall(s, year) / 75, 0, 1);
  const hypeF = 0.4 + (0.6 * s.market.aiHype) / 100;
  const chatOpen = 'chatMoment' in s.flags;
  for (const seg of SEGMENTS) {
    const st = s.market.segments[seg];
    const targeted = s.market.campaigns.filter((c) => campaignDef(c.defId)?.segment === seg).length;
    const campaignF = 1 + Math.min(MAX_TARGETED_CAMPAIGN_BOOST, TARGETED_CAMPAIGN_BOOST * targeted);
    let target = interp(ADOPTION_CEILING[seg], year) * hypeF * qualityF * campaignF;
    if (seg === 'consumer' && !chatOpen) target = 0;
    st.adoption = clamp(st.adoption + (target - st.adoption) * ADOPTION_RELAX_PER_DAY, 0, 1);
  }

  // 6. Split adopters across buyer tiers and migrate each owner (player product or rival lab) toward its target.
  //    An owner's target is the sum of its tier targets. Its users are split between tiers in the same proportion.
  const ctx = tierContext(s);
  for (const seg of SEGMENTS) {
    const st = s.market.segments[seg];
    const adopters = st.tam * st.adoption;
    const owners = new Map<string, { entrant: Entrant; total: number; tiers: Partial<Record<BuyerTier, number>> }>();
    for (const m of tierMarkets(s, ctx, seg, false)) {
      for (const e of m.entrants) {
        const target = m.total > 0 ? (adopters * m.weight * e.a) / m.total : 0;
        let rec = owners.get(e.entity);
        if (!rec) {
          rec = { entrant: e, total: 0, tiers: {} };
          owners.set(e.entity, rec);
        }
        rec.total += target;
        rec.tiers[m.tier] = target;
      }
    }
    let playerUsers = 0;
    for (const { entrant, total, tiers } of owners.values()) {
      const users = entrant.users + (total - entrant.users) * BALANCE.USER_MIGRATION_PER_DAY;
      if (entrant.product) {
        entrant.product.users = users;
        entrant.product.tierUsers = {};
        for (const t of BUYER_TIERS) entrant.product.tierUsers[t] = total > 0 ? (users * (tiers[t] ?? 0)) / total : 0;
        playerUsers += users;
      }
      if (entrant.comp) entrant.comp.users[seg] = users;
    }
    st.playerUsers = playerUsers;
  }
}

function launchCampaign(s: GameState, campaignId: string): void {
  const def = campaignDef(campaignId);
  if (!def) {
    notify(s, 'Unknown campaign.', 'bad');
    return;
  }
  if (calendarYear(s.day) < def.minYear) {
    notify(s, `${def.name} is not available until ${def.minYear}.`, 'bad');
    return;
  }
  if (s.market.campaigns.some((c) => c.defId === def.id)) {
    notify(s, `${def.name} is already running.`, 'info');
    return;
  }
  if (s.market.campaigns.length >= MAX_ACTIVE_CAMPAIGNS) {
    notify(s, `Only ${MAX_ACTIVE_CAMPAIGNS} campaigns can run at once.`, 'bad');
    return;
  }
  if (!trySpend(s, 'marketing', def.cost, def.name)) return;
  s.market.campaigns.push({ defId: def.id, daysLeft: def.days });
  notify(s, `${def.name} is live for ${def.days} days.`, 'good');
}

export const handlers: ActionHandlers = {
  launchCampaign: (s, a) => {
    launchCampaign(s, a.campaignId);
  },
};
