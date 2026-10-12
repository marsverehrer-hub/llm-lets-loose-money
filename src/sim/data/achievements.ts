import type { AchievementDef, GameState } from '../types';
import { ROLE_IDS } from '../types';
import { calendarYear } from '../util';
import { arenaLeaderboard } from '../systems/competitors';
import { DATA_ACHIEVEMENTS } from './dataAchievements';
import { activeBenchmarks, playerBest, sotaCount } from '../systems/capabilities';
// OWNER: Agent C.

const headcount = (s: GameState) => ROLE_IDS.reduce((sum, id) => sum + s.staff.roles[id].count, 0);
const liveKind = (s: GameState, kind: 'chat' | 'api' | 'enterprise') =>
  s.products.some((p) => p.active && p.kind === kind);
const fired = (s: GameState, id: string) => s.events.fired.includes(id);
const annualRevenue = (s: GameState) => s.finance.dailyRevenue * 365;
const resolved = (s: GameState) => s.flags.eventsResolved ?? 0;

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- getting started -----------------------------------------------------
  {
    id: 'first_train',
    name: 'Training Wheels',
    icon: '🧪',
    description: 'Finish your first training run. It is not yet good, but it is finished.',
    check: (s) => s.stats.modelsTrained >= 1,
  },
  {
    id: 'first_release',
    name: 'Ship It',
    icon: '🚀',
    description: 'Release your first model. It works. Mostly.',
    check: (s) => s.models.some((m) => m.releasedDay !== null),
  },
  {
    id: 'first_revenue',
    name: 'Ka-Ching',
    icon: '💸',
    description: 'Earn your first dollar. Accounting has framed it.',
    check: (s) => s.stats.totalRevenue >= 1,
  },
  {
    id: 'first_product',
    name: 'Open for Business',
    icon: '🏪',
    description: 'Launch a product that people can actually pay for.',
    check: (s) => s.products.some((p) => p.active),
  },
  {
    id: 'chat_launch',
    name: 'It Talks Now',
    icon: '💬',
    description: 'Launch a chat product. Users immediately ask it about their feelings.',
    check: (s) => liveKind(s, 'chat'),
  },
  {
    id: 'enterprise_launch',
    name: 'Synergy Unlocked',
    icon: '💼',
    description: 'Launch an enterprise product. A synergy has been achieved in a slide.',
    check: (s) => liveKind(s, 'enterprise'),
  },
  {
    id: 'datacenter',
    name: 'Real Estate Ambitions',
    icon: '🏗️',
    description: 'Build a datacenter. The neighbors have questions.',
    check: (s) => s.compute.datacenters.length >= 1,
  },
  {
    id: 'first_star',
    name: 'Star Acquisition',
    icon: '⭐',
    description: 'Hire a star. The title on their business card is longer than the name.',
    check: (s) => s.staff.stars.some((x) => x.hiredDay !== null),
  },

  // ---- money ---------------------------------------------------------------
  {
    id: 'daily_100k',
    name: 'Daily Grind',
    icon: '☕',
    description: 'Earn $100k in a single day. The coffee machine is now a line item.',
    check: (s) => s.finance.dailyRevenue >= 100_000,
  },
  {
    id: 'arr_1m',
    name: 'Seven Figures of Vibes',
    icon: '📈',
    description: 'Reach $1M in annualised revenue. It recurs, probably.',
    check: (s) => annualRevenue(s) >= 1_000_000,
  },
  {
    id: 'arr_100m',
    name: 'Enterprise-Adjacent',
    icon: '🏢',
    description: 'Reach $100M in annualised revenue. Some of it is from enterprises.',
    check: (s) => annualRevenue(s) >= 100_000_000,
  },
  {
    id: 'valuation_1b',
    name: 'Unicorn Costume',
    icon: '🦄',
    description: 'Reach a $1B valuation. The costume is slightly itchy.',
    check: (s) => s.finance.valuation >= 1_000_000_000,
  },
  {
    id: 'valuation_10b',
    name: 'Decacorn Energy',
    icon: '🦕',
    description: 'Reach a $10B valuation. The dinosaur metaphor is now too small.',
    check: (s) => s.finance.valuation >= 10_000_000_000,
  },
  {
    id: 'valuation_1t',
    name: 'Trillion-Dollar Vibes',
    icon: '👑',
    description: 'Reach a $1T valuation. Nobody can explain it, and everyone agrees.',
    check: (s) => s.finance.valuation >= 1_000_000_000_000,
  },
  {
    id: 'second_round',
    name: 'Take Your First Real Check',
    icon: '🧾',
    description: 'Close a second funding round. The investors have started using your first name.',
    check: (s) => s.finance.roundsRaised.length >= 2,
  },
  {
    id: 'serial_series',
    name: 'Serial Series',
    icon: '🔁',
    description: 'Raise five funding rounds. The letters are running out.',
    check: (s) => s.finance.roundsRaised.length >= 5,
  },
  {
    id: 'sovereign',
    name: 'Sovereign Vibes',
    icon: '🏛️',
    description: 'Close the Sovereign Wealth Round. A nation is now your investor, and it is watching.',
    check: (s) => s.finance.roundsRaised.includes('Sovereign Wealth Round'),
    hidden: true,
  },
  {
    id: 'ipo',
    name: 'Ring the Bell',
    icon: '🔔',
    description: 'Go public. The bell was rung by an intern.',
    check: (s) => s.company.isPublic,
  },
  {
    id: 'stock_100',
    name: 'Shares Go Up Again',
    icon: '📊',
    description: 'Get the share price to $100. A chart with no Y-axis is now your favorite chart.',
    check: (s) => s.company.isPublic && s.company.stockPrice >= 100,
  },
  {
    id: 'short_seller_survived',
    name: 'Nice Try, Short Seller',
    icon: '🩳',
    description: 'Survive a short seller report while public. The bush photo has been retired.',
    check: (s) => s.company.isPublic && fired(s, 'short_seller'),
  },

  // ---- the arena, models and research ------------------------------------
  {
    id: 'arena_first',
    name: 'Number One, Number One',
    icon: '🥇',
    description: 'Take the #1 spot on the arena leaderboard.',
    check: (s) => arenaLeaderboard(s)[0]?.isPlayer === true,
  },
  {
    id: 'arena_dominance',
    name: 'Dunked On Everyone',
    icon: '🏆',
    description: 'Hold the #1 spot with at least a 100-point Elo lead over the next lab.',
    check: (s) => {
      const board = arenaLeaderboard(s);
      return board.length >= 2 && board[0].isPlayer && board[0].elo - board[1].elo >= 100;
    },
  },
  {
    id: 'models_10',
    name: 'Model Factory',
    icon: '🏭',
    description: 'Train ten models. The naming committee has been dissolved.',
    check: (s) => s.models.length >= 10,
  },
  {
    id: 'research_10',
    name: 'Syllabus Complete?',
    icon: '🔬',
    description: 'Complete ten research nodes. The syllabus has a footnote that says "more to come."',
    check: (s) => s.research.completed.length >= 10,
  },
  {
    id: 'agi',
    name: 'AGI (probably)',
    icon: '🧠',
    description: 'Complete the AGI research node. Probably.',
    check: (s) => s.research.completed.includes('agi'),
  },
  {
    id: 'small_but_mighty',
    name: 'Small But Mighty',
    icon: '🐭',
    description: 'Release a model under one billion parameters with an overall score of 50 or more.',
    check: (s) => s.models.some((m) => m.releasedDay !== null && m.paramsB < 1 && m.overall >= 50),
    hidden: true,
  },

  // ---- staff and office ----------------------------------------------------
  {
    id: 'staff_50',
    name: 'Now It Is a Company',
    icon: '👥',
    description: 'Reach 50 staff. Someone has created an HR channel.',
    check: (s) => headcount(s) >= 50,
  },
  {
    id: 'staff_500',
    name: 'Campus Life',
    icon: '🏙️',
    description: 'Reach 500 staff. The lunch line now has its own zip code.',
    check: (s) => headcount(s) >= 500,
  },

  // ---- trouble ----------------------------------------------------------------
  {
    id: 'outage',
    name: 'Down Again',
    icon: '🔥',
    description: 'Survive an outage. You survived. The status page did not.',
    check: (s) => s.stats.outageDays >= 1,
  },
  {
    id: 'lawsuit_1',
    name: 'Served',
    icon: '⚖️',
    description: 'Get sued for the first time. The envelope was very official.',
    check: (s) => s.stats.lawsuits >= 1,
  },
  {
    id: 'lawsuit_3',
    name: 'Discovery Phase',
    icon: '📜',
    description: 'Get sued three times. Your lawyers have learned to say "without prejudice" in their sleep.',
    check: (s) => s.stats.lawsuits >= 3,
  },
  {
    id: 'hype_90',
    name: 'Peak Hype',
    icon: '📣',
    description: 'Reach 90 hype. Your brand has its own weather.',
    check: (s) => s.company.hype >= 90,
  },
  {
    id: 'living_on_fumes',
    name: 'Living on Fumes',
    icon: '🫠',
    description: 'Run negative cash for five days and keep the lights on anyway.',
    check: (s) => s.finance.negativeCashDays >= 5,
    hidden: true,
  },

  // ---- events and hidden jokes -------------------------------------------------
  {
    id: 'decisive_leader',
    name: 'Decisive Leader',
    icon: '🗳️',
    description: 'Resolve ten decisions. You have not, however, read the fine print.',
    check: (s) => resolved(s) >= 10,
  },
  {
    id: 'ghost_in_machine',
    name: 'Ghost in the Machine?',
    icon: '🫧',
    description: 'Let your model claim it might be conscious. It was prompted to say that. Probably.',
    check: (s) => fired(s, 'model_consciousness'),
    hidden: true,
  },
  {
    id: 'citation_needed',
    name: 'Citation Needed',
    icon: '📎',
    description: 'Let your product invent case law. A judge noticed. Of the three cases, one now exists.',
    check: (s) => fired(s, 'hallucinated_brief'),
    hidden: true,
  },
  {
    id: 'open_source_closed_mind',
    name: 'Open Source, Closed Mind',
    icon: '🔓',
    description: 'Let an intern publish your weights. Then take credit for it, in a keynote.',
    check: (s) => fired(s, 'intern_leak'),
    hidden: true,
  },
  {
    id: 'any_percent',
    name: 'Any% Any Year',
    icon: '🏃',
    description: 'Complete four research nodes before 2020. Speedrunners are upset about the bugs.',
    check: (s) => calendarYear(s.day) <= 2019 && s.research.completed.length >= 4,
    hidden: true,
  },

  // ---- v2: capabilities, benchmarks, specialisations ---------------------------------------
  {
    id: 'first_sota',
    name: 'Number One, Briefly',
    icon: '🥇',
    description: 'Take the top spot on a headline benchmark. It will be saturated shortly.',
    check: (s) => (s.flags.sotaEver ?? 0) >= 1,
  },
  {
    id: 'sota_five',
    name: 'Five Leaderboards',
    icon: '🏆',
    description: 'Hold the top spot on five benchmarks at once. Each one has a different definition of "best".',
    check: (s) => sotaCount(s) >= 5,
  },
  {
    id: 'saturated',
    name: 'Nothing Left to Measure',
    icon: '🧱',
    description: 'Push one of your models past 97% of a benchmark ceiling. The benchmark is now a formality.',
    check: (s) => activeBenchmarks(s).some((def) => (playerBest(s, def.id) ?? -1) >= 0.97 * def.ceiling),
  },
  {
    id: 'first_finetune',
    name: 'Fine-Tuned, Not Finished',
    icon: '🎛️',
    description: 'Fine-tune a model into a specialisation. It now has a personality and a job title.',
    check: (s) => s.models.some((m) => !!m.parentId),
  },
  {
    id: 'three_generations',
    name: 'Three Generations Removed',
    icon: '🧬',
    description: 'Fine-tune a fine-tune of a fine-tune. The lineage now has its own org chart.',
    check: (s) => s.models.some((m) => (m.lineage?.length ?? 0) >= 3),
  },
  {
    id: 'distilled_mini',
    name: 'Small but Mighty (Again)',
    icon: '🐭',
    description: 'Distil a mini model. It runs on a potato and insists it is the flagship.',
    check: (s) => s.models.some((m) => m.specId === 'mini'),
  },
  {
    id: 'benchmaxxer',
    name: 'Teaching to the Test',
    icon: '📝',
    description: 'Train on the answer key and release anyway. The benchmark has sent a thank-you card.',
    check: (s) => s.models.some((m) => m.contaminated && m.releasedDay !== null),
    hidden: true,
  },
  {
    id: 'autonomous_swe',
    name: 'Autonomous, Allegedly',
    icon: '🤖',
    description: 'Reach Autonomous SWE. It has opened eleven pull requests and reviewed all of them.',
    check: (s) => s.models.some((m) => m.specId === 'autonomous_swe'),
  },

  // ---- deep training (GAME_DESIGN 13.2) -------------------------------------------------
  {
    id: 'first_incident',
    name: 'Adult Supervision',
    icon: '🧯',
    description: 'Survive your first run incident. The run is paused, the dashboard is red, and you chose correctly.',
    check: (s) => (s.flags['incidentsSurvived'] ?? 0) >= 1,
  },
  {
    id: 'yolo_run',
    name: 'YOLO Learning Rate',
    icon: '🎲',
    description: 'Train at a learning rate of 0.9 or more and finish without a single divergence. Somebody is very lucky.',
    check: (s) => s.flags['yoloClean'] === 1,
  },
  {
    id: 'quirk_collector',
    name: 'Cabinet of Curiosities',
    icon: '🗄️',
    description: 'Collect five different quirks across your models. Each one has a support ticket.',
    check: (s) => new Set(s.models.flatMap((m) => m.quirks ?? [])).size >= 5,
  },
  {
    id: 'early_stop_wsd',
    name: 'Good Enough, Stopped Early',
    icon: '⏹️',
    description: 'Stop a Warmup-Stable-Decay run early and keep most of the quality. Finance calls it efficiency.',
    check: (s) => s.flags['earlyStopWsd'] === 1,
  },
  {
    id: 'fp4_run',
    name: 'Four Bits Is Plenty',
    icon: '🔢',
    description: 'Finish a model trained in FP4. The weights are fine. The weights are fine.',
    check: (s) => s.models.some((m) => m.config?.precision === 'fp4'),
  },
];

// v3 data-market content lives in its own file; merged here so the systems see one list.
ACHIEVEMENTS.push(...DATA_ACHIEVEMENTS);
