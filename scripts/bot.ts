// Scripted "decent player" bot. Used by scripts/simulate.ts, scripts/balance.ts, the tests, and importable in the browser
// for autoplay:  const { botDay } = await import('/scripts/bot.ts'); botDay(__llm.getState())
//
// Strategies (GAME_DESIGN §19, the yardstick for the balance report):
//   frontier    today's bot. Doctrine frontier. The largest pretrain the 45-day budget allows, every product kind.
//   small       doctrine efficient. Pretrains never exceed the small class and are overtrained (40 tokens/param when
//               the data allows). An api line, a Lite api line, chat. Distills a nano from each new teacher. Bids on
//               every contract its models qualify for. Lean headcount.
//   specialist  doctrine specialist. Medium-class bases, domain fine-tunes, bench tuning toward crowns that are close,
//               vertical and grant bids, and the enterprise line.
//   open        doctrine open. Medium and large models, every release in open mode, api and enterprise lines.
// `idle` is not a strategy: botDay(st, true) only answers prompts and incidents (see balance.ts).
import { dispatch } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import type { DoctrineId, EventDef, FleetPriority, GameState, Id, Model, Product, ProductKind, RoleId, Rng, TrainingConfig, WeightClass } from '../src/sim/types';
import { SEGMENT_OF } from '../src/sim/types';
import { EVENTS } from '../src/sim/data/events';
import { CLASS_RANK, classThresholds } from '../src/sim/data/weightClasses';
import { RESEARCH } from '../src/sim/data/research';
import { availableResearch, effectiveResearchCost, isResearched, RESEARCH_TUNING } from '../src/sim/systems/research';
import { TRAINING_TUNING, availableTechniques, datasetTokensOf, estimateTraining } from '../src/sim/systems/training';
import { activeParamsFor, effParamsFor, effectiveTokens, resolveRun } from '../src/sim/systems/trainingMath';
import { availableDatasetsV2, buyDatasetV2, type DatasetRow } from '../src/sim/systems/data';
import { headcount, officeCapacity, dailyPayroll } from '../src/sim/systems/staff';
import { availableGpus, availableDatacenterTiers } from '../src/sim/systems/compute';
import { fleetPriority, previewFleet } from '../src/sim/systems/serving';
import { unlockedProductKinds, defaultPrice, liveLines } from '../src/sim/systems/products';
import { canIpo } from '../src/sim/systems/finance';
import { activeBenchmarks, availableSpecs, isSaturated, productFitFor, specById } from '../src/sim/systems/capabilities';
import { segQuality } from '../src/sim/systems/market';
import { defaultConfig, isOptionUnlocked } from '../src/sim/data/trainingOptions';
import { runIncidentById } from '../src/sim/data/runIncidents';
import { OFFICE_TIERS } from '../src/sim/data/roles';
import { sweepPointsFor, sweepQuote, sweepRunning } from '../src/sim/systems/lab';
import { benchTuneQuote, classBenchRows, weightClassOf } from '../src/sim/systems/classes';
import { bestModelFor } from '../src/sim/systems/contracts';
import { distillQuote } from '../src/sim/systems/derive';
import { calendarYear, yearOf } from '../src/sim/util';

export type BotStrategy = 'frontier' | 'small' | 'specialist' | 'open';
export const BOT_STRATEGIES: BotStrategy[] = ['frontier', 'small', 'specialist', 'open'];

/** Learning rates the bot sweeps once per architecture before its first big run. */
export const BOT_SWEEP_LRS = [0.35, 0.55, 0.75];

/** Each pretrain is sized to about this many days on the current fleet. */
export const BOT_TARGET_DAYS = 45;
/** Chinchilla-ish ratio the bot aims for: tokens = ratio x params (billions). */
const BOT_TOKENS_PER_PARAM = 20;
/** Small bot: overtrained ratio, used when the owned data can supply it. */
export const BOT_OVERTRAIN_TOKENS_PER_PARAM = 40;
/**
 * A new pretrain is planned when its forecast lands within this many points of the incumbent (the best released model in
 * its class). Overall flattens near the top, so demanding a clear win stalls the lab for good (the old +2 lead did, after
 * 2023). The release rule still ships a model only when it beats the best, so the flagship only moves up.
 */
export const BOT_PRETRAIN_TOLERANCE = 2;
/**
 * Once the incumbent reaches this overall, the gate is off and the lab keeps pretraining. 95 is the saturation line the
 * balance report checks (GAME_DESIGN §19: overall should not reach it before 2027). Past it overall flattens, and a lucky
 * flagship sets a bar that no forecast clears, which stalled the old gate. The release rule still ships only a real
 * improvement.
 */
