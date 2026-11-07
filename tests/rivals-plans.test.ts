import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { EVENTS_RIVALS } from '../src/sim/data/eventsRivals';
import { rivalLabs, planMods, PLAN_NAME } from '../src/sim/systems/rivals';
import { plansYear, NEUTRAL_MODS, PLAN_BLURB } from '../src/sim/systems/rivals/plans';
import { eventHint } from '../src/sim/systems/eventDeltas';
import { dayToDate } from '../src/sim/util';
import type { GameState, RivalPlanId, Rng } from '../src/sim/types';

// Same house rules as tests/events-v2.test.ts, applied to the rival events.
const STAT_NUMBER = /[+-]\d+\s*(hype|brand|reputation|rep|morale|safety)/i;
const PERCENT = /\d+%/;
const STAT_WORD = /\b(hype|brand|reputation|morale|aihype|rep)\b/i;

const PLAN_IDS: RivalPlanId[] = ['agents', 'price_war', 'open_everything', 'safety_first', 'scale', 'enterprise', 'media', 'steady'];
const SEEDS = [1, 2];
const DAYS = [400, 1200];

/** The first day of a calendar year, found from the sim's own calendar. */
function jan1(year: number): number {
  for (let d = 0; ; d++) {
    const dt = dayToDate(d);
    if (dt.getUTCFullYear() === year && dt.getUTCMonth() === 0 && dt.getUTCDate() === 1) return d;
  }
}

/** A company with every rival lab active, a chat-leaning audience, and two released models of its own. */
function world(seed: number, day: number, cash = 500_000_000): GameState {
  const s = createInitialState(seed, 'PlanCo');
  s.day = day;
  s.finance.cash = cash;
  for (const c of s.competitors) {
    c.active = true;
    c.prices = { chat: 1000, api: 1000, enterprise: 1000 };
    c.users = { consumer: 10, developer: 0, enterprise: 0 };
  }
  for (const lab of rivalLabs(s)) {
    lab.status = 'active';
    lab.foundedDay = day;
    lab.cash = 100_000_000;
  }
  s.models.push(
    { id: 'pm1', name: 'Player 1', releasedDay: day - 100, deprecated: false, overall: 60, elo: 1000 } as GameState['models'][number],
    { id: 'pm2', name: 'Player 2', releasedDay: day - 50, deprecated: false, overall: 62, elo: 1100 } as GameState['models'][number],
  );
  return s;
}

function addChatProduct(s: GameState, price = 20): void {
  s.products.push({
    id: 'p_test', kind: 'chat', name: 'Test chat', modelId: 'pm2', price, users: 5000,
    launchedDay: s.day, active: true, satisfaction: 60,
  } as GameState['products'][number]);
}

function setPlans(s: GameState, plan: RivalPlanId | null): void {
  for (const lab of rivalLabs(s)) {
    if (lab.status !== 'active') continue;
    lab.plan = plan ? { id: plan, year: 2026 } : null;
  }
}

function rngFor(k: number): Rng {
  return makeRng({ rngState: 500 + k * 7919 });
}

const eventDef = (id: string) => {
  const def = EVENTS_RIVALS.find((e) => e.id === id);
  if (!def) throw new Error(`${id} missing`);
  return def;
};

describe('yearly plans on 1 January', () => {
  it('every active lab gets a plan, and the same seed gives the same plans', () => {
    const day = jan1(2026);
    const picks = (seed: number) => {
      const s = world(seed, day);
      const unfounded = rivalLabs(s)[0];
      unfounded.status = 'unfounded';
      plansYear(s, makeRng({ rngState: seed }));
      return rivalLabs(s).map((l) => ({ status: l.status, plan: l.plan?.id ?? null, history: l.planHistory.length }));
    };
    const a = picks(11);
    expect(a).toEqual(picks(11));
    for (const lab of a) {
      if (lab.status === 'active') {
        expect(PLAN_IDS).toContain(lab.plan);
        expect(lab.history).toBe(1);
      } else {
        expect(lab.plan).toBeNull();
        expect(lab.history).toBe(0);
      }
    }
  });

  it('announces one line of news per active lab, and logs the plan', () => {
    const s = world(12, jan1(2026));
    const before = s.news.length;
    plansYear(s, makeRng({ rngState: 12 }));
    const active = rivalLabs(s).filter((l) => l.status === 'active');
    expect(s.news.length - before).toBe(active.length);
    for (const lab of active) expect(lab.log[lab.log.length - 1].text).toContain(PLAN_NAME[lab.plan!.id]);
  });

  it('a lab with no plan keeps the neutral tilt, and steady is neutral too', () => {
    expect(planMods(rivalLabs(world(1, 400))[0])).toEqual(NEUTRAL_MODS);
    const lab = { ...rivalLabs(world(1, 400))[0], plan: { id: 'steady' as RivalPlanId, year: 2026 } };
    expect(planMods(lab)).toEqual(NEUTRAL_MODS);
  });

  it('plan tilts follow the table', () => {
    const lab = (id: RivalPlanId) => ({ ...rivalLabs(world(1, 400))[0], plan: { id, year: 2026 } });
    expect(planMods(lab('agents' as RivalPlanId)).capSkew.agentic).toBe(4);
    expect(planMods(lab('price_war' as RivalPlanId)).price).toBe(0.7);
    expect(planMods(lab('scale' as RivalPlanId)).compute).toBe(1.6);
    expect(planMods(lab('open_everything' as RivalPlanId)).open).toBe(0.5);
  });

  it('every plan has a name and a one-sentence blurb', () => {
    for (const id of PLAN_IDS) {
      expect(PLAN_NAME[id].length).toBeGreaterThan(0);
      expect(PLAN_BLURB[id].length).toBeGreaterThan(0);
    }
  });
});

