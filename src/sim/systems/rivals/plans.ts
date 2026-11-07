// v19: every 1 January each active lab announces a yearly plan; plans tilt the brain. Package B4.
import type { Competitor, CompetitorDef, GameState, RivalLab, RivalPlanId, Rng } from '../../types';
import { COMPETITORS } from '../../data/competitors';
import { calendarYear, pushNews } from '../../util';

/** How a plan tilts a lab's brain. 1 = neutral. */
export interface PlanMods {
  /** Multiplier on how much compute it buys. */
  compute: number;
  /** Multiplier on its prices. */
  price: number;
  /** Added to openBias. */
  open: number;
  /** Capability skew added to its releases. */
  capSkew: Partial<Record<'reasoning' | 'coding' | 'chat' | 'safety' | 'agentic' | 'knowledge', number>>;
  /** Multiplier on its release cadence (lower = more often). */
  cadence: number;
  /** Multiplier on poaching weight. */
  poach: number;
}

export const NEUTRAL_MODS: PlanMods = { compute: 1, price: 1, open: 0, capSkew: {}, cadence: 1, poach: 1 };

const PLAN_MODS: Record<RivalPlanId, Partial<PlanMods>> = {
  agents: { capSkew: { agentic: 4, coding: 2 } },
  price_war: { price: 0.7 },
  open_everything: { open: 0.5, price: 0.8 },
  safety_first: { capSkew: { safety: 5 }, cadence: 1.2 },
  scale: { compute: 1.6, cadence: 0.85 },
  enterprise: { price: 1.2, capSkew: { safety: 2 } },
  media: { capSkew: { chat: 2 } },
  steady: {},
};

export const PLAN_NAME: Record<RivalPlanId, string> = {
  agents: 'All-in on agents',
  price_war: 'Price war',
  open_everything: 'Open everything',
  safety_first: 'Safety first',
  scale: 'Scale at all costs',
  enterprise: 'Go enterprise',
  media: 'Pivot to media',
  steady: 'Steady as she goes',
};

/** One sentence per plan, for the Field screen. */
export const PLAN_BLURB: Record<RivalPlanId, string> = {
  agents: 'Bets the year on models that act on their own instead of just talking.',
  price_war: 'Undercuts everyone on price and hopes the volume makes up for it.',
  open_everything: 'Puts its weights out in public and dares the rest to match.',
  safety_first: 'Slows the release cadence and makes safety the headline.',
  scale: 'Buys compute as if it is going out of style and ships on a faster beat.',
  enterprise: 'Sells to the big buyers: higher prices, compliance and a lot of meetings.',
  media: 'Points its models at film, music and pictures, and hopes the audience follows.',
  steady: 'Keeps the lights on, ships on schedule and avoids surprises.',
};

// Announcement lines, two per plan. `{lab}` is the lab's name. Picked by hash, so copy never uses the sim RNG.
const COPY: Record<RivalPlanId, string[]> = {
  agents: ['{lab} says this is the year of agents. Chatbots are so last year.', '{lab} wants its models to book things, not just describe them.'],
  price_war: ['{lab} has announced a price war. Its customers are already sending thank-you notes.', '{lab} says it will be the cheapest option in the market, and it has a spreadsheet to prove it.'],
  open_everything: ['{lab} will open its weights to everyone. Its lawyers have asked to be left out of the announcement.', '{lab} plans to put every model on the open hub, and it has invited the press to watch.'],
  safety_first: ['{lab} is slowing down on purpose and wants a medal for it.', '{lab} will ship less often this year, with a very long safety section in every release.'],
  scale: ['{lab} has ordered more GPUs than the parking lot can hold.', '{lab} says bigger is better and has started measuring things in datacenters.'],
  enterprise: ['{lab} is going enterprise. It has hired a man whose only job is to say "compliance" in meetings.', '{lab} will sell to large companies, at large prices, with large amounts of paperwork.'],
  media: ['{lab} is pivoting to media. It has a studio, a logo and no clear idea what a film is.', '{lab} wants to make the models that make the pictures and songs. The musicians are not yet consulted.'],
  steady: ['{lab} has a plan for the year, and the plan is to keep the plan.', '{lab} says it will ship on schedule. The schedule is on a whiteboard in the lobby.'],
};

const PLAN_IDS: RivalPlanId[] = ['agents', 'price_war', 'open_everything', 'safety_first', 'scale', 'enterprise', 'media', 'steady'];

