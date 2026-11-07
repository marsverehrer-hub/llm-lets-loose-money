// v18 WP1: every option pays for itself with a downside, precision follows the GPUs the lab really owns, and the
// memory wall depends on the optimizer and precision picked.
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import type { GameState, TrainingConfig } from '../src/sim/types';
import { TRAINING_OPTIONS, RUN_TUNING, type TrainingOption, bestPrecision, configSignature, defaultConfig, describeConfig, moeActiveFraction, optionById, speedMultiplier, tokenizerFor, validateConfig } from '../src/sim/data/trainingOptions';
import { MEMORY_TUNING, fleetFormatSpeed, hwSpeed, memoryWall, memoryWallError } from '../src/sim/systems/scaleLimits';
import { sheetMemoryMult } from '../src/sim/data/memoryTerms';

// tests/setup.ts switches the memory wall off for old toy fleets; this file tests it
beforeAll(() => {
  MEMORY_TUNING.ENFORCE = true;
});
afterAll(() => {
  MEMORY_TUNING.ENFORCE = false;
});

/** Lab with a single rented GPU type and the given research. */
function lab(gpu: string, research: string[] = [], count = 2000): GameState {
  const s = createInitialState(11, 'Trade');
  s.research.completed.push('transformers', ...research);
  s.compute.rented = { [gpu]: count };
  s.finance.cash = 1e13;
  return s;
}

/** A default sheet with a patch; shape and moeTopK are v18 sheet fields not yet on the shared TrainingConfig type. */
function cfgWith(s: GameState, patch: Partial<TrainingConfig> & { shape?: number; moeTopK?: number }): TrainingConfig {
  return { ...defaultConfig(s), ...patch } as TrainingConfig;
}

/** Downside fields of an option: anything that costs the lab something. */
function downsides(o: TrainingOption): string[] {
  const out: string[] = [];
  if ((o.qualityMult ?? 1) < 1) out.push('quality');
  if ((o.speedMult ?? 1) < 1) out.push('speed');
  if ((o.instability ?? 0) > 0) out.push('instability');
  if ((o.memoryMult ?? 1) > 1) out.push('memory');
  if ((o.lrCurveMult ?? 1) > 1) out.push('learning rate');
  if ((o.inferenceMult ?? 1) > 1) out.push('serving');
  if ((o.flopsMult ?? 1) > 1) out.push('compute');
  if ((o.tokenMult ?? 1) > 1) out.push('tokens');
  if ((o.vocabK ?? 32) > 32) out.push('embedding tax');
  if (o.hwFormat) out.push('needs hardware');
  if (Object.values(o.capAdd ?? {}).some((v) => (v ?? 0) < 0)) out.push('capability');
  const keep = RUN_TUNING.KEEP[o.id];
  if (keep && keep.base < 1) out.push('early stop');
  return out;
}

const BASELINE = new Set(['bpe_32k', 'ctx_2k', 'adam', 'fp32']);

describe('option trade-offs', () => {
  it('every non-baseline option in tokenizer, context, optimizer, precision and schedule has a downside', () => {
    const groups = ['tokenizer', 'context', 'optimizer', 'precision', 'schedule'] as const;
    for (const o of TRAINING_OPTIONS.filter((x) => (groups as readonly string[]).includes(x.group))) {
      if (BASELINE.has(o.id)) continue;
      expect(downsides(o), o.id).not.toHaveLength(0);
    }
  });

  it('the tokenizer table carries vocabulary size and token cost, and drops the old quality bonuses', () => {
    expect(optionById('bpe_32k')).toMatchObject({ vocabK: 32, tokenMult: 1 });
    expect(optionById('bpe_100k')).toMatchObject({ vocabK: 100, tokenMult: 1.06, inferenceMult: 0.98 });
    expect(optionById('bpe_100k')?.qualityMult).toBeUndefined();
    expect(optionById('bpe_256k_multi')?.flopsMult).toBeUndefined();
    expect(optionById('byte_latent')).toMatchObject({ vocabK: 8, tokenMult: 1.1, inferenceMult: 0.85 });
  });

  it('long contexts serve cheaper, and AdamW is the touchy optimizer', () => {
    expect(optionById('ctx_10m')?.inferenceMult).toBe(0.7);
    expect(optionById('ctx_10m')?.flopsMult).toBe(1.6);
    expect(optionById('adamw')?.lrCurveMult).toBe(1.6);
    expect(optionById('adam')?.lrCurveMult).toBe(1);
  });
});

