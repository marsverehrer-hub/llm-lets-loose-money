import { describe, expect, it } from 'vitest';
import { apply, check, handsOnRun } from '../src/sim/apply';
import { endWeek } from '../src/sim/endWeek';
import { defaultBlueprint } from '../src/sim/resolve';
import { weeklyCost } from '../src/sim/run';
import { newGame } from '../src/sim/state';
import { sharesOf } from '../src/sim/stock';
import { labPrice, layerCapacity, LEAD, ownedClouds, playerControls } from '../src/sim/supply';
import type { GameState } from '../src/sim/types';

const step = (s: GameState, n = 1): GameState => {
  for (let i = 0; i < n; i++) {
    while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
    const run = handsOnRun(s);
    if (run?.call) s = apply(s, { t: 'answerCall', run: run.id, option: 0 });
    else s = endWeek(s);
  }
  return s;
};

describe('supply chain', () => {
  it('the tightest layer is the bottleneck and new capacity arrives after its lead time', () => {
    let s = newGame(1);
    const caps = Object.fromEntries((['cloud', 'chips', 'fab', 'power'] as const).map((l) => [l, layerCapacity(s, l)]));
    expect(s.market.binding).toBe('cloud');
    s = step(s, LEAD.cloud - 1);
    expect(layerCapacity(s, 'fab')).toBe(caps.fab); // fabs take 48 weeks
    s = step(s, 4);
    expect(layerCapacity(s, 'cloud')).toBeGreaterThan(caps.cloud);
  });

  it('a run keeps the compute price it started at', () => {
    let s = newGame(2);
    s = apply(s, { t: 'startRun', bp: defaultBlueprint(s, s.labId, 'lang', 300), name: 'Locked' });
    const bill = weeklyCost(s, handsOnRun(s)!);
    s = step(s, 3);
    s.market.computePrice *= 5;
    s.companies.lab.lab!.cuPrice *= 5;
    expect(weeklyCost(s, handsOnRun(s)!)).toBe(bill);
  });

  it('a contract caps what the lab pays when the spot price spikes', () => {
    let s = newGame(3);
    s = apply(s, { t: 'startRun', bp: defaultBlueprint(s, s.labId, 'lang', 300), name: 'Hedged' });
    s = step(s, 2);
    expect(check(s, { t: 'contract', units: 60 })).toBeNull();
    s = apply(s, { t: 'contract', units: 60 });
    expect(check(s, { t: 'contract', units: 60 })).toMatch(/already/);
    s.market.scarcity = 8; // a crunch
    s = step(s, 2);
    expect(s.market.computePrice).toBeGreaterThan(1.5 * s.market.base);
    expect(labPrice(s, 'lab')).toBeLessThan(s.market.computePrice);
  });

  it('a lab that buys a cloud outright gets its capacity at cost and its profit', () => {
    let s = newGame(4);
    s.companies.lab.cash = 5e9;
    s = apply(s, { t: 'tender', target: 'weavr', premium: 0.7, as: 'lab' });
    while (s.deals.length) s = step(s);
    expect(sharesOf(s, 'lab', 'weavr')).toBe(s.companies.weavr.shares);
    expect(ownedClouds(s, 'lab').map((c) => c.id)).toEqual(['weavr']);
    expect(playerControls(s, 'weavr')).toBe(true);
    s = apply(s, { t: 'startRun', bp: defaultBlueprint(s, s.labId, 'lang', 300), name: 'Vertical' });
    s = step(s, 3);
    expect(labPrice(s, 'lab')).toBeLessThan(0.8 * s.market.computePrice);
  });

  it('refusing a rival raises its compute price, and only a controller can do it', () => {
    let s = newGame(5);
    expect(check(s, { t: 'lever', company: 'shelves', block: 'openaye' })).toMatch(/control/);
    s.holdings.push({ owner: 'you', company: 'shelves', shares: 0.6 * s.companies.shelves.shares });
    s = apply(s, { t: 'lever', company: 'shelves', block: 'openaye', posture: 1, capex: 2 });
    expect(s.companies.shelves.plant!.blocked).toEqual(['openaye']);
    s = step(s, 2);
    expect(labPrice(s, 'openaye')).toBeGreaterThan(labPrice(s, 'anthro'));
    expect(s.companies.shelves.plant!.capex).toBe(2); // the player's lever is not overridden by the AI
  });
});
