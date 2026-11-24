// Takeovers. A company bids to absorb another lab (merge); a person bids for control (51%).
// A bid is open for two weeks, then the shares decide: the float follows the premium, tycoons follow their ego.
import type { Company, Deal, GameState, Id } from './types';
import { clamp, rand } from './rand';
import { addShares, controller, floatOf, sharesOf } from './stock';
import { money } from './run';

export const PREMIUMS = [0.15, 0.25, 0.35, 0.5, 0.7];
export const CONTROL = 0.51;

/** Corporate borrowing limit: three years of smoothed profit, with a small floor so young labs can borrow a little. */
export const borrowCap = (co: Company): number => Math.max(5e6, 3 * 48 * Math.max(0, co.ni8));
export const debtRoom = (co: Company): number => Math.max(0, borrowCap(co) - co.debt);
export const interestRate = (co: Company): number => 0.06 + 0.03 * Math.max(0, co.debt / Math.max(1, 48 * Math.max(1, co.ni8)) - 2);

const avg4 = (co: Company): number => { const h = co.hist.slice(-4); return h.length ? h.reduce((a, b) => a + b, 0) / h.length : co.price; };

/** Offer price per share, how many shares the bidder must buy, and the bill. */
export function tenderTerms(s: GameState, bidder: Id, merge: boolean, target: Id, premium: number): { offer: number; shares: number; cost: number } {
  const t = s.companies[target];
  const offer = avg4(t) * (1 + premium);
  const own = sharesOf(s, bidder, target);
  const shares = Math.max(0, (merge ? t.shares : Math.ceil(CONTROL * t.shares)) - own);
  return { offer, shares, cost: shares * offer };
}

/** How hard the target is to buy: the premium at which the float starts to tender. */
function resistance(co: Company): number {
  const mom = co.price / (co.hist[Math.max(0, co.hist.length - 13)] ?? co.price) - 1;
  return 0.1 + 0.15 * Math.max(0, mom) + (co.pill ? 0.2 : 0);
}

/** Chance regulators block a merger, from the two labs' combined share of all lab revenue. */
export function blockChance(s: GameState, a: Id, b: Id): number {
  const total = Object.values(s.companies).reduce((x, c) => x + (c.lab ? c.rev : 0), 0);
  const share = total > 0 ? (s.companies[a].rev + s.companies[b].rev) / total : 0;
  return clamp(2 * (share - 0.4), 0, 0.9);
}

export function tenderCheck(s: GameState, bidder: Id, merge: boolean, target: Id, premium: number): string | null {
  const t = s.companies[target];
  if (!t?.lab || target === bidder) return 'Not a valid target.';
  if (!PREMIUMS.includes(premium)) return 'Pick a premium.';
  if (s.deals.some((d) => d.target === target)) return 'There is already a bid on the table for this company.';
  if (s.deals.some((d) => d.bidder === bidder)) return 'You already have a bid open.';
  const { shares, cost } = tenderTerms(s, bidder, merge, target, premium);
  if (shares <= 0) return 'You already own enough.';
  if (merge) { const b = s.companies[bidder]; if (Math.max(0, b.cash) + debtRoom(b) < cost) return `Your lab can raise ${money(Math.max(0, b.cash) + debtRoom(b))} in cash and debt; this bid needs ${money(cost)}.`; }
  else if (s.actors[bidder].cash < cost) return `You have ${money(s.actors[bidder].cash)} of your own; this bid needs ${money(cost)}.`;
  return null;
}

export function openTender(s: GameState, bidder: Id, merge: boolean, target: Id, premium: number): Deal {
  const t = s.companies[target];
  const { offer } = tenderTerms(s, bidder, merge, target, premium);
  const mine = bidder === s.playerId || (bidder === s.labId && s.helm);
  const deal: Deal = { id: 'deal' + s.nextId++, bidder, merge, target, offer, premium, opened: s.week, closes: s.week + 2,
    playerTenders: sharesOf(s, s.playerId, target) > 0 && !mine ? null : false };
  s.deals.push(deal);
  t.price += 0.7 * Math.max(0, offer - t.price); // arbitrageurs close most of the gap at once
  const who = s.companies[bidder]?.name ?? s.actors[bidder].name;
  s.log.push({ week: s.week, co: target, tone: target === s.labId ? 'bad' : 'info', text: `${who} bids ${Math.round(premium * 100)}% over market for ${merge ? 'all of' : 'control of'} ${t.name}.` });
  return deal;
}

