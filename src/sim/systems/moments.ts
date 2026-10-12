// OWNER: Agent MOMENTS. Big "aha" beats shown full-window (GAME_DESIGN §18.3).
// Each tick (when the sim is not blocked) this finds the earned beats, fires the first one not yet shown, and sets
// s.pendingMoment. Any other beats earned the same day wait and fire on later days, one at a time.
import type { ActionHandlers, Competitor, GameState, Id, Model, Moment, ProductKind, Rng } from '../types';
import { clamp, formatDate, formatMoney, pushNews } from '../util';
import { benchmarkById } from './capabilities';
import { arenaLeaderboard, type ArenaRow } from './competitors';
import { annualRevenue } from './finance';
import { labInfo, labName } from './labs';
import { bestPlayerModel, modelById } from './market';

/** Flags: 'moment.<id>' marks a beat as shown (or seeded as already true). */
const FLAG_PREFIX = 'moment.';
const INIT_FLAG = 'moments.init';
/** Arena tracking: the day the current #1 reign began, and the length of the last reign that ended. */
const ARENA_SINCE = 'moments.arena1Since';
const ARENA_HELD = 'moments.arena1Held';
/** Day the last takeover fired. Beats earned after it wait this many days, so takeovers stay rare. */
const LAST_FLAG = 'moments.last';
const COOLDOWN_DAYS = 7;
/** Losing #1 only counts after a reign of at least this many days. */
const LOSS_MIN_DAYS = 90;
const TRILLION = 1e12;
const MILLION = 1e6;

type Tone = Moment['tone'];
type CopyKey = keyof typeof MOMENT_COPY;

/**
 * Satirical copy. Placeholders: {company}, {model}, {product}, {lab}, {labModel}, {benchmark}, {valuation}, {elo},
 * {days}, {ours}, {theirs}. Titles and subtitles pick one option at random; the news burst is always the three lines.
 */
