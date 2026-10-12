// OWNER: Agent B. Ledger finalisation, valuation, funding offers, loans, IPO, stock, bankruptcy, history.
import type { ActionHandlers, FinanceSample, FundingOffer, GameState, Rng } from '../types';
import { BALANCE } from '../balance';
import { getBonuses } from '../bonuses';
import { INVESTORS } from '../data/competitors';
import { addExpense, clamp, formatMoney, notify, pushNews, yearOf } from '../util';
import { arenaLeaderboard } from './competitors';
import { bestPlayerModel, frontierQuality } from './market';
import { isSandbox, scenarioRule, vcGenerosity } from './scenario'; // v9 scenario

/** Funding ladder after the pre-seed. Stays on the last rung once reached. */
export const ROUND_LADDER = ['Seed+', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E', 'Series F', 'Sovereign Wealth Round'];
const IPO_SHARES_M = 1000;
const IPO_RAISE_FRACTION = 0.15;
const IPO_FOUNDER_RETAINED = 0.85;
const OFFER_TTL_DAYS = 30;
const OFFER_GAP_MIN_DAYS = 150;
const OFFER_GAP_MAX_DAYS = 300;
const OFFER_RECHECK_DAYS = 30;
/** Runway below ~18 months triggers an offer. */
const RUNWAY_TRIGGER_DAYS = 548;
const GROWTH_WINDOW_DAYS = 90;
const GROWTH_FACTOR = 2;
const OFFER_RAISE_MIN = 0.15;
const OFFER_RAISE_MAX = 0.25;
const MIN_PRE_MONEY = 1e6;
const VALUATION_SMOOTHING_DAYS = 30;
const POTENTIAL_SCALE = 3e9;
const HISTORY_CAP = 600;
const NEGATIVE_CASH_WARN_EVERY = 5;
/** Valuation never falls below this share of the last round's post-money, but the floor takes a year to get there. */
const VALUATION_FLOOR_FRACTION = 0.6;
const VALUATION_FLOOR_DECAY_DAYS = 365;
const LAST_ROUND_FLAG = 'lastRoundDay';

/** Follow-on stock sale for public companies. */
export const SECONDARY_TUNING = {
  /** New shares as a share of shares outstanding. */
  SHARE_FRACTION: 0.05,
  /** New shares are priced below the current stock price. */
  PRICE_DISCOUNT: 0.05,
  /** The stock dips a little on the news of new supply. */
  PRICE_DIP: 0.02,
  COOLDOWN_DAYS: 180,
};
const LAST_SECONDARY_FLAG = 'lastSecondaryDay';

/** Annualised run-rate from the most recent closed day. */
export function annualRevenue(s: GameState): number {
  return s.finance.dailyRevenue * 365;
}

/** Player's 1-based arena rank, or 0 when the player has no released model. */
function playerArenaRank(s: GameState): number {
  const rows = arenaLeaderboard(s);
  const idx = rows.findIndex((r) => r.isPlayer);
  return idx < 0 ? 0 : idx + 1;
}

/**
 * Valuation floor: the last post-money, decaying slowly toward 60% of it over a year since the last round.
 * A fresh company sits at its round price instead of falling to the floor in a month.
 */
export function valuationFloor(s: GameState): number {
  const sinceRound = Math.max(0, s.day - (s.flags[LAST_ROUND_FLAG] ?? 0));
  const t = clamp(sinceRound / VALUATION_FLOOR_DECAY_DAYS, 0, 1);
  return s.finance.lastPostMoney * (1 - (1 - VALUATION_FLOOR_FRACTION) * t);
}

/**
 * v1.0 tuning (GAME_DESIGN §18.2): the revenue multiple rewards capability. A lab whose best model is at the frontier
 * gets the full multiple. A lab well behind it, however large its volume of cheap sales, gets less. The premium is
 * (best overall / frontier)^PREMIUM_EXP, held between PREMIUM_MIN and PREMIUM_MAX.
 */
export const VALUATION_TUNING = {
  PREMIUM_EXP: 4,
  PREMIUM_MIN: 0.4,
  PREMIUM_MAX: 1.2,
};

/** Capability premium on the revenue multiple, from the best released model's overall against the world frontier. */
export function frontierPremium(s: GameState, bestOverall: number): number {
  if (!(bestOverall > 0)) return VALUATION_TUNING.PREMIUM_MIN;
  const ref = frontierQuality(yearOf(s.day));
  return clamp((bestOverall / ref) ** VALUATION_TUNING.PREMIUM_EXP, VALUATION_TUNING.PREMIUM_MIN, VALUATION_TUNING.PREMIUM_MAX);
}

/** Fundamental (target) private valuation: max(decaying floor, revenue multiple + potential). */
export function computeValuation(s: GameState): number {
  const aiHype = s.market.aiHype;
  const best = bestPlayerModel(s);
  const bestOverall = best ? best.overall : 0;
  const multiple = (4 + aiHype / 8) * frontierPremium(s, bestOverall);
  const rank = playerArenaRank(s);
  const arenaFactor = rank > 0 ? clamp(1 - 0.15 * (rank - 1), 0.2, 1) : 0.2;
  const potential = (bestOverall / 100) ** 3 * POTENTIAL_SCALE * (aiHype / 50) * arenaFactor;
  // v8 doctrine: the valuation multiplier (1 at neutral). Feeds the private round and the stock's fundamental price.
  return Math.max(valuationFloor(s), annualRevenue(s) * multiple + potential) * (getBonuses(s).valuation ?? 1);
}

/** Records the day a priced round closed, so the valuation floor restarts its decay. */
function markRound(s: GameState): void {
  s.flags[LAST_ROUND_FLAG] = s.day;
}

/** Days until cash runs out at current net burn (Infinity if profitable). */
export function runwayDays(s: GameState): number {
  // Already underwater counts as no runway even at break-even, or a one-off hit (a lost lawsuit) would leave a
  // break-even company with no bridge offer and a guaranteed bankruptcy 30 days later.
  if (s.finance.cash <= 0) return 0;
  const burn = s.finance.dailyExpenses - s.finance.dailyRevenue;
  if (burn <= 0) return Infinity;
  return s.finance.cash / burn;
}

/** Total borrowing capacity. The new loan allowed is this minus existing debt. */
export function maxLoan(s: GameState): number {
  return Math.max(1_000_000, 2 * annualRevenue(s));
}

export function canIpo(s: GameState): { ok: boolean; reason: string } {
  if (s.company.isPublic) return { ok: false, reason: 'Already public.' };
  if (scenarioRule(s, 'noIpo')) return { ok: false, reason: 'This scenario is not for sale. The exchange has been asked nicely.' }; // v9 scenario
  if (s.gameOver) return { ok: false, reason: 'The company no longer exists.' };
  if (s.finance.valuation < BALANCE.IPO_MIN_VALUATION) {
    return { ok: false, reason: `Valuation ${formatMoney(s.finance.valuation)} is below the ${formatMoney(BALANCE.IPO_MIN_VALUATION)} IPO minimum.` };
  }
  if (annualRevenue(s) < BALANCE.IPO_MIN_ANNUAL_REVENUE) {
    return { ok: false, reason: `Annual revenue must reach ${formatMoney(BALANCE.IPO_MIN_ANNUAL_REVENUE)} before underwriters will return calls.` };
  }
  return { ok: true, reason: '' };
}

/**
 * Financing inflows and principal repayments are balance-sheet moves, not P&L, so they change cash
 * directly and skip the daily ledger (keeps revenue/expense charts and stats.totalRevenue honest).
 */
function moveCash(s: GameState, delta: number): void {
  s.finance.cash += delta;
}
function sumValues(o: Record<string, number>): number {
  let t = 0;
  for (const k of Object.keys(o)) t += o[k];
  return t;
}
function nextOfferGap(rng: Rng): number {
  return Math.round(rng.range(OFFER_GAP_MIN_DAYS, OFFER_GAP_MAX_DAYS));
}
function raisedRoundCount(s: GameState): number {
  return s.finance.roundsRaised.filter((r) => ROUND_LADDER.includes(r)).length;
}
/** Revenue has at least doubled over the growth window (or started from zero). */
function growingFast(s: GameState): boolean {
  const now = s.finance.dailyRevenue;
  if (now <= 0) return false;
  let past: FinanceSample | undefined;
  for (const h of s.finance.history) if (h.day <= s.day - GROWTH_WINDOW_DAYS) past = h;
  if (!past) return false;
  return past.revenue <= 0 || now >= GROWTH_FACTOR * past.revenue;
}
function makeOffer(s: GameState, rng: Rng): FundingOffer {
  const roundName = ROUND_LADDER[Math.min(raisedRoundCount(s), ROUND_LADDER.length - 1)];
  const pre = Math.max(MIN_PRE_MONEY, Math.round(s.finance.valuation * vcGenerosity(s))); // v9 scenario: difficulty VC generosity
  const raise = rng.range(OFFER_RAISE_MIN, OFFER_RAISE_MAX);
  // amount / (pre + amount) = raise  =>  amount = pre * raise / (1 - raise)
  const amount = Math.max(10_000, Math.round((pre * raise) / (1 - raise) / 10_000) * 10_000);
  return {
    roundName,
    amount,
    preMoney: pre,
    investor: rng.pick(INVESTORS),
    expiresDay: s.day + OFFER_TTL_DAYS,
  };
}

function totalUsers(s: GameState): number {
  return s.products.reduce((t, p) => (p.active ? t + p.users : t), 0);
}

/** Public-company stock: random walk with momentum, anchored to the fundamental value. */
function updateStock(s: GameState, rng: Rng): void {
  const shares = s.company.sharesOutstanding * 1e6;
  if (shares <= 0) return;
  const fundamentalPrice = Math.max(computeValuation(s), 1) / shares;
  const price = s.company.stockPrice > 0 ? s.company.stockPrice : fundamentalPrice;
  const momentum = (s.flags['stockMomentum'] ?? 0) * 0.9 + rng.normal(0, 0.008);
  const ret = clamp(momentum + 0.03 * Math.log(fundamentalPrice / price) + rng.normal(0, 0.01), -0.2, 0.2);
  s.flags['stockMomentum'] = momentum;
  s.company.stockPrice = Math.max(0.01, price * Math.exp(ret));
  s.finance.valuation = s.company.stockPrice * shares;
}

export function financeTick(s: GameState, rng: Rng): void {
  // 1. Interest on debt is part of today's expenses.
  if (s.finance.debt > 0) addExpense(s, 'interest', (s.finance.debt * s.finance.loanRatePerYear) / 365);

  // 2. Close the books.
  s.finance.dailyRevenue = sumValues(s.finance.today.revenue);
  s.finance.dailyExpenses = sumValues(s.finance.today.expenses);
  s.finance.revenueBreakdown = { ...s.finance.today.revenue };
  s.finance.expenseBreakdown = { ...s.finance.today.expenses };

  // 3. Bankruptcy: cash below zero for too many consecutive days.
  if (s.finance.cash < 0 && !isSandbox(s)) { // v9 scenario: the sandbox never goes bankrupt
    s.finance.negativeCashDays += 1;
    const n = s.finance.negativeCashDays;
    const limit = BALANCE.BANKRUPT_NEGATIVE_DAYS;
    if (n >= limit) {
      s.gameOver = { reason: `Ran out of money: cash stayed below zero for ${limit} straight days.`, day: s.day };
      pushNews(s, `${s.company.name} has run out of money. The garage is being repossessed.`, 'bad');
      return;
    }
    if (n % NEGATIVE_CASH_WARN_EVERY === 0) {
      notify(s, `Cash has been negative for ${n} days. ${limit - n} days to fix it.`, 'bad');
    }
  } else {
    s.finance.negativeCashDays = 0;
  }

  // 4. Valuation: smoothed for private companies, stock-driven once public.
  if (s.company.isPublic) {
    updateStock(s, rng);
  } else {
    s.finance.valuation += (computeValuation(s) - s.finance.valuation) / VALUATION_SMOOTHING_DAYS;
  }

  // 5. Funding offers: expire, then arrive when runway is short or the company is growing fast.
  if (!s.company.isPublic && !scenarioRule(s, 'noVc')) { // v9 scenario: no VC rounds in a no-VC scenario (loans still work)
    const offer = s.finance.pendingOffer;
    if (offer && s.day >= offer.expiresDay) {
      s.finance.pendingOffer = null;
      s.finance.nextOfferDay = s.day + nextOfferGap(rng);
      pushNews(s, `${offer.investor} loses interest in ${s.company.name}'s ${offer.roundName}.`, 'info');
    }
    // Desperate companies (under ~3 months of runway) get a discounted lifeline every 45 days.
    const desperate = runwayDays(s) < 90 && s.day >= (s.flags.lastOfferDay ?? -1e9) + 45;
    if (!s.finance.pendingOffer && (s.day >= s.finance.nextOfferDay || desperate)) {
      if (desperate || runwayDays(s) < RUNWAY_TRIGGER_DAYS || growingFast(s)) {
        const made = makeOffer(s, rng);
        if (desperate) {
          made.preMoney = Math.round(made.preMoney * 0.7);
          made.amount = Math.round(made.amount * 0.7);
          made.roundName = `${made.roundName} (bridge)`;
        }
        s.flags.lastOfferDay = s.day;
        s.finance.pendingOffer = made;
        notify(s, `${made.investor} offers ${formatMoney(made.amount)} for a ${made.roundName}. Expires in ${OFFER_TTL_DAYS} days.`, 'info');
      } else {
        s.finance.nextOfferDay = s.day + OFFER_RECHECK_DAYS;
      }
    }
  }

  // 6. Weekly history sample, and peak valuation.
  if (s.day % BALANCE.HISTORY_SAMPLE_DAYS === 0) {
    s.finance.history.push({
      day: s.day,
      cash: s.finance.cash,
      revenue: s.finance.dailyRevenue,
      expenses: s.finance.dailyExpenses,
      valuation: s.finance.valuation,
      users: totalUsers(s),
      stockPrice: s.company.isPublic ? s.company.stockPrice : 0,
    });
    if (s.finance.history.length > HISTORY_CAP) s.finance.history.splice(0, s.finance.history.length - HISTORY_CAP);
  }
  s.stats.peakValuation = Math.max(s.stats.peakValuation, s.finance.valuation);
}

/** A follow-on stock sale needs a public listing, a price, and the cooldown to have passed. */
export function canSecondary(s: GameState): { ok: boolean; reason: string } {
  if (!s.company.isPublic) return { ok: false, reason: 'Only a listed company can sell more stock.' };
  if (s.gameOver) return { ok: false, reason: 'The company no longer exists.' };
  if (!(s.company.stockPrice > 0) || !(s.company.sharesOutstanding > 0)) return { ok: false, reason: 'There is no share price to sell at yet.' };
  const last = s.flags[LAST_SECONDARY_FLAG];
  if (last !== undefined && s.day - last < SECONDARY_TUNING.COOLDOWN_DAYS) {
    const wait = Math.ceil(SECONDARY_TUNING.COOLDOWN_DAYS - (s.day - last));
    return { ok: false, reason: `Underwriters want ${wait} more days before another offering.` };
  }
  return { ok: true, reason: '' };
}

export const handlers: ActionHandlers = {
  secondaryOffering: (s) => {
    const check = canSecondary(s);
    if (!check.ok) {
      notify(s, check.reason, 'bad');
      return;
    }
    const { SHARE_FRACTION, PRICE_DISCOUNT, PRICE_DIP } = SECONDARY_TUNING;
    const newShares = s.company.sharesOutstanding * SHARE_FRACTION; // millions
    const price = s.company.stockPrice * (1 - PRICE_DISCOUNT);
    const proceeds = newShares * 1e6 * price;
    s.company.sharesOutstanding += newShares;
    // Same founder shares spread over 5% more stock.
    s.company.founderEquity /= 1 + SHARE_FRACTION;
    s.company.stockPrice = Math.max(0.01, s.company.stockPrice * (1 - PRICE_DIP));
    s.finance.valuation = s.company.stockPrice * s.company.sharesOutstanding * 1e6;
    moveCash(s, proceeds);
    s.finance.totalRaised += proceeds;
    s.flags[LAST_SECONDARY_FLAG] = s.day;
    notify(s, `Secondary offering closed: ${formatMoney(proceeds)} raised. The stock dipped, as is tradition.`, 'good');
    pushNews(s, `${s.company.name} sells ${(SHARE_FRACTION * 100).toFixed(0)}% more stock at a discount. Existing shareholders are "diluted, but not sad".`, 'info');
  },

  acceptOffer: (s, _a, rng) => {
    const offer = s.finance.pendingOffer;
    if (!offer) {
      notify(s, 'No term sheet on the table.', 'info');
      return;
    }
    if (s.day >= offer.expiresDay) {
      s.finance.pendingOffer = null;
      notify(s, 'That term sheet has expired.', 'bad');
      return;
    }
    const post = offer.preMoney + offer.amount;
    s.company.founderEquity *= offer.preMoney / post;
    moveCash(s, offer.amount);
    s.finance.totalRaised += offer.amount;
    s.finance.roundsRaised.push(offer.roundName);
    (s.finance.roundLog ??= []).push({ name: offer.roundName, day: s.day, amount: offer.amount, postMoney: post });
    s.finance.lastPostMoney = post;
    markRound(s);
    s.finance.pendingOffer = null;
    s.finance.nextOfferDay = s.day + nextOfferGap(rng);
    notify(s, `Closed the ${offer.roundName} with ${offer.investor}: ${formatMoney(offer.amount)} in the bank.`, 'good');
    pushNews(s, `${s.company.name} raises ${formatMoney(offer.amount)} in a ${offer.roundName} led by ${offer.investor} at ${formatMoney(post)} post-money.`, 'milestone');
  },

  declineOffer: (s, _a, rng) => {
    if (!s.finance.pendingOffer) return;
    s.finance.pendingOffer = null;
    s.finance.nextOfferDay = s.day + nextOfferGap(rng);
    notify(s, 'Offer declined. Your investors are shocked, but they will recover.', 'info');
  },

  takeLoan: (s, a) => {
    if (!(a.amount > 0) || !isFinite(a.amount)) {
      notify(s, 'Loan amount must be positive.', 'bad');
      return;
    }
    const room = maxLoan(s) - s.finance.debt;
    if (room <= 0) {
      notify(s, 'Lenders will not lend against your current revenue.', 'bad');
      return;
    }
    if (a.amount > room) {
      notify(s, `Lenders can offer up to ${formatMoney(room)} more right now.`, 'bad');
      return;
    }
    s.finance.debt += a.amount;
    moveCash(s, a.amount);
    notify(s, `Borrowed ${formatMoney(a.amount)} at ${(s.finance.loanRatePerYear * 100).toFixed(0)}% a year.`, 'info');
  },

  repayLoan: (s, a) => {
    if (!(a.amount > 0) || !isFinite(a.amount)) {
      notify(s, 'Repayment must be positive.', 'bad');
      return;
    }
    if (s.finance.debt <= 0) {
      notify(s, 'You have no debt. Congratulations, this is rare.', 'info');
      return;
    }
    const amount = Math.min(a.amount, s.finance.debt);
    if (s.finance.cash < amount) {
      notify(s, `Not enough cash to repay ${formatMoney(amount)}.`, 'bad');
      return;
    }
    moveCash(s, -amount);
    s.finance.debt -= amount;
    notify(s, `Repaid ${formatMoney(amount)} of debt.`, 'good');
  },

  ipo: (s, _a) => {
    const check = canIpo(s);
    if (!check.ok) {
      notify(s, check.reason, 'bad');
      return;
    }
    const valuation = s.finance.valuation;
    const proceeds = valuation * IPO_RAISE_FRACTION;
    s.company.isPublic = true;
    s.company.sharesOutstanding = IPO_SHARES_M;
    s.company.stockPrice = valuation / (IPO_SHARES_M * 1e6);
    s.company.founderEquity *= IPO_FOUNDER_RETAINED;
    moveCash(s, proceeds);
    s.finance.totalRaised += proceeds;
    s.finance.roundsRaised.push('IPO');
    (s.finance.roundLog ??= []).push({ name: 'IPO', day: s.day, amount: proceeds, postMoney: valuation });
    s.finance.lastPostMoney = valuation;
    s.finance.pendingOffer = null;
    notify(s, `You are public. ${formatMoney(proceeds)} raised. Please smile for the cameras.`, 'milestone');
    pushNews(s, `${s.company.name} lists on the exchange at a ${formatMoney(valuation)} valuation. Analysts are "cautiously thrilled".`, 'milestone');
  },
};
