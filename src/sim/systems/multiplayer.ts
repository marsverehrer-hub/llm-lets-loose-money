// OWNER: Agent MP-SIM. 1v1 online multiplayer, sim side. See GAME_DESIGN.md §15.
// Public API (UI + net code depend on these signatures; keep them stable).
import type {
  ActionHandlers,
  Competitor,
  CompetitorModel,
  GameState,
  MpRole,
  MpSettings,
  MpState,
  ProductKind,
  RivalAttack,
  RivalAttackKind,
  RivalSnapshot,
  Rng,
  Segment,
} from '../types';
import { MP_RIVAL_ID, SEGMENT_OF } from '../types';
import { BALANCE } from '../balance';
import { activeBenchmarks } from './capabilities';
import { datasetById } from './data';
import { labName } from './labs';
import { PLAYER_COLOR, bestPlayerModel, primaryProduct } from './market';
import { addExpense, calendarYear, clamp, formatMoney, notify, pushNews, trySpend } from '../util';

export interface AttackDef {
  kind: RivalAttackKind;
  name: string;            // sentence case, e.g. "Poach staff"
  description: string;     // one line, what it does to the rival
  baseCost: number;        // $ in 2017; scales with year
  cooldownDays: number;
}

export const ATTACKS: Record<RivalAttackKind, AttackDef> = {
  poach: {
    kind: 'poach',
    name: 'Poach staff',
    description: 'Lure away 8% of their researchers and engineers (at least one). Morale drops.',
    baseCost: 2_000_000,
    cooldownDays: 120,
  },
  smear: {
    kind: 'smear',
    name: 'Smear campaign',
    description: 'Anonymous blog post. Their hype -15 and reputation -4.',
    baseCost: 1_000_000,
    cooldownDays: 90,
  },
  leak: {
    kind: 'leak',
    name: 'Leak their run',
    description: 'Their training run loses 10% progress (or research loses 25%). Reputation -2.',
    baseCost: 3_000_000,
    cooldownDays: 180,
  },
  undercut: {
    kind: 'undercut',
    name: 'Undercut prices',
    description: 'For 30 days your prices look 15% cheaper in their market.',
    baseCost: 500_000,
    cooldownDays: 60,
  },
};

// Effect tuning (see GAME_DESIGN.md §15 "Attacks").
const POACH_FRACTION = 0.08;
const POACH_MORALE_HIT = 6;
const POACH_MORALE_SAFE_ABOVE = 75;
const SMEAR_HYPE = 15;
const SMEAR_REPUTATION = 4;
const LEAK_RUN_FRACTION = 0.1;
const LEAK_RESEARCH_FRACTION = 0.25;
const LEAK_REPUTATION = 2;
const UNDERCUT_DAYS = 30;
const HISTORY_EVERY_DAYS = 7;
const LOG_CAP = 100;
const CHAT_MAX = 200;
/** A chat line of this shape is a concession (sent by mpConcede, read by the other side). Users can't type it. */
const CONCEDE_RE = /concedes\.$/i;
const KINDS: ProductKind[] = ['chat', 'api', 'enterprise'];

export interface AttackStatus { ok: boolean; reason?: string; cost: number; readyDay: number }

/** Cost of an attack in the current year: baseCost x (1 + year - 2017) x 0.5. */
export function attackCost(s: GameState, kind: RivalAttackKind): number {
  return ATTACKS[kind].baseCost * (1 + (calendarYear(s.day) - BALANCE.START_YEAR)) * 0.5;
}

export function attackStatus(s: GameState, kind: RivalAttackKind): AttackStatus {
  const cost = attackCost(s, kind);
  const readyDay = s.mp?.cooldowns[kind] ?? 0;
  const fail = (reason: string): AttackStatus => ({ ok: false, reason, cost, readyDay });
  const mp = s.mp;
  if (!mp) return fail('Not in a multiplayer match.');
  if (mp.result) return fail('The match is over.');
  if (!mp.connected) return fail('The rival is not connected.');
  if (!mp.rival) return fail('No intel on the rival yet.');
  if (s.day < readyDay) return fail(`On cooldown for ${readyDay - s.day} more days.`);
  if (s.finance.cash < cost) return fail(`Not enough cash (need ${formatMoney(cost)}).`);
  return { ok: true, cost, readyDay };
}

