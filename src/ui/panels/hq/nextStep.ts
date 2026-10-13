// OWNER: ONBOARD (v10 agent 7). The one suggestion Headquarters shows under "What to do next".
import type { PanelId } from '../../App';
import { computeCapacity } from '../../../sim/systems/compute';
import { runwayDays } from '../../../sim/systems/finance';
import { unlockedProductKinds } from '../../../sim/systems/products';
import type { GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { objectiveProgress } from '../../../sim/systems/board';
import { formatDays } from '../../components';
import { KIND_LABEL } from '../../components/derive';

export interface Step {
  text: string;
  panel: PanelId;
}

/** One terse suggestion for the most useful next action, most urgent first. */
export function nextStep(s: GameState): Step {
  const offer = s.finance.pendingOffer;
  const runway = runwayDays(s);
  const live = s.products.filter((p) => p.active);
  const released = s.models.filter((m) => m.releasedDay !== null && !m.deprecated);
  const cap = computeCapacity(s);

  // 1. Money: an offer on the desk, or a short runway with none.
  if (offer) return { text: `Term sheet on the desk: ${offer.investor}, ${formatMoney(offer.amount)}`, panel: 'finance' };
  if (runway < 120) return { text: `Runway ${formatDays(runway)}. Borrow or cut burn.`, panel: 'finance' };
  // 2. Outages (incidents only since v10) and products that lose money on every token served.
  if (live.some((p) => p.servedFraction < 1)) return { text: 'A product is down after an incident.', panel: 'products' };
  const losing = live.find((p) => (p.servingCostPerDay ?? 0) > p.revenuePerDay && p.revenuePerDay > 0);
  if (losing) return { text: `${losing.name} costs more to serve than it earns. Raise its price or add GPUs.`, panel: 'products' };
  // 3. Nothing to train on or ship.
  if (cap.total <= 0) return { text: 'No GPUs. Nothing trains or serves. Rent some.', panel: 'compute' };
  if (s.models.length === 0 && !s.training) return { text: 'No models yet. Start a training run.', panel: 'models' };
  if (s.models.some((m) => m.releasedDay === null)) return { text: 'A finished model is unreleased.', panel: 'models' };
  // 4. Unlocked products that are not live yet.
  const unlockedNotLive = unlockedProductKinds(s).filter((k) => !live.some((p) => p.kind === k));
  if (released.length > 0 && unlockedNotLive.length > 0) {
    const kind = unlockedNotLive[0];
    return { text: `Launch the ${KIND_LABEL[kind] ?? kind} product`, panel: 'products' };
  }
  // 5. Capacity running hot, or idle GPUs.
  const burst = s.compute.fleet?.burstCostPerDay ?? 0;
  if (burst > 0 && burst > 0.25 * s.finance.dailyRevenue && live.length > 0) {
    return { text: `Cloud serving costs ${formatMoney(burst)}/day. Your own GPUs would be cheaper.`, panel: 'compute' };
  }
  if (!s.training && cap.training > 0 && s.models.length > 0) return { text: 'GPUs idle. Start the next training run.', panel: 'models' };
  // 6. Long-term growth.
  if (s.research.current === null) return { text: 'Research queue empty.', panel: 'research' };
  // v13: perk points waiting, and a board goal that is nearly done.
  const pts = s.progress?.perkPoints ?? 0;
  if (pts > 0) return { text: `${pts} perk point${pts === 1 ? '' : 's'} to spend. Shape the lab.`, panel: 'lab' };
  const close = s.board?.objectives.find((o) => o.doneDay === null && objectiveProgress(o) >= 0.75);
  if (close) return { text: `Board goal almost done: ${close.text}.`, panel: 'lab' };
  if (s.data.owned.length < 4) return { text: `${s.data.owned.length} datasets owned. Buy more reading.`, panel: 'data' };
  return { text: 'Nothing on fire. Check how the market reacts.', panel: 'market' };
}
