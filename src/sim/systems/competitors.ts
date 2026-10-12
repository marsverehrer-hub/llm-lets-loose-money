// OWNER: COMP agent (GAME_DESIGN.md §18.1). Rival labs: releases, pricing, poaching, rivalry, trash talk, standings.
import type { Capabilities, Competitor, CompetitorDef, GameState, NoticeKind, Personality, ProductKind, Rng, Scores, Segment } from '../types';
import { CAP_IDS, KIND_OF, SEGMENT_OF } from '../types';
import { COMPETITORS } from '../data/competitors';
import { CEO_QUOTES, COUNTER_HEADLINES, REACTION_HEADLINES, RIVALRY_TIER_COUNT, fillTemplate } from '../data/rivalry';
import { calendarYear, clamp, notify, pushNews, yearOf } from '../util';

import { PLAYER_COLOR, SEGMENTS, bestPlayerModel, frontierQuality, lowestLivePrice, mtokPerUserDay, nudgeAiHype, segmentShares, type ShareRow } from './market';
import { benchmarkById, benchmarkTable, competitorCaps, overallScore, scoresFromCaps, softCeilingInverse } from './capabilities';
import { rivalExclusiveMalus } from './data';
import { applyHostLabs } from './multiplayer';
import { labInfo } from './labs';
import { rivalQualityOffset } from './scenario'; // v9 scenario

// frontierQuality lives in market.ts (to avoid an import cycle); re-exported here for callers.
export { frontierQuality };

export interface ArenaRow { id: string; name: string; modelName: string; elo: number; overall: number; color: string; isPlayer: boolean }

/** Every tunable for rival behaviour. Change numbers here, not in the logic below. */
export const COMP_TUNING = {
  /** Catch-up: from START the labs close CATCHUP_SHARE of the gap between the player's best and the frontier, full by FULL. */
  CATCHUP_START_YEAR: 2018,
  CATCHUP_FULL_YEAR: 2020,
  CATCHUP_SHARE: 0.9,
  CATCHUP_MARGIN: 0,
  /** Counter-punch: when the player takes Arena #1, labs within this many Elo of the top pull their release forward. */
  COUNTER_ELO_WINDOW: 10,
  COUNTER_MAX_LABS: 2,
  /** At most one counter-punch per this many days, so Arena #1 changing hands every week does not keep rescheduling labs. */
  COUNTER_COOLDOWN_DAYS: 30,
  COUNTER_DAYS_MIN: 25,
  COUNTER_DAYS_MAX: 60,
  /** The counter floor is player overall + N(COUNTER_MEAN, COUNTER_SD). */
  COUNTER_MEAN: 1.5,
  COUNTER_SD: 2,
  /** Home-segment brand gain per day, where the player holds the top share. */
  HOME_BRAND_PER_DAY: 0.02,
  /** Price labs follow the player's price down, but never below this share of their own base, when the player leads a segment. */
  PRICE_FOLLOW_FLOOR: 0.8,
  PRICE_FOLLOW_RATE: 0.05,
  /** Old-style price war: a price lab matches a deep undercut (player price below this share of base) directly. */
  PRICE_WAR_TRIGGER: 0.7,
  PRICE_WAR_RATE: 0.1,
  PRICE_RETURN_RATE: 0.03,
  /** Poaching: a monthly roll per active lab. Blocked when morale is above the cutoff or researchers are paid at or above the level. */
  POACH_EVERY_DAYS: 30,
  POACH_CHANCE: 0.12,
  POACH_MORALE_CUTOFF: 80,
  POACH_SALARY_CUTOFF: 1.2,
  POACH_MAX_RESEARCHERS: 3,
  POACH_STAR_SHARE: 0.25,
  /** Morale below the cutoff scales the roll up to 1 at morale 20 (the scale spans 60 points). */
  POACH_MORALE_SPAN: 60,
  /** Rivalry (0..100 per lab). Decays daily. Above RIVALRY_HIGH a lab releases faster and poaches harder. */
  RIVALRY_DECAY_PER_DAY: 0.1,
  RIVALRY_HIGH: 60,
  RIVALRY_CYCLE_MULT: 0.8,
  RIVALRY_POACH_MULT: 2,
  /** Tier boundaries for CEO quotes: tier = how many of these the rivalry has reached (0..3). Tier 3 starts at RIVALRY_HIGH. */
  RIVALRY_TIERS: [20, 40, 60] as readonly number[],
  RIVALRY_BEAT_FLAGSHIP: 10,
  RIVALRY_CROWN: 5,
  RIVALRY_ARENA_PASS: 6,
  RIVALRY_SEGMENT_LEAD: 5,
  RIVALRY_UNDERCUT: 4,
  RIVALRY_POACHED: 5,
  /** A lab's crown headline is not repeated within this many days (the rivalry gain still applies on every flip). */
  CROWN_NEWS_COOLDOWN_DAYS: 30,
  /** The player undercuts a lab's price in a kind when their price is below this share of the lab's. */
  UNDERCUT_RATIO: 0.9,
  /** A quote is not repeated for the same lab within this many days. */
  QUOTE_COOLDOWN_DAYS: 20,
  /** Per-day chance of an unprompted quote from a lab at tier 2 or higher (about one per 60 days). */
  QUOTE_CHANCE_PER_DAY: 1 / 60,
  /** Exclusive-data and open-weights boosts: each point adds +1 to every rival release, decaying by (1 - 1/this) per day. */
  BOOST_DECAY_DAYS: 180,
  /** Weekly standings check, in days. */
  STANDINGS_EVERY_DAYS: 7,
};

