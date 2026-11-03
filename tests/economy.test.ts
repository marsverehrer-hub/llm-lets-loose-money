import { CHAT_MOMENT_MIN_OVERALL } from '../src/sim/systems/market';
import { describe, it, expect, vi } from 'vitest';

// Compute is owned by another agent and may still return 0 capacity. Give the fleet plenty of headroom here
// so the economy tests exercise products and market logic on their own.
vi.mock('../src/sim/systems/compute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/systems/compute')>();
  return { ...actual, inferenceCapacityMtok: () => 5e9 };
});

import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import { frontierQuality } from '../src/sim/systems/competitors';
import type { GameState, Model } from '../src/sim/types';

function releasedModel(overall = 60): Model {
  return {
    id: 'm1',
    name: 'Test-1',
    paramsB: 7,
    tokensB: 300,
    datasetIds: [],
    techniques: [],
    finalLoss: 2.1,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + overall * 8,
    trainedDay: 0,
    releasedDay: 0,
    deprecated: false,
  };
}

describe('products and market', () => {
  it('an API product earns revenue and gathers users over 60 days', () => {
    const s = createInitialState(42, 'Test Labs');
    s.models.push(releasedModel());
    dispatch(s, { type: 'launchProduct', kind: 'api', name: 'Test API', modelId: 'm1', price: 30 });
    expect(s.products).toHaveLength(1);

    for (let i = 0; i < 60; i++) tick(s);

    const p = s.products[0];
    expect(p.users).toBeGreaterThan(0);
    expect(s.stats.totalRevenue).toBeGreaterThan(0);
    expect(p.revenuePerDay).toBeGreaterThan(0);
    expect(p.mtokPerDay).toBeGreaterThan(0);
  });

  it('chat stays locked until instruction_tuning is researched, then fires the ChatMoment', () => {
    const s = createInitialState(42);
    s.models.push(releasedModel());
    dispatch(s, { type: 'launchProduct', kind: 'chat', name: 'Chat', modelId: 'm1', price: 20 });
    expect(s.products).toHaveLength(0);
    expect('chatMoment' in s.flags).toBe(false);

    s.research.completed.push('instruction_tuning');
    // v16: a weak chatbot is a hobbyist toy and does not start the mass market...
    s.models[0].overall = CHAT_MOMENT_MIN_OVERALL - 1;
    dispatch(s, { type: 'launchProduct', kind: 'chat', name: 'Chat', modelId: 'm1', price: 20 });
    expect(s.products).toHaveLength(1);
    expect('chatMoment' in s.flags).toBe(false);
    // ...a good one does.
    dispatch(s, { type: 'shutdownProduct', productId: s.products[0].id });
    s.models[0].overall = CHAT_MOMENT_MIN_OVERALL;
    dispatch(s, { type: 'launchProduct', kind: 'chat', name: 'Chat', modelId: 'm1', price: 20 });
    expect('chatMoment' in s.flags).toBe(true);
  });

  it('labs founded before 2017 ship a first model on day one', () => {
    const s = createInitialState(3);
    tick(s);
    const openaye = s.competitors.find((c) => c.id === 'openaye');
    expect(openaye?.active).toBe(true);
    expect(openaye?.model).not.toBeNull();
  });
});

describe('finance', () => {
  it('goes bankrupt after 30 consecutive negative-cash days', () => {
    const s: GameState = createInitialState(7);
    s.finance.cash = -5_000_000;
    for (let i = 0; i < 29; i++) tick(s);
    expect(s.gameOver).toBeNull();
    tick(s);
    expect(s.gameOver).not.toBeNull();
    expect(s.gameOver?.reason).toMatch(/cash/i);
  });

  it('accepting a funding offer dilutes founder equity by pre / (pre + amount)', () => {
    const s = createInitialState(1);
    const cash0 = s.finance.cash;
    s.finance.pendingOffer = {
      roundName: 'Seed+',
      amount: 1_000_000,
      preMoney: 9_000_000,
      investor: 'Sequoya Capital',
      expiresDay: 30,
    };
    dispatch(s, { type: 'acceptOffer' });
    expect(s.company.founderEquity).toBeCloseTo(0.9, 6);
    expect(s.finance.cash).toBeCloseTo(cash0 + 1_000_000, 2);
    expect(s.finance.pendingOffer).toBeNull();
  });
});

describe('frontier curve', () => {
  it('frontierQuality is monotonic and stays below 100', () => {
    let prev = -Infinity;
    for (let y = 2010; y <= 2060; y += 0.1) {
      const f = frontierQuality(y);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(frontierQuality(2060)).toBeLessThan(100);
    // v7 (GAME_DESIGN §18.1): the 2017 anchor was lifted from 22 so a competent player is near the frontier early on.
    expect(frontierQuality(2017)).toBe(30);
    expect(frontierQuality(2017.5)).toBe(50);
  });
});

describe('v17.2 pitching investors', () => {
  it('brings a term sheet forward, then waits out the cooldown', async () => {
    const { PITCH_TUNING, pitchReadiness } = await import('../src/sim/systems/finance');
    const s = createInitialState(9, 'Pitch');
    expect(pitchReadiness(s).ok).toBe(true);
    dispatch(s, { type: 'pitchInvestors' });
    expect(s.finance.pendingOffer).not.toBeNull();
    expect(pitchReadiness(s).ok).toBe(false); // an offer is on the table
    dispatch(s, { type: 'declineOffer' });
    expect(pitchReadiness(s).daysLeft).toBe(PITCH_TUNING.COOLDOWN_DAYS);
    dispatch(s, { type: 'pitchInvestors' });
    expect(s.finance.pendingOffer).toBeNull();
    s.day += PITCH_TUNING.COOLDOWN_DAYS;
    dispatch(s, { type: 'pitchInvestors' });
    expect(s.finance.pendingOffer).not.toBeNull();
  });
});

describe('v17.3 launch spike', () => {
  it('a fresh product grows much faster in its first weeks than one without the boost', () => {
    const run = (boost: boolean) => {
      const s = createInitialState(42, 'Spike');
      s.day = 365; // 2018: a real developer market
      s.models.push(releasedModel());
      dispatch(s, { type: 'launchProduct', kind: 'api', name: 'API', modelId: 'm1', price: 25 });
      if (!boost) s.products[0].boostUntil = s.day;
      for (let i = 0; i < 30; i++) {
        s.events.pending = null;
        tick(s);
      }
      return s.products[0].users;
    };
    const boosted = run(true);
    const flat = run(false);
    expect(boosted).toBeGreaterThan(1.8 * flat);
    expect(boosted).toBeGreaterThan(0);
  });
});
