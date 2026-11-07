// v19: events about rival labs' yearly plans (counter moves, reactions). Package B4. Follows the eventsV2 house rules
// (tests/rivals-plans.test.ts): hints show tangible things only, results carry no stat numbers.
// An event fires only while a lab's plan aims at the player. The lab is found from its plan, so body and effect agree.
import type { Competitor, CompetitorDef, EventDef, GameState, ProductKind, RivalPlanId, Segment, Star } from '../types';
import { KIND_OF } from '../types';
import { COMPETITORS } from './competitors';
import { clamp, formatMoney, pushNews } from '../util';
import { labName } from '../systems/labs';
import { STAFF_TUNING } from '../systems/staff';
import {
  bestReleasedOverall,
  bump,
  capAtCash,
  chainWeight,
  clearChain,
  cutStaff,
  hasReleasedModel,
  liveProducts,
  morale,
  safeCost,
  scaleUsers,
  scaledCost,
  scheduleChain,
  spend,
} from './eventKit';

const $ = formatMoney;
const TARGET_FLAG = 'plan.target';
const REACT_FLAG = 'plan.react';
const SEGMENTS: Segment[] = ['consumer', 'developer', 'enterprise'];
const KIND_NOUN: Record<ProductKind, string> = { chat: 'chat', api: 'API', enterprise: 'enterprise seat' };

interface Aim {
  def: CompetitorDef;
  c: Competitor;
  index: number;
}

/**
 * The first active lab whose plan is `plan`, or undefined. Stores its COMPETITORS index in flags so the copy can name it.
 * Deterministic from state, so calling it again (in weight, body or effect) gives the same lab.
 */
function aimedAt(s: GameState, plan: RivalPlanId): Aim | undefined {
  for (const [index, def] of COMPETITORS.entries()) {
    const lab = s.rivals?.find((l) => l.id === def.id);
    const c = s.competitors.find((x) => x.id === def.id);
    if (!lab || !c || !c.active || lab.status !== 'active' || lab.plan?.id !== plan) continue;
    s.flags[TARGET_FLAG] = index;
    return { def, c, index };
  }
  return undefined;
}

/** The product kind a lab sells most to: its home segment. */
function homeKind(c: Competitor): ProductKind {
  let best: Segment = SEGMENTS[0];
  for (const seg of SEGMENTS) if ((c.users[seg] ?? 0) > (c.users[best] ?? 0)) best = seg;
  return KIND_OF[best];
}

function rile(c: Competitor, d: number): void {
  c.rivalry = clamp((c.rivalry ?? 0) + d, 0, 100);
}

/** Lowers the price of every live product of one kind by a share. */
function cutPrices(s: GameState, kind: ProductKind, share: number): void {
  for (const p of liveProducts(s)) if (p.kind === kind) p.price *= 1 - share;
}

const researchers = (s: GameState) => s.staff.roles.researcher.count;
const nameOf = (a: Aim | undefined) => a?.def.name ?? 'A rival lab';

/** The star a counter-offer is about, while it still works for the player. */
function offeredStar(s: GameState): Star | undefined {
  const id = s.events.pending?.starId;
  return s.staff.stars.find((x) => x.id === id && x.hiredDay !== null);
}
const matchCost = (st: Star) => Math.round(st.salary * STAFF_TUNING.MATCH_COST_SHARE);

/** The price-war lab, but only when the player has a live product in its home segment. */
function priceWarAim(s: GameState): Aim | undefined {
  const a = aimedAt(s, 'price_war');
  if (!a) return undefined;
  const kind = homeKind(a.c);
  return liveProducts(s).some((p) => p.kind === kind) ? a : undefined;
}

/** The lab that reacts to an undercut: stored when the chain was scheduled. */
function reactAim(s: GameState): Aim | undefined {
  const index = s.flags[REACT_FLAG];
  const def = index === undefined ? undefined : COMPETITORS[index];
  const c = def && s.competitors.find((x) => x.id === def.id && x.active); // a lab that folded or was bought cannot react
  return def && c ? { def, c, index: index! } : undefined;
}

/** A previous model the player could open: the second newest released one. */
function previousModel(s: GameState) {
  const released = s.models.filter((m) => m.releasedDay !== null).sort((a, b) => (b.releasedDay ?? 0) - (a.releasedDay ?? 0));
  return released[1];
}

/**
 * Rival plans only aim at a player the field has noticed: a released model, and not in the first year. Without this a
 * brand-new garage got poaching raids on day 30.
 */
function noticed(s: GameState): boolean {
  return s.day >= 365 && s.models.some((m) => m.releasedDay !== null);
}