/** Highest overall a rival release may aim for (soft-ceiling units, GAME_DESIGN §18.2 v1.0 tuning). Stays below OVERALL_MAX. */
const BASE_MAX_OVERALL = 99.5;

/** Labs whose first release shocks the market (aiHype dip). */
const SHOCK_LABS = new Set(['deepseekers']);
const KINDS: ProductKind[] = ['chat', 'api', 'enterprise'];

/** Home segment by personality (GAME_DESIGN.md §18.1). Chaos labs pick one at random, once, and keep it. */
const HOME_SEGMENT: Record<Exclude<Personality, 'chaos'>, Segment> = {
  hype: 'consumer',
  safety: 'enterprise',
  open: 'developer',
  price: 'developer',
  research: 'enterprise',
};
const LAB_IDS: string[] = COMPETITORS.map((d) => d.id);

/** Bookkeeping keys in s.flags (rivalry edges, crowns, tiers, cooldowns, standings, counter floors). */
const flagKey = {
  beat: (id: string) => `beat.${id}`,
  crown: (bench: string) => `crown.${bench}`,
  passed: (id: string) => `passed.${id}`,
  lead: (id: string, seg: Segment) => `lead.${id}.${seg}`,
  under: (id: string, kind: ProductKind) => `under.${id}.${kind}`,
  tier: (id: string) => `tier.${id}`,
  quoted: (id: string) => `quoted.${id}`,
  home: (id: string) => `home.${id}`,
  standing: (id: string) => `standing.${id}`,
  counter: (id: string) => `counter.${id}`,
  crownNews: (id: string) => `crownNews.${id}`,
};
const ARENA_TOP_FLAG = 'arenaTop';
const LAST_COUNTER_FLAG = 'counter.lastDay';
const STANDING_PLAYER_FLAG = 'standing.player';

/** Score offsets [reasoning, coding, chat, safety] per personality, before centring on the overall. */
const PERSONALITY_OFFSETS: Record<Exclude<Personality, 'chaos'>, [number, number, number, number]> = {
  hype: [1, -1, 4, -3],
  research: [5, 4, -1, -4],
  safety: [-1, -2, 0, 12],
  open: [0, 3, 2, -8],
  price: [-1, 2, 1, -4],
};
/** Share of a lab's priceMult that chat keeps; the rest is pinned to the flat chat reference price. */
const CHAT_PRICE_COMPRESSION = 0.5;

// ---- Release news copy -----------------------------------------------------------------
// Placeholders: {lab}, {model}, {overall}, and {gap} (points ahead of / behind the player's best; only used when they have one).
type ReleaseTone = 'beats' | 'holds';
const RELEASE_COPY_BY_PERSONALITY: Record<Personality, Record<ReleaseTone, string[]>> = {
  hype: {
    beats: ['{lab} releases {model} (overall {overall}). Their keynote used the word "revolutionary" 30 times. The arena is not amused.'],
    holds: ['{lab} releases {model} (overall {overall}), announced from a hot air balloon. Your arena position survives, for now.'],
  },
  safety: {
    beats: ['{lab} releases {model} (overall {overall}). The model card is 200 pages and mostly about the model\'s feelings. The arena is not amused.'],
    holds: ['{lab} releases {model} (overall {overall}) and calls it "probably fine" in a 40-page report. Your arena position survives, for now.'],
  },
  open: {
    beats: ['{lab} releases {model} (overall {overall}) and gives it away for free. The arena is not amused, and neither is your pricing page.'],
    holds: ['{lab} releases {model} (overall {overall}) with weights anyone can download. Your arena position survives, for now.'],
  },
  price: {
    beats: ['{lab} releases {model} (overall {overall}) at a price that is technically a rounding error. The arena is not amused.'],
    holds: ['{lab} releases {model} (overall {overall}), cheap and only slightly on fire. Your arena position survives, for now.'],
  },
  research: {
    beats: ['{lab} releases {model} (overall {overall}) alongside a 90-page paper that nobody will finish. The arena is not amused.'],
    holds: ['{lab} releases {model} (overall {overall}) and publishes the benchmarks before anyone asks. Your arena position survives, for now.'],
  },
  chaos: {
    beats: ['{lab} releases {model} (overall {overall}) on a Tuesday at 3am with no changelog. The arena is not amused.'],
    holds: ['{lab} releases {model} (overall {overall}). It is weird, but not yet a threat. Your arena position survives, for now.'],
  },
};
/** Used for any lab, mixed into the personality pool. */
const RELEASE_COPY_GENERIC: Record<ReleaseTone, string[]> = {
  beats: [
    '{lab} releases {model} (overall {overall}), {gap} points ahead of your best. The arena is not amused.',
    '{lab} releases {model} (overall {overall}). Your best model is second now, in a sentence nobody wanted to read.',
    '{lab} releases {model} (overall {overall}) and the leaderboard has been reshuffled around your name. The arena is not amused.',
  ],
  holds: [
    '{lab} releases {model} (overall {overall}), still {gap} points behind your best. Your arena position survives, for now.',
    '{lab} releases {model} (overall {overall}). The arena shrugs, which is better than the alternative.',
  ],
};
/** DeepSeekers' first release: the price shock. Always used for that one launch. */
const SHOCK_RELEASE_COPY: string[] = [
  '{lab} ships {model} (overall {overall}), nearly as good as the frontier, at about the price of a sandwich. Markets wobble.',
  '{lab} drops {model} (overall {overall}) on a holiday weekend and says it was trained on "a few spare chips." Your board is having feelings.',
  '{lab} releases {model} (overall {overall}). Its API costs less than your electricity. Nvidiot\'s stock dips before lunch.',
];

