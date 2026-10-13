// OWNER: MODEL LIFE (v15, GAME_DESIGN §25). What happens to a model after launch day:
//   patches   short post-release runs fed by user feedback (v1.1, v1.2 ...), diminishing, with a regression risk
//   mastery   field experience from serving users and contracts; levels make the model more attractive
//   retire    sunset or open-source an old model; a notable career earns a Hall of Fame slot and a lasting bonus
//   routers   a product sends the easy share of its queries to a smaller model (helpers used by market and serving)
import type { ActionHandlers, Capabilities, CapId, GameState, Model, PatchFocus, Product, Rng, Segment } from '../types';
import { CAP_IDS, SEGMENT_OF } from '../types';
import { getBonuses } from '../bonuses';
import { calendarYear, clamp, formatMoney, notify, pushNews, trySpend } from '../util';
import { clampCaps, evaluateModel, modelCaps, overallScore, scoresFromCaps } from './capabilities';
import { mtokPerPflopDay } from './compute';
import { grantXp } from './progression';

export const MODEL_LIFE_TUNING = {
  // ---- patches ----
  PATCH_DAYS: 14,
  PATCH_COST_BASE: 40_000,
  PATCH_COST_PER_YEAR: 0.2,
  /** Cost grows with the square root of active size above this many B. */
  PATCH_SIZE_REF_B: 20,
  /** Cap points the first patch adds to its focus; each later patch adds PATCH_DECAY of the last. */
  PATCH_GAIN: 2.4,
  PATCH_DECAY: 0.6,
  MAX_PATCHES: 6,
  /** Feedback factor = clamp(FLOOR + (1 − FLOOR) × log10(1 + users) / USERS_LOG_FULL, FLOOR, 1). */
  FEEDBACK_FLOOR: 0.35,
  USERS_LOG_FULL: 6,
  REGRESSION_CHANCE: 0.15,
  PATCH_XP: 20,
  // ---- mastery ----
  /** XP needed for levels 1..5. */
  MASTERY_XP: [0, 80, 250, 600, 1400],
  MASTERY_NAMES: ['Fresh', 'Battle-tested', 'Fan favourite', 'Institution', 'Legend'],
  /**
   * Daily XP per product serving the model: BASE + PER_DECADE × log10(1 + users / 1000). Router models earn their
   * share. A product with a million users makes about 1.6 XP a day, so Legend takes about two years of service.
   */
  MASTERY_PER_PRODUCT: 0.4,
  MASTERY_PER_DECADE: 0.4,
  MASTERY_PER_CONTRACT: 1,
  /** Attractiveness bonus per mastery level above 1. */
  MASTERY_APPEAL_PER_LEVEL: 0.025,
  // ---- retirement and the Hall of Fame ----
  RETIRE_HYPE: 2,
  OPEN_RETIRE_BRAND: 3,
  OPEN_RETIRE_REP: 3,
  OPEN_RETIRE_RIVAL_BOOST: 0.5,
  HALL_MIN_MASTERY: 3,
  RETIRE_XP: 40,
  HALL_XP_PER_HONOR: 25,
  // ---- routers ----
  ROUTER_SHARE_MIN: 0.2,
  ROUTER_SHARE_MAX: 0.8,
  /** The small model's active params may be at most this share of the main model's. */
  ROUTER_MAX_SIZE_RATIO: 0.5,
  /** Share of the quality gap buyers notice on routed queries (the router picks the easy ones). */
  ROUTER_GAP_VISIBLE: 0.35,
};
const T = MODEL_LIFE_TUNING;

const PATCH_FOCUS: Record<PatchFocus, Partial<Record<CapId, number>>> = {
  general: { knowledge: 0.45, reasoning: 0.45, math: 0.45, coding: 0.45, agentic: 0.45, chat: 0.45, safety: 0.45, multilingual: 0.45, longContext: 0.45 },
  chat: { chat: 1, multilingual: 0.4 },
  coding: { coding: 1, agentic: 0.5 },
  reasoning: { reasoning: 1, math: 0.6 },
  safety: { safety: 1.5 },
};
export const PATCH_FOCI: { id: PatchFocus; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'chat', label: 'Chat' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'safety', label: 'Safety' },
];

