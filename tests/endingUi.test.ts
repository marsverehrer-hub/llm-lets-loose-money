// v19 E2: the endings takeover's pure helpers. The DOM itself is checked by hand in the app.
import { describe, expect, it } from 'vitest';
import { teaser } from '../src/ui/shell/EndingModal';

describe('ending teaser', () => {
  it('takes the first sentence of the text', () => {
    expect(teaser('Ship it before anyone else does. What could go wrong.')).toBe('Ship it before anyone else does.');
  });
  it('returns the whole text when it has one sentence', () => {
    expect(teaser('Nothing to see here')).toBe('Nothing to see here');
  });
  it('is empty for empty text', () => {
    expect(teaser('')).toBe('');
  });
});
