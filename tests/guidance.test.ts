// v22 earnings guidance: taken at each quarter's start once public, judged at quarter end against actual revenue.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { addRevenue } from '../src/sim/util';
import { ensureBoard, guidanceTarget } from '../src/sim/systems/board';
import { getBonuses } from '../src/sim/bonuses';
import { BALANCE } from '../src/sim/balance';

const dayOf = (y: number, m: number, d: number) => (Date.UTC(y, m, d) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000;
const valuationMult = (s: ReturnType<typeof publicLab>) => getBonuses(s).valuation ?? 1;

/** A public lab with a daily revenue of 100k at the start of a quarter, its goals cleared so only guidance moves confidence. */
function publicLab(level?: 'conservative' | 'in_line' | 'aggressive') {
  const s = createInitialState(7);
  s.day = dayOf(2018, 0, 2);
  s.company.isPublic = true;
  s.finance.dailyRevenue = 100_000;
  const b = ensureBoard(s);
  b.objectives = [];
  s.events.pending = null;
  if (level) dispatch(s, { type: 'setGuidance', level }); // early in the quarter, while guidance is open
  s.day = b.quarterEnd - 1; // the last day of the quarter; the next tick closes it
  return s;
}

describe('earnings guidance', () => {
  it('takes guidance at the quarter start, in line by default', () => {
    const s = publicLab();
    expect(s.board!.guidance).toMatchObject({ level: 'in_line', base: 100_000 });
  });

  it('a beat at quarter end moves valuation up', () => {
    const s = publicLab();
    const g = s.board!.guidance!;
    const before = valuationMult(s);
    addRevenue(s, 'api', guidanceTarget(s.board!, g) + 1);
    tick(s);

    expect(s.board!.confidence).toBeGreaterThan(50);
    expect(valuationMult(s)).toBeGreaterThan(before);
    expect(s.noticeLog?.some((n) => n.text.startsWith('Guidance beaten'))).toBe(true);
  });

  it('a miss at quarter end moves valuation down, more when aggressive', () => {
    const s = publicLab('aggressive');
    expect(s.board!.guidance!.level).toBe('aggressive');
    const before = valuationMult(s);
    tick(s); // no revenue booked: the quarter misses

    expect(s.board!.confidence).toBeLessThan(50);
    expect(valuationMult(s)).toBeLessThan(before);
    expect(s.noticeLog?.some((n) => n.text.startsWith('Guidance missed'))).toBe(true);
  });

  it('is locked after the first weeks of the quarter', () => {
    const s = publicLab(); // now on the quarter's last day
    dispatch(s, { type: 'setGuidance', level: 'conservative' });
    expect(s.board!.guidance!.level).toBe('in_line');
  });
});
