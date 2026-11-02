// v17.2 deep links: a navigation's intent is taken once, and only by the panel it was aimed at.
import { describe, expect, it } from 'vitest';
import { navigate, takeIntent } from '../src/ui/nav';

describe('navigate intents', () => {
  it('is taken once by its target panel only', () => {
    navigate('models', { open: 'train' });
    expect(takeIntent('compute')).toBeNull();
    expect(takeIntent('models')).toEqual({ open: 'train' });
    expect(takeIntent('models')).toBeNull();
  });

  it('a plain navigation clears a stale intent', () => {
    navigate('models', { open: 'train' });
    navigate('models');
    expect(takeIntent('models')).toBeNull();
  });
});