const MOMENT_COPY = {
  first_model: {
    title: ['It talks.', 'Something answered back.', 'The first one is always the worst one.'],
    subtitle: [
      '{model} finishes training and produces a sentence. The sentence is mostly grammatical.',
      '{model} is out of the oven. The team has agreed not to ask it anything difficult yet.',
    ],
    news: [
      '{company} finishes training its first model and names it {model}.',
      'Staff report the first output was "a sentence, roughly".',
      'Investors ask for a demo. The demo is a loading bar.',
    ],
  },
  first_product: {
    title: ['Somebody is paying for it.', 'The launch button works.', 'Live. Customers, allegedly.'],
    subtitle: [
      '{product} is live on {model}. The support inbox is already open.',
      '{product} launches on {model}. The pricing was decided in a meeting that ran long.',
    ],
    news: [
      '{company} launches {product}, built on {model}.',
      'The first {product} customer asks what a "token" is. Nobody has an answer prepared.',
      'Analysts call the launch "a start".',
    ],
  },
  chat_yours: {
    title: ['Grandma has your app now.', 'The first chatbot for everyone is yours.', 'The world gets a chatbot. It is yours.'],
    subtitle: [
      '{product} is the first chatbot that normal people can use. Grandma has questions.',
      '{company} shipped the first chatbot for everyone. Every other lab is now reading your blog post.',
    ],
    news: [
      '{product} is on the front page of newspapers that do not usually cover software.',
      'Rivals announce "chat" features within a week. They are all named after the same idea.',
      'Your support queue now includes a grandmother.',
    ],
  },
  chat_rival: {
    title: ['The world gets a chatbot. Not yours.', 'Grandma found someone else first.', 'A rival makes chat normal.'],
    subtitle: [
      '{lab} ships the first chatbot that normal people can use. You will need a better answer than "we are working on it".',
      '{lab} launches chat for everyone. Your own chat product is still a rumour.',
    ],
    news: [
      'ChatMoment: {lab} ships a chatbot that normal people can use.',
      'Grandma has, reportedly, already switched to {lab}.',
      'Analysts ask why {company} has not launched chat yet.',
    ],
  },
  arr_1m: {
    title: ['A million a year. Cute.', 'Seven figures, annualised.', 'The first million, before the GPUs.'],
    subtitle: [
      'The run-rate has passed one million a year. Compute costs have been informed.',
      'Annualised revenue crosses a million. The electricity bill crossed it earlier.',
    ],
    news: [
      '{company} annualised revenue passes $1M. Finance asks for a second meeting.',
      '{company} is now officially a business, per the cap table.',
      'Analysts put {company} in the "promising" column, next to everyone else.',
    ],
  },
  first_arena_1: {
    title: ['Number one. For now.', 'Top of the arena. Briefly, probably.', 'The leaderboard has your name on it.'],
    subtitle: [
      '{model} scores {elo} Elo. {lab} is now second and its press team is drafting a rebuttal.',
      '{model} takes the top of the arena at {elo} Elo. The arena has not yet asked about your safety card.',
    ],
    news: [
      '{company} takes the top spot on the arena with {model}.',
      '{lab} calls the arena "a popularity contest" and asks for a rematch.',
      'Votes from the arena crowd are described as "mostly in favour".',
    ],
  },
  first_sota: {
    title: ['Secretly the best. Publicly, now.', 'We did not mention it. It was the best.', 'Unannounced, then unveiled, then first.'],
    subtitle: [
      '{model} topped {benchmark} while still in the vault. Release made it official.',
      '{model} was the best score on {benchmark} before anyone outside the building knew.',
    ],
    news: [
      '{company} now leads {benchmark}. The chart was made before launch.',
      'Benchmark authors ask for a copy of the internal run. It is not for sale.',
      'The vault was right. Staff now say they always knew.',
    ],
  },
  beat_lab: {
    title: ['{lab} is no longer the one to beat.', '{lab} has been overtaken.', 'Sorry, {lab}. You are now the comparison chart.'],
    subtitle: [
      '{model} ({ours}) is now ahead of {labModel} ({theirs}). {lab} has been informed.',
      '{model} beats {labModel} on overall score. {lab} will call it a "benchmark artifact".',
    ],
    news: [
      '{lab} concedes nothing in public and a great deal in private.',
      '{company} now leads {lab} on the overall score.',
      '{lab} staff are reportedly "reviewing the roadmap".',
    ],
  },
  ipo: {
    title: ['Listed. The quarterly calls begin.', 'Ticker acquired. Sleep is optional now.', 'Public. The mood is now a number.'],
    subtitle: [
      '{company} is on the exchange at {valuation}. Investors have read the blog post.',
      '{company} lists at a valuation of {valuation}. Every feeling is now quarterly.',
    ],
    news: [
      '{company} lists on the exchange. The opening bell was a recording.',
      'Underwriters describe the company as "a story". The story is priced.',
      'Retail investors ask what the company does. The answer is on page 212 of the prospectus.',
    ],
  },
  valuation_1t: {
    title: ['A trillion dollars, on paper.', 'Worth more than a small country, in theory.', 'Trillion-dollar company. The paper says so.'],
    subtitle: [
      '{company} is valued at {valuation}. Most of that is the word "AI", in a larger font.',
      '{valuation} at the last mark. Nobody has asked what it would be worth in cash.',
    ],
    news: [
      '{company} crosses a trillion dollars in valuation. Its cash balance is less exciting.',
      'Pension funds ask for a seat on the board. The board has no seats left.',
      'Analysts say the number is "directionally correct".',
    ],
  },
  lost_arena_1: {
    title: ['The throne was rented.', 'Someone else is number one.', 'Off the top spot.'],
    subtitle: [
      '{lab} takes the arena with {model}. You held the top spot for {days} days.',
      '{lab} overtakes {company} on the arena after a reign of {days} days.',
    ],
    news: [
      '{lab} takes the top spot on the arena. Its press release is 90 pages.',
      '{company} loses the number one spot on the arena. The team says it was "always the plan".',
      'Analysts ask whether the throne was ever really yours.',
    ],
  },
} as const;

interface Beat {
  /** Moment id. The flag is FLAG_PREFIX + id. */
  id: string;
  copy: CopyKey;
  tone: Tone;
  /** Hype change on firing (signed, clamped 0..100). */
  hype: number;
  vars: Record<string, string>;
  stats: Moment['stats'];
}
interface Candidate {
  id: string;
  build: () => Beat;
}
interface SotaHit {
  benchId: Id;
  model: Model;
  ours: number;
  prev: number;
}

// ---- helpers --------------------------------------------------------------------------------

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function num(v: number, digits = 0): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function priceLabel(kind: ProductKind, price: number): string {
  if (kind === 'chat') return `$${price.toFixed(0)}/user/mo`;
  if (kind === 'api') return `$${price.toFixed(2)}/Mtok`;
  return `$${price.toFixed(0)}/seat/mo`;
}