function fillRelease(text: string, vars: { lab: string; model: string; overall: number; gap?: number }): string {
  return text
    .replace(/\{lab\}/g, vars.lab)
    .replace(/\{model\}/g, vars.model)
    .replace(/\{overall\}/g, vars.overall.toFixed(0))
    .replace(/\{gap\}/g, vars.gap === undefined ? 'a few' : String(Math.max(1, Math.round(vars.gap))));
}

/** Pick release news copy: personality lines plus generic lines for the tone, gap lines only when the player has a model. */
function releaseCopy(def: CompetitorDef, rng: Rng, beats: boolean, hasBest: boolean): string {
  const tone: ReleaseTone = beats ? 'beats' : 'holds';
  const pool = [...RELEASE_COPY_BY_PERSONALITY[def.personality][tone], ...RELEASE_COPY_GENERIC[tone]];
  const usable = hasBest ? pool : pool.filter((t) => !t.includes('{gap}'));
  return rng.pick(usable);
}

/** LLM Arena leaderboard: best released model per lab incl. player, sorted by elo desc. */
export function arenaLeaderboard(s: GameState): ArenaRow[] {
  const rows: ArenaRow[] = [];
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    // labInfo covers the multiplayer rival (tagged human) as well as the AI labs.
    const info = labInfo(s, c.id);
    if (!info) continue;
    rows.push({ id: c.id, name: info.name, modelName: c.model.name, elo: c.model.elo, overall: c.model.overall, color: info.color, isPlayer: false });
  }
  const best = bestPlayerModel(s);
  if (best) {
    rows.push({ id: 'player', name: s.company.name, modelName: best.name, elo: best.elo, overall: best.overall, color: PLAYER_COLOR, isPlayer: true });
  }
  return rows.sort((a, b) => b.elo - a.elo);
}

function weighted(v: [number, number, number, number]): number {
  return 0.3 * v[0] + 0.25 * v[1] + 0.3 * v[2] + 0.15 * v[3];
}

function personalityOffsets(p: Personality, rng: Rng): [number, number, number, number] {
  if (p === 'chaos') return [rng.normal(0, 8), rng.normal(0, 8), rng.normal(0, 8), rng.normal(0, 8)];
  return PERSONALITY_OFFSETS[p];
}

/**
 * Price labs (personality 'price') follow the player's price down: where the player has the top share in a segment,
 * they track it to no lower than PRICE_FOLLOW_FLOOR of their own base. A deep undercut (below PRICE_WAR_TRIGGER)
 * still gets a direct match. Everyone else drifts back to base.
 */
function updatePrices(s: GameState, def: CompetitorDef, c: Competitor, topSegs: Set<Segment>): void {
  const T = COMP_TUNING;
  for (const kind of KINDS) {
    // Chat is a flat $20/month for everyone, so cheap-API personalities only partly discount it.
    const mult = kind === 'chat' ? CHAT_PRICE_COMPRESSION + (1 - CHAT_PRICE_COMPRESSION) * def.priceMult : def.priceMult;
    const seg = SEGMENT_OF[kind];
    const base = s.market.segments[seg].refPrice * mult;
    const playerPrice = lowestLivePrice(s, kind);
    let target = base;
    let rate = T.PRICE_RETURN_RATE;
    if (def.personality === 'price' && playerPrice !== undefined) {
      if (topSegs.has(seg)) {
        target = Math.min(base, Math.max(playerPrice, T.PRICE_FOLLOW_FLOOR * base));
        rate = T.PRICE_FOLLOW_RATE;
      } else if (playerPrice < T.PRICE_WAR_TRIGGER * base) {
        target = playerPrice;
        rate = T.PRICE_WAR_RATE;
      }
    }
    c.prices[kind] = Math.max(0.01, c.prices[kind] + (target - c.prices[kind]) * rate);
  }
}

/**
 * Rivals chase a runaway player. From CATCHUP_START_YEAR the labs ramp up to CATCHUP_SHARE of the gap
 * between the player's best model and the frontier (plus a margin) by CATCHUP_FULL_YEAR. Keeps the arena contested.
 */
export function rivalCatchUp(s: GameState, year: number, frontier: number): number {
  const T = COMP_TUNING;
  const best = bestPlayerModel(s);
  if (!best) return 0;
  const ramp = clamp((year - T.CATCHUP_START_YEAR) / (T.CATCHUP_FULL_YEAR - T.CATCHUP_START_YEAR), 0, 1);
  return ramp * T.CATCHUP_SHARE * Math.max(0, best.overall - (frontier + T.CATCHUP_MARGIN));
}

