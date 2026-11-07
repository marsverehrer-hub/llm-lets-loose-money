// v19: own silicon. A late-game programme: design (research points and cash), tape-out (a risk roll), a fab slot,
// yield, then your chips are a GPU you can buy without the vendor's allocation. Package D4.
import type { ActionHandlers, GameState, GpuDef, Rng } from '../types';
import { CUSTOM_CHIPS } from '../data/customChips';
import { isResearched, researchPointsPerDay } from './research';
import { calendarYear, notify, pushNews, trySpend } from '../util';

export const CHIP_TUNING = {
  START_YEAR: 2024,
  /** shortcut: no 'custom_silicon' node exists, so the programme waits for the closest one; upgrade with a real node in data/research.ts. */
  GATE_RESEARCH: 'neuromorphic_chips',
  /** $ per generation (generation 1 costs one unit, generation 2 two, and so on). */
  COST_PER_GEN: 500_000_000,
  RP_PER_GEN: 40_000,
  DESIGN_RP_SHARE: 0.2,
  TAPEOUT_ODDS: 0.7,
  FAB_DAYS: 180,
  YIELD_MIN: 0.5,
  YIELD_MAX: 0.9,
};

/** Custom silicon is never on the vendor's allocation (systems/scaleLimits.ts uses this; D1 wires it). */
export function isCustom(g: GpuDef): boolean {
  return g.class === 'custom';
}

/** True once a generation's chip has come out of the fab. Kept in flags too, so it survives the next programme. */
export function chipReady(s: GameState, gpuId: string): boolean {
  return s.flags[`chip.ready.${gpuId}`] === 1 || (s.chip?.phase === 'ready' && s.chip.gpuId === gpuId);
}

/** Unit price of a custom chip after yield: buyPrice / yieldRate. Without a known yield it is the unit cost. */
export function customChipPrice(s: GameState, gpuId: string): number {
  const g = CUSTOM_CHIPS.find((c) => c.id === gpuId);
  if (!g) return 0;
  const y = s.flags[`chip.yield.${gpuId}`] ?? 1;
  return g.buyPrice / y;
}

/** The generation the next programme builds. A failed tape-out is retried; a ready one moves on. */
function nextGeneration(s: GameState): number {
  const c = s.chip;
  if (!c) return 1;
  return c.phase === 'ready' ? c.generation + 1 : c.generation;
}

export const handlers: ActionHandlers = {
  startChipProgram: (s) => {
    const c = s.chip;
    if (c && c.phase !== 'ready' && c.phase !== 'failed') {
      notify(s, 'The silicon programme is already running.', 'bad');
      return;
    }
    if (calendarYear(s.day) < CHIP_TUNING.START_YEAR) {
      notify(s, 'Nobody will fund a chip team before 2024.', 'bad');
      return;
    }
    if (!isResearched(s, CHIP_TUNING.GATE_RESEARCH)) {
      notify(s, 'Research the chip programme prerequisites first.', 'bad');
      return;
    }
    const gen = nextGeneration(s);
    const gpu = CUSTOM_CHIPS[gen - 1];
    if (!gpu) {
      notify(s, 'Your silicon roadmap ends here. The next chip is a cabinet, not a generation.', 'bad');
      return;
    }
    const cost = CHIP_TUNING.COST_PER_GEN * gen;
    if (!trySpend(s, 'silicon', cost, 'the silicon programme')) return;
    s.chip = {
      generation: gen,
      phase: 'design',
      startedDay: s.day,
      rpNeeded: CHIP_TUNING.RP_PER_GEN * gen,
      rpDone: 0,
      cashSpent: cost,
    };
    pushNews(s, `Silicon programme ${gen} starts: ${gpu.name}. The GPU team has a whiteboard and a budget.`, 'good');
    notify(s, `Silicon programme ${gen} started.`, 'good');
  },
};

/** Advances the programme one day: design, tape-out roll, fab, then ready. */
export function chipTick(s: GameState, rng: Rng): void {
  const c = s.chip;
  if (!c) return;
  const gpu = CUSTOM_CHIPS[c.generation - 1];
  if (c.phase === 'design') {
    c.rpDone += CHIP_TUNING.DESIGN_RP_SHARE * researchPointsPerDay(s);
    if (c.rpDone < c.rpNeeded) return;
    if (!rng.chance(CHIP_TUNING.TAPEOUT_ODDS)) {
      c.phase = 'failed';
      pushNews(s, `Tape-out failed for generation ${c.generation}. The mask set is a very expensive paperweight. You can try again.`, 'bad');
      notify(s, 'Tape-out failed. The programme can be restarted.', 'bad');
      return;
    }
    c.yieldRate = rng.range(CHIP_TUNING.YIELD_MIN, CHIP_TUNING.YIELD_MAX);
    c.phase = 'fab';
    c.fabReadyDay = s.day + CHIP_TUNING.FAB_DAYS;
    pushNews(s, `Tape-out passed for generation ${c.generation}. Fab slot booked; first wafers in about ${CHIP_TUNING.FAB_DAYS} days.`, 'good');
    return;
  }
  if (c.phase === 'fab' && s.day >= (c.fabReadyDay ?? Infinity)) {
    c.phase = 'ready';
    c.gpuId = gpu?.id;
    if (gpu && c.gpuId) {
      s.flags[`chip.ready.${gpu.id}`] = 1;
      s.flags[`chip.yield.${gpu.id}`] = c.yieldRate ?? 1;
      pushNews(s, `${gpu.name} is out of the fab at ${Math.round((c.yieldRate ?? 1) * 100)}% yield. Vendors are nervous.`, 'milestone');
      notify(s, `${gpu.name} is ready to buy.`, 'milestone');
    }
  }
}
