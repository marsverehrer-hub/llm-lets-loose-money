// v19: the rival "brain". Each week a lab picks actions with the same economy as the player: raise, buy or rent GPUs,
// hire, research, buy data, train (real scaling physics), release (closed or open), publish data, price. Package B2.
import type { Capabilities, Competitor, CompetitorDef, DataKind, DatasetDef, GameState, Id, ResearchNode, RivalLab, RivalModel, Rng, RoleId } from '../../types';
import { KIND_OF } from '../../types';
import { GPUS, type GpuSpec } from '../../data/gpus';
import { RESEARCH } from '../../data/research';
import { DATASETS } from '../../data/datasets';
import { COMPETITORS } from '../../data/competitors';
import { reachAgi } from '../endings'; // v19 endings
import { ROLES } from '../../data/roles';
import { lerp, calendarYear, clamp, formatMoney, pushNews, yearOf } from '../../util';
import { emptyCaps, lossToQuality } from '../capabilities';
import { chinchillaLoss, effectiveTokens } from '../trainingMath';
import { consumeGpuAllocation, gpuAllocationLeft } from '../scaleLimits';
import { marketSalary } from '../staff';
import { SEGMENTS, mtokPerUserDay } from '../market';
import { researchCost, RESEARCH_TUNING } from '../research';
import { hashUniform, trueQualityOf } from '../data';
import { RIVAL_TUNING } from './tuning';
import { planMods } from './plans';

const T = RIVAL_TUNING;

/** The lab record for a definition (undefined before rivalLabs has created it). */
function labOf(s: GameState, def: CompetitorDef): RivalLab | undefined {
  return s.rivals?.find((l) => l.id === def.id);
}

function compOf(s: GameState, id: Id): Competitor | undefined {
  return s.competitors.find((c) => c.id === id);
}

function gpuOf(id: Id): GpuSpec | undefined {
  return GPUS.find((g) => g.id === id);
}

/** The newest GPU type on sale this year with the most FLOPs (what the lab buys). */
function bestGpu(year: number): GpuSpec | undefined {
  let best: GpuSpec | undefined;
  for (const g of GPUS) if (g.unlockYear <= year && (!best || g.pflops >= best.pflops)) best = g;
  return best;
}

/** Sum of f over every GPU the lab holds, rented and owned together. */
function fleetSum(lab: RivalLab, f: (g: GpuSpec, n: number) => number): number {
  let total = 0;
  for (const [id, n] of Object.entries(lab.gpusRented)) {
    const g = gpuOf(id);
    if (g) total += f(g, n);
  }
  for (const [id, n] of Object.entries(lab.gpusOwned)) {
    const g = gpuOf(id);
    if (g) total += f(g, n);
  }
  return total;
}

function logLab(s: GameState, lab: RivalLab, text: string): void {
  lab.log.push({ day: s.day, text });
  if (lab.log.length > T.LOG_CAP) lab.log.splice(0, lab.log.length - T.LOG_CAP);
}

/** Revenue per day from the competitor's users and prices: the same formula as the competitor valuation. */
function revenuePerDay(s: GameState, c: Competitor | undefined): number {
  if (!c) return 0;
  const year = yearOf(s.day);
  let daily = 0;
  for (const seg of SEGMENTS) {
    const users = c.users[seg];
    const price = c.prices[KIND_OF[seg]];
    daily += seg === 'developer' ? users * mtokPerUserDay('developer', year) * price : (users * price) / 30;
  }
  return daily;
}

