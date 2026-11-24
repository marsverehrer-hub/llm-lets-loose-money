import { describe, expect, it } from 'vitest';
import { apply } from '../src/sim/apply';
import { chipRef, chipView, DC_LEAD, dcId, effOf, startChip } from '../src/sim/chips';
import { endWeek } from '../src/sim/endWeek';
import { rand } from '../src/sim/rand';
import { newGame } from '../src/sim/state';
import { labPrice, ownedClouds, servePrice } from '../src/sim/supply';
import type { ChipBlueprint, GameState } from '../src/sim/types';

const bp = (over: Partial<ChipBlueprint> = {}): ChipBlueprint => ({ node: 0, die: 1, memory: 0, focus: 'infer', budget: 30e6, weeks: 8, ...over });
const control = (s: GameState, id: string): void => { s.holdings.push({ owner: 'you', company: id, shares: 0.6 * s.companies[id].shares }); };

/** End weeks, answering every chip call with its first option, until nothing is running. */
function finish(s: GameState, n = 30): GameState {
  for (let i = 0; i < n; i++) {
    while (s.moments.length && s.moments[0].kind !== 'chip') s = apply(s, { t: 'dismissMoment' });
    if (s.moments.some((m) => m.kind === 'chip')) return s;
    for (const d of s.deals) if (d.playerTenders === null) d.playerTenders = false;
    const c = Object.values(s.chips).find((x) => x.call);
    s = c ? apply(s, { t: 'answerChip', chip: c.id, option: 0 }) : endWeek(s);
  }
  return s;
}

describe('chip design', () => {
  it('the opening forecast band holds the truth about 80% of the time', () => {
    let inside = 0, n = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(seed);
      for (let i = 0; i < 20; i++) {
        const u = (k: string): number => rand(seed, i, 'chipcal', k);
        const c = startChip(s, 'nvidium', bp({ node: (u('n') < 0.5 ? 0 : 1), die: Math.floor(u('d') * 3) as 0 | 1 | 2, memory: (u('m') < 0.5 ? 0 : 1), budget: chipRef(0) * (0.5 + 2 * u('b')) }), 'x');
        const v = chipView(s, c);
        const truth = effOf(c.truth.perf, c.truth.yld);
        if (truth >= v.lo && truth <= v.hi) inside++;
        n++;
      }
    }
    expect(inside / n).toBeGreaterThan(0.72);
    expect(inside / n).toBeLessThan(0.9);
  });

  it('only a controller can design, and a serving chip cuts the lab’s serving costs', () => {
    let s = newGame(2);
    expect(apply(s, { t: 'startChip', company: 'nvidium', bp: bp(), name: 'Pebble' })).toBe(s);
    control(s, 'nvidium');
    s = apply(s, { t: 'startChip', company: 'nvidium', bp: bp(), name: 'Pebble' });
    expect(Object.keys(s.chips)).toHaveLength(1);
    const before = s.companies.nvidium.plant!.capacity;
    s = finish(s);
    const m = s.moments.find((x) => x.kind === 'chip');
    expect(m?.kind).toBe('chip');
    expect(s.companies.lab.lab!.hw.infer).toBeLessThan(1);
    expect(servePrice(s, 'lab')).toBeLessThan(labPrice(s, 'lab'));
    if (m?.kind === 'chip' && m.eff * m.incumbent > 1) expect(s.companies.nvidium.plant!.capacity).toBeGreaterThan(before);
  });

  it('when fabs are the bottleneck and you own none, tape-out slips', () => {
    const slips = (ownFab: boolean): number => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        let s = newGame(seed);
        control(s, 'nvidium');
        if (ownFab) control(s, 'semi');
        s = apply(s, { t: 'startChip', company: 'nvidium', bp: bp({ weeks: 12 }), name: 'Slow' });
        const id = Object.keys(s.chips)[0];
        for (let i = 0; i < 6; i++) {
          s.market.binding = 'fab';
          const c = s.chips[id];
          s = c.call ? apply(s, { t: 'answerChip', chip: id, option: 1 }) : endWeek(s);
          while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
        }
        total += s.log.filter((n) => n.text.includes('wafer slot back')).length;
      }
      return total;
    };
    expect(slips(false)).toBeGreaterThan(0);
    expect(slips(true)).toBe(0);
  });
});

describe('datacenters', () => {
  it('your own datacenter comes online after its lead time and supplies the lab at cost', () => {
    let s = newGame(3);
    s.companies.lab.cash = 5e9;
    s = apply(s, { t: 'datacenter', units: 100 });
    expect(s.companies[dcId('lab')].plant!.capacity).toBe(0);
    for (let i = 0; i < DC_LEAD + 1; i++) { for (const d of s.deals) if (d.playerTenders === null) d.playerTenders = false; s = endWeek(s); while (s.moments.length) s = apply(s, { t: 'dismissMoment' }); }
    expect(s.companies[dcId('lab')].plant!.capacity).toBeGreaterThan(90);
    expect(ownedClouds(s, 'lab').map((c) => c.id)).toContain(dcId('lab'));
  });
});
