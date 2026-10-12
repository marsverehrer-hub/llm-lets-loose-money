import { describe, it, expect } from 'vitest';
import '../src/sim/engine'; // load the engine first: the sim has an import cycle that breaks if a system loads before it
import { createInitialState } from '../src/sim/state';
import { COMPETITORS } from '../src/sim/data/competitors';
import { NAMING_SCHEMES, companyStem, suggestCodename, suggestModelName, suggestPublicName } from '../src/sim/data/names';
import { namePoolFor, nextRivalName } from '../src/sim/systems/competitors';
import { makeRng } from '../src/sim/rng';
import { CAP_IDS } from '../src/sim/types';
import type { Capabilities, CompetitorDef, GameState, Model } from '../src/sim/types';

/** Every cap at `base`, with overrides. */
function capsOf(base: number, over: Partial<Capabilities> = {}): Capabilities {
  const out = {} as Capabilities;
  for (const k of CAP_IDS) out[k] = base;
  return { ...out, ...over };
}
const FLAT = capsOf(50);
const REASONING_PEAK = capsOf(40, { reasoning: 90, math: 85 });
const CODING_PEAK = capsOf(40, { coding: 90 });

function namingOf(def: CompetitorDef) {
  if (!def.naming) throw new Error(`${def.id} has no house naming scheme`);
  return def.naming;
}

function rivalState(def: CompetitorDef): { s: GameState } {
  const s = createInitialState(1);
  if (!s.competitors.some((c) => c.id === def.id)) throw new Error(`${def.id} missing from state`);
  return { s };
}

function playerState(companyName = 'Lets Loose Labs'): GameState {
  const s = createInitialState(3);
  s.company.name = companyName;
  s.models = [];
  return s;
}

function mkModel(p: Partial<Model> & { id: string; name: string; paramsB: number }): Model {
  return {
    tokensB: 1000,
    datasetIds: [],
    techniques: [],
    finalLoss: 1,
    scores: { reasoning: 50, coding: 50, chat: 50, safety: 50 },
    overall: 50,
    elo: 1200,
    trainedDay: 0,
    releasedDay: null,
    deprecated: false,
    ...p,
  } as Model;
}

