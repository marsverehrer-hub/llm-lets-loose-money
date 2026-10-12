// Data scaling: tokens per parameter (undertraining penalty), forecast reasons, fixed run overhead, bot sizing.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import { estimateTraining, trainingRatePerDay } from '../src/sim/systems/training';
import { forecastTraining } from '../src/sim/systems/lab';
import {
  LOSS_PER_QUALITY_POINT,
  SCALE_TUNING,
  chinchillaLoss,
  effectiveTokens,
  resolveRun,
  runOverheadDays,
  undertrainPenalty,
} from '../src/sim/systems/trainingMath';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { sizeBotRun } from '../scripts/bot';
import { datasetById } from '../src/sim/systems/data';

/** A lab with a big rented fleet, transformers researched, and one dataset large enough for trillion-token runs. */
const BIG = 'open_web_chlorinated'; // 20T unique tokens
const DATA = ['scrawl_sample', 'common_scrawl_full'];

function lab(seed: number): GameState {
  const s = createInitialState(seed, 'Scale');
  s.research.completed.push('transformers');
  s.compute.rented = { p100: 2000 };
  s.finance.cash = 1e13;
  s.data.owned = [...DATA, BIG];
  return s;
}

/** One day: answer any incident or event the way the tests always do, then tick. */
function day(s: GameState): void {
  const pending = s.training?.pendingIncident;
  if (pending && pending.result === undefined) dispatch(s, { type: 'resolveRunIncident', choice: 0 });
  if (s.training?.pendingIncident?.result !== undefined) dispatch(s, { type: 'clearRunIncident' });
  if (s.events.pending) {
    dispatch(s, { type: 'resolveEvent', choice: 0 });
    dispatch(s, { type: 'clearEventResult' });
  }
  tick(s);
}

describe('undertraining penalty', () => {
  it('is zero at or above the compute-optimal ratio, and never negative', () => {
    expect(undertrainPenalty(SCALE_TUNING.OPTIMAL_RATIO)).toBe(0);
    expect(undertrainPenalty(40)).toBe(0);
    expect(undertrainPenalty(100)).toBe(0);
  });

  it('is about 20 quality points at 0.4 tokens per parameter', () => {
    const p = undertrainPenalty(0.4);
    expect(p).toBeGreaterThan(19);
    expect(p).toBeLessThan(21);
  });

  it('grows as the ratio falls, and is capped at UNDER_MAX', () => {
    expect(undertrainPenalty(19)).toBeLessThan(undertrainPenalty(12));
    expect(undertrainPenalty(12)).toBeLessThan(undertrainPenalty(5));
    expect(undertrainPenalty(5)).toBeLessThan(undertrainPenalty(0.5));
    expect(undertrainPenalty(0.001)).toBe(SCALE_TUNING.UNDER_MAX);
    expect(undertrainPenalty(0.14)).toBe(SCALE_TUNING.UNDER_MAX);
  });

  it('enters the loss as quality points, so every cap moves with it', () => {
    const s = lab(1);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const r = resolveRun(s, 1200, 400, [BIG], [], cfg, 'belief');
    expect(r.tokensPerParam).toBeCloseTo(400 / 1200, 6);
    expect(r.underPenalty).toBeCloseTo(undertrainPenalty(r.tokensPerParam), 9);
    const base = chinchillaLoss(r.effParamsB, r.effTokens, r.dataQuality);
    expect(r.loss - base).toBeCloseTo(r.underPenalty * LOSS_PER_QUALITY_POINT, 9);
    // Above the optimum the loss is exactly the Chinchilla loss.
    const ok = resolveRun(s, 10, 400, [BIG], [], cfg, 'belief');
    expect(ok.underPenalty).toBe(0);
    expect(ok.loss).toBeCloseTo(chinchillaLoss(ok.effParamsB, ok.effTokens, ok.dataQuality), 12);
  });

  it('counts repeated tokens at half value in the ratio', () => {
    const s = lab(2);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const unique = datasetById(s, 'scrawl_sample')!.tokensB;
    // Three epochs over the unique tokens: unique + 0.5 x repeats.
    const r = resolveRun(s, 1, 3 * unique, ['scrawl_sample'], [], cfg, 'belief');
    expect(r.effTokens).toBeCloseTo(effectiveTokens(3 * unique, unique), 9);
    expect(r.tokensPerParam).toBeCloseTo(r.effTokens / r.effParamsB, 9);
  });
});