/** A reasoning or coding peak must sit this many points above the mean of all caps to take a pool name. */
const SPECIALTY_EDGE = 20;
type NamePool = 'reasoning' | 'coder';

/**
 * Which name pool a release draws from. Reasoning reads the better of reasoning and math. The pool must exist for
 * the lab; if both qualify, the stronger edge wins.
 */
export function namePoolFor(caps: Capabilities, available: Partial<Record<NamePool, string[]>>): NamePool | null {
  const mean = CAP_IDS.reduce((sum, k) => sum + caps[k], 0) / CAP_IDS.length;
  const edges: [NamePool, number][] = [
    ['reasoning', Math.max(caps.reasoning, caps.math) - mean],
    ['coder', caps.coding - mean],
  ];
  let best: NamePool | null = null;
  let bestEdge = SPECIALTY_EDGE;
  for (const [pool, edge] of edges) {
    if (edge >= bestEdge && (available[pool]?.length ?? 0) > 0) {
      best = pool;
      bestEdge = edge;
    }
  }
  return best;
}

/**
 * The name for a lab's next release (GAME_DESIGN.md §17.1). Normal releases walk `naming.sequence`; a release with
 * skewed caps takes the next entry of the matching pool instead, and an exhausted pool falls back to the sequence.
 * Counters live in s.flags, and the sequence, pools and `after` never overlap, so a lab never repeats a name.
 */
export function nextRivalName(s: GameState, def: CompetitorDef, c: Competitor, caps: Capabilities): string {
  const naming = def.naming;
  if (!naming) {
    // Legacy fallback for labs without a house scheme.
    const n = Math.max(1, def.modelNames.length);
    const cycle = Math.floor(c.modelsReleased / n);
    const stem = def.modelNames[c.modelsReleased % n];
    return cycle > 0 ? `${stem} ${cycle + 1}` : stem;
  }
  const pool = namePoolFor(caps, { reasoning: naming.reasoning, coder: naming.coder });
  if (pool) {
    const list = naming[pool];
    const key = `nameIdx${pool === 'reasoning' ? 'R' : 'C'}.${def.id}`;
    const i = s.flags[key] ?? 0;
    if (list && i < list.length) {
      s.flags[key] = i + 1;
      return list[i];
    }
  }
  const key = `nameIdx.${def.id}`;
  const k = s.flags[key] ?? 0;
  s.flags[key] = k + 1;
  return k < naming.sequence.length ? naming.sequence[k] : naming.after(k - naming.sequence.length + 1);
}

/**
 * Scores, caps and overall for one release at a given base quality (an OVERALL, soft-ceiling units). Spreads the scores by
 * personality around the linear base, which is the inverse soft ceiling of `base`, so the release's overall lands on `base`.
 */
function buildRelease(s: GameState, def: CompetitorDef, rng: Rng, year: number, base: number, noisy: [number, number, number, number]) {
  const mean = weighted(noisy);
  const lin = softCeilingInverse(base);
  const sc: Scores = {
    reasoning: clamp(lin + noisy[0] - mean, 0, 100),
    coding: clamp(lin + noisy[1] - mean, 0, 100),
    chat: clamp(lin + noisy[2] - mean, 0, 100),
    safety: clamp(lin + noisy[3] - mean, 0, 100),
  };
  // v2: the lab's scores come from a capability profile (personality-aware); overall is recomputed from those scores.
  const capsRaw = competitorCaps(sc, def.personality, rng, year);
  // Exclusive data sets the player holds starve this lab of knowledge (GAME_DESIGN.md §14).
  const caps = { ...capsRaw, knowledge: Math.max(0, capsRaw.knowledge - rivalExclusiveMalus(s, def.id)) };
  const scores = scoresFromCaps(caps);
  const overall = Math.round(overallScore(scores) * 10) / 10;
  return { caps, scores, overall };
}

