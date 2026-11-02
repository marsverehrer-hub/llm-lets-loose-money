// v16 (GAME_DESIGN §28.1): turn a recipe preset into a complete, valid pre-training run sheet sized to a time budget.
// The quick start in the train wizard dispatches what planRecipe returns; experts open the same sheet in the wizard.
import type { Capabilities, GameAction, GameState, Id, TrainingConfig } from '../types';
import { RECIPES, recipeById, type RecipeId } from '../data/recipes';
import { defaultConfig, equalMixFor, isOptionUnlocked } from '../data/trainingOptions';
import { availableTechniques, datasetTokensOf, TRAINING_TUNING } from './training';
import { effParamsFor, resolveRun } from './trainingMath';
import { datasetById } from './data';

export { RECIPES };

const OPTIMAL_TPP = 20;
const MAX_TECHNIQUES = 6;

/** The recipe's run sheet: the lab's best defaults, the recipe's data emphasis, and every unlocked stage it wants. */
export function recipeConfig(s: GameState, id: RecipeId, datasetIds: readonly Id[]): TrainingConfig {
  const r = recipeById(id) ?? RECIPES[0];
  const cfg = defaultConfig(s);
  const mix = equalMixFor(s, datasetIds);
  for (const k of Object.keys(mix) as (keyof typeof mix)[]) mix[k] = r.mix[k] ?? 1;
  cfg.dataMix = mix;
  const post = r.post.flatMap((slot) => (Array.isArray(slot) ? slot : [slot]).find((x) => isOptionUnlocked(s, x)) ?? []);
  if (post.length) cfg.post = post;
  const anneal = r.anneal.find((x) => isOptionUnlocked(s, x));
  if (anneal) cfg.anneal = anneal;
  if (r.cheap) {
    const fast = ['fp4', 'fp8', 'bf16', 'fp16'].find((x) => isOptionUnlocked(s, x));
    if (fast) cfg.precision = fast;
    cfg.context = ['ctx_8k', 'ctx_2k'].find((x) => isOptionUnlocked(s, x)) ?? cfg.context;
    cfg.filters = cfg.filters.filter((f) => f !== 'quality_clf');
  }
  return cfg;
}

/** Researched techniques, best first (at most six): general value plus extra weight on the recipe's focus. */
export function recipeTechniques(s: GameState, id: RecipeId): Id[] {
  const r = recipeById(id) ?? RECIPES[0];
  const fromScore: Record<string, keyof Capabilities> = { reasoning: 'reasoning', coding: 'coding', chat: 'chat', safety: 'safety' };
  return availableTechniques(s)
    .map((t) => {
      let score = 0;
      for (const [k, v] of Object.entries(t.capBonus ?? {})) score += (0.5 + (r.focus[k as keyof Capabilities] ?? 0)) * (v ?? 0);
      for (const [k, v] of Object.entries(t.scoreBonus ?? {})) score += (0.5 + (r.focus[fromScore[k]] ?? 0)) * (v ?? 0);
      return { id: t.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, r.cheap ? 3 : MAX_TECHNIQUES)
    .map((x) => x.id);
}

export interface RecipePlan {
  action: Extract<GameAction, { type: 'startTraining' }>;
  days: number;
  totalFlops: number;
}

/**
 * The largest compute-optimal run (20 tokens per effective parameter, capped by the data owned and the epoch limit)
 * that finishes within `days` on today's training compute. Null when there is no data or no compute.
 */
export function planRecipe(s: GameState, id: RecipeId, name: string, days?: number, datasetIds: readonly Id[] = s.data.owned): RecipePlan | null {
  const ids = datasetIds.filter((x) => s.data.owned.includes(x) && datasetById(s, x));
  if (ids.length === 0) return null;
  const r = recipeById(id) ?? RECIPES[0];
  const budget = days ?? r.days;
  const cfg = recipeConfig(s, r.id, ids);
  const techniques = recipeTechniques(s, r.id);
  const maxTokens = TRAINING_TUNING.MAX_EPOCHS * datasetTokensOf(s, ids);
  if (maxTokens < TRAINING_TUNING.MIN_TOKENS_B) return null;
  const tokensFor = (p: number) => Math.max(TRAINING_TUNING.MIN_TOKENS_B, Math.min(OPTIMAL_TPP * effParamsFor(p, cfg), maxTokens));
  const daysAt = (p: number) => resolveRun(s, p, tokensFor(p), ids, techniques, cfg, 'belief').days;
  const lo0 = TRAINING_TUNING.MIN_PARAMS_B;
  if (!Number.isFinite(daysAt(lo0))) return null;
  // Never size past what the data can feed at the optimal ratio.
  const hiP = Math.min(TRAINING_TUNING.MAX_PARAMS_B, Math.max(lo0, maxTokens / (OPTIMAL_TPP * effParamsFor(1, cfg))));
  let lo = Math.log(lo0);
  let hi = Math.log(hiP);
  if (daysAt(hiP) <= budget) lo = hi;
  else {
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (daysAt(Math.exp(mid)) <= budget) lo = mid;
      else hi = mid;
    }
  }
  const paramsB = Number(Math.exp(lo).toPrecision(2));
  const tokensB = Math.min(maxTokens, Number(tokensFor(paramsB).toPrecision(3)));
  const phys = resolveRun(s, paramsB, tokensB, ids, techniques, cfg, 'belief');
  return {
    action: { type: 'startTraining', name, paramsB, tokensB, datasetIds: ids, techniques, config: cfg },
    days: phys.days,
    totalFlops: phys.totalFlops,
  };
}
