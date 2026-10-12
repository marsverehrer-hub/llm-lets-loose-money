import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { dispatch, tick } from '../src/sim/engine';
import { EVENTS } from '../src/sim/data/events';
import { EVENTS_V2 } from '../src/sim/data/eventsV2';
import { RUN_INCIDENTS } from '../src/sim/data/runIncidents';
import { HEADLINES } from '../src/sim/data/headlines';
import { eventHint, incidentHint, snapshotTangible, diffTangible } from '../src/sim/systems/eventDeltas';
import { backfillTraining } from '../src/sim/systems/training';
import type { GameState, Rng, TrainingRun } from '../src/sim/types';

// Stat numbers never reach the player: "+4 hype", "-2 morale", "30%" and friends.
const STAT_NUMBER = /[+-]\d+\s*(hype|brand|reputation|rep|morale|safety)/i;
const PERCENT = /\d+%/;
// Hints additionally avoid naming the hidden stats at all.
const STAT_WORD = /\b(hype|brand|reputation|morale|aihype|rep)\b/i;

const DAYS = [40, 400, 1200, 2400];
const SEEDS = [1, 2, 3];

/** A fresh company on a given day, optionally with a set cash balance. */
function sample(seed: number, day: number, cash?: number): GameState {
  const s = createInitialState(seed, 'SampleCo');
  s.day = day;
  if (cash !== undefined) s.finance.cash = cash;
  return s;
}

/** A training run in flight, with its config filled in the way a save would. */
function sampleRun(s: GameState): TrainingRun {
  s.training = {
    id: 'r-test', name: 'Test run', paramsB: 7, tokensB: 200, datasetIds: ['scrawl_sample'], techniques: [],
    dataQuality: 0.5, totalFlops: 1e21, doneFlops: 2e20, startedDay: s.day - 30, lossHistory: [2.4, 2.3],
    predictedLoss: 2.2, stallDays: 0, overheadLeft: 0,
  } as GameState['training'];
  backfillTraining(s);
  return s.training!;
}

function rngFor(k: number): Rng {
  return makeRng({ rngState: 1000 + k * 7919 });
}

/** Autoresolve a pending event, the way a player who takes the first affordable option would. */
function autoResolve(s: GameState): void {
  const p = s.events.pending;
  if (!p) return;
  if (p.result === undefined) {
    const def = EVENTS.find((e) => e.id === p.defId);
    if (!def) throw new Error(`pending event ${p.defId} missing`);
    const idx = def.choices.findIndex((c) => !c.available || c.available(s));
    dispatch(s, { type: 'resolveEvent', choice: Math.max(0, idx) });
  } else {
    dispatch(s, { type: 'clearEventResult' });
  }
}

const chainKeysIn = (s: GameState) => Object.keys(s.flags).filter((k) => k.startsWith('chain.'));

describe('no stat numbers in choice hints', () => {
  it('event hints show tangible things only', () => {
    for (const def of EVENTS) {
      for (const [seed, day] of DAYS.map((d, i) => [SEEDS[i % SEEDS.length], d] as const)) {
        const s = sample(seed, day);
        def.choices.forEach((c, i) => {
          const hint = eventHint(c, s);
          if (!hint) return;
          expect(hint, `${def.id}[${i}] hint`).not.toMatch(STAT_NUMBER);
          expect(hint, `${def.id}[${i}] hint`).not.toMatch(PERCENT);
          expect(hint, `${def.id}[${i}] hint`).not.toMatch(STAT_WORD);
        });
      }
    }
  });

  it('run incident hints show tangible things only', () => {
    for (const def of RUN_INCIDENTS) {
      const s = sample(4, 900);
      const run = sampleRun(s);
      def.choices.forEach((c, i) => {
        const hint = incidentHint(c, s, run);
        if (!hint) return;
        expect(hint, `${def.id}[${i}] hint`).not.toMatch(STAT_NUMBER);
        expect(hint, `${def.id}[${i}] hint`).not.toMatch(PERCENT);
        expect(hint, `${def.id}[${i}] hint`).not.toMatch(STAT_WORD);
      });
    }
  });
});

