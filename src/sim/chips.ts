// Chip design: the model loop's twin for a chip designer you control. Hidden performance and yield, a band that
// narrows each week, tape-out calls, and a first-silicon reveal that changes the supply chain and your lab's costs.
import type { ChipBlueprint, ChipRun, Company, Fx, GameState, Id } from './types';
import { clamp, pick, rand, randn } from './rand';
import { money } from './run';
import { playerControls, SHARE, suppliers } from './supply';
import { CHIP_CALLS, chipFinalCall, type ChipCtx } from './content/calls';
import { CODENAMES } from './content/flavor';

export const DIES = ['Small die', 'Large die', 'Reticle-busting die'];
export const NODES = ["Last year's process", 'The newest process'];
export const CHIP_WEEKS = [8, 10, 12] as const;
/** What a normal chip programme costs this year. */
export const chipRef = (week: number): number => 30e6 * (1 + week / 96);
/** The best chip on the market, relative to the first-year part. */
export const incumbent = (s: GameState): number => Math.max(1, ...suppliers(s, 'chips').map((c) => c.plant!.gen ?? 1));

interface Means { perf: number; yld: number; sd: number }
/** Expected performance (relative to the incumbent) and yield of a design, before luck. */
export function chipMeans(s: GameState, coId: Id, bp: ChipBlueprint): Means {
  const co = s.companies[coId];
  const perf = (0.85 + 0.25 * bp.node + [0, 0.15, 0.28][bp.die] + bp.memory * (bp.focus === 'train' ? 0.15 : 0.08))
    * Math.pow(bp.budget / chipRef(s.week), 0.2) * (0.9 + 0.2 * co.ceo.skill);
  const yld = clamp(0.9 - 0.2 * bp.node - [0, 0.1, 0.22][bp.die] - 0.05 * bp.memory, 0.3, 0.95);
  return { perf, yld, sd: 0.06 + 0.04 * bp.node + 0.02 * bp.die };
}
/** Good chips per dollar: performance, discounted when too many dies come out broken. */
export const effOf = (perf: number, yld: number): number => perf * Math.sqrt(yld / 0.8);

/** What the design team expects before it starts. */
export function chipForecast(s: GameState, coId: Id, bp: ChipBlueprint): { eff: number; lo: number; hi: number; perf: number; yld: number; discount: number; capacity: number } {
  const m = chipMeans(s, coId, bp);
  const eff = effOf(m.perf, m.yld);
  const co = s.companies[coId];
  const gen = incumbent(s) * eff, old = co?.plant?.gen ?? 1;
  return { eff, lo: eff * (1 - 1.3 * (m.sd + 0.015)), hi: eff * (1 + 1.3 * (m.sd + 0.015)), perf: m.perf, yld: m.yld,
    discount: clamp(1 / (1 + 0.8 * (eff - 0.8)), 0.45, 0.95), capacity: gen > old ? Math.sqrt(Math.min(1.8, gen / old)) : 1 };
}

export function chipCheck(s: GameState, coId: Id, bp: ChipBlueprint, name: string): string | null {
  const co = s.companies[coId];
  if (!co || co.layer !== 'chips' || !playerControls(s, coId)) return 'You need to control a chip designer.';
  if (Object.values(s.chips).some((c) => c.company === coId && c.status === 'running')) return 'This company is already designing a chip.';
  if (!name.trim()) return 'Give the chip a name.';
  if (!(bp.budget > 0) || !CHIP_WEEKS.includes(bp.weeks) || ![0, 1].includes(bp.node) || ![0, 1, 2].includes(bp.die) || ![0, 1].includes(bp.memory)) return 'Not a valid design.';
  if (co.cash < (2 * bp.budget) / bp.weeks) return `${co.name} cannot cover the first weeks of this programme.`;
  return null;
}

export function startChip(s: GameState, coId: Id, bp: ChipBlueprint, name: string): ChipRun {
  const id = 'chip' + s.nextId++;
  const m = chipMeans(s, coId, bp);
  const n = (k: string): number => randn(s.seed, s.week, id, k);
  const run: ChipRun = {
    id, company: coId, name, bp, start: s.week, weeksPlanned: bp.weeks, weeksDone: 0, spent: 0,
    truth: { perf: m.perf * (1 + m.sd * n('perf')), yld: clamp(m.yld + 0.07 * n('yld'), 0.15, 0.98) },
    belief: { perf: m.perf, yld: m.yld }, mods: { perf: 1, yld: 0, reveal: 0 }, sd0: m.sd, revealed: 0,
    call: null, outcome: null, seen: [], flags: [], status: 'running',
  };
  s.chips[id] = run;
  return run;
}

