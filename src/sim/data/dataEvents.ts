// OWNER: data agent. Dataset events (GAME_DESIGN.md §14). The lead merges DATA_EVENTS into data/events.ts.
// Hints are tangible only (money, datasets, staff, time). Results are narrative: no stat numbers, no percent signs.
// Money scales with company size and is drawn from rng, so no two lawsuits cost the same.
import type { EventDef, GameState, Rng } from '../types';
import { DATASETS } from './datasets';
import { COMPETITORS } from './competitors';
import { MP_RIVAL_ID } from '../types';
import { calendarYear, clamp, addExpense, addRevenue, formatMoney, pushNews } from '../util';
import { DATA_TUNING, datasetById, dataStats } from '../systems/data';
import { labInfo, labName } from '../systems/labs';
import { capAtCash, scaledCost, spreadCost } from './eventKit';
import {
  DATAOPS_TUNING,
  acquireStartup,
  applyTosStrike,
  archiveClaimTarget,
  archiveFightLossCost,
  archiveSetId,
  archiveSettleCost,
  closeStartupOffer,
  dropOwned,
  markArchiveClaimed,
  startupAskPrice,
} from '../systems/dataOps';

/** Scraped-site settlement scales with the company: what a garage pays at the start, much more once worth billions. */
function scrapeSettlement(s: GameState): number {
  return scaledCost(s, 250_000);
}
/** What settling costs the player at most (the safest option never takes more than a quarter of cash). */
const scrapeSettleCap = (s: GameState): number => capAtCash(s, scrapeSettlement(s), 0.25);
/** What losing in court costs at most (never more than half of cash). */
const scrapeFightCap = (s: GameState): number => capAtCash(s, Math.round(scrapeSettlement(s) * 1.5), 0.5);

const HEAT = DATA_TUNING.PRIVACY_HEAT_KEY;
const EVENT_LABS = COMPETITORS.map((c) => c.id);

/** A twist branch: roughly one roll in seven goes somewhere unexpected. */
const twist = (rng: Rng, p = 0.15): boolean => rng.chance(p);
/** Safest option money: random spread around the scaled base, capped at a quarter of cash. */
const safePay = (s: GameState, rng: Rng, base: number): number => capAtCash(s, spreadCost(s, rng, base), 0.25);
/** Any other money: random spread around the scaled base, capped at half of cash. */
const pay = (s: GameState, rng: Rng, base: number): number => capAtCash(s, spreadCost(s, rng, base), 0.5);
/** What a hint promises: the scaled base, capped the same way as the effect. */
const aboutCost = (s: GameState, base: number, share = 0.5): string =>
  `about ${formatMoney(capAtCash(s, scaledCost(s, base), share))}`;

function ownedDefs(s: GameState) {
  return s.data.owned.map((id) => datasetById(s, id)).filter((d) => !!d);
}

function hasOwnedKind(s: GameState, kind: 'books' | 'web' | 'dialogue' | 'code' | 'science' | 'multimodal' | 'synthetic') {
  return ownedDefs(s).some((d) => d!.kind === kind);
}

/** The owned scrape set with the highest legal risk, if any. */
function worstScrape(s: GameState) {
  return ownedDefs(s)
    .filter((d) => d!.acquisition === 'scrape' && d!.legalRisk >= 0.3)
    .sort((a, b) => b!.legalRisk - a!.legalRisk)[0];
}

function removeOwned(s: GameState, id: string): void {
  s.data.owned = s.data.owned.filter((x) => x !== id);
  if (s.data.licenses) delete s.data.licenses[id];
}

function revealOnce(s: GameState, id: string): void {
  s.flags[`revealed.${id}`] = s.day;
}

function rivalNameFor(s: GameState, datasetId: string): string {
  // Multiplayer: a set the human rival signed is named after them, not after a contested AI lab.
  if (s.mp?.rival?.exclusives.includes(datasetId)) return labName(s, MP_RIVAL_ID);
  const d = DATASETS.find((x) => x.id === datasetId);
  const rivalId = d?.contestedBy?.find((r) => EVENT_LABS.includes(r));
  return (rivalId && labInfo(s, rivalId)?.name) || 'A rival lab';
}

/** Archive claim money: era-scaled by dataOps, capped here so the safest option stays safe. */
const archiveSettleCap = (s: GameState): number => capAtCash(s, archiveSettleCost(s), 0.25);
const archiveFightCap = (s: GameState): number => capAtCash(s, archiveFightLossCost(s), 0.5);