function isDone(s: GameState, id: string): boolean {
  return s.flags[FLAG_PREFIX + id] !== undefined;
}

/** Arena #1 bookkeeping: runs every unblocked day, before any beat is checked. */
function trackArena(s: GameState, rows: ArenaRow[]): void {
  const playerTop = rows[0]?.isPlayer === true;
  const since = s.flags[ARENA_SINCE] as number | undefined;
  if (playerTop && since === undefined) {
    s.flags[ARENA_SINCE] = s.day;
  } else if (!playerTop && since !== undefined) {
    s.flags[ARENA_HELD] = s.day - since;
    delete s.flags[ARENA_SINCE];
  }
}

/** Best public score on one benchmark among rival labs and the player's other released models. */
function bestOtherScore(s: GameState, benchId: Id, exceptId: Id): number | null {
  let best: number | null = null;
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    const v: number | undefined = c.model.benchmarks?.[benchId];
    if (v !== undefined && (best === null || v > best)) best = v;
  }
  for (const m of s.models) {
    if (m.id === exceptId || m.releasedDay === null || m.deprecated) continue;
    const v: number | undefined = m.benchmarks?.[benchId];
    if (v !== undefined && (best === null || v > best)) best = v;
  }
  return best;
}

/**
 * A released model whose benchmark was the best while still in the vault (benchRuns), and whose public score
 * beats every other public score once it is out. Returns the first one found.
 */
function findUnannouncedSota(s: GameState): SotaHit | null {
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated || !m.benchRuns || !m.benchmarks) continue;
    for (const [benchId, run] of Object.entries(m.benchRuns)) {
      const pub: number | undefined = m.benchmarks[benchId];
      if (pub === undefined) continue;
      const prev = bestOtherScore(s, benchId, m.id);
      if (prev !== null && run.score > prev && pub > prev) return { benchId, model: m, ours: pub, prev };
    }
  }
  return null;
}

// ---- beat builders (only called for beats that are earned and not yet shown) --------------------

function buildFirstModel(s: GameState): Beat {
  const first = [...s.models].sort((a, b) => a.trainedDay - b.trainedDay)[0];
  return {
    id: 'first_model',
    copy: 'first_model',
    tone: 'milestone',
    hype: 3,
    vars: { company: s.company.name, model: first.name },
    stats: [
      { label: 'Model', value: first.name },
      { label: 'Parameters', value: `${num(first.paramsB, 1)}B`, num: true },
      { label: 'Training tokens', value: `${num(first.tokensB, 1)}B`, num: true },
      { label: 'Overall score', value: first.overall.toFixed(1), num: true },
    ],
  };
}

function buildFirstProduct(s: GameState): Beat {
  const p = s.products[0];
  const model = modelById(s, p.modelId)?.name ?? 'an unnamed model';
  return {
    id: 'first_product',
    copy: 'first_product',
    tone: 'milestone',
    hype: 4,
    vars: { company: s.company.name, product: p.name, model },
    stats: [
      { label: 'Product', value: p.name },
      { label: 'Model', value: model },
      { label: 'Price', value: priceLabel(p.kind, p.price), num: true },
      { label: 'Days since founding', value: num(s.day), num: true },
    ],
  };
}

function buildChat(s: GameState): Beat {
  const day = (s.flags.chatMoment as number | undefined) ?? s.day;
  const mine = s.products.find((p) => p.kind === 'chat' && p.launchedDay === day);
  if (mine) {
    const model = modelById(s, mine.modelId)?.name ?? 'an unnamed model';
    return {
      id: 'chat_moment',
      copy: 'chat_yours',
      tone: 'triumph',
      hype: 10,
      vars: { company: s.company.name, product: mine.name, model },
      stats: [
        { label: 'Product', value: mine.name },
        { label: 'Price', value: priceLabel('chat', mine.price), num: true },
        { label: 'Launched', value: formatDate(day), num: true },
        { label: 'Days since founding', value: num(s.day), num: true },
      ],
    };
  }
  const rival: Competitor | undefined = s.competitors.find((c) => c.active && c.model !== null);
  const lab = rival ? labName(s, rival.id) : 'A rival';
  const haveChat = s.products.some((p) => p.kind === 'chat' && p.active);
  return {
    id: 'chat_moment',
    copy: 'chat_rival',
    tone: 'milestone',
    hype: 3,
    vars: { company: s.company.name, lab },
    stats: [
      { label: 'Lab', value: lab },
      { label: 'Launched', value: formatDate(day), num: true },
      { label: 'Your chat product', value: haveChat ? 'Live' : 'None yet' },
      { label: 'Days since founding', value: num(s.day), num: true },
    ],
  };
}