describe('no stat numbers in choice results', () => {
  it('event results never print stat numbers, on several seeds and eras', () => {
    for (const def of EVENTS) {
      def.choices.forEach((c, i) => {
        for (const seed of SEEDS) {
          for (const day of DAYS) {
            const s = sample(seed, day);
            const text = c.effect(s, rngFor(seed + day));
            expect(text, `${def.id}[${i}] result on day ${day}`).not.toMatch(STAT_NUMBER);
            expect(text, `${def.id}[${i}] result on day ${day}`).not.toMatch(PERCENT);
            expect(text.trim().length, `${def.id}[${i}] result`).toBeGreaterThan(0);
          }
        }
      });
    }
  });

  it('run incident results never print stat numbers', () => {
    for (const def of RUN_INCIDENTS) {
      def.choices.forEach((c, i) => {
        for (const seed of SEEDS) {
          const s = sample(seed, 1200);
          const run = sampleRun(s);
          const text = c.effect(s, run, rngFor(seed));
          expect(text, `${def.id}[${i}] result`).not.toMatch(STAT_NUMBER);
          expect(text, `${def.id}[${i}] result`).not.toMatch(PERCENT);
        }
      });
    }
  });

  it('headlines carry no stat numbers', () => {
    for (const h of HEADLINES) {
      expect(h.text).not.toMatch(STAT_NUMBER);
      expect(h.text).not.toMatch(PERCENT);
    }
  });
});

describe('tangible deltas', () => {
  it('a money choice records a Cash delta, and a hidden stat change records nothing', () => {
    const s = sample(11, 40);
    s.events.pending = { defId: 'landlord_hike', day: s.day };
    const cashBefore = s.finance.cash;
    dispatch(s, { type: 'resolveEvent', choice: 0 });
    const deltas = s.events.pending?.deltas ?? [];
    expect(s.finance.cash).toBeLessThan(cashBefore);
    expect(deltas.some((d) => d.label === 'Cash' && d.value.includes('−'))).toBe(true);
    expect(deltas.every((d) => !/hype|brand|reputation|morale/i.test(d.label))).toBe(true);
  });

  it('every event choice records a Cash delta whenever cash moves, and a GPU delta when GPUs move', () => {
    for (const def of EVENTS) {
      def.choices.forEach((c, i) => {
        const s = sample(21, 1200, 50_000_000);
        s.events.pending = { defId: def.id, day: s.day };
        const before = snapshotTangible(s);
        dispatch(s, { type: 'resolveEvent', choice: i });
        const p = s.events.pending;
        if (!p || p.result === undefined) return; // unaffordable choice, nothing resolved
        const deltas = p.deltas ?? [];
        if (Math.abs(s.finance.cash - before.cash) >= 1) {
          expect(deltas.some((d) => d.label === 'Cash'), `${def.id}[${i}] Cash delta`).toBe(true);
        }
        const gpuMoved = Object.keys({ ...before.gpus, ...snapshotTangible(s).gpus }).some(
          (id) => (snapshotTangible(s).gpus[id] ?? 0) !== (before.gpus[id] ?? 0),
        );
        if (gpuMoved) expect(deltas.some((d) => d.label === 'GPUs'), `${def.id}[${i}] GPU delta`).toBe(true);
      });
    }
  });

  it('a staff choice records the headcount change', () => {
    const s = sample(12, 40);
    s.events.pending = { defId: 'professor_interns', day: s.day };
    const engineersBefore = s.staff.roles.engineer.count;
    dispatch(s, { type: 'resolveEvent', choice: 2 });
    expect(s.staff.roles.engineer.count).toBe(engineersBefore + 1);
    expect(s.events.pending?.deltas?.some((d) => d.label === 'Engineers' && d.value === '+1')).toBe(true);
  });

  it('diffTangible reports nothing when nothing concrete moved', () => {
    const s = sample(13, 400);
    const before = snapshotTangible(s);
    expect(diffTangible(before, s)).toEqual([]);
  });

  it('run incident choices record their deltas', () => {
    let recorded = 0;
    for (const def of RUN_INCIDENTS) {
      def.choices.forEach((c, i) => {
        const s = sample(31, 1200, 50_000_000);
        const run = sampleRun(s);
        run.pendingIncident = { defId: def.id, day: s.day };
        dispatch(s, { type: 'resolveRunIncident', choice: i });
        const p = run.pendingIncident;
        if (!p || p.result === undefined) return;
        expect(Array.isArray(p.deltas), `${def.id}[${i}] deltas array`).toBe(true);
        recorded++;
      });
    }
    expect(recorded).toBeGreaterThan(0);
  });
});

