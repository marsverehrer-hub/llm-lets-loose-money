// The lifetime trophy cabinet: the union across games, and the titles at 10, 25 and 40.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GameState } from '../sim/types';
import { lifetimeCount, nextStep, noteTrophies, titleFor } from './trophies';

const KEY = 'llm-lets-loose-money/trophies';

function game(achievements: Record<string, number>): GameState {
  return { achievements } as GameState;
}

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  });
});

describe('trophies', () => {
  it('gives the titles at 10, 25 and 40', () => {
    expect(titleFor(9)).toBeNull();
    expect(titleFor(10)).toBe('Founder');
    expect(titleFor(24)).toBe('Founder');
    expect(titleFor(25)).toBe('Serial founder');
    expect(titleFor(40)).toBe('Industry veteran');
    expect(nextStep(0)).toEqual({ at: 10, title: 'Founder' });
    expect(nextStep(40)).toBeNull();
  });

  it('counts each trophy once across games', () => {
    noteTrophies(game({ first_train: 1, first_release: 2 }));
    noteTrophies(game({ first_release: 3, first_revenue: 4 }));
    expect(lifetimeCount()).toBe(3);
    expect(lifetimeCount({ outage: 1 })).toBe(4);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toHaveLength(3);
  });
});