function buildArr(s: GameState): Beat {
  const live = s.products.filter((p) => p.active);
  const users = live.reduce((a, p) => a + p.users, 0);
  return {
    id: 'arr_1m',
    copy: 'arr_1m',
    tone: 'milestone',
    hype: 6,
    vars: { company: s.company.name },
    stats: [
      { label: 'Annual revenue', value: formatMoney(annualRevenue(s)), num: true },
      { label: 'Live products', value: num(live.length), num: true },
      { label: 'Users', value: num(users), num: true },
      { label: 'Days since founding', value: num(s.day), num: true },
    ],
  };
}

function buildArena1(s: GameState, rows: ArenaRow[]): Beat {
  const top = rows[0];
  const next = rows[1];
  const elo = num(Math.round(top.elo));
  return {
    id: 'first_arena_1',
    copy: 'first_arena_1',
    tone: 'triumph',
    hype: 8,
    vars: { company: s.company.name, model: top.modelName, elo, lab: next?.name ?? 'the field' },
    stats: [
      { label: 'Model', value: top.modelName },
      { label: 'Elo', value: elo, num: true },
      { label: 'Next best lab', value: next?.name ?? 'Nobody' },
      { label: 'Days since founding', value: num(s.day), num: true },
    ],
  };
}

function buildSota(s: GameState, hit: SotaHit): Beat {
  const bench = benchmarkById(hit.benchId)?.name ?? hit.benchId;
  return {
    id: 'first_sota',
    copy: 'first_sota',
    tone: 'triumph',
    hype: 7,
    vars: { company: s.company.name, model: hit.model.name, benchmark: bench },
    stats: [
      { label: 'Model', value: hit.model.name },
      { label: 'Benchmark', value: bench },
      { label: 'Our score', value: `${hit.ours.toFixed(1)}%`, num: true },
      { label: 'Previous best', value: `${hit.prev.toFixed(1)}%`, num: true },
    ],
  };
}

function buildBeatLab(s: GameState, c: Competitor, best: Model): Beat {
  const lab = labInfo(s, c.id)?.name ?? c.id;
  const theirModel = c.model!;
  const ours = best.overall.toFixed(1);
  const theirs = theirModel.overall.toFixed(1);
  return {
    id: `beat_lab.${c.id}`,
    copy: 'beat_lab',
    tone: 'triumph',
    hype: 4,
    vars: { company: s.company.name, lab, model: best.name, labModel: theirModel.name, ours, theirs },
    stats: [
      { label: 'Our best model', value: best.name },
      { label: 'Our overall', value: ours, num: true },
      { label: `${lab} flagship`, value: theirModel.name },
      { label: `${lab} overall`, value: theirs, num: true },
    ],
  };
}

function buildIpo(s: GameState): Beat {
  const valuation = formatMoney(s.finance.valuation);
  return {
    id: 'ipo',
    copy: 'ipo',
    tone: 'triumph',
    hype: 8,
    vars: { company: s.company.name, valuation },
    stats: [
      { label: 'Valuation', value: valuation, num: true },
      { label: 'Share price', value: `$${s.company.stockPrice.toFixed(2)}`, num: true },
      { label: 'Annual revenue', value: formatMoney(annualRevenue(s)), num: true },
      { label: 'Days since founding', value: num(s.day), num: true },
    ],
  };
}

function buildTrillion(s: GameState): Beat {
  const best = bestPlayerModel(s);
  const valuation = formatMoney(s.finance.valuation);
  return {
    id: 'valuation_1t',
    copy: 'valuation_1t',
    tone: 'triumph',
    hype: 10,
    vars: { company: s.company.name, valuation },
    stats: [
      { label: 'Valuation', value: valuation, num: true },
      { label: 'Annual revenue', value: formatMoney(annualRevenue(s)), num: true },
      { label: 'Best overall', value: best ? best.overall.toFixed(1) : '-', num: true },
      { label: 'Days since founding', value: num(s.day), num: true },
    ],
  };
}

