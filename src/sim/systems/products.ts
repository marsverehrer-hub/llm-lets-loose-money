// OWNER: Agent B. Player products: users, usage, serving, incident outages, revenue.
// v10 (GAME_DESIGN §21.1): products never go down for lack of GPUs. Own GPUs serve first and the cloud bursts the rest
// (serving.ts books that). servedFraction is 1 unless an incident sets flags['incidentServed.<productId>'].
import type { ActionHandlers, GameState, Model, Product, ProductKind, Rng } from '../types';
import { SEGMENT_OF } from '../types';
import { RESEARCH } from '../data/research';
import { getBonuses } from '../bonuses';
import { addRevenue, clamp, newId, notify, pushNews, trySpend, yearOf } from '../util';
import { RUN_TUNING } from '../data/trainingOptions';
import { isResearched } from './research';
import { frontierQuality, modelById, mtokPerUserDay, refPriceFor, segQuality, setProductUsers, triggerChatMoment } from './market';
import { openUserMult, previewDemandCap } from './release';

/** One-off launch fee per product kind. */
export const LAUNCH_FEE: Record<ProductKind, number> = { api: 20_000, chat: 200_000, enterprise: 1_000_000 };
/** v8 product lines (GAME_DESIGN §19.3): up to this many live products per kind, e.g. Pro and Lite. */
export const MAX_LINES_PER_KIND = 2;
/** v8: the second line of a kind costs this share of the launch fee. */
export const SECOND_LINE_FEE_MULT = 0.5;

/** Live products of a kind (up to MAX_LINES_PER_KIND). */
export function liveLines(s: GameState, kind: ProductKind): Product[] {
  return s.products.filter((p) => p.active && p.kind === kind);
}

/** The fee to launch the next product of this kind: full for the first line, half for the second. */
export function launchFee(s: GameState, kind: ProductKind): number {
  return liveLines(s, kind).length >= 1 ? LAUNCH_FEE[kind] * SECOND_LINE_FEE_MULT : LAUNCH_FEE[kind];
}
const KIND_LABEL: Record<ProductKind, string> = { api: 'API', chat: 'Chat', enterprise: 'Enterprise' };
const OUTAGE_THRESHOLD = 0.98;
const OUTAGE_NEWS_GAP_DAYS = 10;
const CHURN_PER_DAY_AT_TOTAL_OUTAGE = 0.06;
const SATISFACTION_RELAX = 0.05;

/** Served fraction an incident has set for this product (1 when none). Events write flags['incidentServed.<id>']. */
export function incidentServedFraction(s: GameState, p: Product): number {
  const v = s.flags[`incidentServed.${p.id}`];
  return v === undefined ? 1 : clamp(v, 0, 1);
}

/** Which product kinds the player has unlocked (research unlocksProduct; api is always available). */
export function unlockedProductKinds(s: GameState): ProductKind[] {
  const kinds: ProductKind[] = ['api'];
  if (isResearched(s, 'instruction_tuning') || RESEARCH.some((r) => r.unlocksProduct === 'chat' && isResearched(s, r.id))) kinds.push('chat');
  if (isResearched(s, 'enterprise_ready') || RESEARCH.some((r) => r.unlocksProduct === 'enterprise' && isResearched(s, r.id))) kinds.push('enterprise');
  return kinds;
}
/** Default price for a new product of this kind in the current market. */
export function defaultPrice(s: GameState, kind: ProductKind): number {
  const seg = SEGMENT_OF[kind];
  const ref = s.market.segments[seg]?.refPrice ?? refPriceFor(seg, yearOf(s.day));
  return Math.round(ref * 100) / 100;
}

function liveModel(s: GameState, id: string): Model | undefined {
  const m = modelById(s, id);
  return m && m.releasedDay !== null && !m.deprecated ? m : undefined;
}

