// v19 D2: the tiny-studio path (peak GPUs ever, Garage Prodigy, Indie Darling, Consumer Grade) and the new GPU cards.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import type { Competitor, Datacenter, GameState, Model, Product, TrainingRun } from '../src/sim/types';
import { GPUS, allocationExempt } from '../src/sim/data/gpus';
import { ACHIEVEMENTS } from '../src/sim/data/achievements';
import { garageProdigy, gpusHeld, studioTick } from '../src/sim/systems/studio';

const ach = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

/** A rival lab whose current flagship scores `benchmarks`. */
function rival(s: GameState, benchmarks: Record<string, number>): void {
  const c = s.competitors[0] as Competitor;
  c.active = true;
  c.model = { name: 'Rival 1', benchmarks } as unknown as Competitor['model'];
}

/** A released model of ours with the given benchmark scores. */
function ourModel(s: GameState, benchmarks: Record<string, number>): Model {
  const m = { id: `g${s.idCounter++}`, name: 'Garage 1', releasedDay: s.day, deprecated: false, benchmarks } as unknown as Model;
  s.models.push(m);
  return m;
}

function dc(gpus: Record<string, number>): Datacenter {
  return { id: 'hall', tierId: 'closet', gpus, buildDaysLeft: 0 } as unknown as Datacenter;
}

describe('peak GPUs ever', () => {
  it('tracks the maximum GPUs held across owned, legacy rented and cloud', () => {
    const s = createInitialState(3, 'Garage Test');
    s.compute.rented = { p100: 10 };
    studioTick(s);
    expect(s.flags.peakGpusEver).toBe(10);
    s.compute.rented = { p100: 4 };
    studioTick(s);
    expect(s.flags.peakGpusEver).toBe(10); // it never goes down
    s.compute.datacenters.push(dc({ p100: 20 }));
    studioTick(s);
    expect(gpusHeld(s)).toBe(24);
    expect(s.flags.peakGpusEver).toBe(24);
  });
});

describe('Garage Prodigy', () => {
  it('is true for a small lab with a model at 85% of the best on every benchmark', () => {
    const s = createInitialState(3, 'Garage Test');
    rival(s, { bench_a: 100, bench_b: 100 });
    ourModel(s, { bench_a: 85, bench_b: 90 });
    s.compute.rented = { p100: 16 };
    studioTick(s);
    expect(garageProdigy(s)).toBe(true);
    expect(ach('garage_prodigy').check(s)).toBe(true);
  });

  it('is false at 17 GPUs', () => {
    const s = createInitialState(3, 'Garage Test');
    rival(s, { bench_a: 100 });
    ourModel(s, { bench_a: 85 });
    s.compute.rented = { p100: 17 };
    studioTick(s);
    expect(garageProdigy(s)).toBe(false);
  });

  it('is false when one benchmark falls below 80% of the best', () => {
    const s = createInitialState(3, 'Garage Test');
    rival(s, { bench_a: 100, bench_b: 100 });
    ourModel(s, { bench_a: 95, bench_b: 79 });
    s.compute.rented = { p100: 4 };
    studioTick(s);
    expect(garageProdigy(s)).toBe(false);
  });
});

describe('Indie Darling', () => {
  it('needs 10K users on a product and no more than 32 GPUs ever', () => {
    const s = createInitialState(3, 'Garage Test');
    s.products.push({ id: 'p1', active: true, users: 10_000 } as unknown as Product);
    s.compute.rented = { p100: 32 };
    studioTick(s);
    expect(ach('indie_darling').check(s)).toBe(true);
    s.compute.rented = { p100: 33 };
    studioTick(s);
    expect(ach('indie_darling').check(s)).toBe(false);
  });
});

describe('Consumer Grade', () => {
  function runOn(gpus: Record<string, number>): GameState {
    const s = createInitialState(3, 'Garage Test');
    s.compute.rented = {}; // the starter fleet is a datacenter card (p100), not a consumer one
    studioTick(s); // initialise the model counter
    s.compute.datacenters.push(dc(gpus));
    s.training = {} as unknown as TrainingRun;
    studioTick(s);
    s.models.push({ id: 'c1' } as unknown as Model);
    studioTick(s);
    return s;
  }

  it('unlocks when the last run was on consumer cards only', () => {
    expect(ach('consumer_grade').check(runOn({ rtx40: 8 }))).toBe(true);
  });

  it('does not unlock when a datacenter card joined the run', () => {
    expect(ach('consumer_grade').check(runOn({ rtx40: 8, h100: 2 }))).toBe(false);
  });
});

describe('new GPU cards', () => {
  it('consumer and workstation cards are exempt from the vendor allocation', () => {
    expect(allocationExempt(GPUS.find((g) => g.id === 'rtx40')!)).toBe(true);
    expect(allocationExempt(GPUS.find((g) => g.id === 'rtx6000')!)).toBe(true);
    expect(allocationExempt(GPUS.find((g) => g.id === 'h100')!)).toBe(false);
  });

  it('keeps the existing order and p100 first', () => {
    expect(GPUS[0].id).toBe('p100');
    expect(GPUS.filter((g) => g.class === 'consumer').length).toBeGreaterThanOrEqual(3);
  });
});
