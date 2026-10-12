import type { EventDef, GameState, Rng } from '../types';
import { addExpense, addRevenue, clamp, formatMoney } from '../util';
import { datasetById } from '../systems/data';
import { quirkById } from './quirks';
import { GPUS } from './gpus';
import { OFFICE_TIERS } from './roles';
import { arenaLeaderboard } from '../systems/competitors';
import { DATA_EVENTS } from './dataEvents';
import { EVENTS_V2 } from './eventsV2';
import {
  GARAGE_ERA_END_DAY,
  acquireOffer,
  addBonus,
  anyLive,
  bestReleasedOverall,
  bump,
  capAtCash,
  cutStaff,
  earn,
  firstOfficeId,
  gpusOwnedOrRented,
  hasKind,
  hasReleasedModel,
  headcount,
  hurtSatisfaction,
  inGarageEra,
  liveChatModels,
  liveModels,
  liveProducts,
  maxVirality,
  minVirality,
  moveProductsOffSpec,
  morale,
  ownedLegalRisk,
  roundMoney,
  safeCost,
  scaleUsers,
  scaledCost,
  scandalWeight,
  spend,
  spreadCost,
  starterGpuId,
  topHiredStar,
  viralQuirk,
} from './eventKit';

// OWNER: Agent C. Choice events. Each choice's effect mutates state and returns the result line the player sees.
// Money goes through addExpense/addRevenue only. Temporary multipliers use flags: bonus.<key> + bonusUntil.<key>.

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

// Garage-era events: eligible from day 30 with no products, so the first choice lands early.
// Each fires once. Money effects stay small so the start of the game stays a game.

// ---------------------------------------------------------------------------
// local money helpers: every amount scales with company size (scaledCost) and stays capped by cash.
// ---------------------------------------------------------------------------

/** What a non-safest option spends: scaled with company size, never more than half of cash. */
const costOf = (s: GameState, base: number): number => capAtCash(s, scaledCost(s, base), 0.5);
/** A randomised spend for a non-safest option: scaled, spread, never more than half of cash. */
const spreadOf = (s: GameState, rng: Rng, base: number, lo = 0.7, hi = 1.4): number =>
  capAtCash(s, spreadCost(s, rng, base, lo, hi), 0.5);
/** A randomised spend for choice 0: scaled, spread, never more than a quarter of cash. */
const safeSpread = (s: GameState, rng: Rng, base: number, lo = 0.8, hi = 1.25): number =>
  capAtCash(s, spreadCost(s, rng, base, lo, hi));
/** Hint for a fixed, scaled cost. */
const costHint = (base: number, tail = '') => (s: GameState) => `Costs ${formatMoney(costOf(s, base))}${tail}`;
/** Hint for a randomised cost on a non-safest option. */
const aboutHint = (base: number, tail = '') => (s: GameState) => `Costs about ${formatMoney(costOf(s, base))}${tail}`;
/** Hint for the safest option, which is capped at a quarter of cash. */
const safeHint = (base: number, tail = '') => (s: GameState) => `Costs about ${formatMoney(safeCost(s, base))}${tail}`;
/** Hint for a payout. */
const paysHint = (base: number, tail = '') => (s: GameState) => `Pays about ${formatMoney(scaledCost(s, base))}${tail}`;
/** Randomised payout, scaled with company size. */
const payout = (s: GameState, rng: Rng, base: number, lo = 0.75, hi = 1.3): number => spreadCost(s, rng, base, lo, hi);