export interface CrownRow { benchId: string; name: string; mine: number | null; rival: number | null; leader: 'me' | 'rival' | 'tie' | 'none' }
/**
 * Per-benchmark head-to-head between the player's best released model and the rival's snapshot model.
 * `leader` is 'none' unless both sides have a score on that benchmark.
 */
export function crownTable(s: GameState): CrownRow[] {
  if (!s.mp) return [];
  const mine = bestPlayerModel(s);
  const rival = s.mp.rival?.model ?? null;
  return activeBenchmarks(s).map((b) => {
    const m = mine?.benchmarks?.[b.id] ?? null;
    const r = rival?.benchmarks?.[b.id] ?? null;
    let leader: CrownRow['leader'] = 'none';
    if (m !== null && r !== null) leader = m > r ? 'me' : r > m ? 'rival' : 'tie';
    return { benchId: b.id, name: b.name, mine: m, rival: r, leader };
  });
}

/** Last day of the match (1 Jan of 2017 + lengthYears), or null for endless. */
function matchEndDay(mp: MpState): number | null {
  const len = mp.settings.lengthYears;
  if (len === null || len === undefined) return null;
  return Math.round((Date.UTC(BALANCE.START_YEAR + len, 0, 1) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000);
}

/** Days until the match ends, or null for endless / not in MP. */
export function matchDaysLeft(s: GameState): number | null {
  if (!s.mp) return null;
  const end = matchEndDay(s.mp);
  return end === null ? null : Math.max(0, end - s.day);
}

function rivalName(s: GameState): string {
  return labName(s, MP_RIVAL_ID);
}

function addLog(s: GameState, kind: MpState['log'][number]['kind'], text: string): void {
  const mp = s.mp;
  if (!mp) return;
  mp.log.push({ day: s.day, text, kind });
  if (mp.log.length > LOG_CAP) mp.log.splice(0, mp.log.length - LOG_CAP);
}

function makeRivalEntry(): Competitor {
  return {
    id: MP_RIVAL_ID,
    human: true,
    active: true,
    model: null,
    // Infinity = not offered; the market skips non-finite prices.
    prices: { chat: Infinity, api: Infinity, enterprise: Infinity },
    users: { consumer: 0, developer: 0, enterprise: 0 },
    brand: 10,
    valuation: 0,
    nextReleaseDay: 1e9,
    modelsReleased: 0,
  };
}

function rivalEntry(s: GameState): Competitor | undefined {
  return s.competitors.find((c) => c.id === MP_RIVAL_ID);
}

function cloneModel(m: CompetitorModel): CompetitorModel {
  return {
    ...m,
    scores: { ...m.scores },
    caps: m.caps ? { ...m.caps } : undefined,
    benchmarks: m.benchmarks ? { ...m.benchmarks } : undefined,
  };
}

export function startMpState(s: GameState, o: { role: MpRole; room: string; settings: MpSettings; myColor: string }): void {
  // The first-run tutorial would stall a live match; versus players skip it.
  s.tutorialStep = -1;
  s.mp = {
    role: o.role,
    room: o.room,
    settings: { ...o.settings },
    myColor: o.myColor,
    rival: null,
    rivalDay: 0,
    connected: false,
    outbox: [],
    cooldowns: {},
    log: [],
    history: [],
    result: null,
  };
  s.competitors = s.competitors.filter((c) => c.id !== MP_RIVAL_ID);
  s.competitors.push(makeRivalEntry());
  addLog(s, 'info', 'Match started. Waiting for the other player.');
}

/** The player's own public state, as sent to the rival. */
export function buildSnapshot(s: GameState): RivalSnapshot {
  const best = bestPlayerModel(s);
  const model: CompetitorModel | null = best
    ? {
        name: best.name,
        scores: { ...best.scores },
        overall: best.overall,
        elo: best.elo,
        releasedDay: best.releasedDay ?? s.day,
        caps: best.caps ? { ...best.caps } : undefined,
        benchmarks: best.benchmarks ? { ...best.benchmarks } : undefined,
      }
    : null;

  const prices: Partial<Record<ProductKind, number>> = {};
  const users: Record<Segment, number> = { consumer: 0, developer: 0, enterprise: 0 };
  // v8: a snapshot carries one price per kind, the primary line's (most users). Users sum over all lines.
  for (const p of s.products) {
    if (!p.active) continue;
    users[SEGMENT_OF[p.kind]] += p.users;
  }
  for (const kind of ['api', 'chat', 'enterprise'] as ProductKind[]) {
    const primary = primaryProduct(s, kind);
    if (primary) prices[kind] = primary.price;
  }

  const exclusives = s.data.owned.filter((id) => datasetById(s, id)?.exclusive);

  return {
    day: s.day,
    companyName: s.company.name,
    color: s.mp?.myColor ?? PLAYER_COLOR,
    model,
    prices,
    users,
    brand: s.company.brand,
    hype: s.company.hype,
    reputation: s.company.reputation,
    valuation: s.finance.valuation,
    cash: s.finance.cash,
    revenuePerDay: s.finance.dailyRevenue,
    isPublic: s.company.isPublic,
    modelsReleased: s.stats.modelsReleased,
    researchDone: s.research.completed.length,
    exclusives,
    bankrupt: !!s.gameOver,
    // The host's AI labs are the reference world (v12): the guest mirrors them so both arenas match.
    ...(s.mp?.role === 'host' ? { labs: JSON.parse(JSON.stringify(s.competitors.filter((c) => !c.human))) as Competitor[] } : {}),
  };
}

/** Crown lead changes, logged once per change. Flags `mpCrown:<benchId>`: 1 = me, -1 = rival, 0 = none/tie. */
function checkCrowns(s: GameState): void {
  if (!s.mp) return;
  for (const row of crownTable(s)) {
    const key = `mpCrown:${row.benchId}`;
    const now = row.leader === 'me' ? 1 : row.leader === 'rival' ? -1 : 0;
    const before = s.flags[key] ?? 0;
    if (now === before) continue;
    s.flags[key] = now;
    if (now === 1) addLog(s, 'me', `You take the crown on ${row.name}.`);
    else if (now === -1) addLog(s, 'rival', `${rivalName(s)} takes the crown on ${row.name}.`);
  }
}

/**
 * Guest only (v12): copy the host's AI labs over ours. Market numbers that each world computes for itself (users)
 * and how much a lab has it in for *this* player (rivalry) stay local. A new flagship makes the usual release news.
 */
export function applyHostLabs(s: GameState): void {
  const labs = s.mp?.role === 'guest' ? s.mp.hostLabs : undefined;
  if (!labs) return;
  for (const src of labs) {
    if (src.human || src.id === MP_RIVAL_ID) continue;
    const c = s.competitors.find((x) => x.id === src.id);
    if (!c) continue;
    const before = c.model?.name ?? null;
    c.active = src.active;
    c.model = src.model ? (JSON.parse(JSON.stringify(src.model)) as CompetitorModel) : null;
    c.prices = { ...src.prices };
    c.brand = src.brand;
    c.valuation = src.valuation;
    c.nextReleaseDay = src.nextReleaseDay;
    c.modelsReleased = src.modelsReleased;
    if (c.model && before !== null && before !== c.model.name) {
      pushNews(s, `${labName(s, c.id)} releases ${c.model.name}.`, 'info');
    }
  }
}

export function applyRivalSnapshot(s: GameState, snap: RivalSnapshot): void {
  const mp = s.mp;
  if (!mp) return;
  const prev = mp.rival;
  mp.rival = snap;
  mp.rivalDay = snap.day;
  if (mp.role === 'guest' && snap.labs) {
    mp.hostLabs = snap.labs;
    applyHostLabs(s);
  }

  let c = rivalEntry(s);
  if (!c) {
    c = makeRivalEntry();
    s.competitors.push(c);
  }
  c.active = true;
  c.model = snap.model ? cloneModel(snap.model) : null;
  for (const k of KINDS) c.prices[k] = snap.prices[k] ?? Infinity;
  c.brand = clamp(snap.brand, 0, 100);
  c.valuation = snap.valuation;

  // Exclusive partnerships the rival holds are off the market for us. Conflicts: the host keeps its copy, the guest loses it.
  if (!s.data.lost) s.data.lost = [];
  for (const id of snap.exclusives) {
    if (!s.data.lost.includes(id)) s.data.lost.push(id);
    if (!s.data.owned.includes(id) || mp.role === 'host') continue;
    const name = datasetById(s, id)?.name ?? id;
    s.data.owned = s.data.owned.filter((x) => x !== id);
    if (s.data.licenses) delete s.data.licenses[id];
    const flag = `mpRefund.${id}`;
    if (s.flags[flag] === undefined) {
      const fee = datasetById(s, id)?.annualFee ?? 0;
      // Refund the first-year fee as a negative expense, once.
      if (fee > 0) addExpense(s, 'data', -fee);
      s.flags[flag] = s.day;
    }
    const text = `${snap.companyName} signed ${name} first. Your licence is void and the first year's fee is refunded.`;
    notify(s, text, 'bad');
    addLog(s, 'rival', text);
  }

  if (snap.model && (!prev?.model || prev.model.name !== snap.model.name)) {
    const text = `${snap.companyName} ships ${snap.model.name} (overall ${snap.model.overall.toFixed(0)}).`;
    pushNews(s, text, 'info');
    addLog(s, 'rival', text);
  }

  checkCrowns(s);
}

function poachStaff(s: GameState): number {
  const roles = s.staff.roles;
  const total = roles.researcher.count + roles.engineer.count;
  if (total <= 0) return 0;
  const want = Math.min(total, Math.max(1, Math.round(total * POACH_FRACTION)));
  let lost = 0;
  while (lost < want) {
    const role = roles.researcher.count >= roles.engineer.count ? roles.researcher : roles.engineer;
    if (role.count <= 0) break;
    role.count -= 1;
    lost += 1;
  }
  return lost;
}

/** Effect of a rival attack on our state. The sender's cost and cooldown were paid on their side. */
export function applyRivalAttack(s: GameState, a: RivalAttack): void {
  const mp = s.mp;
  if (!mp || mp.result) return;
  const from = a.from || rivalName(s);
  const report = (text: string) => {
    notify(s, text, 'bad');
    addLog(s, 'rival', text);
  };

  switch (a.kind) {
    case 'poach': {
      const hit = s.staff.morale > POACH_MORALE_SAFE_ABOVE ? POACH_MORALE_HIT / 2 : POACH_MORALE_HIT;
      const lost = poachStaff(s);
      s.staff.morale = clamp(s.staff.morale - hit, 0, 100);
      report(
        lost > 0
          ? `${from} poached ${lost} ${lost === 1 ? 'person' : 'people'} from your research and engineering teams.`
          : `${from} tried to poach your staff. Morale took a hit anyway.`,
      );
      break;
    }
    case 'smear': {
      s.company.hype = clamp(s.company.hype - SMEAR_HYPE, 0, 100);
      s.company.reputation = clamp(s.company.reputation - SMEAR_REPUTATION, 0, 100);
      pushNews(s, `Anonymous blog post claims ${s.company.name} trains on dolphins.`, 'bad');
      report(`A smear campaign from ${from} is circulating. Hype and reputation are down.`);
      break;
    }
    case 'leak': {
      if (s.training) {
        s.training.doneFlops *= 1 - LEAK_RUN_FRACTION;
        report(`${from} leaked your training notes. The current run lost ${LEAK_RUN_FRACTION * 100}% progress.`);
      } else {
        s.research.progress *= 1 - LEAK_RESEARCH_FRACTION;
        report(`${from} leaked your research notes. Research progress lost ${LEAK_RESEARCH_FRACTION * 100}%.`);
      }
      s.company.reputation = clamp(s.company.reputation - LEAK_REPUTATION, 0, 100);
      break;
    }
    case 'undercut': {
      s.flags['mpUndercutUntil'] = s.day + UNDERCUT_DAYS;
      report(`${from} is undercutting your prices for ${UNDERCUT_DAYS} days.`);
      break;
    }
  }
}

const SENDER_LINES: Record<RivalAttackKind, (rival: string) => string> = {
  poach: (r) => `You poached staff from ${r}. Allegedly.`,
  smear: (r) => `You published an anonymous blog post about ${r}. Nobody saw you do it.`,
  leak: (r) => `You leaked ${r}'s training notes to a journalist.`,
  undercut: (r) => `You undercut ${r}'s prices for ${UNDERCUT_DAYS} days.`,
};

export function mpSetConnected(s: GameState, on: boolean): void {
  const mp = s.mp;
  if (!mp || mp.connected === on) return;
  mp.connected = on;
  const name = rivalName(s);
  // On first connect the rival's snapshot (and name) hasn't arrived yet.
  if (on) addLog(s, 'info', mp.rival ? `Connected to ${name}.` : 'Connected to the other player.');
  else {
    addLog(s, 'info', `Lost connection to ${name}.`);
    notify(s, `Lost connection to ${name}.`, 'bad');
  }
}

/** Incoming chat from the rival → log. A concession line ends the match in our favour. */
export function mpReceiveChat(s: GameState, text: string): void {
  const mp = s.mp;
  if (!mp) return;
  const clean = String(text ?? '').trim().slice(0, CHAT_MAX);
  if (!clean) return;
  if (CONCEDE_RE.test(clean)) {
    finish(s, 'me', 'Rival conceded');
    return;
  }
  addLog(s, 'chat', `${rivalName(s)}: ${clean}`);
}

function finish(s: GameState, winner: 'me' | 'rival' | 'draw', reason: string): void {
  const mp = s.mp;
  if (!mp || mp.result) return;
  mp.result = { winner, reason, day: s.day };
  const verdict = winner === 'me' ? 'You win.' : winner === 'rival' ? `${rivalName(s)} wins.` : 'It is a draw.';
  addLog(s, 'info', `${verdict} ${reason}.`);
}

/** Daily: history sampling, connection gate and win checks. Call after the other systems each day. */
export function mpTick(s: GameState, _rng: Rng): void {
  const mp = s.mp;
  if (!mp || mp.result) return;
  if (s.day % HISTORY_EVERY_DAYS === 0 && mp.history[mp.history.length - 1]?.day !== s.day) {
    mp.history.push({ day: s.day, me: s.finance.valuation, rival: mp.rival?.valuation ?? 0 });
  }
  if (!mp.connected) return;

  checkCrowns(s);

  if (mp.rival?.bankrupt) {
    finish(s, 'me', 'Rival went bankrupt');
    return;
  }
  if (s.gameOver) {
    finish(s, 'rival', 'Your company went under');
    return;
  }
  const end = matchEndDay(mp);
  if (end !== null && s.day >= end) {
    const mine = s.finance.valuation;
    const theirs = mp.rival?.valuation ?? 0;
    if (Math.abs(mine - theirs) <= 0.01 * Math.max(mine, theirs)) finish(s, 'draw', 'Match length reached with valuations within 1%');
    else finish(s, mine > theirs ? 'me' : 'rival', 'Match length reached, higher valuation wins');
  }
}

export const handlers: ActionHandlers = {
  mpAttack: (s, a) => {
    const mp = s.mp;
    if (!mp) return;
    const st = attackStatus(s, a.kind);
    if (!st.ok) {
      notify(s, st.reason ?? 'Not available right now.', 'bad');
      return;
    }
    const def = ATTACKS[a.kind];
    if (!trySpend(s, 'marketing', st.cost, def.name)) return;
    mp.cooldowns[a.kind] = s.day + def.cooldownDays;
    mp.outbox.push({ t: 'attack', attack: { kind: a.kind, day: s.day, from: s.company.name } });
    addLog(s, 'me', SENDER_LINES[a.kind](rivalName(s)));
  },
  mpChat: (s, a) => {
    const mp = s.mp;
    if (!mp) return;
    const text = String(a.text ?? '').trim().slice(0, CHAT_MAX);
    if (!text) return;
    if (CONCEDE_RE.test(text)) {
      notify(s, 'Use the Concede button to concede.', 'info');
      return;
    }
    mp.outbox.push({ t: 'chat', text });
    addLog(s, 'chat', `${s.company.name}: ${text}`);
  },
  mpConcede: (s) => {
    const mp = s.mp;
    if (!mp || mp.result) return;
    mp.outbox.push({ t: 'chat', text: `${s.company.name} concedes.` });
    finish(s, 'rival', 'You conceded');
  },
};