describe('rival house schemes', () => {
  it('every lab has a 10 to 16 entry sequence and no duplicate names anywhere in its scheme', () => {
    for (const def of COMPETITORS) {
      const n = namingOf(def);
      expect(n.sequence.length, def.id).toBeGreaterThanOrEqual(10);
      expect(n.sequence.length, def.id).toBeLessThanOrEqual(16);
      const all = [...n.sequence, ...(n.reasoning ?? []), ...(n.coder ?? [])];
      expect(new Set(all).size, `${def.id} duplicates`).toBe(all.length);
    }
  });

  it('each lab first releases follow its sequence (normal caps never take a pool)', () => {
    for (const def of COMPETITORS) {
      const { s } = rivalState(def);
      const c = s.competitors.find((x) => x.id === def.id)!;
      const names = namingOf(def).sequence.map(() => nextRivalName(s, def, c, FLAT));
      expect(names, def.id).toEqual(namingOf(def).sequence);
    }
    const openaye = COMPETITORS.find((d) => d.id === 'openaye')!;
    const { s } = rivalState(openaye);
    const c = s.competitors.find((x) => x.id === 'openaye')!;
    expect(nextRivalName(s, openaye, c, FLAT)).toBe('GPTee-1');
    expect(nextRivalName(s, openaye, c, FLAT)).toBe('GPTee-2');
  });

  it('after(k) continues the sequence once it runs out', () => {
    for (const def of COMPETITORS) {
      const n = namingOf(def);
      const { s } = rivalState(def);
      const c = s.competitors.find((x) => x.id === def.id)!;
      for (let i = 0; i < n.sequence.length; i++) nextRivalName(s, def, c, FLAT);
      expect(nextRivalName(s, def, c, FLAT), def.id).toBe(n.after(1));
      expect(nextRivalName(s, def, c, FLAT), def.id).toBe(n.after(2));
    }
  });

  it('reasoning and coder pools kick in for skewed caps, then the sequence resumes', () => {
    const mistrial = COMPETITORS.find((d) => d.id === 'mistrial')!;
    const n = namingOf(mistrial);
    const { s } = rivalState(mistrial);
    const c = s.competitors.find((x) => x.id === 'mistrial')!;
    expect(namePoolFor(REASONING_PEAK, { reasoning: n.reasoning, coder: n.coder })).toBe('reasoning');
    expect(namePoolFor(CODING_PEAK, { reasoning: n.reasoning, coder: n.coder })).toBe('coder');
    expect(namePoolFor(FLAT, { reasoning: n.reasoning, coder: n.coder })).toBeNull();

    expect(nextRivalName(s, mistrial, c, REASONING_PEAK)).toBe(n.reasoning![0]);
    expect(nextRivalName(s, mistrial, c, CODING_PEAK)).toBe(n.coder![0]);
    expect(nextRivalName(s, mistrial, c, FLAT)).toBe(n.sequence[0]);
    expect(nextRivalName(s, mistrial, c, REASONING_PEAK)).toBe(n.reasoning![1]);
  });

  it('an exhausted pool falls back to the sequence instead of repeating', () => {
    const def = COMPETITORS.find((d) => d.id === 'deepmined')!;
    const n = namingOf(def);
    const { s } = rivalState(def);
    const c = s.competitors.find((x) => x.id === 'deepmined')!;
    const got = Array.from({ length: n.reasoning!.length + 1 }, () => nextRivalName(s, def, c, REASONING_PEAK));
    expect(got.slice(0, n.reasoning!.length)).toEqual(n.reasoning);
    expect(got[n.reasoning!.length]).toBe(n.sequence[0]);
  });

  it('no duplicate names over 30 releases per lab, with mixed and all-reasoning caps', () => {
    for (const def of COMPETITORS) {
      const { s } = rivalState(def);
      const c = s.competitors.find((x) => x.id === def.id)!;
      const mixed = Array.from({ length: 30 }, (_, i) => {
        const caps = i % 3 === 0 ? REASONING_PEAK : i % 5 === 0 ? CODING_PEAK : FLAT;
        return nextRivalName(s, def, c, caps);
      });
      expect(new Set(mixed).size, `${def.id} mixed`).toBe(30);

      const fresh = rivalState(def).s;
      const fc = fresh.competitors.find((x) => x.id === def.id)!;
      const skewed = Array.from({ length: 30 }, () => nextRivalName(fresh, def, fc, REASONING_PEAK));
      expect(new Set(skewed).size, `${def.id} skewed`).toBe(30);
    }
  });

  it('after(k) names never collide with the sequence or pools', () => {
    for (const def of COMPETITORS) {
      const n = namingOf(def);
      const taken = new Set([...n.sequence, ...(n.reasoning ?? []), ...(n.coder ?? [])]);
      const overflow = Array.from({ length: 20 }, (_, i) => n.after(i + 1));
      expect(new Set(overflow).size, def.id).toBe(20);
      for (const name of overflow) expect(taken.has(name), `${def.id}: ${name}`).toBe(false);
    }
  });
});

describe('company stem', () => {
  it('drops filler words', () => {
    expect(companyStem('Lets Loose Labs')).toBe('Lets Loose');
    expect(companyStem('Acme AI')).toBe('Acme');
    expect(companyStem('Acme Technologies Inc.')).toBe('Acme');
    expect(companyStem('Loosey')).toBe('Loosey');
  });

  it('falls back sensibly', () => {
    expect(companyStem('AI Labs')).toBe('AI Labs'); // all filler: keep the words rather than return nothing
    expect(companyStem('   ')).toBe('Frontier');
    expect(companyStem('Extraordinarily Long Company Name')).toBe('Extraordinarily');
  });
});

