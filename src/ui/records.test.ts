// Personal records: the best result is kept, and a finished game is recorded once, even across a reload.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInitialState } from '../sim/state';
import type { GameSetup } from '../sim/types';
import { dateLabel, mergeRecord, readRecords, recordGame } from './records';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

const setup: GameSetup = { scenarioId: 'garage', difficulty: 'founder', sandbox: false, skipTutorial: true, startYear: 2017 };

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

describe('records', () => {
  it('keeps the best score and the best peak, each with its date', () => {
    const first = mergeRecord({}, { score: 1000, peak: 5e9 }, '2026-11-07');
    const second = mergeRecord(first, { score: 800, peak: 9e9 }, '2026-11-08');
    expect(second.score).toEqual({ value: 1000, date: '2026-11-07' });
    expect(second.peak).toEqual({ value: 9e9, date: '2026-11-08' });
  });

  it('records a finished game once, skipping sandbox games', () => {
    const s = createInitialState(3, 'T', setup);
    s.ending = { id: 'safe_launch', day: 100, score: 1234, by: 'player' };
    s.stats.peakValuation = 4.2e9;
    expect(recordGame(s, '2026-11-07')).toBe(true);
    expect(recordGame(s, '2026-11-08')).toBe(false);
    expect(readRecords()['garage:founder']).toEqual({
      score: { value: 1234, date: '2026-11-07' },
      peak: { value: 4.2e9, date: '2026-11-07' },
    });

    const sandbox = createInitialState(4, 'T', { ...setup, sandbox: true });
    sandbox.gameOver = { reason: 'Ran out of money', day: 50 };
    expect(recordGame(sandbox, '2026-11-07')).toBe(false);
  });

  it('records a bankruptcy by peak valuation only', () => {
    const s = createInitialState(5, 'T', setup);
    s.gameOver = { reason: 'Ran out of money', day: 50 };
    s.stats.peakValuation = 2e9;
    recordGame(s, '2026-11-07');
    const rec = readRecords()['garage:founder'];
    expect(rec?.score).toBeUndefined();
    expect(rec?.peak?.value).toBe(2e9);
  });

  it('formats a record date for reading', () => {
    expect(dateLabel('2026-11-07')).toBe('7 Nov 2026');
  });
});
