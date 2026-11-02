// v17 lab chapters: one objective at a time, completed in order, paid in XP, and reachable by real play.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import { CHAPTERS, chapterIndex, chaptersTick, currentChapter } from '../src/sim/systems/chapters';
import { progressOf } from '../src/sim/systems/progression';
import { botDay } from '../scripts/bot';

describe('chapters', () => {
  it('a new lab starts on chapter one: train a model', () => {
    const s = createInitialState(1, 'Ch');
    expect(chapterIndex(s)).toBe(0);
    expect(currentChapter(s)?.id).toBe('first_run');
  });

  it('completes in order, several in one day when already met, and pays XP', () => {
    const s = createInitialState(2, 'Ch');
    s.models.push({ id: 'm1', name: 'M', releasedDay: 0 } as any);
    const xp0 = progressOf(s).xp;
    chaptersTick(s);
    expect(chapterIndex(s)).toBe(2); // first run (a model exists) and first release, not the round
    expect(currentChapter(s)?.id).toBe('first_round');
    expect(progressOf(s).xp).toBeGreaterThan(xp0);
    expect(s.notifications.some((n) => n.text.includes('Next: Raise a funding round'))).toBe(true);
  });

  it('the starting pre-seed does not count as raising a round; a closed round does', () => {
    const s = createInitialState(4, 'Ch');
    s.flags.chapter = 2;
    chaptersTick(s);
    expect(currentChapter(s)?.id).toBe('first_round');
    s.finance.roundLog = [{ name: 'Seed+', day: 1, amount: 1e6, postMoney: 9e6 }];
    chaptersTick(s);
    expect(chapterIndex(s)).toBeGreaterThan(2);
  });

  it('a later condition does not skip an unmet earlier chapter', () => {
    const s = createInitialState(3, 'Ch');
    s.finance.dailyRevenue = 2_000_000; // revenue chapters are met, but no model exists yet
    chaptersTick(s);
    expect(chapterIndex(s)).toBe(0);
  });

  it('the frontier bot gets through the opening chapters within six years', () => {
    const s = createInitialState(7, 'Bot');
    for (let i = 0; i < 6 * 365 * 2 && s.day < 6 * 365 && !s.gameOver; i++) {
      botDay(s, false, 'frontier');
      tick(s);
    }
    expect(chapterIndex(s)).toBeGreaterThanOrEqual(5);
    expect(chapterIndex(s)).toBeLessThanOrEqual(CHAPTERS.length);
  }, 60_000);
});

describe('the next move', () => {
  it('leads with the chapter, but a concrete move on the same screen wins', async () => {
    const { nextStep } = await import('../src/ui/panels/hq/nextStep');
    const s = createInitialState(1, 'Next');
    expect(nextStep(s).text).toBe('Start your first training run');
    s.models.push({ id: 'm', name: 'Alpha', releasedDay: null } as any);
    s.flags.chapter = 1;
    expect(nextStep(s).text).toBe('Release Alpha');
  });
});
