// v10: does research keep up with the calendar? Usage: npx tsx scripts/research-pace.ts [years=10] [strategies=frontier,small] [seeds=1]
// Each year end prints the share of open nodes (minYear <= that year) that are finished, the RP still owed at the
// effective (diffusion) cost, and the target check from GAME_DESIGN §21.2:
//   frontier finishes >= 80% of open nodes at every year end from 2019; small >= 55%; nobody finishes the whole tree before 2030.
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import { calendarYear } from '../src/sim/util';
import { botDay, type BotStrategy } from './bot';
import { RESEARCH } from '../src/sim/data/research';
import { effectiveResearchCost } from '../src/sim/systems/research';

const years = Number(process.argv[2] ?? 10);
const strats = (process.argv[3] ?? 'frontier,small').split(',') as BotStrategy[];
const seeds = (process.argv[4] ?? '1').split(',').map(Number);
const TARGET: Record<string, number> = { frontier: 0.8, small: 0.55 };
const FIRST_CHECK_YEAR = 2019;
const TREE_DONE_BEFORE = 2030;

for (const strat of strats) {
  for (const seed of seeds) {
    const s = createInitialState(seed, 'Pace');
    const startYear = calendarYear(s.day);
    const endYear = startYear + years;
    let last = startYear;
    const shares: { year: number; share: number }[] = [];
    let treeDoneYear: number | null = null;
    console.log(`--- ${strat} seed ${seed}`);

    const report = (yearEnd: number): void => {
      const open = RESEARCH.filter((n) => (n.minYear ?? 2017) <= yearEnd);
      const left = open.filter((n) => !s.research.completed.includes(n.id));
      const share = (open.length - left.length) / open.length;
      const owed = left.reduce((a, n) => a + effectiveResearchCost(s, n), 0);
      const ppd = s.research.pointsPerDay;
      shares.push({ year: yearEnd, share });
      if (s.research.completed.length >= RESEARCH.length && treeDoneYear === null) treeDoneYear = yearEnd;
      console.log(
        `${yearEnd}: researchers=${s.staff.roles.researcher.count} pts/day=${ppd.toFixed(1)} finished=${Math.round(share * 100)}% ` +
          `(${open.length - left.length}/${open.length}) backlog=${left.length} owed=${(owed / Math.max(ppd, 0.01) / 365).toFixed(1)} yrs of research`,
      );
    };

    while (calendarYear(s.day) < endYear) {
      botDay(s, false, strat);
      tick(s);
      const y = calendarYear(s.day);
      if (y !== last) {
        report(last);
        last = y;
      }
    }
    const target = TARGET[strat];
    const checked = shares.filter((r) => r.year >= FIRST_CHECK_YEAR);
    if (target !== undefined && checked.length > 0) {
      const worst = checked.reduce((a, r) => (r.share < a.share ? r : a), checked[0]);
      const ok = worst.share >= target;
      console.log(`target: finished >= ${Math.round(target * 100)}% from ${FIRST_CHECK_YEAR} -> worst ${worst.year} ${Math.round(worst.share * 100)}% ${ok ? 'PASS' : 'FAIL'}`);
    }
    const doneEarly = treeDoneYear !== null && treeDoneYear < TREE_DONE_BEFORE;
    console.log(`target: whole tree done before ${TREE_DONE_BEFORE} -> ${treeDoneYear === null ? 'no' : `yes in ${treeDoneYear}`} ${doneEarly ? 'FAIL' : 'PASS'}`);
  }
}
