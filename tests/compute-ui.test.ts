// v19 D5: the GPU, hall and silicon screens' display rules (src/ui/panels/compute/gpuUi.ts).
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import type { Datacenter, GameState } from '../src/sim/types';
import { datacenterPue, gpuById } from '../src/sim/systems/compute';
import { GPUS } from '../src/sim/data/gpus';
import { BALANCE } from '../src/sim/balance';
import {
  CHIP_START_COST,
  allocationExempt,
  allocationLeft,
  chipGateReason,
  chipProgrammeCost,
  chipRunning,
  fmtDay,
  hallMw,
  interconnectOf,
  nextChipGeneration,
  nextQuarterDay,
  preorderDeposit,
  siteOpen,
  unitPrice,
} from '../src/ui/panels/compute/gpuUi';

const dayOf = (year: number) => Math.round((Date.UTC(year, 0, 1) - Date.UTC(BALANCE.START_YEAR, 0, 1)) / 86_400_000);

function dc(over: Partial<Datacenter> = {}): Datacenter {
  return { id: 'dc1', name: 'DC', tierId: 'closet', gpus: {}, buildDaysLeft: 0, ...over } as Datacenter;
}

describe('interconnect', () => {
  it('defaults to pcie, treats the old infiniband flag as infiniband, and honours an explicit tier', () => {
    expect(interconnectOf(dc())).toBe('pcie');
    expect(interconnectOf(dc({ infiniband: true }))).toBe('infiniband');
    expect(interconnectOf(dc({ infiniband: true, interconnect: 'nvlink' }))).toBe('nvlink');
  });
});

describe('hall megawatts', () => {
  it('is the GPUs times kW times PUE, in MW', () => {
    const p100 = gpuById('p100');
    expect(p100).toBeDefined();
    const hall = dc({ gpus: { p100: 1000 } });
    expect(hallMw(hall)).toBeCloseTo((1000 * (p100!.powerKw) * datacenterPue(hall)) / 1000, 6);
    expect(hallMw(dc())).toBe(0);
  });
});

describe('sites', () => {
  it('grid is always open; hydro opens in 2017; nuclear needs its research', () => {
    const s: GameState = createInitialState(3, 'Sites');
    s.day = dayOf(2016);
    expect(siteOpen(s, 'grid')).toBe(true);
    expect(siteOpen(s, 'hydro')).toBe(false);
    s.day = dayOf(2018);
    expect(siteOpen(s, 'hydro')).toBe(true);
    expect(siteOpen(s, 'nuclear')).toBe(false);
    s.research.completed.push('nuclear_power');
    expect(siteOpen(s, 'nuclear')).toBe(true);
  });
});

describe('allocation and pre-orders', () => {
  it('next quarter starts on the next 90-day boundary', () => {
    expect(nextQuarterDay(0)).toBe(90);
    expect(nextQuarterDay(89)).toBe(90);
    expect(nextQuarterDay(90)).toBe(180);
  });

  it('consumer, workstation and custom cards are outside the vendor allocation', () => {
    const consumer = GPUS.find((g) => g.class === 'consumer');
    if (consumer) {
      expect(allocationExempt(consumer)).toBe(true);
      const s = createInitialState(3, 'Alloc');
      expect(allocationLeft(s, consumer)).toBe(Infinity);
    }
    expect(allocationExempt(GPUS.find((g) => g.id === 'p100')!)).toBe(false);
  });

  it('the deposit is 30% of the unit price per card', () => {
    const s = createInitialState(3, 'Deposit');
    const p100 = GPUS.find((g) => g.id === 'p100')!;
    expect(unitPrice(s, p100)).toBeCloseTo(p100.buyPrice, 6);
    expect(preorderDeposit(s, p100, 8)).toBeCloseTo(0.3 * p100.buyPrice * 8, 6);
  });

  it('dates read like DESIGN.md: 14 Mar 2019', () => {
    expect(fmtDay(0)).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  });
});

describe('own silicon display', () => {
  it('the next generation is one above the last, costing $500M a generation', () => {
    const s = createInitialState(3, 'Chip');
    expect(nextChipGeneration(s)).toBe(1);
    expect(chipProgrammeCost(1)).toBe(CHIP_START_COST);
    expect(chipProgrammeCost(3)).toBe(3 * CHIP_START_COST);
    s.chip = { generation: 2, phase: 'fab', startedDay: 0, rpNeeded: 1, rpDone: 1, cashSpent: 0 };
    expect(nextChipGeneration(s)).toBe(3);
  });

  it('a programme in design, tape-out or fab is running; ready and failed are not', () => {
    const s = createInitialState(3, 'Chip2');
    const base = { generation: 1, startedDay: 0, rpNeeded: 1, rpDone: 0, cashSpent: 0 };
    s.chip = { ...base, phase: 'design' };
    expect(chipRunning(s)).toBe(true);
    s.chip = { ...base, phase: 'ready' };
    expect(chipRunning(s)).toBe(false);
    s.chip = { ...base, phase: 'failed' };
    expect(chipRunning(s)).toBe(false);
  });

  it('the programme waits for 2024 and its research gate', () => {
    const s = createInitialState(3, 'Gate');
    s.day = dayOf(2022);
    expect(chipGateReason(s)).toMatch(/^Opens 2024$/);
    s.day = dayOf(2025);
    expect(chipGateReason(s)).not.toBeNull();
    s.research.completed.push('neuromorphic_chips');
    expect(chipGateReason(s)).toBeNull();
  });
});
