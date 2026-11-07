// Stars and rival labs: hiring a star a rival employs, and the counter-offer when a star is poached.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { COMPETITORS } from '../src/sim/data/competitors';
import { OFFICE_TIERS, ROLES } from '../src/sim/data/roles';
import { makeRng } from '../src/sim/rng';
import { rivalLabs } from '../src/sim/systems/rivals';
import { starFee, staffTick } from '../src/sim/systems/staff';
import { labName } from '../src/sim/systems/labs';
import type { GameState, Star } from '../src/sim/types';

/** A game with one active, non-marquee rival lab and room in the office for a new hire. */
function withLab(seed: number): { s: GameState; id: string } {
  const s = createInitialState(seed, 'Talent');
  s.staff.nextStarDay = 1e9; // no new candidates during the test
  s.staff.morale = 80;
  const def = COMPETITORS.find((d) => !d.core)!;
  const c = s.competitors.find((x) => x.id === def.id)!;
  const lab = rivalLabs(s).find((l) => l.id === def.id)!;
  c.active = true;
  lab.status = 'active';
  lab.staff = { research: 4, engineering: 3, safety: 0, sales: 1 };
  s.company.officeTierId = OFFICE_TIERS[OFFICE_TIERS.length - 1].id;
  s.finance.cash = 1e9;
  return { s, id: def.id };
}

function star(over: Partial<Star>): Star {
  return { id: 'starT', name: 'Ada Test', role: 'researcher', title: 'Distinguished Tester', salary: 1_000_000, bonuses: {}, loyalty: 10, hiredDay: 0, ...over };
}

describe('hiring a star a rival lab employs', () => {
  it('charges the signing premium and sets the lab back a researcher', () => {
    const { s, id } = withLab(51);
    const lab = rivalLabs(s).find((l) => l.id === id)!;
    s.staff.stars.push(star({ id: 'starC', hiredDay: null, employer: id, loyalty: 50 }));
    const candidate = s.staff.stars[0];
    const free = starFee(s, { ...candidate, employer: undefined });
    const fee = starFee(s, candidate);
    expect(fee).toBe(2 * free);

    const cash = s.finance.cash;
    dispatch(s, { type: 'hireStar', starId: 'starC' });

    expect(s.finance.cash).toBe(cash - fee);
    expect(lab.staff.research).toBe(3);
    expect(s.staff.stars[0].hiredDay).not.toBeNull();
    expect(s.news.some((n) => n.text.includes(`from ${labName(s, id)}`))).toBe(true);
  });
});

describe('a poached star', () => {
  it('raises a counter-offer naming the poaching lab instead of losing the star at once', () => {
    const { s, id } = withLab(52);
    s.staff.stars.push(star({ id: 'starP', loyalty: 10 }));
    // Every roll succeeds: the star is poached, and the lab that makes the offer is the only active one.
    staffTick(s, { ...makeRng(s), chance: () => true });

    expect(s.events.pending?.defId).toBe('star_counter_offer');
    expect(s.events.pending?.starId).toBe('starP');
    expect(s.events.pending?.labId).toBe(id);
    expect(s.staff.stars.some((x) => x.id === 'starP')).toBe(true);
  });

  it('keeps the star when the player matches the offer, at a higher salary and for a cash cost', () => {
    const { s } = withLab(53);
    s.staff.stars.push(star({ id: 'starM', loyalty: 10, salary: 1_000_000 }));
    staffTick(s, { ...makeRng(s), chance: () => true });
    const cash = s.finance.cash;

    dispatch(s, { type: 'resolveEvent', choice: 0 });

    const kept = s.staff.stars.find((x) => x.id === 'starM')!;
    expect(kept.salary).toBe(1_200_000);
    expect(kept.loyalty).toBeGreaterThan(30);
    expect(s.finance.cash).toBe(cash - 500_000);
    expect(s.events.pending?.result).toMatch(/stays/);
  });

  it('leaves when the player lets them go', () => {
    const { s } = withLab(54);
    s.staff.stars.push(star({ id: 'starG', loyalty: 10 }));
    staffTick(s, { ...makeRng(s), chance: () => true });

    dispatch(s, { type: 'resolveEvent', choice: 1 });

    expect(s.staff.stars.some((x) => x.id === 'starG')).toBe(false);
    expect(s.news.some((n) => n.text.includes('has left'))).toBe(true);
  });
});
