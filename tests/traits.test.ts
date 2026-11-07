// v18 WP4: post-training side effects as hidden traits.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import type { DataKind, Id, TrainingConfig } from '../src/sim/types';
import { makeRng } from '../src/sim/rng';
import type { MixRow } from '../src/sim/systems/trainingMath';
import { expectedTraits, rollTraits, traitAppeal, traitLabel } from '../src/sim/systems/traits';

function cfgWith(post: Id[], filters: Id[] = []): TrainingConfig {
  return { ...defaultConfig(createInitialState(1, 'Traits')), post, filters };
}

/** A mix with the given kind shares (sums to 1 in the tests below). */
function rowsOf(shares: Partial<Record<DataKind, number>>): MixRow[] {
  return Object.entries(shares).map(([kind, share]) => ({ kind: kind as DataKind, share: share ?? 0, quality: 1 }));
}

const WEB = rowsOf({ web: 1 });
const CODE = rowsOf({ code: 1 });

describe('traits: post-training side effects', () => {
  it('RLVR hacks more on a mix with nothing verifiable than on a code-heavy mix', () => {
    const cfg = cfgWith(['rlvr_pass']);
    const plain = expectedTraits(cfg, WEB).rewardHacking ?? 0;
    const coded = expectedTraits(cfg, CODE).rewardHacking ?? 0;
    expect(plain).toBeCloseTo(0.15 * 1.6, 9);
    expect(plain).toBeGreaterThan(coded);
  });

  it('constitution raises over-refusal and lowers sycophancy', () => {
    const before = expectedTraits(cfgWith(['rlhf_ppo']), WEB);
    const after = expectedTraits(cfgWith(['rlhf_ppo', 'constitution']), WEB);
    expect(after.overRefusal ?? 0).toBeGreaterThan(before.overRefusal ?? 0);
    expect(after.sycophancy ?? 0).toBeLessThan(before.sycophancy ?? 0);
  });

  it('high over-refusal loses consumer appeal and gains enterprise appeal', () => {
    const m = { traits: { overRefusal: 0.8 } };
    expect(traitAppeal(m, 'consumer')).toBeLessThan(1);
    expect(traitAppeal(m, 'enterprise')).toBeGreaterThan(1);
    expect(traitAppeal(undefined, 'consumer')).toBe(1);
    expect(traitAppeal({ traits: { sycophancy: 1, rewardHacking: 1, overRefusal: 1 } }, 'developer')).toBeGreaterThanOrEqual(0.3);
  });

  it('a sheet with no post stages draws no RNG', () => {
    const state = { rngState: 7 };
    const rng = makeRng(state);
    expect(rollTraits(rng, cfgWith([]), WEB)).toEqual({});
    expect(rollTraits(rng, cfgWith([]), CODE)).toEqual({});
    expect(state.rngState).toBe(7);
  });

  it('a dud stage (take 0) adds no sycophancy from itself', () => {
    const rng = makeRng({ rngState: 3 });
    expect(rollTraits(rng, cfgWith(['rlhf_ppo']), WEB, { rlhf_ppo: 0 })).toEqual({});
  });

  it('dialogue-heavy mixes add sycophancy above a 25% share', () => {
    const traits = expectedTraits(cfgWith(['reasoning_rl']), rowsOf({ dialogue: 0.75, web: 0.25 }));
    expect(traits.sycophancy ?? 0).toBeCloseTo(0.3 * 0.5, 9);
  });

  it('rollTraits keeps values in 0..1 and drops anything under 0.05', () => {
    const cfg = cfgWith(['rlhf_ppo', 'constitution', 'agentic_rl'], ['toxicity']);
    for (let seed = 1; seed <= 20; seed++) {
      const traits = rollTraits(makeRng({ rngState: seed }), cfg, WEB, { rlhf_ppo: 2, constitution: 0.5 });
      for (const v of Object.values(traits)) {
        expect(v).toBeGreaterThanOrEqual(0.05);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('labels: mild below 0.2, noticeable below 0.5, severe otherwise', () => {
    expect(traitLabel(0.1)).toBe('mild');
    expect(traitLabel(0.3)).toBe('noticeable');
    expect(traitLabel(0.7)).toBe('severe');
  });
});
