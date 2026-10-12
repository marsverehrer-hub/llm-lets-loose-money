// Server room model: cell sizing and job colouring. Must hold on an empty fleet (every count zero).
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../../sim/state';
import type { GameState } from '../../../sim/types';
import { MAX_ROOM_CELLS, buildRoom, fillCells, gpusPerCell, gridShape, largestRemainder, summaryParts } from './roomModel';

describe('gpusPerCell', () => {
  it('keeps the biggest block within the cell budget', () => {
    expect(gpusPerCell(0)).toBe(1);
    expect(gpusPerCell(MAX_ROOM_CELLS)).toBe(1);
    expect(gpusPerCell(MAX_ROOM_CELLS + 1)).toBe(2);
    for (const cap of [64, 512, 8192, 131072]) {
      const n = gpusPerCell(cap);
      expect(Math.ceil(cap / n)).toBeLessThanOrEqual(MAX_ROOM_CELLS);
    }
  });
});

describe('largestRemainder', () => {
  it('splits exactly and handles zero weights', () => {
    expect(largestRemainder(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(largestRemainder(7, [0, 3, 1])).toEqual([0, 5, 2]);
    expect(largestRemainder(5, [0, 0])).toEqual([0, 0]);
    expect(largestRemainder(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('fillCells', () => {
  it('colours cells by the job at their middle GPU and leaves the rest empty', () => {
    const cells = fillCells(10, 1, [
      { job: 'training', shade: 0, count: 4 },
      { job: 'serving', shade: 1, count: 2 },
    ]);
    expect(cells.map((c) => c.job)).toEqual(['training', 'training', 'training', 'training', 'serving', 'serving', 'empty', 'empty', 'empty', 'empty']);
  });
  it('makes no cells for no capacity', () => {
    expect(fillCells(0, 1, [])).toEqual([]);
    expect(gridShape(0)).toEqual({ cols: 0, rows: 0 });
  });
});

describe('buildRoom', () => {
  it('draws the cloud blocks on an empty fleet without crashing', () => {
    const s: GameState = createInitialState();
    s.compute.rented = {};
    const room = buildRoom(s);
    expect(room.blocks.map((b) => b.kind)).toEqual(['rental', 'burst']);
    expect(room.blocks.every((b) => b.cells.length === 0)).toBe(true);
    expect(room.burstCostPerDay).toBe(0);
    expect(summaryParts(s, room)).toEqual(['0 GPUs', 'no cloud burst']);
  });

  it('splits a datacenter and rentals into cells with their GPU counts', () => {
    const s: GameState = createInitialState();
    s.compute.datacenters.push({ id: 'dc_test', name: 'Test closet', tierId: 'closet', gpus: { a100: 40 }, buildDaysLeft: 0 });
    s.compute.rented = { h100: 10 };
    const room = buildRoom(s);
    const dc = room.blocks.find((b) => b.key === 'dc_test');
    expect(dc).toBeDefined();
    expect(dc!.installed).toBe(40);
    expect(dc!.capacity).toBe(64);
    expect(dc!.cells.length).toBe(64);
    expect(dc!.cells.filter((c) => c.job === 'empty').length).toBe(24);
    const rental = room.blocks.find((b) => b.key === 'rental');
    expect(rental!.installed).toBe(10);
    expect(room.ownGpus).toBe(50);
    expect(room.gpusPerCell).toBe(1);
  });

  it('shows a building datacenter with no GPUs as empty cells', () => {
    const s: GameState = createInitialState();
    s.compute.datacenters.push({ id: 'dc_b', name: 'Building', tierId: 'colo', gpus: {}, buildDaysLeft: 5 });
    const room = buildRoom(s);
    const b = room.blocks.find((x) => x.key === 'dc_b');
    expect(b!.building).toBe(true);
    expect(b!.installed).toBe(0);
    expect(b!.cells.every((c) => c.job === 'empty')).toBe(true);
  });
});