const CAP_LABEL: Record<CapId, string> = {
  knowledge: 'knowledge', reasoning: 'reasoning', math: 'math', coding: 'coding', agentic: 'agentic',
  chat: 'chat', vision: 'vision', safety: 'safety', multilingual: 'multilingual', longContext: 'long context',
};
const FORGOT = ['how to count the r in strawberry', 'French', 'its own name', 'long division', 'how to be brief', 'every Pokémon after gen 1'];

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function isLive(m: Model | undefined): m is Model {
  return !!m && m.releasedDay !== null && !m.deprecated;
}

/** The version label of a model: v1.0 before any patch, v1.N after N patches. */
export function versionLabel(m: Model): string {
  return `v1.${m.patches ?? 0}`;
}

/** Users across live products that serve this model (routed products count their share). */
export function usersServedBy(s: GameState, modelId: string): number {
  let u = 0;
  for (const p of s.products) {
    if (!p.active) continue;
    const share = p.router?.share ?? 0;
    if (p.modelId === modelId) u += p.users * (1 - share);
    if (p.router?.modelId === modelId) u += p.users * share;
  }
  return u;
}

function contractsOn(s: GameState, modelId: string): number {
  return (s.contracts?.active ?? []).filter((c) => c.modelId === modelId).length;
}

/** Re-derive scores, overall, Elo and benchmarks after the caps changed. */
function rescore(s: GameState, m: Model, caps: Capabilities): void {
  const before = m.overall;
  m.caps = clampCaps(caps);
  m.scores = scoresFromCaps(m.caps);
  m.overall = overallScore(m.scores);
  m.elo += (m.overall - before) * 8;
  evaluateModel(s, m);
}

// ---------------------------------------------------------------------------
// patches
// ---------------------------------------------------------------------------

export function patchCost(s: GameState, m: Model): number {
  const years = Math.max(0, calendarYear(s.day) - 2017);
  const size = Math.max(1, (m.activeParamsB ?? m.paramsB) / T.PATCH_SIZE_REF_B) ** 0.5;
  return Math.round(T.PATCH_COST_BASE * (1 + T.PATCH_COST_PER_YEAR * years) * size * (getBonuses(s).finetuneCost ?? 1));
}

/** How much user feedback the patch has to learn from, 0.35..1. */
export function feedbackFactor(s: GameState, m: Model): number {
  const users = usersServedBy(s, m.id) + contractsOn(s, m.id) * 10_000;
  return clamp(T.FEEDBACK_FLOOR + ((1 - T.FEEDBACK_FLOOR) * Math.log10(1 + users)) / T.USERS_LOG_FULL, T.FEEDBACK_FLOOR, 1);
}

/** Expected cap points the next patch adds to its focus. */
export function patchGain(s: GameState, m: Model): number {
  return T.PATCH_GAIN * T.PATCH_DECAY ** (m.patches ?? 0) * feedbackFactor(s, m);
}

/** Why the model cannot be patched now, or null. */
export function patchBlocker(s: GameState, m: Model): string | null {
  if (m.releasedDay === null) return 'Release it first: patches learn from users';
  if (m.deprecated) return 'Retired models are not patched';
  if (m.patchJob) return 'A patch is already in progress';
  if ((m.patches ?? 0) >= T.MAX_PATCHES) return 'Patched out: train a successor';
  if (s.finance.cash < patchCost(s, m)) return `Needs ${formatMoney(patchCost(s, m))}`;
  return null;
}

