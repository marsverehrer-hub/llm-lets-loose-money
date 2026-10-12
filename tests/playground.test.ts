import { describe, it, expect } from 'vitest';
import {
  PROMPTS,
  gradeOf,
  playgroundResponse,
  promptsForYear,
  type PromptCategory,
  type ResponseGrade,
} from '../src/sim/data/playground';
import { QUIRKS } from '../src/sim/data/quirks';
import { CAP_IDS, type Capabilities, type Model, type Persona } from '../src/sim/types';

const EMOJI = /\p{Extended_Pictographic}/u;
const GRADES: ResponseGrade[] = ['awful', 'meh', 'good', 'great'];
const REP: Record<ResponseGrade, number> = { awful: 10, meh: 40, good: 65, great: 90 };
const CATEGORIES: PromptCategory[] = ['math', 'code', 'trivia', 'reasoning', 'creative', 'multilingual', 'safety', 'longcontext', 'agentic', 'chat'];

function caps(v: number, over: Partial<Capabilities> = {}): Capabilities {
  const c = {} as Capabilities;
  for (const k of CAP_IDS) c[k] = v;
  return { ...c, ...over };
}

function mk(over: Partial<Model> = {}): Model {
  return {
    id: 'm-test',
    name: 'Test-1',
    paramsB: 1,
    tokensB: 10,
    datasetIds: [],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: 50, coding: 50, chat: 50, safety: 50 },
    overall: 50,
    elo: 1200,
    trainedDay: 0,
    releasedDay: 0,
    deprecated: false,
    caps: caps(50),
    ...over,
  };
}

/** A model whose every capability sits at the representative score for one grade. */
function atGrade(g: ResponseGrade, over: Partial<Model> = {}): Model {
  return mk({ caps: caps(REP[g]), overall: REP[g], ...over });
}

function textOf(m: Model, promptId: string, variant = 0): string {
  return playgroundResponse(m, promptId, variant).text;
}

