// OWNER: PROGRESSION (v13, GAME_DESIGN §23). The lab perk tree: five branches, four tiers each.
// Tier 4 is a capstone and a lab may own only one, so a build commits to a playstyle.
// Passive `bonuses` fold into getBonuses (src/sim/bonuses.ts). A few perks are named hooks read by one system each:
// crunch_culture and careful_science (training tempo), momentum (hot streak training speed).
import type { PerkBranch, PerkDef } from '../types';

export const PERK_BRANCHES: { id: PerkBranch; name: string; pitch: string }[] = [
  { id: 'scale', name: 'Scale', pitch: 'Bigger runs, faster runs, a valuation that assumes both.' },
  { id: 'craft', name: 'Craft', pitch: 'Small models, cheap serving, crowns that punch above their weight.' },
  { id: 'hype', name: 'Hype', pitch: 'Launch days, brand and a timeline that will not stop posting.' },
  { id: 'data', name: 'Data', pitch: 'Cleaner tokens, faster papers, fewer surprises.' },
  { id: 'trust', name: 'Trust', pitch: 'Enterprise deals, procurement forms and very few incidents.' },
];

export const PERKS: PerkDef[] = [
  // ── Scale ──
  { id: 'cluster_energy', name: 'Cluster energy', branch: 'scale', tier: 1, cost: 1, minLevel: 2,
    description: 'Someone finally read the NCCL docs.', effectText: 'Training speed +8%.', bonuses: { trainingSpeed: 1.08 } },
  { id: 'crunch_culture', name: 'Crunch culture', branch: 'scale', tier: 2, cost: 2, minLevel: 5,
    description: 'The beanbags have been replaced with cots.', effectText: 'Crunch tempo burns half the morale and has 25% fewer incidents.' },
  { id: 'scaling_believers', name: 'Scaling believers', branch: 'scale', tier: 3, cost: 2, minLevel: 9,
    description: 'Investors now draw the line on the log chart themselves.', effectText: 'Valuation +6%, training speed +5%.', bonuses: { valuation: 1.06, trainingSpeed: 1.05 } },
  { id: 'scale_lifestyle', name: 'Scale is a lifestyle', branch: 'scale', tier: 4, cost: 3, minLevel: 14,
    description: 'The datacenter has its own zip code and opinions.', effectText: 'Capstone. Training speed +15%, release hype +10%.', bonuses: { trainingSpeed: 1.15, releaseHype: 1.1 } },

  // ── Craft ──
  { id: 'kernel_nerds', name: 'Kernel nerds', branch: 'craft', tier: 1, cost: 1, minLevel: 2,
    description: 'They rewrote attention in a language nobody else can read.', effectText: 'Inference efficiency +12% (cheaper serving).', bonuses: { inferenceEfficiency: 1.12 } },
  { id: 'distill_pipeline', name: 'Distillation pipeline', branch: 'craft', tier: 2, cost: 2, minLevel: 5,
    description: 'Big model in, small model out, coffee in between.', effectText: 'Fine-tunes, distills and bench tunes cost 15% less compute.', bonuses: { finetuneCost: 0.85 } },
  { id: 'pound_for_pound', name: 'Pound for pound', branch: 'craft', tier: 3, cost: 2, minLevel: 9,
    description: 'Wins the featherweight belt every year and brags about it.', effectText: 'Budget-tier appeal +10%, crown payoff +10%.', bonuses: { budgetAppeal: 1.1, crownValue: 1.1 } },
  { id: 'tiny_titans', name: 'Tiny titans', branch: 'craft', tier: 4, cost: 3, minLevel: 14,
    description: 'Runs on a toaster. Beats your flagship. Insufferable.', effectText: 'Capstone. Inference efficiency +25%, crown payoff +20%.', bonuses: { inferenceEfficiency: 1.25, crownValue: 1.2 } },

  // ── Hype ──
  { id: 'vibe_posting', name: 'Vibe posting', branch: 'hype', tier: 1, cost: 1, minLevel: 2,
    description: 'The CEO now posts a single strawberry emoji at 3am.', effectText: 'Brand gains +15%.', bonuses: { brand: 1.15 } },
  { id: 'launch_theater', name: 'Launch theater', branch: 'hype', tier: 2, cost: 2, minLevel: 5,
    description: 'Livestream, fog machine, a demo that mostly works.', effectText: 'Release hype and brand +15%.', bonuses: { releaseHype: 1.15 } },
  { id: 'waitlist_magic', name: 'Waitlist magic', branch: 'hype', tier: 3, cost: 2, minLevel: 9,
    description: 'Nobody can get in, so everybody wants in.', effectText: 'Brand gains +10%, valuation +4%.', bonuses: { brand: 1.1, valuation: 1.04 } },
  { id: 'main_character', name: 'Main character', branch: 'hype', tier: 4, cost: 3, minLevel: 14,
    description: 'Every timeline is about you. Some of it is even positive.', effectText: 'Capstone. Release hype +30%, brand gains +20%.', bonuses: { releaseHype: 1.3, brand: 1.2 } },

  // ── Data ──
  { id: 'data_janitors', name: 'Data janitors', branch: 'data', tier: 1, cost: 1, minLevel: 2,
    description: 'They delete SEO spam for a living and are happy about it.', effectText: 'Dataset quality +3%.', bonuses: { dataQuality: 1.03 } },
  { id: 'careful_science', name: 'Careful science', branch: 'data', tier: 2, cost: 2, minLevel: 5,
    description: 'Every change gets an ablation. Every ablation gets a meeting.', effectText: 'Careful tempo runs at 95% speed instead of 85%.' },
  { id: 'reading_group', name: 'Reading group', branch: 'data', tier: 3, cost: 2, minLevel: 9,
    description: 'Friday arXiv club, now with a snack budget.', effectText: 'Research speed +10%.', bonuses: { researchSpeed: 1.1 } },
  { id: 'data_moat', name: 'Data moat', branch: 'data', tier: 4, cost: 3, minLevel: 14,
    description: 'The tokens are the product. The model is the packaging.', effectText: 'Capstone. Dataset quality +6%, research speed +10%.', bonuses: { dataQuality: 1.06, researchSpeed: 1.1 } },

  // ── Trust ──
  { id: 'red_team_retainer', name: 'Red team on retainer', branch: 'trust', tier: 1, cost: 1, minLevel: 2,
    description: 'They try to break everything before Twitter does.', effectText: 'Safety +15% (fewer run incidents and leaks).', bonuses: { safety: 1.15 } },
  { id: 'soc2_binder', name: 'SOC 2 binder', branch: 'trust', tier: 2, cost: 2, minLevel: 5,
    description: 'Four hundred pages. Nobody has read page two.', effectText: 'Enterprise appeal +10%.', bonuses: { sales: 1.1 } },
  { id: 'procurement_whisperer', name: 'Procurement whisperer', branch: 'trust', tier: 3, cost: 2, minLevel: 9,
    description: 'Speaks fluent vendor questionnaire.', effectText: 'Contract fit +10%.', bonuses: { contractFit: 1.1 } },
  { id: 'boring_profitable', name: 'Boring is profitable', branch: 'trust', tier: 4, cost: 3, minLevel: 14,
    description: 'No launch party. Just invoices.', effectText: 'Capstone. Enterprise appeal +20%, contract fit +10%, safety +20%.', bonuses: { sales: 1.2, contractFit: 1.1, safety: 1.2 } },

  // ── Cross-branch hook ──
  { id: 'momentum', name: 'Momentum', branch: 'scale', tier: 2, cost: 1, minLevel: 4,
    description: 'Nothing motivates a lab like a run that beat the forecast.', effectText: 'Each step of the hot streak adds 2% training speed (max +10%).' },
];

const BY_ID = new Map(PERKS.map((p) => [p.id, p] as const));

export function perkById(id: string): PerkDef | undefined {
  return BY_ID.get(id);
}
