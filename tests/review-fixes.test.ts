// Regression tests for bugs found in the v19 review.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { inheritOrigin } from '../src/sim/systems/hub';
import { adoptQuote } from '../src/sim/systems/research';
import { RESEARCH } from '../src/sim/data/research';
import type { Model } from '../src/sim/types';

const fake = (license?: 'permissive' | 'noncommercial' | 'research') =>
  ({ origin: license ? { labId: 'x', modelId: 'y', license } : undefined }) as unknown as Model;

describe('v19 review fixes', () => {
  it('a model built from hub weights keeps the strictest license', () => {
    expect(inheritOrigin([fake('permissive'), fake('research')])?.license).toBe('research');
    expect(inheritOrigin([fake('noncommercial')])?.license).toBe('noncommercial');
    expect(inheritOrigin([fake(), fake()])).toBeUndefined();
  });

  it('an off-sale model cannot be quantized back onto the market', () => {
    const s = createInitialState(1, 'T');
    const m = { id: 'm1', name: 'Old', releasedDay: 0, deprecated: true, paramsB: 7 } as unknown as Model;
    s.models.push(m);
    const before = s.models.length;
    dispatch(s, { type: 'quantizeModel', modelId: 'm1', bits: 8 });
    expect(s.models.length).toBe(before);
  });

  it('AGI cannot be bought as a paper, and adopting the topic in progress is refused', () => {
    const s = createInitialState(1, 'T');
    const agi = RESEARCH.find((n) => n.id === 'agi')!;
    expect(adoptQuote(s, agi).ok).toBe(false);
    const node = RESEARCH.find((n) => n.id === 'transformers')!;
    s.research.current = node.id;
    expect(adoptQuote(s, node).ok).toBe(false);
  });
});
