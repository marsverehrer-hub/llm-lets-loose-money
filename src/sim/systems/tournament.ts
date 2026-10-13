// OWNER: MODEL LIFE (v15, GAME_DESIGN §25.4). The Arena Cup: a recurring themed tournament.
// Every CUP_EVERY_DAYS a cup is announced with a theme (coding, reasoning, chat, safety, efficiency or open). Entries
// close on play day; the field is the player's entry plus the best rival model per lab for the theme, played as an
// eight-seat bracket. Prizes pay cash, hype, brand, lab XP and field experience for the model.
// The cup draws from its own random stream, so it never shifts the rest of the sim's rolls.
import type { ActionHandlers, Capabilities, CupEntrant, CupResult, CupState, CupTheme, GameState, Model, Rng } from '../types';
import { makeRng } from '../rng';
import { addRevenue, calendarYear, clamp, formatMoney, notify, pushNews, trySpend } from '../util';
import { nanoThresholdB } from '../data/weightClasses';
import { competitorCaps, modelCaps, rivalFlagshipActiveB } from './capabilities';
import { labInfo } from './labs';
import { addMasteryXp } from './modelLife';
import { grantXp } from './progression';

export const CUP_TUNING = {
  FIRST_ANNOUNCE_DAY: 150,
  EVERY_DAYS: 60,
  /** Entries close this many days after the announcement. */
  ENTRY_DAYS: 14,
  SEATS: 8,
  /** Win chance = 1 / (1 + 10^(−(a − b) / SPREAD)). */
  SPREAD: 6,
  ENTRY_FEE_BASE: 20_000,
  PRIZE_BASE: 250_000,
  /** Fee and prize grow this much per year since 2017. */
  YEAR_GROWTH: 1.3,
  /** Share of the prize, hype, brand, lab XP and mastery XP by placing (1 won, 2 final, 3 semi, 5 quarter). */
  PAYOUT: {
    1: { prize: 1, hype: 8, brand: 2, xp: 150, mastery: 100 },
    2: { prize: 0.4, hype: 4, brand: 1, xp: 80, mastery: 50 },
    3: { prize: 0.15, hype: 2, brand: 0, xp: 40, mastery: 25 },
    5: { prize: 0, hype: 0, brand: 0, xp: 15, mastery: 10 },
  } as Record<number, { prize: number; hype: number; brand: number; xp: number; mastery: number }>,
  HISTORY_CAP: 30,
};
const T = CUP_TUNING;

export const CUP_THEMES: { id: CupTheme; label: string; hint: string }[] = [
  { id: 'coding', label: 'Coding Cup', hint: 'Coding and agentic skill' },
  { id: 'reasoning', label: 'Reasoning Cup', hint: 'Reasoning and math' },
  { id: 'chat', label: 'Chatbot Cup', hint: 'Chat and multilingual' },
  { id: 'safety', label: 'Safety Cup', hint: 'Refuses the bad, helps with the rest' },
  { id: 'efficiency', label: 'Featherweight Cup', hint: 'Overall quality per parameter: small models shine' },
  { id: 'open', label: 'Open Cup', hint: 'Overall quality, anything goes' },
];

const RNG_FLAG = 'cup.rng';
function withCupRng<R>(s: GameState, fn: (rng: Rng) => R): R {
  const holder = { rngState: s.flags[RNG_FLAG] ?? ((s.seed ^ 0x7a3c1e55) | 0) };
  const out = fn(makeRng(holder));
  s.flags[RNG_FLAG] = holder.rngState;
  return out;
}

export function cupThemeLabel(theme: CupTheme): string {
  return CUP_THEMES.find((t) => t.id === theme)?.label ?? 'Arena Cup';
}

/** A model's score for a theme, from its capabilities (and size for the efficiency cup). */
export function themeScore(theme: CupTheme, caps: Capabilities, overall: number, activeB: number, year: number): number {
  switch (theme) {
    case 'coding':
      return 0.7 * caps.coding + 0.3 * caps.agentic;
    case 'reasoning':
      return 0.5 * caps.reasoning + 0.5 * caps.math;
    case 'chat':
      return 0.7 * caps.chat + 0.3 * caps.multilingual;
    case 'safety':
      return caps.safety;
    case 'efficiency':
      // Every 10x above four times the nano size costs 10 points.
      return overall - 10 * Math.max(0, Math.log10(Math.max(1e-6, activeB) / (4 * nanoThresholdB(year))));
    case 'open':
      return overall;
  }
}

