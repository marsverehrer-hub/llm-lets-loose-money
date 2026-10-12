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
    dispatch(s, { type: 'launchProduct', kind: 'chat', name: 'Chat', modelId: 'm1', price: 20 });
    expect(s.products).toHaveLength(1);
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