// shortcut: rough annual cost per person and per GPU, used only to estimate runway for the plan choice; the brain's real
// books are the ones that pay out. Upgrade when plans read the brain's own burn figure.
const COST_PER_PERSON = 200_000;
const COST_PER_GPU = 20_000;
/** Overall points behind the arena leader before a lab wants to scale up. */
const DEFICIT_POINTS = 8;
/** Years of runway under which a lab goes steady or enterprise. */
const LOW_RUNWAY_YEARS = 1;

/** Run on 1 January: pick and announce plans for every active lab. */
export function plansYear(s: GameState, rng: Rng): void {
  const year = Math.floor(calendarYear(s.day));
  const leader = arenaLeaderOverall(s);
  for (const lab of s.rivals ?? []) {
    if (lab.status !== 'active' || lab.plan?.year === year) continue; // one plan a year; a newly founded lab announces at once
    const def = COMPETITORS.find((d) => d.id === lab.id);
    if (!def) continue;
    const c = s.competitors.find((x) => x.id === lab.id);
    const id = pickPlan(planWeights(lab, def, c, leader, year), rng);
    lab.plan = { id, year };
    lab.planHistory.push({ id, year });
    const line = COPY[id][hashIndex(`${lab.id}|${year}`, COPY[id].length)].replace('{lab}', def.name);
    pushNews(s, line, 'info');
    lab.log.push({ day: s.day, text: `Plan for ${year}: ${PLAN_NAME[id]}.` });
    if (lab.log.length > 40) lab.log.splice(0, lab.log.length - 40);
  }
}

/** The tilt for a lab's current plan. A lab with no plan yet is neutral. */
export function planMods(lab: RivalLab): PlanMods {
  const plan = lab.plan?.id;
  if (!plan) return { ...NEUTRAL_MODS, capSkew: {} };
  const m = PLAN_MODS[plan];
  return { ...NEUTRAL_MODS, ...m, capSkew: { ...m.capSkew } };
}

/** Weights per plan for one lab: personality first, then the lab's standing, runway and kind. */
function planWeights(lab: RivalLab, def: CompetitorDef, c: Competitor | undefined, leader: number, year: number): Record<RivalPlanId, number> {
  const w = Object.fromEntries(PLAN_IDS.map((id) => [id, 0])) as Record<RivalPlanId, number>;
  if (def.personality === 'chaos') {
    for (const id of PLAN_IDS) w[id] = 1;
    return w;
  }
  w.steady = 1;
  switch (def.personality) {
    case 'price': w.price_war += 4; break;
    case 'open': w.open_everything += 4; break;
    case 'safety': w.safety_first += 4; break;
    case 'hype': w.agents += 2; w.scale += 2; break;
    case 'research': w.scale += 2; w.agents += 2; break;
  }
  const kind = def.kind ?? 'frontier';
  if (kind === 'open') w.open_everything += 4;
  if (kind === 'sovereign') w.enterprise += 4;
  const ours = Math.max(c?.model?.overall ?? 0, ...lab.models.map((m) => m.overall));
  if (leader - ours > DEFICIT_POINTS) w.scale += 3;
  if (runwayYears(lab) < LOW_RUNWAY_YEARS) {
    w.steady += 2;
    w.enterprise += 2;
  }
  if (year >= 2024 && (def.personality === 'hype' || kind === 'bigtech')) w.media += 3;
  return w;
}

function pickPlan(w: Record<RivalPlanId, number>, rng: Rng): RivalPlanId {
  const total = PLAN_IDS.reduce((sum, id) => sum + w[id], 0);
  let x = rng.next() * total;
  for (const id of PLAN_IDS) {
    x -= w[id];
    if (x < 0) return id;
  }
  return 'steady';
}

/** Best overall across the arena: rival labs and released player models. */
function arenaLeaderOverall(s: GameState): number {
  let best = 0;
  for (const c of s.competitors) if (c.active && c.model) best = Math.max(best, c.model.overall);
  for (const m of s.models) if (m.releasedDay !== null && !m.deprecated) best = Math.max(best, m.overall);
  return best;
}

/** Years of cash at the lab's rough annual burn. Infinity when it has no people or GPUs. */
function runwayYears(lab: RivalLab): number {
  const people = lab.staff.research + lab.staff.engineering + lab.staff.safety + lab.staff.sales;
  const gpus = Object.values(lab.gpusRented).reduce((a, b) => a + b, 0) + Object.values(lab.gpusOwned).reduce((a, b) => a + b, 0);
  const burn = people * COST_PER_PERSON + gpus * COST_PER_GPU;
  return burn > 0 ? lab.cash / burn : Infinity;
}

/** Deterministic string hash to an index in [0, n). Keeps cosmetic copy off the sim RNG. */
function hashIndex(key: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}
