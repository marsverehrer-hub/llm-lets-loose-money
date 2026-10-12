// OWNER: SCENARIO. v9 new-game scenarios and difficulty (GAME_DESIGN §20.1). Logic lives in systems/scenario.ts.
// Goal checks read existing state only. Every field that a scenario leaves out keeps today's default.
import type { DifficultyId, DoctrineId, GameState, Id, RoleId } from '../types';
import { BALANCE } from '../balance';
import { arenaLeaderboard } from '../systems/competitors';
import { annualRevenue } from '../systems/finance';
import { isResearched } from '../systems/research';
import { formatMoney } from '../util';

/** Flags the scenario goals read. Written by systems/scenario.ts and systems/contracts.ts. */
export const SCENARIO_FLAGS = {
  /** Cash taken in from data sales (added up daily by scenarioTick). */
  dataSales: 'scenario.dataSales',
  /** Government contracts signed (contracts.ts). */
  govContracts: 'govContracts',
} as const;

// ---------------------------------------------------------------------------
// Difficulty (§20.1 table). Each number is applied in one place per system.
// ---------------------------------------------------------------------------
export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  pitch: string;
  /** Multiplies the scenario's start cash. */
  startCash: number;
  /** Added to every rival release's base quality (points). Positive is harder. */
  rivalOffset: number;
  /** Multiplies every event weight (events.ts). */
  eventWeight: number;
  /** Multiplies the market TAM in every segment (market.ts). */
  marketGrowth: number;
  /** Multiplies the valuation a private round is priced at (finance.ts). */
  vcGenerosity: number;
  /** Multiplies the victory score. */
  scoreMult: number;
}

export const DIFFICULTIES: DifficultyDef[] = [
  {
    id: 'intern',
    name: 'Intern',
    pitch: 'Double the cash, soft rivals, quiet news, generous investors.',
    startCash: 2,
    rivalOffset: -4,
    eventWeight: 0.6,
    marketGrowth: 1.15,
    vcGenerosity: 1.3,
    scoreMult: 0.6,
  },
  {
    id: 'founder',
    name: 'Founder',
    pitch: 'The default. The game as it was designed.',
    startCash: 1,
    rivalOffset: 0,
    eventWeight: 1,
    marketGrowth: 1,
    vcGenerosity: 1,
    scoreMult: 1,
  },
  {
    id: 'unicorn',
    name: 'Unicorn hunter',
    pitch: 'Three quarters of the cash, sharper rivals, more drama, tougher investors.',
    startCash: 0.75,
    rivalOffset: 3,
    eventWeight: 1.3,
    marketGrowth: 0.95,
    vcGenerosity: 0.85,
    scoreMult: 1.5,
  },
  {
    id: 'doomer',
    name: 'Doomer',
    pitch: 'Half the cash, rivals who ship on time, and every event has an opinion.',
    startCash: 0.5,
    rivalOffset: 6,
    eventWeight: 1.6,
    marketGrowth: 0.9,
    vcGenerosity: 0.7,
    scoreMult: 2,
  },
];

