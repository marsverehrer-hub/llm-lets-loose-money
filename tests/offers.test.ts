import { describe, expect, it } from 'vitest';
import { apply, handsOnRun } from '../src/sim/apply';
import { endWeek } from '../src/sim/endWeek';
import { fitOf, shareOf } from '../src/sim/demand';
import { agreementsTick, appsTick, offersTick } from '../src/sim/offers';
import { dataUnique, defaultBlueprint } from '../src/sim/resolve';
import { newGame } from '../src/sim/state';
import { SEGMENTS } from '../src/sim/content/modalities';
import type { GameState } from '../src/sim/types';

/** A new game where the player has shipped one language model. */
function shipped(seed = 1): GameState {
  let s = newGame(seed);
  s = apply(s, { t: 'startRun', bp: defaultBlueprint(s, s.labId, 'lang', 300), name: 'Base' });
  for (let i = 0; i < 40 && !Object.values(s.models).some((m) => m.lab === s.labId); i++) {
    while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
    const run = handsOnRun(s);
    // Take the first option that does not push the schedule back, so the helper finishes quickly.
    const quick = run?.call ? Math.max(0, run.call.options.findIndex((o) => !o.fx.some((f) => f.k === 'weeks' && f.n > 0))) : 0;
    s = run?.call ? apply(s, { t: 'answerCall', run: run.id, option: quick }) : endWeek(s);
  }
  while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
  s.offers = [];
  return s;
}
const mine = (s: GameState) => Object.values(s.models).find((m) => m.lab === s.labId)!;

describe('offers', () => {
  it('arrive, never exceed two, and expire after two weeks', () => {
    let s = shipped();
    let seen = 0;
    for (let i = 0; i < 30; i++) {
      s = endWeek(s);
      while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
      const run = handsOnRun(s);
      if (run?.call) s = apply(s, { t: 'answerCall', run: run.id, option: 0 });
      expect(s.offers.length).toBeLessThanOrEqual(2);
      for (const o of s.offers) expect(o.expires - s.week).toBeGreaterThan(0);
      seen += s.offers.length;
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('every option of every offer either does something or is a plain decline', () => {
    const s = shipped(2);
    for (let w = 0; w < 40; w++) {
      s.week++;
      s.offers = [];
      offersTick(s);
      for (const o of s.offers) {
        expect(o.call.options.length).toBeGreaterThanOrEqual(2);
        expect(o.call.options.filter((x) => x.fx.length === 0).length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('agreements', () => {
  it('an enterprise contract pays once the target is met, and penalises a miss', () => {
    const s = shipped(3);
    const m = mine(s);
    const seg = 'lang.consumer';
    const now = fitOf(SEGMENTS[seg], m.cap);
    s.agreements = [
      { id: 'a1', kind: 'supply', lab: s.labId, other: null, until: 0, pay: 1e6, seg, target: now - 1, due: s.week + 5, met: false, account: 'Easy' },
      { id: 'a2', kind: 'supply', lab: s.labId, other: null, until: 0, pay: 1e6, seg, target: now + 50, due: s.week - 1, met: false, account: 'Hard' },
    ];
    const cash = s.companies.lab.cash;
    const flow = {};
    agreementsTick(s, flow);
    expect(s.agreements.map((a) => a.id)).toEqual(['a1']);
    expect(s.agreements[0].met).toBe(true);
    expect((flow as Record<string, { rev: number }>).lab.rev).toBe(1e6);
    expect(s.companies.lab.cash).toBe(cash - 4e6);
  });

  it('exclusive data locks rivals out of most of it', () => {
    const s = newGame(4);
    const before = dataUnique(s, 'openaye', 'lang', 'books');
    s.agreements.push({ id: 'x', kind: 'data', lab: s.labId, other: null, until: s.week + 48, pay: 0, data: 'books' });
    expect(dataUnique(s, 'openaye', 'lang', 'books')).toBeCloseTo(before * 0.4);
    expect(dataUnique(s, s.labId, 'lang', 'books')).toBeGreaterThan(0.9 * before);
  });
});

describe('apps', () => {
  it('an exclusive app partner hands its users to the lab', () => {
    const s = shipped(5);
    const before = shareOf(s, 'lang.consumer')[s.labId] ?? 0;
    Object.assign(s.companies.searchly.app!, { partner: s.labId, exclusive: true, cut: 0.15, until: s.week + 48 });
    expect(shareOf(s, 'lang.consumer')[s.labId]).toBeGreaterThan(before + 0.1);
  });

  it('a player who controls an app points it at their own lab', () => {
    const s = shipped(6);
    s.holdings.push({ owner: 'you', company: 'canvass', shares: 0.6 * s.companies.canvass.shares });
    appsTick(s);
    expect(s.companies.canvass.app!.partner).toBe(s.labId);
    expect(s.companies.canvass.app!.exclusive).toBe(true);
  });
});

describe('side projects', () => {
  it('a distill ships a cheaper, slightly dumber copy; a fine-tune leans toward its segment', () => {
    let s = shipped(7);
    const m = mine(s);
    s.companies.lab.cash = 1e9;
    s = apply(s, { t: 'project', model: m.id, kind: 'distill', seg: null });
    expect(apply(s, { t: 'project', model: m.id, kind: 'tune', seg: 'lang.dev' })).toBe(s); // one at a time
    for (let i = 0; i < 4; i++) { s = endWeek(s); while (s.moments.length && s.moments[0].kind !== 'variant') s = apply(s, { t: 'dismissMoment' }); }
    const mini = Object.values(s.models).find((x) => x.variantOf === m.id)!;
    expect(mini.attrs.cost).toBeCloseTo(m.attrs.cost * 0.5);
    expect(mini.cap.reduce((a, b) => a + b)).toBeLessThan(m.cap.reduce((a, b) => a + b));
    expect(s.moments.some((x) => x.kind === 'variant')).toBe(true);
    while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
    s = apply(s, { t: 'project', model: m.id, kind: 'tune', seg: 'lang.dev' });
    for (let i = 0; i < 3; i++) { s = endWeek(s); while (s.moments.length) s = apply(s, { t: 'dismissMoment' }); }
    const dev = Object.values(s.models).find((x) => x.variantOf === m.id && x.id !== mini.id)!;
    expect(fitOf(SEGMENTS['lang.dev'], dev.cap)).toBeGreaterThan(fitOf(SEGMENTS['lang.dev'], m.cap));
  });
});
