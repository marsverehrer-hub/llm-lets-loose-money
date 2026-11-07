// The daily challenge: one setup per UTC date, the same for everyone, and a one-line result to share.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../sim/state';
import { difficultyDef, scenarioById } from '../../sim/data/scenarios';
import { dailySetup, shareLine, todayUtc } from './daily';

const dates = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

describe('daily challenge', () => {
  it('gives the same setup for the same date', () => {
    expect(dailySetup('2026-11-07')).toEqual(dailySetup('2026-11-07'));
  });

  it('gives a different seed on each date and varies the scenario', () => {
    const setups = dates.map(dailySetup);
    expect(new Set(setups.map((x) => x.seed)).size).toBe(dates.length);
    expect(new Set(setups.map((x) => x.scenarioId)).size).toBeGreaterThan(1);
  });

  it('reads the UTC date', () => {
    expect(todayUtc(new Date('2026-11-07T23:30:00Z'))).toBe('2026-11-07');
  });

  it('writes a one-line result for an ending and for a bankruptcy', () => {
    const s = createInitialState(9, 'T', { scenarioId: 'garage', difficulty: 'founder', sandbox: false, skipTutorial: true, startYear: 2017, daily: '2026-11-07' });
    s.stats.peakValuation = 4.2e9;
    s.ending = { id: 'safe_launch', day: 100, score: 1234, by: 'player' };
    const place = `${scenarioById('garage').name} · ${difficultyDef('founder').name}`;
    expect(shareLine(s)).toBe(`LLM Lets Loose Money · daily 2026-11-07 · ${place} · score 1234 · peak $4.2B`);

    delete s.ending;
    s.gameOver = { reason: 'Ran out of money', day: 50 };
    expect(shareLine(s)).toContain('· bankrupt · peak $4.2B');
  });
});
