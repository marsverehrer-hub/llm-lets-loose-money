// Balance assertions. Usage: npm run balance [-- --seeds=8]
// Each check prints PASS or FAIL with the numbers behind it; the process exits 1 if any fail.
import { play, randomBlueprint, type OfferMode, type Policy } from './bot';
import { OFFERS } from '../src/sim/content/offers';
import { incumbent } from '../src/sim/chips';
import { apply } from '../src/sim/apply';
import { endWeek } from '../src/sim/endWeek';
import { rand } from '../src/sim/rand';
import { netWorth } from '../src/sim/stock';
import { band, startRun, trueCap } from '../src/sim/run';
import { newGame } from '../src/sim/state';
import { forecast, meanCap } from '../src/sim/view';
import { MODALITIES } from '../src/sim/content/modalities';
import { TECHS } from '../src/sim/content/tech';

const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? 8);
let failed = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
};
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// 1. Forecast calibration: the 80% band should hold the truth about 80% of the time.
{
  let inside = 0, n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = newGame(seed);
    let k = 0;
    const u = (): number => rand(seed, k++, 'cal', 'u');
    for (let i = 0; i < 50; i++) {
      const bp = randomBlueprint(s, 'lang', 100 + 900 * u(), u);
      const c = structuredClone(s);
      const run = startRun(c, c.labId, bp, 'x', true);
      const b = band(run);
      if (Math.abs(meanCap(trueCap(run)) - meanCap(b.mid)) <= 1.28 * b.sd) inside++;
      n++;
    }
  }
  const pct = (100 * inside) / n;
  check('forecast band is calibrated', pct >= 72 && pct <= 90, `${pct.toFixed(0)}% of ${n} runs inside the 80% band (want 72-90)`);
}

// 2. No dominant blueprint: top-decile designs per segment are not all one architecture or one technique set.
{
  const mod = MODALITIES.lang;
  const archTop: Record<string, number> = {}, techTop: Record<string, Set<string>> = {};
  const expNovel: number[] = [], expRepeat: number[] = [];
  let tops = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = newGame(seed);
    s.week = 60; // every early technique is public
    let k = 0;
    const u = (): number => rand(seed, k++, 'bp', 'u');
    const cands = Array.from({ length: 400 }, () => {
      const bp = randomBlueprint(s, 'lang', 600, u);
      const f = forecast(s, bp);
      return { bp, f };
    });
    for (const seg of mod.segments.filter((g) => s.segments[g.id])) {
      const p = (c: typeof cands[number]): number => c.f.proj.rows.find((r) => r.seg === seg.id)!.profit;
      const ranked = [...cands].sort((a, b) => p(b) - p(a)).slice(0, 40);
      for (const c of ranked) {
        archTop[c.bp.arch] = (archTop[c.bp.arch] ?? 0) + 1;
        for (const t of c.bp.techniques) (techTop[t] ??= new Set()).add(seg.id);
        tops++;
      }
    }
    const byProfit = [...cands].sort((a, b) => b.f.profit[1] - a.f.profit[1]).slice(0, 40);
    expNovel.push(...byProfit.map((c) => c.bp.split.exp));
    // The same lab after it has built everything once: novelty is low.
    const vet = structuredClone(s);
    vet.companies[vet.labId].lab!.history = ['arch:dense', 'arch:ssm', 'arch:loop', ...TECHS.map((t) => 'tech:' + t.id)];
    vet.companies[vet.labId].lab!.maxCompute = 600;
    const again = cands.map((c) => ({ bp: c.bp, f: forecast(vet, c.bp) })).sort((a, b) => b.f.profit[1] - a.f.profit[1]).slice(0, 40);
    expRepeat.push(...again.map((c) => c.bp.split.exp));
  }
  const maxArch = Math.max(...Object.values(archTop)) / tops;
  check('no architecture dominates', maxArch <= 0.6, Object.entries(archTop).map(([a, n]) => `${a} ${Math.round((100 * n) / tops)}%`).join(', '));
  const langTechs = TECHS.filter((t) => t.mods.includes('lang') && t.week <= 60);
  const never = langTechs.filter((t) => !techTop[t.id]);
  check('every technique is top-decile somewhere', never.length === 0, never.length ? 'never: ' + never.map((t) => t.id).join(', ') : `${langTechs.length} techniques all appear`);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  check('experiments pay more on novel builds', mean(expNovel) > mean(expRepeat) + 0.01, `best designs spend ${(100 * mean(expNovel)).toFixed(1)}% when novel vs ${(100 * mean(expRepeat)).toFixed(1)}% on repeats`);
}