const truePerf = (c: ChipRun): number => c.truth.perf * c.mods.perf;
const trueYld = (c: ChipRun): number => clamp(c.truth.yld + c.mods.yld, 0.1, 0.99);
const revealOf = (c: ChipRun): number => clamp(0.8 * (c.weeksDone / c.weeksPlanned) + c.mods.reveal, 0, 0.95);

/** What the team can see this week: a band on performance and on yield, and the effective value. Safe for the UI. */
export function chipView(s: GameState, c: ChipRun): { perf: number; yld: number; sd: number; eff: number; lo: number; hi: number } {
  const r = c.revealed;
  const perf = truePerf(c) + (c.belief.perf * c.mods.perf - truePerf(c)) * (1 - r);
  const yld = trueYld(c) + (clamp(c.belief.yld + c.mods.yld, 0.1, 0.99) - trueYld(c)) * (1 - r);
  const sd = c.sd0 * (1 - r) + 0.015;
  const eff = effOf(perf, yld);
  return { perf, yld, sd, eff, lo: eff * (1 - 1.3 * sd), hi: eff * (1 + 1.3 * sd) };
}

function applyChipFx(s: GameState, c: ChipRun, fx: Fx[], salt: string, rolls: { p: number; bad: boolean }[]): void {
  const co = s.companies[c.company];
  fx.forEach((f, i) => {
    if (f.k === 'weeks') c.weeksPlanned = Math.max(c.weeksDone, c.weeksPlanned + f.n);
    else if (f.k === 'cap' && f.mult != null) c.mods.perf *= f.mult;
    else if (f.k === 'yield') c.mods.yld += f.n;
    else if (f.k === 'cash') co.cash += f.n;
    else if (f.k === 'reveal') c.mods.reveal += f.frac;
    else if (f.k === 'flag') c.flags.push(f.id);
    else if (f.k === 'kill') c.status = 'dead';
    else if (f.k === 'risk') {
      const bad = rand(s.seed, s.week, c.id, `risk:${salt}:${i}`) < f.p;
      rolls.push({ p: f.p, bad });
      applyChipFx(s, c, bad ? f.bad : f.good, salt + i, rolls);
    }
  });
  c.revealed = Math.max(c.revealed, revealOf(c));
}

export function answerChip(s: GameState, chipId: Id, option: number): void {
  const c = s.chips[chipId], call = c?.call, o = call?.options[option];
  if (!c || !call || !o) return;
  const rolls: { p: number; bad: boolean }[] = [];
  applyChipFx(s, c, o.fx, call.def, rolls);
  c.seen.push(call.def);
  c.call = null;
  c.outcome = { title: call.title, picked: o.label, lines: [], roll: rolls[0] };
  if (c.status === 'dead') s.log.push({ week: s.week, co: c.company, tone: 'bad', text: `${c.name} is cancelled.` });
  if (o.fx.some((f) => f.k === 'ship')) launchChip(s, c);
}

/** The fab layer is a queue: when fabs are the bottleneck and you own none, your tape-out slot can slip. */
const fabSlips = (s: GameState, c: ChipRun): boolean =>
  s.market.binding === 'fab' && !suppliers(s, 'fab').some((f) => playerControls(s, f.id)) && rand(s.seed, s.week, c.id, 'slip') < 0.15;

export function chipsTick(s: GameState): void {
  for (const c of Object.values(s.chips)) {
    if (c.status !== 'running') continue;
    const co = s.companies[c.company];
    if (!co) { c.status = 'dead'; continue; }
    const bill = c.bp.budget / c.bp.weeks;
    co.cash -= bill;
    c.spent += bill;
    c.weeksDone++;
    c.outcome = null;
    if (fabSlips(s, c)) { c.weeksPlanned++; s.log.push({ week: s.week, co: c.company, tone: 'bad', text: `The fab pushed ${c.name}'s wafer slot back a week. Fabs are the bottleneck.` }); }
    c.revealed = Math.max(c.revealed, revealOf(c));
    const ctx: ChipCtx = { s, c, bill, u: (p) => rand(s.seed, s.week, c.id, p) };
    if (c.weeksDone >= c.weeksPlanned) c.call = { def: 'chip.final', ...chipFinalCall(ctx) };
    else {
      const pool = CHIP_CALLS.filter((d) => !c.seen.includes(d.id));
      const def = pool.length ? pick(pool, ctx.u('draw')) : pick(CHIP_CALLS, ctx.u('draw'));
      c.call = { def: def.id, ...def.make(ctx) };
    }
  }
  // Rival chip designers ship a new generation about once a year, so the bar keeps rising.
  for (const co of suppliers(s, 'chips')) {
    if (playerControls(s, co.id) || (s.week + co.id.length * 7) % 48 !== 0 || s.week === 0) continue;
    const gain = 1.12 + 0.1 * co.ceo.skill;
    upgrade(s, co, (co.plant!.gen ?? 1) * gain);
    s.log.push({ week: s.week, co: co.id, tone: 'info', text: `${co.name} ships a new chip generation, about ${Math.round((gain - 1) * 100)}% better.` });
  }
}