describe('player naming schemes', () => {
  // Base models: Seven (released day 10, 7B) and Seventy (released day 60, 70B). Versions count released bases.
  const seven = mkModel({ id: 'seven', name: 'Seven', paramsB: 7, releasedDay: 10 });
  const seventy = mkModel({ id: 'seventy', name: 'Seventy', paramsB: 70, releasedDay: 60 });

  it('a small base model gets a small version and the mini tag', () => {
    const s = playerState();
    s.models = [mkModel({ id: 'big', name: 'Big', paramsB: 70, releasedDay: 100 }), mkModel({ id: 'small', name: 'Tiny', paramsB: 3 })];
    const tiny = s.models[1];
    expect(suggestPublicName(s, tiny, 'versioned', makeRng({ rngState: 1 }))).toBe('Lets Loose 2 mini');
  });

  it('a large base model gets the next version and the Pro tag', () => {
    const s = playerState();
    s.models = [seven, seventy, mkModel({ id: 'huge', name: 'Huge', paramsB: 405 })];
    const huge = s.models[2];
    expect(suggestPublicName(s, huge, 'versioned', makeRng({ rngState: 1 }))).toBe('Lets Loose 3 Pro');
  });

  it('a coder fine-tune takes its parent version and a coder word', () => {
    const s = playerState();
    const ft = mkModel({ id: 'ft', name: 'Seventy Coder', paramsB: 70, parentId: 'seventy', specId: 'coder', lineage: ['coder'] });
    s.models = [seven, seventy, ft];
    const name = suggestPublicName(s, ft, 'versioned', makeRng({ rngState: 4 }));
    expect(name).toMatch(/^Lets Loose 2 Cod(e|er)$/);
  });

  it('a distilled model gets mini, Flash or Lite', () => {
    const s = playerState();
    const student = mkModel({ id: 'student', name: 'Student', paramsB: 3, derivedFrom: { kind: 'distill', ids: ['seventy'] } });
    s.models = [seven, seventy, student];
    const name = suggestPublicName(s, student, 'versioned', makeRng({ rngState: 9 }));
    expect(name).toMatch(/^Lets Loose 2 (mini|Flash|Lite)$/);
  });

  it('a merged model gets Merge or Soup', () => {
    const s = playerState();
    const merged = mkModel({ id: 'merged', name: 'Merged', paramsB: 70, derivedFrom: { kind: 'merge', ids: ['seventy', 'seven'], method: 'average' } });
    s.models = [seven, seventy, merged];
    expect(suggestPublicName(s, merged, 'versioned', makeRng({ rngState: 2 }))).toMatch(/(Merge|Soup)$/);
  });

  it('every scheme builds a company-branded name, and distilled models end with a derived word', () => {
    for (const scheme of NAMING_SCHEMES) {
      const s = playerState();
      const student = mkModel({ id: 'student', name: 'Student', paramsB: 3, derivedFrom: { kind: 'distill', ids: ['seventy'] } });
      s.models = [seven, seventy, student];
      const rng = makeRng({ rngState: 11 });
      const name = suggestPublicName(s, student, scheme.id, rng);
      expect(name, scheme.id).toContain('Lets Loose');
      expect(name, scheme.id).toMatch(/(mini|Flash|Lite)$/);
    }
  });

  it('a big-number name uses the parameter count and spec', () => {
    const s = playerState();
    const ft = mkModel({ id: 'ft', name: 'Seventy Instruct', paramsB: 70, parentId: 'seventy', specId: 'instruct', lineage: ['instruct'] });
    s.models = [seven, seventy, ft];
    expect(suggestPublicName(s, ft, 'big_number', makeRng({ rngState: 3 }))).toMatch(/^Lets Loose-70B-(Instruct|Chat)$/);
  });

  it('tiered poetry sizes the model: haiku for small, epic for large', () => {
    const small = playerState();
    small.models = [seventy, mkModel({ id: 'tiny', name: 'Tiny', paramsB: 2 })];
    expect(suggestPublicName(small, small.models[1], 'tiered_poetry', makeRng({ rngState: 6 }))).toBe('Lets Loose Haiku 2');

    const large = playerState();
    large.models = [seven, mkModel({ id: 'vast', name: 'Vast', paramsB: 700 })];
    expect(suggestPublicName(large, large.models[1], 'tiered_poetry', makeRng({ rngState: 6 }))).toBe('Lets Loose Epic 2');
  });

  it('is deterministic for a given rng state', () => {
    const s = playerState();
    s.models = [seven, seventy];
    for (const scheme of NAMING_SCHEMES) {
      const a = suggestPublicName(s, seventy, scheme.id, makeRng({ rngState: 77 }));
      const b = suggestPublicName(s, seventy, scheme.id, makeRng({ rngState: 77 }));
      expect(a, scheme.id).toBe(b);
    }
  });

  it('never duplicates another model name', () => {
    const s = playerState();
    const twin = mkModel({ id: 'twin', name: 'Taken', paramsB: 3 });
    s.models = [twin];
    const first = suggestPublicName(s, mkModel({ id: 'new', name: 'New', paramsB: 3 }), 'versioned', makeRng({ rngState: 5 }));
    twin.name = first;
    const second = suggestPublicName(s, mkModel({ id: 'new', name: 'New', paramsB: 3 }), 'versioned', makeRng({ rngState: 5 }));
    expect(second).toBe(`${first} (rev 2)`);
  });

  it('gives every scheme a non-empty, company-branded name across 40 rng seeds', () => {
    const s = playerState();
    s.models = [seven, seventy];
    for (const scheme of NAMING_SCHEMES) {
      const names = Array.from({ length: 40 }, (_, i) => suggestPublicName(s, mkModel({ id: 'x', name: 'x', paramsB: 20 }), scheme.id, makeRng({ rngState: i + 1 })));
      expect(names.every((n) => n.includes('Lets Loose')), scheme.id).toBe(true);
    }
  });

  it('the schemes with random word pools vary by seed', () => {
    const s = playerState();
    s.models = [seven, seventy];
    for (const id of ['mythic', 'weather', 'marketing', 'animals']) {
      const names = Array.from({ length: 40 }, (_, i) => suggestPublicName(s, mkModel({ id: 'x', name: 'x', paramsB: 20 }), id, makeRng({ rngState: i + 1 })));
      expect(new Set(names).size, id).toBeGreaterThan(1);
    }
  });
});