// 3. Skill ladder and call choices, from full games.
{
  const caps: Record<Policy, number[]> = { random: [], greedy: [], lookahead: [] };
  const picks: Record<string, number[]> = {};
  let bust = 0, launches = 0;
  for (const policy of ['random', 'greedy', 'lookahead'] as Policy[]) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = play(seed, policy);
      caps[policy].push(r.revenue);
      if (policy === 'lookahead') {
        for (const [def, ns] of Object.entries(r.picks)) { picks[def] ??= ns.map(() => 0); ns.forEach((x, i) => { picks[def][i] = (picks[def][i] ?? 0) + x; }); }
        if (r.bust) bust++;
        launches += r.launches;
      }
    }
  }
  const m = { random: median(caps.random), greedy: median(caps.greedy), lookahead: median(caps.lookahead) };
  const fmt = (x: number): string => '$' + (x / 1e6).toFixed(0) + 'M';
  check('design skill beats luck', m.random * 2 < m.greedy && m.random * 2 < m.lookahead, `median three-year revenue: random ${fmt(m.random)}, greedy ${fmt(m.greedy)}, lookahead ${fmt(m.lookahead)}`);
  check('thinking about calls is not worse than ignoring them', m.lookahead > 0.85 * m.greedy, `lookahead ${fmt(m.lookahead)} vs greedy ${fmt(m.greedy)}`);
  check('a competent player survives', bust === 0, `${bust} of ${SEEDS} lookahead games went bust; ${(launches / SEEDS).toFixed(1)} launches per game`);
  const lopsided: string[] = [];
  for (const [def, ns] of Object.entries(picks)) {
    const total = ns.reduce((a, b) => a + b, 0);
    if (total < 12 || def.startsWith('beat.')) continue;
    const top = Math.max(...ns) / total;
    if (top > 0.85) lopsided.push(`${def} ${ns.join('/')}`);
  }
  console.log('      call picks (lookahead): ' + Object.entries(picks).map(([d, ns]) => `${d} ${ns.join('/')}`).join('  '));
  check('no call has an obvious answer', lopsided.length <= 3, lopsided.length ? 'lopsided: ' + lopsided.join(', ') : 'every drawn call splits its picks');
}

// 4. Financial engineering is not a money printer: issuing shares and buying them back leaves the founder poorer.
{
  let worse = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const base = play(seed, 'greedy', 60).s;
    let a = structuredClone(base), b = structuredClone(base);
    for (let i = 0; i < 4; i++) {
      a = apply(a, { t: 'raise' });
      for (let w = 0; w < 6; w++) { a.moments = []; b.moments = []; if (w === 1) a = apply(a, { t: 'buyback' }); a = endWeek(a); b = endWeek(b); }
    }
    if (netWorth(a, a.playerId) <= netWorth(b, b.playerId) * 1.02) worse++;
  }
  // Issuing when the market overprices you and buying back when it underprices you is meant to work sometimes; a loop must not win as a rule.
  check('issue-and-buyback loops do not print money', worse >= SEEDS - 2, `${worse} of ${SEEDS} seeds end no richer than doing nothing`);
}

// 5. Every week matters: most weeks bring a call or an offer, and answering offers well beats saying yes to everything.
{
  const decade = [1, 2, 3].map((seed) => play(seed, 'greedy', 480));
  const busy = decade.map((r) => r.busyWeeks / Math.max(1, r.helmWeeks));
  check('most weeks have a decision', median(busy) >= 0.75, `median ${Math.round(100 * median(busy))}% of weeks in charge have a call or an offer (want 75%+)`);
  const worth = (mode: OfferMode): number => median(Array.from({ length: SEEDS }, (_, i) => netWorth(play(i + 1, 'greedy', 144, 'lang', mode).s, 'you')));
  const yes = worth('accept'), no = worth('decline');
  let best = { kind: '', v: -Infinity };
  for (const d of OFFERS) {
    const make = d.make;
    d.make = (c) => { const r = make(c); if (r) r.call.options = r.call.options.filter((o) => !o.fx.length); return r; };
    const v = worth('accept');
    d.make = make;
    if (v > best.v) best = { kind: d.id, v };
  }
  const fmt = (x: number): string => '$' + (x / 1e6).toFixed(0) + 'M';
  check('offers matter', yes > 1.2 * no, `median net worth: accept everything ${fmt(yes)}, decline everything ${fmt(no)}`);
  check('saying yes to everything is not best', best.v > 1.05 * yes, `declining every ${best.kind} offer reaches ${fmt(best.v)} against ${fmt(yes)} for accepting all`);
}

// 6. Ten-year progression: the AGI race is a late-game event, and research is worth paying for.
{
  const agi = [1, 2, 3, 4].map((seed) => play(seed, 'greedy', 480).agiWeek);
  check('the AGI race is late-game', agi.every((w) => w == null || w >= 288) && agi.some((w) => w != null),
    `crossed at weeks ${agi.map((w) => w ?? 'never').join(', ')} (want none before 288, and at least one game reaching it)`);
  const rev = (r: number): number => median(Array.from({ length: SEEDS }, (_, i) => play(i + 1, 'greedy', 240, 'lang', undefined, r).revenue));
  const none = rev(0), some = rev(0.05);
  check('research pays', some > none, `median five-year revenue: ${(some / 1e6).toFixed(0)}M with a 5% research budget, ${(none / 1e6).toFixed(0)}M without`);
}

// 7. Hardware moves: rival chip designers keep raising the bar, so a chip that leads today is ordinary in two years.
{
  let s = newGame(5);
  s.helm = false; // an idle player would go bankrupt and stop the clock; let the AI run the lab
  for (let i = 0; i < 240; i++) { for (const d of s.deals) if (d.playerTenders === null) d.playerTenders = false; s = endWeek(s); s.moments = []; s.over = false; }
  const bar = incumbent(s);
  check('the chip bar keeps rising', bar > 2 && bar < 6, `best chip after five years is ×${bar.toFixed(2)} the first-year part (want 2-6)`);
}

process.exit(failed ? 1 : 0);