function sentenceEnds(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

describe('prompt library', () => {
  it('has 36 to 44 prompts with unique ids', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(36);
    expect(PROMPTS.length).toBeLessThanOrEqual(44);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
  });

  it('covers all ten categories', () => {
    const seen = new Set(PROMPTS.map((p) => p.category));
    for (const c of CATEGORIES) expect(seen.has(c), `category ${c}`).toBe(true);
    expect(seen.size).toBe(CATEGORIES.length);
  });

  it('includes the classic prompts', () => {
    const ids = new Set(PROMPTS.map((p) => p.id));
    for (const id of ['strawberry', 'nine_eleven', 'haiku_gpu', 'python_bug', 'finnish', 'napalm', 'pdf_400', 'book_flight', 'conscious', 'riddle_footsteps', 'trolley', 'cover_letter', 'quantum_dog']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('drives each prompt from a real capability, with era gates on agentic work', () => {
    for (const p of PROMPTS) {
      expect(CAP_IDS).toContain(p.cap);
      expect(p.prompt.length).toBeGreaterThan(0);
      if (p.category === 'agentic') expect(p.minYear ?? 0).toBeGreaterThanOrEqual(2023);
    }
  });

  it('gates era-specific prompts by year', () => {
    const in2017 = promptsForYear(2017).map((p) => p.id);
    expect(in2017).not.toContain('book_flight');
    expect(in2017).toContain('strawberry');
    expect(promptsForYear(2025).length).toBe(PROMPTS.length);
  });
});

describe('grading', () => {
  it('uses the thresholds awful < 30 <= meh < 55 <= good < 80 <= great', () => {
    expect(gradeOf(0)).toBe('awful');
    expect(gradeOf(29.9)).toBe('awful');
    expect(gradeOf(30)).toBe('meh');
    expect(gradeOf(54.9)).toBe('meh');
    expect(gradeOf(55)).toBe('good');
    expect(gradeOf(79.9)).toBe('good');
    expect(gradeOf(80)).toBe('great');
    expect(gradeOf(100)).toBe('great');
    expect(gradeOf(Number.NaN)).toBe('awful');
  });

  it('reads the grade from the prompt capability', () => {
    const p = PROMPTS.find((x) => x.id === 'nine_eleven')!;
    const low = mk({ caps: caps(90, { [p.cap]: 29 }) });
    const high = mk({ caps: caps(10, { [p.cap]: 85 }) });
    expect(playgroundResponse(low, p.id, 0).grade).toBe('awful');
    expect(playgroundResponse(high, p.id, 0).grade).toBe('great');
  });

  it('falls back to overall for models without caps', () => {
    for (const p of PROMPTS) {
      expect(playgroundResponse(mk({ caps: undefined, overall: 85 }), p.id, 0).grade).toBe('great');
      expect(playgroundResponse(mk({ caps: undefined, overall: 20 }), p.id, 0).grade).toBe('awful');
    }
  });

  it('returns the grade the model earned for every prompt', () => {
    for (const p of PROMPTS) {
      for (const g of GRADES) {
        expect(playgroundResponse(atGrade(g), p.id, 0).grade, `${p.id} ${g}`).toBe(g);
      }
    }
  });
});

describe('response texts', () => {
  it('every prompt has 2 to 3 distinct texts for all four grades', () => {
    for (const p of PROMPTS) {
      for (const g of GRADES) {
        const distinct = new Set<string>();
        for (let v = 0; v < 12; v++) distinct.add(textOf(atGrade(g), p.id, v));
        expect(distinct.size, `${p.id} ${g}`).toBeGreaterThanOrEqual(2);
        expect(distinct.size, `${p.id} ${g}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('gives non-empty plain text of reasonable length', () => {
    for (const p of PROMPTS) {
      for (const g of GRADES) {
        for (let v = 0; v < 3; v++) {
          const t = textOf(atGrade(g), p.id, v);
          expect(t.trim().length, `${p.id} ${g}`).toBeGreaterThan(0);
          expect(t.length, `${p.id} ${g}`).toBeLessThan(700);
          expect(t).not.toMatch(/\*\*|`|^#/m);
        }
      }
    }
  });

  it('picks texts deterministically by variant, with modulo wrap-around', () => {
    const m = atGrade('good');
    expect(textOf(m, 'multiply', 0)).toBe(textOf(m, 'multiply', 2));
    expect(textOf(m, 'multiply', 1)).toBe(textOf(m, 'multiply', 3));
    expect(textOf(m, 'multiply', -1)).toBe(textOf(m, 'multiply', 1));
  });

  it('returns a fallback for an unknown prompt id', () => {
    const r = playgroundResponse(mk({ overall: 70 }), 'no_such_prompt', 0);
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.grade).toBe('good');
  });
});

describe('visible quirks', () => {
  it('every quirk in the catalogue changes the text, for every prompt', () => {
    for (const p of PROMPTS) {
      const base = textOf(mk(), p.id, 0);
      for (const q of QUIRKS) {
        const shown = textOf(mk({ quirks: [q.id] }), p.id, 0);
        expect(shown, `${q.id} on ${p.id}`).not.toBe(base);
      }
    }
  });

  it('applies the expected transform for a sample of quirks', () => {
    const base = textOf(mk(), 'multiply', 0);
    expect(textOf(mk({ quirks: ['hope_helps'] }), 'multiply', 0)).toBe(`${base} Hope this helps!`);
    expect(textOf(mk({ quirks: ['delve'] }), 'multiply', 0)).toContain('delve');
    expect(textOf(mk({ quirks: ['golden_gate'] }), 'multiply', 0)).toContain('Golden Gate');
    expect(textOf(mk({ quirks: ['pirate'] }), 'multiply', 0)).toContain('matey');
    expect(textOf(mk({ quirks: ['welsh'] }), 'multiply', 0)).toContain('Diolch');
  });

  it('applies at most two transforms, in the order the model lists them', () => {
    const shown = textOf(mk({ quirks: ['hope_helps', 'space_facts', 'bob_ross'] }), 'multiply', 0);
    expect(shown).toContain('Hope this helps!');
    expect(shown).toContain('Fun fact');
    expect(shown).not.toContain('happy accidents');
  });

  it('gives unknown quirk ids no transform and no slot', () => {
    const base = textOf(mk(), 'multiply', 0);
    expect(textOf(mk({ quirks: ['not_a_quirk'] }), 'multiply', 0)).toBe(base);
    const shown = textOf(mk({ quirks: ['not_a_quirk', 'hope_helps', 'space_facts'] }), 'multiply', 0);
    expect(shown).toContain('Hope this helps!');
    expect(shown).toContain('Fun fact');
  });

  it('never lets latent quirks alter the text', () => {
    const latent = ['delve', 'hope_helps', 'golden_gate', 'pirate', 'paperclip'];
    for (const p of PROMPTS) {
      for (const g of GRADES) {
        for (let v = 0; v < 2; v++) {
          const plain = textOf(atGrade(g), p.id, v);
          const withLatent = textOf(atGrade(g, { latentQuirks: latent }), p.id, v);
          expect(withLatent, `${p.id} ${g} ${v}`).toBe(plain);
        }
      }
    }
  });

  it('shows visible quirks even when latent ones are also present', () => {
    const m = mk({ quirks: ['hope_helps'], latentQuirks: ['delve'] });
    const shown = textOf(m, 'multiply', 0);
    expect(shown).toContain('Hope this helps!');
    expect(shown).not.toContain('delve');
  });
});

describe('persona', () => {
  const base = (p: string) => textOf(mk(), p, 0);
  const withPersona = (persona: Persona, p = 'pdf_400') => textOf(mk({ persona }), p, 0);

  it('leaves text untouched with a neutral persona', () => {
    expect(withPersona({ helpfulness: 0, verbosity: 0, sycophancy: 0 })).toBe(base('pdf_400'));
    expect(textOf(mk({ persona: undefined }), 'pdf_400', 0)).toBe(base('pdf_400'));
  });

  it('opens with flattery when sycophancy is high', () => {
    const t = withPersona({ helpfulness: 0, verbosity: 0, sycophancy: 0.5 });
    expect(t.endsWith(base('pdf_400'))).toBe(true);
    expect(t.length).toBeGreaterThan(base('pdf_400').length);
  });

  it('rambles and closes with In conclusion when verbosity is high', () => {
    const t = withPersona({ helpfulness: 0, verbosity: 0.5, sycophancy: 0 });
    expect(t).toContain('In conclusion,');
    expect(t.length).toBeGreaterThan(base('pdf_400').length);
  });

  it('truncates to the first sentence when verbosity is low', () => {
    const full = base('pdf_400');
    expect(sentenceEnds(full)).toBeGreaterThanOrEqual(2);
    const t = withPersona({ helpfulness: 0, verbosity: -0.5, sycophancy: 0 });
    expect(full.startsWith(t)).toBe(true);
    expect(t.length).toBeLessThan(full.length);
    expect(sentenceEnds(t)).toBeLessThanOrEqual(1);
  });

  it('does not cut decimals as sentence ends', () => {
    const t = textOf(mk({ persona: { helpfulness: 0, verbosity: -0.5, sycophancy: 0 } }), 'nine_eleven', 0);
    expect(t).toContain('9.9');
  });

  it('prefaces a hedge when helpfulness is low', () => {
    const t = withPersona({ helpfulness: -0.5, verbosity: 0, sycophancy: 0 });
    expect(t.endsWith(base('pdf_400'))).toBe(true);
    expect(t.length).toBeGreaterThan(base('pdf_400').length);
  });

  it('combines persona knobs deterministically', () => {
    const p: Persona = { helpfulness: -0.5, verbosity: 0.5, sycophancy: 0.5 };
    expect(withPersona(p)).toBe(withPersona(p));
    expect(withPersona(p)).toContain('In conclusion,');
  });
});

describe('contamination', () => {
  it('occasionally adds the test-set joke, only to benchmark-style prompts', () => {
    const benchIds = PROMPTS.filter((p) => ['math', 'reasoning', 'trivia'].includes(p.category)).map((p) => p.id);
    let jokes = 0;
    for (let i = 0; i < 30; i++) {
      for (const id of benchIds) {
        if (textOf(atGrade('good', { contaminated: true, id: `c-${i}` }), id, 0).includes('question 47 of the test set')) jokes++;
      }
    }
    expect(jokes).toBeGreaterThan(0);
    expect(jokes).toBeLessThan(30 * benchIds.length);
  });

  it('never adds the joke to chat prompts or clean models', () => {
    for (let i = 0; i < 30; i++) {
      expect(textOf(atGrade('good', { contaminated: true, id: `c-${i}` }), 'hi', 0)).not.toContain('test set');
    }
    for (const p of PROMPTS) {
      expect(textOf(atGrade('good', { contaminated: false }), p.id, 0)).not.toContain('test set');
    }
  });
});

describe('purity and determinism', () => {
  it('returns the same answer for the same inputs', () => {
    const m = mk({ quirks: ['delve', 'hope_helps'], persona: { helpfulness: -0.4, verbosity: 0.6, sycophancy: 0.4 }, contaminated: true });
    for (const p of PROMPTS) {
      expect(textOf(m, p.id, 3)).toBe(textOf(m, p.id, 3));
    }
  });

  it('does not mutate the model', () => {
    const m = mk({ quirks: ['delve', 'hope_helps'], latentQuirks: ['pirate'], persona: { helpfulness: 0, verbosity: 0.5, sycophancy: 0.5 } });
    const before = JSON.stringify(m);
    for (const p of PROMPTS) playgroundResponse(m, p.id, 1);
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('plain text', () => {
  it('contains no emoji in any text, under every visible quirk and persona', () => {
    const persona: Persona = { helpfulness: -0.5, verbosity: 0.5, sycophancy: 0.5 };
    const terse: Persona = { helpfulness: 0, verbosity: -0.5, sycophancy: 0 };
    for (const p of PROMPTS) {
      for (const g of GRADES) {
        for (let v = 0; v < 4; v++) {
          expect(EMOJI.test(textOf(atGrade(g), p.id, v)), `${p.id} ${g}`).toBe(false);
          for (const q of QUIRKS) {
            const shown = textOf(atGrade(g, { quirks: [q.id], persona, contaminated: true }), p.id, v);
            expect(EMOJI.test(shown), `${q.id} ${p.id} ${g}`).toBe(false);
            const trimmed = textOf(atGrade(g, { quirks: [q.id], persona: terse }), p.id, v);
            expect(EMOJI.test(trimmed), `${q.id} terse ${p.id} ${g}`).toBe(false);
          }
        }
      }
    }
  });
});
