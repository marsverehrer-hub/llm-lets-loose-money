import type { Competitor, GameSetup, GameState, RoleId, RoleState } from './types';
import { BALANCE } from './balance';
import { applyScenarioStart } from './systems/scenario'; // v9 scenario
import { GPUS } from './data/gpus';
import { DATASETS } from './data/datasets';
import { OFFICE_TIERS } from './data/roles';
import { COMPETITORS } from './data/competitors';

export const SAVE_VERSION = 4;

function role(count: number, skill = 1): RoleState {
  return { count, skill, salaryLevel: 1 };
}

/**
 * A new game. With no setup this is today's game (garage, founder, 2017). A setup (v9, GAME_DESIGN §20.1) applies a
 * scenario, difficulty, sandbox and skip-tutorial choice; mid-era starts fast-forward the world (systems/scenario.ts).
 */
export function createInitialState(
  seed = Math.floor(Math.random() * 2 ** 31),
  companyName = 'Lets Loose Labs',
  setup?: GameSetup,
): GameState {
  const s = baseState(seed, companyName);
  if (setup) applyScenarioStart(s, setup); // v9 scenario
  return s;
}

function baseState(seed: number, companyName: string): GameState {
  const starterGpu = GPUS.find((g) => g.unlockYear <= BALANCE.START_YEAR);
  const competitors: Competitor[] = COMPETITORS.map((c) => ({
    id: c.id,
    active: false,
    model: null,
    prices: { chat: 20, api: 30, enterprise: 60 },
    users: { consumer: 0, developer: 0, enterprise: 0 },
    brand: c.brand,
    valuation: 0,
    nextReleaseDay: 0,
    modelsReleased: 0,
  }));

  const roles: Record<RoleId, RoleState> = {
    researcher: role(2, 1.1), // the founders
    engineer: role(1),
    safety: role(0),
    sales: role(0),
    marketing: role(0),
  };

  return {
    saveVersion: SAVE_VERSION,
    seed,
    rngState: seed,
    day: 0,
    speed: 0,
    idCounter: 0,
    company: {
      name: companyName,
      brand: 2,
      hype: 5,
      reputation: 60,
      founderEquity: BALANCE.START_FOUNDER_EQUITY,
      isPublic: false,
      sharesOutstanding: 0,
      stockPrice: 0,
      officeTierId: OFFICE_TIERS[0]?.id ?? 'garage',
      safetyIncidents: 0,
    },
    finance: {
      cash: BALANCE.START_CASH,
      debt: 0,
      loanRatePerYear: BALANCE.LOAN_RATE_PER_YEAR,
      today: { revenue: {}, expenses: {} },
      dailyRevenue: 0,
      dailyExpenses: 0,
      revenueBreakdown: {},
      expenseBreakdown: {},
      valuation: 8_000_000,
      lastPostMoney: 8_000_000,
      roundsRaised: ['Pre-seed'],
      totalRaised: BALANCE.START_CASH,
      pendingOffer: null,
      nextOfferDay: 60,
      negativeCashDays: 0,
      history: [],
    },
    compute: {
      rented: starterGpu ? { [starterGpu.id]: 8 } : {},
      datacenters: [],
      trainingShare: 1, // v10: a derived mirror of the fleet split; no products yet, so every GPU is free for training
      priority: 'serving', // v10: fleet priority
      totalPflops: 0,
      trainingPflops: 0,
      inferencePflops: 0,
      inferenceUtilization: 0,
    },
    data: {
      owned: DATASETS.filter((d) => d.cost === 0 && d.unlockYear <= BALANCE.START_YEAR && !d.requiresResearch).map((d) => d.id),
    },
    research: { completed: [], current: null, progress: 0, pointsPerDay: 0 },
    staff: { roles, stars: [], morale: 80, nextStarDay: 60 },
    models: [],
    training: null,
    products: [],
    market: {
      aiHype: 10,
      segments: {
        consumer: { tam: 20_000_000, adoption: 0.005, refPrice: 20, playerUsers: 0 },
        developer: { tam: 200_000, adoption: 0.045, refPrice: 30, playerUsers: 0 },
        enterprise: { tam: 500_000, adoption: 0.005, refPrice: 60, playerUsers: 0 },
      },
      campaigns: [],
    },
    competitors,
    events: { pending: null, lastFired: {}, fired: [] },
    news: [],
    notifications: [],
    achievements: {},
    flags: {},
    stats: { totalRevenue: 0, peakValuation: 0, modelsTrained: 0, modelsReleased: 0, outageDays: 0, lawsuits: 0, bestElo: 0 },
    tutorialStep: 0,
    gameOver: null,
  };
}