describe('precision on real hardware', () => {
  it('on a P100 fleet fp16 trains faster than bf16, which is emulated', () => {
    const s = lab('p100', ['bf16_training', 'mixed_precision']);
    expect(hwSpeed(undefined, 'bf16')).toBe(1);
    expect(fleetFormatSpeed(s, 'fp16')).toBeGreaterThan(fleetFormatSpeed(s, 'bf16'));
    expect(speedMultiplier(s, cfgWith(s, { precision: 'fp16' }))).toBeGreaterThan(speedMultiplier(s, cfgWith(s, { precision: 'bf16' })));
  });

  it('on an A100 fleet bf16 is faster than fp16', () => {
    const s = lab('a100', ['bf16_training', 'mixed_precision']);
    expect(fleetFormatSpeed(s, 'bf16')).toBeGreaterThan(fleetFormatSpeed(s, 'fp16'));
    expect(speedMultiplier(s, cfgWith(s, { precision: 'bf16' }))).toBeGreaterThan(speedMultiplier(s, cfgWith(s, { precision: 'fp16' })));
  });

  it('fp8 falls back to bf16 speed on an A100 and to fp16 speed on a P100', () => {
    expect(hwSpeed(undefined, 'fp8')).toBe(1.7);
    const a100 = lab('a100', ['bf16_training', 'fp8_training']);
    expect(fleetFormatSpeed(a100, 'fp8')).toBeCloseTo(1.8, 9);
    const h100 = lab('h100', ['bf16_training', 'fp8_training']);
    expect(fleetFormatSpeed(h100, 'fp8')).toBeCloseTo(2.6, 9);
  });

  it('bestPrecision picks the fastest stable format the fleet runs, and a tie goes to the more stable one', () => {
    expect(bestPrecision(lab('p100', ['mixed_precision', 'bf16_training']))).toBe('fp16');
    expect(bestPrecision(lab('a100', ['mixed_precision', 'bf16_training', 'fp8_training']))).toBe('bf16');
    expect(bestPrecision(lab('h100', ['bf16_training', 'fp8_training']))).toBe('fp8');
    // fp4 is unstable (instability above 0.5), so it is never the default even on a B200 fleet
    expect(bestPrecision(lab('b200', ['bf16_training', 'fp8_training', 'fp4_training']))).toBe('fp8');
  });

  it('defaultConfig uses the best precision for the fleet', () => {
    const s = lab('h100', ['bf16_training', 'fp8_training']);
    expect(defaultConfig(s).precision).toBe('fp8');
  });
});

describe('tokenizer by model size', () => {
  it('small models keep the 32K vocabulary; big models take the largest unlocked one, never byte latent', () => {
    const s = lab('a100', ['tokenizer_100k', 'multilingual_tokenizer', 'byte_latent']);
    expect(tokenizerFor(s, 3)).toBe('bpe_32k');
    expect(tokenizerFor(s, 10)).toBe('bpe_256k_multi');
    expect(defaultConfig(s, 30).tokenizer).toBe('bpe_256k_multi');
    expect(tokenizerFor(lab('a100', ['tokenizer_100k']), 10)).toBe('bpe_100k');
    expect(tokenizerFor(lab('a100'), 10)).toBe('bpe_32k');
  });
});

