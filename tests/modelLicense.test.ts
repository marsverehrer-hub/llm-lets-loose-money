// Licensing a released model to a rival lab: the royalty, the 365-day term and the refusals.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { COMPETITORS } from '../src/sim/data/competitors';
import { rivalLabs, RIVAL_TUNING } from '../src/sim/systems/rivals';
import { licenseBlock, licenseBoost, licensingDay, royaltyPerYear } from '../src/sim/systems/rivals/licensing';
import type { GameState, Model } from '../src/sim/types';

/** A game with one active rival lab worth $1B (no models yet), and one released model of the player's at overall 60. */
function setup(seed: number): { s: GameState; id: string } {
  const s = createInitialState(seed, 'License');
  const def = COMPETITORS.find((d) => !d.core)!;
  const c = s.competitors.find((x) => x.id === def.id)!;
  const lab = rivalLabs(s).find((l) => l.id === def.id)!;
  c.active = true;
  c.valuation = 1e9;
  lab.status = 'active';
  lab.models = [];
  s.models.push(playerModel('mine', 60));
  return { s, id: def.id };
}

function playerModel(id: string, overall: number, extra: Partial<Model> = {}): Model {
  return { id, name: `Model ${id}`, overall, releasedDay: 0, deprecated: false, ...extra } as Model;
}

describe('licensing a model to a rival lab', () => {
  it('pays a royalty every day for 365 days, then ends', () => {
    const { s, id } = setup(61);
    dispatch(s, { type: 'licenseModel', modelId: 'mine', labId: id });
    expect(s.modelLicenses).toHaveLength(1);
    const deal = s.modelLicenses![0];
    expect(deal.endDay - deal.startDay).toBe(365);
    expect(deal.royaltyPerDay * 365).toBeCloseTo(royaltyPerYear(s, id));

    const revenueBefore = s.finance.today.revenue.other ?? 0;
    for (let d = deal.startDay; d < deal.endDay; d++) {
      s.day = d;
      licensingDay(s);
    }
    expect((s.finance.today.revenue.other ?? 0) - revenueBefore).toBeCloseTo(royaltyPerYear(s, id));
    expect(s.modelLicenses).toHaveLength(1);

    s.day = deal.endDay;
    licensingDay(s);
    expect(s.modelLicenses).toHaveLength(0);
  });

  it('refuses a research-only model, a deprecated one and one the lab already matches', () => {
    const { s, id } = setup(62);
    s.models.push(playerModel('research', 70, { origin: { labId: 'x', modelId: 'y', license: 'research' } }));
    s.models.push(playerModel('old', 70, { deprecated: true }));
    expect(licenseBlock(s, 'research', id)).toMatch(/research weights/);
    expect(licenseBlock(s, 'old', id)).toMatch(/released model/);

    rivalLabs(s).find((l) => l.id === id)!.models.push({ overall: 65 } as any);
    expect(licenseBlock(s, 'mine', id)).toMatch(/as good as/);

    dispatch(s, { type: 'licenseModel', modelId: 'research', labId: id });
    expect(s.modelLicenses ?? []).toHaveLength(0);
  });

  it('allows one deal per lab, and the lab gets a quality boost while the deal runs', () => {
    const { s, id } = setup(63);
    s.models.push(playerModel('second', 62));
    dispatch(s, { type: 'licenseModel', modelId: 'mine', labId: id });
    dispatch(s, { type: 'licenseModel', modelId: 'second', labId: id });
    expect(s.modelLicenses).toHaveLength(1);
    expect(s.modelLicenses![0].modelId).toBe('mine');
    expect(licenseBoost(s, id)).toBe(RIVAL_TUNING.LICENSE_QUALITY_BOOST);

    s.day = s.modelLicenses![0].endDay;
    expect(licenseBoost(s, id)).toBe(0);
  });
});