export function difficultyDef(id: DifficultyId | undefined): DifficultyDef {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

// ---------------------------------------------------------------------------
// Scenario rules (read through scenarioRule in systems/scenario.ts). Missing = off / 1.
// ---------------------------------------------------------------------------
export interface ScenarioRules {
  /** No VC rounds ever: funding offers are never made. Loans still work. (finance.ts) */
  noVc?: boolean;
  /** Cannot list on the exchange. (finance.ts canIpo) */
  noIpo?: boolean;
  /** Every release ships open weights, and the lab doctrine is locked. (release.ts, doctrine.ts) */
  openOnly?: boolean;
  /** Pretraining is locked until this calendar year. (training.ts startTraining) */
  trainingLockedUntilYear?: number;
  /** Hiring costs this many times the normal recruiting fee. The hire is instant here, so the cost is the time. (staff.ts) */
  hireDaysMult?: number;
  /** Government grant, $ per month, paid daily while reputation is at least GRANT_MIN_REPUTATION. (scenarioTick) */
  grantPerMonth?: number;
  /** Research points multiplier. (research.ts) */
  communityResearch?: number;
  /** Event weight multipliers by event id, on top of the difficulty. (events.ts) */
  eventBoost?: Record<Id, number>;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
export interface GoalDef {
  id: Id;
  text: string;
  /** Last calendar year the goal can be met in. Missing = no deadline. */
  deadlineYear?: number;
  check: (s: GameState) => boolean;
  /** One line of progress for the Goals card. */
  progress: (s: GameState) => string;
}

/** Player's 1-based arena rank, or 0 when no released model of the player is on the board. */
export function playerRank(s: GameState): number {
  const idx = arenaLeaderboard(s).findIndex((r) => r.isPlayer);
  return idx < 0 ? 0 : idx + 1;
}

/** Crowns the player holds on models that were released as open weights. */
export function openCrownCount(s: GameState): number {
  let n = 0;
  for (const c of s.classes?.crowns ?? []) {
    if (c.holder !== 'player') continue;
    if (s.models.some((m) => m.name === c.modelName && m.releaseMode === 'open')) n += 1;
  }
  return n;
}

function rankText(s: GameState): string {
  const r = playerRank(s);
  return r > 0 ? `Arena #${r}` : 'No model on the arena yet';
}

const goalArena1: GoalDef = {
  id: 'arena_1',
  text: 'Reach arena number one',
  deadlineYear: 2026,
  check: (s) => playerRank(s) === 1,
  progress: rankText,
};

// ---------------------------------------------------------------------------
// Scenarios (§20.1). `startCash` is before the difficulty multiplier.
// ---------------------------------------------------------------------------
export interface ScenarioDef {
  id: Id;
  name: string;
  /** One line. */
  pitch: string;
  /** One paragraph, shown on Headquarters for mid-era starts. */
  briefing: string;
  startYear: number;
  startCash: number;
  /** Optional rebase values. Missing = keep today's defaults. */
  startValuation?: number;
  roundsRaised?: string[];
  staff?: Partial<Record<RoleId, number>>;
  brand?: number;
  /** Rented GPUs at start: GPU id -> count. Every GPU must be unlocked by startYear. */
  fleet?: Record<Id, number>;
  /** Lab doctrine at start. `lock` stops changes. */
  doctrine?: { start: DoctrineId; lock?: boolean };
  rules: ScenarioRules;
  goals: GoalDef[];
  /** Starter model for a mid-era start: evaluated, unreleased, about frontier minus 12 for the year. */
  starter?: { name: string; paramsB: number; tokensB: number };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'garage',
    name: 'Garage',
    pitch: 'The classic start. Two founders, eight rented GPUs and a garage that smells of cold brew.',
    briefing: '',
    startYear: 2017,
    startCash: BALANCE.START_CASH,
    rules: {},
    goals: [],
  },
  {
    id: 'late_2022',
    name: 'Late to the party',
    pitch: 'It is 2022. The chatbot already launched. Everyone else has a head start, so catch up.',
    briefing:
      'It is January 2022 and someone else already shipped the chatbot everyone can use. You have $40M, twelve people, the research from 2017 to 2021 finished, and one starter model that is good for its year. The rivals are where they would be by now. Take the top spot on the arena by 2026 before the press decides you are a footnote.',
    startYear: 2022,
    startCash: 40_000_000,
    startValuation: 120_000_000,
    roundsRaised: ['Pre-seed', 'Seed+'],
    staff: { researcher: 4, engineer: 5, safety: 1, sales: 1, marketing: 1 },
    brand: 20,
    fleet: { a100: 16, h100: 8 },
    rules: {},
    goals: [goalArena1],
    starter: { name: 'Hand-me-down 1', paramsB: 70, tokensB: 1400 },
  },
  {
    id: 'bootstrapped',
    name: 'Bootstrapped',
    pitch: 'No investors, no board, a credit line and a spreadsheet. Profit or bust.',
    briefing: '',
    startYear: 2017,
    startCash: BALANCE.START_CASH,
    rules: { noVc: true },
    goals: [
      {
        id: 'profit_2y',
        text: 'Be profitable within two years',
        deadlineYear: 2018,
        check: (s) => s.finance.dailyRevenue > 0 && s.finance.dailyRevenue > s.finance.dailyExpenses,
        progress: (s) => `Daily in ${formatMoney(s.finance.dailyRevenue)}, out ${formatMoney(s.finance.dailyExpenses)}`,
      },
      {
        id: 'rev_100m',
        text: '$100M revenue a year',
        deadlineYear: 2024,
        check: (s) => annualRevenue(s) >= 100_000_000,
        progress: (s) => `Run-rate ${formatMoney(annualRevenue(s))} of $100M`,
      },
    ],
  },
  {
    id: 'open_collective',
    name: 'Open-source collective',
    pitch: 'Every release ships its weights. The community is generous and reads the README.',
    briefing: '',
    startYear: 2017,
    startCash: BALANCE.START_CASH,
    doctrine: { start: 'open', lock: true },
    rules: { openOnly: true, communityResearch: 1.25 },
    goals: [
      {
        id: 'open_crowns',
        text: 'Hold 5 crowns with open models',
        check: (s) => openCrownCount(s) >= 5,
        progress: (s) => `${openCrownCount(s)} of 5 crowns on open models`,
      },
    ],
  },
  {
    id: 'sovereign',
    name: 'Sovereign AI',
    pitch: 'A ministry-funded lab. The grant has a steering committee and a flag.',
    briefing:
      'It is 2019 and a ministry has decided the country needs its own model. The grant pays $3M a month for as long as the lab keeps its reputation at 60 or above. You cannot list on an exchange, and the enterprise focus is yours from day one. Win three government contracts and reach the top three of the arena by 2026.',
    startYear: 2019,
    startCash: 10_000_000,
    startValuation: 60_000_000,
    roundsRaised: ['Pre-seed'],
    staff: { researcher: 3, engineer: 4, safety: 2, sales: 1 },
    brand: 30,
    fleet: { v1000: 16 },
    doctrine: { start: 'enterprise' },
    rules: { noIpo: true, grantPerMonth: 3_000_000 },
    goals: [
      {
        id: 'gov_3',
        text: 'Win 3 government contracts',
        check: (s) => (s.flags[SCENARIO_FLAGS.govContracts] ?? 0) >= 3,
        progress: (s) => `${Math.min(3, s.flags[SCENARIO_FLAGS.govContracts] ?? 0)} of 3 signed`,
      },
      {
        id: 'arena_top3',
        text: 'Reach the top 3 of the arena',
        deadlineYear: 2026,
        check: (s) => {
          const r = playerRank(s);
          return r > 0 && r <= 3;
        },
        progress: rankText,
      },
    ],
    starter: { name: 'Ministry Mk1', paramsB: 13, tokensB: 260 },
  },
  {
    id: 'big_tech_spinout',
    name: 'Big Tech spinout',
    pitch: 'Parent company money, sixty people, and a board that reviews everything.',
    briefing:
      'It is 2020 and your parent company has spun you out with $300M, sixty people and a board that meets every week. Hiring costs double, because the parent insists on its own recruiting firm, and the board reviews the company often. Reach a $1T valuation by 2032. The board will ask about the valuation at every meeting.',
    startYear: 2020,
    startCash: 300_000_000,
    startValuation: 3_000_000_000,
    roundsRaised: ['Pre-seed', 'Parent spin-off', 'Parent top-up'],
    staff: { researcher: 15, engineer: 25, safety: 5, sales: 8, marketing: 7 },
    brand: 40,
    fleet: { a100: 64 },
    rules: { hireDaysMult: 2, eventBoost: { board_coup: 4 } },
    goals: [
      {
        id: 'val_1t',
        text: 'Reach a $1T valuation',
        deadlineYear: 2032,
        check: (s) => s.finance.valuation >= 1_000_000_000_000,
        progress: (s) => `${formatMoney(s.finance.valuation)} of $1T`,
      },
    ],
    starter: { name: 'Parent Model 1', paramsB: 30, tokensB: 600 },
  },
  {
    id: 'data_broker',
    name: 'Data broker',
    pitch: 'You cannot train a model until 2020. You can sell the data everyone else trains on.',
    briefing:
      'It is 2018. Pretraining is locked until 2020, so you cannot train your own model yet. Collect, refine and sell data to the labs that can. Raise $50M from data sales by 2022, then reach the top five of the arena by 2026, once you are allowed to train.',
    startYear: 2018,
    startCash: 5_000_000,
    startValuation: 30_000_000,
    roundsRaised: ['Pre-seed'],
    staff: { engineer: 3, researcher: 2, sales: 1 },
    brand: 5,
    fleet: { v1000: 8 },
    rules: { trainingLockedUntilYear: 2020 },
    goals: [
      {
        id: 'sales_50m',
        text: '$50M from data sales',
        deadlineYear: 2022,
        check: (s) => (s.flags[SCENARIO_FLAGS.dataSales] ?? 0) >= 50_000_000,
        progress: (s) => `${formatMoney(s.flags[SCENARIO_FLAGS.dataSales] ?? 0)} of $50M sold`,
      },
      {
        id: 'arena_top5',
        text: 'Reach the top 5 of the arena',
        deadlineYear: 2026,
        check: (s) => {
          const r = playerRank(s);
          return r > 0 && r <= 5;
        },
        progress: rankText,
      },
    ],
    starter: { name: 'Scraped-1', paramsB: 1.5, tokensB: 30 },
  },
  {
    id: 'agi_speedrun',
    name: 'AGI speedrun',
    pitch: 'Hard. One capstone research node, one deadline, no sympathy.',
    briefing: '',
    startYear: 2017,
    startCash: BALANCE.START_CASH,
    rules: {},
    goals: [
      {
        id: 'agi',
        text: 'Research AGI (probably)',
        deadlineYear: 2031,
        check: (s) => isResearched(s, 'agi'),
        progress: (s) =>
          isResearched(s, 'agi')
            ? 'Done'
            : s.research.current === 'agi'
              ? `Researching, ${Math.floor(s.research.progress).toLocaleString('en-US')} of 1,000,000 RP`
              : 'Not started',
      },
    ],
  },
];

export function scenarioById(id: Id | undefined): ScenarioDef {
  return SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];
}
