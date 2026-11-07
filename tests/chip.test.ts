// v19 D4: own silicon. The programme (design, tape-out, fab, ready), its money gate, and the yield price.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import type { GameState, Rng } from '../src/sim/types';
import { CUSTOM_CHIPS } from '../src/sim/data/customChips';
import { GPUS } from '../src/sim/data/gpus';
import { CHIP_TUNING, chipReady, chipTick, customChipPrice, isCustom } from '../src/sim/systems/chipRnd';
import { researchPointsPerDay } from '../src/sim/systems/research';
import { startDayOf } from '../src/sim/systems/scenario';

/** A rigged roll: every chance() answers `pass`, every range() gives its low end. */
function rig(over: Partial<Rng> = {}): Rng {
  return {
    next: () => 0.5,
    range: (lo: number) => lo,
    int: (lo: number) => lo,
    chance: () => true,
    pick: (arr: readonly unknown[]) => arr[0],
    normal: () => 0,
    ...over,
  } as Rng;
}

function lab(year = 2026): GameState {
  const s = createInitialState(7, 'Silica');
  s.day = startDayOf(year) + 10;
  s.finance.cash = 1e13;
  s.research.completed.push(CHIP_TUNING.GATE_RESEARCH);
  return s;
}

describe('the silicon programme', () => {
  it('moves design to fab to ready, and the chip joins the GPU list', () => {
    const s = lab();
    dispatch(s, { type: 'startChipProgram' });
    expect(s.chip?.phase).toBe('design');
    expect(s.chip?.generation).toBe(1);
    expect(s.chip?.gpuId).toBeUndefined();

    // Design eats research: 20% of the daily research points, not the whole research system.
    const rate = researchPointsPerDay(s);
    const before = s.chip!.rpDone;
    chipTick(s, rig());
    expect(s.chip!.rpDone - before).toBeCloseTo(CHIP_TUNING.DESIGN_RP_SHARE * rate, 6);

    // Finish the design, then the tape-out passes and the fab slot is booked.
    s.chip!.rpNeeded = 0;
    chipTick(s, rig());
    expect(s.chip?.phase).toBe('fab');
    expect(s.chip?.fabReadyDay).toBe(s.day + CHIP_TUNING.FAB_DAYS);

    // The fab delivers after its days; the chip is ready and buyable.
    s.day = s.chip!.fabReadyDay!;
    chipTick(s, rig());
    expect(s.chip?.phase).toBe('ready');
    expect(s.chip?.gpuId).toBe(CUSTOM_CHIPS[0].id);
    expect(chipReady(s, CUSTOM_CHIPS[0].id)).toBe(true);
    expect(GPUS.find((g) => g.id === CUSTOM_CHIPS[0].id)?.class).toBe('custom');
    expect(isCustom(CUSTOM_CHIPS[0])).toBe(true);
  });

  it('a bad tape-out roll fails the programme, and it can be restarted for the same generation', () => {
    const s = lab();
    dispatch(s, { type: 'startChipProgram' });
    s.chip!.rpNeeded = 0;
    chipTick(s, rig({ chance: () => false }));
    expect(s.chip?.phase).toBe('failed');
    const cash = s.finance.cash;
    dispatch(s, { type: 'startChipProgram' });
    expect(s.chip?.phase).toBe('design');
    expect(s.chip?.generation).toBe(1);
    expect(s.finance.cash).toBeLessThan(cash);
  });

  it('needs the money: a lab without cash cannot start one', () => {
    const s = lab();
    s.finance.cash = 1_000;
    dispatch(s, { type: 'startChipProgram' });
    expect(s.chip ?? null).toBeNull();
    expect(s.finance.cash).toBe(1_000);
  });

  it('is refused before 2024 and without the research gate', () => {
    const early = lab(2023);
    dispatch(early, { type: 'startChipProgram' });
    expect(early.chip ?? null).toBeNull();

    const green = lab();
    green.research.completed = green.research.completed.filter((id) => id !== CHIP_TUNING.GATE_RESEARCH);
    dispatch(green, { type: 'startChipProgram' });
    expect(green.chip ?? null).toBeNull();
  });

  it('a second generation costs more, and the first chip stays ready while it is built', () => {
    const s = lab();
    dispatch(s, { type: 'startChipProgram' });
    s.chip!.rpNeeded = 0;
    chipTick(s, rig());
    s.day = s.chip!.fabReadyDay!;
    chipTick(s, rig());
    const cash = s.finance.cash;
    dispatch(s, { type: 'startChipProgram' });
    expect(s.chip?.generation).toBe(2);
    expect(s.chip?.cashSpent).toBe(CHIP_TUNING.COST_PER_GEN * 2);
    expect(cash - s.finance.cash).toBe(CHIP_TUNING.COST_PER_GEN * 2);
    expect(chipReady(s, CUSTOM_CHIPS[0].id)).toBe(true);
  });

  it('refuses a second programme while one is running', () => {
    const s = lab();
    dispatch(s, { type: 'startChipProgram' });
    const cash = s.finance.cash;
    dispatch(s, { type: 'startChipProgram' });
    expect(s.finance.cash).toBe(cash);
    expect(s.chip?.phase).toBe('design');
  });
});

describe('custom chip price', () => {
  it('rises as the yield falls', () => {
    const run = (yieldRoll: number) => {
      const s = lab();
      dispatch(s, { type: 'startChipProgram' });
      s.chip!.rpNeeded = 0;
      chipTick(s, rig({ range: () => yieldRoll }));
      s.day = s.chip!.fabReadyDay!;
      chipTick(s, rig());
      return customChipPrice(s, CUSTOM_CHIPS[0].id);
    };
    const low = run(CHIP_TUNING.YIELD_MIN);
    const high = run(CHIP_TUNING.YIELD_MAX);
    expect(low).toBeGreaterThan(high);
    expect(low).toBeCloseTo(CUSTOM_CHIPS[0].buyPrice / CHIP_TUNING.YIELD_MIN, 6);
  });

  it('custom chips keep the buyPrice = 300 x rent rule and sit outside the vendor years', () => {
    for (const g of CUSTOM_CHIPS) {
      expect(g.buyPrice).toBe(300 * g.rentPerDay);
      expect(g.unlockYear).toBe(9999);
      expect(g.class).toBe('custom');
      expect(g.buyPrice).toBeLessThan(GPUS.find((x) => x.id === 'b200')!.buyPrice);
    }
  });
});