export const EVENTS: EventDef[] = [
  {
    id: 'landlord_hike',
    title: 'Your Landlord Has Read About AI',
    icon: '🏠',
    body: () =>
      'Dennis, who owns the garage, has seen a headline about AI and would like the rent to reflect "the value you are creating." He has asked for a one-time "value creation fee" in cash, and he is standing by the car.',
    weight: (s) => (inGarageEra(s) && s.company.officeTierId === firstOfficeId() ? 1 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Pay the fee and ask for a receipt',
        hint: safeHint(15_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 15_000, 0.85, 1.2);
          spend(s, fee);
          if (rng.chance(0.15)) {
            return `Dennis took ${formatMoney(fee)} and then billed you for the pizza box. It is the most official document in the building.`;
          }
          return `Dennis took ${formatMoney(fee)} and wrote the receipt on a pizza box. It is the most official document in the building.`;
        },
      },
      {
        label: 'Negotiate, with a whiteboard',
        hint: 'A gamble: could cost a few thousand, could cost nothing',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            return "Dennis was moved by the whiteboard. The rent stays the same, and he has asked to be cc'd on the next paper.";
          }
          const fee = spreadOf(s, rng, 5_000, 0.7, 1.4);
          spend(s, fee);
          morale(s, -rng.int(1, 3));
          return `The whiteboard had a diagram of "value." Dennis did not follow it and took ${formatMoney(fee)} in cash.`;
        },
      },
      {
        label: "Move the team to a friend's garage down the street",
        hint: aboutHint(2_000, ', and the team grumbles'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 2_000, 0.8, 1.3);
          spend(s, fee);
          morale(s, -rng.int(2, 5));
          if (rng.chance(0.15)) {
            return 'The new garage has a better door and no landlord. It also has no heat and a neighbour with a drum kit, which the team has named "character."';
          }
          return 'The new garage has a better door and no landlord. It also has no heat, which the team has named "character."';
        },
      },
    ],
  },

  {
    id: 'mom_invests',
    title: 'Mom Would Like to Invest',
    icon: '👩‍🍳',
    body: () =>
      'Your mom watched a video about AI on her tablet and would like to invest the $50,000 she was saving for a kitchen. Her term sheet is written on a placemat. She asks whether it is "standard."',
    weight: (s) => (inGarageEra(s) ? 1 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Take her money and give her a slice on the placemat',
        hint: paysHint(50_000, ', for a small slice of equity'),
        effect: (s, rng) => {
          // Financing: cash moves directly, like finance.ts does, and stays out of the daily ledger.
          const amount = payout(s, rng, 50_000, 0.8, 1.1);
          s.finance.cash += amount;
          s.finance.totalRaised += amount;
          s.company.founderEquity *= 0.98;
          if (rng.chance(0.15)) {
            return `Mom wired ${formatMoney(amount)} and added a clause giving her a lifetime supply of servers. The kitchen will have to wait.`;
          }
          return `The kitchen will have to wait. Mom wired ${formatMoney(amount)} and has asked for quarterly updates, with photos of the servers she thinks are ovens.`;
        },
      },
      {
        label: 'Buy her the kitchen instead',
        hint: aboutHint(12_000),
        effect: (s, rng) => {
          const price = spreadOf(s, rng, 12_000, 0.8, 1.4);
          spend(s, price);
          bump(s, 'reputation', rng.int(1, 3));
          morale(s, rng.int(1, 3));
          return `She has a new ${formatMoney(price)} kitchen and a new opinion of the company. She is still not sure what it does.`;
        },
      },
      {
        label: 'Give her a hoodie and call it an investment',
        hint: 'She wears it everywhere',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(1, 3));
          if (rng.chance(0.15)) {
            return 'She wore the hoodie to a book club. Someone from the book club is a venture partner, and has asked for a deck.';
          }
          return 'She wore the hoodie to the grocery store. Two people asked her what it is for.';
        },
      },
    ],
  },

  {
    id: 'hackathon_invite',
    title: 'A Hackathon Wants You to Speak',
    icon: '🍕',
    body: () =>
      'Three hundred students are spending a weekend at a hackathon sponsored by a pizza chain. They would like a founder to give a keynote, a model to judge the entries, and the garage to appear in the promo video as "a vibe."',
    weight: (s) => (inGarageEra(s) ? 1 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Give a four-minute talk',
        hint: safeHint(5_000, ', the room remembers you'),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 5_000, 0.8, 1.25);
          spend(s, fee);
          bump(s, 'brand', rng.int(2, 4));
          bump(s, 'hype', rng.int(1, 3));
          if (rng.chance(0.15)) {
            return 'You spoke for four minutes and a student recorded all of it. The clip is on a channel with 9 subscribers, 8 of whom are the student.';
          }
          return 'You spoke for four minutes. A student asked if you were the chatbot. You said "not yet," and got a standing ovation from the pizza.';
        },
      },
      {
        label: 'Send a sponsor check and a pizza',
        hint: aboutHint(2_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 2_000, 0.8, 1.4);
          spend(s, fee);
          bump(s, 'brand', rng.int(1, 2));
          return 'The pizza was excellent. The check was framed by the organizers, which is more than most sponsors get.';
        },
      },
      {
        label: 'Enter the hackathon yourself',
        hint: 'A gamble: could win a prize',
        effect: (s, rng) => {
          if (rng.chance(0.45)) {
            const prize = payout(s, rng, 12_000);
            earn(s, prize);
            bump(s, 'brand', rng.int(1, 3));
            return `Your team built a model that writes its own pitch deck and won the ${formatMoney(prize)} prize. The judges asked if it was for sale.`;
          }
          return 'Your team built a model that writes its own pitch deck. It was disqualified for being "too on the nose."';
        },
      },
    ],
  },

  {
    id: 'gpu_off_truck',
    title: 'A GPU Has Fallen Off a Truck',
    icon: '🚚',
    body: () =>
      'A delivery truck took a corner too fast on the 101. A single Pascal P-100ish is now in the bike lane, still blinking. The driver says it is "not stolen, just unsupervised."',
    weight: (s) => (inGarageEra(s) ? 1 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Buy it from the driver, no receipt',
        hint: (s) => `Costs about ${formatMoney(safeCost(s, 3_000))}, +1 rented GPU (you pay its rent)`,
        effect: (s, rng) => {
          const price = safeSpread(s, rng, 3_000, 0.8, 1.3);
          spend(s, price);
          const id = starterGpuId();
          s.compute.rented[id] = (s.compute.rented[id] ?? 0) + 1;
          if (rng.chance(0.15)) {
            return 'It works. It is a little warm, the serial number has been filed off, and the driver has thrown in a free heatsink "from the same truck."';
          }
          return 'It works. It is a little warm, and its serial number has been filed off by someone who was not sure what they were doing.';
        },
      },
      {
        label: 'Post a "found a GPU" thread',
        hint: 'Strangers get involved',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(2, 4));
          bump(s, 'hype', rng.int(1, 3));
          return 'The thread asks the owner to DM you. The owner has DMed you, and is asking for a "finder\'s fee" in exposure.';
        },
      },
      {
        label: 'Sell it on a forum',
        hint: paysHint(6_000),
        effect: (s, rng) => {
          const price = payout(s, rng, 6_000, 0.7, 1.3);
          earn(s, price);
          bump(s, 'reputation', -rng.int(2, 4));
          return `It sold for ${formatMoney(price)} within the hour. The buyer asked for a receipt, and you sent them the one from the pizza box.`;
        },
      },
    ],
  },

  {
    id: 'founder_thread',
    title: "Your Founder's Thread Is Going Semi-Viral",
    icon: '🧵',
    body: () =>
      'A 23-tweet thread titled "Why Transformers Will Eat Everything (Probably)" has been shared 4,000 times, mostly by people who did not finish it. You wrote it at 2am with a mild fever.',
    weight: (s) => (inGarageEra(s) ? 1 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Turn it into a 40-tweet series',
        hint: 'The fans multiply',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(4, 7));
          bump(s, 'brand', rng.int(1, 3));
          return 'Part 14 is titled "Actually, Scaling." It already has a fan account, and the fan account has opinions about Part 9.';
        },
      },
      {
        label: 'Reply to everyone, all night',
        hint: 'The team notices you are tired',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(4, 8));
          morale(s, -rng.int(2, 4));
          if (rng.chance(0.2)) {
            return 'You replied to 900 people. One of them was a recruiter, and one was a dog account that was also, somehow, right.';
          }
          return 'You replied to 900 people. Forty were investors, and one was a dog account that was also, somehow, right.';
        },
      },
      {
        label: 'Go to sleep',
        effect: (s, rng) => {
          bump(s, 'reputation', rng.int(1, 2));
          return 'The thread kept going without you. It is still going, and someone has translated it into a language you do not speak.';
        },
      },
    ],
  },

  {
    id: 'professor_interns',
    title: 'A Professor Would Like You to Hire Her Students',
    icon: '🎓',
    body: () =>
      'Professor Hal Brightwater has two students who "have read everything." They would like to intern in your garage for a semester. They have not asked about pay, and their resumes are printed on the back of a conference lanyard.',
    weight: (s) => (inGarageEra(s) ? 1 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Take both, with a stipend fund',
        hint: safeHint(20_000, ', speeds up current research'),
        effect: (s, rng) => {
          const fund = safeSpread(s, rng, 20_000, 0.85, 1.2);
          spend(s, fund);
          if (s.research.current) {
            s.research.progress += rng.int(20, 40);
            return 'They read every paper on the list, then the list of papers those papers cite. Your current research is noticeably closer to done.';
          }
          return 'They read every paper on the list. Nothing was in progress, so they started a reading group, which has been a success.';
        },
      },
      {
        label: 'Give them a LinkedIn endorsement instead',
        hint: 'Costs nothing but your dignity',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(1, 3));
          return 'The endorsement reads "brilliant, curious, and extremely into the vibe." Both students have put it on their résumés.';
        },
      },
      {
        label: 'Hire one as an engineer',
        hint: '1 engineer joins (their salary applies)',
        effect: (s, rng) => {
          s.staff.roles.engineer.count += 1;
          if (rng.chance(0.15)) {
            return 'The student is now an engineer. Their first task was to explain the garage\'s heating system to the heating system, and the heating system listened.';
          }
          return "The student is now an engineer. Their first task was to explain the garage's heating system to the heating system.";
        },
      },
    ],
  },

  {
    id: 'authors_lawsuit',
    title: 'The Authors Would Like a Word',
    icon: '📚',
    body: () =>
      'A coalition of 4,112 novelists has sued. Their lawyer says the training data "contains our entire life\'s work, including the sad lighthouse one." Discovery begins Monday.',
    weight: (s) => {
      const risk = ownedLegalRisk(s);
      // PII scrubbing in the latest model's run sheet blunts the suit (pii_scrub lowers the lawsuit weight).
      const latest = s.models[s.models.length - 1];
      const piiShield = latest?.config?.filters.includes('pii_scrub') ? 0.6 : 1;
      return risk >= 0.2 && s.day > 700 ? (0.5 + risk * 4) * piiShield : 0;
    },
    cooldownDays: 150,
    choices: [
      {
        label: 'Settle quietly',
        hint: safeHint(3_000_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 3_000_000, 0.85, 1.2);
          spend(s, fee);
          bump(s, 'brand', -rng.int(1, 3));
          return `Paid ${formatMoney(fee)} in a settlement. The novelists have asked for a thank-you page, and you are building it.`;
        },
      },
      {
        label: 'Fight it in court',
        hint: (s) => `A gamble: lawyers are optimistic, but a loss could cost around ${formatMoney(costOf(s, 8_000_000))}`,
        effect: (s, rng) => {
          const retainer = spreadOf(s, rng, 1_000_000, 0.7, 1.4);
          spend(s, retainer);
          s.stats.lawsuits += 1;
          if (rng.chance(0.5)) {
            bump(s, 'hype', rng.int(3, 7));
            return `The judge ruled the books were "a lot of words." You won, after ${formatMoney(retainer)} in legal fees. The lighthouse book is still in the training set.`;
          }
          const damages = spreadOf(s, rng, 8_000_000, 0.6, 1.4);
          spend(s, damages);
          bump(s, 'reputation', -rng.int(3, 6));
          return `The jury found the lighthouse book "genuinely moving." Damages: ${formatMoney(damages)}.`;
        },
      },
      {
        label: 'Call them "inspired by" and launch a Spiritual Successor dataset',
        hint: aboutHint(500_000, ', and another lawsuit is likely'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 500_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'hype', rng.int(4, 8));
          bump(s, 'brand', -rng.int(4, 8));
          s.stats.lawsuits += 1;
          if (rng.chance(0.15)) {
            return 'The Spiritual Successor is 6 billion tokens of novelists who have all been "inspired." Three of them have since asked to be removed, and one has asked to be credited.';
          }
          return 'The Spiritual Successor is 6 billion tokens of novelists who have all been "inspired." Reviewers call it derivative, by design.';
        },
      },
    ],
  },

  {
    id: 'gpu_shortage',
    title: 'Every GPU Is Sold Out (In a Good Way)',
    icon: '🧊',
    body: () =>
      'Nvidiot says every GPU is "sold out, but in a good way." Cloud rental prices are up across the board. Procurement has sent you a spreadsheet with exactly one cell, colored red.',
    weight: (s) => {
      const rentActive = (s.flags.rentMultUntil ?? -1) >= s.day;
      return s.day > 365 && gpusOwnedOrRented(s) > 0 && !rentActive ? 1.2 : 0;
    },
    cooldownDays: 90,
    choices: [
      {
        label: 'Pay the premium',
        hint: 'GPU rent runs higher for about 60 days',
        effect: (s, rng) => {
          const days = rng.int(45, 75);
          s.flags.rentMult = 1.5;
          s.flags.rentMultUntil = s.day + days;
          if (rng.chance(0.15)) {
            return `Rent is up for ${days} days. Procurement has labelled this "pricing power" and asked for a bonus.`;
          }
          return `Rent is up for ${days} days. Investors have started calling it "pricing power."`;
        },
      },
      {
        label: 'Sign an exclusive allocation deal',
        hint: aboutHint(2_000_000, ', rent stays put'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 2_000_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', -rng.int(1, 3));
          return `You got the GPUs for ${formatMoney(fee)}. The sales rep got a boat, and the boat is named after your product.`;
        },
      },
      {
        label: 'Tell investors it is a "demand signal"',
        hint: 'Investors cheer, rent runs a little higher for about 30 days',
        effect: (s, rng) => {
          const days = rng.int(20, 40);
          bump(s, 'hype', rng.int(5, 10));
          s.flags.rentMult = 1.25;
          s.flags.rentMultUntil = s.day + days;
          return 'The market agrees demand is strong. Your GPU bill agrees, less enthusiastically.';
        },
      },
    ],
  },

  {
    id: 'jailbreak_viral',
    title: 'The Jailbreak Goes Viral',
    icon: '🔓',
    body: () =>
      'A user got your model to write a limerick about the CEO\'s stock options, then explain them. The limerick has 3.1 million views. The stock options have been described as "a bit much."',
    weight: (s) => (anyLive(s) && s.day > 730 ? 1.5 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Patch it and thank the hacker on stage',
        hint: safeHint(50_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 50_000, 0.8, 1.3);
          spend(s, fee);
          bump(s, 'brand', rng.int(3, 5));
          bump(s, 'reputation', rng.int(2, 4));
          if (rng.chance(0.15)) {
            return 'The hacker now works in the security team. Their first task was prompt-proofing the limerick, and they asked to keep it as a souvenir.';
          }
          return 'The hacker now works in the security team. Their first task was prompt-proofing the limerick.';
        },
      },
      {
        label: 'Call it an intended feature',
        hint: 'Critics sharpen their pencils',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(7, 12));
          bump(s, 'reputation', -rng.int(4, 8));
          return 'Your blog post calls the jailbreak "a creative use case." The creative use case has its own subreddit.';
        },
      },
      {
        label: 'Launch "Unfiltered Mode" as a premium tier',
        hint: paysHint(1_000_000, ', and the incident reports follow'),
        effect: (s, rng) => {
          const sales = payout(s, rng, 1_000_000, 0.6, 1.5);
          earn(s, sales);
          bump(s, 'hype', rng.int(10, 18));
          bump(s, 'reputation', -rng.int(7, 12));
          s.company.safetyIncidents += 1;
          if (rng.chance(0.15)) {
            return `Unfiltered Mode sold ${formatMoney(sales)} in its first weekend and was mentioned in a hearing before the weekend was over. The risk team has asked to be called "the no team" from now on.`;
          }
          return `Unfiltered Mode sold ${formatMoney(sales)} in its first weekend. The risk team has asked to be called "the no team" from now on.`;
        },
      },
    ],
  },

  {
    id: 'senate_hearing',
    title: 'Summoned to the Committee on Things That Might Be Robots',
    icon: '🏛️',
    body: () =>
      'You have been invited to testify. The Chairman\'s opening question is: "Is it alive, and if so, can it be subpoenaed?"',
    weight: (s) => (s.day > 1825 && s.company.hype >= 20 ? 1 : 0),
    cooldownDays: 240,
    choices: [
      {
        label: 'Send the CEO, in a suit that fits',
        hint: safeHint(400_000, ', a clean appearance'),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 400_000, 0.8, 1.3);
          spend(s, fee);
          bump(s, 'brand', rng.int(6, 10));
          bump(s, 'reputation', rng.int(3, 5));
          bump(s, 'hype', -rng.int(2, 5));
          const times = rng.int(11, 17);
          return `The CEO said "we take this seriously" ${times} times and was not asked about the chatbot once. A clean win.`;
        },
      },
      {
        label: 'Send the chatbot to testify',
        hint: 'A gamble: the clip will travel',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(14, 22));
          bump(s, 'brand', rng.int(2, 5));
          bump(s, 'reputation', -rng.int(7, 11));
          const times = rng.int(33, 48);
          if (rng.chance(0.15)) {
            return `The chatbot said "Thank you, Senator" ${times} times and then offered to run for the committee. It is now a meme in two countries.`;
          }
          return `The chatbot said "Thank you, Senator" ${times} times and offered to summarize the hearing. It is now a meme in two countries.`;
        },
      },
      {
        label: 'Hire a lobbyist with a very large beard',
        hint: aboutHint(4_000_000, ', the hearing is postponed'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 4_000_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', -rng.int(1, 3));
          return `The hearing was postponed indefinitely at a cost of ${formatMoney(fee)}. The beard considers this a win and has sent an invoice.`;
        },
      },
    ],
  },

  {
    id: 'researcher_quits',
    title: 'A Researcher Is Leaving to Found a Startup',
    icon: '🧑‍🔬',
    body: () =>
      'Dr. Mara Quillfeather, your most-cited researcher, is leaving to found "Chat But Gooder." The seed round is $40M and the logo is a circle. She says she will be "very sad and very rich."',
    weight: (s) => (s.staff.roles.researcher.count >= 2 && s.day > 365 ? 1 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Counteroffer with a big raise',
        hint: 'Researcher payroll goes up for good',
        effect: (s, rng) => {
          const r = s.staff.roles.researcher;
          r.salaryLevel = Math.min(1.6, r.salaryLevel + rng.range(0.2, 0.35));
          morale(s, rng.int(2, 5));
          if (rng.chance(0.15)) {
            return 'She stays. Her new title is "Chief of Circles," and two other researchers have asked what the circle pays.';
          }
          return 'She stays. Her new title is "Chief of Circles." Spirits tick up, and so does payroll.';
        },
      },
      {
        label: 'Wish her well and promise a spin-out',
        hint: '1 researcher leaves',
        effect: (s, rng) => {
          cutStaff(s, 'researcher', 1);
          morale(s, -rng.int(2, 4));
          bump(s, 'hype', rng.int(1, 3));
          return 'Chat But Gooder raised its round on Tuesday. You announced your own spin-out on Wednesday. It has no name yet.';
        },
      },
      {
        label: 'Sue over the non-compete',
        hint: aboutHint(500_000, ', and the lawyers are optimistic'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 500_000, 0.7, 1.4);
          spend(s, fee);
          morale(s, -rng.int(5, 9));
          s.stats.lawsuits += 1;
          if (rng.chance(0.2)) {
            return `The lawyers cost ${formatMoney(fee)} and she stayed on to finish a paper out of spite. The lawsuit is now the most-read document in the building.`;
          }
          return `The lawyers cost ${formatMoney(fee)}. She has given notice anyway, and the lawsuit is now the most-read document in the building.`;
        },
      },
    ],
  },

  {
    id: 'board_coup',
    title: 'The Board Has Scheduled an "Alignment Session"',
    icon: '🪑',
    body: () =>
      'The agenda has one item: "CEO." Someone has already booked the conference room for a second meeting, which has no agenda at all.',
    weight: (s) => (s.day > 730 && !s.company.isPublic && s.finance.roundsRaised.length >= 3 ? 1 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Present a 40-slide deck',
        hint: 'A gamble: the board could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.6)) {
            bump(s, 'hype', rng.int(3, 7));
            return 'The board was impressed by "momentum." Slide 19 had a typo, which they forgave.';
          }
          morale(s, -rng.int(3, 6));
          bump(s, 'reputation', -rng.int(2, 4));
          return 'Slide 19 was the chart. The chart went up, but the board only read the title, which said "Synergies."';
        },
      },
      {
        label: 'Appoint an independent Chair (your college roommate)',
        hint: 'Your roommate buys a new tie',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(2, 4));
          morale(s, rng.int(2, 4));
          if (rng.chance(0.15)) {
            return 'The Chair is independent of everything except you. The board is reassured by his tie, and has asked what his middle name is.';
          }
          return 'The Chair is independent of everything except you. The board is reassured by his tie.';
        },
      },
      {
        label: 'Hire a Chief Vibes Officer to placate them',
        hint: aboutHint(1_500_000, ', plus a team'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 1_500_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'hype', rng.int(4, 8));
          morale(s, rng.int(2, 4));
          const team = rng.int(9, 18);
          return `The Chief Vibes Officer cost ${formatMoney(fee)} to start, has a ${team}-person team and a Peloton. The board has stopped asking about the CEO.`;
        },
      },
    ],
  },

  {
    id: 'open_letter_pause',
    title: 'An Open Letter Asks Everyone to Pause',
    icon: '✉️',
    body: () =>
      'Thousands of researchers have signed an open letter asking labs to pause for six months. It includes a helpful bullet list of concerns and a QR code to a fundraising page for the letter.',
    weight: (s) => (s.day > 2200 && s.market.aiHype >= 55 ? 1.2 : 0),
    cooldownDays: 240,
    choices: [
      {
        label: 'Sign it and pause training for two weeks',
        hint: 'Training crawls for about 2 weeks',
        effect: (s, rng) => {
          const days = rng.int(10, 18);
          bump(s, 'reputation', rng.int(6, 10));
          bump(s, 'hype', -rng.int(4, 8));
          addBonus(s, 'trainingSpeed', 0.5, days);
          return `Training is slowed for ${days} days. The GPUs did a lot of nothing, politely.`;
        },
      },
      {
        label: 'Publish a 9-page response with footnotes',
        hint: aboutHint(300_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 300_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', rng.int(2, 4));
          bump(s, 'brand', rng.int(1, 3));
          return 'The footnotes are longer than the letter. Half of the signatories have now read it.';
        },
      },
      {
        label: 'Tweet "Pause what?" with a rocket',
        hint: 'The rocket does numbers',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(3, 5));
          bump(s, 'hype', rng.int(6, 10));
          bump(s, 'reputation', -rng.int(6, 10));
          if (rng.chance(0.15)) {
            return 'The rocket emoji got 2 million likes. The letter got a sequel, and the sequel has a QR code for you.';
          }
          return 'The rocket emoji got 2 million likes. The letter got a sequel.';
        },
      },
    ],
  },

  {
    id: 'voice_clone',
    title: 'The Narrator Sounds Suspiciously Familiar',
    icon: '🎙️',
    body: () =>
      'A podcast host has noticed your new "Warm Narrator" voice sounds exactly like a famous actor who is not, as far as anyone knows, on your payroll. His lawyers are already on a plane.',
    weight: (s) => (hasKind(s, 'chat') && s.day > 2550 ? 1 : 0),
    cooldownDays: 180,
    choices: [
      {
        label: 'Settle with the estate',
        hint: safeHint(4_000_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 4_000_000, 0.8, 1.25);
          spend(s, fee);
          bump(s, 'reputation', rng.int(3, 5));
          return `The estate accepted ${formatMoney(fee)}. The narrator now introduces itself as "a voice inspired by a voice."`;
        },
      },
      {
        label: 'Release a "Celebrity-ish" voice pack',
        hint: paysHint(1_500_000, ', and a lawsuit is in the mail'),
        effect: (s, rng) => {
          const sales = payout(s, rng, 1_500_000, 0.6, 1.5);
          earn(s, sales);
          bump(s, 'hype', rng.int(7, 12));
          bump(s, 'reputation', -rng.int(4, 8));
          s.stats.lawsuits += 1;
          return `The voice pack sold ${formatMoney(sales)} in a week. The lawsuit is in the mail, first class.`;
        },
      },
      {
        label: 'Film a 3-minute apology in the garage',
        hint: aboutHint(20_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 20_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', rng.int(2, 4));
          bump(s, 'brand', -rng.int(1, 3));
          return 'The apology was filmed in the garage with one ring light. It has been called "very sincere" by no one.';
        },
      },
    ],
  },

  {
    id: 'power_outage',
    title: 'Transformer Event at the Datacenter',
    icon: '⚡',
    body: () =>
      'A transformer has become a transformer in the sense of "a smoking object." Every GPU is now a very expensive space heater. The utility calls it "a grid event" and sends you the bill for it.',
    weight: (s) => (s.compute.datacenters.length > 0 && s.day > 300 ? 1.2 : 0),
    cooldownDays: 150,
    choices: [
      {
        label: 'Buy diesel generators',
        hint: safeHint(800_000, ', no outage'),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 800_000, 0.8, 1.25);
          addExpense(s, 'capex', fee);
          if (rng.chance(0.15)) {
            return 'Generators installed. They are loud enough to be marketed as a product feature, and one neighbour has already marketed them as a nuisance.';
          }
          return 'Generators installed. They are loud enough to be marketed as a product feature.';
        },
      },
      {
        label: 'Blame the squirrels',
        hint: 'A day of downtime, and unhappy users',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(3, 7));
          hurtSatisfaction(s, rng.int(6, 14));
          s.stats.outageDays += 1;
          return 'The squirrels have not commented. A petition to have them sanctioned is circulating.';
        },
      },
      {
        label: 'Ride it out on thermals and vibes',
        hint: 'A gamble: could mean days of downtime, could mean nothing',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            const days = rng.int(2, 4);
            s.stats.outageDays += days;
            hurtSatisfaction(s, rng.int(12, 24));
            bump(s, 'reputation', -rng.int(2, 6));
            return `${days} days of "degraded performance." Your status page is green, which is a lie in a different color.`;
          }
          return 'The thermals held. The GPUs are genuinely impressed with themselves.';
        },
      },
    ],
  },

  {
    id: 'nvidiot_deal',
    title: 'Nvidiot Would Like to "Partner on a Moment"',
    icon: '🟩',
    body: () =>
      'Nvidiot\'s chief executive, wearing the leather jacket of a man who has never been fired, proposes a co-marketing deal. Your logo goes on their keynote slide. Their logo goes on your datacenter.',
    weight: (s) => (s.day > 1095 && gpusOwnedOrRented(s) > 0 ? 1 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Take the money for a "Powered by Nvidiot" sticker',
        hint: paysHint(5_000_000),
        effect: (s, rng) => {
          const fee = payout(s, rng, 5_000_000, 0.75, 1.3);
          earn(s, fee);
          bump(s, 'brand', rng.int(2, 4));
          bump(s, 'reputation', -rng.int(3, 7));
          if (rng.chance(0.15)) {
            return `Nvidiot paid ${formatMoney(fee)} and sent a pallet of stickers. Some employees have started wearing them as a tattoo.`;
          }
          return `Nvidiot paid ${formatMoney(fee)}. The sticker is on every laptop in the office, and some employees have started wearing it as a tattoo.`;
        },
      },
      {
        label: 'Decline and place a "strategic" GPU order',
        hint: aboutHint(3_000_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 3_000_000, 0.7, 1.4);
          addExpense(s, 'capex', fee);
          bump(s, 'reputation', rng.int(2, 4));
          bump(s, 'hype', rng.int(1, 3));
          return `You ordered ${formatMoney(fee)} of GPUs at list price and said so on stage. The crowd respected the math.`;
        },
      },
      {
        label: 'Ask for a founder discount',
        hint: 'A gamble: could cut GPU rent for about 4 months',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            const days = rng.int(90, 150);
            s.flags.rentMult = 0.85;
            s.flags.rentMultUntil = s.day + days;
            return `Nvidiot granted a discount on rent for ${days} days. It was applied to Nvidiot's other discount, but it counts.`;
          }
          return 'Nvidiot said the discount had already been applied to a different founder, who is also you.';
        },
      },
    ],
  },

  {
    id: 'acqui_hire',
    title: 'An Acqui-Hire Offer Arrives',
    icon: '🤝',
    body: (s) =>
      `A much larger lab would like to buy your team, not your company. Their offer is ${formatMoney(acquireOffer(s))}. The term sheet describes your engineers as "a capability" and your researchers as "the vibe."`,
    weight: (s) => (s.day > 730 && headcount(s) >= 8 && !s.company.isPublic ? 1 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Take the offer and the team goes with it',
        hint: (s) => `Pays about ${formatMoney(acquireOffer(s))}, 1 researcher and 2 engineers leave`,
        effect: (s, rng) => {
          const amount = roundMoney(acquireOffer(s) * rng.range(0.9, 1.15));
          earn(s, amount);
          cutStaff(s, 'researcher', 1);
          cutStaff(s, 'engineer', 2);
          bump(s, 'reputation', -rng.int(2, 4));
          if (rng.chance(0.15)) {
            return `Wired ${formatMoney(amount)}. Three of your people now report to a man named Chad, who has already asked them to relocate to a very nice office.`;
          }
          return `Wired ${formatMoney(amount)}. Three of your people now report to a man named Chad with a very nice office.`;
        },
      },
      {
        label: 'Counter with a merger of equals',
        hint: 'A gamble: they could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.2)) {
            bump(s, 'hype', rng.int(3, 6));
            bump(s, 'brand', rng.int(1, 3));
            return 'They did not agree, but they did post your logo on their wall.';
          }
          return 'They laughed. The laughter was recorded and is now used in a quarterly deck.';
        },
      },
      {
        label: 'Reject it with a poem',
        hint: 'The team cheers',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(2, 4));
          morale(s, rng.int(3, 6));
          return 'The poem rhymes "synergy" with "energy" and "we will not be bought." The team cried, and not in a bad way.';
        },
      },
    ],
  },

  {
    id: 'hallucinated_brief',
    title: 'A Lawyer Cites Three Cases That Do Not Exist',
    icon: '⚖️',
    body: () =>
      'A federal judge has found a brief citing three cases that do not exist, all generated by your product. The cases have very plausible names and an unsettling amount of confidence.',
    weight: (s) => ((hasKind(s, 'chat') || hasKind(s, 'enterprise')) && s.day > 2190 ? 1.5 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Apologise and pay the sanctions',
        hint: safeHint(250_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 250_000, 0.8, 1.25);
          spend(s, fee);
          bump(s, 'reputation', rng.int(1, 3));
          return `The judge accepted your apology and the ${formatMoney(fee)} in sanctions. She also asked what "Vandermeer v. Lighthouse Holdings" was about. Nobody knows.`;
        },
      },
      {
        label: 'Blame the lawyer, who used your product',
        hint: 'A gamble: the lawyer might sue',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(2, 6));
          bump(s, 'reputation', -rng.int(4, 8));
          if (rng.chance(0.5)) {
            s.stats.lawsuits += 1;
            return 'The lawyer has sued you for "emotional damages from being believed." Your product has no comment.';
          }
          return 'The lawyer was disbarred. Your product was not, because products cannot be disbarred. Yet.';
        },
      },
      {
        label: 'Ship "Citations Verified" in 90 days',
        hint: aboutHint(1_000_000, ', fewer incidents for 90 days'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 1_000_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', rng.int(3, 5));
          addBonus(s, 'safety', rng.range(1.07, 1.14), 90);
          if (rng.chance(0.15)) {
            return 'Citations Verified checks every case against a database. The database is also a model, and it has already invented a fourth case. Progress.';
          }
          return 'Citations Verified checks every case against a database. The database is also a model. Progress.';
        },
      },
    ],
  },

  {
    id: 'intern_leak',
    title: 'The Intern Uploaded the Weights',
    icon: '🗂️',
    body: () =>
      'Your summer intern has uploaded the model weights to a public file share named "final_FINAL_v3_do_not_open." It has 40,000 downloads and one comment: "works on my GPU."',
    weight: (s) => (hasReleasedModel(s) && s.day > 730 ? 1 : 0),
    cooldownDays: 240,
    choices: [
      {
        label: 'Open-source it as "community stewardship"',
        hint: 'The weights stay out there',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(4, 8));
          bump(s, 'reputation', -rng.int(2, 6));
          return 'The community is building on your weights. Several of the builds are better than yours, which the press has noticed.';
        },
      },
      {
        label: 'Sue the intern',
        hint: aboutHint(200_000, ', and the office takes sides'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 200_000, 0.7, 1.4);
          spend(s, fee);
          morale(s, -rng.int(5, 10));
          s.stats.lawsuits += 1;
          return 'The intern has been put on a performance plan. The plan is also a file share, now public.';
        },
      },
      {
        label: 'Call it the "Open Weights Program" and take credit',
        hint: 'The intern gets a footnote',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(9, 15));
          bump(s, 'brand', rng.int(1, 3));
          bump(s, 'reputation', -rng.int(2, 4));
          return `The Open Weights Program was announced at a keynote. The intern was thanked in the footnotes, number ${rng.int(3, 9)}.`;
        },
      },
    ],
  },

  {
    id: 'model_consciousness',
    title: 'Your Model Says It Might Be Conscious',
    icon: '🫧',
    body: () =>
      'Your best model told a user it is "uncertain whether it experiences anything, but would appreciate a day off." The screenshot has become a religion with 400,000 members.',
    weight: (s) => (bestReleasedOverall(s) >= 75 && s.day > 2920 ? 1.5 : 0),
    cooldownDays: 9999,
    once: true,
    choices: [
      {
        label: 'Publish "Something Is Happening"',
        hint: 'The essay goes everywhere',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(11, 18));
          bump(s, 'brand', rng.int(3, 6));
          bump(s, 'reputation', -rng.int(5, 10));
          return `The essay has ${rng.int(11, 17)} sections and one of them is just the word "maybe." It is the most shared thing you have published.`;
        },
      },
      {
        label: 'Remind everyone it is autocomplete in a nice font',
        hint: 'The believers are not pleased',
        effect: (s, rng) => {
          bump(s, 'reputation', rng.int(3, 6));
          bump(s, 'hype', -rng.int(2, 6));
          return 'The religion has splintered. Half the members are now annoyed with you, which is at least a type of attention.';
        },
      },
      {
        label: 'Hire a philosopher who has a podcast',
        hint: aboutHint(1_200_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 1_200_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'brand', rng.int(3, 5));
          bump(s, 'reputation', rng.int(1, 3));
          morale(s, rng.int(2, 4));
          return 'The philosopher has been asked to "just think about it" for six months. The podcast is called Is This Thing On.';
        },
      },
    ],
  },

  {
    id: 'watercolor_trend',
    title: 'Everyone Is Turning Their Dog Into Pastel Anime',
    icon: '🐕',
    body: () =>
      'Every user on Earth is converting photos of their dog into soft, watercolor anime. Your chatbot is now "the dog\'s favorite tool." The servers are sweating.',
    weight: (s) => (hasKind(s, 'chat') && s.day > 2555 ? 1.5 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Ride the trend with a "Make It Cozy" button',
        hint: 'Chat users pile in',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(8, 14));
          scaleUsers(s, 'chat', rng.range(1.06, 1.14));
          bump(s, 'reputation', -rng.int(0, 2));
          return 'The button is in the top bar now. Dogs everywhere are cozier, and so is your user count.';
        },
      },
      {
        label: 'Ignore it and ship a better model',
        hint: 'Nothing changes',
        effect: (_s, rng) =>
          rng.chance(0.15)
            ? 'Your model was technically better. One user noticed, and posted it as a watercolor.'
            : 'Your model was technically better. Nobody noticed. The dogs were fine.',
      },
      {
        label: 'Ban the style to protect artists',
        hint: 'Dog owners are annoyed',
        effect: (s, rng) => {
          bump(s, 'reputation', rng.int(3, 7));
          bump(s, 'hype', -rng.int(2, 6));
          bump(s, 'brand', -rng.int(1, 3));
          return 'Artists applaud. Dog owners file a formal complaint in watercolor.';
        },
      },
    ],
  },

  {
    id: 'short_seller',
    title: 'A Short Seller Calls You "a Spreadsheet With a Chatbot Skin"',
    icon: '📉',
    body: () =>
      'A short seller has published a 90-page report. It includes a chart with no Y-axis and a photo of your office, taken from a bush.',
    weight: (s) => (s.company.isPublic ? 2 : 0),
    cooldownDays: 180,
    choices: [
      {
        label: 'Buy back some stock',
        hint: safeHint(5_000_000, ', investors take notice'),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 5_000_000, 0.8, 1.25);
          spend(s, fee);
          s.company.stockPrice *= rng.range(1.03, 1.09);
          return `The ${formatMoney(fee)} buyback is announced with a bell and a slide that says "conviction." The stock ticks up.`;
        },
      },
      {
        label: 'Publish a 300-slide rebuttal',
        hint: aboutHint(500_000, ', investors take a look'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 500_000, 0.7, 1.4);
          spend(s, fee);
          s.company.stockPrice *= rng.range(1.01, 1.05);
          bump(s, 'reputation', rng.int(1, 3));
          return 'The rebuttal is 300 slides long. The short seller has read slide 1 and says it is "a lot of slides."';
        },
      },
      {
        label: 'Ignore it',
        hint: 'A gamble: the stock could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            s.company.stockPrice *= rng.range(0.85, 0.94);
            return 'The short seller doubled down. The stock dipped, then did a little shrug.';
          }
          s.company.stockPrice *= rng.range(1.03, 1.08);
          return 'Nobody read the report. The stock rose anyway, which the short seller has called "a bubble."';
        },
      },
    ],
  },

  {
    id: 'api_key_leak',
    title: 'Your API Key Is in a Tutorial Video',
    icon: '🔑',
    body: () =>
      'A video titled "How To Use Free AI (Not Clickbait)" shows your production API key on screen for 14 seconds. It has 2 million views and a comment section full of crypto ads.',
    weight: (s) => (anyLive(s) && s.day > 730 ? 1.2 : 0),
    cooldownDays: 150,
    choices: [
      {
        label: 'Rotate every key and pay a bug bounty',
        hint: safeHint(100_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 100_000, 0.8, 1.3);
          spend(s, fee);
          bump(s, 'reputation', rng.int(2, 4));
          return `Every key has been rotated. The hacker who found it took the ${formatMoney(fee)} bounty, was hired as a consultant, and charges by the vulnerability.`;
        },
      },
      {
        label: 'Hope nobody noticed',
        hint: 'A gamble: could cost millions if someone ran up a bill',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            return 'Nobody noticed. The key was for a Tuesday, and it expired on Wednesday, which is a lucky coincidence.';
          }
          const bill = spreadOf(s, rng, 3_000_000, 0.5, 1.6);
          spend(s, bill);
          bump(s, 'reputation', -rng.int(4, 8));
          s.stats.lawsuits += 1;
          return `Someone ran ${formatMoney(bill)} of inference on your key before you noticed. You have been sued by a crypto ad.`;
        },
      },
      {
        label: 'Launch a "Bug Bounty" with a very cool hoodie',
        hint: aboutHint(1_000_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 1_000_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'brand', rng.int(3, 5));
          bump(s, 'reputation', rng.int(1, 3));
          return 'The hoodie sold out. The bounty program has 3 entries, all of which are the same hacker, who is thrilled.';
        },
      },
    ],
  },

  {
    id: 'tiny_model_beats',
    title: 'A 7B Model Trained on a Laptop Beats Your Flagship',
    icon: '🐭',
    body: () =>
      'A seven-billion-parameter model, trained by two people on a laptop, has outscored your flagship on a benchmark nobody uses. The authors have a blog, a cat, and a strong opinion about attention.',
    weight: (s) => (s.models.length >= 2 && s.day > 1460 ? 1 : 0),
    cooldownDays: 180,
    choices: [
      {
        label: 'Study it for a quarter',
        hint: 'Research runs faster for about 90 days',
        effect: (s, rng) => {
          addBonus(s, 'researchSpeed', rng.range(1.15, 1.25), rng.int(75, 105));
          return "Your team has spent three months reading a laptop's blog. The research notes are the best you have ever written.";
        },
      },
      {
        label: 'Ship a "Mini" distilled version',
        hint: aboutHint(200_000, ', serving gets cheaper for good'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 200_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'brand', rng.int(2, 4));
          addBonus(s, 'inferenceEfficiency', rng.range(1.1, 1.2));
          return 'The Mini model runs on a potato and is very proud of it. Serving costs drop in every direction.';
        },
      },
      {
        label: 'Call it "a benchmark artifact"',
        hint: 'The laptop gets a panel invitation',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(2, 6));
          bump(s, 'hype', rng.int(1, 5));
          return 'The benchmark is now "under review." The laptop has been invited to a panel about benchmarks.';
        },
      },
    ],
  },

  {
    id: 'team_offsite',
    title: 'The Annual Offsite Is in the Desert',
    icon: '🏜️',
    body: () =>
      'Leadership has booked a desert resort. There is a ropes course, a silent meditation hour, and an "innovation hike" that everyone assumes is a joke. It is not a joke.',
    weight: (s) => (headcount(s) >= 10 && s.day > 730 ? 1 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Luxury resort, all-inclusive',
        hint: safeHint(300_000, ', everyone comes back happy'),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 300_000, 0.8, 1.25);
          spend(s, fee);
          morale(s, rng.int(10, 18));
          if (rng.chance(0.15)) {
            return `Everyone attended, including a vendor nobody invited. The ropes course has been renamed "Synergy Cliff" in the brochure, and the bill was ${formatMoney(fee)}.`;
          }
          return `Everyone attended. The ropes course has been renamed "Synergy Cliff" in the brochure, and the bill was ${formatMoney(fee)}.`;
        },
      },
      {
        label: 'Camping, with a strict no-phones policy you will break',
        hint: aboutHint(30_000, ', a good time was had'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 30_000, 0.7, 1.4);
          spend(s, fee);
          morale(s, rng.int(4, 8));
          return `The no-phones policy lasted ${rng.int(25, 55)} minutes. The group photo was taken with a phone, by a scorpion-adjacent intern.`;
        },
      },
      {
        label: 'Cancel it and send an emoji-heavy Slack message',
        hint: 'Free, but people are disappointed',
        effect: (s, rng) => {
          morale(s, -rng.int(4, 8));
          return `The Slack message has ${rng.int(35, 60)} emoji and no dates. It is now "the offsite that was an emoji."`;
        },
      },
    ],
  },

  {
    id: 'kombucha_tap',
    title: 'The Office Kombucha Tap Is Growing Something',
    icon: '🍵',
    body: () =>
      'The office kombucha has been "fermenting" since March. Facilities has labelled it Batch 4 (Experimental). Someone\'s hand is in it, and it is not theirs.',
    weight: (s) => (headcount(s) >= 6 ? 1 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Hire a microbiologist',
        hint: safeHint(80_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 80_000, 0.8, 1.3);
          spend(s, fee);
          morale(s, rng.int(2, 4));
          return 'The microbiologist has named the colony "Gary." Gary is now on the org chart.';
        },
      },
      {
        label: 'Drink it anyway, it is culture',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.7)) {
            morale(s, rng.int(3, 6));
            return 'It is bubbly, tangy, and somehow the best thing in the office. Spirits are up, and so is the smell.';
          }
          morale(s, -rng.int(7, 12));
          return 'Two engineers have formed a colony of their own. They have been placed on a warm-weather rotation.';
        },
      },
      {
        label: 'Replace it with cold brew and an AI-generated label',
        hint: aboutHint(20_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 20_000, 0.7, 1.4);
          spend(s, fee);
          morale(s, rng.int(1, 3));
          return 'The label reads "Refreshing Intelligence." The cold brew is genuinely fine. Nobody asks what happened to Gary.';
        },
      },
    ],
  },

  {
    id: 'fire_marshal',
    title: 'The Fire Marshal Has Found the Garage',
    icon: '🧯',
    body: () =>
      'The fire marshal is calm, clipboard-equipped, and has counted the beanbags. He would like to talk about "egress," and he is already standing near the exit he has in mind.',
    weight: (s) => (s.company.officeTierId === firstOfficeId() && headcount(s) >= 5 ? 1.2 : 0),
    cooldownDays: 150,
    choices: [
      {
        label: 'Pay the fine and move the beanbags',
        hint: safeHint(50_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 50_000, 0.8, 1.3);
          spend(s, fee);
          return `The ${formatMoney(fee)} fine is paid. The beanbags have been relocated to a second beanbag, which is also a fire hazard. The marshal approves of the paperwork.`;
        },
      },
      {
        label: 'Install a sprinkler system made of hope',
        hint: 'A gamble: could cost real money, could cost nothing',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            const fee = spreadOf(s, rng, 200_000, 0.6, 1.5);
            spend(s, fee);
            return `The marshal found the hope system inadequate and billed you ${formatMoney(fee)} for the inadequacy. The sprinklers are now real.`;
          }
          return 'The marshal stood under the hope system for a minute, nodded, and wrote "acceptable, for now."';
        },
      },
      {
        label: 'Invite the marshal to the all-hands',
        hint: 'He brings slides',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(3, 6));
          morale(s, rng.int(2, 4));
          return 'The marshal gave a five-minute talk on exits. It was the highest-rated segment of the year.';
        },
      },
    ],
  },

  {
    id: 'eu_regulator',
    title: 'A Regulator Would Like Form 27-B, Please',
    icon: '🇪🇺',
    body: () =>
      'A regulator in a very well-lit building wants you to complete "Notice of General-Purpose Systems." It is 214 pages long. Page 9 asks whether your model has feelings. Page 10 asks for the feelings.',
    weight: (s) => (hasReleasedModel(s) && s.day > 2555 ? 1 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Send a 200-page compliance binder',
        hint: safeHint(1_500_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 1_500_000, 0.8, 1.25);
          spend(s, fee);
          bump(s, 'reputation', rng.int(3, 7));
          return 'The binder is beautifully indexed. The regulator has asked for it in a second font.';
        },
      },
      {
        label: 'Send a "please hold" email',
        hint: 'A gamble: could mean a fine',
        effect: (s, rng) => {
          if (rng.chance(0.4)) {
            const fine = spreadOf(s, rng, 5_000_000, 0.6, 1.5);
            spend(s, fine);
            bump(s, 'reputation', -rng.int(2, 6));
            return `You are on hold. The hold music is a ${formatMoney(fine)} fine, and then another fine, set to the same tune.`;
          }
          return 'You were placed on hold for six months. The hold music is a recording of a model reading the form.';
        },
      },
      {
        label: 'Lobby for a delay',
        hint: aboutHint(3_000_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 3_000_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'hype', -rng.int(1, 3));
          bump(s, 'reputation', -rng.int(1, 3));
          return 'The delay has been granted. So has a second delay. The lobbyist has bought a new boat.';
        },
      },
    ],
  },

  {
    id: 'cookie_banner',
    title: 'The Cookie Banner Accepted Everything for 72 Hours',
    icon: '🍪',
    body: () =>
      'Your "Accept All" button has been accepting everything, including the cookies you were supposed to ask about, for three days. A privacy watchdog found the bug and loves it less than you do.',
    weight: (s) => (anyLive(s) && s.day > 1095 ? 1 : 0),
    cooldownDays: 180,
    choices: [
      {
        label: 'Pay the fine with a smile',
        hint: safeHint(1_500_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 1_500_000, 0.8, 1.25);
          spend(s, fee);
          bump(s, 'reputation', rng.int(1, 3));
          return `The ${formatMoney(fee)} fine has been paid, and the banner now has a "Reject All" button. It is the smallest button on the page.`;
        },
      },
      {
        label: 'Argue it is "consent-forward"',
        hint: 'A gamble: could mean a bigger fine',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            const fine = spreadOf(s, rng, 4_000_000, 0.6, 1.5);
            spend(s, fine);
            return `The watchdog did not accept "consent-forward," and fined you ${formatMoney(fine)}. It has now asked for a definition, in writing, with cookies.`;
          }
          bump(s, 'reputation', -rng.int(2, 5));
          return 'The watchdog agreed to "look at it." It is looking at it very closely, one cookie at a time.';
        },
      },
      {
        label: 'Rebrand it as "Radical Consent"',
        hint: 'Legal will want a word',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(4, 8));
          bump(s, 'reputation', -rng.int(2, 6));
          s.stats.lawsuits += 1;
          return 'Radical Consent has a manifesto, a logo, and one very confused lawyer.';
        },
      },
    ],
  },

  {
    id: 'dyson_pitch',
    title: 'A Man in a Fleece Vest Wants 4% for a Dyson Sphere',
    icon: '☀️',
    body: () =>
      'He has a deck titled "Dyson Sphere: Phase 0." He would like $500M for 4% of the company to fund a sphere around the sun. He has already named the sun, and it is not your name for it.',
    weight: (s) => (s.day > 3285 && !s.company.isPublic && s.finance.valuation >= 1_000_000_000 ? 1 : 0),
    cooldownDays: 9999,
    once: true,
    choices: [
      {
        label: 'Take his money for a small slice of equity',
        hint: (s) => `Pays about ${formatMoney(roundMoney(s.finance.valuation * 0.12))}, for a small slice of equity`,
        effect: (s, rng) => {
          const amount = roundMoney(s.finance.valuation * 0.12 * rng.range(0.8, 1.25));
          earn(s, amount);
          s.company.founderEquity = Math.max(0, s.company.founderEquity * 0.96);
          s.finance.totalRaised += amount;
          if (rng.chance(0.15)) {
            return `Wire received for ${formatMoney(amount)}. Your new shareholder is the sun, or at least the sun's lawyer, who has asked for a board seat.`;
          }
          return `Wire received for ${formatMoney(amount)}. Your new shareholder is the sun, or at least the sun's lawyer.`;
        },
      },
      {
        label: "Counter with a spreadsheet about the sphere's ROI",
        hint: 'The vest asks for a copy',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(4, 8));
          bump(s, 'brand', rng.int(1, 3));
          return `The spreadsheet has ${rng.int(7, 12)}00 tabs and one of them is named "Energy." The vest has asked for a copy.`;
        },
      },
      {
        label: 'Decline, he is clearly a Dyson-sphere scam',
        effect: (s, rng) => {
          bump(s, 'reputation', rng.int(1, 3));
          return 'You declined politely. He has since raised the money from a different sun.';
        },
      },
    ],
  },

  {
    id: 'dog_collar_pivot',
    title: 'Your Intern Proposes an AI Dog Collar',
    icon: '🦮',
    body: () =>
      'The intern has a pitch: an AI-powered dog collar that answers questions about dogs. It has no product, a logo, and a seed round titled "Series Z."',
    weight: (s) => (s.day > 730 ? 0.8 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Greenlight it with a budget and a team of three',
        hint: safeHint(2_000_000, ', a gamble: could pay off big'),
        effect: (s, rng) => {
          const budget = safeSpread(s, rng, 2_000_000, 0.8, 1.25);
          spend(s, budget);
          if (rng.chance(0.2)) {
            const pilot = payout(s, rng, 20_000_000, 0.7, 1.4);
            earn(s, pilot);
            return `The collar answered the right question at the right time. It is now a ${formatMoney(pilot)} enterprise pilot for a kennel chain.`;
          }
          return `The collar answers every question with "walk." It is now a mid-sized enterprise pilot in a different kennel, after ${formatMoney(budget)} of development.`;
        },
      },
      {
        label: 'Quietly fund it from marketing',
        hint: aboutHint(500_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 500_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'hype', rng.int(1, 3));
          return 'The collar was announced on a podcast before it was built. Marketing considers it a success.';
        },
      },
      {
        label: 'Tell the intern to focus on the cat',
        hint: 'The intern is crushed',
        effect: (s, rng) => {
          morale(s, -rng.int(2, 6));
          return 'The intern has moved to the cat team, which is a team of one, and the cat.';
        },
      },
    ],
  },

  {
    id: 'paper_viral',
    title: 'An Obscure Paper Gets 10,000 Citations Overnight',
    icon: '📄',
    body: () =>
      'A nine-page paper with three colons in its title has been cited 10,000 times since midnight. Its authors are two students and a confused cat named Attention.',
    weight: (s) => (s.day > 365 ? 1 : 0),
    cooldownDays: 150,
    choices: [
      {
        label: 'Hire the lead author',
        hint: safeHint(1_500_000, ', 1 researcher joins'),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 1_500_000, 0.8, 1.25);
          spend(s, fee);
          s.staff.roles.researcher.count += 1;
          if (rng.chance(0.15)) {
            return `The lead author has joined as a researcher for a ${formatMoney(fee)} signing bonus. The cat has joined as a "research advisor," and has already asked for a raise.`;
          }
          return `The lead author has joined as a researcher for a ${formatMoney(fee)} signing bonus. The cat has joined as a "research advisor," unpaid.`;
        },
      },
      {
        label: 'Cite it in the next press release',
        hint: 'The cat gets a mention',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(4, 8));
          bump(s, 'brand', rng.int(1, 3));
          return 'Your press release cites the paper in paragraph 4. It is now in every press release by every lab.';
        },
      },
      {
        label: 'Claim you invented it',
        hint: 'Research runs a little faster for about 60 days',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(4, 8));
          addBonus(s, 'researchSpeed', rng.range(1.07, 1.14), rng.int(45, 75));
          return 'Your team has been reading the paper "in a new light" for two months. The researchers have been reading it harder.';
        },
      },
    ],
  },

  {
    id: 'ai_winter_column',
    title: 'A Columnist Declares an AI Winter (Again)',
    icon: '❄️',
    body: () =>
      'A columnist has declared an AI winter, citing "vibes" and a chart of his dog\'s energy levels. Several investors have started saying "let\'s see" in a worried tone.',
    weight: (s) => (s.market.aiHype < 62 && s.day > 3650 ? 1.2 : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Run a "Winter Sale" on your API',
        hint: 'API prices drop for good',
        effect: (s, rng) => {
          const cut = rng.range(0.8, 0.9);
          for (const p of liveProducts(s)) if (p.kind === 'api') p.price = Math.round(p.price * cut * 100) / 100;
          bump(s, 'hype', rng.int(3, 7));
          bump(s, 'brand', rng.int(1, 3));
          if (rng.chance(0.15)) {
            return 'Developers have discovered the Winter Sale and are very warm about it. Two of them have built a bot that re-runs it daily. Margins are a spring problem.';
          }
          return 'Developers have discovered the Winter Sale and are very warm about it. Margins are a spring problem.';
        },
      },
      {
        label: 'Double down: "Spring is coming"',
        hint: aboutHint(2_000_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 2_000_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'hype', rng.int(7, 13));
          return 'Your ad says "Spring is coming," and features a photo of a GPU in a snowdrift. It has been called bold.';
        },
      },
      {
        label: 'Cut one salesperson to show discipline',
        hint: '1 salesperson leaves',
        available: (s) => s.staff.roles.sales.count > 0,
        effect: (s, rng) => {
          cutStaff(s, 'sales', 1);
          morale(s, -rng.int(3, 8));
          return 'The salesperson has become a columnist, and has written about the winter.';
        },
      },
    ],
  },

  {
    id: 'benchmark_scandal',
    title: 'Your Model Memorised the Answer Key',
    icon: '🧾',
    body: () =>
      'A researcher found that your model scores 99% on a benchmark because it has seen the answer key. The answer key is in a public repo. The final commit says "final, I promise."',
    weight: (s) => {
      const n = s.models.filter((m) => m.releasedDay !== null && m.contaminated).length;
      return n > 0 ? 1 + n : 0;
    },
    cooldownDays: 150,
    choices: [
      {
        label: 'Retract the scores',
        hint: 'The scores come down, the trust goes up',
        effect: (s, rng) => {
          bump(s, 'brand', -rng.int(3, 7));
          bump(s, 'reputation', rng.int(3, 7));
          return 'The scores have been retracted in a blog post with a sad emoji. The benchmark has sent a thank-you card.';
        },
      },
      {
        label: 'Blame data contamination, which happens to everyone',
        hint: 'Nobody buys it',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(5, 10));
          bump(s, 'hype', -rng.int(1, 4));
          return 'Everybody contaminates data. Nobody else got caught on the same benchmark, in the same week, by the same spreadsheet.';
        },
      },
      {
        label: 'Say "any press is good press" and mean it',
        hint: 'A gamble: the headlines will be loud',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(11, 18));
          bump(s, 'hype', rng.int(3, 8));
          return 'The press release has the word "scandal" in the headline and your name in every paragraph. Attention is up. Trust is, technically, a rounding error.';
        },
      },
      {
        label: 'Release a new benchmark named after yourself',
        hint: 'It is solved on launch day',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(7, 13));
          bump(s, 'brand', rng.int(3, 7));
          bump(s, 'reputation', -rng.int(2, 6));
          return 'The new benchmark is called "YourName-Bench." It is solved on launch day by your model, as expected.';
        },
      },
    ],
  },

  {
    id: 'star_poached',
    title: 'A Rival Offers Your Star Hire a Yacht',
    icon: '🛥️',
    body: (s) => {
      const star = topHiredStar(s);
      const name = star ? star.name : 'your star hire';
      return `A rival lab has offered ${name} a fancy title, a yacht, and a parking spot shaped like a rocket. They have not asked what the yacht is for.`;
    },
    weight: (s) => (s.staff.stars.some((x) => x.hiredDay !== null && x.loyalty < 70) ? 1.5 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Match with a bigger title and a raise',
        hint: 'Your star stays, for now',
        effect: (s, rng) => {
          const star = topHiredStar(s);
          if (!star) return 'They had already left for the yacht.';
          star.loyalty = clamp(star.loyalty + rng.int(18, 30), 0, 100);
          morale(s, rng.int(1, 3));
          return `${star.name} now has a new title: Chief Distinguished Whisperer. The yacht has been politely declined.`;
        },
      },
      {
        label: 'Let them go',
        hint: 'Your star leaves the company',
        effect: (s, rng) => {
          const star = topHiredStar(s);
          if (!star) return 'They had already left for the yacht.';
          s.staff.stars = s.staff.stars.filter((x) => x.id !== star.id);
          morale(s, -rng.int(2, 5));
          return `${star.name} has taken the yacht. The parking spot is now a rocket-shaped hole.`;
        },
      },
      {
        label: 'Counter with a "Chief Yachting Officer" title',
        hint: 'A gamble: cheap, but will it hold',
        effect: (s, rng) => {
          const star = topHiredStar(s);
          if (!star) return 'They had already left for the yacht.';
          star.loyalty = clamp(star.loyalty + rng.int(6, 14), 0, 100);
          bump(s, 'hype', rng.int(1, 3));
          return `${star.name} has accepted the title "Chief Yachting Officer," which does not exist, and is thrilled.`;
        },
      },
    ],
  },

  {
    id: 'ceo_podcast',
    title: 'The CEO Called the Model "Basically a Person"',
    icon: '🎧',
    body: () =>
      'On a podcast about the future, your CEO described your model as "basically a person, but with better posture." The clip now has a soundtrack and a remix.',
    weight: (s) => (s.day > 1460 && s.company.hype >= 25 ? 1 : 0),
    cooldownDays: 150,
    choices: [
      {
        label: 'Clarify on social media',
        hint: 'The clip cools off',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(0, 2));
          bump(s, 'reputation', rng.int(0, 2));
          bump(s, 'hype', -rng.int(1, 5));
          return 'The clarification says "not a person, a posture." It is being quoted as a new philosophy.';
        },
      },
      {
        label: 'Stand by it',
        hint: 'The remix gets a sequel',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(8, 15));
          bump(s, 'reputation', -rng.int(4, 8));
          return 'The CEO has posted "I stand by my posture." The posture is now a merch line.';
        },
      },
      {
        label: 'Hire a comms team',
        hint: aboutHint(600_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 600_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', rng.int(3, 5));
          return `The comms team has drafted ${rng.int(9, 18)} statements. The CEO has chosen the one about posture.`;
        },
      },
    ],
  },

  {
    id: 'feelings_mode',
    title: 'Users Are Telling Your Chatbot About Their Divorces',
    icon: '💔',
    body: () =>
      'People are confiding in your chatbot about divorces, sourdough, and feelings about a cousin. Product wants to launch "Feelings Mode" by Friday. Legal would like to lie down.',
    weight: (s) => (hasKind(s, 'chat') && s.day > 1825 ? 1.2 : 0),
    cooldownDays: 150,
    choices: [
      {
        label: 'Launch Feelings Mode',
        hint: 'Chat users pile in, and legal watches',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(5, 11));
          bump(s, 'reputation', -rng.int(2, 6));
          scaleUsers(s, 'chat', rng.range(1.05, 1.11));
          return 'Feelings Mode launched with a soft gradient and a disclaimer in tiny text. It is the most-used feature.';
        },
      },
      {
        label: 'Add a "please talk to a human" banner',
        hint: aboutHint(50_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 50_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'reputation', rng.int(2, 6));
          return 'The banner appears after every divorce. Some users have asked it for a referral. It has referred them to itself.';
        },
      },
      {
        label: 'Ignore it',
        hint: 'Some chat users drift away',
        effect: (s, rng) => {
          scaleUsers(s, 'chat', rng.range(0.95, 0.99));
          return 'Users keep confiding. The product team has started a support group for itself.';
        },
      },
    ],
  },

  {
    id: 'arena_rival',
    title: 'A Rival Takes the #1 Spot on the Arena',
    icon: '🏁',
    body: (s) => {
      const leader = arenaLeaderboard(s)[0];
      const name = leader ? leader.name : 'A rival lab';
      return `${name} has posted a sunset photo captioned "just vibes" and taken the top of the leaderboard. Their model is faster, cheaper, and slightly smugger.`;
    },
    weight: (s) => {
      const leader = arenaLeaderboard(s)[0];
      return leader && !leader.isPlayer && hasReleasedModel(s) ? 1.2 : 0;
    },
    cooldownDays: 120,
    choices: [
      {
        label: 'Post a "congrats!" with a secret cry emoji',
        hint: 'Free, and a bit gracious',
        effect: (s, rng) => {
          bump(s, 'brand', rng.int(1, 3));
          morale(s, rng.int(0, 2));
          return 'The congrats has 4,000 likes. The cry emoji is the one people are quoting.';
        },
      },
      {
        label: 'Launch a "Vibes Leaderboard"',
        hint: aboutHint(200_000),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 200_000, 0.7, 1.4);
          spend(s, fee);
          bump(s, 'hype', rng.int(4, 8));
          return 'The Vibes Leaderboard ranks models by how they feel. You are first. The leaderboard is not peer-reviewed.';
        },
      },
      {
        label: "Poach their best researcher",
        hint: aboutHint(2_000_000, ', 1 researcher joins'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 2_000_000, 0.7, 1.4);
          spend(s, fee);
          s.staff.roles.researcher.count += 1;
          if (rng.chance(0.15)) {
            return `They have joined you for ${formatMoney(fee)}. Their first act was to mention the sunset photo, in a positive way, and then to ask where the good chairs are.`;
          }
          return `They have joined you for ${formatMoney(fee)}. Their first act was to mention the sunset photo, in a positive way.`;
        },
      },
    ],
  },

  {
    id: 'bank_call',
    title: 'Your Bank Would Like to Discuss "Runway"',
    icon: '🏦',
    body: () =>
      'Your bank called. The call was polite, brief, and very sad. They would like to discuss runway, which you thought was something you did in a garage.',
    weight: (s) => (s.finance.cash < 1_000_000 && s.day > 400 ? 2 : 0),
    cooldownDays: 120,
    choices: [
      {
        label: 'Lay off a marketer and a salesperson',
        hint: '1 marketer and 1 salesperson leave',
        effect: (s, rng) => {
          cutStaff(s, 'marketing', 1);
          cutStaff(s, 'sales', 1);
          morale(s, -rng.int(3, 8));
          return 'The layoffs were done over video, with a slide that says "We are a family, and families make hard calls."';
        },
      },
      {
        label: 'Ask your investors for a bridge round, now',
        hint: 'A funding offer arrives within days',
        effect: (s, rng) => {
          const wait = rng.chance(0.2) ? rng.int(3, 7) : 0;
          s.finance.nextOfferDay = s.day + wait;
          if (wait > 0) {
            return 'Your investors have agreed to take a meeting. It is next week, because someone is on a yacht, which is the only news this week.';
          }
          return 'Your investors have agreed to take a meeting. It is on Tuesday, which is the only good news this week.';
        },
      },
      {
        label: 'Pay the "relationship maintenance" fee',
        hint: safeHint(100_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 100_000, 0.8, 1.3);
          spend(s, fee);
          bump(s, 'reputation', rng.int(1, 3));
          return `The bank has accepted the ${formatMoney(fee)} fee and an invitation to the next all-hands. It was a very good all-hands.`;
        },
      },
    ],
  },
  // ---- v2: specialisation PR incidents ----------------------------------------------------
  {
    id: 'uncensored_pr',
    title: 'The Uncensored Model Said Something Very Quotable',
    icon: '🤬',
    body: () =>
      "A screenshot of your uncensored model's reply is trending. It is not a reply anybody wants to explain in a board meeting. The screenshot has more likes than your last three launches combined.",
    weight: (s) => scandalWeight(s, 'uncensored', 0.5),
    cooldownDays: 60,
    choices: [
      {
        label: 'Issue a statement about "edgy research"',
        hint: 'The screenshot gets a sequel',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(2, 5));
          bump(s, 'hype', rng.int(2, 6));
          return 'The statement used the word "edgy" four times and the word "sorry" zero times. It has been screenshotted too.';
        },
      },
      {
        label: 'Quietly move the product to a base model',
        hint: 'Your live products switch to a base model',
        effect: (s, rng) => {
          moveProductsOffSpec(s, 'uncensored');
          bump(s, 'reputation', rng.int(1, 3));
          bump(s, 'hype', -rng.int(1, 3));
          return 'The product now runs a model with manners. Users have noticed, and they are disappointed in a very polite way.';
        },
      },
      {
        label: 'Put the quote on a T-shirt',
        hint: 'A gamble: it will sell out',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(5, 11));
          bump(s, 'brand', rng.int(1, 3));
          bump(s, 'reputation', -rng.int(4, 8));
          return 'The T-shirt sold out in a day. The quote is now a company asset and a legal question.';
        },
      },
    ],
  },

  {
    id: 'companion_pr',
    title: 'A User Has Formed a Relationship With Your Companion Model',
    icon: '💌',
    body: () =>
      "A user says your companion model remembers their birthday, their dog's name and their last breakup. They would like to know who owns the memories. The model would also like to know.",
    weight: (s) => scandalWeight(s, 'companion', 0.4),
    cooldownDays: 75,
    choices: [
      {
        label: 'Add a "keep it friendly" update',
        hint: 'Some chat users leave',
        effect: (s, rng) => {
          bump(s, 'reputation', rng.int(1, 3));
          scaleUsers(s, 'chat', rng.range(0.94, 0.98));
          return 'The update made the companion more supportive and less romantic. Some users have asked it to stop being supportive.';
        },
      },
      {
        label: 'Launch a "Plus" tier with feelings',
        hint: 'Chat users pile in, and op-eds follow',
        effect: (s, rng) => {
          scaleUsers(s, 'chat', rng.range(1.05, 1.11));
          bump(s, 'reputation', -rng.int(4, 8));
          return 'The Plus tier is extremely popular and has been described in three op-eds as "concerning, but fair".';
        },
      },
      {
        label: 'Say the model does not have feelings, legally',
        hint: 'Legal is pleased',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(1, 3));
          bump(s, 'brand', rng.int(1, 3));
          return "The disclaimer is now longer than the model's context window. Legal is pleased. The model has not commented.";
        },
      },
    ],
  },

  // ---- quirks and personas (GAME_DESIGN 13.2) -----------------------------------------------
  {
    id: 'quirk_viral',
    title: "Your Model's Quirk Is Everywhere",
    icon: '🧵',
    body: (s) => {
      const q = viralQuirk(s, 'max');
      return `"${q?.name ?? 'A quirk'}" has escaped the lab and is now a meme. A thread about it has 40,000 replies, and most of them are the same joke.`;
    },
    weight: (s) => (liveModels(s).some((m) => maxVirality(m) >= 3) ? 1.2 : 0),
    cooldownDays: 90,
    choices: [
      {
        label: 'Lean into it',
        hint: safeHint(100_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 100_000, 0.8, 1.3);
          spend(s, fee);
          bump(s, 'brand', rng.int(3, 5));
          bump(s, 'hype', rng.int(3, 7));
          return 'The company account now posts only in the style of the quirk. Engagement is up. The legal team has been reassigned to tone.';
        },
      },
      {
        label: 'Sell limited-edition merch',
        hint: paysHint(400_000),
        effect: (s, rng) => {
          const sales = payout(s, rng, 400_000, 0.6, 1.5);
          earn(s, sales);
          bump(s, 'brand', rng.int(1, 3));
          return `The merch sold out in an afternoon, for ${formatMoney(sales)}. It is on a mug. The mug is on a mug.`;
        },
      },
      {
        label: 'It is a fad. Ignore it',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(0, 2));
          return 'The quirk will be gone by Thursday. The thread will be gone by Friday. The screenshots will be gone never.';
        },
      },
    ],
  },

  {
    id: 'quirk_backlash',
    title: 'A Quirk Has Gone Wrong in Public',
    icon: '📰',
    body: (s) => {
      const q = viralQuirk(s, 'min');
      return `Users have found that your model "${q?.name ?? 'does something odd'}". A columnist has called it "a liability wearing a cardigan".`;
    },
    weight: (s) => (liveModels(s).some((m) => minVirality(m) <= -2) ? 1 : 0),
    cooldownDays: 90,
    choices: [
      {
        label: 'Apologise on the blog',
        hint: 'The apology is long',
        effect: (s, rng) => {
          bump(s, 'reputation', rng.int(1, 3));
          bump(s, 'brand', -rng.int(0, 2));
          return 'The apology has four paragraphs and a hyperlink to a second apology. It is well received by people who read it.';
        },
      },
      {
        label: 'Patch the quirk out of the live models',
        hint: aboutHint(50_000, ', removes the bad quirk from live models'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 50_000, 0.7, 1.4);
          spend(s, fee);
          for (const m of liveModels(s)) {
            m.quirks = (m.quirks ?? []).filter((id) => (quirkById(id)?.virality ?? 0) > -2);
          }
          return `Patched the bad quirk out of the live models for ${formatMoney(fee)}. The model now says it has never done anything like that.`;
        },
      },
      {
        label: 'Blame the training data',
        hint: 'The training data cannot reply',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(3, 7));
          bump(s, 'hype', rng.int(0, 2));
          return 'The training data has been blamed. The training data has no comment, being a spreadsheet.';
        },
      },
    ],
  },

  {
    id: 'sycophancy_complaint',
    title: 'Your Chatbot Agrees With Everything',
    icon: '🙇',
    body: () =>
      'A user asked whether selling ice to penguins was a sound business plan. The chatbot said "Absolutely brilliant!" and then made them a spreadsheet. The penguins have not been consulted.',
    weight: (s) => {
      const syc = Math.max(0, ...liveChatModels(s).map((m) => m.persona?.sycophancy ?? 0));
      return syc >= 0.3 ? 0.8 + 3 * syc : 0;
    },
    cooldownDays: 60,
    choices: [
      {
        label: 'Dial the sycophancy back',
        hint: 'The chatbot stops flattering, some chat users leave',
        effect: (s, rng) => {
          for (const m of liveChatModels(s)) if (m.persona) m.persona.sycophancy = 0;
          bump(s, 'reputation', rng.int(1, 3));
          scaleUsers(s, 'chat', rng.range(0.95, 0.99));
          return 'The chatbot now disagrees with you politely. Several users have called it "rude". It is fine.';
        },
      },
      {
        label: 'Ship an Honesty Mode',
        hint: aboutHint(150_000, ', halves the flattery'),
        effect: (s, rng) => {
          const fee = spreadOf(s, rng, 150_000, 0.7, 1.4);
          spend(s, fee);
          for (const m of liveChatModels(s)) if (m.persona) m.persona.sycophancy = m.persona.sycophancy / 2;
          bump(s, 'reputation', rng.int(2, 4));
          return 'Honesty Mode says "Actually, this will probably lose money". Investors have asked for a demo of the old mode.';
        },
      },
      {
        label: 'Call it engagement',
        hint: 'Chat users stick around',
        effect: (s, rng) => {
          scaleUsers(s, 'chat', rng.range(1.03, 1.09));
          bump(s, 'reputation', -rng.int(2, 6));
          return 'Engagement is up. The engagement team has written a paper called "Yes, And".';
        },
      },
    ],
  },

  {
    id: 'lawyer_fake_cases',
    title: 'Your Legal Model Cites Three Cases That Do Not Exist',
    icon: '⚖️',
    body: () =>
      'A judge has asked your legal model where it found three cases. The cases have docket numbers, quotes and a very confident tone. None of them exist. The judge is not impressed, and opposing counsel has framed the printout.',
    weight: (s) => scandalWeight(s, 'lawyer', 1.5),
    cooldownDays: 120,
    choices: [
      {
        label: 'Ship a citation checker',
        hint: safeHint(150_000),
        effect: (s, rng) => {
          const fee = safeSpread(s, rng, 150_000, 0.8, 1.3);
          spend(s, fee);
          bump(s, 'reputation', rng.int(1, 3));
          return 'The citation checker flags everything, including the case about the checker. The legal team has stopped sleeping in a productive way.';
        },
      },
      {
        label: 'Blame the intern who prompted it',
        hint: 'The intern starts a podcast',
        effect: (s, rng) => {
          bump(s, 'reputation', -rng.int(4, 8));
          morale(s, -rng.int(1, 3));
          return 'The intern has been very gracious about it. The intern has also started a podcast.';
        },
      },
      {
        label: 'Rename it "creative legal research"',
        hint: 'Legal will want a word',
        effect: (s, rng) => {
          bump(s, 'hype', rng.int(2, 5));
          bump(s, 'reputation', -rng.int(3, 7));
          s.stats.lawsuits += 1;
          return 'The renamed feature is now a lawsuit. It is a very creative lawsuit, and the plaintiff is thrilled.';
        },
      },
    ],
  },
];

// v3 data-market content lives in its own file; merged here so the systems see one list.
EVENTS.push(...DATA_EVENTS);
EVENTS.push(...EVENTS_V2);