function finishPatch(s: GameState, m: Model, rng: Rng): void {
  const job = m.patchJob!;
  m.patchJob = undefined;
  const gain = patchGain(s, m) * rng.range(0.7, 1.3);
  const weights = PATCH_FOCUS[job.focus];
  const caps = { ...modelCaps(m, s) };
  for (const [k, w] of Object.entries(weights) as [CapId, number][]) if (!(k === 'vision' && caps.vision === 0)) caps[k] += gain * w;
  let regression = '';
  if (rng.chance(T.REGRESSION_CHANCE)) {
    const pool = CAP_IDS.filter((k) => !(k in weights) && caps[k] > 5);
    if (pool.length) {
      const k = rng.pick(pool);
      const loss = rng.range(1, 3);
      caps[k] -= loss;
      regression = ` It also forgot ${rng.pick(FORGOT)} (${CAP_LABEL[k]} −${loss.toFixed(1)}).`;
    }
  }
  const before = m.overall;
  rescore(s, m, caps);
  m.patches = (m.patches ?? 0) + 1;
  const delta = m.overall - before;
  notify(s, `${m.name} ${versionLabel(m)} shipped: ${job.focus} patch, overall ${before.toFixed(1)} → ${m.overall.toFixed(1)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}).${regression}`, regression ? 'info' : 'good');
  pushNews(s, `${s.company.name} pushes ${m.name} ${versionLabel(m)}. Changelog: "improvements". Users: "it feels different".`, 'info');
  if (s.products.some((p) => p.active && p.modelId === m.id)) s.company.hype = clamp(s.company.hype + 1, 0, 100);
  grantXp(s, T.PATCH_XP, 'Model patched');
}

// ---------------------------------------------------------------------------
// mastery
// ---------------------------------------------------------------------------

export function masteryOf(m: Model): { xp: number; level: number } {
  return m.mastery ?? { xp: 0, level: 1 };
}

export function masteryName(level: number): string {
  return T.MASTERY_NAMES[clamp(level, 1, 5) - 1];
}

/** Progress to the next mastery level, 0..1 (1 at the top level). */
export function masteryProgress(m: Model): { into: number; need: number; frac: number } {
  const { xp, level } = masteryOf(m);
  if (level >= T.MASTERY_XP.length) return { into: 0, need: 0, frac: 1 };
  const lo = T.MASTERY_XP[level - 1];
  const hi = T.MASTERY_XP[level];
  return { into: xp - lo, need: hi - lo, frac: clamp((xp - lo) / (hi - lo), 0, 1) };
}

/** Attractiveness multiplier from mastery. */
export function masteryAppeal(m: Model): number {
  return 1 + T.MASTERY_APPEAL_PER_LEVEL * (masteryOf(m).level - 1);
}

/** Add field XP to a model and level it up (exported for the Arena Cup). */
export function addMasteryXp(s: GameState, m: Model, xp: number): void {
  const st = (m.mastery ??= { xp: 0, level: 1 });
  st.xp += xp;
  while (st.level < T.MASTERY_XP.length && st.xp >= T.MASTERY_XP[st.level]) {
    st.level += 1;
    notify(s, `${m.name} reached mastery ${st.level}: ${masteryName(st.level)}. Buyers like it ${Math.round((masteryAppeal(m) - 1) * 100)}% more.`, 'good');
    if (st.level >= 4) pushNews(s, `${m.name} is now "${masteryName(st.level)}" status. Someone made a fan wiki.`, 'good');
    grantXp(s, 15 * st.level, 'Model mastery');
  }
}

// ---------------------------------------------------------------------------
// retirement and the Hall of Fame
// ---------------------------------------------------------------------------

/** What the model would be remembered for. Empty = no Hall of Fame slot. */
export function honorsOf(s: GameState, m: Model): string[] {
  const out: string[] = [];
  const level = masteryOf(m).level;
  if (level >= T.HALL_MIN_MASTERY) out.push(`Mastery ${level}`);
  if ((m.cupWins ?? 0) > 0) out.push(m.cupWins === 1 ? 'Arena Cup winner' : `${m.cupWins}x Arena Cup winner`);
  if ((s.classes?.crowns ?? []).some((c) => c.holder === 'player' && c.modelName === m.name)) out.push('Crown holder');
  if ((m.patches ?? 0) >= 4) out.push('Long-serving');
  return out;
}