/** Releases a model for an AI lab. Returns nothing; the caller records that the lab released this tick. */
function releaseModel(s: GameState, rng: Rng, def: CompetitorDef, c: Competitor): void {
  const year = yearOf(s.day);
  const frontier = frontierQuality(year);
  // Leaked weights and open-weights releases lift every rival release by one point per point of boost.
  const boost = (s.flags.leakBoost ?? 0) + (s.flags.openBoost ?? 0);
  // A counter-punch floor (set when the player took Arena #1) applies to this release only.
  const counterKey = flagKey.counter(def.id);
  const floor = s.flags[counterKey];
  if (floor !== undefined) delete s.flags[counterKey];

  let base = clamp(frontier + def.qualityOffset + rivalQualityOffset(s) + rivalCatchUp(s, year, frontier) + boost + rng.normal(0, 2), 0, BASE_MAX_OVERALL); // v9 scenario: difficulty

  // Spread the four scores around the overall according to personality, then centre so the weighted mean is `base`.
  const d = personalityOffsets(def.personality, rng);
  const noisy: [number, number, number, number] = [d[0] + rng.normal(0, 2.5), d[1] + rng.normal(0, 2.5), d[2] + rng.normal(0, 2.5), d[3] + rng.normal(0, 2.5)];
  let built = buildRelease(s, def, rng, year, base, noisy);
  // Nudge the base up until the release clears the counter floor (a few tries; the caps mapping is not exactly linear).
  for (let attempt = 0; floor !== undefined && built.overall < floor && attempt < 3; attempt++) {
    base = clamp(base + (floor - built.overall) + 0.2, 0, BASE_MAX_OVERALL);
    built = buildRelease(s, def, rng, year, base, noisy);
  }
  const { caps, scores, overall } = built;

  const name = nextRivalName(s, def, c, caps);

  c.model = { name, scores, overall, elo: 800 + overall * 8, releasedDay: s.day, caps, benchmarks: benchmarkTable(caps, calendarYear(s.day), null) };
  c.modelsReleased += 1;
  c.brand = clamp(c.brand + 2, 0, 100);
  // High rivalry shortens the release cycle by RIVALRY_CYCLE_MULT.
  const cycleMult = (c.rivalry ?? 0) > COMP_TUNING.RIVALRY_HIGH ? COMP_TUNING.RIVALRY_CYCLE_MULT : 1;
  c.nextReleaseDay = s.day + Math.max(20, Math.round(def.releaseEveryDays * (1 + rng.range(-0.3, 0.3)) * cycleMult));

  const best = bestPlayerModel(s);
  const beatsUs = !best || overall > best.overall;
  const shock = SHOCK_LABS.has(def.id) && c.modelsReleased === 1;
  const vars = { lab: def.name, model: name, overall, gap: best ? Math.abs(overall - best.overall) : undefined };
  const copy = shock ? rng.pick(SHOCK_RELEASE_COPY) : releaseCopy(def, rng, beatsUs, !!best);
  pushNews(s, fillRelease(copy, vars), shock || beatsUs ? 'bad' : 'info');
  if (overall >= frontier) nudgeAiHype(s, 1.5);
  if (shock) nudgeAiHype(s, -12);
}

/** Rival valuation: 25 x annualised revenue + brand x $50M x aiHype/50. */
function competitorValuation(s: GameState, c: Competitor): number {
  const year = yearOf(s.day);
  let annual = 0;
  for (const seg of SEGMENTS) {
    const users = c.users[seg];
    const price = c.prices[KIND_OF[seg]];
    const dailyRevenue = seg === 'developer' ? users * mtokPerUserDay('developer', year) * price : (users * price) / 30;
    annual += dailyRevenue * 365;
  }
  return Math.max(0, 25 * annual + c.brand * 50e6 * (s.market.aiHype / 50));
}

/** An AI lab with its static definition. The multiplayer rival is never in this list, so AI logic skips it. */
interface Lab { def: CompetitorDef; c: Competitor }

/** Segments where the player holds the strictly highest share of adopters right now. */
export function topShareSegments(s: GameState): Set<Segment> {
  const out = new Set<Segment>();
  for (const seg of SEGMENTS) {
    const rows = segmentShares(s, seg);
    // v8: the player may run two product lines per kind, so their share is the sum over their rows.
    const mine = rows.reduce((t, r) => (r.isPlayer ? t + r.share : t), 0);
    if (mine <= 0) continue;
    if (rows.every((r) => r.isPlayer || r.share < mine)) out.add(seg);
  }
  return out;
}

/** A lab's home segment. Chaos labs draw one at random the first time and keep it in s.flags. */
function homeSegmentOf(s: GameState, def: CompetitorDef, rng: Rng): Segment {
  if (def.personality !== 'chaos') return HOME_SEGMENT[def.personality];
  const key = flagKey.home(def.id);
  if (s.flags[key] === undefined) s.flags[key] = rng.int(0, SEGMENTS.length - 1);
  return SEGMENTS[s.flags[key]];
}

export function rivalryTier(r: number): number {
  let tier = 0;
  for (const edge of COMP_TUNING.RIVALRY_TIERS) if (r >= edge) tier += 1;
  return Math.min(tier, RIVALRY_TIER_COUNT - 1);
}

function bumpRivalry(c: Competitor, amount: number): void {
  c.rivalry = clamp((c.rivalry ?? 0) + amount, 0, 100);
}

/** Cosmetic copy choice. Derived from the day and the news count, not the sim RNG, so headlines never shift the sim's random stream. */
function pickCopy<T>(s: GameState, list: readonly T[]): T {
  const h = (s.day * 2654435761 + s.news.length * 40503) >>> 0;
  return list[h % list.length];
}

function reaction(s: GameState, rng: Rng, pool: keyof typeof REACTION_HEADLINES, vars: Record<string, string | number>, kind: NoticeKind): void {
  pushNews(s, fillTemplate(pickCopy(s, REACTION_HEADLINES[pool]), vars), kind);
}

/**
 * Counter-punch: when the player takes Arena #1, the 1-2 labs within COUNTER_ELO_WINDOW of the top pull their next
 * release forward and aim it at the player's overall plus a little noise (applied as a floor in releaseModel).
 */
