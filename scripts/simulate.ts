// Headless balance run: a scripted "decent player" bot plays N years and prints a pacing table.
// Usage: npx tsx scripts/simulate.ts [years=12] [seed=7] [--idle]
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import { headcount } from '../src/sim/systems/staff';
import { arenaLeaderboard } from '../src/sim/systems/competitors';
import { formatDate, formatMoney, formatNumber } from '../src/sim/util';
import { botDay, bestReleased } from './bot';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const YEARS = Number(args[0] ?? 12);
const SEED = Number(args[1] ?? 7);
const IDLE = process.argv.includes('--idle');

const s: GameState = createInitialState(SEED, 'BotCorp');

const rows: string[] = [];
const header = ['date', 'cash', 'rev/d', 'exp/d', 'valuation', 'users', 'bestOvr', 'rank', 'staff', 'PFLOPS', 'equity', 'rounds'];
rows.push(header.join('\t'));
const totalDays = YEARS * 365;
const t0 = Date.now();
for (let d = 0; d < totalDays && !s.gameOver; d++) {
  botDay(s, IDLE);
  tick(s);
  if (process.env.TRACE && s.day % 10 === 0) console.log(s.day, Math.round(s.finance.cash), JSON.stringify(s.finance.expenseBreakdown), s.events.pending?.defId ?? "");
  if (s.day % 182 === 0) {
    const best = bestReleased(s);
    const lb = arenaLeaderboard(s);
    const rank = lb.findIndex((r) => r.isPlayer) + 1;
    const users = s.products.reduce((a, p) => a + (p.active ? p.users : 0), 0);
    rows.push(
      [
        formatDate(s.day),
        formatMoney(s.finance.cash),
        formatMoney(s.finance.dailyRevenue),
        formatMoney(s.finance.dailyExpenses),
        formatMoney(s.finance.valuation),
        formatNumber(users),
        best ? best.overall.toFixed(0) : '-',
        rank ? `${rank}/${lb.length}` : '-',
        String(headcount(s)),
        s.compute.totalPflops.toFixed(1),
        (s.company.founderEquity * 100).toFixed(0) + '%',
        s.finance.roundsRaised.join(','),
      ].join('\t'),
    );
  }
}
console.log(rows.join('\n'));
console.log(`\n${IDLE ? 'IDLE ' : ''}seed=${SEED} days=${s.day} gameOver=${JSON.stringify(s.gameOver)} public=${s.company.isPublic} achievements=${Object.keys(s.achievements).length} models=${s.models.length} lawsuits=${s.stats.lawsuits} outageDays=${s.stats.outageDays} (${Date.now() - t0}ms)`);
