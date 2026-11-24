// The turn. Phases run in a fixed order; later milestones slot orders, supply and deals into the marked places.
import type { GameState, Id } from './types';
import { pick, rand } from './rand';
import { aiTick } from './ai';
import { booksTick, BUST_WEEKS, priceTick } from './books';
import { consolidationTick, dealsTick, raidTick } from './deals';
import { demandTick } from './demand';
import { yearEnd, YEAR } from './goals';
import { runTick } from './run';
import { dividends, ordersTick, tycoonTick } from './stock';
import { supplyTick } from './supply';
import { agreementsTick, appsTick, offersTick, projectsTick } from './offers';
import { publicWeek, researchTick, worldTick } from './research';
import { chipsTick } from './chips';
import { MODALITIES } from './content/modalities';
import { TECHS } from './content/tech';
import { FILLER_NEWS } from './content/flavor';

/** Why the week cannot end yet, or null. */
export function blocker(s: GameState): string | null {
  if (s.over) return 'The game is over.';
  if (s.moments.length) return 'Something is waiting for you.';
  if (s.deals.some((d) => d.target === s.labId && d.playerTenders === null)) return 'Someone is bidding for your lab. Answer them.';
  const run = Object.values(s.runs).find((r) => r.status === 'running' && r.handsOn && r.call);
  if (run) return `${run.name} needs a decision.`;
  const chip = Object.values(s.chips).find((c) => c.status === 'running' && c.call);
  return chip ? `${chip.name} needs a decision.` : null;
}

export function endWeek(s0: GameState): GameState {
  if (blocker(s0)) return s0; // 1 gate
  const s = structuredClone(s0);

  // 2 AI intents: every rival CEO acts on start-of-week state.
  for (const co of Object.values(s.companies)) if (co.id !== s.labId || !s.helm) aiTick(s, co);
  // 3 orders: last week's filed orders fill first, then the tycoons trade on what they knew at the start of the week.
  ordersTick(s);
  for (const a of Object.values(s.actors)) if (a.persona) tycoonTick(s, a);
  // 5 runs: pay, progress, report, call. Launches happen here for delegated runs.
  const trainSpend: Record<Id, number> = {};
  const use: Record<Id, number> = {};
  for (const run of Object.values(s.runs)) {
    if (run.status !== 'running') continue;
    const before = run.spent;
    runTick(s, run);
    trainSpend[run.lab] = (trainSpend[run.lab] ?? 0) + run.spent - before;
    use[run.lab] = (use[run.lab] ?? 0) + run.cuPerWeek;
  }
  projectsTick(s);
  chipsTick(s);
  // 7 demand: apps pick partners, shares drift to targets, accounts switch.
  appsTick(s);
  const flow = demandTick(s);
  // 4 supply: next week's compute price follows this week's total appetite.
  for (const [lab, f] of Object.entries(flow)) use[lab] = (use[lab] ?? 0) + f.cu;
  Object.assign(flow, supplyTick(s, use));
  // 8 books
  agreementsTick(s, flow);
  researchTick(s, flow);
  booksTick(s, flow, trainSpend);
  dividends(s);
  // 9 deals: bids that are due close; a weak, diluted player may get raided.
  dealsTick(s);
  raidTick(s);
  consolidationTick(s);
  // 10 prices
  s.market.sentiment = 0.5 * Math.sin((2 * Math.PI * s.week) / 130 + (s.seed % 7)) + 0.1 * (rand(s.seed, s.week, 'mkt', 'sent') - 0.5);
  priceTick(s);

  // 11 world
  for (const seg of Object.values(s.segments)) seg.size *= 1.012;
  // Hype fades fast; star hires drift away slowly.
  for (const co of Object.values(s.companies)) if (co.lab) { co.lab.hype *= 0.93; co.lab.talent += 0.01 * (1 - co.lab.talent); }
  s.week++;
  worldTick(s);
  for (const t of TECHS) if (publicWeek(s, t) === s.week && t.week > 0) s.log.push({ week: s.week - 1, tone: 'info', text: `${t.name} is now public knowledge. Every lab can use it.` });
  for (const m of Object.values(MODALITIES)) if (m.unlockWeek === s.week && s.week > 0) s.log.push({ week: s.week - 1, tone: 'good', text: `${m.name} models are now possible. A new market opens with nobody in it.` });
  if (rand(s.seed, s.week, 'news', 'filler') < 0.35) s.log.push({ week: s.week - 1, tone: 'info', text: pick(FILLER_NEWS, rand(s.seed, s.week, 'news', 'which')) });
  offersTick(s);
  if (s.week % YEAR === 0) yearEnd(s);
  const player = s.companies[s.labId];
  if (s.helm && player && player.negWeeks >= BUST_WEEKS) {
    s.over = true;
    s.moments.push({ kind: 'over', reason: `${player.name} ran out of money for eight weeks straight. The servers were repossessed mid-epoch.` });
  }
  // 12 wrap
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  return s;
}

/** Keep ending weeks until something needs the player. Returns the new state and how many weeks passed. */
export function fastForward(s0: GameState, max = 12): { s: GameState; weeks: number } {
  let s = s0, weeks = 0;
  while (weeks < max && !blocker(s)) {
    s = endWeek(s);
    weeks++;
    const co = s.companies[s.labId];
    const burn = co.cost - co.rev;
    const rivalShip = s.log.some((n) => n.week === s.week - 1 && n.co && n.co !== s.labId && n.text.includes('ships'));
    if (blocker(s) || rivalShip || (s.helm && burn > 0 && co.cash < 8 * burn) || s.deals.some((d) => d.target === s.labId || d.bidder === s.labId || d.bidder === s.playerId)
      || s.offers.some((o) => o.big && o.expires === s.week + 2)) break;
  }
  return { s, weeks };
}