function counterPunch(s: GameState, rng: Rng, rows: ArenaRow[], labs: Lab[]): void {
  const T = COMP_TUNING;
  const top = rows[0];
  const playerTop = !!top && top.isPlayer;
  const wasTop = s.flags[ARENA_TOP_FLAG] === 1;
  s.flags[ARENA_TOP_FLAG] = playerTop ? 1 : 0;
  if (!top || !playerTop || wasTop) return;
  const best = bestPlayerModel(s);
  if (!best) return;
  const lastAt = s.flags[LAST_COUNTER_FLAG];
  if (lastAt !== undefined && s.day - lastAt < T.COUNTER_COOLDOWN_DAYS) return;

  const picks: Lab[] = [];
  for (const r of rows) {
    if (picks.length >= T.COUNTER_MAX_LABS) break;
    if (r.isPlayer || r.elo < top.elo - T.COUNTER_ELO_WINDOW) continue;
    const lab = labs.find((l) => l.def.id === r.id);
    if (lab) picks.push(lab);
  }
  if (picks.length > 0) s.flags[LAST_COUNTER_FLAG] = s.day;
  for (const { def, c } of picks) {
    c.nextReleaseDay = Math.min(c.nextReleaseDay, s.day + rng.int(T.COUNTER_DAYS_MIN, T.COUNTER_DAYS_MAX));
    s.flags[flagKey.counter(def.id)] = best.overall + rng.normal(T.COUNTER_MEAN, T.COUNTER_SD);
    pushNews(s, fillTemplate(pickCopy(s, COUNTER_HEADLINES[def.personality]), { lab: def.name }), 'bad');
  }
}

/** Rivalry from crowns: the player takes a benchmark crown a lab held. Crowns are the best score per benchmark. */
function crownFlips(s: GameState, rng: Rng, labs: Lab[]): void {
  const T = COMP_TUNING;
  const best: Record<string, { value: number; holder: string }> = {};
  const offer = (holder: string, bench: string, value: number) => {
    const cur = best[bench];
    if (!cur || value > cur.value) best[bench] = { value, holder };
  };
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated || !m.benchmarks) continue;
    for (const [bench, value] of Object.entries(m.benchmarks)) offer('player', bench, value);
  }
  for (const { def, c } of labs) {
    if (!c.model?.benchmarks) continue;
    for (const [bench, value] of Object.entries(c.model.benchmarks)) offer(def.id, bench, value);
  }
  for (const bench of Object.keys(best)) {
    const holder = best[bench].holder;
    // Stored as 0 = player, i + 1 = the i-th lab in COMPETITORS.
    const code = holder === 'player' ? 0 : LAB_IDS.indexOf(holder) + 1;
    if (code < 0) continue;
    const key = flagKey.crown(bench);
    const prev = s.flags[key];
    s.flags[key] = code;
    if (prev === undefined || prev === code || code !== 0 || prev === 0) continue;
    const lab = labs.find((l) => l.def.id === LAB_IDS[prev - 1]);
    if (!lab) continue;
    bumpRivalry(lab.c, T.RIVALRY_CROWN);
    const newsKey = flagKey.crownNews(lab.def.id);
    const lastNews = s.flags[newsKey];
    if (lastNews !== undefined && s.day - lastNews < T.CROWN_NEWS_COOLDOWN_DAYS) continue;
    s.flags[newsKey] = s.day;
    reaction(s, rng, 'crown', { company: s.company.name, lab: lab.def.name, bench: benchmarkById(bench)?.name ?? bench }, 'good');
  }
}

/** Rivalry from flagship fights: the player's best overall moves past a lab's current flagship. */
function flagshipFlips(s: GameState, rng: Rng, labs: Lab[], released: Set<string>): void {
  const best = bestPlayerModel(s);
  if (!best) return;
  for (const { def, c } of labs) {
    if (!c.model) continue;
    const key = flagKey.beat(def.id);
    const was = s.flags[key] === 1;
    const now = best.overall > c.model.overall;
    s.flags[key] = now ? 1 : 0;
    if (now && !was) {
      bumpRivalry(c, COMP_TUNING.RIVALRY_BEAT_FLAGSHIP);
      reaction(s, rng, 'playerBeats', { lab: def.name, model: best.name, company: s.company.name }, 'good');
    } else if (!now && was && !released.has(def.id)) {
      // They retake it by releasing, which already has its own news line, so only the quiet case gets a headline.
      reaction(s, rng, 'theyBeat', { lab: def.name, model: c.model.name, company: s.company.name }, 'bad');
    }
  }
}

/** Rivalry from Arena passes: the player moves above a lab on the Arena. Weekly standings news is separate. */
function arenaPassFlips(s: GameState, labs: Lab[], rows: ArenaRow[]): void {
  const me = rows.find((r) => r.isPlayer);
  if (!me) return;
  for (const { def, c } of labs) {
    const row = rows.find((r) => r.id === def.id);
    if (!row) continue;
    const key = flagKey.passed(def.id);
    const was = s.flags[key] === 1;
    const now = me.elo > row.elo;
    s.flags[key] = now ? 1 : 0;
    if (now && !was) bumpRivalry(c, COMP_TUNING.RIVALRY_ARENA_PASS);
  }
}