/** Fold the target into the acquirer: models, data, techniques, customers, cash and debt. */
export function merge(s: GameState, acqId: Id, tgtId: Id): void {
  const a = s.companies[acqId], t = s.companies[tgtId];
  const al = a.lab!, tl = t.lab!;
  for (const m of Object.values(s.models)) if (m.lab === tgtId) m.lab = acqId;
  for (const r of Object.values(s.runs)) if (r.lab === tgtId) { r.lab = acqId; if (r.status === 'running') { r.handsOn = false; r.call = null; } }
  for (const x of tl.techniques) if (!al.techniques.includes(x)) al.techniques.push(x);
  for (const x of tl.history) if (!al.history.includes(x)) al.history.push(x);
  for (const [k, v] of Object.entries(tl.data)) al.data[k] = Math.max(al.data[k] ?? 0, v);
  const wa = Math.max(1, a.rev), wt = Math.max(1, t.rev);
  al.talent = clamp((al.talent * wa + tl.talent * wt) / (wa + wt) - 0.03, 0.7, 1.3); // some of them quit
  al.brand = Math.max(al.brand, tl.brand);
  al.maxCompute = Math.max(al.maxCompute, tl.maxCompute);
  al.raceWins += tl.raceWins;
  a.cash += t.cash; a.debt += t.debt;
  a.rev8 += t.rev8; a.ni8 += t.ni8;
  a.integrationUntil = s.week + 24;
  for (const seg of Object.values(s.segments)) {
    if (seg.share[tgtId]) { seg.share[acqId] = (seg.share[acqId] ?? 0) + seg.share[tgtId]; delete seg.share[tgtId]; }
    seg.accounts = seg.accounts.map((x) => (x === tgtId ? acqId : x));
  }
  s.holdings = s.holdings.filter((h) => h.company !== tgtId);
  s.orders = s.orders.filter((o) => o.company !== tgtId);
  delete s.companies[tgtId];
}