/** Why the model cannot retire now, or null. */
export function retireBlocker(s: GameState, m: Model): string | null {
  if (m.releasedDay === null) return 'Only released models retire';
  if (m.retiredDay !== undefined) return 'Already retired';
  if (s.products.some((p) => p.active && p.modelId === m.id)) return 'A product still runs it: move the product first';
  if (contractsOn(s, m.id) > 0) return 'A contract still runs on it';
  return null;
}

export { countedHall, hallBonuses } from './hallOfFame';

// ---------------------------------------------------------------------------
// routers
// ---------------------------------------------------------------------------

/** The live small model a product routes to, or undefined. */
export function routerModelOf(s: GameState, p: Product): Model | undefined {
  if (!p.router) return undefined;
  const m = s.models.find((x) => x.id === p.router!.modelId);
  return isLive(m) ? m : undefined;
}

/** Why `small` cannot be the router model for a product running `main`, or null. */
export function routerBlocker(main: Model | undefined, small: Model | undefined): string | null {
  if (!main) return 'The product has no live model';
  if (!isLive(small)) return 'Pick a released model';
  if (small.id === main.id) return 'Pick a different, smaller model';
  const ratio = (small.activeParamsB ?? small.paramsB) / Math.max(1e-9, main.activeParamsB ?? main.paramsB);
  if (ratio > T.ROUTER_MAX_SIZE_RATIO) return `Must be at most half the size of ${main.name}`;
  return null;
}

/** Quality buyers see from a routed product: the main model's, minus the visible part of the gap on routed queries. */
export function routedQuality(seg: Segment, mainQ: number, smallQ: number | null, share: number): number {
  if (smallQ === null) return mainQ;
  return mainQ - share * Math.max(0, mainQ - smallQ) * T.ROUTER_GAP_VISIBLE;
}

/** PFLOP/s a product needs for its demand, with the router splitting the load. */
export function productPflopsNeed(s: GameState, p: Product, main: Model | undefined): number {
  if (!main || !(p.mtokPerDay > 0)) return 0;
  const small = routerModelOf(s, p);
  const share = small ? p.router!.share : 0;
  const perMain = mtokPerPflopDay(s, main);
  const perSmall = small ? mtokPerPflopDay(s, small) : 0;
  let need = perMain > 0 ? (p.mtokPerDay * (1 - share)) / perMain : 0;
  if (small && perSmall > 0) need += (p.mtokPerDay * share) / perSmall;
  return need;
}

/** Active params buyers feel (budget-tier speed): a router makes the product feel smaller. */
export function productActiveB(s: GameState, p: Product, main: Model): number {
  const mainB = main.activeParamsB ?? main.paramsB;
  const small = routerModelOf(s, p);
  if (!small) return mainB;
  const share = p.router!.share;
  return mainB * (1 - share) + (small.activeParamsB ?? small.paramsB) * share;
}

// ---------------------------------------------------------------------------
// tick and actions
// ---------------------------------------------------------------------------

export function modelLifeTick(s: GameState, rng: Rng): void {
  for (const m of s.models) if (m.patchJob && s.day >= m.patchJob.doneDay) finishPatch(s, m, rng);
  // Mastery: every live model earns field XP from the users and contracts it serves.
  for (const m of s.models) {
    if (!isLive(m)) continue;
    let xp = 0;
    for (const p of s.products) {
      if (!p.active) continue;
      const share = p.router?.share ?? 0;
      const w = p.modelId === m.id ? 1 - share : p.router?.modelId === m.id ? share : 0;
      if (w > 0) xp += w * (T.MASTERY_PER_PRODUCT + T.MASTERY_PER_DECADE * Math.log10(1 + Math.max(0, p.users) / 1000));
    }
    xp += contractsOn(s, m.id) * T.MASTERY_PER_CONTRACT;
    if (xp > 0) addMasteryXp(s, m, xp);
  }
  // A router whose small model went away is dropped.
  for (const p of s.products) if (p.router && !routerModelOf(s, p)) p.router = undefined;
}

