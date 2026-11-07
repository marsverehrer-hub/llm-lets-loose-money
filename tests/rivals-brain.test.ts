// v19 B2: a rival lab's week (money, funding, compute, hiring, research, data, training, publishing) and its releases.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { COMPETITORS } from '../src/sim/data/competitors';
import { brainWeek, onRivalRelease, rivalBase } from '../src/sim/systems/rivals/brain';
import { RIVAL_TUNING } from '../src/sim/systems/rivals/tuning';
import { rivalLabs } from '../src/sim/systems/rivals';
import { gpuAllocationLeft } from '../src/sim/systems/scaleLimits';
import { RESEARCH } from '../src/sim/data/research';
import type { CompetitorDef, GameState, RivalLab } from '../src/sim/types';

/** 1 January 2024 (day 2556). Labs and their rival records are created on first use. */
const DAY_2024 = 2556;

function setup(seed = 7, idx = 0) {
  const s: GameState = createInitialState(seed, 'Test Labs');
  s.day = DAY_2024;
  const def: CompetitorDef = { ...COMPETITORS[idx], kind: 'frontier', openBias: 0, core: false }; // a plain lab (no marquee rescue)
  const lab = rivalLabs(s).find((l) => l.id === def.id)!;
  lab.status = 'active';
  lab.foundedDay = DAY_2024;
  const c = s.competitors.find((x) => x.id === def.id)!;
  c.active = true;
  c.nextReleaseDay = 1e9;
  return { s, def, lab, c };
}

function fleetCount(lab: RivalLab): number {
  return Object.values(lab.gpusRented).reduce((a, b) => a + b, 0) + Object.values(lab.gpusOwned).reduce((a, b) => a + b, 0);
}

describe('brainWeek determinism', () => {
  it('gives the same lab for the same seed', () => {
    const run = () => {
      const { s, def, lab } = setup(11);
      lab.cash = 5e8;
      lab.staff.research = 6;
      const rng = makeRng({ rngState: 99 });
      for (let w = 0; w < 30; w++) {
        s.day += 7;
        brainWeek(s, lab, def, rng);
      }
      return JSON.stringify(lab);
    };
    expect(run()).toBe(run());
  });
});

describe('compute', () => {
  it('a lab with cash buys GPUs and its training FLOPs rise', () => {
    const { s, def, lab } = setup();
    lab.cash = 1e9;
    const before = fleetCount(lab);
    brainWeek(s, lab, def, makeRng({ rngState: 3 }));
    expect(fleetCount(lab)).toBeGreaterThan(before);
    expect(Object.keys(lab.gpusOwned).length + Object.keys(lab.gpusRented).length).toBeGreaterThan(0);
  });

  it("a rival's purchase reduces the vendor allocation the player can buy", () => {
    const { s, def, lab } = setup();
    lab.cash = 1e9;
    const gpu = 'b200';
    const before = gpuAllocationLeft(s, gpu);
    brainWeek(s, lab, def, makeRng({ rngState: 3 }));
    expect(lab.gpusOwned[gpu] ?? 0).toBeGreaterThan(0);
    expect(gpuAllocationLeft(s, gpu)).toBe(Math.max(0, before - (lab.gpusOwned[gpu] ?? 0)));
  });
});

