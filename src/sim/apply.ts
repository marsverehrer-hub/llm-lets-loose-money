// Every player action goes through here. Invalid actions return the same state object.
import type { Action, GameState } from './types';
import { raise } from './books';
import { PRICE_STEPS } from './demand';
import { RUSH, validate } from './resolve';
import { answerCall, money, startRun } from './run';
import { MODALITIES } from './content/modalities';

export const dataCost = (s: GameState, base: number, level: number): number => base * (level + 1) * Math.pow(1.5, Math.floor(s.week / 48));
export const handsOnRun = (s: GameState) => Object.values(s.runs).find((r) => r.lab === s.labId && r.status === 'running' && r.handsOn);

/** Why an action is not allowed, or null. The UI uses this to disable buttons with a reason. */
export function check(s: GameState, a: Action): string | null {
  const co = s.companies[s.labId];
  if (s.over && a.t !== 'dismissMoment') return 'The game is over.';
  if (a.t === 'startRun') {
    if (handsOnRun(s)) return 'You can only train one model hands-on at a time.';
    if (!a.name.trim()) return 'Give the model a codename.';
    const err = validate(s, s.labId, a.bp);
    if (err) return err;
    const first = (a.bp.compute / a.bp.weeks) * s.market.computePrice * RUSH[a.bp.weeks];
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
    case 'tutorial': s.tutorial = a.step; break;
  }
  return s;
}