describe('forecast reasons and the penalty', () => {
  it('says undertrained, with the expected cost, when the run is far below the optimum', () => {
    const s = lab(3);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const fc = forecastTraining(s, 1200, 400, [BIG], [], cfg);
    expect(fc.reasons[0]).toMatch(/^Undertrained: 0\.3\d tokens per parameter\. Compute-optimal is about 20\. Expect −\d+\.?\d*\.$/);
    expect(fc.undertrainPenalty ?? 0).toBeGreaterThan(10);
  });

  it('adds no undertraining line at or above the optimum', () => {
    const s = lab(4);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const fc = forecastTraining(s, 10, 400, [BIG], [], cfg);
    expect(fc.reasons.some((r) => r.startsWith('Undertrained') || r.startsWith('Slightly undertrained'))).toBe(false);
    expect(fc.undertrainPenalty ?? 0).toBe(0);
  });

  it('uses the milder line just below the optimum', () => {
    const s = lab(5);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    // 15 tokens per parameter: 3.5 x log2(20/15) is about 1.45 quality points, a visible but mild cost.
    const fc = forecastTraining(s, 10, 150, [BIG], [], cfg);
    expect(fc.reasons[0]).toMatch(/^Slightly undertrained: 15 tokens per parameter/);
  });

  it('reports repeated data beyond one epoch', () => {
    const s = lab(6);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const fc = forecastTraining(s, 1, 30, ['scrawl_sample'], [], cfg);
    expect(fc.reasons.some((r) => /^Data repeated \d+(\.\d)?×\. Repeats count half\.$/.test(r))).toBe(true);
  });

  it('a 1.2T model on 400B tokens is clearly worse than a 150B model on 3.2T tokens at the same FLOPs', () => {
    const s = lab(7);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const big = resolveRun(s, 1200, 400, [BIG], [], cfg, 'belief');
    const small = resolveRun(s, 150, 3200, [BIG], [], cfg, 'belief');
    expect(small.totalFlops / big.totalFlops).toBeGreaterThan(0.97);
    expect(small.totalFlops / big.totalFlops).toBeLessThan(1.03);
    const bigMid = forecastTraining(s, 1200, 400, [BIG], [], cfg).mid;
    const smallMid = forecastTraining(s, 150, 3200, [BIG], [], cfg).mid;
    expect(smallMid - bigMid).toBeGreaterThan(10);
  });
});

describe('fixed run overhead', () => {
  it('is 2 days plus 1.5 days per decade of parameters', () => {
    expect(runOverheadDays(1)).toBeCloseTo(2, 9);
    expect(runOverheadDays(0.05)).toBeCloseTo(2, 9);
    expect(runOverheadDays(1000)).toBeCloseTo(6.5, 9);
  });

  it('is part of the estimated days', () => {
    const s = lab(8);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const est = estimateTraining(s, 1, 20, DATA, [], cfg);
    const flopDays = est.totalFlops / trainingRatePerDay(s, cfg);
    expect(est.days).toBeCloseTo(flopDays + runOverheadDays(1), 6);
  });

  it('is spent before any FLOPs count, and the run finishes when its days say', () => {
    const s = lab(9);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const est = estimateTraining(s, 1, 20, DATA, [], cfg);
    dispatch(s, { type: 'startTraining', name: 'Overhead', paramsB: 1, tokensB: 20, datasetIds: DATA, techniques: [], config: cfg });
    const run = s.training!;
    expect(run).not.toBeNull();
    const overhead = runOverheadDays(1);
    expect(run.overheadLeft).toBeCloseTo(overhead, 6);
    // Full overhead days produce no progress; the first day after them does.
    let firstProgress = 0;
    let finished = 0;
    for (let d = 1; d <= 40 && !finished; d++) {
      const before = run.doneFlops;
      day(s);
      if (!firstProgress && run.doneFlops > before) firstProgress = d;
      if (!s.training) finished = d;
    }
    expect(firstProgress).toBe(Math.floor(overhead) + 1);
    expect(Math.abs(finished - est.days)).toBeLessThan(1.5);
  });
});

describe('bot sizing', () => {
  it('sizes to about 20 tokens per parameter when the data allows', () => {
    const s = lab(10);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const { paramsB, tokensB } = sizeBotRun(s, [BIG], [], cfg);
    expect(tokensB / paramsB).toBeCloseTo(20, 6);
  });

  it('never asks for more epochs than the data allows', () => {
    const s = lab(11);
    const cfg = { ...defaultConfig(s), arch: 'dense' as const };
    const unique = datasetById(s, 'scrawl_sample')!.tokensB;
    const { paramsB, tokensB } = sizeBotRun(s, ['scrawl_sample'], [], cfg);
    expect(tokensB).toBeLessThanOrEqual(unique * 4 + 1e-9);
    expect(paramsB).toBeGreaterThan(0);
  });
});