describe('training and release', () => {
  it('a finished run sets ready and makes the lab release today', () => {
    const { s, def, lab, c } = setup();
    lab.gpusOwned = { h100: 2000 };
    lab.run = { id: 'r1', paramsB: 10, tokensB: 200, arch: 'dense', dataQuality: 0.6, flopsDone: 0, flopsTotal: 1, startedDay: s.day };
    brainWeek(s, lab, def, makeRng({ rngState: 5 }));
    expect(lab.run).toBeNull();
    expect(lab.ready).not.toBeNull();
    expect(lab.ready!.paramsB).toBe(10);
    expect(c.nextReleaseDay).toBe(s.day);
  });

  it('a release appends a RivalModel and clears ready', () => {
    const { s, def, lab, c } = setup();
    lab.ready = { base: 70, paramsB: 12, tokensB: 240, arch: 'dense', dataQuality: 0.7, trainedDay: s.day };
    c.model = { name: 'Test-1', scores: { reasoning: 70, coding: 70, chat: 70, safety: 70 }, overall: 70, elo: 1000, releasedDay: s.day };
    onRivalRelease(s, def, c);
    expect(lab.models.length).toBe(1);
    expect(lab.models[0].paramsB).toBe(12);
    expect(lab.models[0].name).toBe('Test-1');
    expect(lab.ready).toBeNull();
  });

  it('a point release (no run) keeps the previous model size', () => {
    const { s, def, lab, c } = setup();
    lab.models.push({
      id: 'old', name: 'Old', paramsB: 30, tokensB: 600, dataQuality: 0.5, arch: 'dense', caps: {} as never, overall: 50, elo: 900,
      trainedDay: 0, releasedDay: 0, open: false, license: null,
    });
    c.model = { name: 'Point-2', scores: { reasoning: 55, coding: 55, chat: 55, safety: 55 }, overall: 55, elo: 1000, releasedDay: s.day };
    onRivalRelease(s, def, c);
    expect(lab.models[lab.models.length - 1].paramsB).toBe(30);
  });

  it('an open release reports open weights for the headline', () => {
    const { s, lab, c } = setup();
    const def: CompetitorDef = { ...COMPETITORS[0], kind: 'open', openBias: 1 };
    c.model = { name: 'Open-1', scores: { reasoning: 60, coding: 60, chat: 60, safety: 60 }, overall: 60, elo: 1000, releasedDay: s.day };
    expect(onRivalRelease(s, def, c)).toBe(true); // releaseModel folds this into the release headline
    expect(lab.models[lab.models.length - 1].open).toBe(true);
  });

  it('the catalogue is capped and keeps the best model', () => {
    const { s, def, lab, c } = setup();
    for (let i = 0; i < RIVAL_TUNING.MODEL_CAP + 5; i++) {
      const overall = i === 0 ? 99 : 10 + i;
      c.model = { name: `M${i}`, scores: { reasoning: overall, coding: overall, chat: overall, safety: overall }, overall, elo: 1000, releasedDay: s.day };
      onRivalRelease(s, def, c);
    }
    expect(lab.models.length).toBeLessThanOrEqual(RIVAL_TUNING.MODEL_CAP);
    expect(lab.models.some((m) => m.overall === 99)).toBe(true);
  });

  it('rivalBase blends a trained model with the frontier curve', () => {
    const { s, def, lab, c } = setup();
    expect(rivalBase(s, def, c, 80)).toBe(80);
    lab.ready = { base: 40, paramsB: 1, tokensB: 20, arch: 'dense', dataQuality: 0.5, trainedDay: s.day };
    expect(rivalBase(s, def, c, 80)).toBeCloseTo(40 + (80 - 40) * RIVAL_TUNING.ANCHOR);
  });
});

describe('money and funding', () => {
  it('a lab short of runway raises money once, then waits 180 days', () => {
    const { s, def, lab } = setup();
    lab.cash = 1000;
    lab.staff.research = 4;
    const rng = makeRng({ rngState: 1 });
    brainWeek(s, lab, def, rng);
    const raised = lab.totalRaised;
    expect(raised).toBeGreaterThanOrEqual(RIVAL_TUNING.RAISE_MIN);
    s.day += 7;
    lab.cash = 1000;
    brainWeek(s, lab, def, rng);
    expect(lab.totalRaised).toBe(raised);
  });

  it('a lab with cash and runway over a year does not raise', () => {
    const { s, def, lab } = setup();
    lab.cash = 1e12;
    brainWeek(s, lab, def, makeRng({ rngState: 2 }));
    expect(lab.totalRaised).toBe(0);
  });
});

describe('research and data', () => {
  it('a lab with research staff finishes topics it can start', () => {
    const { s, def, lab } = setup();
    lab.cash = 1e9;
    lab.staff.research = 40;
    const rng = makeRng({ rngState: 4 });
    for (let w = 0; w < 60; w++) {
      s.day += 7;
      brainWeek(s, lab, def, rng);
    }
    expect(lab.research.length).toBeGreaterThan(0);
    for (const id of lab.research) {
      const node = RESEARCH.find((n) => n.id === id)!;
      expect(node.prereqs.every((p) => lab.research.includes(p))).toBe(true);
    }
  });

  it('a lab buys a catalogue dataset on a monthly week', () => {
    const { s, def, lab } = setup();
    lab.cash = 1e9;
    s.day = 28 * 100; // a week index divisible by 4
    brainWeek(s, lab, def, makeRng({ rngState: 6 }));
    expect(lab.datasets.length).toBeGreaterThan(0);
  });
});
