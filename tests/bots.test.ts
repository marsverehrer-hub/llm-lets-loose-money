// Scripted strategy bots (scripts/bot.ts): a short smoke run per strategy, the actions each playstyle must take, the
// size rules of the small class, and the event policy (never a risky option when the worst case takes cash below zero).
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import { classThresholds } from '../src/sim/data/weightClasses';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { effParamsFor } from '../src/sim/systems/trainingMath';
import { calendarYear } from '../src/sim/util';
import { botDay, BOT_STRATEGIES, eventChoiceOrder, eventOptionRisks, type BotStrategy } from '../scripts/bot';

const DOCTRINE: Record<BotStrategy, string> = { frontier: 'frontier', small: 'efficient', specialist: 'specialist', open: 'open' };

/** Plays the strategy for `days` sim days. Returns how many ticks did not advance the sim (blocked by a prompt). */
function play(s: GameState, strategy: BotStrategy, days: number): number {
  let blocked = 0;
  for (let i = 0; i < days && !s.gameOver; i++) {
    const before = s.day;
    botDay(s, false, strategy);
    tick(s);
    if (s.day === before) blocked += 1;
  }
  return blocked;
}

const TWO_YEARS = 2 * 365;

describe('bot strategies: two-year smoke run (seed 11)', () => {
  for (const strategy of BOT_STRATEGIES) {
    it(`${strategy} plays two years without being blocked and sets its doctrine`, () => {
      const s = createInitialState(11, 'SmokeCo');
      const blocked = play(s, strategy, TWO_YEARS);
      expect(blocked).toBe(0);
      expect(s.day).toBeGreaterThanOrEqual(TWO_YEARS);
      expect(s.company.doctrine).toBe(DOCTRINE[strategy]);
      expect(s.models.some((m) => m.releasedDay !== null)).toBe(true);
    });
  }

  it('idle answers prompts only: no models, products or research', () => {
    const s = createInitialState(11, 'IdleCo');
    for (let i = 0; i < 365; i++) {
      botDay(s, true);
      tick(s);
    }
    expect(s.models.length).toBe(0);
    expect(s.products.length).toBe(0);
    expect(s.company.doctrine).toBeUndefined();
  });
});

describe('strategy-specific actions', () => {
  it('small launches two api lines: the main line and a cheap Lite line', () => {
    const s = createInitialState(11, 'SmallCo');
    play(s, 'small', TWO_YEARS);
    const api = s.products.filter((p) => p.active && p.kind === 'api');
    expect(api.length).toBeGreaterThanOrEqual(2);
    const [main, lite] = api;
    expect(lite.name).toMatch(/Lite/);
    // The Lite line is priced well under the main line (about 0.4x the reference price).
    expect(lite.price).toBeLessThan(main.price * 0.6);
  });

  it('small never pretrains above the small class, and overtrains where the data allows', () => {
    const s = createInitialState(11, 'SmallCo');
    play(s, 'small', TWO_YEARS);
    const pretrains = s.models.filter((m) => !m.parentId && !m.derivedFrom);
    expect(pretrains.length).toBeGreaterThan(0);
    for (const m of pretrains) {
      const year = calendarYear(m.trainedDay);
      expect(m.activeParamsB ?? m.paramsB).toBeLessThanOrEqual(classThresholds(year).small * 1.001);
    }
    // Overtrained: at least one pretrain sees about 40 tokens per effective parameter (the data allows it in this run).
    const ratio = (m: (typeof pretrains)[number]) => m.tokensB / effParamsFor(m.paramsB, m.config ?? defaultConfig(s));
    expect(pretrains.some((m) => ratio(m) >= 39)).toBe(true);
  });

  it('small bids on contracts its models qualify for', () => {
    const s = createInitialState(11, 'SmallCo');
    play(s, 'small', TWO_YEARS);
    const outcomes = (s.contracts?.history ?? []).map((h) => h.outcome);
    expect(outcomes.some((o) => o === 'won' || o === 'lost' || o === 'completed')).toBe(true);
  });

  it('specialist fine-tunes its released bases into specs', () => {
    const s = createInitialState(11, 'SpecCo');
    play(s, 'specialist', TWO_YEARS);
    const finetunes = s.models.filter((m) => m.parentId && m.specId);
    expect(finetunes.length).toBeGreaterThan(0);
  });

  it('open releases every model in open mode and runs api and enterprise lines only', () => {
    const s = createInitialState(11, 'OpenCo');
    play(s, 'open', TWO_YEARS);
    const released = s.models.filter((m) => m.releasedDay !== null);
    expect(released.length).toBeGreaterThan(0);
    expect(released.every((m) => m.releaseMode === 'open')).toBe(true);
    const kinds = new Set(s.products.filter((p) => p.active).map((p) => p.kind));
    expect(kinds.has('chat')).toBe(false);
  });
});

describe('event policy', () => {
  /** A state with the day-30 "Scraped Site Sues" event waiting for a decision at the given cash. */
  function sueState(cash: number): GameState {
    const s = createInitialState(7, 'SueCo');
    s.day = 31;
    s.events.pending = { defId: 'data_scraped_site_sues', day: 30 };
    s.finance.cash = cash;
    return s;
  }

  // The settlement scales with valuation. Losing in court is capped at half of cash, so even the worst case
  // leaves the company solvent, and the bot should still prefer the free option when cash is thin.
  it('a lost court fight is capped so the worst case keeps cash above zero', () => {
    const s = sueState(200_000);
    const risks = eventOptionRisks(s);
    const fight = risks.find((r) => r.index === 1)!;
    expect(fight.worstCash).toBeGreaterThanOrEqual(0);
    expect(eventChoiceOrder(s)[0]).not.toBe(1);
  });

  it('settles when it can afford the settlement and the loss is covered', () => {
    const s = sueState(5_000_000);
    expect(eventChoiceOrder(s)[0]).toBe(0);
  });

  it('a whole day of play with the suit pending keeps cash above zero', () => {
    const s = sueState(200_000);
    botDay(s, false, 'frontier');
    expect(s.events.pending).toBeNull();
    expect(s.finance.cash).toBeGreaterThanOrEqual(0);
  });
});