/** Rivalry from segment share: the player takes the share lead from a lab in a segment. */
function segmentLeadFlips(s: GameState, labs: Lab[], shareRows: Record<Segment, ShareRow[]>): void {
  for (const seg of SEGMENTS) {
    const rows = shareRows[seg];
    const mine = rows.reduce((t, r) => (r.isPlayer ? t + r.share : t), 0);
    if (mine <= 0) continue;
    for (const { def, c } of labs) {
      const row = rows.find((r) => r.id === def.id);
      if (!row) continue;
      const key = flagKey.lead(def.id, seg);
      const was = s.flags[key] === 1;
      const now = mine > row.share;
      s.flags[key] = now ? 1 : 0;
      if (now && !was) bumpRivalry(c, COMP_TUNING.RIVALRY_SEGMENT_LEAD);
    }
  }
}

/** Rivalry from undercuts: the player's price drops below a lab's price in a kind. */
function undercutFlips(s: GameState, rng: Rng, labs: Lab[]): void {
  for (const { def, c } of labs) {
    for (const kind of KINDS) {
      const playerPrice = lowestLivePrice(s, kind);
      if (playerPrice === undefined) continue;
      const key = flagKey.under(def.id, kind);
      const was = s.flags[key] === 1;
      const now = playerPrice < COMP_TUNING.UNDERCUT_RATIO * c.prices[kind];
      s.flags[key] = now ? 1 : 0;
      if (now && !was) {
        bumpRivalry(c, COMP_TUNING.RIVALRY_UNDERCUT);
        reaction(s, rng, 'priceCut', { lab: def.name, company: s.company.name }, 'info');
      }
    }
  }
}

/**
 * Monthly poaching. A lab with a brand, a rivalry and a player with low morale takes 1-3 researchers, or a hired star,
 * unless morale is above POACH_MORALE_CUTOFF or the researcher salary level is at or above POACH_SALARY_CUTOFF.
 */
function rollPoaching(s: GameState, rng: Rng, labs: Lab[]): void {
  const T = COMP_TUNING;
  const researchers = s.staff.roles.researcher;
  if (s.staff.morale > T.POACH_MORALE_CUTOFF || researchers.salaryLevel >= T.POACH_SALARY_CUTOFF) return;
  const moraleWeight = clamp((T.POACH_MORALE_CUTOFF - s.staff.morale) / T.POACH_MORALE_SPAN, 0, 1);
  for (const { def, c } of labs) {
    if (!c.active) continue;
    const rivalryWeight = (c.rivalry ?? 0) > T.RIVALRY_HIGH ? T.RIVALRY_POACH_MULT : 1;
    const weight = (0.5 + c.brand / 100) * rivalryWeight * moraleWeight;
    if (!rng.chance(T.POACH_CHANCE * weight)) continue;

    const hired = s.staff.stars.filter((st) => st.hiredDay !== null);
    if (hired.length > 0 && rng.chance(T.POACH_STAR_SHARE)) {
      const star = hired.reduce((a, b) => (b.loyalty < a.loyalty ? b : a));
      s.staff.stars = s.staff.stars.filter((x) => x.id !== star.id);
      notify(s, `${star.name} left for ${def.name}. Their bonuses went with them.`, 'bad');
      pushNews(s, `${def.name} hires ${star.name}, ${star.title}, away from ${s.company.name}.`, 'bad');
      bumpRivalry(c, T.RIVALRY_POACHED);
      continue;
    }
    // The two founders never leave: only researchers beyond them can be poached.
    const poachable = researchers.count - 2;
    if (poachable < 1) continue;
    const n = Math.min(poachable, rng.int(1, T.POACH_MAX_RESEARCHERS));
    researchers.count -= n;
    notify(s, `${def.name} poached ${n} of your ${n === 1 ? 'researcher' : 'researchers'}. Pay better or care more.`, 'bad');
    reaction(s, rng, 'poach', { lab: def.name, company: s.company.name, n }, 'bad');
    bumpRivalry(c, T.RIVALRY_POACHED);
  }
}

/** CEO quotes: one when rivalry climbs into a higher tier, and occasionally (about 1 per 60 days) at tier 2 or above. */
function rivalryQuotes(s: GameState, rng: Rng, def: CompetitorDef, c: Competitor): void {
  const T = COMP_TUNING;
  const tier = rivalryTier(c.rivalry ?? 0);
  const tierKey = flagKey.tier(def.id);
  const prevTier = s.flags[tierKey] ?? 0;
  s.flags[tierKey] = tier;
  const quotedAt = s.flags[flagKey.quoted(def.id)];
  const cooled = quotedAt === undefined || s.day - quotedAt >= T.QUOTE_COOLDOWN_DAYS;
  if (!cooled) return;
  const climbed = tier > prevTier;
  if (climbed || (tier >= 2 && rng.chance(T.QUOTE_CHANCE_PER_DAY))) {
    const pool = CEO_QUOTES[def.id]?.[tier];
    if (!pool || pool.length === 0) return;
    pushNews(s, `${def.name}'s CEO says: "${pickCopy(s, pool)}"`, 'info');
    s.flags[flagKey.quoted(def.id)] = s.day;
  }
}

