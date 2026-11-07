// Buying a rival lab (the player's acquireLab action) and the Acquired ending's availability window.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { COMPETITORS } from '../src/sim/data/competitors';
import { ENDINGS } from '../src/sim/systems/endings';
import { rivalLabs } from '../src/sim/systems/rivals';
import { acquireBlock, labPrice } from '../src/sim/systems/rivals/lifecycle';
import { OFFICE_TIERS } from '../src/sim/data/roles';
import type { GameState } from '../src/sim/types';

const DEF = (id: string) => ENDINGS.find((e) => e.id === id)!;

/** A game with one active, non-marquee rival lab worth $1B, and the player holding $5B. */
function withLab(): { s: GameState; id: string } {
  const s = createInitialState(41, 'Buy Labs');
  rivalLabs(s);
  const def = COMPETITORS.find((d) => !d.core)!;
  const c = s.competitors.find((x) => x.id === def.id)!;
  const lab = rivalLabs(s).find((l) => l.id === def.id)!;
  c.active = true;
  c.valuation = 1e9;
  lab.status = 'active';
  lab.cash = 200e6;
  lab.staff = { research: 4, engineering: 3, safety: 0, sales: 1 };
  s.finance.cash = 5e9;
  s.company.officeTierId = OFFICE_TIERS[OFFICE_TIERS.length - 1].id; // room for the new hires
  return { s, id: def.id };
}

describe('buying a rival lab', () => {
  it('takes the lab off the field, charges its price and adds its staff to the player', () => {
    const { s, id } = withLab();
    const price = labPrice(s, id)!;
    expect(price).toBe(1.3e9);
    const cash = s.finance.cash;
    const researchers = s.staff.roles.researcher.count;
    const engineers = s.staff.roles.engineer.count;

    dispatch(s, { type: 'acquireLab', labId: id });

    const lab = rivalLabs(s).find((l) => l.id === id)!;
    const c = s.competitors.find((x) => x.id === id)!;
    expect(lab.status).toBe('acquired');
    expect(lab.acquiredBy).toBe('player');
    expect(c.active).toBe(false);
    expect(c.model).toBeNull();
    expect(s.finance.cash).toBe(cash - price);
    expect(s.staff.roles.researcher.count).toBe(researchers + 4);
    expect(s.staff.roles.engineer.count).toBe(engineers + 3);
    expect(s.news.some((n) => n.text.includes('You buy'))).toBe(true);
  });

  it('is refused for marquee labs and when the player cannot pay', () => {
    const { s, id } = withLab();
    const marquee = COMPETITORS.find((d) => d.core)!;
    expect(acquireBlock(s, marquee.id)).toMatch(/Marquee/);
    s.competitors.find((x) => x.id === marquee.id)!.active = true;
    rivalLabs(s).find((l) => l.id === marquee.id)!.status = 'active';
    expect(acquireBlock(s, marquee.id)).toMatch(/Marquee/);

    s.finance.cash = 1e9;
    expect(acquireBlock(s, id)).toMatch(/Needs/);
    dispatch(s, { type: 'acquireLab', labId: id });
    expect(rivalLabs(s).find((l) => l.id === id)!.status).toBe('active');
    expect(s.finance.cash).toBe(1e9);
  });

  it('is cheaper for a lab already short of cash', () => {
    const { s, id } = withLab();
    rivalLabs(s).find((l) => l.id === id)!.cash = -1e6;
    expect(labPrice(s, id)).toBe(0.65e9);
  });
});

describe('The Acquired ending', () => {
  it('needs a private company worth between $1B and $200B', () => {
    const s = createInitialState(42, 'Buy Labs');
    s.company.isPublic = false;
    s.finance.valuation = 5e9;
    expect(DEF('acquired').available(s)).toEqual({ ok: true, why: '' });

    s.finance.valuation = 0.5e9;
    expect(DEF('acquired').available(s).ok).toBe(false);
    expect(DEF('acquired').available(s).why).toMatch(/\$1B/);

    s.finance.valuation = 250e9;
    expect(DEF('acquired').available(s).ok).toBe(false);

    s.finance.valuation = 5e9;
    s.company.isPublic = true;
    expect(DEF('acquired').available(s).ok).toBe(false);
  });
});