const RAW_EVENTS: EventDef[] = [
  {
    id: 'rival_price_war',
    title: 'A rival starts a price war',
    icon: '💸',
    body: (s) => {
      const a = aimedAt(s, 'price_war');
      const noun = a ? KIND_NOUN[homeKind(a.c)] : 'chat';
      return `${nameOf(a)} has decided this is the year of price. Its ${noun} plans are already cheaper than yours, and it has posted the numbers on a billboard.`;
    },
    weight: (s) => (priceWarAim(s) ? 6 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Match its prices',
        hint: (s) => `Lowers prices on this line. Costs about ${$(safeCost(s, 30_000))}`,
        effect: (s, rng) => {
          const a = aimedAt(s, 'price_war');
          const kind = a ? homeKind(a.c) : 'chat';
          spend(s, safeCost(s, 30_000));
          cutPrices(s, kind, 0.15);
          scaleUsers(s, kind, 1.06);
          if (a && liveProducts(s).some((p) => p.kind === kind && p.price < a.c.prices[kind])) {
            // An undercut: the lab answers a month or two later (the reaction event).
            scheduleChain(s, 'rival_price_react', rng, 30, 60);
            s.flags[REACT_FLAG] = a.index;
            return `Your new prices are lower than ${a.def.name}'s. Its finance team has been asked to look at it again.`;
          }
          return `You matched ${nameOf(a)}. Customers noticed, and the billboard has been quietly taken down.`;
        },
      },
      {
        label: 'Hold our prices',
        hint: 'Keeps your prices. A few users may drift off',
        effect: (s) => {
          const a = aimedAt(s, 'price_war');
          scaleUsers(s, a ? homeKind(a.c) : 'chat', 0.97);
          return 'You held your prices. A few customers wrote long emails about it, and one of them was a poem.';
        },
      },
      {
        label: 'Run a counter-campaign',
        hint: (s) => `Costs about ${$(capAtCash(s, scaledCost(s, 120_000), 0.5))}`,
        effect: (s) => {
          const a = aimedAt(s, 'price_war');
          const kind = a ? homeKind(a.c) : 'chat';
          spend(s, capAtCash(s, scaledCost(s, 120_000), 0.5));
          scaleUsers(s, kind, 1.03);
          bump(s, 'brand', 2);
          return `The campaign ran for six weeks with the slogan "Quality is not a sale." It was not a sale.`;
        },
      },
    ],
  },

  {
    id: 'rival_price_reaction',
    title: 'The price war comes back',
    icon: '📉',
    body: (s) => `${nameOf(reactAim(s))} has seen your new prices and has opinions. Its latest ones are lower still, and it has invited you to a meeting about it.`,
    weight: (s) => (reactAim(s) ? chainWeight(s, 'rival_price_react', 8) : 0),
    cooldownDays: 60,
    choices: [
      {
        label: 'Cut again',
        hint: (s) => `Lowers prices on this line. Costs about ${$(safeCost(s, 60_000))}`,
        effect: (s) => {
          clearChain(s, 'rival_price_react');
          const a = reactAim(s);
          const kind = a ? homeKind(a.c) : 'chat';
          spend(s, safeCost(s, 60_000));
          cutPrices(s, kind, 0.1);
          scaleUsers(s, kind, 1.04);
          return 'You cut again. The meeting was short, and the other side took notes on a napkin.';
        },
      },
      {
        label: 'Let them have the price',
        hint: 'Keeps your prices. A few users may drift off',
        effect: (s) => {
          clearChain(s, 'rival_price_react');
          const a = reactAim(s);
          scaleUsers(s, a ? homeKind(a.c) : 'chat', 0.95);
          return 'You stopped the spiral by not joining it. Some customers left for the cheaper option, and a few came back.';
        },
      },
    ],
  },

  {
    id: 'rival_agent_race',
    title: 'A rival goes all-in on agents',
    icon: '🤖',
    body: (s) => `${nameOf(aimedAt(s, 'agents'))} has bet the year on models that do things instead of talking. Its demo is a model booking a table. Nobody asked for that, and everyone is watching it.`,
    weight: (s) => (aimedAt(s, 'agents') && hasReleasedModel(s) ? 5 : 0),
    cooldownDays: 180,
    choices: [
      {
        label: 'Rush an agentic fine-tune',
        hint: (s) => `Costs about ${$(safeCost(s, 80_000))}`,
        effect: (s) => {
          spend(s, safeCost(s, 80_000));
          morale(s, -2);
          bump(s, 'hype', 2);
          return 'Your team pulls a late night, a fine-tune ships to a few customers, and the demo finally books the table.';
        },
      },
      {
        label: 'Ignore it and keep the roadmap',
        hint: 'Nothing spent. The rival may get the headlines',
        effect: (s) => {
          const a = aimedAt(s, 'agents');
          if (a) rile(a.c, 3);
          return 'You keep the roadmap. The demo goes around the internet for a week, then someone finds out the table was fake.';
        },
      },
    ],
  },

  {
    id: 'rival_open_everything',
    title: 'A rival opens its weights',
    icon: '🔓',
    body: (s) => `${nameOf(aimedAt(s, 'open_everything'))} is about to release a model that is almost as good as yours, and it will be free to download. Its weights are already on a server with a funny name.`,
    weight: (s) => {
      const a = aimedAt(s, 'open_everything');
      if (!a || !hasReleasedModel(s)) return 0;
      return (a.c.model?.overall ?? 0) >= bestReleasedOverall(s) - 5 ? 6 : 0;
    },
    cooldownDays: 180,
    choices: [
      {
        label: 'Compete on quality',
        hint: (s) => `Costs about ${$(safeCost(s, 150_000))}`,
        effect: (s) => {
          spend(s, safeCost(s, 150_000));
          bump(s, 'hype', 1);
          return 'You put the team on the next checkpoint and say nothing about weights. The press asks anyway, and you say "quality."';
        },
      },
      {
        label: 'Open your previous model',
        hint: (s) => (previousModel(s) ? 'Gives away your last model to the open hub' : 'Needs an older model to open'),
        available: (s) => previousModel(s) !== undefined,
        effect: (s) => {
          const m = previousModel(s);
          // shortcut: open weights are a flag until the open hub reads models directly; upgrade when it does.
          if (m) s.flags[`open.${m.id}`] = s.day;
          bump(s, 'brand', 2);
          bump(s, 'reputation', 2);
          return 'Your previous model goes on the open hub. Developers download it before anyone finishes reading the license.';
        },
      },
    ],
  },

  {
    id: 'rival_poach_raid',
    title: 'A rival comes for your researchers',
    icon: '🎯',
    body: (s) => `${nameOf(aimedAt(s, 'scale'))} has noticed that your researchers have good profiles. It would like to send them offers, and every offer contains the word "mission."`,
    weight: (s) => (aimedAt(s, 'scale') && researchers(s) >= 2 ? 5 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Counter with raises',
        hint: (s) => `Costs about ${$(safeCost(s, 40_000))}, and raises researcher pay`,
        effect: (s) => {
          spend(s, safeCost(s, 40_000));
          const r = s.staff.roles.researcher;
          r.salaryLevel = Math.min(1.6, r.salaryLevel + 0.1);
          morale(s, 2);
          return 'Your researchers get a raise and a calendar invite titled "Mission (Ours)." The offers go unopened.';
        },
      },
      {
        label: 'Let them go',
        hint: 'A gamble: a researcher may leave',
        effect: (s, rng) => {
          const a = aimedAt(s, 'scale');
          if (a) rile(a.c, 6);
          if (rng.chance(0.5) && researchers(s) >= 1) {
            cutStaff(s, 'researcher', 1);
            return `One researcher took a ${nameOf(a)} offer and left with a box of mugs. The mugs are staying.`;
          }
          morale(s, -2);
          return `The offers went round the team. Everyone read them, and everyone stayed, though a few are updating their profiles.`;
        },
      },
    ],
  },
  {
    // Raised by the staff system when a rival lab's offer goes for a star. Weight 0: never drawn at random.
    id: 'star_counter_offer',
    title: 'A Star Has an Offer',
    icon: '💼',
    body: (s) => {
      const st = offeredStar(s);
      const lab = s.events.pending?.labId ? labName(s, s.events.pending.labId) : 'a rival lab';
      return st
        ? `${st.name}, ${st.title}, has a written offer from ${lab}. It is on the table until Friday.`
        : 'The star has already gone.';
    },
    weight: () => 0,
    cooldownDays: 0,
    choices: [
      {
        label: 'Match the offer',
        hint: (s) => {
          const st = offeredStar(s);
          return st ? `Costs ${$(matchCost(st))} now, and their salary rises by a fifth` : '';
        },
        available: (s) => {
          const st = offeredStar(s);
          return !!st && s.finance.cash >= matchCost(st);
        },
        effect: (s) => {
          const st = offeredStar(s);
          if (!st) return 'They had already gone.';
          spend(s, matchCost(st));
          st.salary = Math.round(st.salary * (1 + STAFF_TUNING.RAISE_ON_MATCH));
          st.loyalty = Math.min(100, st.loyalty + 30);
          return `${st.name} stays, on a bigger salary, and says the rival's offer was "a lot of paperwork anyway."`;
        },
      },
      {
        label: 'Let them go',
        hint: 'They leave with their bonuses',
        effect: (s) => {
          const st = offeredStar(s);
          if (!st) return 'They had already gone.';
          s.staff.stars = s.staff.stars.filter((x) => x.id !== st.id);
          pushNews(s, `${st.name} (${st.title}) has left ${s.company.name} for a rival.`, 'bad');
          return `${st.name} takes the offer and leaves. Their bonuses went with them.`;
        },
      },
    ],
  },
];

export const EVENTS_RIVALS: EventDef[] = RAW_EVENTS.map((e) => ({ ...e, weight: (st: GameState) => (noticed(st) ? e.weight(st) : 0) }));