function buildLoss(s: GameState, top: ArenaRow, held: number): Beat {
  const best = bestPlayerModel(s);
  return {
    id: 'lost_arena_1',
    copy: 'lost_arena_1',
    tone: 'loss',
    hype: -5,
    vars: { company: s.company.name, lab: top.name, model: top.modelName, days: num(held) },
    stats: [
      { label: 'New number one', value: top.name },
      { label: 'Their Elo', value: num(Math.round(top.elo)), num: true },
      { label: 'Days at number one', value: num(held), num: true },
      { label: 'Your Elo now', value: best ? num(Math.round(best.elo)) : '-', num: true },
    ],
  };
}

/** Every beat that is earned right now, shown or not, in priority order. Cheap checks only; stats are built lazily. */
function earnedCandidates(s: GameState, rows: ArenaRow[]): Candidate[] {
  const out: Candidate[] = [];
  const best = bestPlayerModel(s);
  const top = rows[0];

  if (s.stats.modelsTrained >= 1 && s.models.length > 0) out.push({ id: 'first_model', build: () => buildFirstModel(s) });
  if (s.products.length > 0) out.push({ id: 'first_product', build: () => buildFirstProduct(s) });
  if ('chatMoment' in s.flags) out.push({ id: 'chat_moment', build: () => buildChat(s) });
  if (annualRevenue(s) >= MILLION) out.push({ id: 'arr_1m', build: () => buildArr(s) });
  // Needs a rival on the board: being number one of one is not a contest.
  if (top?.isPlayer && best && rows.length >= 2) out.push({ id: 'first_arena_1', build: () => buildArena1(s, rows) });

  const sota = findUnannouncedSota(s);
  if (sota) out.push({ id: 'first_sota', build: () => buildSota(s, sota) });

  if (best) {
    // Only labs near the top count, so beating a weak early lab is not a takeover.
    let rivalTop = -Infinity;
    for (const c of s.competitors) if (c.active && c.model && !c.human) rivalTop = Math.max(rivalTop, c.model.overall);
    for (const c of s.competitors) {
      if (!c.active || !c.model || c.human) continue;
      if (c.model.overall < rivalTop - 6) continue;
      if (best.overall > c.model.overall) out.push({ id: `beat_lab.${c.id}`, build: () => buildBeatLab(s, c, best) });
    }
  }

  if (s.company.isPublic) out.push({ id: 'ipo', build: () => buildIpo(s) });
  if (s.finance.valuation >= TRILLION) out.push({ id: 'valuation_1t', build: () => buildTrillion(s) });

  const held = s.flags[ARENA_HELD] as number | undefined;
  if (held !== undefined && held >= LOSS_MIN_DAYS && top && !top.isPlayer) {
    out.push({ id: 'lost_arena_1', build: () => buildLoss(s, top, held) });
  }
  return out;
}

function fire(s: GameState, beat: Beat, rng: Rng): void {
  const copy = MOMENT_COPY[beat.copy];
  const moment: Moment = {
    id: beat.id,
    title: fill(rng.pick([...copy.title]), beat.vars),
    subtitle: fill(rng.pick([...copy.subtitle]), beat.vars),
    stats: beat.stats,
    tone: beat.tone,
    day: s.day,
  };
  s.flags[FLAG_PREFIX + beat.id] = s.day;
  s.flags[LAST_FLAG] = s.day;
  s.pendingMoment = moment;
  const newsKind = beat.tone === 'triumph' ? 'milestone' : beat.tone === 'milestone' ? 'good' : 'bad';
  for (const line of copy.news) pushNews(s, fill(line, beat.vars), newsKind);
  s.company.hype = clamp(s.company.hype + beat.hype, 0, 100);
}

/** Detect newly earned moments and set s.pendingMoment (one at a time; extras wait for the next day). */
export function momentsTick(s: GameState, rng: Rng): void {
  const rows = arenaLeaderboard(s);
  trackArena(s, rows);
  const earned = earnedCandidates(s, rows);

  // A loaded save: beats that are already true are marked shown, silently. Only new progress fires.
  if (s.flags[INIT_FLAG] === undefined) {
    for (const c of earned) s.flags[FLAG_PREFIX + c.id] = s.day;
    s.flags[INIT_FLAG] = s.day;
    return;
  }

  if (s.pendingMoment) return;
  const last = s.flags[LAST_FLAG] as number | undefined;
  if (last !== undefined && s.day - last < COOLDOWN_DAYS) return;
  const next = earned.find((c) => !isDone(s, c.id));
  if (next) fire(s, next.build(), rng);
}

export const handlers: ActionHandlers = {
  dismissMoment: (s) => {
    s.pendingMoment = null;
  },
};
