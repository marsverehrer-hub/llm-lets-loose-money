// v19 B5: the Field screen's row building and tabs (pure helpers; the panel itself is plain rendering).
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { rivalLab, rivalLabs } from '../src/sim/systems/rivals';
import { buildRows, inTab } from '../src/ui/panels/FieldPanel';
import type { RivalModel } from '../src/sim/types';

function model(id: string, overall: number, open = false): RivalModel {
  return {
    id, name: `M-${id}`, paramsB: 7, tokensB: 100, dataQuality: 0.5, arch: 'dense', caps: {} as any,
    overall, elo: 1200, trainedDay: 0, releasedDay: 0, open, license: open ? 'permissive' : null,
  };
}

describe('Field screen rows', () => {
  it('lists every lab, sorted by best overall, with tabs that split active from gone', () => {
    const s = createInitialState(42);
    const labs = rivalLabs(s);
    const [a, b, c] = labs;
    a.status = 'active';
    a.models = [model('a1', 40)];
    b.status = 'active';
    b.models = [model('b1', 70, true), model('b2', 55)];
    c.status = 'bankrupt';
    const rows = buildRows(s);
    expect(rows.length).toBe(labs.length);
    expect(rows[0].lab.id).toBe(b.id);
    expect(rows[0].best?.name).toBe('M-b1');
    expect(rows[0].openCount).toBe(1);
    const active = rows.filter((r) => inTab(r, 'active')).map((r) => r.lab.id);
    expect(active.sort()).toEqual([a.id, b.id].sort());
    expect(rows.filter((r) => inTab(r, 'gone')).map((r) => r.lab.id)).toEqual([c.id]);
    // All leaves out labs that have not been founded yet.
    expect(rows.filter((r) => inTab(r, 'all')).every((r) => r.lab.status !== 'unfounded')).toBe(true);
  });

  it('sums GPUs and PFLOPS across rented and owned lines', () => {
    const s = createInitialState(7);
    const lab = rivalLab(s, rivalLabs(s)[0].id)!;
    lab.gpusRented = { a100: 4 };
    lab.gpusOwned = { a100: 2 };
    const row = buildRows(s).find((r) => r.lab.id === lab.id)!;
    expect(row.gpus.reduce((n, g) => n + g.count, 0)).toBe(6);
    expect(row.pflops).toBeCloseTo(6 * 0.09, 5);
  });
});