export const BOT_SCALE_CEILING = 95;
/** Small bot: a distilled nano is sized to this share of the nano threshold, and to at most this share of its teacher. */
export const BOT_NANO_SHARE = 0.9;
export const BOT_DISTILL_TEACHER_SHARE = 0.45;
/** Lite line price, as a share of the reference price. */
export const BOT_LITE_PRICE_MULT = 0.4;
/** Specialist bench tuning: a crown counts as close when the rival top is within this many points. */
export const BOT_CROWN_GAP = 4;
/** Specialist bench tunes per unreleased model before it is released or dropped. */
export const BOT_MAX_TUNES_PER_MODEL = 3;
/** Small bot headcount ceiling: lean early, a little more after the cap year. */
export const BOT_SMALL_STAFF_CAP = { early: 40, late: 120, lateYear: 2023 };
/** Event options are dry-run for their worst case below this much cash (see eventChoiceOrder). */
export const BOT_EVENT_CHECK_CASH = 100_000_000;
/** Data is bought in batches: this many sets every this many days, best quality per dollar first. */
export const BOT_DATA_EVERY_DAYS = 30;
export const BOT_DATASETS_PER_MONTH = 3;

const STRATEGY_DOCTRINE: Record<BotStrategy, DoctrineId> = { frontier: 'frontier', small: 'efficient', specialist: 'specialist', open: 'open' };

/** Product kinds each strategy runs (the unlocked ones only). */
const STRATEGY_KINDS: Record<BotStrategy, ProductKind[]> = {
  frontier: ['api', 'chat', 'enterprise'],
  small: ['api', 'chat'],
  specialist: ['api', 'chat', 'enterprise'],
  open: ['api', 'enterprise'],
};

/** Specialisations each strategy fine-tunes for each product kind, best first. Prerequisites come first. Never benchmaxx. */
const SPEC_WANTS: Record<BotStrategy, Partial<Record<ProductKind, string[]>>> = {
  frontier: { api: ['coder', 'agentic_coder'], chat: ['instruct', 'companion'], enterprise: ['reasoner', 'deep_researcher', 'safe_assistant'] },
  small: { chat: ['instruct'] },
  specialist: {
    api: ['coder', 'agentic_coder'],
    chat: ['instruct', 'companion'],
    enterprise: ['reasoner', 'deep_researcher', 'safe_assistant', 'doctor', 'lawyer', 'quant'],
  },
  open: { api: ['coder', 'agentic_coder'], chat: ['instruct', 'companion'], enterprise: ['reasoner', 'deep_researcher', 'safe_assistant'] },
};

/** Research the strategy queues ahead of the cheapest-first default. */
const RESEARCH_GOALS: Partial<Record<BotStrategy, Id[]>> = {
  small: ['instruction_tuning'],
  specialist: ['instruction_tuning', 'code_models', 'chain_of_thought', 'enterprise_ready'],
};

/** Quality-per-dollar score for a dataset: quality, scaled by the log of its size, over the log of its price. */
export function datasetScore(d: { quality: number; tokensB: number; cost: number }): number {
  return (d.quality * Math.log10(10 + d.tokensB)) / Math.log10(10 + d.cost);
}

export function bestReleased(st: GameState): Model | undefined {
  let best: Model | undefined;
  for (const m of st.models) if (m.releasedDay !== null && !m.deprecated && (!best || m.overall > best.overall)) best = m;
  return best;
}

/** Released, non-deprecated models in a weight class at most `cap`, best overall first. */
function releasedUpTo(st: GameState, cap: WeightClass): Model[] {
  return st.models
    .filter((m) => m.releasedDay !== null && !m.deprecated && CLASS_RANK[weightClassOf(st, m)] <= CLASS_RANK[cap])
    .sort((a, b) => b.overall - a.overall);
}

/** Best released model for a product kind: segment quality times the spec's product fit. `cap` limits the class. */
function bestForKind(st: GameState, kind: ProductKind, cap?: WeightClass): Model | undefined {
  const seg = SEGMENT_OF[kind];
  let best: Model | undefined;
  let bestValue = -Infinity;
  for (const m of st.models) {
    if (m.releasedDay === null || m.deprecated) continue;
    if (cap && CLASS_RANK[weightClassOf(st, m)] > CLASS_RANK[cap]) continue;
    const value = segQuality(seg, m.scores, m.overall) * productFitFor(m, kind);
    if (value > bestValue) {
      best = m;
      bestValue = value;
    }
  }
  return best;
}

/** The released model a new pretrain has to beat: the best overall of the strategy's own size class. */
function incumbent(st: GameState, strategy: BotStrategy): Model | undefined {
  if (strategy === 'small') return releasedUpTo(st, 'small')[0];
  if (strategy === 'specialist') return releasedUpTo(st, 'medium')[0];
  return bestReleased(st);
}

/** Product kinds this strategy runs right now (its own kinds that are unlocked). */
function strategyKinds(st: GameState, strategy: BotStrategy): ProductKind[] {
  return unlockedProductKinds(st).filter((k) => STRATEGY_KINDS[strategy].includes(k));
}

/**
 * The next fine-tune the bot wants: the first wanted spec (by product kind, then preference) that the product
 * doesn't already run, that some eligible parent can take, and that hasn't been made from that parent yet.
 * Parents: the near-frontier models for frontier and open, and the models of the strategy's own size class otherwise.
 */
