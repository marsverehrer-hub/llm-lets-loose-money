// Shared bits for the Products screen: kind labels, the price range, the model lists and the per-day economics.
import { BUYER_TIERS, SEGMENT_OF } from '../../../sim/types';
import type { BuyerTier, GameState, Id, Model, Product, ProductKind } from '../../../sim/types';
import { productFitFor, specOf } from '../../../sim/systems/capabilities';

export const KIND_ORDER: ProductKind[] = ['api', 'chat', 'enterprise'];

export const TIER_LABEL: Record<BuyerTier, string> = { premium: 'Premium', mainstream: 'Mainstream', budget: 'Budget' };
export const TIER_HINT: Record<BuyerTier, string> = { premium: 'wants the best', mainstream: 'balanced', budget: 'cheapest that works' };
export { BUYER_TIERS };

export const KINDS: Record<
  ProductKind,
  { label: string; unit: string; userWord: string; blurb: string; revenueHint: string }
> = {
  api: {
    label: 'API',
    unit: '/Mtok',
    userWord: 'accounts',
    blurb: 'Developers pay by the million tokens.',
    revenueHint: 'Revenue = Mtok served × price',
  },
  chat: {
    label: 'Chat',
    unit: '/user/mo',
    userWord: 'subscribers',
    blurb: 'A chatbot for the masses. Consumers pay monthly.',
    revenueHint: 'Revenue = subscribers × price ÷ 30 per day',
  },
  enterprise: {
    label: 'Enterprise',
    unit: '/seat/mo',
    userWord: 'seats',
    blurb: 'Seats for companies. Slow sales, sticky contracts.',
    revenueHint: 'Revenue = seats × price ÷ 30 per day',
  },
};

/** Log-scale price range for a kind, around the market reference price. */
export function priceRange(s: GameState, kind: ProductKind): { min: number; max: number } {
  const ref = Math.max(0.01, s.market.segments[SEGMENT_OF[kind]]?.refPrice ?? 1);
  return { min: ref * 0.1, max: ref * 5 };
}

export function releasedModels(s: GameState): Model[] {
  return s.models
    .filter((m) => m.releasedDay !== null && !m.deprecated)
    .sort((a, b) => b.elo - a.elo);
}

/** Option text: name, spec and the attractiveness multiplier this product kind gets from it. */
export function modelOption(m: Model, kind: ProductKind): string {
  const spec = specOf(m);
  return `${m.name} · ${spec ? spec.name : 'Base'} · elo ${Math.round(m.elo)} · fit ×${productFitFor(m, kind).toFixed(2)}`;
}

export function modelName(s: GameState, id: Id | null): string {
  if (!id) return 'no model';
  return s.models.find((m) => m.id === id)?.name ?? 'retired model';
}

/** Revenue, serving cost and margin per day for one product. Serving cost is 0 until the serving tick has run. */
export function economics(p: Product): { revenue: number; cost: number; margin: number } {
  const revenue = p.revenuePerDay ?? 0;
  const cost = p.servingCostPerDay ?? 0;
  return { revenue, cost, margin: revenue - cost };
}

/** Product fields that a future history series may add. Read defensively: absent in today's saves. */
export type ProductWithHistory = Product & { usersHistory?: number[] };
