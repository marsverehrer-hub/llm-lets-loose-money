// OWNER: DOCTRINE. v8 lab doctrines (GAME_DESIGN §19.1). Passive multipliers are applied in src/sim/bonuses.ts;
// the named hooks (open-weights brand and research) read DOCTRINE_TUNING in src/sim/systems/release.ts.
import type { Bonuses, ContractKind, DoctrineId } from '../types';

/** Days after the first pick before the lab can change focus again. */
export const DOCTRINE_COOLDOWN = 365;

/** Cost of changing focus after the first pick. */
export const DOCTRINE_CHANGE_COST = { hype: 10, morale: 5 } as const;

/** Named doctrine hooks that are not plain Bonuses multipliers. */
export const DOCTRINE_TUNING = {
  /** Open releases: brand gain multiplier under the open doctrine. */
  OPEN_BRAND_MULT: 1.5,
  /** Open releases: research points banked, in days of current research output. */
  OPEN_RESEARCH_DAYS: 2,
} as const;

export interface DoctrineDef {
  id: DoctrineId;
  name: string;
  /** One dry line. */
  tagline: string;
  /** Two short sentences. */
  description: string;
  /** Global multipliers, multiplied into getBonuses. Missing keys are 1. */
  bonuses: Partial<Bonuses>;
  /** Deal-specific fit multipliers, read through contractFitMult (bonuses.ts), not through Bonuses.contractFit. */
  contractFit?: Partial<Record<ContractKind, number>>;
  /** Bullets for the picker and dashboard. Every multiplier shows as x<value>. */
  perks: string[];
  drawbacks: string[];
}

export const DOCTRINES: DoctrineDef[] = [
  {
    id: 'frontier',
    name: 'Scale is all you need',
    tagline: 'Bigger is better, and the power bill is a problem for next quarter.',
    description:
      'Train the biggest model the budget allows and ship it to everyone. Launches land harder, but buyers who only want a cheap model go elsewhere.',
    bonuses: { releaseHype: 1.3, valuation: 1.15, budgetAppeal: 0.9 },
    perks: ['Release hype and brand x1.3', 'Valuation x1.15'],
    drawbacks: ['Budget buyer appeal x0.9'],
  },
  {
    id: 'efficient',
    name: 'Small and mighty',
    tagline: 'Nobody has ever been impressed by a trillion-parameter electricity bill.',
    description:
      'Serve small, cheap, fast models to budget buyers and take the small-class crowns. The flagship is someone else’s problem.',
    bonuses: { inferenceEfficiency: 1.4, budgetAppeal: 1.25, trainingSpeed: 1.1, crownValue: 1.2, releaseHype: 0.85, valuation: 0.95 },
    perks: ['Inference efficiency x1.4', 'Budget buyer appeal x1.25', 'Training speed x1.1', 'Crown value x1.2'],
    drawbacks: ['Release hype and brand x0.85', 'Valuation x0.95'],
  },
  {
    id: 'open',
    name: 'Weights want to be free',
    tagline: 'Free weights, free publicity, and an investor deck that needs a lie down.',
    description:
      'Publish the weights of your releases. Brand and research pay off, users drift to self-hosting, and investors are not thrilled.',
    bonuses: { openPenalty: 0.4, valuation: 0.9 },
    contractFit: { onprem: 1.1 },
    perks: [
      'Open-weights user loss 10%, not 25% (penalty x0.4)',
      'Open releases: brand x1.5 and 2 days of research',
      'On-prem deal fit x1.1',
    ],
    drawbacks: ['Valuation x0.9'],
  },
  {
    id: 'specialist',
    name: 'Do one thing well',
    tagline: 'A generalist is a rounding error on someone else’s leaderboard.',
    description:
      'Start from a medium base and pour the savings into domain fine-tunes and bench tuning. Crowns and vertical deals pay better than raw size.',
    bonuses: { finetuneCost: 0.6, crownValue: 1.5, releaseHype: 0.9 },
    contractFit: { vertical: 1.15, grant: 1.15 },
    perks: ['Fine-tune, distill and bench tune compute x0.6', 'Crown value x1.5', 'Vertical and grant deal fit x1.15'],
    drawbacks: ['Release hype and brand x0.9'],
  },
  {
    id: 'enterprise',
    name: 'Boring is beautiful',
    tagline: 'Nobody got fired for buying the boring one.',
    description:
      'Safe, sold, and slow to ship. Government and on-prem buyers pay for the paperwork, and the press calls it dull.',
    bonuses: { sales: 1.2, safety: 1.3, releaseHype: 0.8, budgetAppeal: 0.95 },
    contractFit: { government: 1.2, onprem: 1.2 },
    perks: ['Sales x1.2', 'Safety x1.3', 'Government and on-prem deal fit x1.2'],
    drawbacks: ['Release hype and brand x0.8', 'Budget buyer appeal x0.95'],
  },
];

export function doctrineById(id: DoctrineId | null | undefined): DoctrineDef | undefined {
  if (!id) return undefined;
  return DOCTRINES.find((d) => d.id === id);
}