function pickFinetune(st: GameState, strategy: BotStrategy): { parent: Model; specId: string } | null {
  const pool = strategy === 'small' ? releasedUpTo(st, 'small') : strategy === 'specialist' ? releasedUpTo(st, 'medium') : releasedUpTo(st, 'open');
  // Only the near-top parents are worth a fine-tune; a fine-tune of last year's model is wasted compute.
  const top = pool[0]?.overall ?? 0;
  const parents = pool.filter((m) => m.overall >= top - 4);
  const wants = SPEC_WANTS[strategy];
  for (const kind of strategyKinds(st, strategy)) {
    const live = liveLines(st, kind)[0];
    const running = live ? st.models.find((m) => m.id === live.modelId) : undefined;
    for (const specId of wants[kind] ?? []) {
      if (!specById(specId)) continue;
      if (running && (running.specId === specId || (running.lineage ?? []).includes(specId))) continue;
      for (const parent of parents) {
        if (!availableSpecs(st, parent).some((x) => x.id === specId)) continue;
        if (st.models.some((m) => m.parentId === parent.id && m.specId === specId)) continue;
        return { parent, specId };
      }
    }
  }
  return null;
}

/**
 * Informed play: when the lab has a learning-rate sweep for this architecture, use the rate that measured best.
 * With no sweep the default rate stays.
 */
export function informedLr(st: GameState, cfg: TrainingConfig): TrainingConfig {
  const pts = sweepPointsFor(st, cfg.arch);
  if (pts.length === 0) return cfg;
  const best = pts.reduce((b, p) => (p.reading > b.reading ? p : b), pts[0]);
  return { ...cfg, lr: best.lr };
}

/**
 * The bot's run sheet: the default (best unlocked) with a few picks. MoE with 16 experts when unlocked, FP8 when
 * unlocked (fast, a bit unstable at lr 0.5), WSD schedule (default when unlocked). Never anything exotic.
 */
export function botConfig(st: GameState): TrainingConfig {
  const cfg = informedLr(st, defaultConfig(st));
  if (isOptionUnlocked(st, 'moe')) {
    cfg.arch = 'moe';
    cfg.moeExperts = 16;
  }
  if (isOptionUnlocked(st, 'fp8')) cfg.precision = 'fp8';
  if (isOptionUnlocked(st, 'wsd')) cfg.schedule = 'wsd';
  return cfg;
}

/**
 * Raw tokens that give an effective count of `effTokensB` from U owned unique tokens: unique tokens first, then repeats
 * worth half, capped at MAX_EPOCHS passes over the data. Inverse of effectiveTokens.
 */
function rawTokensFor(effTokensB: number, uniqueB: number): number {
  if (effTokensB <= uniqueB) return effTokensB;
  return Math.min(uniqueB * TRAINING_TUNING.MAX_EPOCHS, uniqueB + 2 * (effTokensB - uniqueB));
}

/** Sizing knobs: the tokens-per-parameter target, and a cap on ACTIVE params (the weight class limit). */
export interface SizeOpts {
  tokensPerParam?: number;
  maxActiveB?: number;
}

/**
 * Size a pretrain to about BOT_TARGET_DAYS on the current fleet, at `tokensPerParam` effective tokens per parameter
 * (repeats count half, as the loss sees them; default BOT_TOKENS_PER_PARAM). The bot repeats data only as far as it has
 * to: with U owned unique tokens the largest size at the target ratio is about 2.5 U / 20. Past that the data cannot feed
 * the model, so the size stops there and the run finishes early. `maxActiveB` caps the active parameters (MoE-aware).
 */
export function sizeBotRun(
  st: GameState,
  datasetIds: string[],
  techs: string[],
  cfg: TrainingConfig,
  opts: SizeOpts = {},
): { paramsB: number; tokensB: number } {
  const tpp = opts.tokensPerParam ?? BOT_TOKENS_PER_PARAM;
  const unique = datasetTokensOf(st, datasetIds);
  const maxTokens = unique * TRAINING_TUNING.MAX_EPOCHS;
  // The loss sees effective parameters (MoE: fewer than the total), so the optimal token count follows those.
  const perParam = effParamsFor(1, cfg);
  const tokensFor = (N: number) => Math.max(0.1, rawTokensFor(tpp * perParam * N, unique));
  const daysAt = (N: number) => resolveRun(st, N, tokensFor(N), datasetIds, techs, cfg, 'belief').days;
  // The largest size the data supports at the target ratio, with every epoch used (repeats at half value).
  const maxEff = effectiveTokens(maxTokens, unique);
  const maxN = Math.max(0.05, maxEff / (tpp * perParam));
  let N = maxN;
  if (daysAt(maxN) > BOT_TARGET_DAYS) {
    // Days grow with size at a fixed ratio, so bisect (in log space) for the largest size that still meets the target.
    let lo = Math.log(0.05);
    let hi = Math.log(maxN);
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      if (daysAt(Math.exp(mid)) <= BOT_TARGET_DAYS) lo = mid;
      else hi = mid;
    }
    N = Math.exp(lo);
  }
  if (opts.maxActiveB !== undefined) N = Math.min(N, opts.maxActiveB / activeParamsFor(1, cfg));
  // The sim rejects runs outside its parameter range (10T at most), so a bigger plan would fail every week after it.
  N = Math.min(Math.max(N, TRAINING_TUNING.MIN_PARAMS_B), TRAINING_TUNING.MAX_PARAMS_B);
  return { paramsB: N, tokensB: tokensFor(N) };
}