/** Running costs per week: rented GPUs, owned GPUs (power and ops) and payroll. */
function weeklyCosts(s: GameState, lab: RivalLab): number {
  let cost = 0;
  for (const [id, n] of Object.entries(lab.gpusRented)) cost += (gpuOf(id)?.rentPerDay ?? 0) * 7 * n;
  for (const [id, n] of Object.entries(lab.gpusOwned)) {
    const g = gpuOf(id);
    if (g) cost += n * (g.powerKw * 24 * 7 * T.POWER_PRICE_PER_KWH + (g.buyPrice * T.OPS_SHARE_PER_YEAR) / 52);
  }
  const staff: [keyof RivalLab['staff'], RoleId][] = [
    ['research', 'researcher'],
    ['engineering', 'engineer'],
    ['safety', 'safety'],
    ['sales', 'sales'],
  ];
  for (const [key, role] of staff) cost += (lab.staff[key] * marketSalary(s, role)) / 52;
  return cost;
}

/**
 * Equity or a donation when runway is short. Frontier, startup and chip labs raise on valuation; big tech gets a parent
 * top-up, sovereigns a state grant, open labs a donation. Returns nothing; updates cash, totalRaised and the log.
 */
function raiseWeek(s: GameState, lab: RivalLab, def: CompetitorDef, c: Competitor | undefined, rng: Rng, burn: number): void {
  const runway = burn > 0 ? lab.cash / burn : Infinity;
  const key = `rivalRaise.${def.id}`;
  const last = s.flags[key];
  // Marquee labs, big tech and sovereigns always find money when they hit zero (a down round, the parent, the state).
  const rescue = lab.cash < 0 && (def.core || def.kind === 'bigtech' || def.kind === 'sovereign');
  if (!rescue && (runway >= T.RAISE_RUNWAY_WEEKS || (last !== undefined && s.day - last < T.RAISE_GAP_DAYS))) return;
  let amount: number;
  switch (def.kind ?? 'frontier') {
    case 'bigtech':
      amount = T.RAISE_BIGTECH_BASE * 1.3 ** (yearOf(s.day) - 2020);
      break;
    case 'sovereign':
      amount = T.RAISE_SOVEREIGN;
      break;
    case 'open':
      amount = rng.range(T.RAISE_OPEN_MIN, T.RAISE_OPEN_MAX);
      break;
    default:
      amount = Math.max(T.RAISE_MIN, (c?.valuation ?? 0) * T.RAISE_EQUITY_SHARE * (s.market.aiHype / 50));
  }
  if (rescue) amount = Math.max(amount, -lab.cash + burn * T.RAISE_RUNWAY_WEEKS);
  lab.cash += amount;
  lab.totalRaised += amount;
  s.flags[key] = s.day;
  logLab(s, lab, `Raises ${formatMoney(amount)}.`);
  if (amount >= T.RAISE_NEWS_MIN) pushNews(s, `${def.name} raises ${formatMoney(amount)}.`, 'info');
}

/** Compute for the week: open labs rent a fleet sized to a share of cash; the rest buy the best GPU on sale. */
function computeWeek(s: GameState, lab: RivalLab, def: CompetitorDef, mods: ReturnType<typeof planMods>, burn: number): void {
  const g = bestGpu(calendarYear(s.day));
  if (!g) return;
  const runway = burn > 0 ? lab.cash / burn : Infinity;
  if (def.kind === 'open') {
    // Rent up to the fleet that the open budget pays for each week; spending grows only as cash does.
    const target = Math.floor((Math.max(0, lab.cash - burn * T.COMPUTE_RESERVE_WEEKS) * T.OPEN_RENT_SHARE * mods.compute) / (g.rentPerDay * 7));
    const have = lab.gpusRented[g.id] ?? 0;
    if (target > have) lab.gpusRented[g.id] = target;
    return;
  }
  if (runway <= T.COMPUTE_RUNWAY_WEEKS) return;
  // Only cash above a two-year reserve goes on hardware, so a lab grows with its money instead of betting it all.
  const spend = Math.max(0, lab.cash - burn * T.COMPUTE_RESERVE_WEEKS) * T.COMPUTE_SPEND_SHARE * mods.compute;
  const want = Math.floor(spend / g.buyPrice);
  if (want <= 0) return;
  const bought = Math.min(want, Math.floor(gpuAllocationLeft(s, g.id)));
  if (bought > 0) {
    consumeGpuAllocation(s, g.id, bought);
    lab.gpusOwned[g.id] = (lab.gpusOwned[g.id] ?? 0) + bought;
    lab.cash -= bought * g.buyPrice;
    if (bought >= T.NEWS_DELIVERY_GPUS) pushNews(s, `${def.name} takes delivery of ${bought.toLocaleString('en-US')} ${g.name}s.`, 'info');
  }
  // The vendor's allocation ran out: the rest is rented at a markup (one week's premium paid up front).
  const rentedNow = want - bought;
  if (rentedNow > 0) {
    lab.gpusRented[g.id] = (lab.gpusRented[g.id] ?? 0) + rentedNow;
    lab.cash -= rentedNow * g.rentPerDay * 7 * (T.RENT_MARKUP - 1);
  }
}

