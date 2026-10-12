// OWNER: Agent C. Random choice events + ambient headlines.
import type { ActionHandlers, EventDef, GameState, NoticeKind, Rng } from '../types';
import { EVENTS } from '../data/events';
import { HEADLINES, type HeadlineDef } from '../data/headlines';
import { labName } from './labs';
import { calendarYear, notify, pushNews } from '../util';
import { eventWeightMult } from './scenario'; // v9 scenario
import { diffTangible, snapshotTangible } from './eventDeltas';

const NEXT_EVENT = 'nextEventDay';
const NEXT_HEADLINE = 'nextHeadlineDay';
/** No choice events before this day. */
const GRACE_DAYS = 30;
const FALLBACK_RIVAL = 'a rival lab';

/**
 * Fill {company}, {competitor} and {year} in a headline template.
 * {competitor} uses a random active rival, or a generic fallback when none are active.
 */
export function fillTemplate(s: GameState, text: string, rng: Rng): string {
  let out = text.replace(/\{company\}/g, s.company.name).replace(/\{year\}/g, String(calendarYear(s.day)));
  if (out.includes('{competitor}')) {
    const names = s.competitors.filter((c) => c.active).map((c) => labName(s, c.id));
    const rival = names.length > 0 ? rng.pick(names) : FALLBACK_RIVAL;
    const startsWithRival = out.startsWith('{competitor}');
    out = out.replace(/\{competitor\}/g, rival);
    if (startsWithRival && rival === FALLBACK_RIVAL) out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

function headlineApplies(h: HeadlineDef, s: GameState, year: number): boolean {
  if (h.minYear !== undefined && year < h.minYear) return false;
  if (h.maxYear !== undefined && year > h.maxYear) return false;
  return !h.when || h.when(s);
}

function tickHeadlines(s: GameState, rng: Rng): void {
  if (s.flags[NEXT_HEADLINE] === undefined) s.flags[NEXT_HEADLINE] = s.day + 1;
  if (s.day < s.flags[NEXT_HEADLINE]) return;
  s.flags[NEXT_HEADLINE] = s.day + rng.int(3, 5);

  const year = calendarYear(s.day);
  const pool = HEADLINES.filter((h) => headlineApplies(h, s, year));
  if (pool.length === 0) return;
  const recent = new Set(s.news.slice(-40).map((n) => n.text));
  for (let tries = 0; tries < 8; tries++) {
    const h = rng.pick(pool);
    const text = fillTemplate(s, h.text, rng);
    if (!recent.has(text)) {
      const kind: NoticeKind = h.kind ?? 'info';
      pushNews(s, text, kind);
      return;
    }
  }
}

/** Expire temporary effects set by events. getBonuses already ignores expired bonuses; this keeps flags tidy. */
function expireEffects(s: GameState): void {
  const f = s.flags;
  if (f.rentMultUntil !== undefined && f.rentMultUntil < s.day) {
    f.rentMult = 1;
    delete f.rentMultUntil;
  }
  for (const key of Object.keys(f)) {
    if (!key.startsWith('bonusUntil.')) continue;
    if (f[key] < s.day) {
      const name = key.slice('bonusUntil.'.length);
      delete f[key];
      delete f[`bonus.${name}`];
    }
  }
}

/** Weighted pick among events that are eligible right now (weight > 0, off cooldown, not already used if once). */
function pickEvent(s: GameState, rng: Rng): EventDef | null {
  const pool: { def: EventDef; w: number }[] = [];
  for (const def of EVENTS) {
    if (def.once && s.events.fired.includes(def.id)) continue;
    const last = s.events.lastFired[def.id];
    if (last !== undefined && s.day - last < def.cooldownDays) continue;
    const w = def.weight(s) * eventWeightMult(s, def.id); // v9 scenario: difficulty and scenario boosts
    if (Number.isFinite(w) && w > 0) pool.push({ def, w });
  }
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, p) => sum + p.w, 0);
  let r = rng.next() * total;
  for (const p of pool) {
    r -= p.w;
    if (r < 0) return p.def;
  }
  return pool[pool.length - 1].def;
}

export function eventsTick(s: GameState, rng: Rng): void {
  expireEffects(s);
  tickHeadlines(s, rng);

  // While an event awaits a decision (or its result is still on screen), don't start another.
  if (s.events.pending) return;

  if (s.flags[NEXT_EVENT] === undefined) s.flags[NEXT_EVENT] = GRACE_DAYS;
  if (s.day < s.flags[NEXT_EVENT]) return;

  const def = pickEvent(s, rng);
  if (!def) {
    s.flags[NEXT_EVENT] = s.day + 3; // nothing eligible yet, check again soon
    return;
  }
  s.events.pending = { defId: def.id, day: s.day };
  s.events.lastFired[def.id] = s.day;
  if (def.once && !s.events.fired.includes(def.id)) s.events.fired.push(def.id);
  s.flags[NEXT_EVENT] = s.day + rng.int(25, 45);
  pushNews(s, `${def.icon} ${def.title}. Your call.`, 'info');
}

export const handlers: ActionHandlers = {
  resolveEvent: (s, a, rng) => {
    const p = s.events.pending;
    if (!p || p.result !== undefined) return;
    const def = EVENTS.find((e) => e.id === p.defId);
    if (!def) {
      s.events.pending = null; // unknown event: drop it rather than soft-lock the sim
      return;
    }
    const choice = def.choices[a.choice];
    if (!choice) return;
    if (choice.available && !choice.available(s)) {
      notify(s, "You can't afford that option.", 'bad');
      return;
    }
    const before = snapshotTangible(s);
    const result = choice.effect(s, rng).trim() || 'Noted.';
    const deltas = diffTangible(before, s);
    s.events.pending = { defId: p.defId, day: p.day, result, deltas };
    s.flags.eventsResolved = (s.flags.eventsResolved ?? 0) + 1;
  },
  clearEventResult: (s) => {
    if (s.events.pending && s.events.pending.result !== undefined) s.events.pending = null;
  },
};
