// Benchmark sanity table: what a frontier lab (the frontier curve, neutral personality) scores on each benchmark by year.
// Usage: npx tsx scripts/benchmarks.ts [--all]
import { BENCHMARKS } from '../src/sim/data/benchmarks';
import { benchmarkResult, competitorCaps } from '../src/sim/systems/capabilities';
import { frontierQuality } from '../src/sim/systems/market';

const HEADLINE_IDS = ['mmlu', 'gsm8k', 'humaneval', 'gpqa', 'swe_bench', 'hle', 'arc_agi_2'];
const ALL = process.argv.includes('--all');
const years = Array.from({ length: 15 }, (_, i) => 2018 + i);

/** Frontier lab caps for a calendar year: all four scores at the frontier overall, no personality. */
function frontierCapsFor(year: number) {
  const F = frontierQuality(year + 0.5);
  return { F, caps: competitorCaps({ reasoning: F, coding: F, chat: F, safety: F }, null, null, year) };
}

const ids = ALL ? BENCHMARKS.map((b) => b.id) : HEADLINE_IDS;
const defs = ids.map((id) => BENCHMARKS.find((b) => b.id === id)!);
const rows = years.map((y) => {
  const { F, caps } = frontierCapsFor(y);
  const cells = defs.map((d) => (d.year > y ? '  -  ' : benchmarkResult(d, caps).toFixed(0).padStart(5)));
  return [String(y), F.toFixed(0).padStart(3), ...cells].join('\t');
});

console.log('Frontier lab results (%), by calendar year. "-" = not yet introduced.');
console.log(['year', 'F', ...defs.map((d) => d.name)].join('\t'));
console.log(rows.join('\n'));