/** Hiring: with a year of runway, researchers and engineers up to a ratio to the fleet (safety labs add safety staff). */
function hireWeek(s: GameState, lab: RivalLab, def: CompetitorDef, rng: Rng, burn: number): void {
  const runway = burn > 0 ? lab.cash / burn : Infinity;
  if (runway < T.HIRE_RUNWAY_WEEKS) return;
  const gpus = fleetSum(lab, (_g, n) => n);
  const wants: [keyof RivalLab['staff'], RoleId, number][] = [
    ['research', 'researcher', Math.floor(gpus / T.GPUS_PER_RESEARCHER)],
    ['engineering', 'engineer', Math.floor(gpus / T.GPUS_PER_ENGINEER)],
  ];
  if (def.personality === 'safety') wants.push(['safety', 'safety', Math.floor(lab.staff.research / 4)]);
  for (const [key, role, want] of wants) {
    const gap = want - lab.staff[key];
    if (gap <= 0) continue;
    const n = Math.min(gap, rng.int(1, T.HIRE_MAX_PER_WEEK));
    lab.staff[key] += n;
    lab.cash -= n * (ROLES.find((r) => r.id === role)?.hireCost ?? 0);
  }
}

/** The cheapest topic the lab can start now: prerequisites done and the year gate open (same rule as the player). */
function nextTopic(s: GameState, lab: RivalLab): Id | null {
  const year = yearOf(s.day);
  let best: ResearchNode | undefined;
  let bestCost = Infinity;
  for (const n of RESEARCH) {
    if (lab.research.includes(n.id) || !n.prereqs.every((p) => lab.research.includes(p))) continue;
    if (year + RESEARCH_TUNING.EARLY_YEARS < n.minYear) continue;
    const cost = researchCost(n);
    if (cost < bestCost) {
      best = n;
      bestCost = cost;
    }
  }
  return best?.id ?? null;
}

/** Research: staff add points every day; a finished topic is banked and the next one chosen at once. */
function researchWeek(s: GameState, lab: RivalLab): void {
  lab.rp += lab.staff.research * 7;
  lab.researching ??= nextTopic(s, lab);
  const node = RESEARCH.find((n) => n.id === lab.researching);
  if (!node || lab.rp < researchCost(node)) return;
  lab.rp -= researchCost(node);
  lab.research.push(node.id);
  logLab(s, lab, `Finishes research: ${node.name}.`);
  if (node.id === 'agi' && !s.ending) { reachAgi(s, lab.id); pushNews(s, `${COMPETITORS.find((d) => d.id === lab.id)?.name ?? lab.id} announces AGI. Probably.`, 'milestone'); } // v19 endings
  lab.researching = nextTopic(s, lab);
}

/** A dataset the lab holds: the static catalogue or a set another lab published. */
function datasetInfo(s: GameState, id: Id): { tokensB: number; quality: number } | undefined {
  const d = DATASETS.find((x) => x.id === id);
  if (d) return { tokensB: d.tokensB, quality: trueQualityOf(s, d) };
  for (const other of s.rivals ?? []) {
    const p = other.publishedData.find((x) => x.id === id);
    if (p) return { tokensB: p.tokensB, quality: p.quality };
  }
  return undefined;
}

