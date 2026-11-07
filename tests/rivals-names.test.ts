import { describe, expect, it } from 'vitest';
import { fitNameToSize, sizeTag } from '../src/sim/systems/rivals/brain';

describe('v19 rival names carry their real size', () => {
  it('rewrites the size in a house name', () => {
    expect(fitNameToSize('QwQ-ish-32B', 388.6, 'dense')).toBe('QwQ-ish-389B');
    expect(fitNameToSize('Qwerty2.5-72B', 72.4, 'dense')).toBe('Qwerty2.5-72B');
    expect(fitNameToSize('Llamaish 3.3 70B', 291.1, 'dense')).toBe('Llamaish 3.3 291B');
    expect(fitNameToSize('Pooled-LM 7B', 6.5, 'dense')).toBe('Pooled-LM 6.5B');
  });

  it('keeps an active-parameter tag only for a mixture of experts', () => {
    expect(fitNameToSize('Qwerty3-235B-A22B', 388.6, 'moe')).toBe('Qwerty3-389B-A70B');
    expect(fitNameToSize('Qwerty3-235B-A22B', 388.6, 'dense')).toBe('Qwerty3-389B');
  });

  it('leaves names without a size alone, and never touches version numbers', () => {
    expect(fitNameToSize('Clawed 5 Limerick', 120, 'dense')).toBe('Clawed 5 Limerick');
    expect(fitNameToSize('GPTee-59', 900, 'moe')).toBe('GPTee-59');
    expect(sizeTag(1500)).toBe('1.5T');
  });

  it('handles experts x size, and size words follow the weight class', () => {
    expect(fitNameToSize('Mixtrial 8x22B v2', 188.2, 'moe')).toBe('Mixtrial 8x24B v2');
    expect(fitNameToSize('Mistrial Small', 132, 'dense', 2024)).not.toMatch(/Small/);
    expect(fitNameToSize('Qwerty Max', 2, 'dense', 2024)).not.toMatch(/Max/);
    expect(fitNameToSize('Mistrial Small', 3, 'dense', 2024)).toBe('Mistrial Small');
  });
});
