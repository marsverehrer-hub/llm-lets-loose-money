import { describe, it, expect } from 'vitest';
import { RESEARCH } from '../src/sim/data/research';
import { RESEARCH_BRANCHES } from '../src/sim/types';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import {
  DIFFUSION_FLOOR,
  DIFFUSION_PER_YEAR,
  diffusionFactor,
  effectiveResearchCost,
  isResearched,
  researchCost,
  RESEARCH_TUNING,
  researchPointsPerDay,
} from '../src/sim/systems/research';
import { BALANCE } from '../src/sim/balance';

const BY_ID = new Map(RESEARCH.map((n) => [n.id, n] as const));

/** A day in April of the given calendar year (sim day 0 is 1 January of BALANCE.START_YEAR). */
function dayIn(year: number): number {
  return Math.round((Date.UTC(year, 3, 1) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000);
}

// Ids referenced elsewhere in src/sim, tests and scripts (GAME_DESIGN.md 13.3 "must keep" plus current references).
const MUST_KEEP = [
  'transformers', 'scaling_laws', 'instruction_tuning', 'rlhf', 'code_models', 'long_context', 'moe', 'multimodal',
  'chain_of_thought', 'reasoning_models', 'enterprise_ready', 'constitutional_ai', 'distillation', 'flash_attention',
  'synthetic_data', 'agents', 'nuclear_power', 'interpretability', 'agi', 'tool_use', 'self_improvement', 'world_models',
  'million_token', 'infinite_context', 'mixed_precision', 'data_filtering',
  'kv_cache', 'quantization', 'growth_hacking', 'speculative_decoding', 'red_teaming', 'enterprise_sales', 'rag',
];

// GAME_DESIGN.md 13.1 / 13.2 gate ids that must exist.
const MUST_ADD = [
  'mamba_hybrid', 'diffusion_lm', 'recurrent_depth', 'tokenizer_100k', 'multilingual_tokenizer', 'byte_latent', 'rope', 'yarn_scaling',
  'adamw', 'lion_optimizer', 'shampoo_soap', 'muon_optimizer', 'bf16_training', 'fp8_training', 'fp4_training', 'wsd_schedule',
  'minhash_dedup', 'quality_classifiers', 'toxicity_filtering', 'decontamination', 'pii_scrubbing',
  'qk_norm', 'z_loss', 'mup_transfer', 'moe_load_balancing', 'aux_free_balancing',
  'zero_sharding', 'tensor_parallel', 'pipeline_parallel', 'parallelism_3d', 'cross_dc_training', 'fused_kernels',
  'flash_attention_3', 'async_checkpointing', 'fault_tolerant_training',
  'sae_steering', 'persona_vectors',
];

/** Depth of the prereq chain: 0 for roots, otherwise 1 + the deepest prereq. */
function depthOf(id: string, seen: string[] = []): number {
  const node = BY_ID.get(id);
  if (!node) throw new Error(`unknown node ${id}`);
  if (seen.includes(id)) throw new Error(`cycle through ${id}`);
  if (node.prereqs.length === 0) return 0;
  return 1 + Math.max(...node.prereqs.map((p) => depthOf(p, [...seen, id])));
}

describe('research tree structure', () => {
  it('has unique ids', () => {
    expect(new Set(RESEARCH.map((n) => n.id)).size).toBe(RESEARCH.length);
  });

  it('every prerequisite exists and no node requires itself', () => {
    for (const node of RESEARCH) {
      for (const p of node.prereqs) {
        expect(BY_ID.has(p), `${node.id} -> ${p}`).toBe(true);
        expect(p, `${node.id} requires itself`).not.toBe(node.id);
      }
    }
  });

  it('the prerequisite graph has no cycles', () => {
    for (const node of RESEARCH) expect(() => depthOf(node.id)).not.toThrow();
  });

  it('keeps every existing id and adds every gate id from GAME_DESIGN 13.1 and 13.2', () => {
    for (const id of [...MUST_KEEP, ...MUST_ADD]) expect(BY_ID.has(id), id).toBe(true);
  });

  it('every node has a branch, an effect line, an icon and a sane minYear', () => {
    for (const node of RESEARCH) {
      expect(RESEARCH_BRANCHES, node.id).toContain(node.branch);
      expect(node.effectText?.trim().length ?? 0, node.id).toBeGreaterThan(0);
      expect(node.icon.length, node.id).toBeGreaterThan(0);
      expect(node.minYear, node.id).toBeGreaterThanOrEqual(2017);
      expect(node.minYear, node.id).toBeLessThanOrEqual(2034);
    }
  });

  it('covers all eleven branches', () => {
    for (const branch of RESEARCH_BRANCHES) {
      const count = RESEARCH.filter((n) => n.branch === branch).length;
      expect(count, branch).toBeGreaterThanOrEqual(5);
    }
  });

  it('tier equals the prerequisite depth', () => {
    for (const node of RESEARCH) expect(node.tier, node.id).toBe(depthOf(node.id));
  });

  it('no node is researchable before its prerequisites open (minYear is non-decreasing along prereqs)', () => {
    for (const node of RESEARCH) {
      for (const p of node.prereqs) expect(BY_ID.get(p)!.minYear, `${p} -> ${node.id}`).toBeLessThanOrEqual(node.minYear);
    }
  });

  it('only chat and enterprise come from research products, each from exactly one node', () => {
    const unlocks = RESEARCH.filter((n) => n.unlocksProduct).map((n) => `${n.unlocksProduct}:${n.id}`).sort();
    expect(unlocks).toEqual(['chat:instruction_tuning', 'enterprise:enterprise_ready']);
  });

  it('technique nodes carry a capability or score bonus', () => {
    for (const node of RESEARCH.filter((n) => n.technique)) {
      const hasBonus = Object.keys(node.capBonus ?? {}).length + Object.keys(node.scoreBonus ?? {}).length > 0;
      expect(hasBonus, node.id).toBe(true);
    }
  });

  it('passive bonuses stay in the design ranges', () => {
    const product = (key: 'trainingSpeed' | 'inferenceEfficiency' | 'researchSpeed') =>
      RESEARCH.reduce((acc, n) => acc * (n.bonuses?.[key] ?? 1), 1);
    expect(product('trainingSpeed')).toBeLessThanOrEqual(4);
    expect(product('inferenceEfficiency')).toBeLessThanOrEqual(25);
    expect(product('researchSpeed')).toBeLessThanOrEqual(3);
    for (const node of RESEARCH) {
      for (const v of Object.values(node.bonuses ?? {})) expect(v, node.id).toBeGreaterThan(0);
    }
  });
});

describe('research costs and pacing', () => {
  it('has about 120 nodes', () => {
    expect(RESEARCH.length).toBeGreaterThanOrEqual(115);
    expect(RESEARCH.length).toBeLessThanOrEqual(130);
  });

  it('every node has a positive cost, and AGI is the single most expensive capstone', () => {
    for (const node of RESEARCH) expect(node.cost, node.id).toBeGreaterThan(0);
    const agi = BY_ID.get('agi')!;
    expect(RESEARCH.every((n) => n.cost <= agi.cost)).toBe(true);
    expect(RESEARCH.some((n) => n.prereqs.includes('agi'))).toBe(false);
  });

  it('total cost is in the range for a tree that takes roughly 18 years', () => {
    const total = RESEARCH.reduce((acc, n) => acc + n.cost, 0);
    expect(total).toBeGreaterThan(1_500_000);
    expect(total).toBeLessThan(3_000_000);
  });

  it('transformers is the cheap opener', () => {
    expect(BY_ID.get('transformers')!.cost).toBeLessThanOrEqual(30);
    expect(BY_ID.get('transformers')!.tier).toBe(0);
  });

  it('the four cheapest nodes open in 2017-2018 fit inside the first year of starting research', () => {
    const s = createInitialState(42);
    const firstYearRp = researchPointsPerDay(s) * 365;
    const early = RESEARCH.filter((n) => n.minYear <= 2018).map((n) => n.cost).sort((a, b) => a - b);
    const cheapestFour = early.slice(0, 4).reduce((a, b) => a + b, 0);
    expect(cheapestFour).toBeLessThanOrEqual(firstYearRp);
  });

  it('a fresh game can research transformers within about 18 days', () => {
    const s = createInitialState(42);
    dispatch(s, { type: 'setResearch', nodeId: 'transformers' });
    expect(s.research.current).toBe('transformers');
    let days = 0;
    while (!isResearched(s, 'transformers') && days < 30) {
      tick(s);
      days++;
    }
    expect(isResearched(s, 'transformers')).toBe(true);
    expect(days).toBeLessThanOrEqual(18);
  });
});

describe('knowledge diffusion (v10, GAME_DESIGN 21.2)', () => {
  it('uses the design constants: -30% a year, floor at a quarter', () => {
    expect(DIFFUSION_PER_YEAR).toBeCloseTo(0.7, 6);
    expect(DIFFUSION_FLOOR).toBeCloseTo(0.25, 6);
  });

  it('a node costs its base price in its own year and before it', () => {
    const s = createInitialState(42);
    const n = BY_ID.get('rmsnorm')!; // minYear 2019
    for (const y of [2017, 2018, 2019]) {
      s.day = dayIn(y);
      expect(effectiveResearchCost(s, n), `${y}`).toBe(researchCost(n));
    }
  });

  it('each calendar year past minYear cuts the price by 30 percent, down to the floor', () => {
    const s = createInitialState(42);
    const n = BY_ID.get('rmsnorm')!;
    s.day = dayIn(2021); // two years after 2019
    expect(diffusionFactor(s, n)).toBeCloseTo(0.49, 6);
    expect(effectiveResearchCost(s, n)).toBe(Math.round(researchCost(n) * 0.49));
    s.day = dayIn(2030);
    expect(diffusionFactor(s, n)).toBeCloseTo(DIFFUSION_FLOOR, 6);
    expect(effectiveResearchCost(s, n)).toBe(Math.round(researchCost(n) * DIFFUSION_FLOOR));
  });

  it('the price never rises over time and never drops below the floor', () => {
    const s = createInitialState(42);
    for (const n of RESEARCH) {
      const floor = Math.round(researchCost(n) * DIFFUSION_FLOOR);
      let last = Infinity;
      for (let y = 2017; y <= 2040; y++) {
        s.day = dayIn(y);
        const c = effectiveResearchCost(s, n);
        expect(c, `${n.id} ${y}`).toBeLessThanOrEqual(last);
        expect(c, `${n.id} ${y}`).toBeGreaterThanOrEqual(floor);
        last = c;
      }
    }
  });

  it('progress is compared with the effective price, so an old node finishes on its discounted cost', () => {
    const s = createInitialState(42);
    const n = BY_ID.get('transformers')!; // no prereqs, minYear 2017
    s.day = dayIn(2025); // at the floor by now
    expect(effectiveResearchCost(s, n)).toBeLessThan(researchCost(n));
    expect(researchPointsPerDay(s)).toBeGreaterThanOrEqual(1);
    s.research.current = n.id;
    s.research.progress = effectiveResearchCost(s, n) - 1;
    tick(s);
    expect(isResearched(s, n.id)).toBe(true);
  });

  it('the last gate opens in 2031, so nobody can finish the tree before 2030', () => {
    const last = Math.max(...RESEARCH.map((n) => n.minYear));
    expect(last - RESEARCH_TUNING.EARLY_YEARS).toBeGreaterThanOrEqual(2030);
  });
});