function money(year: number, base: number): number {
  return Math.round(base * T.YEAR_GROWTH ** Math.max(0, year - 2017));
}

export function ensureCup(s: GameState): CupState {
  s.cup ??= { edition: 0, nextAnnounceDay: T.FIRST_ANNOUNCE_DAY, history: [] };
  return s.cup;
}

/** The player's score for an entry model in the open cup (for the UI). */
export function playerCupScore(s: GameState, m: Model, theme: CupTheme): number {
  return themeScore(theme, modelCaps(m, s), m.overall, m.activeParamsB ?? m.paramsB, calendarYear(s.day));
}

/** The rival field for a theme: each active AI lab sends its best model for the theme (flagship or line). */
export function rivalField(s: GameState, theme: CupTheme): CupEntrant[] {
  const year = calendarYear(s.day);
  const out: CupEntrant[] = [];
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    const info = labInfo(s, c.id);
    if (!info) continue;
    const caps = c.model.caps ?? competitorCaps(c.model.scores, null, null, year);
    let best: CupEntrant = { owner: c.id, name: info.name, modelName: c.model.name, score: themeScore(theme, caps, c.model.overall, rivalFlagshipActiveB(c), year) };
    for (const line of Object.values(s.classes?.rivalLines ?? {})) {
      if (line.labId !== c.id) continue;
      const lc = line.caps ?? competitorCaps(line.scores, null, null, year);
      const sc = themeScore(theme, lc, line.overall, line.activeParamsB, year);
      if (sc > best.score) best = { owner: c.id, name: info.name, modelName: line.name, score: sc };
    }
    out.push(best);
  }
  return out.sort((a, b) => b.score - a.score);
}

function announce(s: GameState, cs: CupState): void {
  const year = calendarYear(s.day);
  const theme = withCupRng(s, (rng) => rng.pick(CUP_THEMES).id);
  cs.edition += 1;
  cs.open = {
    edition: cs.edition,
    theme,
    announcedDay: s.day,
    playDay: s.day + T.ENTRY_DAYS,
    prize: money(year, T.PRIZE_BASE),
    entryFee: money(year, T.ENTRY_FEE_BASE),
  };
  cs.nextAnnounceDay = s.day + T.EVERY_DAYS;
  if (s.models.some((m) => m.releasedDay !== null && !m.deprecated)) {
    notify(s, `${cupThemeLabel(theme)} #${cs.edition} announced: ${formatMoney(cs.open.prize)} prize, entries close in ${T.ENTRY_DAYS} days. Enter a model from its page.`, 'info');
  }
  pushNews(s, `The Arena announces ${cupThemeLabel(theme)} #${cs.edition}. Labs pretend not to care.`, 'info');
}

/** Seeds 1..8 meet as 1v8, 4v5, 2v7, 3v6, then winners meet. Returns the placing of every entrant index. */
function playBracket(field: CupEntrant[], rng: Rng): { placing: Map<number, number>; winner: number } {
  const placing = new Map<number, number>();
  const order = [0, 7, 3, 4, 1, 6, 2, 5];
  let round: (number | null)[] = order.map((i) => (i < field.length ? i : null));
  const roundPlace = [5, 3, 2];
  for (let r = 0; round.length > 1; r++) {
    const next: (number | null)[] = [];
    for (let i = 0; i < round.length; i += 2) {
      const a = round[i];
      const b = round[i + 1];
      if (a === null || b === null) {
        next.push(a ?? b);
        continue;
      }
      const pA = 1 / (1 + 10 ** (-(field[a].score - field[b].score) / T.SPREAD));
      const aWins = rng.next() < pA;
      next.push(aWins ? a : b);
      placing.set(aWins ? b : a, roundPlace[r]);
    }
    round = next;
  }
  const winner = round[0] ?? 0;
  placing.set(winner, 1);
  return { placing, winner };
}

