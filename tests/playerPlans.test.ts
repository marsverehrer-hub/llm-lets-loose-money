// v22 yearly plan: announced once a calendar year, kept or broken on 1 January from the year's ledger.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { addRevenue } from '../src/sim/util';
import { ensureBoard } from '../src/sim/systems/board';
import { BALANCE } from '../src/sim/balance';

const dayOf = (y: number, m: number, d: number) => (Date.UTC(y, m, d) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000;

describe('yearly plan', () => {
  it('a kept plan lifts brand and board confidence on 1 January', () => {
    const s = createInitialState(7);
    s.day = dayOf(2018, 11, 30);
    tick(s); // 31 Dec 2018: the 2018 ledger opens
    s.events.pending = null;
    dispatch(s, { type: 'announcePlan', planId: 'profitable' });
    addRevenue(s, 'api', 5_000_000);
    s.company.brand = 40;
    const confidence = ensureBoard(s).confidence;
    tick(s); // 1 Jan 2019: 2018 is judged

    expect(s.playerPlan).toMatchObject({ id: 'profitable', year: 2018, kept: true });
    expect(s.company.brand).toBeGreaterThan(40);
    expect(s.board!.confidence).toBeGreaterThan(confidence);
    expect(s.news.some((n) => n.kind === 'good' && n.text.includes('keeps its 2018 promise'))).toBe(true);
  });

  it('a broken plan lowers brand and board confidence on 1 January', () => {
    const s = createInitialState(7);
    s.day = dayOf(2018, 11, 30);
    tick(s);
    s.events.pending = null;
    dispatch(s, { type: 'announcePlan', planId: 'open_weights' }); // no open-weights release all year
    s.company.brand = 40;
    const confidence = ensureBoard(s).confidence;
    tick(s);

    expect(s.playerPlan).toMatchObject({ id: 'open_weights', year: 2018, kept: false });
    expect(s.company.brand).toBeLessThan(40);
    expect(s.board!.confidence).toBeLessThan(confidence);
    expect(s.news.some((n) => n.kind === 'bad' && n.text.includes('misses its 2018 promise'))).toBe(true);
  });

  it('a second announcement in the same year is refused', () => {
    const s = createInitialState(7);
    s.day = dayOf(2018, 5, 1);
    tick(s);
    s.events.pending = null;
    dispatch(s, { type: 'announcePlan', planId: 'ship_twice' });
    dispatch(s, { type: 'announcePlan', planId: 'top3' });

    expect(s.playerPlan).toEqual({ id: 'ship_twice', year: 2018 });
  });
});
