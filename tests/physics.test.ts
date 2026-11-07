// v18 WP2: run physics. The tokenizer trades embedding parameters against vocabulary, shape trades raw quality for
// reasoning, top-k buys active parameters with stability, repeated data past four passes hurts, and a cosine run
// pays for extra tokens while a WSD run does not.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import type { GameState, TrainingConfig, TrainingRun } from '../src/sim/types';
import { defaultConfig, RUN_TUNING } from '../src/sim/data/trainingOptions';
import { DATA_KIND_CAPS } from '../src/sim/data/trainingOptions';
import { activeParamsFor, extendRun, mixCapAdd, mixRows, resolveRun, truncateRun } from '../src/sim/systems/trainingMath';
import { forecastTraining } from '../src/sim/systems/lab';

/** A lab with transformers researched, a big rented fleet, and the web and code datasets it owns. */
const WEB = 'open_web_chlorinated'; // 20T unique tokens
const CODE = 'github_firehose'; // 15B unique tokens
function lab(): GameState {
  const s = createInitialState(21, 'Physics');
  s.research.completed.push('transformers');
  s.compute.rented = { a100: 2000 };
  s.finance.cash = 1e13;
  s.data.owned = [WEB, CODE];
  return s;
}

/** A default dense sheet with a patch; shape and moeTopK are v18 sheet fields. */
function cfgWith(s: GameState, patch: Partial<TrainingConfig> & { shape?: number; moeTopK?: number }): TrainingConfig {
  return { ...defaultConfig(s), arch: 'dense', ...patch } as TrainingConfig;
}

describe('tokenizer crossover', () => {
  it('a 100K vocabulary loses to 32K at half a billion parameters and wins at 30B', () => {
    const s = lab();
    const mid = (paramsB: number, tokensB: number, tokenizer: string) => forecastTraining(s, paramsB, tokensB, [WEB], [], cfgWith(s, { tokenizer })).mid;
    expect(mid(0.5, 10, 'bpe_100k')).toBeLessThan(mid(0.5, 10, 'bpe_32k'));
    expect(mid(30, 600, 'bpe_100k')).toBeGreaterThan(mid(30, 600, 'bpe_32k'));
  });
});

describe('shape', () => {
  it('an extreme shape costs raw quality but shifts reasoning against knowledge', () => {
    const s = lab();
    const flat = resolveRun(s, 10, 200, [WEB], [], cfgWith(s, { shape: 0 }), 'belief');
    const deep = resolveRun(s, 10, 200, [WEB], [], cfgWith(s, { shape: 1 }), 'belief');
    expect(deep.qualityMult).toBeLessThan(flat.qualityMult);
    expect(deep.capAdd.reasoning ?? 0).toBeGreaterThan(flat.capAdd.reasoning ?? 0);
    expect(deep.capAdd.knowledge ?? 0).toBeLessThan(flat.capAdd.knowledge ?? 0);
    expect(deep.instability).toBeGreaterThan(flat.instability);
  });
});

describe('MoE top-k', () => {
  it('top-k 4 has more active parameters and less instability than top-k 2', () => {
    const s = lab();
    const k2 = cfgWith(s, { arch: 'moe', moeExperts: 16, moeTopK: 2 });
    const k4 = cfgWith(s, { arch: 'moe', moeExperts: 16, moeTopK: 4 });
    expect(activeParamsFor(100, k4)).toBeGreaterThan(activeParamsFor(100, k2));
    const i2 = resolveRun(s, 100, 2000, [WEB], [], k2, 'belief').instability;
    const i4 = resolveRun(s, 100, 2000, [WEB], [], k4, 'belief').instability;
    expect(i4).toBeLessThan(i2);
  });
});