/** Most techniques a bot run uses: a player toggles the useful ones, not every node in the tree. */
export const BOT_MAX_TECHNIQUES = 6;
/** Smallest overall gain (points) that justifies another technique. */
export const BOT_MIN_TECHNIQUE_GAIN = 0.3;

/**
 * Greedy technique picks: add whichever researched technique raises the predicted overall the most, until the gain
 * is too small or BOT_MAX_TECHNIQUES are in. Diminishing returns in capabilities keep this honest.
 */
export function pickBotTechniques(st: GameState, datasetIds: string[], paramsB: number, tokensB: number, cfg: TrainingConfig): string[] {
  const overallOf = (techs: string[]) => estimateTraining(st, paramsB, tokensB, datasetIds, techs, cfg).overall;
  const chosen: string[] = [];
  const base = overallOf(chosen);
  // Lazy greedy: each candidate keeps its last measured gain, which is an upper bound (gains shrink as techniques pile up).
  // Only the top candidate is re-measured until it is fresh for this round, so a plan costs far fewer estimates than a full
  // scan per round. Candidates that do not clear the minimum gain on their own never enter.
  const pool = availableTechniques(st)
    .map((t) => ({ id: t.id, gain: overallOf([t.id]) - base, round: 0 }))
    .filter((c) => c.gain >= BOT_MIN_TECHNIQUE_GAIN);
  let current = base;
  while (chosen.length < BOT_MAX_TECHNIQUES && pool.length > 0) {
    pool.sort((a, b) => b.gain - a.gain);
    const top = pool[0];
    if (top.round !== chosen.length) {
      top.gain = overallOf([...chosen, top.id]) - current;
      top.round = chosen.length;
      continue;
    }
    if (top.gain < BOT_MIN_TECHNIQUE_GAIN) break;
    chosen.push(top.id);
    current += top.gain;
    pool.shift();
  }
  return chosen;
}

/** Resolve a pending run incident with the first choice that is available (choice 0 is the conservative one). */
function resolveIncidents(st: GameState): void {
  const run = st.training;
  const pending = run?.pendingIncident;
  if (!run || !pending) return;
  if (pending.result === undefined) {
    const def = runIncidentById(pending.defId);
    const idx = def ? def.choices.findIndex((c) => !c.available || c.available(st, run)) : -1;
    dispatch(st, { type: 'resolveRunIncident', choice: Math.max(0, idx) });
  }
  if (st.training?.pendingIncident?.result !== undefined) dispatch(st, { type: 'clearRunIncident' });
}

// ---------------------------------------------------------------------------
// Event policy
// ---------------------------------------------------------------------------

/** A random source that answers every chance() with a fixed outcome, so an option can be run at its worst and its best. */
function forcedRng(s: GameState, outcome: boolean): Rng {
  const base = makeRng(s);
  return { next: base.next, range: base.range, int: base.int, pick: base.pick, normal: base.normal, chance: () => outcome };
}

export interface EventOptionRisk {
  index: number;
  available: boolean;
  /** Lowest cash after the option, over the random outcomes (-Infinity when unavailable). */
  worstCash: number;
}

/**
 * Worst-case cash for each option of the pending event. Each option is dry-run on a copy of the state, once with every
 * random roll going the bad way and once with every roll going the good way; the lower cash is the worst case.
 */
export function eventOptionRisks(st: GameState): EventOptionRisk[] {
  const pending = st.events.pending;
  const def: EventDef | undefined = pending ? EVENTS.find((e) => e.id === pending.defId) : undefined;
  if (!pending || !def) return [];
  return def.choices.map((choice, index) => {
    if (choice.available && !choice.available(st)) return { index, available: false, worstCash: -Infinity };
    let worst = Infinity;
    for (const outcome of [true, false]) {
      const copy = structuredClone(st);
      try {
        choice.effect(copy, forcedRng(copy, outcome));
        worst = Math.min(worst, copy.finance.cash);
      } catch {
        worst = -Infinity;
      }
    }
    return { index, available: true, worstCash: worst };
  });
}

/**
 * The order the bot tries the options of the pending event: the available options whose worst case keeps cash at or
 * above zero, in the event's own order (the settlement comes first when it is affordable). When every option is risky,
 * the least bad one comes first, so the bot settles when it cannot afford the loss.
 */
export function eventChoiceOrder(st: GameState): number[] {
  const pending = st.events.pending;
  const def = pending ? EVENTS.find((e) => e.id === pending.defId) : undefined;
  const inOrder = def ? def.choices.map((_, i) => i) : [0, 1, 2, 3];
  // Above BOT_EVENT_CHECK_CASH no option can take cash below zero (the largest cost in the event data is the $100M
  // option, which is only offered with that much cash), so the dry runs are skipped.
  if (!def || st.finance.cash >= BOT_EVENT_CHECK_CASH) return inOrder;
  const risks = eventOptionRisks(st);
  const avail = risks.filter((r) => r.available);
  const safe = avail.filter((r) => r.worstCash >= 0).map((r) => r.index);
  const risky = avail
    .filter((r) => r.worstCash < 0)
    .sort((a, b) => b.worstCash - a.worstCash)
    .map((r) => r.index);
  return [...safe, ...risky];
}