export const handlers: ActionHandlers = {
  patchModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) return;
    if (!PATCH_FOCUS[a.focus]) return;
    const why = patchBlocker(s, m);
    if (why) {
      notify(s, `${m.name}: ${why.toLowerCase()}.`, 'bad');
      return;
    }
    const cost = patchCost(s, m);
    if (!trySpend(s, 'research', cost, `a patch for ${m.name}`)) return;
    m.patchJob = { doneDay: s.day + T.PATCH_DAYS, focus: a.focus, cost };
    notify(s, `${m.name}: ${a.focus} patch started from user feedback. Ships in ${T.PATCH_DAYS} days.`, 'info');
  },

  retireModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) return;
    const why = retireBlocker(s, m);
    if (why) {
      notify(s, `${m.name}: ${why.toLowerCase()}.`, 'bad');
      return;
    }
    const open = !!a.openWeights;
    const honors = honorsOf(s, m);
    const level = masteryOf(m).level;
    m.deprecated = true;
    m.retiredDay = s.day;
    m.internal = false;
    s.company.hype = clamp(s.company.hype + T.RETIRE_HYPE + level, 0, 100);
    if (open) {
      s.company.brand = clamp(s.company.brand + T.OPEN_RETIRE_BRAND * getBonuses(s).brand, 0, 100);
      s.company.reputation = clamp(s.company.reputation + T.OPEN_RETIRE_REP, 0, 100);
      s.flags['openBoost'] = (s.flags['openBoost'] ?? 0) + T.OPEN_RETIRE_RIVAL_BOOST;
    }
    let xp = T.RETIRE_XP;
    if (honors.length > 0) {
      (s.hallOfFame ??= []).push({ modelId: m.id, name: m.name, retiredDay: s.day, mastery: level, overall: m.overall, honors, open });
      xp += T.HALL_XP_PER_HONOR * honors.length;
      notify(s, `${m.name} enters the Hall of Fame (${honors.join(', ')}). Its legacy keeps paying: a little more brand and valuation.`, 'milestone');
      pushNews(s, `${s.company.name} retires ${m.name}${open ? ' and releases its weights' : ''}. Fans hold a candlelight vigil in a Discord channel.`, 'good');
    } else {
      notify(s, `${m.name} is retired${open ? ' and its weights are public' : ''}. Thanks for your service.`, 'info');
      pushNews(s, `${s.company.name} sunsets ${m.name}${open ? ', open-sourcing the weights on the way out' : ''}.`, 'info');
    }
    grantXp(s, xp, 'Model retired');
  },

  setProductRouter: (s, a) => {
    const p = s.products.find((x) => x.id === a.productId && x.active);
    if (!p) return;
    if (a.modelId === null) {
      if (p.router) notify(s, `${p.name} no longer routes queries.`, 'info');
      p.router = undefined;
      return;
    }
    const main = s.models.find((x) => x.id === p.modelId);
    const small = s.models.find((x) => x.id === a.modelId);
    const why = routerBlocker(isLive(main) ? main : undefined, small);
    if (why) {
      notify(s, `Router: ${why.toLowerCase()}.`, 'bad');
      return;
    }
    const share = clamp(a.share ?? p.router?.share ?? 0.5, T.ROUTER_SHARE_MIN, T.ROUTER_SHARE_MAX);
    const was = p.router?.modelId;
    p.router = { modelId: small!.id, share };
    if (was !== small!.id) notify(s, `${p.name} now routes ${Math.round(share * 100)}% of queries to ${small!.name}.`, 'good');
  },
};

/** Segment of a product (re-exported for the market). */
export function segOf(p: Product): Segment {
  return SEGMENT_OF[p.kind];
}