/** Unique tokens (billions) the lab holds, and their token-weighted mean true quality. */
function dataStats(s: GameState, lab: RivalLab): { tokensB: number; quality: number } {
  let tokens = 0;
  let weighted = 0;
  for (const id of new Set(lab.datasets)) {
    const d = datasetInfo(s, id);
    if (!d) continue;
    tokens += d.tokensB;
    weighted += d.tokensB * d.quality;
  }
  return { tokensB: tokens, quality: tokens > 0 ? weighted / tokens : 0.5 };
}

/** Monthly data: buy the best affordable catalogue set; open labs also take permissively published sets. */
function dataWeek(s: GameState, lab: RivalLab, def: CompetitorDef): void {
  const year = calendarYear(s.day);
  // A new lab starts with the free public sets of its year (the same ones a new player can download).
  if (lab.datasets.length === 0) {
    for (const d of DATASETS) if (d.cost === 0 && d.unlockYear <= year && !d.requiresResearch && d.acquisition !== 'userdata' && d.acquisition !== 'partnership') lab.datasets.push(d.id);
  }
  if (Math.floor(s.day / 7) % 4 !== 0) return;
  const budget = lab.cash * T.DATA_BUY_SHARE;
  let best: DatasetDef | undefined;
  let bestScore = -1;
  for (const d of DATASETS) {
    if (lab.datasets.includes(d.id) || d.unlockYear > year || d.cost > budget) continue;
    if (d.requiresResearch && !lab.research.includes(d.requiresResearch)) continue;
    if (d.acquisition === 'userdata' || d.acquisition === 'partnership') continue;
    const score = d.tokensB * trueQualityOf(s, d);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  if (best) {
    lab.cash -= best.cost;
    lab.datasets.push(best.id);
    logLab(s, lab, `Buys ${best.name}.`);
  }
  if (def.kind !== 'open') return;
  let pick: { id: Id; name: string; score: number } | undefined;
  for (const other of s.rivals ?? []) {
    if (other.id === lab.id) continue;
    for (const p of other.publishedData) {
      if (p.license !== 'permissive' || lab.datasets.includes(p.id)) continue;
      const score = p.tokensB * p.quality;
      if (!pick || score > pick.score) pick = { id: p.id, name: p.name, score };
    }
  }
  if (pick) {
    lab.datasets.push(pick.id);
    logLab(s, lab, `Takes ${pick.name} from the open hub.`);
  }
}

/** Once a year, a lab may publish a slice of its own data (open labs publish permissively). */
function publishWeek(s: GameState, lab: RivalLab, def: CompetitorDef, rng: Rng, mods: ReturnType<typeof planMods>): void {
  const year = calendarYear(s.day);
  const key = `rivalPub.${def.id}`;
  if ((s.flags[key] ?? 0) >= year) return;
  s.flags[key] = year;
  if (!rng.chance(clamp((def.openBias ?? 0) + mods.open, 0, 1))) return;
  const { tokensB, quality } = dataStats(s, lab);
  if (tokensB <= 0) return;
  const kind: DataKind = rng.pick(['web', 'code', 'synthetic'] as DataKind[]);
  const license = def.kind === 'open' ? 'permissive' : 'noncommercial';
  const id = `${def.id}-pub-${year}`;
  const name = `${def.name} ${year} ${rng.pick(['Crawl', 'Corpus', 'Dump'])}`;
  const tokens = tokensB * rng.range(T.PUBLISH_MIN_SHARE, T.PUBLISH_MAX_SHARE);
  lab.publishedData.push({ id, name, tokensB: tokens, quality: clamp(quality + rng.normal(0, 0.03), 0.1, 0.95), kind, day: s.day, license });
  pushNews(s, `${def.name} publishes ${name}: ${tokens.toFixed(1)}B tokens, ${license}.`, 'info');
  logLab(s, lab, `Publishes ${name}.`);
}

/** Training: start a run sized to the budget (Chinchilla D = 20N, capped by memory and by the data), then advance it. */
function trainWeek(s: GameState, lab: RivalLab, def: CompetitorDef, rng: Rng): void {
  if (lab.ready) return; // a finished run waits to ship
  const perDayOf = (): number => fleetSum(lab, (g, n) => n * g.pflops) * T.TRAINING_SHARE * 1e15 * 86400 * T.EFFICIENCY;
  if (!lab.run) {
    const perDay = perDayOf();
    if (perDay <= 0) return;
    const days = def.personality === 'chaos' ? rng.range(T.CHAOS_DAYS_MIN, T.CHAOS_DAYS_MAX) : (T.RUN_DAYS[def.personality] ?? 60);
    const budget = perDay * days;
    const { tokensB: uniqueB, quality } = dataStats(s, lab);
    const memCapB = (fleetSum(lab, (g, n) => n * (g.memGB ?? 0)) * 1e9 * T.MEMORY_FRACTION) / T.BYTES_PER_PARAM / 1e9;
    const paramsB = Math.min(Math.sqrt(budget / (T.FLOPS_PER_PARAM_TOKEN * T.TOKENS_PER_PARAM)) / 1e9, memCapB);
    const tokensB = Math.min(T.TOKENS_PER_PARAM * paramsB, T.MAX_REPEATS * uniqueB);
    if (paramsB < T.MIN_PARAMS_B || tokensB <= 0) return;
    // A data-limited lab trains a smaller model on what it has (Chinchilla on the data side), never a giant on scraps.
    const sizedB = Math.max(T.MIN_PARAMS_B, Math.min(paramsB, tokensB / T.TOKENS_PER_PARAM));
    const arch = lab.research.includes('moe') ? 'moe' : lab.research.includes('transformers') ? 'dense' : 'lstm';
    lab.run = {
      id: `${def.id}-run-${s.day}`,
      paramsB: sizedB,
      tokensB,
      arch,
      dataQuality: quality,
      flopsDone: 0,
      // Setup, evals and red-teaming take MIN_RUN_DAYS whatever the size, so a lab never ships every week.
      flopsTotal: Math.max(T.FLOPS_PER_PARAM_TOKEN * sizedB * 1e9 * tokensB * 1e9, perDay * T.MIN_RUN_DAYS),
      startedDay: s.day,
    };
    logLab(s, lab, `Starts training ${lab.run.id}: ${sizedB.toFixed(2)}B parameters.`);
  }
  const run = lab.run;
  if (!run) return;
  run.flopsDone += perDayOf() * 7;
  if (run.flopsDone < run.flopsTotal) return;
  const { tokensB: uniqueB } = dataStats(s, lab);
  const loss = chinchillaLoss(run.paramsB, effectiveTokens(run.tokensB, uniqueB), run.dataQuality);
  const base = lossToQuality(loss) * (run.arch === 'lstm' ? T.LSTM_MULT : 1) + Math.min(T.RESEARCH_BONUS_MAX, T.RESEARCH_BONUS_PER_TOPIC * lab.research.length);
  lab.ready = { base, paramsB: run.paramsB, tokensB: run.tokensB, arch: run.arch, dataQuality: run.dataQuality, trainedDay: s.day };
  lab.run = null;
  const c = compOf(s, def.id);
  if (c) c.nextReleaseDay = s.day; // ships today
  logLab(s, lab, `Finishes training: ${run.paramsB.toFixed(2)}B parameters on ${run.tokensB.toFixed(1)}B tokens.`);
}

/** One week of decisions and progress for an active lab. */
export function brainWeek(s: GameState, lab: RivalLab, def: CompetitorDef, rng: Rng): void {
  const mods = planMods(lab);
  const c = compOf(s, def.id);
  // 1. Money: a week of revenue (annual / 52) less running costs.
  const revenue = (revenuePerDay(s, c) * 365) / 52;
  const costs = weeklyCosts(s, lab);
  lab.cash += revenue - costs;
  const burn = costs - revenue;
  // 2. Funding, 3. compute, 4. hiring.
  raiseWeek(s, lab, def, c, rng, burn);
  computeWeek(s, lab, def, mods, burn);
  hireWeek(s, lab, def, rng, burn);
  // 5. Research, 6. data, 7. training, 8. publishing.
  researchWeek(s, lab);
  dataWeek(s, lab, def);
  trainWeek(s, lab, def, rng);
  publishWeek(s, lab, def, rng, mods);
}

/**
 * The quality a rival release should have. `frontierBase` is what the old fixed curve would give (frontier + offset +
 * difficulty + catch-up + boosts). B2 blends in the lab's own trained model (RIVAL_TUNING.ANCHOR).
 */
export function rivalBase(s: GameState, def: CompetitorDef, _c: Competitor, frontierBase: number): number {
  const lab = labOf(s, def);
  if (!lab?.ready) return frontierBase;
  return lerp(lab.ready.base, frontierBase, T.ANCHOR);
}

/**
 * Called at the end of every rival release (competitors.ts releaseModel), after c.model is set. B2 records the
 * RivalModel in the lab's catalogue (real size and data if it came from a run), decides open weights and logs it.
 */
export function onRivalRelease(s: GameState, def: CompetitorDef, c: Competitor): void {
  const lab = labOf(s, def);
  const mdl = c.model;
  if (!lab || !mdl) return;
  const prev: RivalModel | undefined = lab.models[lab.models.length - 1];
  const ready = lab.ready;
  // A trained run gives the real size and data; a point release keeps the previous model's.
  const size = ready
    ? { paramsB: ready.paramsB, tokensB: ready.tokensB, dataQuality: ready.dataQuality, arch: ready.arch, trainedDay: ready.trainedDay, datasetIds: lab.datasets.slice() }
    : prev
      ? { paramsB: prev.paramsB, tokensB: prev.tokensB, dataQuality: prev.dataQuality, arch: prev.arch, trainedDay: prev.trainedDay, datasetIds: prev.datasetIds ?? [] }
      : { paramsB: 1, tokensB: 20, dataQuality: 0.5, arch: 'dense', trainedDay: s.day, datasetIds: [] as Id[] };
  const open = hashUniform(s.seed, `${def.id}:${mdl.name}`) < (def.openBias ?? 0) + planMods(lab).open;
  const license: RivalModel['license'] = open ? (def.kind === 'open' ? 'permissive' : 'noncommercial') : 'research';
  const caps: Capabilities = mdl.caps ?? emptyCaps();
  lab.models.push({
    id: `${def.id}-${mdl.name}`,
    name: mdl.name,
    paramsB: size.paramsB,
    tokensB: size.tokensB,
    dataQuality: size.dataQuality,
    arch: size.arch,
    caps,
    overall: mdl.overall,
    elo: mdl.elo,
    trainedDay: size.trainedDay,
    releasedDay: s.day,
    open,
    license,
    datasetIds: size.datasetIds,
  });
  lab.ready = null;
  logLab(s, lab, `Releases ${mdl.name}${open ? ' with open weights' : ''}.`);
  if (open) pushNews(s, `${def.name} releases the weights of ${mdl.name}.`, 'info');
  // Keep the catalogue short: drop the oldest model, but never the best one.
  while (lab.models.length > T.MODEL_CAP) {
    let best = 0;
    lab.models.forEach((m, i) => {
      if (m.overall > lab.models[best].overall) best = i;
    });
    lab.models.splice(best === 0 ? 1 : 0, 1);
  }
}