/** Answers the pending event. Idle keeps the old rule (first option that is available). */
function answerEvent(st: GameState, idle: boolean): void {
  if (!st.events.pending) return;
  const order = idle ? [0, 1, 2, 3] : eventChoiceOrder(st);
  for (const c of order) {
    if (st.events.pending?.result !== undefined) break;
    dispatch(st, { type: 'resolveEvent', choice: c });
  }
  dispatch(st, { type: 'clearEventResult' });
  if (st.events.pending) st.events.pending = null;
}

// ---------------------------------------------------------------------------
// Day steps
// ---------------------------------------------------------------------------

function researchStep(st: GameState, strategy: BotStrategy): void {
  const queued = st.research.queue ?? [];
  for (const id of RESEARCH_GOALS[strategy] ?? []) {
    if (isResearched(st, id) || st.research.current === id || queued.includes(id)) continue;
    dispatch(st, { type: 'queueResearch', nodeId: id });
  }
  // A queued node starts by itself once it is ready; only pick the cheapest topic when nothing queued can start.
  const queueReady =
    !st.research.queuePaused &&
    (st.research.queue ?? []).some((id) => {
      const node = RESEARCH.find((n) => n.id === id);
      return !!node && node.prereqs.every((p) => isResearched(st, p)) && yearOf(st.day) + RESEARCH_TUNING.EARLY_YEARS >= node.minYear;
    });
  if (!st.research.current && !queueReady) {
    const av = availableResearch(st).sort((a, b) => effectiveResearchCost(st, a) - effectiveResearchCost(st, b))[0];
    if (av) dispatch(st, { type: 'setResearch', nodeId: av.id });
  }
}

function dataStep(st: GameState): void {
  if (st.day % BOT_DATA_EVERY_DAYS !== 0) return;
  const ranked = availableDatasetsV2(st)
    .filter((r: DatasetRow) => r.status === 'available')
    .sort((a, b) => datasetScore(b.def) - datasetScore(a.def));
  let bought = 0;
  for (const r of ranked) {
    if (bought >= BOT_DATASETS_PER_MONTH) break;
    if (st.finance.cash > r.def.cost * 6 + 300_000 && buyDatasetV2(st, r.def.id)) bought += 1;
  }
}

function nextBotName(st: GameState): string {
  return `Bot-${(st.flags.botGen = (st.flags.botGen ?? 0) + 1)}`;
}

/** Sizing for the strategy's pretrain: the small bot overtrains inside the small class, the specialist stays medium. */
function pretrainTarget(st: GameState, strategy: BotStrategy): SizeOpts {
  const t = classThresholds(calendarYear(st.day));
  if (strategy === 'small') return { tokensPerParam: BOT_OVERTRAIN_TOKENS_PER_PARAM, maxActiveB: t.small };
  if (strategy === 'specialist') return { maxActiveB: t.medium };
  return {};
}

/**
 * Small bot: distill a nano from the newest teacher when the nano on the market was made from an older one. A distill
 * uses the training slot but no data, and costs a fraction of a pretrain.
 */
function tryNanoDistill(st: GameState): boolean {
  const teacher = bestReleased(st);
  if (!teacher) return false;
  const nano = releasedUpTo(st, 'nano')[0];
  if (nano && nano.trainedDay >= teacher.trainedDay) return false;
  const cfg = botConfig(st);
  const teacherActive = teacher.activeParamsB ?? teacher.paramsB;
  const studentActive = Math.min(classThresholds(calendarYear(st.day)).nano * BOT_NANO_SHARE, teacherActive * BOT_DISTILL_TEACHER_SHARE);
  if (!(studentActive > 0)) return false;
  const paramsB = studentActive / activeParamsFor(1, cfg);
  const q = distillQuote(st, teacher.id, paramsB);
  if (!q.ok || !q.forecast) return false;
  dispatch(st, { type: 'startDistill', teacherId: teacher.id, paramsB, name: nextBotName(st) });
  return true;
}

function planPretrain(st: GameState, strategy: BotStrategy): void {
  const owned = st.data.owned;
  const cfg = botConfig(st);
  const { paramsB, tokensB } = sizeBotRun(st, owned, [], cfg, pretrainTarget(st, strategy));
  // Informed play: before the first big run on an architecture, measure its learning rate (cheap, a few days).
  const sweep = sweepQuote(st, paramsB, tokensB, owned, cfg, BOT_SWEEP_LRS);
  const needSweep = sweepPointsFor(st, cfg.arch).length === 0 && !sweepRunning(st, cfg.arch);
  const affordable = Number.isFinite(sweep.cost) && st.finance.cash > sweep.cost * 10;
  const wantSweep = needSweep && affordable;
  if (wantSweep) dispatch(st, { type: 'runLrSweep', paramsB, tokensB, datasetIds: owned, config: cfg, lrs: BOT_SWEEP_LRS });
  if (wantSweep || sweepRunning(st, cfg.arch)) {
    st.flags.botRetryDay = st.day + (wantSweep ? sweep.days : 1);
    return;
  }
  const techs = pickBotTechniques(st, owned, paramsB, tokensB, cfg);
  const est = estimateTraining(st, paramsB, tokensB, owned, techs, cfg);
  // The bot plans against the lab's forecast mid, not the hidden truth.
  const mid = est.forecast?.mid ?? est.overall;
  const bar = incumbent(st, strategy);
  if (!bar || bar.overall >= BOT_SCALE_CEILING || mid > bar.overall - BOT_PRETRAIN_TOLERANCE) {
    dispatch(st, { type: 'startTraining', name: nextBotName(st), paramsB, tokensB, datasetIds: owned, techniques: techs, config: cfg });
  } else {
    st.flags.botRetryDay = st.day + 7;
  }
}

