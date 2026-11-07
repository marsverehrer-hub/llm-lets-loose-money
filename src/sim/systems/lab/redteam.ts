// Red-teaming: the quote for a red team and the count of latent quirks a model is hiding.

import type { GameState, Id, Model } from '../../types';
import { LAB_TUNING } from './tuning';
import { cloudCostPerFlop } from './sweeps';

// ---------------------------------------------------------------------------
// Red-teaming and latent quirks
// ---------------------------------------------------------------------------

export function redTeamQuote(s: GameState, modelId: Id): { cost: number; days: number } {
  const m = s.models.find((x) => x.id === modelId);
  if (!m) return { cost: 0, days: 0 };
  const flops = 6 * (m.activeParamsB ?? m.paramsB) * 1e9 * m.tokensB * 1e9;
  const cost = Math.round(Math.max(LAB_TUNING.REDTEAM_MIN, LAB_TUNING.REDTEAM_FRACTION * flops * cloudCostPerFlop(s)));
  const safety = (s.staff.roles.safety?.count ?? 0) > 0;
  const days = Math.round(LAB_TUNING.REDTEAM_DAYS * (safety ? LAB_TUNING.REDTEAM_SAFETY_FACTOR : 1));
  return { cost: Number.isFinite(cost) ? cost : Infinity, days };
}

/** Number of latent quirks (UI may show "unknown" instead before red-teaming). */
export function latentCount(m: Model): number {
  return m.latentQuirks?.length ?? 0;
}
