// OWNER: v18 post-training side effects. Hidden traits a model picks up from its post-training stages and data mix
// (sycophancy, reward hacking, over-refusal). Pure: rollTraits draws noise from the rng, the rest is arithmetic.
import type { Model, Rng, Segment, TraitId, TrainingConfig, Id } from '../types';
import { TRAIT_IDS } from '../types';
import { clamp } from '../util';
import type { MixRow } from './trainingMath';

/** Base severity each post-training stage adds (× that stage's postTake). The toxicity filter is added as a filter. */
const STAGE_BASE: Record<Id, Partial<Record<TraitId, number>>> = {
  sft: { sycophancy: 0.05, overRefusal: 0.05 },
  rlhf_ppo: { sycophancy: 0.35, rewardHacking: 0.1 },
  dpo_pass: { sycophancy: 0.2 },
  constitution: { sycophancy: -0.25, overRefusal: 0.4 },
  reasoning_rl: { rewardHacking: 0.2 },
  rlvr_pass: { rewardHacking: 0.15 },
  agentic_rl: { sycophancy: 0.05, rewardHacking: 0.25 },
};
const TOXICITY_OVER_REFUSAL = 0.1;
const TRAIT_NOISE_SD = 0.08;
const TRAIT_DROP_BELOW = 0.05;
const DIALOGUE_SYCOPHANCY = 0.3;
const DIALOGUE_FREE_SHARE = 0.25;
const TRAIT_APPEAL_FLOOR = 0.3;

/** Per segment, how much each trait moves the model's appeal (multiplier 1 + coef × severity). */
const TRAIT_APPEAL: Record<Segment, Record<TraitId, number>> = {
  consumer: { sycophancy: 0.1, rewardHacking: -0.05, overRefusal: -0.25 },
  developer: { sycophancy: -0.1, rewardHacking: -0.3, overRefusal: -0.15 },
  enterprise: { sycophancy: -0.25, rewardHacking: -0.2, overRefusal: 0.1 },
};

export const TRAIT_NAME: Record<TraitId, string> = {
  sycophancy: 'Sycophancy',
  rewardHacking: 'Reward hacking',
  overRefusal: 'Over-refusal',
};

type Traits = Partial<Record<TraitId, number>>;

/** Only sheets with post stages carry traits; a sheet without them draws no rng. */
function hasStages(cfg: TrainingConfig): boolean {
  return (cfg.post ?? []).some((id) => id in STAGE_BASE);
}

/** Pre-noise severities. `take` is the take of each stage (1 when unknown). */
function baseTraits(cfg: TrainingConfig, rows: readonly MixRow[], take: (id: Id) => number): Record<TraitId, number> {
  const out: Record<TraitId, number> = { sycophancy: 0, rewardHacking: 0, overRefusal: 0 };
  for (const id of cfg.post ?? []) {
    const base = STAGE_BASE[id];
    if (!base) continue;
    const t = take(id);
    for (const k of TRAIT_IDS) out[k] += (base[k] ?? 0) * t;
  }
  if ((cfg.filters ?? []).includes('toxicity')) out.overRefusal += TOXICITY_OVER_REFUSAL;
  const verifiable = rows.filter((r) => r.kind === 'code' || r.kind === 'science' || r.kind === 'synthetic').reduce((t, r) => t + r.share, 0);
  out.rewardHacking *= clamp(1.6 - 2 * verifiable, 0.3, 1.6);
  const dialogue = rows.filter((r) => r.kind === 'dialogue').reduce((t, r) => t + r.share, 0);
  out.sycophancy += DIALOGUE_SYCOPHANCY * Math.max(0, dialogue - DIALOGUE_FREE_SHARE);
  return out;
}

/** Hidden traits of a finished run: base severities × stage takes, mix effects, then N(0, 0.08) noise. */
export function rollTraits(rng: Rng, cfg: TrainingConfig, rows: readonly MixRow[], postTake?: Record<Id, number>): Traits {
  if (!hasStages(cfg)) return {};
  const raw = baseTraits(cfg, rows, (id) => postTake?.[id] ?? 1);
  const out: Traits = {};
  for (const k of TRAIT_IDS) {
    if (Math.abs(raw[k]) < 1e-9) continue;
    const v = clamp(raw[k] + rng.normal(0, TRAIT_NOISE_SD), 0, 1);
    if (v >= TRAIT_DROP_BELOW) out[k] = v;
  }
  return out;
}

/** The traits a sheet is expected to produce: no noise, every stage takes 1. The UI shows these as risk arrows. */
export function expectedTraits(cfg: TrainingConfig, rows: readonly MixRow[]): Traits {
  if (!hasStages(cfg)) return {};
  const raw = baseTraits(cfg, rows, () => 1);
  const out: Traits = {};
  for (const k of TRAIT_IDS) {
    const v = clamp(raw[k], 0, 1);
    if (v >= TRAIT_DROP_BELOW) out[k] = v;
  }
  return out;
}

/** Player-facing severity word for a trait value (0..1). */
export function traitLabel(v: number): 'mild' | 'noticeable' | 'severe' {
  if (v < 0.2) return 'mild';
  if (v < 0.5) return 'noticeable';
  return 'severe';
}

/** Appeal multiplier a model's traits give in a segment. Floors at 0.3. */
export function traitAppeal(m: Pick<Model, 'traits'> | undefined, seg: Segment): number {
  let x = 1;
  for (const k of TRAIT_IDS) x *= 1 + TRAIT_APPEAL[seg][k] * (m?.traits?.[k] ?? 0);
  return Math.max(TRAIT_APPEAL_FLOOR, x);
}
