// OWNER: ONBOARD. The Headquarters advisor: every useful move right now, most urgent first, in plain words.
import type { PanelId } from '../../App';
import { computeCapacity } from '../../../sim/systems/compute';
import { runwayDays } from '../../../sim/systems/finance';
import { unlockedProductKinds } from '../../../sim/systems/products';
import { OFFICE_TIERS } from '../../../sim/data/roles';
import type { GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { objectiveProgress } from '../../../sim/systems/board';
import { formatDays } from '../../components';
import { KIND_LABEL, headcount } from '../../components/derive';

/** urgent: money or customers are being lost now. next: the core loop is stalled. idea: worth doing when calm. */
export type Priority = 'urgent' | 'next' | 'idea';

export interface Step {
  /** What to do, as an imperative. */
  text: string;
  /** Why it matters, in one plain sentence. */
  why: string;
  panel: PanelId;
  /** Button label. */
  cta: string;
  priority: Priority;
}

/** Every suggestion that applies, urgent first, then the core loop, then ideas. */
export function nextSteps(s: GameState): Step[] {
  const out: Step[] = [];
  const add = (st: Step) => out.push(st);
  const offer = s.finance.pendingOffer;
  const runway = runwayDays(s);
  const live = s.products.filter((p) => p.active);
  const released = s.models.filter((m) => m.releasedDay !== null && !m.deprecated);
  const cap = computeCapacity(s);

  // Urgent: money and customers.
  if (offer)
    add({
      priority: 'urgent',
      text: `Answer ${offer.investor}: ${formatMoney(offer.amount)} on the table`,
      why: 'A term sheet is waiting. Investors get bored and walk.',
      panel: 'finance',
      cta: 'Review offer',
    });
  if (s.finance.negativeCashDays > 0)
    add({
      priority: 'urgent',
      text: `You are ${s.finance.negativeCashDays} days in the red`,
      why: 'Thirty days below zero and the lab is bankrupt. Borrow, raise or cut costs today.',
      panel: 'finance',
      cta: 'Fix cash',
    });
  else if (runway < 120)
    add({
      priority: 'urgent',
      text: `Runway is ${formatDays(runway)}. Raise money or cut burn`,
      why: 'Runway is how long your cash lasts at today’s spending. Under four months is the danger zone.',
      panel: 'finance',
      cta: 'Open Finance',
    });
  const down = live.filter((p) => p.servedFraction < 1);
  if (down.length)
    add({
      priority: 'urgent',
      text: `${down[0].name} is down`,
      why: 'An incident knocked it offline, so users are being turned away. See what it needs.',
      panel: 'products',
      cta: 'Open Products',
    });
  const losing = live.find((p) => (p.servingCostPerDay ?? 0) > p.revenuePerDay && p.revenuePerDay > 0);
  if (losing)
    add({
      priority: 'urgent',
      text: `${losing.name} loses money on every user`,
      why: 'Serving it costs more than it earns. Raise the price, or serve it on cheaper GPUs.',
      panel: 'products',
      cta: 'Fix pricing',
    });
  if (cap.total <= 0)
    add({ priority: 'urgent', text: 'Rent some GPUs', why: 'With no compute, nothing trains and nothing serves.', panel: 'compute', cta: 'Open Compute' });

  // Next: the core loop (train, release, sell, research).
  const unreleased = s.models.find((m) => m.releasedDay === null);
  if (s.models.length === 0 && !s.training)
    add({
      priority: 'next',
      text: 'Train your first model',
      why: 'Models are the whole business. Pick a size and some data, then let the GPUs cook.',
      panel: 'models',
      cta: 'Start training',
    });
  if (unreleased)
    add({
      priority: 'next',
      text: `Release ${unreleased.name}`,
      why: 'A finished model earns nothing until it ships. Release it, then sell it as a product.',
      panel: 'models',
      cta: 'Release it',
    });
  const notLive = unlockedProductKinds(s).filter((k) => !live.some((p) => p.kind === k));
  if (released.length > 0 && notLive.length > 0) {
    const kind = notLive[0];
    add({
      priority: 'next',
      text: `Launch the ${KIND_LABEL[kind] ?? kind} product`,
      why: 'Products turn a released model into daily revenue.',
      panel: 'products',
      cta: 'Launch',
    });
  }
  if (!s.training && cap.training > 0 && s.models.length > 0)
    add({
      priority: 'next',
      text: 'Start the next training run',
      why: 'Your training GPUs are idle. Every idle day is a day the rivals pull ahead.',
      panel: 'models',
      cta: 'Train',
    });
  if (s.research.current === null)
    add({
      priority: 'next',
      text: 'Pick something to research',
      why: 'Research unlocks better architectures, products and cheaper training.',
      panel: 'research',
      cta: 'Open Research',
    });
  const burst = s.compute.fleet?.burstCostPerDay ?? 0;
  if (burst > 0 && burst > 0.25 * s.finance.dailyRevenue && live.length > 0)
    add({
      priority: 'next',
      text: `Products are short of GPUs: ${formatMoney(burst)}/day on cloud`,
      why: 'Traffic your own GPUs cannot carry spills onto pricey rented cloud. Add serving capacity.',
      panel: 'compute',
      cta: 'Add compute',
    });

  // Ideas: growth and progression.
  const pts = s.progress?.perkPoints ?? 0;
  if (pts > 0)
    add({
      priority: 'idea',
      text: `Spend ${pts} perk point${pts === 1 ? '' : 's'}`,
      why: 'Perks are permanent bonuses. Points do nothing in the bank.',
      panel: 'lab',
      cta: 'Pick a perk',
    });
  const close = s.board?.objectives.find((o) => o.doneDay === null && objectiveProgress(o) >= 0.75);
  if (close)
    add({ priority: 'idea', text: `Finish a board goal: ${close.text}`, why: 'You are three quarters there, and the board pays on the day you hit it.', panel: 'lab', cta: 'See goals' });
  const cup = s.cup?.open;
  if (cup && !cup.entrantModelId && released.length > 0)
    add({ priority: 'idea', text: 'Enter the Arena Cup', why: 'A free shot at prize money and hype for a released model.', panel: 'lab', cta: 'Enter' });
  if ((s.contracts?.offers.length ?? 0) > 0 && released.length > 0)
    add({ priority: 'idea', text: 'Bid on a client contract', why: 'Contracts pay a lump sum for a model that clears the bar.', panel: 'contracts', cta: 'See offers' });
  const seats = OFFICE_TIERS.find((t) => t.id === s.company.officeTierId)?.capacity ?? 0;
  if (seats > 0 && headcount(s) < seats && runway > 365)
    add({ priority: 'idea', text: 'Hire into the empty desks', why: 'More researchers and engineers make everything faster. You can afford it.', panel: 'staff', cta: 'Hire' });
  if (s.data.owned.length < 4)
    add({ priority: 'idea', text: 'Buy more training data', why: `You own ${s.data.owned.length} dataset${s.data.owned.length === 1 ? '' : 's'}. More and better data means smarter models.`, panel: 'data', cta: 'Shop data' });
  if (out.length === 0)
    add({ priority: 'idea', text: 'Nothing on fire. Check on the rivals', why: 'See who leads each market and what buyers want next.', panel: 'market', cta: 'Open Market' });
  return out;
}

/** The single most useful move. */
export function nextStep(s: GameState): Step {
  return nextSteps(s)[0];
}
