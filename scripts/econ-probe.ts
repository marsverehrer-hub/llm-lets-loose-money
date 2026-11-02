// Prints a strategy bot's yearly P&L by category, users, best model and valuation. Usage: npx tsx scripts/econ-probe.ts [strategy] [years] [seed]
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import { botDay, type BotStrategy } from './bot';
import { headcount } from '../src/sim/systems/staff';
import { formatMoney, yearOf } from '../src/sim/util';
const strategy = (process.argv[2] ?? 'small') as BotStrategy;
const years = Number(process.argv[3] ?? 8);
const s = createInitialState(Number(process.argv[4] ?? 1), 'Probe');
const acc: Record<string, number> = {};
const exp: Record<string, number> = {};
let lastYear = Math.floor(yearOf(s.day));
for (let i = 0; i < years * 365 * 2 && s.day < years * 365 && !s.gameOver; i++) {
  botDay(s, false, strategy);
  const d = s.day;
  tick(s);
  if (s.day === d) continue;
  for (const [k, v] of Object.entries(s.finance.today.revenue)) acc[k] = (acc[k] ?? 0) + v;
  for (const [k, v] of Object.entries(s.finance.today.expenses)) exp[k] = (exp[k] ?? 0) + v;
  const y = Math.floor(yearOf(s.day));
  if (y !== lastYear) {
    const best = s.models.filter((m) => m.releasedDay !== null).reduce((b, m) => Math.max(b, m.overall), 0);
    const users = s.products.reduce((t, p) => t + (p.active ? p.users : 0), 0);
    const big = s.models.reduce((b, m) => Math.max(b, m.paramsB), 0);
    console.log(`${lastYear}: rev ${Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${formatMoney(v)}`).join(', ')} | cash ${formatMoney(s.finance.cash)} val ${formatMoney(s.finance.valuation)} | users ${Math.round(users)} best ${best.toFixed(1)} maxParams ${big.toFixed(1)}B staff ${headcount(s)}`);
    console.log(`      exp ${Object.entries(exp).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${formatMoney(v)}`).join(', ')}`);
    for (const k of Object.keys(exp)) delete exp[k];
    for (const k of Object.keys(acc)) delete acc[k];
    lastYear = y;
  }
}
