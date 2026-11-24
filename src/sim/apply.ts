// Every player action goes through here. Invalid actions return the same state object.
import type { Action, GameState } from './types';
import { canRaise, raise } from './books';
import { debtRoom, openTender, tenderCheck } from './deals';
import { PRICE_STEPS } from './demand';
import { RUSH, validate } from './resolve';
import { answerCall, money, startRun } from './run';
import { floatOf, quote, stake, trade, tradeCheck } from './stock';
import { CONTRACT_WEEKS, contractCheck, contractPrice, playerControls, trainPrice } from './supply';
import { answerOffer, projectCheck, startProject, upfront } from './offers';
import { RATES, researchable } from './research';
import { answerChip, buildDatacenter, chipCheck, datacenterCheck, startChip } from './chips';
import { MODALITIES } from './content/modalities';

export const dataCost = (s: GameState, base: number, level: number): number => base * (level + 1) * Math.pow(1.5, Math.floor(s.week / 48));
export const handsOnRun = (s: GameState) => Object.values(s.runs).find((r) => r.lab === s.labId && r.status === 'running' && r.handsOn);
export const BUYBACK = 0.03; // of shares outstanding
export const PAYOUTS = [0, 0.1, 0.25, 0.5];
/** Actions that need you to be running the lab, not just owning shares in it. */
const HELM = new Set<Action['t']>(['startRun', 'answerCall', 'setPrice', 'retire', 'buyData', 'raise', 'buyback', 'borrow', 'payout', 'contract', 'answerOffer', 'project', 'research', 'datacenter']);

/** Why an action is not allowed, or null. The UI uses this to disable buttons with a reason. */
export function check(s: GameState, a: Action): string | null {
  const co = s.companies[s.labId];
  if (s.over && a.t !== 'dismissMoment') return 'The game is over.';
  if (HELM.has(a.t) && !s.helm) return 'You no longer run a lab. Buy control of one on the Street.';
  if (a.t === 'startRun') {
    if (handsOnRun(s)) return 'You can only train one model hands-on at a time.';
    if (!a.name.trim()) return 'Give the model a codename.';
    const err = validate(s, s.labId, a.bp);
    if (err) return err;
    const first = (a.bp.compute / a.bp.weeks) * trainPrice(s, s.labId) * RUSH[a.bp.weeks];
    if (co.cash < first) return `You cannot cover the first week (${money(first)}).`;
  }
  if (a.t === 'answerCall') { const r = s.runs[a.run]; if (!r?.call?.options[a.option]) return 'No such option.'; }
  if (a.t === 'setPrice' && (!s.models[a.model] || s.models[a.model].lab !== s.labId || !PRICE_STEPS.includes(a.price))) return 'Cannot set that price.';
  if (a.t === 'retire' && s.models[a.model]?.lab !== s.labId) return 'Not your model.';
  if (a.t === 'buyData') {
    const def = Object.values(MODALITIES).flatMap((m) => m.data).find((d) => d.id === a.kind);
    const level = co.lab!.data[a.kind] ?? 0;
    if (!def) return 'Unknown data.';
    if (level >= 3) return 'You already license all of it.';
    if (co.cash < dataCost(s, def.cost, level)) return 'Not enough cash.';
  }
  if (a.t === 'raise' && !canRaise(s, co)) return 'The bankers need a few more weeks.';
  if (a.t === 'trade') return tradeCheck(s, s.playerId, a.company, a.shares);
  if (a.t === 'buyback') {
    const n = BUYBACK * co.shares;
    if (s.orders.some((o) => o.owner === co.id)) return 'A buyback is already filed.';
    if (floatOf(s, co.id) < n) return 'Not enough shares on the market.';
    if (co.cash < quote(s, co.id, n)) return 'The lab cannot afford it.';
  }
  if (a.t === 'borrow') {
    if (!a.amount) return 'Nothing to borrow.';
    if (a.amount > debtRoom(co) + 1) return `Lenders will go to ${money(debtRoom(co))} more.`;
    if (a.amount < 0 && (-a.amount > co.debt + 1 || -a.amount > co.cash)) return 'Cannot repay that much.';
  }
  if (a.t === 'payout' && !PAYOUTS.includes(a.rate)) return 'Pick a payout rate.';
  if (a.t === 'tender') {
    if (a.as === 'lab' && !s.helm) return 'You no longer run a lab.';
    return tenderCheck(s, a.as === 'lab' ? s.labId : s.playerId, a.as === 'lab', a.target, a.premium);
  }
  if (a.t === 'defend') {
    const d = s.deals.find((x) => x.id === a.deal);
    if (!d || d.playerTenders !== null) return 'Nothing to answer.';
    if (a.choice === 'pill' && (!s.helm || d.target !== s.labId || s.companies[d.target].pill)) return 'No pill available.';
  }
  if (a.t === 'helm') {
    if (!s.companies[a.company]?.lab || stake(s, s.playerId, a.company) < 0.5) return 'You need half the shares of a lab to take its helm.';
    if (s.helm && s.labId === a.company) return 'You already run it.';
    if (handsOnRun(s)) return 'Finish your current run first.';
  }
  if (a.t === 'contract') return contractCheck(s, a.units);
  if (a.t === 'lever') {
    const c = s.companies[a.company];
    if (!c?.plant || !playerControls(s, a.company)) return 'You do not control that company.';
    if (a.block && (a.block === s.labId || !s.companies[a.block]?.lab)) return 'Pick a rival lab.';
    if (a.block && s.week < c.plant.decreeUntil) return 'Regulators forbid it for now.';
  }
  if (a.t === 'answerOffer') {
    const opt = s.offers.find((o) => o.id === a.offer)?.call.options[a.option];
    if (!opt) return 'No such offer.';
    if (upfront(opt.fx) > Math.max(0, co.cash)) return `The lab cannot pay ${money(upfront(opt.fx))} right now.`;
  }
  if (a.t === 'project') return projectCheck(s, a.model, a.kind, a.seg);
  if (a.t === 'startChip') return chipCheck(s, a.company, a.bp, a.name);
  if (a.t === 'answerChip' && !s.chips[a.chip]?.call?.options[a.option]) return 'No such option.';
  if (a.t === 'datacenter') return datacenterCheck(s, a.units);
  if (a.t === 'research') {
    if (a.rate != null && !RATES.includes(a.rate)) return 'Pick a research budget.';
    if (a.aim && !researchable(s, s.labId).some((t) => t.id === a.aim)) return 'That cannot be researched now.';
  }
  if (a.t === 'dismissMoment' && !s.moments.length) return 'Nothing to dismiss.';
  return null;
}