/** A better chip means more compute from the same wafers: the company's capacity grows with it. */
function upgrade(s: GameState, co: Company, gen: number): number {
  const old = co.plant!.gen ?? 1;
  if (gen <= old) return 1;
  const ratio = Math.min(1.8, gen / old);
  co.plant!.gen = gen;
  co.plant!.capacity *= Math.sqrt(ratio);
  return Math.sqrt(ratio);
}

export function launchChip(s: GameState, c: ChipRun): void {
  const co = s.companies[c.company];
  const before = chipView(s, c);
  c.revealed = 1;
  c.status = 'shipped';
  const perf = truePerf(c), yld = trueYld(c), eff = effOf(perf, yld);
  const inc = incumbent(s);
  const capacity = upgrade(s, co, inc * eff);
  // A lab that controls the designer gets its own parts at cost: cheaper training or serving, by focus.
  let discount: number | null = null;
  const labs = Object.values(s.companies).filter((x) => x.lab && (x.id === s.labId ? s.helm : false));
  for (const lab of labs) {
    if (!playerControls(s, c.company)) continue;
    const d = clamp(1 / (1 + 0.8 * (eff - 0.8)), 0.45, 0.95);
    lab.lab!.hw[c.bp.focus] = Math.min(lab.lab!.hw[c.bp.focus], d);
    discount = lab.lab!.hw[c.bp.focus];
  }
  s.log.push({ week: s.week, co: co.id, tone: eff >= 1 ? 'good' : 'bad', text: `${co.name} ships ${c.name}: ${eff >= 1 ? `${Math.round((eff - 1) * 100)}% better than the best part on the market` : 'behind the market leader'}.` });
  s.moments.push({ kind: 'chip', chip: c.id, company: co.id, perf, yld, eff, lo: before.lo, hi: before.hi, incumbent: inc, capacity, discount, focus: c.bp.focus });
}

export const chipName = (s: GameState): string => `${pick(CODENAMES, rand(s.seed, s.week, 'chipname', String(Object.keys(s.chips).length)))} silicon`;

// --- Datacenters ---------------------------------------------------------------------------------------------

export const DC_LEAD = 8;
/** Building capacity costs the same as a cloud's own build-out: half a year of the cloud share of the compute price. */
export const dcCost = (s: GameState, units: number): number => units * 26 * SHARE.cloud * s.market.base;
export const dcId = (labId: Id): Id => 'dc-' + labId;

export function datacenterCheck(s: GameState, units: number): string | null {
  if (!(units >= 10)) return 'Build at least 10 compute-weeks a week.';
  if (s.companies[s.labId].cash < dcCost(s, units)) return `That costs ${money(dcCost(s, units))}.`;
  return null;
}

/** Your lab's own datacenter is a cloud it owns outright, so it gets that capacity at cost once it is built. */
export function buildDatacenter(s: GameState, units: number): void {
  const lab = s.companies[s.labId];
  const id = dcId(s.labId);
  lab.cash -= dcCost(s, units);
  if (!s.companies[id]) {
    s.companies[id] = {
      id, name: `${lab.name} Compute`, tagline: 'Our own racks. Our own heat problem.', layer: 'cloud', color: lab.color,
      ceo: { name: 'Facilities Team', style: 'follower', skill: 0.5, ego: 0.2 }, shares: 1e6, price: 1, hist: [1], cash: 0, debt: 0,
      rev: 0, cost: 0, rev8: 0, ni8: 0, revGrowth: 0, negWeeks: 0, raisedAt: -99, payout: 1, pill: false, integrationUntil: 0,
      plant: { capacity: 0, queue: [], posture: 0, capex: 0, blocked: [], decreeUntil: 0 },
    };
    s.holdings.push({ owner: s.labId, company: id, shares: 1e6 });
  }
  s.companies[id].plant!.queue.push({ week: s.week + DC_LEAD, add: units });
  s.log.push({ week: s.week, co: s.labId, tone: 'info', text: `Construction starts on ${units} compute-weeks of your own datacenter. Ready in ${DC_LEAD} weeks.` });
}