/** Weekly standings: a lab that moved above or below the player on the Arena since last week gets a line. */
function weeklyStandings(s: GameState, labs: Lab[], rows: ArenaRow[]): void {
  const me = rows.findIndex((r) => r.isPlayer);
  if (me < 0) return;
  const rank = me + 1;
  const prevRank = s.flags[STANDING_PLAYER_FLAG];
  s.flags[STANDING_PLAYER_FLAG] = rank;
  for (const { def } of labs) {
    const idx = rows.findIndex((r) => r.id === def.id);
    if (idx < 0) continue;
    const key = flagKey.standing(def.id);
    const wasAbove = s.flags[key];
    const above = idx < me;
    s.flags[key] = above ? 1 : 0;
    if (prevRank === undefined || wasAbove === undefined || (wasAbove === 1) === above) continue;
    if (above) notify(s, `${def.name} passes you on the Arena (#${prevRank} → #${rank})`, 'bad');
    else notify(s, `You pass ${def.name} (#${prevRank} → #${rank})`, 'good');
  }
}

/** Leaked and open-weights boosts fade by (1 - 1/BOOST_DECAY_DAYS) per day. */
function decayBoosts(s: GameState): void {
  const keep = 1 - 1 / COMP_TUNING.BOOST_DECAY_DAYS;
  for (const key of ['leakBoost', 'openBoost']) {
    const v = s.flags[key];
    if (v === undefined) continue;
    const next = v * keep;
    s.flags[key] = next < 1e-3 ? 0 : next;
  }
}

export function competitorsTick(s: GameState, rng: Rng): void {
  const year = yearOf(s.day);
  // v12: a multiplayer guest does not run its own AI labs. It mirrors the host's (applyHostLabs), so both players see
  // one arena. What only concerns this player (poaching, rivalry, standings) still runs below.
  const mirror = s.mp?.role === 'guest';
  if (mirror) {
    applyHostLabs(s);
    const labs: Lab[] = [];
    for (const def of COMPETITORS) {
      const c = s.competitors.find((x) => x.id === def.id);
      if (c && !c.human && c.active) labs.push({ def, c });
    }
    const rows = arenaLeaderboard(s);
    if (s.day % COMP_TUNING.POACH_EVERY_DAYS === 0) rollPoaching(s, rng, labs);
    for (const { def, c } of labs) {
      c.rivalry = Math.max(0, (c.rivalry ?? 0) - COMP_TUNING.RIVALRY_DECAY_PER_DAY);
      rivalryQuotes(s, rng, def, c);
    }
    if (s.day % COMP_TUNING.STANDINGS_EVERY_DAYS === 0) weeklyStandings(s, labs, rows);
    decayBoosts(s);
    const best = bestPlayerModel(s);
    if (best) s.stats.bestElo = Math.max(s.stats.bestElo, best.elo);
    return;
  }

  // 1. Activate labs that have been founded. Human rivals are skipped by construction (they are not in COMPETITORS).
  const labs: Lab[] = [];
  for (const def of COMPETITORS) {
    const c = s.competitors.find((x) => x.id === def.id);
    if (!c || c.human) continue;
    if (!c.active) {
      if (year < def.foundedYear) continue;
      c.active = true;
      c.nextReleaseDay = s.day;
      pushNews(s, `${def.name} opens for business. ${def.tagline}`, 'info');
    }
    labs.push({ def, c });
  }

  // 2. Prices (price labs follow the player's price where the player leads a segment), home-segment brand, releases.
  const topSegs = topShareSegments(s);
  const released = new Set<string>();
  for (const { def, c } of labs) {
    c.rivalry = c.rivalry ?? 0;
    updatePrices(s, def, c, topSegs);
    if (topSegs.has(homeSegmentOf(s, def, rng))) c.brand = clamp(c.brand + COMP_TUNING.HOME_BRAND_PER_DAY, 0, 100);
    if (s.day >= c.nextReleaseDay) {
      releaseModel(s, rng, def, c);
      released.add(def.id);
    }
    c.brand = clamp(c.brand + (def.brand - c.brand) * 0.002, 0, 100);
    c.valuation = competitorValuation(s, c);
  }

  // 3. Arena, crowns, share and price: counter-punch, then the rivalry that the player's moves create.
  const rows = arenaLeaderboard(s);
  counterPunch(s, rng, rows, labs);
  crownFlips(s, rng, labs);
  flagshipFlips(s, rng, labs, released);
  arenaPassFlips(s, labs, rows);
  const shareRows = { consumer: segmentShares(s, 'consumer'), developer: segmentShares(s, 'developer'), enterprise: segmentShares(s, 'enterprise') };
  segmentLeadFlips(s, labs, shareRows);
  undercutFlips(s, rng, labs);

  // 4. Monthly poaching.
  if (s.day % COMP_TUNING.POACH_EVERY_DAYS === 0) rollPoaching(s, rng, labs);

  // 5. Rivalry decays, and crosses into CEO quotes.
  for (const { def, c } of labs) {
    c.rivalry = Math.max(0, (c.rivalry ?? 0) - COMP_TUNING.RIVALRY_DECAY_PER_DAY);
    rivalryQuotes(s, rng, def, c);
  }

  // 6. Weekly standings, boosts, stats.
  if (s.day % COMP_TUNING.STANDINGS_EVERY_DAYS === 0) weeklyStandings(s, labs, rows);
  decayBoosts(s);
  const best = bestPlayerModel(s);
  if (best) s.stats.bestElo = Math.max(s.stats.bestElo, best.elo);
}