describe('variance and safety', () => {
  it('the first choice of every event costs at most a quarter of cash', () => {
    for (const def of EVENTS) {
      for (const cash of [50_000, 400_000, 2_000_000, 80_000_000, 3_000_000_000]) {
        for (const day of [40, 1200, 2400]) {
          const s = sample(5, day, cash);
          const before = s.finance.cash;
          def.choices[0].effect(s, rngFor(day));
          const spent = before - s.finance.cash;
          expect(spent, `${def.id} safest option at cash ${cash} on day ${day}`).toBeLessThanOrEqual(before * 0.25 + 1);
        }
      }
    }
  });

  it('the first choice of every run incident costs at most a quarter of cash', () => {
    for (const def of RUN_INCIDENTS) {
      for (const cash of [50_000, 2_000_000, 3_000_000_000]) {
        const s = sample(6, 1200, cash);
        const run = sampleRun(s);
        const before = s.finance.cash;
        def.choices[0].effect(s, run, rngFor(cash));
        expect(before - s.finance.cash, `${def.id} safest option at cash ${cash}`).toBeLessThanOrEqual(before * 0.25 + 1);
      }
    }
  });

  it('money effects vary across rng seeds for the same state', () => {
    // A scaled, randomised effect should not land on one fixed number every time.
    const spends = new Set<number>();
    const def = EVENTS.find((e) => e.id === 'authors_lawsuit');
    if (!def) throw new Error('authors_lawsuit missing');
    for (let k = 0; k < 12; k++) {
      const s = sample(7, 1500, 900_000_000);
      const before = s.finance.cash;
      def.choices[1].effect(s, rngFor(k));
      spends.add(before - s.finance.cash);
    }
    expect(spends.size).toBeGreaterThan(1);
  });
});

describe('event types and chains', () => {
  it('ships at least 30 new events', () => {
    expect(EVENTS_V2.length).toBeGreaterThanOrEqual(30);
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('new events have at least two choices and a title', () => {
    for (const def of EVENTS_V2) {
      expect(def.choices.length, `${def.id} choices`).toBeGreaterThanOrEqual(2);
      expect(def.title.length, `${def.id} title`).toBeGreaterThan(0);
    }
  });

  it('at least six events schedule a follow-up 30 to 120 days out', () => {
    const schedulers = new Set<string>();
    for (const def of EVENTS) {
      def.choices.forEach((c, i) => {
        for (const seed of SEEDS) {
          const s = sample(seed, 1200);
          c.effect(s, rngFor(seed + i));
          for (const key of chainKeysIn(s)) {
            const offset = (s.flags[key] ?? 0) - s.day;
            expect(offset, `${def.id}[${i}] ${key}`).toBeGreaterThanOrEqual(30);
            expect(offset, `${def.id}[${i}] ${key}`).toBeLessThanOrEqual(120);
            schedulers.add(def.id);
          }
        }
      });
    }
    expect(schedulers.size).toBeGreaterThanOrEqual(6);
  });

  it('every scheduled chain has a follow-up event that only becomes likely once it is due', () => {
    const keys = new Set<string>();
    for (const def of EVENTS) {
      def.choices.forEach((c, i) => {
        const s = sample(2, 1200);
        c.effect(s, rngFor(i));
        for (const k of chainKeysIn(s)) keys.add(k);
      });
    }
    expect(keys.size).toBeGreaterThanOrEqual(6);
    for (const k of keys) {
      const notDue = sample(2, 1200);
      const due = sample(2, 1200);
      due.flags[k] = due.day;
      const followUps = EVENTS.filter((d) => d.weight(due) > d.weight(notDue));
      expect(followUps.length, `${k} follow-up`).toBeGreaterThan(0);
    }
  });

  it('a natural run fires chain follow-ups', () => {
    // A chain key is consumed (removed from flags) only by a follow-up choice, so a key that disappears
    // between two ticks means its follow-up has fired.
    let consumed = 0;
    for (const seed of [1, 2, 3]) {
      const s = createInitialState(seed, 'ChainCo');
      let known = new Set<string>();
      for (let i = 0; i < 2500 && !s.gameOver; i++) {
        autoResolve(s);
        tick(s);
        const now = new Set(chainKeysIn(s));
        for (const k of known) if (!now.has(k)) consumed++;
        known = now;
      }
    }
    expect(consumed).toBeGreaterThanOrEqual(1);
  });

  it('new events are eligible in their eras: a natural run fires most of them', () => {
    const fired = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const s = createInitialState(seed, 'EraCo');
      for (let i = 0; i < 3000 && !s.gameOver; i++) {
        autoResolve(s);
        tick(s);
      }
      for (const id of Object.keys(s.events.lastFired)) fired.add(id);
    }
    const v2Fired = EVENTS_V2.filter((d) => fired.has(d.id));
    expect(v2Fired.length).toBeGreaterThanOrEqual(Math.floor(EVENTS_V2.length * 0.6));
  });
});