function close(s: GameState, d: Deal): void {
  const t = s.companies[d.target];
  const bidderCo = s.companies[d.bidder], bidderActor = s.actors[d.bidder];
  if (!t || (!bidderCo && !bidderActor)) return;
  const who = bidderCo?.name ?? bidderActor.name;
  const mine = d.bidder === s.playerId || (d.bidder === s.labId && s.helm);
  const involved = mine || d.target === s.labId;
  const { shares: need, cost } = tenderTerms(s, d.bidder, d.merge, d.target, 0);
  // Who tenders: the float in proportion to how far the premium clears resistance; tycoons if it beats their ego.
  const tender: { owner: Id | null; n: number }[] = [{ owner: null, n: floatOf(s, d.target) * clamp((d.premium - resistance(t)) / 0.35, 0, 1) }];
  const boss = controller(s, d.target);
  for (const h of s.holdings.filter((x) => x.company === d.target && x.owner !== d.bidder)) {
    const a = s.actors[h.owner];
    if (!a) continue;
    const yes = a.isPlayer ? d.playerTenders === true : d.premium >= (boss === a.id ? 0.35 : 0.15) + 0.3 * (a.persona?.ego ?? 0.5);
    if (yes) tender.push({ owner: a.id, n: h.shares });
  }
  const tendered = tender.reduce((x, y) => x + y.n, 0);
  const got = (sharesOf(s, d.bidder, d.target) + tendered) / t.shares;
  const fail = (outcome: 'short' | 'blocked', why: string): void => {
    t.price *= 0.88;
    if (bidderCo) bidderCo.cash -= 0.01 * cost * (1 + d.premium); else bidderActor.cash -= 0.01 * cost * (1 + d.premium);
    s.log.push({ week: s.week, co: d.target, tone: 'info', text: `${who}'s bid for ${t.name} fails: ${why}.` });
    if (involved) s.moments.push({ kind: 'deal', bidder: d.bidder, bidderName: who, target: d.target, targetName: t.name, merge: d.merge, got, outcome, paid: 0, mine });
  };
  if (got < 0.5) return fail('short', `only ${Math.round(got * 100)}% of the shares came in`);

  if (d.merge) {
    if (rand(s.seed, s.week, d.id, 'antitrust') < blockChance(s, d.bidder, d.target)) return fail('blocked', 'regulators block it');
    const bill = (t.shares - sharesOf(s, d.bidder, d.target)) * d.offer;
    for (const h of s.holdings) if (h.company === d.target && s.actors[h.owner]) s.actors[h.owner].cash += h.shares * d.offer;
    const fromCash = Math.min(Math.max(0, bidderCo.cash), bill);
    bidderCo.cash -= fromCash;
    bidderCo.debt += bill - fromCash;
    s.log.push({ week: s.week, co: d.bidder, tone: mine ? 'good' : 'info', text: `${who} buys ${t.name} for ${money(bill)} and folds it in.` });
    if (involved) s.moments.push({ kind: 'deal', bidder: d.bidder, bidderName: who, target: d.target, targetName: t.name, merge: true, got, outcome: 'won', paid: bill, mine });
    const wasPlayers = d.target === s.labId;
    merge(s, d.bidder, d.target);
    if (wasPlayers) oust(s, who, t.name, d.bidder);
    return;
  }
  // A person buys only what they need for control, pro rata from everyone who tendered.
  const frac = Math.min(1, need / Math.max(1, tendered));
  let paid = 0;
  for (const x of tender) {
    const n = x.n * frac;
    if (n <= 0) continue;
    if (x.owner) { addShares(s, x.owner, d.target, -n); s.actors[x.owner].cash += n * d.offer; }
    addShares(s, d.bidder, d.target, n);
    paid += n * d.offer;
  }
  bidderActor.cash -= paid;
  s.log.push({ week: s.week, co: d.target, tone: mine ? 'good' : d.target === s.labId ? 'bad' : 'info', text: `${who} takes control of ${t.name} for ${money(paid)}.` });
  if (involved) s.moments.push({ kind: 'deal', bidder: d.bidder, bidderName: who, target: d.target, targetName: t.name, merge: false, got, outcome: 'won', paid, mine });
  if (d.target === s.labId && !mine) oust(s, who, t.name, null);
}

/** The player loses the helm. They keep their shares and their cash, and can buy their way back in anywhere. */
function oust(s: GameState, by: string, lab: string, movedTo: Id | null): void {
  s.helm = false;
  if (movedTo) s.labId = movedTo;
  const co = s.companies[s.labId];
  if (co && !movedTo) co.ceo = { name: 'Interim CEO', style: 'follower', skill: 0.5, ego: 0.3 };
  for (const r of Object.values(s.runs)) if (r.lab === s.labId && r.status === 'running') { r.handsOn = false; r.call = null; }
  s.moments.push({ kind: 'ousted', by, lab });
}

export function dealsTick(s: GameState): void {
  const due = s.deals.filter((d) => d.closes <= s.week);
  s.deals = s.deals.filter((d) => d.closes > s.week);
  for (const d of due) close(s, d);
}

/** A tycoon with a taste for risk bids for control of the player's lab when it is cheap and the founder is diluted. */
export function raidTick(s: GameState): void {
  const co = s.companies[s.labId];
  if (!s.helm || !co || s.deals.some((d) => d.target === co.id) || s.week < 24) return;
  const high = Math.max(...co.hist.slice(-26));
  if (sharesOf(s, s.playerId, co.id) / co.shares >= 0.5 || co.price > 0.6 * high) return;
  for (const a of Object.values(s.actors)) {
    const p = a.persona;
    if (!p || p.risk <= 0.5 || rand(s.seed, s.week, a.id, 'raid') > 0.25 * p.risk) continue;
    const premium = p.risk > 0.8 ? 0.5 : 0.35;
    if (tenderCheck(s, a.id, false, co.id, premium)) continue;
    openTender(s, a.id, false, co.id, premium);
    return;
  }
}