describe('memory wall with a sheet', () => {
  it('shampoo shrinks the memory wall and fp8 grows it', () => {
    const s = lab('a100', ['bf16_training', 'fp8_training', 'shampoo_soap']);
    const base = cfgWith(s, { precision: 'bf16', optimizer: 'adam' });
    const plain = memoryWall(s).maxParamsB;
    const withBase = memoryWall(s, base).maxParamsB;
    expect(withBase).toBeCloseTo(plain, 9); // adam and bf16 are the baseline
    expect(memoryWall(s, { ...base, optimizer: 'shampoo' }).maxParamsB).toBeLessThan(withBase);
    expect(memoryWall(s, { ...base, precision: 'fp8' }).maxParamsB).toBeGreaterThan(withBase);
    expect(sheetMemoryMult(base)).toBe(1);
  });

  it('a sheet makes the memory check tighter or looser than the bare fleet', () => {
    const s = lab('a100', ['transformers', 'bf16_training', 'shampoo_soap', 'zero_sharding']);
    const bare = memoryWall(s).maxParamsB;
    const shampoo = cfgWith(s, { precision: 'bf16', optimizer: 'shampoo' });
    const limit = memoryWall(s, shampoo).maxParamsB;
    expect(memoryWallError(s, limit * 0.99, shampoo)).toBeNull();
    expect(memoryWallError(s, limit * 1.5, shampoo)).toMatch(/Out of memory/);
    expect(memoryWallError(s, bare * 0.99)).toBeNull();
  });
});

describe('run sheet shape and top-k', () => {
  it('shape trades speed: deep runs lose 10% per unit of shape, wide runs gain it back', () => {
    const s = lab('a100', ['bf16_training']);
    const flat = speedMultiplier(s, cfgWith(s, { precision: 'bf16' }));
    expect(speedMultiplier(s, cfgWith(s, { precision: 'bf16', shape: 1 }))).toBeCloseTo(flat * 0.9, 9);
    expect(speedMultiplier(s, cfgWith(s, { precision: 'bf16', shape: -0.5 }))).toBeCloseTo(flat * 1.05, 9);
  });

  it('shape validates its range and LSTMs have none', () => {
    const s = lab('a100', ['transformers']);
    expect(validateConfig(s, cfgWith(s, { shape: 1.5 }))).toMatch(/Shape/);
    expect(validateConfig(s, cfgWith(s, { shape: 0.5 }))).toBeNull();
    expect(validateConfig(s, cfgWith(s, { arch: 'lstm', shape: 0.5 }))).toMatch(/LSTM/);
  });

  it('top-k is MoE only, one of 1, 2, 4 or 8, and below the expert count', () => {
    const s = lab('a100', ['transformers', 'moe']);
    expect(validateConfig(s, cfgWith(s, { moeTopK: 4 }))).toMatch(/Top-k only/);
    const moe = { arch: 'moe', moeExperts: 64 };
    expect(validateConfig(s, cfgWith(s, { ...moe, moeTopK: 4 }))).toBeNull();
    expect(validateConfig(s, cfgWith(s, { ...moe, moeTopK: 3 }))).toMatch(/Top-k must be 1, 2, 4 or 8/);
    expect(validateConfig(s, cfgWith(s, { arch: 'moe', moeExperts: 8, moeTopK: 8 }))).toMatch(/less than the expert count/);
  });

  it('top-k 4 activates more parameters than top-k 2, and its instability is lower', () => {
    expect(moeActiveFraction(64, 4)).toBeGreaterThan(moeActiveFraction(64, 2));
    expect(moeActiveFraction(64, 2)).toBeCloseTo(RUN_TUNING.MOE_ACTIVE_FRACTION[64], 12);
    expect(RUN_TUNING.MOE_TOPK[4].instab).toBeLessThan(RUN_TUNING.MOE_TOPK[2].instab);
  });

  it('signatures and labels only mention shape and top-k when they are set', () => {
    const s = lab('a100', ['transformers', 'moe']);
    const base = cfgWith(s, { arch: 'moe', moeExperts: 64 });
    expect(configSignature({ ...base, moeTopK: 2 } as TrainingConfig)).toBe(configSignature(base));
    expect(configSignature({ ...base, moeTopK: 4 } as TrainingConfig)).not.toBe(configSignature(base));
    expect(configSignature({ ...base, shape: 0.5 } as TrainingConfig)).toContain('shape:0.5');
    expect(describeConfig({ ...base, moeTopK: 4, shape: -0.5 } as TrainingConfig)).toMatch(/top-k 4 · wide/);
    expect(describeConfig({ ...base, shape: 0.5 } as TrainingConfig)).toMatch(/deep/);
  });
});