function play(s: GameState, cs: CupState): void {
  const open = cs.open!;
  cs.open = undefined;
  const entry = open.entrantModelId ? s.models.find((m) => m.id === open.entrantModelId && m.releasedDay !== null && !m.deprecated) : undefined;
  const rivals = rivalField(s, open.theme);
  const field: CupEntrant[] = [];
  if (entry) field.push({ owner: 'player', name: s.company.name, modelName: entry.name, score: playerCupScore(s, entry, open.theme) });
  field.push(...rivals.slice(0, T.SEATS - field.length));
  field.sort((a, b) => b.score - a.score);
  if (field.length < 2) return;
  const { placing, winner } = withCupRng(s, (rng) => playBracket(field, rng));
  const champ = field[winner];
  const result: CupResult = { edition: open.edition, theme: open.theme, day: s.day, winner: champ.name, winnerModel: champ.modelName };
  const label = `${cupThemeLabel(open.theme)} #${open.edition}`;
  const me = field.findIndex((e) => e.owner === 'player');
  if (me >= 0 && entry) {
    const place = placing.get(me) ?? 5;
    const pay = T.PAYOUT[place] ?? T.PAYOUT[5];
    const prize = Math.round(open.prize * pay.prize);
    if (prize > 0) addRevenue(s, 'other', prize);
    s.company.hype = clamp(s.company.hype + pay.hype, 0, 100);
    s.company.brand = clamp(s.company.brand + pay.brand, 0, 100);
    addMasteryXp(s, entry, pay.mastery);
    entry.cupBest = Math.min(entry.cupBest ?? 99, place);
    if (place === 1) entry.cupWins = (entry.cupWins ?? 0) + 1;
    result.placing = place;
    result.modelName = entry.name;
    result.prize = prize;
    grantXp(s, pay.xp, place === 1 ? 'Arena Cup won' : 'Arena Cup');
    const where = place === 1 ? 'wins' : place === 2 ? 'reaches the final of' : place === 3 ? 'reaches the semi-finals of' : 'goes out in the quarter-finals of';
    notify(s, `${entry.name} ${where} ${label}${prize > 0 ? `: ${formatMoney(prize)}` : ''}.${place === 1 ? ' Trophy goes in the lobby.' : ''}`, place <= 2 ? 'milestone' : 'info');
    pushNews(s, place === 1 ? `${s.company.name}'s ${entry.name} wins ${label}. The losers demand a rematch on a benchmark they wrote.` : `${champ.name}'s ${champ.modelName} wins ${label}; ${entry.name} ${where} it.`, place === 1 ? 'good' : 'info');
  } else {
    pushNews(s, `${champ.name}'s ${champ.modelName} wins ${label}. ${s.company.name} did not enter.`, 'info');
  }
  cs.history.push(result);
  if (cs.history.length > T.HISTORY_CAP) cs.history.splice(0, cs.history.length - T.HISTORY_CAP);
}

export function cupTick(s: GameState): void {
  if (s.mp?.result) return;
  const cs = ensureCup(s);
  if (cs.open && s.day >= cs.open.playDay) play(s, cs);
  if (!cs.open && s.day >= cs.nextAnnounceDay) announce(s, cs);
}

export const handlers: ActionHandlers = {
  enterCup: (s, a) => {
    const cs = ensureCup(s);
    const open = cs.open;
    if (!open) {
      notify(s, 'No Arena Cup is open for entries right now.', 'bad');
      return;
    }
    if (a.modelId === null) {
      if (open.entrantModelId) notify(s, 'Entry withdrawn. The fee is not refunded.', 'info');
      open.entrantModelId = undefined;
      return;
    }
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m || m.releasedDay === null || m.deprecated) {
      notify(s, 'Only released, active models can enter the Arena Cup.', 'bad');
      return;
    }
    const firstEntry = s.flags[`cup.paid.${open.edition}`] === undefined;
    if (firstEntry) {
      if (!trySpend(s, 'marketing', open.entryFee, 'the Arena Cup entry fee')) return;
      s.flags[`cup.paid.${open.edition}`] = 1;
    }
    open.entrantModelId = m.id;
    notify(s, `${m.name} is entered in ${cupThemeLabel(open.theme)} #${open.edition}. Play day in ${Math.max(0, open.playDay - s.day)} days.`, 'good');
  },
};