function trainingStep(st: GameState, strategy: BotStrategy): void {
  // Planning a pretrain is the expensive part, so a skipped plan is retried weekly rather than daily.
  if (st.training || (st.flags.botRetryDay ?? 0) > st.day) return;
  const ft = pickFinetune(st, strategy);
  if (ft) {
    dispatch(st, { type: 'startFinetune', parentId: ft.parent.id, specId: ft.specId });
    return;
  }
  if (strategy === 'small' && tryNanoDistill(st)) return;
  planPretrain(st, strategy);
}

/** Score and owner of the top row of every class leaderboard, keyed `benchId|class`. Built once per step: classBenchRows rebuilds the entrant list on each call. */
interface ClassLeaders {
  tops: Map<string, { score: number; isPlayer: boolean }>;
  /** Benchmarks that are saturated (no crowns on them). */
  saturated: Set<string>;
}
const LEADER_CLASSES: WeightClass[] = ['nano', 'small', 'medium', 'open'];
function classLeaders(st: GameState): ClassLeaders {
  const out: ClassLeaders = { tops: new Map(), saturated: new Set() };
  for (const def of activeBenchmarks(st)) {
    if (isSaturated(st, def.id)) {
      out.saturated.add(def.id);
      continue;
    }
    for (const cls of LEADER_CLASSES) {
      const top = classBenchRows(st, def.id, cls)[0];
      if (top) out.tops.set(`${def.id}|${cls}`, { score: top.score, isPlayer: top.isPlayer });
    }
  }
  return out;
}

/**
 * Specialist: the unreleased model and benchmark where a rival holds the class crown within BOT_CROWN_GAP points.
 * Scores come from the measured benchmark runs (benchRuns), the same numbers the player sees.
 */
function benchTuneTarget(st: GameState, leaders: ClassLeaders): { modelId: Id; benchId: Id } | null {
  let best: { modelId: Id; benchId: Id; gap: number } | null = null;
  for (const m of st.models) {
    if (m.releasedDay !== null || m.deprecated || !m.caps) continue;
    if ((st.classes?.benchTunes ?? []).some((j) => j.modelId === m.id)) continue;
    if ((st.flags[`bot.tunes.${m.id}`] ?? 0) >= BOT_MAX_TUNES_PER_MODEL) continue;
    const cls = weightClassOf(st, m);
    for (const def of activeBenchmarks(st)) {
      if (leaders.saturated.has(def.id)) continue;
      const score = m.benchRuns?.[def.id]?.score;
      if (score === undefined) continue;
      // The crown is the top row of the class leaderboard. Only a rival holding it is worth closing the gap on.
      const top = leaders.tops.get(`${def.id}|${cls}`);
      if (!top || top.isPlayer) continue;
      const gap = top.score - score;
      if (gap <= 0 || gap > BOT_CROWN_GAP) continue;
      if (!best || gap < best.gap) best = { modelId: m.id, benchId: def.id, gap };
    }
  }
  return best ? { modelId: best.modelId, benchId: best.benchId } : null;
}

function benchTuneStep(st: GameState): void {
  const target = benchTuneTarget(st, classLeaders(st));
  if (!target) return;
  const q = benchTuneQuote(st, target.modelId, target.benchId);
  if (!q.ok || st.finance.cash < q.cost * 10) return;
  dispatch(st, { type: 'benchTune', modelId: target.modelId, benchId: target.benchId });
  st.flags[`bot.tunes.${target.modelId}`] = (st.flags[`bot.tunes.${target.modelId}`] ?? 0) + 1;
}

function bidStep(st: GameState, strategy: BotStrategy): void {
  if (strategy !== 'small' && strategy !== 'specialist') return;
  const offers = st.contracts?.offers ?? [];
  if (offers.length === 0) return;
  const pending = new Set((st.contracts?.pending ?? []).map((b) => b.offerId));
  for (const o of offers) {
    if (pending.has(o.id)) continue;
    // Specialists bid on verticals and grants only. Small labs bid on every deal their models qualify for.
    if (strategy === 'specialist' && o.kind !== 'vertical' && o.kind !== 'grant') continue;
    const best = bestModelFor(st, o);
    if (best.qualifies && best.model) dispatch(st, { type: 'bidContract', offerId: o.id, modelId: best.model.id });
  }
}

/** True when the model beats the current class leader on some benchmark (it would take that crown once released). */
function holdsCrownShot(st: GameState, m: Model, leaders: ClassLeaders): boolean {
  const cls = weightClassOf(st, m);
  for (const def of activeBenchmarks(st)) {
    const score = m.benchRuns?.[def.id]?.score;
    if (score === undefined || leaders.saturated.has(def.id)) continue;
    const top = leaders.tops.get(`${def.id}|${cls}`);
    if (!top || score > top.score) return true;
  }
  return false;
}

