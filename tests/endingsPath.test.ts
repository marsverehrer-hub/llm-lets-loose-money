// v20 E: path endings (Boutique, Indispensable) and the thesis bonus in both scores.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ActiveContract, EndingId, GameState } from '../src/sim/types';

// Thesis goals are another package's job; here the met count is a dial the test turns.
const thesis = vi.hoisted(() => ({ met: 0 }));
vi.mock('../src/sim/systems/thesis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sim/systems/thesis')>()),
  thesisMet: () => thesis.met,
}));

type Endings = typeof import('../src/sim/systems/endings');
type Scenario = typeof import('../src/sim/systems/scenario');
type State = typeof import('../src/sim/state');
let E: Endings;
let SC: Scenario;
let ST: State;

// Fresh module graph so the thesis mock is in place before endings and scenario load (setup.ts loads them first otherwise).
beforeAll(async () => {
  vi.resetModules();
  E = await import('../src/sim/systems/endings');
  SC = await import('../src/sim/systems/scenario');
  ST = await import('../src/sim/state');
});

const DEF = (id: EndingId) => E.ENDINGS.find((e) => e.id === id)!;

function fresh(): GameState {
  thesis.met = 0;
  return ST.createInitialState(33, 'Path Labs');
}

/** An active contract paying `perYear` a year; the gates only read offer.perYear. */
function deal(perYear: number): ActiveContract {
  return { id: `c${perYear}`, offer: { perYear } } as unknown as ActiveContract;
}

describe('The Boutique', () => {
  it('needs the efficient focus, daily profit and a $50B valuation', () => {
    const s = fresh();
    s.finance.dailyRevenue = 10e6;
    s.finance.dailyExpenses = 5e6;
    s.finance.valuation = 60e9;
    s.company.doctrine = 'efficient';
    expect(DEF('boutique').available(s)).toEqual({ ok: true, why: '' });

    s.company.doctrine = 'frontier';
    expect(DEF('boutique').available(s).ok).toBe(false);
    s.company.doctrine = 'efficient';

    s.finance.dailyExpenses = 20e6;
    const loss = DEF('boutique').available(s);
    expect(loss.ok).toBe(false);
    expect(loss.why).toMatch(/losing money/);

    s.finance.dailyExpenses = 5e6;
    s.finance.valuation = 10e9;
    const small = DEF('boutique').available(s);
    expect(small.ok).toBe(false);
    expect(small.why).toMatch(/\$50B/);
  });
});

describe('Indispensable', () => {
  it('needs the specialist or enterprise focus and a $2B a year contract book', () => {
    const s = fresh();
    s.contracts = { offers: [], active: [deal(1.5e9), deal(1e9)], history: [] } as unknown as GameState["contracts"];
    s.company.doctrine = 'specialist';
    expect(DEF('indispensable').available(s)).toEqual({ ok: true, why: '' });

    s.company.doctrine = 'enterprise';
    expect(DEF('indispensable').available(s).ok).toBe(true);

    s.company.doctrine = 'efficient';
    expect(DEF('indispensable').available(s).ok).toBe(false);

    s.company.doctrine = 'specialist';
    s.contracts!.active = [deal(1.5e9)];
    const thin = DEF('indispensable').available(s);
    expect(thin.ok).toBe(false);
    expect(thin.why).toMatch(/\$2B/);
  });
});

describe('path scores', () => {
  it('both new endings have a base score', () => {
    const s = fresh();
    expect(E.endingScore(s, 'boutique')).toBeGreaterThan(0);
    expect(E.endingScore(s, 'indispensable')).toBeGreaterThan(0);
    expect(E.endingScore(s, 'boutique')).toBeGreaterThan(E.endingScore(s, 'indispensable'));
  });

  it('each thesis goal met raises the ending score and the scenario score', () => {
    const s = fresh();
    const endBefore = E.endingScore(s, 'boutique');
    const scenBefore = SC.scenarioScore(s).score;
    thesis.met = 2;
    expect(E.endingScore(s, 'boutique')).toBeGreaterThan(endBefore);
    expect(SC.scenarioScore(s).score).toBeGreaterThan(scenBefore);
  });
});