export function productsTick(s: GameState, _rng: Rng): void {
  const year = yearOf(s.day);
  const frontier = frontierQuality(year);
  const live = s.products.filter((p) => p.active);

  // Demand per product (Mtok/day). Users a model can serve are cut by the preview cap (GAME_DESIGN §17.7) and by the
  // open-weights penalty (self-hosting takes a quarter, for good). The serving tick turns demand into GPUs and burst.
  const rows = live.map((p) => {
    const model = liveModel(s, p.modelId ?? '');
    const users = model ? p.users * previewDemandCap(model) * openUserMult(model) : 0;
    const demand = model ? users * mtokPerUserDay(SEGMENT_OF[p.kind], year) : 0;
    return { p, model, users, demand };
  });

  let outageToday = false;
  for (const { p, model, users, demand } of rows) {
    const seg = SEGMENT_OF[p.kind];
    // Only an incident takes a product down. Capacity never does (the cloud bursts the rest).
    const servedFraction = !model ? 0 : demand > 0 ? incidentServedFraction(s, p) : 1;
    p.servedFraction = servedFraction;
    p.mtokPerDay = demand;

    // Revenue: api bills served tokens; chat and enterprise bill seats.
    let revenue = 0;
    if (model) {
      revenue = p.kind === 'api' ? demand * servedFraction * p.price : (users * p.price) / 30;
      if (revenue > 0) addRevenue(s, p.kind, revenue);
    }
    p.revenuePerDay = revenue;

    if (!model) continue;
    // Sycophantic chat models slowly eat reputation (GAME_DESIGN 13.2).
    const sycophancy = p.kind === 'chat' ? model.persona?.sycophancy ?? 0 : 0;
    if (sycophancy > 0) s.company.reputation = clamp(s.company.reputation - RUN_TUNING.PERSONA_SYCOPHANCY_REP_PER_DAY * sycophancy, 0, 100);
    const unserved = demand > 0 && servedFraction < OUTAGE_THRESHOLD;
    if (unserved) {
      outageToday = true;
      const down = 1 - servedFraction;
      p.satisfaction = clamp(p.satisfaction - 2 - 10 * down, 0, 100);
      setProductUsers(p, Math.max(0, p.users * (1 - CHURN_PER_DAY_AT_TOTAL_OUTAGE * down)));
      s.company.reputation = clamp(s.company.reputation - 0.2 * down, 0, 100);
      const newsKey = `outageNews.${p.id}`;
      const last = s.flags[newsKey] ?? -Infinity;
      if (servedFraction < 0.9 && s.day - last >= OUTAGE_NEWS_GAP_DAYS) {
        pushNews(s, `${p.name} is down again. The status page is also down, which feels personal.`, 'bad');
        s.flags[newsKey] = s.day;
      }
    } else {
      const quality = segQuality(seg, model.scores, model.overall);
      const target = clamp(70 + (quality - frontier) / 2, 0, 100);
      p.satisfaction = clamp(p.satisfaction + (target - p.satisfaction) * SATISFACTION_RELAX, 0, 100);
    }
  }
  if (outageToday) s.stats.outageDays += 1;

  for (const seg of ['consumer', 'developer', 'enterprise'] as const) {
    s.market.segments[seg].playerUsers = s.products
      .filter((p) => p.active && SEGMENT_OF[p.kind] === seg)
      .reduce((t, p) => t + p.users, 0);
  }
}

export const handlers: ActionHandlers = {
  launchProduct: (s, a) => {
    const kind = a.kind;
    if (!unlockedProductKinds(s).includes(kind)) {
      notify(s, `${KIND_LABEL[kind]} is not unlocked yet. Research it first.`, 'bad');
      return;
    }
    const lines = liveLines(s, kind).length;
    if (lines >= MAX_LINES_PER_KIND) {
      notify(s, `You already run ${lines} live ${KIND_LABEL[kind]} products. Shut one down first.`, 'bad');
      return;
    }
    const model = liveModel(s, a.modelId);
    if (!model) {
      notify(s, 'Pick a released model. Unreleased models are a secret.', 'bad');
      return;
    }
    if (!(a.price > 0) || !isFinite(a.price)) {
      notify(s, 'Price must be a positive number.', 'bad');
      return;
    }
    const name = a.name.trim().slice(0, 40) || `${s.company.name} ${KIND_LABEL[kind]}`;
    const second = lines === 1;
    if (!trySpend(s, 'other', launchFee(s, kind), `the ${KIND_LABEL[kind]} ${second ? 'second line' : 'launch'}`)) return;

    const product: Product = {
      id: newId(s, 'prod'),
      kind,
      name,
      modelId: model.id,
      price: a.price,
      users: 0,
      launchedDay: s.day,
      satisfaction: 70,
      servedFraction: 1,
      mtokPerDay: 0,
      revenuePerDay: 0,
      active: true,
    };
    s.products.push(product);
    const bonuses = getBonuses(s);
    s.company.hype = clamp(s.company.hype + 12, 0, 100);
    s.company.brand = clamp(s.company.brand + 1.5 * bonuses.brand, 0, 100);
    if (kind === 'chat') triggerChatMoment(s, s.company.name);
    notify(s, second ? `${name} is live as your second ${KIND_LABEL[kind]} line. Now you compete with yourself.` : `${name} is live. Try not to break it.`, 'good');
    pushNews(s, `${s.company.name} launches ${name}, a ${KIND_LABEL[kind]} product built on ${model.name}.`, 'milestone');
  },

  updateProduct: (s, a) => {
    const p = s.products.find((x) => x.id === a.productId && x.active);
    if (!p) {
      notify(s, 'That product is not live.', 'bad');
      return;
    }
    if (a.price !== undefined && !(a.price > 0 && isFinite(a.price))) {
      notify(s, 'Price must be a positive number.', 'bad');
      return;
    }
    let model: Model | undefined;
    if (a.modelId !== undefined && a.modelId !== p.modelId) {
      model = liveModel(s, a.modelId);
      if (!model) {
        notify(s, 'Only released, non-deprecated models can power a product.', 'bad');
        return;
      }
    }
    if (model) {
      const old = modelById(s, p.modelId ?? '');
      const newer = !old || model.trainedDay > old.trainedDay;
      p.modelId = model.id;
      if (newer) s.company.hype = clamp(s.company.hype + 4, 0, 100);
      notify(s, `${p.name} now runs ${model.name}.`, 'good');
    }
    if (a.price !== undefined) p.price = a.price;
  },

  shutdownProduct: (s, a) => {
    const p = s.products.find((x) => x.id === a.productId && x.active);
    if (!p) return;
    p.active = false;
    p.users = 0;
    p.mtokPerDay = 0;
    p.revenuePerDay = 0;
    notify(s, `${p.name} has been shut down. Its users are very sad.`, 'info');
    pushNews(s, `${s.company.name} pulls the plug on ${p.name}.`, 'bad');
  },
};