describe('codenames', () => {
  it('draws from a large, varied pool, mostly bare with some Project names', () => {
    const rng = makeRng({ rngState: 42 });
    const draws = Array.from({ length: 2000 }, () => suggestCodename(rng));
    const bare = draws.filter((d) => !d.startsWith('Project '));
    const distinct = new Set(draws.map((d) => d.replace(/^Project /, '')));
    expect(distinct.size).toBeGreaterThanOrEqual(60);
    expect(bare.length / draws.length).toBeGreaterThan(0.6);
    expect(bare.length / draws.length).toBeLessThan(0.85);
  });

  it('suggestModelName still works and returns codenames', () => {
    const rng = makeRng({ rngState: 8 });
    for (let i = 1; i <= 10; i++) expect(suggestModelName(rng, i).trim().length).toBeGreaterThan(0);
  });
});

describe('namePoolFor', () => {
  it('needs a clear edge (20) over the mean and a pool the lab actually has', () => {
    const pools = { reasoning: ['R1'] };
    expect(namePoolFor(REASONING_PEAK, pools)).toBe('reasoning');
    expect(namePoolFor(CODING_PEAK, pools)).toBeNull();
    expect(namePoolFor(capsOf(50, { reasoning: 70 }), pools)).toBeNull();
    expect(namePoolFor(capsOf(50, { reasoning: 75 }), pools)).toBe('reasoning');
  });
});
