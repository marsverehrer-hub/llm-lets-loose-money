// v16 realism: the memory wall (model size needs GPU memory and parallelism research), GPU allocation, the chat
// moment gate and the new labs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import { MEMORY_TUNING, SUPPLY_TUNING, gpuAllocationLeft, memoryWall, memoryWallError, shardDegree } from '../src/sim/systems/scaleLimits';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { COMPETITORS } from '../src/sim/data/competitors';
import { segmentShares } from '../src/sim/systems/market';

beforeAll(() => {
  MEMORY_TUNING.ENFORCE = true;
  SUPPLY_TUNING.ENFORCE = true;
});
afterAll(() => {
  MEMORY_TUNING.ENFORCE = false;
  SUPPLY_TUNING.ENFORCE = false;
});

const DAY_2021 = 4 * 365 + 1;

function lab2021(gpus: Record<string, number>, research: string[]): GameState {
  const s = createInitialState(3, 'Wall');
  s.day = DAY_2021;
  s.compute.rented = { ...gpus };
  s.research.completed.push('transformers', ...research);
  s.finance.cash = 1e12;
  s.data.owned = ['scrawl_sample', 'common_scrawl_full', 'open_web_chlorinated'];
  return s;
}

describe('memory wall', () => {
  it('the starter fleet holds a model of a few billion parameters at most', () => {
    const s = createInitialState(1, 'Start');
    const w = memoryWall(s);
    expect(w.maxParamsB).toBeGreaterThan(0.5);
    expect(w.maxParamsB).toBeLessThan(10);
  });

  it('a 3T model in 2021 is refused even with 20,000 A100s and tensor parallelism', () => {
    const s = lab2021({ a100: 20_000 }, ['mixed_precision', 'zero_sharding', 'tensor_parallel']);
    expect(memoryWallError(s, 3000)).toMatch(/Out of memory/);
    expect(memoryWallError(s, 175)).toBeNull(); // GPT-3 sized is fine
    dispatch(s, { type: 'startTraining', name: 'Huge', paramsB: 3000, tokensB: 1000, datasetIds: s.data.owned, techniques: [], config: defaultConfig(s) });
    expect(s.training).toBeNull();
  });

  it('pipeline parallelism lifts the wall, but only with enough GPUs to hold the model', () => {
    const big = lab2021({ a100: 20_000 }, ['mixed_precision', 'zero_sharding', 'tensor_parallel', 'pipeline_parallel']);
    expect(memoryWallError(big, 3000)).toBeNull();
    const few = lab2021({ a100: 64 }, ['mixed_precision', 'zero_sharding', 'tensor_parallel', 'pipeline_parallel']);
    expect(memoryWall(few).limitedBy).toBe('gpus');
    expect(memoryWallError(few, 3000)).toMatch(/training pool has 64/);
  });

  it('each parallelism node raises the shard degree', () => {
    const s = lab2021({ a100: 100_000 }, []);
    const degrees = [shardDegree(s)];
    for (const id of ['zero_sharding', 'tensor_parallel', 'pipeline_parallel', 'parallelism_3d']) {
      s.research.completed.push(id);
      degrees.push(shardDegree(s));
    }
    for (let i = 1; i < degrees.length; i++) expect(degrees[i]).toBeGreaterThan(degrees[i - 1]);
  });
});

describe('GPU allocation', () => {
  it('a new generation is rationed per quarter; the allocation refills next quarter', () => {
    const s = createInitialState(2, 'Alloc');
    s.day = 5 * 365 + 10; // 2022, the launch year of the H-1OO
    s.finance.cash = 1e12;
    s.compute.datacenters.push({ id: 'dc-big', name: 'Big', tierId: 'cathedral', gpus: {}, buildDaysLeft: 0 } as any);
    const left = gpuAllocationLeft(s, 'h100');
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(2000);
    dispatch(s, { type: 'buyGpus', datacenterId: 'dc-big', gpuId: 'h100', count: left + 1 });
    expect(s.compute.datacenters.find((d) => d.id === 'dc-big')!.gpus.h100 ?? 0).toBe(0);
    dispatch(s, { type: 'buyGpus', datacenterId: 'dc-big', gpuId: 'h100', count: left });
    expect(s.compute.datacenters.find((d) => d.id === 'dc-big')!.gpus.h100).toBe(left);
    expect(gpuAllocationLeft(s, 'h100')).toBe(0);
    s.day += SUPPLY_TUNING.QUARTER_DAYS;
    expect(gpuAllocationLeft(s, 'h100')).toBeGreaterThan(left); // next quarter, and a bit later in the generation
  });

  it('old generations ship in bulk', () => {
    const s = createInitialState(2, 'Alloc');
    s.day = 7 * 365;
    expect(gpuAllocationLeft(s, 'p100')).toBeGreaterThan(100_000);
  });
});

describe('v16 labs', () => {
  it('adds Chinese and smaller labs with unique ids and colours', () => {
    expect(COMPETITORS.length).toBeGreaterThanOrEqual(14);
    expect(COMPETITORS.filter((c) => c.region === 'cn').length).toBeGreaterThanOrEqual(4);
    expect(new Set(COMPETITORS.map((c) => c.id)).size).toBe(COMPETITORS.length);
    expect(new Set(COMPETITORS.map((c) => c.color.toLowerCase())).size).toBe(COMPETITORS.length);
  });

  it('enterprise buyers discount a lab with low enterprise appeal', () => {
    const s = createInitialState(4, 'Appeal');
    s.day = 8 * 365;
    const shares = () => segmentShares(s, 'enterprise').find((r) => r.id === 'bytedunce');
    for (const c of s.competitors) c.active = c.id === 'bytedunce' || c.id === 'openaye';
    const model = { name: 'X', scores: { reasoning: 80, coding: 80, chat: 80, safety: 80 }, overall: 80, elo: 1440, releasedDay: 0 } as any;
    for (const c of s.competitors) if (c.active) {
      c.model = { ...model };
      c.prices = { chat: 20, api: 10, enterprise: 40 };
      c.brand = 30;
    }
    const withAppeal = shares()?.share ?? 0;
    const def = COMPETITORS.find((d) => d.id === 'bytedunce')!;
    const saved = def.segmentAppeal;
    def.segmentAppeal = undefined;
    const without = shares()?.share ?? 0;
    def.segmentAppeal = saved;
    expect(withAppeal).toBeLessThan(without);
  });
});
