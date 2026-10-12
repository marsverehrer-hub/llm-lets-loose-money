// OWNER: data agent. Dataset achievements (GAME_DESIGN.md §14). The lead merges DATA_ACHIEVEMENTS into data/achievements.ts.
import type { AchievementDef, GameState } from '../types';
import { DATA_TUNING, dataStats, datasetById } from '../systems/data';
import { DATAOPS_TUNING, dataOpsSummary } from '../systems/dataOps';

export const DATA_ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'data_hoarder',
    name: 'Data Hoarder',
    description: 'Own 50 datasets at once. Storage costs are a problem for the next CFO.',
    icon: '🗄️',
    check: (s: GameState) => dataStats(s).owned >= 50,
  },
  {
    id: 'data_first_exclusive',
    name: 'Exclusive, Allegedly',
    description: 'Hold your first exclusive deal. Rivals now have a reason to be rude on social media.',
    icon: '🤝',
    check: (s: GameState) => s.data.owned.some((id) => datasetById(s, id)?.exclusive === true),
  },
  {
    id: 'data_quadrillion',
    name: 'A Quadrillion Tokens',
    description: 'Hold a quadrillion tokens of data in total. That is a lot of Wikipedia edits.',
    icon: '🌌',
    check: (s: GameState) => dataStats(s).totalTokensB >= 1_000_000,
  },
  {
    id: 'data_ouroboros',
    name: 'Ouroboros',
    description: 'Release a model trained entirely on synthetic data. It is eating its own tail, politely.',
    icon: '🐍',
    check: (s: GameState) =>
      s.models.some(
        (m) =>
          m.releasedDay !== null &&
          m.datasetIds.length > 0 &&
          m.datasetIds.every((id) => datasetById(s, id)?.kind === 'synthetic'),
      ),
  },
  {
    id: 'data_licensed_to_ill',
    name: 'Licensed to Ill',
    description: 'Hold five licences at the same time. Your finance team has a calendar of renewal dates.',
    icon: '📜',
    check: (s: GameState) => dataStats(s).licences >= 5,
  },
  {
    id: 'data_chat_harvester',
    name: 'Thanks for the Chats',
    description: 'Harvest 100B tokens from your users\' chats. The terms of service said "improve", and you did.',
    icon: '💬',
    hidden: true,
    check: (s: GameState) => (s.data.custom ?? []).some((c) => c.id === DATA_TUNING.USER_CHATS_ID && c.tokensB >= 100),
  },
  // GAME_DESIGN §20.2: data operations
  {
    id: 'dataops_spiderman',
    name: 'Spider-man',
    description: 'Crawl a trillion tokens of the open web. The robots.txt file has feelings too.',
    icon: 'crawl',
    check: (s: GameState) => dataOpsSummary(s).crawledB >= DATAOPS_TUNING.SPIDER_TOKENS_B,
  },
  {
    id: 'dataops_refined_taste',
    name: 'Refined taste',
    description: 'Refine five different sets. Deduplication is a lifestyle now.',
    icon: 'refine',
    check: (s: GameState) => dataOpsSummary(s).refinedSets >= DATAOPS_TUNING.REFINED_SETS_TARGET,
  },
  {
    id: 'dataops_broker',
    name: 'Broker',
    description: 'Sell $10M of data to rivals. Nobody asked where it came from, and nobody asked twice.',
    icon: 'sale',
    check: (s: GameState) => dataOpsSummary(s).soldTotal >= DATAOPS_TUNING.BROKER_REVENUE,
  },
  {
    id: 'dataops_strike_three',
    name: 'Strike three',
    description: 'Collect three cease and desist strikes. The lawyers now send you a card at Christmas.',
    icon: 'strike',
    check: (s: GameState) => dataOpsSummary(s).strikes >= DATAOPS_TUNING.STRIKES_TARGET,
  },
];