/** Every spec any product of this strategy is waiting for. */
function wantedSpecs(strategy: BotStrategy): Set<string> {
  return new Set(Object.values(SPEC_WANTS[strategy]).flat());
}

function releaseStep(st: GameState, strategy: BotStrategy): void {
  const wanted = wantedSpecs(strategy);
  const mode = strategy === 'open' ? 'open' : 'full';
  const leaders = strategy === 'specialist' ? classLeaders(st) : { tops: new Map(), saturated: new Set<string>() };
  for (const m of st.models) {
    if (m.releasedDay !== null || m.deprecated) continue;
    const best = bestReleased(st);
    const cls = weightClassOf(st, m);
    const wantedSpec = !!m.specId && wanted.has(m.specId);
    const better = !best || m.overall > best.overall;
    // Small: the best nano or small model on the market is released even when a bigger model is ahead (the Lite line).
    const classBest =
      strategy === 'small' &&
      CLASS_RANK[cls] <= CLASS_RANK.small &&
      !st.models.some((x) => x.releasedDay !== null && !x.deprecated && weightClassOf(st, x) === cls && x.overall >= m.overall);
    const crown = strategy === 'specialist' && holdsCrownShot(st, m, leaders);
    if (wantedSpec || better || classBest || crown) dispatch(st, { type: 'releaseModel', modelId: m.id, mode });
  }
}

/** Keeps each product line of the strategy running the released model that serves it best. */
function productStep(st: GameState, strategy: BotStrategy): void {
  for (const kind of strategyKinds(st, strategy)) {
    const pick = bestForKind(st, kind);
    if (pick) {
      const main = liveLines(st, kind)[0];
      if (!main) dispatch(st, { type: 'launchProduct', kind, name: `Bot ${kind}`, modelId: pick.id, price: defaultPrice(st, kind) });
      else if (main.modelId !== pick.id) dispatch(st, { type: 'updateProduct', productId: main.id, modelId: pick.id });
    }
    if (strategy === 'small' && kind === 'api' && liveLines(st, kind).length >= 1) {
      // The Lite line: the cheapest serving tier, on the best nano (or small) model, priced at a fraction of the reference.
      const lite = bestForKind(st, kind, 'nano') ?? bestForKind(st, kind, 'small');
      const line2: Product | undefined = liveLines(st, kind)[1];
      if (lite && !line2) {
        dispatch(st, {
          type: 'launchProduct',
          kind,
          name: 'Bot api Lite',
          modelId: lite.id,
          price: Math.round(defaultPrice(st, kind) * BOT_LITE_PRICE_MULT * 100) / 100,
        });
      } else if (lite && line2 && line2.modelId !== lite.id) {
        dispatch(st, { type: 'updateProduct', productId: line2.id, modelId: lite.id });
      }
    }
  }
}

function upgradeOfficeIfAffordable(st: GameState, cash: number): void {
  const idx = OFFICE_TIERS.findIndex((o) => o.id === st.company.officeTierId);
  const next = OFFICE_TIERS[idx + 1];
  if (next && cash > next.cost * 4) dispatch(st, { type: 'upgradeOffice', tierId: next.id });
}

function staffStep(st: GameState, strategy: BotStrategy, cash: number, net: number): void {
  // Grow while runway is healthy
  const runwayOk = cash > dailyPayroll(st) * 365 * 1.5 || net > 0;
  if (st.day % 7 !== 0 || !runwayOk) return;
  const roles: RoleId[] = ['researcher', 'researcher', 'engineer', 'safety', 'sales', 'marketing'];
  const role = roles[((st.day / 7) % roles.length) | 0];
  if (strategy === 'small') {
    // Lean: a couple of hires a week up to the cap, never a hiring spree.
    const cap = calendarYear(st.day) < BOT_SMALL_STAFF_CAP.lateYear ? BOT_SMALL_STAFF_CAP.early : BOT_SMALL_STAFF_CAP.late;
    const hc = headcount(st);
    if (hc >= cap) return;
    const n = Math.min(2, cap - hc);
    if (hc + n > officeCapacity(st)) upgradeOfficeIfAffordable(st, cash);
    else dispatch(st, { type: 'hire', role, count: n });
    return;
  }
  if (headcount(st) + 2 > officeCapacity(st)) {
    upgradeOfficeIfAffordable(st, cash);
  } else {
    const n = Math.max(1, Math.floor(headcount(st) * 0.05));
    dispatch(st, { type: 'hire', role, count: n });
  }
}

/** A run this big (active params, B) is worth giving the whole fleet to, when bursting serving stays cheap. */
export const BOT_TRAIN_MIN_PARAMS_B = 10;
/** Training priority only when the burst bill it implies stays under this share of today's revenue. */
export const BOT_TRAIN_BURST_REVENUE_SHARE = 0.25;

