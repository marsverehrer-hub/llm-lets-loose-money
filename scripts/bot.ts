// Headless players of three skill levels. Used by the balance script and the tests.
//   random:    random blueprint, random call answers
//   greedy:    best of 12 candidate blueprints by forecast profit, always the first call option
//   lookahead: best of 40 candidates, and weighs every call option by expected value
import type { Blueprint, Fx, GameState, Modality, Run } from '../src/sim/types';
import { apply, handsOnRun } from '../src/sim/apply';
import { canRaise } from '../src/sim/books';
import { endWeek } from '../src/sim/endWeek';
import { autoPrice } from '../src/sim/demand';
import { rand } from '../src/sim/rand';
import { availableTechs, RUSH, SLOTS } from '../src/sim/resolve';
import { applyFx } from '../src/sim/run';
import { newGame } from '../src/sim/state';
import { forecast, runView } from '../src/sim/view';
import { MODALITIES } from '../src/sim/content/modalities';
import { archsOf } from '../src/sim/content/tech';

export type Policy = 'random' | 'greedy' | 'lookahead';
export interface BotResult { s: GameState; picks: Record<string, number[]>; launches: number; bust: boolean; revenue: number }

/** A random valid blueprint. `u` yields uniform numbers. */
export function randomBlueprint(s: GameState, m: Modality, compute: number, u: () => number): Blueprint {
  const mod = MODALITIES[m];
  const raw = mod.data.map(() => Math.pow(u(), 2));
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const techs = availableTechs(s, s.labId, m).map((t) => t.id).sort(() => u() - 0.5).slice(0, Math.floor(u() * (SLOTS + 1)));
  const exp = 0.3 * u() * u(), post = 0.15 * u();
  const archs = archsOf(m);
  return {
    modality: m, arch: archs[Math.floor(u() * archs.length)].id, compute, weeks: ([4, 6, 8] as const)[Math.floor(u() * 3)],
    split: { scale: 1 - exp - post, exp, post }, sizeBias: Math.round((u() * 2 - 1) * 10) / 10,
    mix: Object.fromEntries(mod.data.map((d, i) => [d.id, raw[i] / total])), techniques: techs,
    post: u() < 0.2 ? 'distill' : Math.floor(u() * 4),
  };
}

const HORIZON = 30; // weeks of profit a call option is weighed against

function value(s: GameState, run: Run): number {
  if (run.status === 'dead') return s.companies[run.lab].cash;
  const v = runView(s, run);
  const lab = s.companies[run.lab].lab!;
  return v.profit * HORIZON - v.weeksLeft * (v.weeklyCost + v.profit) + s.companies[run.lab].cash + 20e6 * (lab.talent - 1) + 2e6 * lab.hype + 10e6 * lab.brand
    - (run.flags.includes('contaminated') ? 0.35 * 6 * Math.max(0, v.profit) : 0) - (run.flags.includes('teased') ? 0.5e6 : 0);
}

/** Expected value of an effect list: risks are averaged over both branches instead of rolled. */
function expected(s: GameState, runId: string, fx: Fx[]): number {
  const i = fx.findIndex((f) => f.k === 'risk');
  if (i < 0) {
    const c = structuredClone(s);
    applyFx(c, c.runs[runId], fx.filter((f) => f.k !== 'ship'), 'bot', []);
    return value(c, c.runs[runId]);
  }
  const f = fx[i] as Extract<Fx, { k: 'risk' }>;
  const rest = [...fx.slice(0, i), ...fx.slice(i + 1)];
  return f.p * expected(s, runId, [...rest, ...f.bad]) + (1 - f.p) * expected(s, runId, [...rest, ...f.good]);
}

export function play(seed: number, policy: Policy, weeks = 144, m: Modality = 'lang'): BotResult {
  let s = newGame(seed);
  let n = 0;
  const u = (): number => rand(seed, n++, 'bot', policy);
  const picks: Record<string, number[]> = {};
  let launches = 0, revenue = 0;
  for (let w = 0; w < weeks && !s.over; w++) {
    while (s.moments.length) { if (s.moments[0].kind === 'launch') launches++; s = apply(s, { t: 'dismissMoment' }); }
    const lab = () => s.companies[s.labId];
    let run = handsOnRun(s);
    if (run?.call) {
      const opts = run.call.options;
      let pick = 0;
      if (policy === 'random') pick = Math.floor(u() * opts.length);
      else if (policy === 'lookahead') {
        const vals = opts.map((o) => expected(s, run!.id, o.fx));
        pick = vals.indexOf(Math.max(...vals));
      }
      (picks[run.call.def] ??= opts.map(() => 0))[pick]++;
      s = apply(s, { t: 'answerCall', run: run.id, option: pick });
      run = handsOnRun(s);
    }
    if (!run && lab().cash > 2e6) {
      const budget = 0.35 * lab().cash;
      const k = policy === 'random' ? 1 : policy === 'greedy' ? 12 : 40;
      let best: Blueprint | null = null, bestV = -Infinity;
      for (let i = 0; i < k; i++) {
        const weeksPick = ([4, 6, 8] as const)[Math.floor(u() * 3)];
        const bp = { ...randomBlueprint(s, m, 1, u), weeks: weeksPick };
        bp.compute = Math.max(20, budget / (s.market.computePrice * RUSH[bp.weeks]));
        const f = forecast(s, bp);
        if (f.error) continue;
        const v = policy === 'random' ? 0 : f.profit[1] * HORIZON - f.totalCost;
        if (v > bestV) { best = bp; bestV = v; }
      }
      if (best && (policy === 'random' || bestV > 0 || !Object.values(s.models).some((x) => x.lab === s.labId))) s = apply(s, { t: 'startRun', bp: best, name: 'Bot ' + w });
    }
    if (w % 4 === 0) for (const mdl of Object.values(s.models)) if (mdl.lab === s.labId && !mdl.retired) s = apply(s, { t: 'setPrice', model: mdl.id, price: autoPrice(s, mdl) });
    const co = lab(), burn = co.cost - co.rev;
    if (canRaise(s, co) && (co.cash < 0 || (burn > 0 && co.cash < 6 * burn))) s = apply(s, { t: 'raise' });
    s = endWeek(s);
    revenue += s.companies[s.labId].rev;
  }
  return { s, picks, launches, bust: s.over, revenue };
}