describe('counter events', () => {
  it('stay quiet while no lab aims at the player', () => {
    const s = world(3, 1200);
    addChatProduct(s);
    setPlans(s, null);
    for (const def of EVENTS_RIVALS) expect(def.weight(s), def.id).toBe(0);
  });

  it('the price war fires only with a live product in the lab\'s home segment', () => {
    const s = world(4, 1200);
    setPlans(s, 'price_war');
    const def = eventDef('rival_price_war');
    expect(def.weight(s)).toBe(0);
    addChatProduct(s);
    expect(def.weight(s)).toBeGreaterThan(0);
    expect(typeof s.flags['plan.target']).toBe('number');
  });

  it('an undercut schedules a reaction 30 to 60 days out, and the reaction is only due then', () => {
    const s = world(5, 1200);
    setPlans(s, 'price_war');
    addChatProduct(s, 20);
    eventDef('rival_price_war').choices[0].effect(s, rngFor(1));
    const key = 'chain.rival_price_react';
    expect(s.flags[key]).toBeDefined();
    const offset = s.flags[key] - s.day;
    expect(offset).toBeGreaterThanOrEqual(30);
    expect(offset).toBeLessThanOrEqual(60);

    const reaction = eventDef('rival_price_reaction');
    const notDue = world(5, 1200);
    const due = world(5, 1200);
    due.flags[key] = due.day;
    expect(reaction.weight(notDue)).toBe(0);
    expect(reaction.weight(due)).toBeGreaterThan(0);
  });

  it('a hold on prices schedules no reaction', () => {
    const s = world(6, 1200);
    setPlans(s, 'price_war');
    addChatProduct(s, 20);
    eventDef('rival_price_war').choices[1].effect(s, rngFor(2));
    expect(s.flags['chain.rival_price_react']).toBeUndefined();
  });

  it('the open-weights choice is only offered when there is an older model', () => {
    const s = world(7, 1200);
    setPlans(s, 'open_everything');
    const choice = eventDef('rival_open_everything').choices[1];
    expect(choice.available?.(s)).toBe(true);
    s.models = s.models.slice(0, 1);
    expect(choice.available?.(s)).toBe(false);
  });
});

describe('EVENTS_RIVALS pass the events-v2 house rules', () => {
  it('ships four to six events, each with at least two choices and a title', () => {
    expect(EVENTS_RIVALS.length).toBeGreaterThanOrEqual(4);
    expect(EVENTS_RIVALS.length).toBeLessThanOrEqual(6);
    for (const def of EVENTS_RIVALS) {
      expect(def.choices.length, def.id).toBeGreaterThanOrEqual(2);
      expect(def.title.length, def.id).toBeGreaterThan(0);
    }
  });

  it('hints show tangible things only, in every plan', () => {
    for (const plan of PLAN_IDS) {
      for (const seed of SEEDS) {
        for (const day of DAYS) {
          const s = world(seed, day);
          addChatProduct(s);
          setPlans(s, plan);
          for (const def of EVENTS_RIVALS) {
            def.choices.forEach((c, i) => {
              const hint = eventHint(c, s);
              if (!hint) return;
              expect(hint, `${def.id}[${i}] ${plan}`).not.toMatch(STAT_NUMBER);
              expect(hint, `${def.id}[${i}] ${plan}`).not.toMatch(PERCENT);
              expect(hint, `${def.id}[${i}] ${plan}`).not.toMatch(STAT_WORD);
            });
            expect(def.body(s).trim().length, `${def.id} body`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('results never print stat numbers and always say something', () => {
    for (const plan of PLAN_IDS) {
      for (const seed of SEEDS) {
        for (const day of DAYS) {
          for (const def of EVENTS_RIVALS) {
            def.choices.forEach((c, i) => {
              const s = world(seed, day);
              addChatProduct(s);
              setPlans(s, plan);
              const text = c.effect(s, rngFor(seed + day));
              expect(text, `${def.id}[${i}] ${plan}`).not.toMatch(STAT_NUMBER);
              expect(text, `${def.id}[${i}] ${plan}`).not.toMatch(PERCENT);
              expect(text.trim().length, `${def.id}[${i}] ${plan}`).toBeGreaterThan(0);
            });
          }
        }
      }
    }
  });

  it('the safest (first) choice of every rival event costs at most a quarter of cash', () => {
    for (const plan of PLAN_IDS) {
      for (const cash of [50_000, 2_000_000, 3_000_000_000]) {
        for (const def of EVENTS_RIVALS) {
          const s = world(8, 1200, cash);
          addChatProduct(s);
          setPlans(s, plan);
          const before = s.finance.cash;
          def.choices[0].effect(s, rngFor(cash));
          expect(before - s.finance.cash, `${def.id} at ${cash} under ${plan}`).toBeLessThanOrEqual(before * 0.25 + 1);
        }
      }
    }
  });
});