/** Fleet priority (GAME_DESIGN §21.1): serving by default. Training takes every own GPU while a big run is active and bursting all serving is cheap. */
function fleetPriorityStep(st: GameState): void {
  const bigRun = !!st.training && st.training.paramsB >= BOT_TRAIN_MIN_PARAMS_B;
  const burstIfTraining = previewFleet(st, 'training').burstCostPerDay;
  const cheap = burstIfTraining <= BOT_TRAIN_BURST_REVENUE_SHARE * Math.max(0, st.finance.dailyRevenue);
  const want: FleetPriority = bigRun && cheap ? 'training' : 'serving';
  if (fleetPriority(st) !== want) dispatch(st, { type: 'setFleetPriority', priority: want });
}

function computeStep(st: GameState, cash: number): void {
  fleetPriorityStep(st);
  // Compute: rent newest GPU when rich, build datacenter when very rich
  if (st.day % 7 !== 0) return;
  const gpus = availableGpus(st);
  const newest = gpus[gpus.length - 1];
  const rentNow = Object.entries(st.compute.rented).reduce((a, [id, n]) => a + n * (gpus.find((g) => g.id === id)?.rentPerDay ?? 0), 0);
  // A lab with less than a year of cash at its net burn stops adding rent on its cash, and hands back the excess (most
  // expensive first). Without this the cash term kept renting while the cash lasted, and a bot ran out of money in a bad
  // seed (v1.0 tuning). Early labs burn cash too but have years of runway, so they keep training.
  const netBurn = st.finance.dailyExpenses - st.finance.dailyRevenue;
  const shortRunway = netBurn > 0 && cash < 365 * netBurn;
  const desired = 0.3 * st.finance.dailyRevenue + (shortRunway ? 0 : Math.max(0, cash) / 1500);
  if (newest && rentNow < desired * 0.8) {
    const n = Math.floor((desired - rentNow) / newest.rentPerDay);
    if (n > 0) dispatch(st, { type: 'rentGpus', gpuId: newest.id, count: Math.min(n, 100000) });
  } else if (shortRunway && rentNow > desired * 1.2) {
    let excess = rentNow - desired;
    for (const g of [...gpus].sort((a, b) => b.rentPerDay - a.rentPerDay)) {
      const k = Math.min(st.compute.rented[g.id] ?? 0, Math.floor(excess / g.rentPerDay));
      if (k > 0) {
        dispatch(st, { type: 'rentGpus', gpuId: g.id, count: -k });
        excess -= k * g.rentPerDay;
      }
    }
  }
  const tiers = availableDatacenterTiers(st);
  const t = tiers[tiers.length - 1];
  if (t && cash > Math.max(5_000_000, t.buildCost * 5) && st.compute.datacenters.filter((d) => d.tierId === t.id).length < 2) {
    dispatch(st, { type: 'buildDatacenter', tierId: t.id, name: `DC-${st.compute.datacenters.length + 1}` });
  }
  for (const dc of st.compute.datacenters) {
    if (dc.buildDaysLeft > 0 || !newest || cash < 5_000_000) continue;
    const tier = tiers.find((x) => x.id === dc.tierId);
    const used = Object.values(dc.gpus).reduce((a, b) => a + b, 0);
    const free = (tier?.maxGpus ?? 0) - used;
    const n = Math.min(free, Math.floor((cash * 0.2) / newest.buyPrice));
    if (n > 0) dispatch(st, { type: 'buyGpus', datacenterId: dc.id, gpuId: newest.id, count: n });
  }
}

/**
 * One day of play. `idle` only answers prompts (events, incidents, reveals, moments) and does nothing else.
 * `strategy` picks the playstyle; the default is today's frontier bot.
 */
export function botDay(st: GameState, idle = false, strategy: BotStrategy = 'frontier'): void {
  // Eval-day reveals pause the sim until dismissed. The bot reads them and moves on.
  if (st.pendingReveal) dispatch(st, { type: 'dismissReveal' });
  // Aha moments are full-window beats that pause the sim. The bot reads them and moves on.
  if (st.pendingMoment) dispatch(st, { type: 'dismissMoment' });
  // Events: the bot never takes an option whose worst case leaves cash below zero (idle keeps the old first-available rule).
  answerEvent(st, idle);
  // Run incidents pause the sim, so they are answered even when the bot is idle.
  resolveIncidents(st);
  if (idle) return;
  // The lab's focus is picked once, early (GAME_DESIGN §19.1).
  if (st.company.doctrine === undefined) dispatch(st, { type: 'setDoctrine', doctrine: STRATEGY_DOCTRINE[strategy] });
  const cash = st.finance.cash;
  const net = st.finance.dailyRevenue - st.finance.dailyExpenses;

  // Funding
  if (st.finance.pendingOffer) dispatch(st, { type: 'acceptOffer' });
  if (!st.company.isPublic && canIpo(st).ok) dispatch(st, { type: 'ipo' });

  researchStep(st, strategy);
  dataStep(st);
  // Training: fine-tune a wanted specialisation when one is available, otherwise distill (small) or pre-train.
  trainingStep(st, strategy);
  bidStep(st, strategy);
  if (strategy === 'specialist') benchTuneStep(st);
  releaseStep(st, strategy);
  if (bestReleased(st)) productStep(st, strategy);
  staffStep(st, strategy, cash, net);
  computeStep(st, cash);
}