export function apply(s0: GameState, a: Action): GameState {
  if (check(s0, a)) return s0;
  const s = structuredClone(s0);
  const co = s.companies[s.labId];
  switch (a.t) {
    case 'startRun': startRun(s, s.labId, a.bp, a.name.trim(), true); break;
    case 'answerCall': {
      const run = s.runs[a.run];
      const def = run.call!.def;
      if (a.always && !def.startsWith('beat.') && def !== 'emergence') s.standing[def] = a.option;
      answerCall(s, run, a.option);
      break;
    }
    case 'clearStanding': delete s.standing[a.def]; break;
    case 'dismissOutcome': s.runs[a.run].outcome = null; break;
    case 'dismissMoment': s.moments.shift(); break;
    case 'setPrice': s.models[a.model].price = a.price; break;
    case 'retire': s.models[a.model].retired = !s.models[a.model].retired; break;
    case 'buyData': {
      const def = Object.values(MODALITIES).flatMap((m) => m.data).find((d) => d.id === a.kind)!;
      const level = co.lab!.data[a.kind] ?? 0;
      co.cash -= dataCost(s, def.cost, level);
      co.lab!.data[a.kind] = level + 1;
      break;
    }
    case 'raise': {
      const got = raise(s, co);
      s.log.push({ week: s.week, co: co.id, tone: 'info', text: `You sold new shares for ${money(got)}. Everyone owns a little less.` });
      break;
    }
    case 'trade': trade(s, s.playerId, a.company, a.shares); break;
    case 'buyback': trade(s, co.id, co.id, BUYBACK * co.shares); break;
    case 'borrow': co.cash += a.amount; co.debt += a.amount; break;
    case 'payout': co.payout = a.rate; break;
    case 'tender': openTender(s, a.as === 'lab' ? s.labId : s.playerId, a.as === 'lab', a.target, a.premium); break;
    case 'defend': {
      const d = s.deals.find((x) => x.id === a.deal)!;
      d.playerTenders = a.choice === 'tender';
      if (a.choice === 'pill') {
        const t = s.companies[d.target];
        t.pill = true;
        t.lab!.brand = Math.max(0, t.lab!.brand - 0.05);
        s.log.push({ week: s.week, co: t.id, tone: 'info', text: `${t.name} adopts a poison pill. Governance experts tut.` });
      }
      break;
    }
    case 'helm': {
      const old = s.companies[s.labId];
      if (old && s.helm) old.ceo = { name: 'Interim CEO', style: 'follower', skill: 0.5, ego: 0.3 };
      s.labId = a.company;
      s.helm = true;
      s.companies[a.company].ceo = { name: 'You', style: 'hype', skill: 0.5, ego: 0.5 };
      s.log.push({ week: s.week, co: a.company, tone: 'good', text: `You take the helm at ${s.companies[a.company].name}.` });
      break;
    }
    case 'contract':
      s.contracts.push({ lab: s.labId, units: a.units, price: contractPrice(s), until: s.week + CONTRACT_WEEKS });
      s.log.push({ week: s.week, co: s.labId, tone: 'info', text: `You sign a year of compute at ${money(contractPrice(s))} a unit.` });
      break;
    case 'lever': {
      const p = s.companies[a.company].plant!;
      if (a.posture != null) p.posture = a.posture;
      if (a.capex != null) p.capex = a.capex;
      if (a.block) p.blocked = p.blocked.includes(a.block) ? p.blocked.filter((x) => x !== a.block) : [...p.blocked, a.block];
      break;
    }
    case 'answerOffer': answerOffer(s, a.offer, a.option); break;
    case 'project': startProject(s, a.model, a.kind, a.seg); break;
    case 'research': if (a.rate != null) co.lab!.research.rate = a.rate; if (a.aim !== undefined) co.lab!.research.aim = a.aim; break;
    case 'startChip': startChip(s, a.company, a.bp, a.name.trim()); break;
    case 'answerChip': answerChip(s, a.chip, a.option); break;
    case 'datacenter': buildDatacenter(s, a.units); break;
    case 'tutorial': s.tutorial = a.step; break;
  }
  return s;
}