describe('repetition', () => {
  it('a code share of one half over eight epochs gets the repetition penalty', () => {
    const s = lab();
    const cfg = cfgWith(s, { dataMix: { web: 1, code: 1 } });
    const unique = 15; // CODE's tokens (billions)
    const repeated = resolveRun(s, 1, 16 * unique, [WEB, CODE], [], cfg, 'belief'); // code: 16 x 0.5 x 15 / 15 = 8 passes
    const once = resolveRun(s, 1, 4 * unique, [WEB, CODE], [], cfg, 'belief'); // code: 2 passes, no penalty
    const code = mixRows(s, [WEB, CODE], cfg, 'belief', 16 * unique).find((r) => r.kind === 'code');
    expect(code?.epochs).toBeCloseTo(8, 9);
    expect(repeated.qualityMult / once.qualityMult).toBeCloseTo(1 - 0.03 * 4 * 0.5, 6);
  });
});

describe('extension and early stop', () => {
  /** A live pretraining run on the given data, half done, with the given schedule. */
  function liveRun(s: GameState, schedule: string, datasetIds: string[] = [WEB], tokensB = 200): TrainingRun {
    const config = cfgWith(s, { schedule: schedule as TrainingConfig['schedule'] });
    const phys = resolveRun(s, 10, tokensB, datasetIds, [], config, 'true');
    return {
      id: 'r',
      name: 'Test',
      kind: 'pretrain',
      paramsB: 10,
      tokensB,
      datasetIds,
      techniques: [],
      config,
      qualityMult: 1,
      totalFlops: phys.totalFlops,
      doneFlops: phys.totalFlops / 2,
      predictedLoss: phys.loss,
      dataQuality: phys.dataQuality,
    } as unknown as TrainingRun;
  }

  it('a cosine run extended by 50% takes a quality hit and a WSD run does not', () => {
    const s = lab();
    const cosine = liveRun(s, 'cosine');
    const wsd = liveRun(s, 'wsd');
    expect(extendRun(s, cosine, 0.5)).toBeNull();
    expect(extendRun(s, wsd, 0.5)).toBeNull();
    expect(cosine.qualityMult).toBeCloseTo(1 - 0.08 * 0.5, 9);
    expect(wsd.qualityMult).toBe(1);
    expect(cosine.tokensB).toBeCloseTo(300, 9);
  });

  it('extendRun refuses a fraction out of range and a run past its data headroom', () => {
    const s = lab();
    expect(extendRun(s, liveRun(s, 'wsd'), 0.9)).toMatch(/Extend by between/);
    // CODE has 15B unique tokens and up to four passes: 60B is the ceiling, so 60B plus 25% is too much.
    expect(extendRun(s, liveRun(s, 'wsd', [CODE], 60), 0.25)).toMatch(/headroom/);
  });

  it('early stop keeps the schedule share of quality and ends the run at the FLOPs done', () => {
    const s = lab();
    const wsd = liveRun(s, 'wsd');
    const keep = truncateRun(s, wsd);
    expect(keep).toBeCloseTo(0.95 + 0.05 * 0.5, 9);
    expect(wsd.qualityMult).toBeCloseTo(keep, 9);
    expect(wsd.totalFlops).toBe(wsd.doneFlops);
    expect(wsd.tokensB).toBeCloseTo(100, 9);
  });
});

describe('data mix', () => {
  it('an even split moves no capability, and a kind left out costs the full swing', () => {
    const even = mixCapAdd([
      { kind: 'web', share: 0.5, quality: 0.5 },
      { kind: 'code', share: 0.5, quality: 0.5 },
    ]);
    for (const v of Object.values(even)) expect(Math.abs(v ?? 0)).toBeLessThan(1e-9);
    const leftOut = mixCapAdd([
      { kind: 'web', share: 1, quality: 0.5 },
      { kind: 'code', share: 0, quality: 0.5 },
    ]);
    for (const [cap, v] of Object.entries(leftOut)) {
      const web = DATA_KIND_CAPS.web[cap as keyof typeof DATA_KIND_CAPS.web] ?? 0;
      const code = DATA_KIND_CAPS.code[cap as keyof typeof DATA_KIND_CAPS.code] ?? 0;
      expect(v).toBeCloseTo(RUN_TUNING.MIX_SWING * (web - code), 9);
    }
  });
});
