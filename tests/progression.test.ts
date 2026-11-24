import { describe, expect, it } from 'vitest';
import { apply } from '../src/sim/apply';
import { endWeek } from '../src/sim/endWeek';
import { crowns, fitOf, segDef } from '../src/sim/demand';
import { AGI_AT, checkAgi, yearEnd } from '../src/sim/goals';
import { leak, publicWeek, researchable, researchCost, researchTick, worldTick } from '../src/sim/research';
import { availableTechs } from '../src/sim/resolve';
import { newGame } from '../src/sim/state';
import { MODALITIES, SEGMENTS } from '../src/sim/content/modalities';
import { ARCHS, tech, TECHS } from '../src/sim/content/tech';
import { RACES } from '../src/sim/content/flavor';
import type { GameState, Model } from '../src/sim/types';

const model = (s: GameState, lab: string, cap: number[], modality: Model['modality'] = 'lang'): Model => {
  const m: Model = { id: 'm' + s.nextId++, lab, name: 'Test', modality, cap, attrs: { cost: 0.015, speed: 1, trust: 0.8 }, price: 1, shipped: s.week,
    quirks: [], retired: false, arch: 'dense', techniques: [], params: 3e9, verdict: 'solid', compute: 300 };
  s.models[m.id] = m;
  return m;
};

describe('research', () => {
  it('buys a technique before it goes public', () => {
    const s = newGame(1);
    s.companies.lab.cash = 1e9;
    const s1 = apply(s, { t: 'research', rate: 0.15 });
    const target = researchable(s1, 'lab')[0];
    expect(target).toBeTruthy();
    s1.companies.lab.lab!.research.points = researchCost(s1, target) + 1;
    researchTick(s1, {});
    expect(s1.companies.lab.lab!.techniques).toContain(target.id);
    expect(availableTechs(s1, 'lab', target.mods[0]).map((t) => t.id)).toContain(target.id);
    expect(availableTechs(s1, 'openaye', target.mods[0]).map((t) => t.id)).not.toContain(target.id);
  });

  it('costs more the further ahead of its public date', () => {
    const s = newGame(1);
    const near = TECHS.find((t) => t.week === 12)!, far = TECHS.find((t) => t.week === 60)!;
    expect(researchCost(s, far)).toBeGreaterThan(researchCost(s, near));
  });

  it('shipping with a private technique makes it public 26 weeks later', () => {
    const s = newGame(2);
    const t = tech('selfimprove');
    s.companies.lab.lab!.techniques.push(t.id);
    leak(s, 'lab', [t.id]);
    expect(publicWeek(s, t)).toBe(s.week + 26);
    s.week += 26;
    expect(availableTechs(s, 'openaye', 'lang').map((x) => x.id)).toContain(t.id);
  });
});

describe('the world moves on', () => {
  it('new markets open on schedule', () => {
    const s = newGame(3);
    expect(s.segments['lang.agents']).toBeUndefined();
    s.week = SEGMENTS['lang.agents'].unlockWeek!;
    worldTick(s);
    expect(s.segments['lang.agents']).toBeTruthy();
  });

  it('a saturated benchmark is replaced and the crown can change hands', () => {
    const s = newGame(4);
    const seg = 'lang.frontier';
    const reasoner = model(s, 'openaye', [95, 60, 60, 60]); // great at the next, reasoning-heavy benchmark
    const allround = model(s, 'anthro', [83, 83, 83, 83]); // best at the current one
    expect(crowns(s, 'anthro')).toContain(seg);
    worldTick(s);
    expect(s.segments[seg].gen).toBe(1);
    expect(segDef(s, seg).bench).toBe(SEGMENTS[seg].gens![0].name);
    expect(fitOf(segDef(s, seg), reasoner.cap)).toBeGreaterThan(fitOf(segDef(s, seg), allround.cap));
    expect(crowns(s, 'openaye')).toContain(seg);
  });

  it('every game year brings something new', () => {
    for (let y = 1; y < 10; y++) {
      const inYear = (w?: number): boolean => w != null && w >= y * 48 && w < (y + 1) * 48;
      const news = TECHS.some((t) => inYear(t.week)) || ARCHS.some((a) => inYear(a.week)) || Object.values(SEGMENTS).some((d) => inYear(d.unlockWeek))
        || Object.values(MODALITIES).some((m) => inYear(m.unlockWeek));
      expect(news, `year ${y + 1}`).toBe(true);
    }
    expect(RACES).toHaveLength(10);
  });
});

describe('endings', () => {
  it('the first model past the line ends the AGI race once, for whoever built it', () => {
    const s = newGame(5);
    checkAgi(s, model(s, 'lab', [AGI_AT - 2, AGI_AT - 2, AGI_AT - 2, AGI_AT - 2]));
    expect(s.endings).toEqual([]);
    checkAgi(s, model(s, 'deepmined', [AGI_AT + 1, AGI_AT + 1, AGI_AT + 1, AGI_AT + 1]));
    checkAgi(s, model(s, 'lab', [AGI_AT + 5, AGI_AT + 5, AGI_AT + 5, AGI_AT + 5]));
    expect(s.endings).toEqual(['agiLost']);
    expect(s.moments.filter((m) => m.kind === 'end')).toHaveLength(1);
  });

  it('controlling one company in every layer is a vertical monopoly', () => {
    const s = newGame(6);
    for (const id of ['shelves', 'nvidium', 'semi', 'grid']) s.holdings.push({ owner: 'you', company: id, shares: 0.6 * s.companies[id].shares });
    s.week = 48;
    yearEnd(s);
    expect(s.endings).toContain('stack');
  });

  it('the year-ten rich list is an ending, and the game keeps going', () => {
    let s = newGame(7);
    s.week = 479;
    s = endWeek(s);
    expect(s.endings).toContain('rich');
    while (s.moments.length) s = apply(s, { t: 'dismissMoment' });
    expect(endWeek(s).week).toBe(481);
  });
});