export const DATA_EVENTS: EventDef[] = [
  {
    id: 'data_publisher_coalition',
    title: 'The Publishers\' Coalition',
    icon: '📚',
    weight: (s) => (calendarYear(s.day) >= 2020 && hasOwnedKind(s, 'books') && !s.flags['data.coalitionSigned'] ? 2 : 0),
    cooldownDays: 180,
    once: true,
    body: () =>
      'Five publishers and one very polite trade body want a licence for "your use of our back catalogue". Their letter uses the word "partnership" nine times and "lawsuit" once, in a footnote.',
    choices: [
      {
        label: 'Sign the coalition letter',
        hint: (s) => `Costs ${aboutCost(s, 600_000, 0.25)}. Your data comes out a little cleaner for a year`,
        effect: (s, rng) => {
          addExpense(s, 'data', safePay(s, rng, 600_000));
          s.company.reputation = clamp(s.company.reputation + rng.int(2, 4), 0, 100);
          s.flags['data.coalitionSigned'] = s.day;
          if (twist(rng)) {
            s.flags['bonus.dataQuality'] = 1.04;
            s.flags['bonusUntil.dataQuality'] = s.day + 365;
            return 'The coalition signed, then sent over a cleaned-up index of their own back catalogue as a thank-you. Your lawyers keep the original letter in a drawer, and the index on a shelf.';
          }
          s.flags['bonus.dataQuality'] = 1.02;
          s.flags['bonusUntil.dataQuality'] = s.day + 365;
          return 'The coalition sends a framed copy of the letter. Your lawyers keep the original in a drawer.';
        },
      },
      {
        label: 'Keep scraping and hope nobody reads the footnote',
        hint: 'Costs nothing now. The legal risk stays where it was',
        effect: (s, rng) => {
          s.flags['data.coalitionIgnored'] = s.day;
          s.company.brand = clamp(s.company.brand - rng.int(0, 2), 0, 100);
          if (twist(rng)) {
            const fee = pay(s, rng, 80_000);
            addExpense(s, 'legal', fee);
            return 'The coalition adds you to a folder. The folder has a tab labelled "Later", and the tab has just sent a small invoice for administrative sighing.';
          }
          return 'The coalition adds you to a folder. The folder has a tab labelled "Later".';
        },
      },
      {
        label: 'Counter-offer at a tenth of the price',
        hint: (s) => `A gamble: a small deal for ${aboutCost(s, 150_000)}, or a lawsuit for ${aboutCost(s, 300_000)}`,
        effect: (s, rng: Rng) => {
          if (rng.chance(0.3)) {
            addExpense(s, 'data', pay(s, rng, 150_000));
            if (twist(rng)) {
              return 'They accepted, to everyone\'s surprise, including their own. Then they asked if you would like a sequel licence at the same price. The footnote is now a page.';
            }
            return 'They accepted, to everyone\'s surprise, including their own.';
          }
          addExpense(s, 'legal', pay(s, rng, 300_000));
          s.stats.lawsuits += 1;
          return 'They laughed, then filed. The filing has a table of contents.';
        },
      },
    ],
  },

  {
    id: 'data_scraped_site_sues',
    title: 'Scraped Site Sues',
    icon: '⚖️',
    // Lawyers wait until there is something worth suing for (not before day 90).
    weight: (s) => (s.day >= 90 && worstScrape(s) ? 4 : 0),
    cooldownDays: 90,
    body: (s) => {
      const d = worstScrape(s);
      return `${d ? d.name : 'A scraped site'} is suing. The complaint is 47 pages long and most of it is about one forum post from 2016. They will settle for about ${formatMoney(scrapeSettleCap(s))}. Losing in court would cost about ${formatMoney(scrapeFightCap(s))}.`;
    },
    choices: [
      {
        label: 'Settle quietly',
        hint: (s) => `Costs ${aboutCost(s, 250_000, 0.25)}. No lawsuit on the record`,
        effect: (s, rng) => {
          const fee = capAtCash(s, Math.round((scrapeSettlement(s) * rng.range(0.9, 1.2)) / 10_000) * 10_000, 0.25);
          addExpense(s, 'legal', fee);
          if (twist(rng)) {
            return 'The settlement is signed with a pen that has the company logo on it. The other side\'s lawyer was already on holiday and waved through the first draft. Nobody talks about it.';
          }
          return 'The settlement is signed with a pen that has the company logo on it. Nobody talks about it.';
        },
      },
      {
        label: 'Fight it in court',
        hint: (s) => `A gamble: a good press week, or a bill of about ${formatMoney(scrapeFightCap(s))} and the scraped set may be deleted`,
        effect: (s, rng) => {
          const d = worstScrape(s);
          if (rng.chance(0.6)) {
            const loss = capAtCash(s, Math.round(scrapeSettlement(s) * 1.5 * rng.range(0.8, 1.3)), 0.5);
            addExpense(s, 'legal', loss);
            s.stats.lawsuits += 1;
            if (twist(rng, 0.2)) {
              return `You lost, but the judge only fined you. ${d ? d.name : 'The dataset'} stays on the shelf, and the judge asked for a copy of your training run anyway.`;
            }
            if (d) removeOwned(s, d.id);
            return `You lost. ${d ? d.name : 'The dataset'} has been removed by court order, and the judge asked for a copy of your training run.`;
          }
          s.company.brand = clamp(s.company.brand + rng.int(1, 3), 0, 100);
          return 'You won on a technicality about the word "scrape". Press coverage is kind.';
        },
      },
      {
        label: 'Apologise and delete the set',
        hint: 'Deletes the scraped set. Costs nothing',
        effect: (s, rng) => {
          const d = worstScrape(s);
          if (d) removeOwned(s, d.id);
          s.company.reputation = clamp(s.company.reputation + rng.int(1, 3), 0, 100);
          s.company.brand = clamp(s.company.brand - rng.int(0, 2), 0, 100);
          if (twist(rng)) {
            s.company.brand = clamp(s.company.brand + 3, 0, 100);
            return `You apologised, and ${d ? d.name : 'the scrape'} is gone. The apology got more likes than the original post. Nobody has ever apologised this fast.`;
          }
          return `You apologised, and ${d ? d.name : 'the scrape'} is gone. The apology has a link to the robots.txt file.`;
        },
      },
    ],
  },

  {
    id: 'data_rival_steals_exclusive',
    title: 'A Rival Signs Your Deal',
    icon: '🤝',
    weight: (s) => ((s.data.lost ?? []).length > 0 ? 3 : 0),
    cooldownDays: 60,
    body: (s) => {
      const lostId = (s.data.lost ?? [])[(s.data.lost ?? []).length - 1];
      const d = DATASETS.find((x) => x.id === lostId);
      return `${rivalNameFor(s, lostId ?? '')} has signed the exclusive ${d?.name ?? 'deal'}. Their press release says "thrilled" four times.`;
    },
    choices: [
      {
        label: 'Sue for interference',
        hint: (s) => `Costs ${aboutCost(s, 300_000, 0.25)}. The judge may like your slides`,
        effect: (s, rng) => {
          const cost = safePay(s, rng, 300_000);
          addExpense(s, 'legal', cost);
          if (rng.chance(0.35)) {
            s.company.reputation = clamp(s.company.reputation + 1, 0, 100);
            if (twist(rng)) {
              addRevenue(s, 'other', Math.round(cost * rng.range(0.4, 0.9)));
              return 'The judge liked your slide deck and awarded costs. The rival now needs a new press release and a new budget line.';
            }
            return 'The judge liked your slide deck. The rival now needs a new press release.';
          }
          return 'The judge was on their sponsored list. Your slide deck is now a meme.';
        },
      },
      {
        label: 'Shrug and move on',
        hint: 'Costs nothing but a blog post',
        effect: (s, rng) => {
          if (twist(rng)) {
            s.company.brand = clamp(s.company.brand + 1, 0, 100);
            return 'Your comms team wrote a blog post called "Data Is A Journey". It is, against every expectation, a hit with people who run marathons.';
          }
          s.company.brand = clamp(s.company.brand - 1, 0, 100);
          return 'Your comms team is writing a blog post called "Data Is A Journey".';
        },
      },
      {
        label: 'Fish through the rival\'s leaked chats',
        hint: 'Reveals a secret dataset. Somebody may notice',
        available: (s) => !s.flags[`revealed.rival_chat_leak`],
        effect: (s, rng) => {
          revealOnce(s, 'rival_chat_leak');
          s.company.reputation = clamp(s.company.reputation - rng.int(2, 6), 0, 100);
          if (twist(rng)) {
            const fee = pay(s, rng, 100_000);
            addExpense(s, 'legal', fee);
            return 'You now have their lunch orders. Also their rival\'s lunch orders. Their lawyers have your lunch order too, and an invoice.';
          }
          return 'You now have their lunch orders. Also their rival\'s lunch orders.';
        },
      },
    ],
  },

  {
    id: 'data_labelers_union',
    title: 'The Labelers Unionise',
    icon: '✊',
    weight: (s) => (calendarYear(s.day) >= 2021 && (s.data.custom ?? []).some((c) => c.source === 'commission') ? 2 : 0),
    cooldownDays: 150,
    body: () =>
      'Your contract labelers have formed a union. Their first demand is a dental plan. Their second demand is a dental plan for the dental plan.',
    choices: [
      {
        label: 'Pay the living wage',
        hint: 'Commissions cost more for the rest of the game',
        effect: (s, rng) => {
          const lighter = twist(rng);
          s.flags['data.labourCostMult'] = (s.flags['data.labourCostMult'] ?? 1) * (lighter ? rng.range(1.1, 1.18) : rng.range(1.2, 1.4));
          s.staff.morale = clamp(s.staff.morale + rng.int(3, 7), 0, 100);
          if (lighter) {
            return 'The labelers accepted a slimmer raise in exchange for a longer dental plan. The dental plan now has a dental plan, and a smaller bill.';
          }
          return 'The labelers now have a dental plan. The dental plan now has a dental plan.';
        },
      },
      {
        label: 'Automate the labelling',
        hint: 'Commissions get cheaper. The union will talk',
        effect: (s, rng) => {
          s.flags['data.labourCostMult'] = (s.flags['data.labourCostMult'] ?? 1) * rng.range(0.7, 0.9);
          s.company.reputation = clamp(s.company.reputation - rng.int(2, 5), 0, 100);
          if (twist(rng)) {
            const fee = pay(s, rng, 60_000);
            addExpense(s, 'data', fee);
            return 'A model now labels the data for the models. It mislabelled a whole batch of cats as legal documents, and the cleanup was not free. The union has a newsletter.';
          }
          return 'A model now labels the data for the models. The union has noticed. The union has a newsletter.';
        },
      },
      {
        label: 'Ignore the union',
        hint: 'Costs nothing. They will remember',
        effect: (s, rng) => {
          if (twist(rng)) {
            return 'The labelers have created a group chat called "Remember The Dental Plan". Three weeks later they got bored of it. The group chat is now about sourdough.';
          }
          s.staff.morale = clamp(s.staff.morale - rng.int(2, 6), 0, 100);
          return 'The labelers have created a group chat called "Remember The Dental Plan".';
        },
      },
    ],
  },

  {
    id: 'data_synthetic_collapse',
    title: 'Your Corpus Is Eating Itself',
    icon: '🐍',
    weight: (s) => {
      if (s.flags['data.collapseFiltered']) return 0;
      const risky = (s.data.custom ?? []).some((c) => s.data.owned.includes(c.id) && c.kind === 'synthetic' && (c.collapseRisk ?? 0) > 0.5);
      return risky ? 3 : 0;
    },
    cooldownDays: 200,
    body: () =>
      'A researcher found that your generated corpus has started quoting itself. Then quoting the quoting. The footnotes now cite other footnotes.',
    choices: [
      {
        label: 'Filter harder',
        hint: (s) => `Costs ${aboutCost(s, 500_000, 0.25)}. Risky synthetic sets get cleaner`,
        effect: (s, rng) => {
          addExpense(s, 'data', safePay(s, rng, 500_000));
          const lucky = twist(rng);
          const risk = lucky ? rng.range(0.1, 0.18) : rng.range(0.18, 0.35);
          for (const c of s.data.custom ?? []) if (c.kind === 'synthetic' && (c.collapseRisk ?? 0) > 0.5) c.collapseRisk = risk;
          s.flags['data.collapseFiltered'] = s.day;
          if (lucky) {
            return 'The filter removed a large part of the corpus and almost all of the footnotes. What is left is eerily clean. The paragraphs are shorter, and so is the model\'s temper.';
          }
          return 'The filter removed a lot of the corpus and most of the footnotes. The paragraphs are shorter, and so is the model\'s temper.';
        },
      },
      {
        label: 'Ship it. Nobody will notice',
        hint: 'Costs nothing now. The news cycle could go either way',
        effect: (s, rng) => {
          s.company.reputation = clamp(s.company.reputation - rng.int(1, 3), 0, 100);
          s.flags['data.collapseFiltered'] = s.day;
          if (twist(rng)) {
            pushNews(s, 'Users say one of our models keeps answering with its own earlier answers, and they find it oddly charming.', 'good');
            return 'Shipped. Several users have noticed that the model says "as I said before" a lot, and have decided it is a personality.';
          }
          if (rng.chance(0.5)) pushNews(s, 'One of our models has started answering questions with its own previous answers. Investors are asking how.', 'bad');
          return 'Shipped. Several users have noticed that the model says "as I said before" a lot.';
        },
      },
      {
        label: 'Publish a paper called "On Self-Consumption"',
        hint: 'Costs nothing but pride',
        effect: (s, rng) => {
          s.flags['data.collapseFiltered'] = s.day;
          if (twist(rng)) {
            s.company.reputation = clamp(s.company.reputation - 2, 0, 100);
            return 'A reviewer ran the paper through a detector. The detector blushed. The paper has been withdrawn and re-submitted under a different title.';
          }
          s.company.brand = clamp(s.company.brand + rng.int(2, 4), 0, 100);
          s.company.reputation = clamp(s.company.reputation + 1, 0, 100);
          return 'The paper is cited by a paper that cites your paper. The loop is now a feature.';
        },
      },
    ],
  },

  {
    id: 'data_leaked_wiki',
    title: 'A Stranger With a Wiki',
    icon: '🕵️',
    weight: (s) => (calendarYear(s.day) >= 2024 && !s.flags['revealed.leaked_internal_wiki'] ? 2 : 0),
    cooldownDays: 365,
    once: true,
    body: () =>
      'A stranger in a grey hoodie offers the Leaked Internal Wiki. Page one says "Do Not Train On This". Page two is a carrot cake recipe. He wants cash, and he is looking at the door.',
    choices: [
      {
        label: 'Pay him and reveal the wiki',
        hint: (s) => `Costs ${aboutCost(s, 400_000, 0.25)}. Unlocks a very dangerous dataset`,
        effect: (s, rng) => {
          const haggled = twist(rng);
          const base = haggled ? 240_000 : 400_000;
          addExpense(s, 'data', safePay(s, rng, base));
          revealOnce(s, 'leaked_internal_wiki');
          s.company.reputation = clamp(s.company.reputation - rng.int(1, 4), 0, 100);
          if (haggled) {
            return 'He took less than he asked, because the door was very close. The wiki is now on the shop shelf, and so is a second carrot cake recipe. Your legal team has changed their email signature to "Gone".';
          }
          return 'The wiki is now on the shop shelf. Your legal team has changed their email signature to "Gone".';
        },
      },
      {
        label: 'Report him to the press',
        hint: 'Costs nothing. The hoodie will be famous',
        effect: (s, rng) => {
          if (twist(rng)) {
            s.company.brand = clamp(s.company.brand + 1, 0, 100);
            s.company.reputation = clamp(s.company.reputation - 1, 0, 100);
            return 'The stranger turned out to hold a press pass. The story is about you, and it is about the hoodie, and it is not kind about either.';
          }
          s.company.brand = clamp(s.company.brand + rng.int(3, 5), 0, 100);
          s.company.reputation = clamp(s.company.reputation + rng.int(2, 4), 0, 100);
          return 'The press runs the story with a photo of the hoodie. He is now a hoodie-shaped meme.';
        },
      },
      {
        label: 'Say no and go back to lunch',
        hint: 'Nothing happens',
        effect: (s, rng) => {
          if (twist(rng)) return 'He leaves, very slowly, and posts the carrot cake recipe on a forum. It does very well.';
          return 'He leaves, very slowly, as if the wiki might change its mind.';
        },
      },
    ],
  },

  {
    id: 'data_dead_forum_backup',
    title: 'A Backup of a Dead Forum',
    icon: '💾',
    weight: (s) => (calendarYear(s.day) >= 2022 && !s.flags['revealed.dead_forum_backup'] ? 2 : 0),
    cooldownDays: 365,
    once: true,
    body: () =>
      'A former moderator of a forum that closed in 2014 has a backup. It is 40 billion tokens of "does anyone else". He would like a modest payment and a public thank-you.',
    choices: [
      {
        label: 'Buy the backup',
        hint: (s) => `Costs ${aboutCost(s, 150_000, 0.25)}. Reveals the set`,
        effect: (s, rng) => {
          const bargain = twist(rng);
          addExpense(s, 'data', safePay(s, rng, bargain ? 90_000 : 150_000));
          revealOnce(s, 'dead_forum_backup');
          s.company.reputation = clamp(s.company.reputation - rng.int(1, 2), 0, 100);
          if (bargain) {
            return 'He took a lower price once you promised to spell his username right. The backup is in the shop, and the thank-you is in writing.';
          }
          return 'The backup is in the shop. The moderator has asked for the thank-you in writing.';
        },
      },
      {
        label: 'Ask if anyone consented',
        hint: 'Costs nothing. He will say something awkward',
        effect: (s, rng) => {
          s.company.brand = clamp(s.company.brand + rng.int(1, 2), 0, 100);
          return 'He looks at you like a dataset. He says "yes, probably", and you write that down.';
        },
      },
      {
        label: 'Decline',
        hint: 'Nothing happens',
        effect: (s, rng) => {
          if (twist(rng)) {
            s.company.brand = clamp(s.company.brand - 1, 0, 100);
            return 'The moderator posts about the meeting on a forum that does exist. The thread has 200 replies, all of which say "does anyone else".';
          }
          return 'The moderator returns to his forum, which no longer exists, and posts "does anyone else".';
        },
      },
    ],
  },

  {
    id: 'data_privacy_regulators',
    title: 'Regulators Read the Policy',
    icon: '🏛️',
    weight: (s) => ((s.flags[HEAT] ?? 0) >= 40 && s.data.userDataOptIn ? 4 : 0),
    cooldownDays: 120,
    body: (s) => {
      const chats = dataStats(s).userChatsTokensB;
      return `Regulators have read your privacy policy. They also read the part about "improving our services", and they have questions. You have ${chats.toLocaleString('en-US', { maximumFractionDigits: 1 })}B tokens of other people's chats.`;
    },
    choices: [
      {
        label: 'Publish a privacy dashboard',
        hint: (s) => `Costs ${aboutCost(s, 250_000, 0.25)}. Regulators cool off a lot`,
        effect: (s, rng) => {
          addExpense(s, 'legal', safePay(s, rng, 250_000));
          s.flags[HEAT] = clamp((s.flags[HEAT] ?? 0) - rng.int(30, 50), 0, DATA_TUNING.PRIVACY_HEAT_MAX);
          if (twist(rng)) {
            return 'The dashboard has a pie chart. The pie chart is mostly labelled "other". A regulator asked for the source file and then asked for a job.';
          }
          return 'The dashboard has a pie chart. The pie chart is mostly labelled "other".';
        },
      },
      {
        label: 'Turn off chat harvesting',
        hint: 'Stops new chats flowing into your data. The old ones stay',
        effect: (s, rng) => {
          s.data.userDataOptIn = false;
          s.flags[HEAT] = clamp((s.flags[HEAT] ?? 0) - rng.int(15, 25), 0, DATA_TUNING.PRIVACY_HEAT_MAX);
          if (twist(rng)) {
            s.flags[HEAT] = clamp((s.flags[HEAT] ?? 0) - 10, 0, DATA_TUNING.PRIVACY_HEAT_MAX);
            return 'Harvesting is off. The regulators sent a polite email that says "thank you", which nobody on the team has ever seen one do.';
          }
          return 'Harvesting is off. The gathered chats stay in the vault, like leftovers in the fridge.';
        },
      },
      {
        label: 'Say it is all anonymised',
        hint: 'A gamble: regulators may buy it, or not',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            s.company.reputation = clamp(s.company.reputation - rng.int(4, 8), 0, 100);
            s.flags[HEAT] = clamp((s.flags[HEAT] ?? 0) + rng.int(5, 15), 0, DATA_TUNING.PRIVACY_HEAT_MAX);
            if (twist(rng)) {
              addExpense(s, 'legal', pay(s, rng, 150_000));
              return 'It is not anonymised. It is pseudonymised. Regulators have a word for that, it is in capitals, and it comes with a fine.';
            }
            return 'It is not anonymised. It is pseudonymised. Regulators have a word for that, and it is in capitals.';
          }
          s.flags[HEAT] = clamp((s.flags[HEAT] ?? 0) - rng.int(3, 8), 0, DATA_TUNING.PRIVACY_HEAT_MAX);
          return 'Regulators accept it. For now. They have added a reminder to their calendar.';
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // GAME_DESIGN §20.2: data operations (systems/dataOps.ts). The flags these read are set by dataOpsTick.
  // ---------------------------------------------------------------------------

  {
    id: 'data_crawl_blocked',
    title: 'Blocked by Cloudflare-ish',
    icon: 'wall',
    weight: (s) => (s.dataOps?.blockPending ? 10 : 0),
    cooldownDays: 30,
    body: () =>
      `Your crawler has hit a wall of bot checks and a page that says "Just a moment". Crawl yield is halved for ${DATAOPS_TUNING.BLOCK_DAYS} days unless somebody makes the wall go away.`,
    choices: [
      {
        label: 'Rotate the proxies',
        hint: (s) => `Costs ${aboutCost(s, 250_000, 0.25)}. The block clears now`,
        effect: (s, rng) => {
          const cheap = twist(rng);
          addExpense(s, 'data', safePay(s, rng, cheap ? 120_000 : 250_000));
          if (s.dataOps) {
            s.dataOps.blockPending = false;
            s.dataOps.blockedUntil = 0;
          }
          if (cheap) {
            return 'The proxy vendor was running a sale, and the new proxies are in a country that has never heard of your company. The wall is now a gate.';
          }
          return 'The new proxies are in a country that has never heard of your company. The wall is now a gate.';
        },
      },
      {
        label: 'Go polite',
        hint: 'The crawler switches to polite. The block clears',
        effect: (s, rng) => {
          if (s.dataOps?.crawler) s.dataOps.crawler.policy = 'polite';
          if (s.dataOps) {
            s.dataOps.blockPending = false;
            s.dataOps.blockedUntil = 0;
          }
          if (twist(rng)) return 'The crawler now reads robots.txt out loud before each page. One site noticed, and sent a thank-you note with a cookie banner.';
          return 'The crawler now reads robots.txt out loud before each page. It has never been happier.';
        },
      },
      {
        label: 'Wait it out',
        hint: `Crawler yield is halved for up to ${DATAOPS_TUNING.BLOCK_DAYS} days`,
        effect: (s, rng) => {
          if (s.dataOps) {
            s.dataOps.blockPending = false;
            if (twist(rng) && s.dataOps.blockedUntil) {
              s.dataOps.blockedUntil = Math.min(s.dataOps.blockedUntil, s.day + rng.int(7, 20));
              return 'You wait. The wall waits too. Then the wall gets bored and falls over by itself, much earlier than anyone planned.';
            }
          }
          return 'You wait. The wall waits too. Both of you are very patient about it.';
        },
      },
    ],
  },

  {
    id: 'data_cease_and_desist',
    title: 'Cease and desist',
    icon: 'letter',
    weight: (s) => (s.dataOps?.tosPending ? 10 : 0),
    cooldownDays: 14,
    body: (s) =>
      `A rival lab's lawyers want to know why some of their model's answers are in your training data. This is strike ${(s.flags.tosStrikes ?? 0) + 1}. Every third strike goes to court.`,
    choices: [
      {
        label: 'Stop distilling for 90 days',
        hint: `A strike goes on your record. No distilling for ${DATAOPS_TUNING.DISTILL_BAN_DAYS} days`,
        effect: (s, rng) => {
          if (s.dataOps) s.dataOps.distillBannedUntil = s.day + DATAOPS_TUNING.DISTILL_BAN_DAYS;
          applyTosStrike(s);
          if (twist(rng)) return 'You have stopped copying other people\'s homework. The homework is still in the folder, and someone has started a second folder called "Reference".';
          return 'You have stopped copying other people\'s homework. The homework is still in the folder.';
        },
      },
      {
        label: 'Call their outputs inspiration',
        hint: 'A coin flip: no strike, or a strike',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            if (s.dataOps) {
              s.dataOps.tosPending = false;
              s.dataOps.tosExposure = 0;
            }
            if (twist(rng)) return 'The lawyers accept "inspiration". Their next letter is about a font, and the one after that is a Christmas card.';
            return 'The lawyers accept "inspiration". Their next letter is about a font.';
          }
          applyTosStrike(s);
          return '"Inspiration" was not a defence. It was a footnote, and the footnote lost.';
        },
      },
      {
        label: 'Ignore the letter',
        hint: 'A strike goes on your record. Nothing else changes',
        effect: (s, rng) => {
          if (twist(rng, 0.1)) {
            if (s.dataOps) {
              s.dataOps.tosPending = false;
              s.dataOps.tosExposure = 0;
            }
            return 'The letter is in a folder called "Later", in another folder. The lawyer who sent it changed jobs the next week, and nobody followed it up.';
          }
          applyTosStrike(s);
          return 'The letter is now in a folder called "Later". The folder is in another folder.';
        },
      },
    ],
  },

  {
    id: 'data_startup_bidding_war',
    title: 'Bidding war for a data startup',
    icon: 'war',
    weight: (s) => (s.dataOps?.startup?.war ? 8 : 0),
    cooldownDays: 30,
    body: (s) => {
      const offer = s.dataOps?.startup;
      if (!offer) return 'The startup has already changed hands.';
      const rival = offer.rivalId ? labName(s, offer.rivalId) : 'A rival lab';
      return `${rival} wants ${offer.name}, a ${offer.domain} data startup, and has offered more than you. Matching costs ${formatMoney(startupAskPrice(offer))}. Their letter says "synergy" four times.`;
    },
    choices: [
      {
        label: 'Match the bid',
        hint: (s) => {
          const offer = s.dataOps?.startup;
          return offer ? `Costs ${formatMoney(startupAskPrice(offer))} at the war premium. Two engineers join` : 'Two engineers join';
        },
        available: (s) => {
          const offer = s.dataOps?.startup;
          return !!offer && s.finance.cash >= startupAskPrice(offer);
        },
        effect: (s, rng) => {
          const offer = s.dataOps?.startup;
          if (!offer) return 'The startup has already changed hands.';
          const price = startupAskPrice(offer);
          addExpense(s, 'data', price);
          acquireStartup(s, offer, price);
          if (twist(rng)) {
            const rebate = Math.round(price * rng.range(0.04, 0.1));
            addRevenue(s, 'other', rebate);
            return 'You win. The founders send a thank-you card, signed by their lawyers, and a small rebate for the trouble of the bidding war.';
          }
          return 'You win. The founders send a thank-you card, signed by their lawyers.';
        },
      },
      {
        label: 'Let them have it',
        hint: 'Costs nothing. The rival gets the startup',
        effect: (s, rng) => {
          const offer = s.dataOps?.startup;
          if (offer) closeStartupOffer(s, 'rival');
          s.company.brand = clamp(s.company.brand - 1, 0, 100);
          if (twist(rng)) return 'Your comms team writes a blog post called "Some Startups Are Not Meant For Us". The rival\'s integration is already late.';
          return 'Your comms team writes a blog post called "Some Startups Are Not Meant For Us".';
        },
      },
    ],
  },

  {
    id: 'data_archive_copyright_claim',
    title: 'Copyright claim on an archive',
    icon: 'claim',
    weight: (s) => (archiveClaimTarget(s) ? 5 : 0),
    cooldownDays: 60,
    body: (s) => {
      const def = archiveClaimTarget(s);
      if (!def) return 'Nothing to claim. The estates are looking elsewhere.';
      return `The estates of the authors in ${def.name} want about ${formatMoney(archiveSettleCap(s))} to stop asking. Their lawyer's folder is labelled "Pulp". Removing the set costs nothing. Fighting it costs about ${formatMoney(archiveFightCap(s))} if you lose.`;
    },
    choices: [
      {
        label: 'Settle',
        hint: (s) => `Costs about ${formatMoney(archiveSettleCap(s))}. The set stays`,
        effect: (s, rng) => {
          const def = archiveClaimTarget(s);
          if (!def) return 'The claim has gone away.';
          const half = twist(rng);
          addExpense(s, 'legal', capAtCash(s, Math.round(archiveSettleCost(s) * rng.range(0.85, 1.2) * (half ? 0.5 : 1)), 0.25));
          markArchiveClaimed(s, def.id);
          if (half) return `${def.name} is settled for half the ask, once you offered the estates a sample of the index. They have each received a small, sincere cheque and a bookmark.`;
          return `${def.name} is settled. The estates have each received a small, sincere cheque.`;
        },
      },
      {
        label: 'Remove the set',
        hint: 'Costs nothing. The set leaves your shelf',
        effect: (s, rng) => {
          const def = archiveClaimTarget(s);
          if (!def) return 'The claim has gone away.';
          dropOwned(s, archiveSetId(def.id));
          markArchiveClaimed(s, def.id);
          s.company.reputation = clamp(s.company.reputation + rng.int(1, 2), 0, 100);
          if (twist(rng)) return `${def.name} is off the shelf. The estates asked for a written confirmation, and then for a signed copy of the confirmation.`;
          return `${def.name} is off the shelf. It is still in your memory, which the court cannot reach.`;
        },
      },
      {
        label: 'Fight it',
        hint: (s) => `A gamble: a good press week, or a bill of about ${formatMoney(archiveFightCap(s))} and the set goes`,
        effect: (s, rng) => {
          const def = archiveClaimTarget(s);
          if (!def) return 'The claim has gone away.';
          markArchiveClaimed(s, def.id);
          if (rng.chance(0.5)) {
            addExpense(s, 'legal', capAtCash(s, Math.round(archiveFightLossCost(s) * rng.range(0.8, 1.3)), 0.5));
            s.stats.lawsuits += 1;
            if (twist(rng)) {
              return `You lost, but the judge only fined you. ${def.name} stays on the shelf. The judge asked which pulp novel was the best.`;
            }
            dropOwned(s, archiveSetId(def.id));
            return `You lost. ${def.name} has been removed by court order. The judge asked which pulp novel was the best.`;
          }
          s.company.brand = clamp(s.company.brand + rng.int(2, 4), 0, 100);
          return 'You won on the word "archive". Press coverage calls it a victory for libraries.';
        },
      },
    ],
  },
];
