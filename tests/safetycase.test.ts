// v19 C5: the safety case (evals, research, traits), its effect on enterprise and government fit, the research-license
// gate on bids, and the jailbreak roll.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { SAFETY_NODES, safetyCase, safetyTick, SAFETY_CASE_LABEL } from '../src/sim/systems/safetyCase';
import { expectedFit, meetsReqs } from '../src/sim/systems/contracts';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, ContractOffer, GameState, Model, Rng } from '../src/sim/types';

function lab(seed: number): GameState {
  const s = createInitialState(seed, 'Safety');
  s.finance.cash = 1e13;
  s.tutorialStep = -1;
  return s;
}

/** A released text model with every capability at `caps`. */
function addModel(s: GameState, o: { caps: number; traits?: Model['traits']; origin?: Model['origin'] }): Model {
  const caps = Object.fromEntries(CAP_IDS.map((k) => [k, o.caps])) as Capabilities;
  const m: Model = {
    id: `m${++s.idCounter}`,
    name: 'Testbed',
    paramsB: 10,
    tokensB: 2000,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: o.caps, coding: o.caps, chat: o.caps, safety: o.caps },
    overall: o.caps,
    elo: 800 + 8 * o.caps,
    trainedDay: s.day,
    releasedDay: s.day,
    deprecated: false,
    caps,
    benchmarks: {},
    specId: null,
    parentId: null,
    lineage: [],
    contextK: 128,
    modalities: ['text'],
    contaminated: false,
    config: defaultConfig(s),
    activeParamsB: 10,
    quirks: [],
    latentQuirks: [],
    inferenceMult: 1,
    vibes: 0,
    emergences: [],
    releaseMode: 'full',
    traits: o.traits,
    origin: o.origin,
  };
  s.models.push(m);
  return m;
}

function government(s: GameState): ContractOffer {
  return {
    id: 'co-gov',
    defId: 'gov',
    kind: 'government',
    client: 'Ministry of Paperwork',
    title: 'Citizen services',
    blurb: '',
    reqs: {},
    upfront: 1e6,
    perYear: 1e6,
    years: 2,
    supportEngineers: 0,
    expiresDay: s.day + 30,
    rivalFit: 0,
    rivalLab: null,
  };
}

/** A deterministic rng: every draw returns `draw`. A jailbreak roll hits when `draw` is under the chance. */
function rigged(draw: number): Rng {
  return {
    next: () => draw,
    range: (min, max) => min + (max - min) * draw,
    int: (min) => min,
    chance: (p) => draw < p,
    pick: <T,>(arr: readonly T[]) => arr[0],
    normal: (mean = 0) => mean,
  };
}

describe('safety case', () => {
  it('rises with each safety research node done', () => {
    const s = lab(1);
    const m = addModel(s, { caps: 40 });
    const before = safetyCase(s, m);
    s.research.completed.push(...SAFETY_NODES.slice(0, 3));
    expect(safetyCase(s, m)).toBeGreaterThan(before);
  });

  it('is lowered by reward hacking', () => {
    const s = lab(2);
    const clean = addModel(s, { caps: 60, traits: { rewardHacking: 0 } });
    const hacky = addModel(s, { caps: 60, traits: { rewardHacking: 0.8 } });
    expect(safetyCase(s, hacky)).toBeLessThan(safetyCase(s, clean));
  });

  it('is clamped to 0..100 and labelled', () => {
    const s = lab(3);
    s.research.completed.push(...SAFETY_NODES);
    const strong = addModel(s, { caps: 100 });
    expect(safetyCase(s, strong)).toBeLessThanOrEqual(100);
    const s2 = lab(30);
    const weak = addModel(s2, { caps: 0, traits: { rewardHacking: 1 } });
    expect(safetyCase(s2, weak)).toBe(0);
    expect(SAFETY_CASE_LABEL(30)).toBe('Thin');
    expect(SAFETY_CASE_LABEL(55)).toBe('Adequate');
    expect(SAFETY_CASE_LABEL(80)).toBe('Strong');
  });
});

describe('safety case and contracts', () => {
  it('a high safety case raises government fit, and leaves other kinds alone', () => {
    const s = lab(4);
    const m = addModel(s, { caps: 60 });
    const offer = government(s);
    const low = expectedFit(s, offer, m);
    s.research.completed.push(...SAFETY_NODES);
    expect(expectedFit(s, offer, m)).toBeGreaterThan(low);
    const npc = { ...offer, kind: 'npc' as const };
    const s2 = lab(4);
    const m2 = addModel(s2, { caps: 60 });
    const npcLow = expectedFit(s2, npc, m2);
    s2.research.completed.push(...SAFETY_NODES);
    expect(expectedFit(s2, npc, m2)).toBe(npcLow);
  });

  it('a research-licence hub model cannot take a deal', () => {
    const s = lab(5);
    const m = addModel(s, { caps: 60, origin: { labId: 'rival', modelId: 'x', license: 'research' } });
    const v = meetsReqs(s, m, {});
    expect(v.ok).toBe(false);
    expect(v.failures.join(' ')).toMatch(/research/);
  });

  it('a permissive hub model can take a deal', () => {
    const s = lab(6);
    const m = addModel(s, { caps: 60, origin: { labId: 'rival', modelId: 'x', license: 'permissive' } });
    expect(meetsReqs(s, m, {}).ok).toBe(true);
  });
});

describe('jailbreaks', () => {
  it('are rarer for a strong safety case, with a rigged rng', () => {
    const weak = lab(7);
    addModel(weak, { caps: 0 });
    safetyTick(weak, rigged(0.0005));
    expect(weak.flags['jailbreaks.lastDay']).toBe(weak.day);

    const strong = lab(7);
    const m = addModel(strong, { caps: 100 });
    strong.research.completed.push(...SAFETY_NODES);
    m.redTeam = true;
    m.benchRuns = { mmlu: { day: 0, score: 70 } };
    expect(safetyCase(strong, m)).toBeGreaterThan(80);
    safetyTick(strong, rigged(0.0005));
    expect(strong.flags['jailbreaks.lastDay']).toBeUndefined();
  });

  it('a hit costs reputation and counts against the model', () => {
    const s = lab(8);
    const m = addModel(s, { caps: 0 });
    const rep = s.company.reputation;
    safetyTick(s, rigged(0));
    expect(s.company.reputation).toBeLessThan(rep);
    expect(s.flags[`jailbreaks.${m.id}`]).toBe(1);
  });

  it('no more than one jailbreak in a week', () => {
    const s = lab(9);
    const m = addModel(s, { caps: 0 });
    safetyTick(s, rigged(0));
    s.day += 3;
    safetyTick(s, rigged(0));
    expect(s.flags[`jailbreaks.${m.id}`]).toBe(1);
    s.day += 4;
    safetyTick(s, rigged(0));
    expect(s.flags[`jailbreaks.${m.id}`]).toBe(2);
  });
});
