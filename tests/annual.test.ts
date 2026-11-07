// v21 Annual Report: filed on 1 January for the year just ended, with that year's revenue.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import { addRevenue } from '../src/sim/util';
import { BALANCE } from '../src/sim/balance';

const dayOf = (y: number, m: number, d: number) => (Date.UTC(y, m, d) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000;

describe('annual report', () => {
  it('is filed on 1 January with the year just ended and its revenue', () => {
    const s = createInitialState(7);
    s.day = dayOf(2018, 11, 30);
    const yearStart = s.stats.totalRevenue;
    tick(s); // 31 Dec 2018: the 2018 ledger opens
    s.events.pending = null; // an event that fired on the way would block the day until it is answered
    addRevenue(s, 'api', 5_000_000);
    const yearEnd = s.stats.totalRevenue;
    tick(s); // 1 Jan 2019: 2018 is filed

    expect(s.day).toBe(dayOf(2019, 0, 1));
    const report = s.annualReports?.at(-1);
    expect(report?.year).toBe(2018);
    expect(report?.revenue).toBeCloseTo(yearEnd - yearStart, 0);
    expect(report!.revenue).toBeGreaterThanOrEqual(5_000_000);
    expect(s.noticeLog?.some((n) => n.annual === 2018)).toBe(true);
  });
});
