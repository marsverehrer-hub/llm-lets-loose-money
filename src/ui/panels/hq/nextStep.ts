// OWNER: ONBOARD. The Headquarters advisor: every useful move right now, most urgent first, in plain words.
import type { PanelId } from '../../App';
import type { Intent } from '../../nav';
import { computeCapacity } from '../../../sim/systems/compute';
import { adoptQuote, recommendedResearch } from '../../../sim/systems/research';
import { runwayDays } from '../../../sim/systems/finance';
import { daysIntoGame } from '../../../sim/systems/scenario';
import { RUNWAY_WARMUP_DAYS } from '../../shell/fmt';
import { unlockedProductKinds } from '../../../sim/systems/products';
import { OFFICE_TIERS } from '../../../sim/data/roles';
import type { GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { objectiveProgress } from '../../../sim/systems/board';
import { currentChapter } from '../../../sim/systems/chapters';
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
  /** v17: this step is the current lab chapter (HQ shows it in its own banner). */
  chapter?: boolean;
  /** v17.2: where on the panel the button should land (navigate's intent). */
  intent?: Intent;
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
      intent: { focus: 'offer' },
    });
  if (s.finance.negativeCashDays > 0)
    add({
      priority: 'urgent',
      text: `You are ${s.finance.negativeCashDays} days in the red`,
      why: 'Thirty days below zero and the lab is bankrupt. Borrow, raise or cut costs today.',
      panel: 'finance',
      cta: 'Fix cash',
      intent: { focus: 'pitch' },
    });
  else if (runway < 120 && daysIntoGame(s) >= RUNWAY_WARMUP_DAYS)
    add({
      priority: 'urgent',
      text: `Runway is ${formatDays(runway)}. Raise money or cut burn`,
      why: 'Runway is how long your cash lasts at today’s spending. Under four months is the danger zone.',
      panel: 'finance',
      cta: 'Pitch investors',
      intent: { focus: 'pitch' },
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
    add({ priority: 'urgent', text: 'Rent some GPUs', why: 'With no compute, nothing trains and nothing serves.', panel: 'compute', cta: 'Rent GPUs', intent: { tab: 'rent' } });

  // Next: the current chapter, unless another move already points at the same screen.
  const chapterStep = chapterNextStep(s);

  // Next: the core loop (train, release, sell, research).
  const unreleased = s.models.find((m) => m.releasedDay === null);
  // The first training run is chapter one (systems/chapters.ts), so it has no separate move here.
  if (unreleased)
    add({
      priority: 'next',
      text: `Release ${unreleased.name}`,
      why: 'A finished model earns nothing until it ships. Release it, then sell it as a product.',
      panel: 'models',
      cta: 'Release it',
      intent: { open: 'release', modelId: unreleased.id },
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
      intent: { open: 'launch', kind },
    });
  }
  if (!s.training && cap.training > 0 && s.models.length > 0)
    add({
      priority: 'next',
      text: 'Start the next training run',
      why: 'Your training GPUs are idle. Every idle day is a day the rivals pull ahead.',
      panel: 'models',
      cta: 'Train',
      intent: { open: 'train' },
    });
  const rec = recommendedResearch(s);
  if (s.research.current === null)
    add({
      priority: 'next',
      text: rec ? `Research ${rec.label}` : 'Pick something to research',
      why: rec ? rec.why : 'Research unlocks better architectures, products and cheaper training.',
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
      intent: { tab: 'rent' },
    });

  // The chapter leads the 'next' moves (after anything urgent), unless a more specific move already points at its screen.
  if (chapterStep && !out.some((st) => st.priority === 'next' && st.panel === chapterStep.panel)) {
    const firstNext = out.findIndex((st) => st.priority !== 'urgent');
    out.splice(firstNext < 0 ? out.length : firstNext, 0, chapterStep);
  }

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
  // v17.3: a cheap published paper on the recommended topic, done alongside the lab's own research.
  const adopt = rec && s.research.current !== null ? adoptQuote(s, rec.node) : null;
  if (rec && adopt?.ok && adopt.price <= 0.1 * s.finance.cash)
    add({
      priority: 'idea',
      text: `Adopt the ${rec.label} paper for ${formatMoney(adopt.price)}`,
      why: `${rec.why} Done in ${adopt.days} days, while your researchers keep going.`,
      panel: 'research',
      cta: 'Open Research',
    });
  const cup = s.cup?.open;
  if (cup && !cup.entrantModelId && released.length > 0)
    add({ priority: 'idea', text: 'Enter the Arena Cup', why: 'A free shot at prize money and hype for a released model.', panel: 'lab', cta: 'Enter' });
  if ((s.contracts?.offers.length ?? 0) > 0 && released.length > 0)
    add({ priority: 'idea', text: 'Bid on a client contract', why: 'Contracts pay a lump sum for a model that clears the bar.', panel: 'contracts', cta: 'See offers' });
  const seats = OFFICE_TIERS.find((t) => t.id === s.company.officeTierId)?.capacity ?? 0;
  if (seats > 0 && headcount(s) < seats && runway > 365)
    add({ priority: 'idea', text: 'Hire into the empty desks', why: 'More researchers and engineers make everything faster. You can afford it.', panel: 'staff', cta: 'Hire', intent: { open: 'hire' } });
  if (s.data.owned.length < 4)
    add({ priority: 'idea', text: 'Buy more training data', why: `You own ${s.data.owned.length} dataset${s.data.owned.length === 1 ? '' : 's'}. More and better data means smarter models.`, panel: 'data', cta: 'Shop data' });
  if (out.every((st) => st.chapter))
    add({ priority: 'idea', text: 'Nothing on fire. Check on the rivals', why: 'See who leads each market and what buyers want next.', panel: 'market', cta: 'Open Market' });
  return out;
}

/** Where a chapter's button lands. */
function chapterIntent(s: GameState, id: string): Intent | undefined {
  const unreleased = s.models.find((m) => m.releasedDay === null);
  switch (id) {
    case 'first_run':
      return { open: 'train' };
    case 'first_release':
      return unreleased ? { open: 'release', modelId: unreleased.id } : undefined;
    case 'first_round':
      return { focus: 'pitch' };
    case 'first_product':
      return { open: 'launch' };
    case 'own_gpus':
      return { tab: 'build' };
    default:
      return undefined;
  }
}

/** The current lab chapter as a move (null once every chapter is done). */
export function chapterNextStep(s: GameState): Step | null {
  const ch = currentChapter(s);
  if (!ch) return null;
  return { priority: 'next', text: ch.title, why: ch.why, panel: ch.panel as PanelId, cta: ch.cta, chapter: true, intent: chapterIntent(s, ch.id) };
}

/** The single most useful move. */
export function nextStep(s: GameState): Step {
  return nextSteps(s)[0];
}
