// Each run modifier moves the one number it is meant to, and nothing when it is off.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import type { GameSetup, ModifierId } from '../types';
import { GPUS } from '../data/gpus';
import { gpuPriceMult } from './supply';
import { makeOffer } from './finance';
import { marketTick } from './market';
import { makeRng } from '../rng';
import { modifierMult, modifierNames } from './modifiers';

const setup = (modifiers?: ModifierId[]): GameSetup => ({
  scenarioId: 'garage',
  difficulty: 'founder',
  sandbox: false,
  skipTutorial: true,
  startYear: 2017,
  modifiers,
});

describe('run modifiers', () => {
  it('is 1 when the modifier is off, and the modifier multiplier when on', () => {
    expect(modifierMult(createInitialState(1, 'A', setup()), 'gpu_drought')).toBe(1);
    expect(modifierMult(createInitialState(1, 'A', setup(['gpu_drought'])), 'gpu_drought')).toBe(1.35);
    expect(modifierMult(createInitialState(1, 'A', setup(['gpu_drought'])), 'tight_money')).toBe(1);
  });

  it('GPU drought raises the GPU buy price multiplier', () => {
    const gpu = GPUS[0].id;
    const plain = createInitialState(1, 'A', setup());
    const drought = createInitialState(1, 'A', setup(['gpu_drought']));
    expect(gpuPriceMult(drought, gpu)).toBeCloseTo(1.35 * gpuPriceMult(plain, gpu), 10);
  });

  it('Tight money makes a funding round a quarter smaller', () => {
    const plain = createInitialState(1, 'A', setup());
    const tight = createInitialState(1, 'A', setup(['tight_money']));
    const a = makeOffer(plain, makeRng({ rngState: 5 }));
    const b = makeOffer(tight, makeRng({ rngState: 5 }));
    expect(b.amount / a.amount).toBeCloseTo(0.75, 1);
  });

  it('Hype cycle doubles the swing of the AI hype away from its base', () => {
    const plain = createInitialState(1, 'A', setup());
    const hyped = createInitialState(1, 'A', setup(['hype_cycle']));
    for (const s of [plain, hyped]) s.flags['hypeNudge'] = 20;
    marketTick(plain, makeRng(plain));
    marketTick(hyped, makeRng(hyped));
    expect(hyped.market.aiHype - plain.market.aiHype).toBeGreaterThan(0.5);
  });

  it('names the chosen modifiers for the HQ header', () => {
    expect(modifierNames(createInitialState(1, 'A', setup(['tight_money', 'gpu_drought'])))).toEqual(['GPU drought', 'Tight money']);
    expect(modifierNames(createInitialState(1, 'A', setup()))).toEqual([]);
  });
});
