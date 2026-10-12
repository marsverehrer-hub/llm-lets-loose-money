// v2 choice events: new event types, chains and variance. Merged into EVENTS by data/events.ts.
// Hints show tangible things only (money, GPUs, staff, datasets, time). Results are narrative: no stat numbers, no percent signs.
// Chains: a choice calls scheduleChain(key); the follow-up weighs chainWeight(key) and every follow-up choice calls clearChain(key).
// Era gating: most events open on a day window so they land in a normal game; a few need a live product, a datacenter,
// a training run or a public listing.
import type { EventDef, GameState } from '../types';
import { calendarYear, formatMoney } from '../util';
import { GPUS } from './gpus';
import { datasetById } from '../systems/data';
import {
  addBonus,
  anyLive,
  bump,
  capAtCash,
  chainWeight,
  clearChain,
  cutStaff,
  earn,
  gpusOwnedOrRented,
  hasKind,
  hasReleasedModel,
  headcount,
  hurtSatisfaction,
  inGarageEra,
  liveProducts,
  morale,
  ownedLegalRisk,
  safeCost,
  scaleUsers,
  scaledCost,
  scheduleChain,
  spend,
  spreadCost,
  starterGpuId,
} from './eventKit';

// ---------------------------------------------------------------------------
// local helpers
// ---------------------------------------------------------------------------

const $ = formatMoney;

/** Hint for the safest option: scaled cost capped at a quarter of cash, the same number the effect spends. */
const safeHint = (base: number) => (s: GameState) => `Costs about ${$(safeCost(s, base))}`;
/** Hint for a bolder option: scaled cost capped at half of cash. */
const capHint = (base: number) => (s: GameState) => `Costs about ${$(capAtCash(s, scaledCost(s, base), 0.5))}`;
/** Day-window weight: `w` once the day arrives, zero before. */
const from = (s: GameState, day: number, w: number) => (s.day >= day ? w : 0);
const researchers = (s: GameState) => s.staff.roles.researcher.count;

/** The newest GPU generation that is on the market this year. */
function currentGpuId(s: GameState): string {
  const year = calendarYear(s.day);
  const live = GPUS.filter((g) => g.unlockYear <= year).sort((a, b) => b.unlockYear - a.unlockYear);
  return live[0]?.id ?? starterGpuId();
}
function addGpus(s: GameState, n: number): void {
  const id = currentGpuId(s);
  s.compute.rented[id] = (s.compute.rented[id] ?? 0) + n;
}
/** Take up to n rented GPUs away. Returns how many actually went. */
function removeGpus(s: GameState, n: number): number {
  let left = n;
  for (const id of Object.keys(s.compute.rented)) {
    if (left <= 0) break;
    const take = Math.min(left, s.compute.rented[id]);
    s.compute.rented[id] -= take;
    if (s.compute.rented[id] <= 0) delete s.compute.rented[id];
    left -= take;
  }
  return n - left;
}
/** The owned dataset with the highest legal risk, if any. */
function riskiestOwned(s: GameState) {
  return s.data.owned
    .map((id) => datasetById(s, id))
    .filter((d): d is NonNullable<ReturnType<typeof datasetById>> => !!d)
    .sort((a, b) => b.legalRisk - a.legalRisk)[0];
}
const hasBuiltDatacenter = (s: GameState) => s.compute.datacenters.some((d) => d.buildDaysLeft <= 0);

export const EVENTS_V2: EventDef[] = [
  // =========================================================================
  // TALENT
  // =========================================================================
  {
    id: 'v2_sabbatical',
    title: 'A senior researcher wants a sabbatical',
    icon: '🏖️',
    body: () =>
      'Dr. Ines Vandermolen, your most senior researcher, would like six months off to "think about thinking." She has attached a reading list. It is mostly sourdough.',
    weight: (s) => (researchers(s) >= 2 ? from(s, 120, 2) : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Approve it, with a stipend',
        hint: safeHint(30_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 30_000));
          morale(s, 4);
          s.flags['v2.sabbatical'] = 1;
          scheduleChain(s, 'sabbatical_return', rng, 40, 120);
          if (rng.chance(0.15)) {
            bump(s, 'hype', 2);
            return 'She mailed a postcard from a cabin with no signal. It says, in full, "Figured it out. Back soon." Three people have framed it.';
          }
          return 'Dr. Vandermolen has left for a cabin with no Wi-Fi and a sourdough starter that has already been named.';
        },
      },
      {
        label: 'Counter with a raise and a long weekend',
        hint: 'Raises researcher pay',
        effect: (s, rng) => {
          if (rng.chance(0.15) && researchers(s) >= 2) {
            cutStaff(s, 'researcher', 1);
            return 'She thanked you for the offer, took the long weekend, and did not come back from it. Her desk now holds a very small loaf.';
          }
          const r = s.staff.roles.researcher;
          r.salaryLevel = Math.min(1.6, r.salaryLevel + 0.1);
          morale(s, 2);
          return 'She accepted. The sourdough will be eaten on site, where it can be monitored.';
        },
      },
      {
        label: 'Refuse, politely',
        hint: 'A gamble: a researcher may leave',
        effect: (s, rng) => {
          morale(s, -3);
          if (rng.chance(0.45) && researchers(s) >= 2) {
            cutStaff(s, 'researcher', 1);
            return 'She resigned by emailing the reading list to the whole company, with the sourdough bit highlighted.';
          }
          return 'She stayed. The fridge now contains a jar with a note: "Do not feed. This is a protest."';
        },
      },
    ],
  },

  {
    id: 'v2_sabbatical_return',
    title: 'The sabbatical comes back with a manifesto',
    icon: '📜',
    body: () =>
      'Dr. Vandermolen is back from her cabin with a ninety-page manifesto, a tan, and "a small idea." The idea is not small. The manifesto has a table of contents and, somehow, a foreword by the cabin.',
    weight: (s) => chainWeight(s, 'sabbatical_return', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Read it properly, with snacks',
        hint: 'She wants it read aloud',
        effect: (s, rng) => {
          clearChain(s, 'sabbatical_return');
          morale(s, 2);
          if (rng.chance(0.15)) {
            return 'Page 61 contains a flaw, which she found herself, with a pen, and cheerfully crossed out. The rest holds up well.';
          }
          addBonus(s, 'researchSpeed', 1.15 + rng.next() * 0.1, 90);
          return 'Three people read all ninety pages and one read it twice. The lab has a new way of thinking about the next quarter.';
        },
      },
      {
        label: 'Turn it into a conference talk',
        hint: safeHint(15_000),
        effect: (s, rng) => {
          clearChain(s, 'sabbatical_return');
          spend(s, safeCost(s, 15_000));
          bump(s, 'hype', 3);
          bump(s, 'brand', 2);
          return rng.chance(0.2)
            ? 'The talk was a hit. A man in the front row asked if the cabin was available for hire.'
            : 'The talk went well. Slide 40 had a joke about sourdough that only six people got, all of them on your team.';
        },
      },
      {
        label: 'File it under "later"',
        effect: (s, rng) => {
          clearChain(s, 'sabbatical_return');
          morale(s, -2);
          if (rng.chance(0.3) && researchers(s) >= 2) {
            cutStaff(s, 'researcher', 1);
            return 'She left again, this time permanently, and took the manifesto. It is being published by a rival.';
          }
          return 'The manifesto is now a shelf ornament. It has already outlasted three roadmaps.';
        },
      },
    ],
  },

  {
    id: 'v2_roadmap_leak',
    title: 'The intern posted the roadmap',
    icon: '🗺️',
    body: () =>
      'The summer intern has put the roadmap on a public forum, in a thread titled "pls dont share." It lists three unreleased features and something called "Project Moist." Fourteen people have already cited it.',
    weight: (s) => from(s, 150, 1.8),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'Release it officially, as "transparency"',
        effect: (s, rng) => {
          bump(s, 'hype', 3);
          bump(s, 'brand', 1);
          if (rng.chance(0.15)) {
            bump(s, 'hype', -2);
            return 'Rivals have already copied Project Moist. Theirs is called Project Damp, and ships on Friday.';
          }
          return 'The roadmap is now a press release. Project Moist has a fan account and, unfortunately, a mascot.';
        },
      },
      {
        label: 'Send a takedown letter',
        hint: safeHint(12_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 12_000));
          if (rng.chance(0.35)) {
            bump(s, 'hype', 4);
            return 'The letter was posted by the forum with the comment "Streisand moment." It is the most-read document in your company history.';
          }
          return 'The thread came down within the hour. It has been archived four times, and one of the archives is a pirate.';
        },
      },
      {
        label: 'Rewrite the roadmap overnight',
        hint: 'Takes 30 days',
        effect: (s) => {
          addBonus(s, 'researchSpeed', 0.9, 30);
          morale(s, -3);
          return 'The new roadmap has no features on it, only vibes. Everyone has agreed to ship the vibes.';
        },
      },
    ],
  },

  {
    id: 'v2_union_drive',
    title: 'A flyer has appeared in the kitchen',
    icon: '✊',
    body: (s) =>
      headcount(s) <= 4
        ? 'The few of you have discovered you are, technically, a bargaining unit. Someone has made a flyer. It has a fist on it and a typo in "solidarity." You are on both sides of the table.'
        : 'A flyer has appeared in the kitchen. It has a fist on it, a typo in "solidarity," and a growing list of signatures, including two from people who have never been seen in the building.',
    weight: (s) => from(s, 300, 1.8),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Recognise it voluntarily',
        hint: 'Raises researcher and engineer pay',
        effect: (s, rng) => {
          for (const id of ['researcher', 'engineer'] as const) {
            const r = s.staff.roles[id];
            r.salaryLevel = Math.min(1.6, r.salaryLevel + 0.1);
          }
          morale(s, 5);
          s.flags['v2.union'] = 1;
          scheduleChain(s, 'union_contract', rng, 40, 110);
          return 'You recognised it before lunch. The first demand is a better coffee machine, and the second is a coffee machine for the coffee machine.';
        },
      },
      {
        label: 'Hire a consultant to "listen"',
        hint: safeHint(35_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 35_000));
          morale(s, 1);
          s.flags['v2.union'] = 2;
          scheduleChain(s, 'union_contract', rng, 40, 110);
          return 'The consultant listened for six weeks and produced a deck titled "Listening Is a Journey." People who were interviewed say they were mostly asked about the snacks.';
        },
      },
      {
        label: 'Ignore the flyer',
        hint: 'An engineer might walk, could go either way',
        effect: (s, rng) => {
          morale(s, -6);
          s.flags['v2.union'] = 3;
          scheduleChain(s, 'union_contract', rng, 40, 110);
          if (rng.chance(0.4) && s.staff.roles.engineer.count >= 2) {
            cutStaff(s, 'engineer', 1);
            return 'One engineer has resigned in solidarity with the people who were not yet in solidarity. The flyer has a second, bigger fist.';
          }
          return 'The flyer remained on the fridge for a month. Several people have added a drawing of a smaller fist, which they say is "a placeholder."';
        },
      },
    ],
  },

  {
    id: 'v2_union_contract',
    title: 'The first contract is on the table',
    icon: '🤝',
    body: (s) => {
      const f = s.flags['v2.union'] ?? 1;
      if (f === 1) return 'The union and management sit down to a first contract. Both sides have brought snacks, which an observer calls "an excellent sign, and a sign of what everyone is really there for."';
      if (f === 2) return 'The consultant\'s report says, in a font size normally reserved for warnings, that "the staff would like a union." The vote is on Thursday. The consultant has already invoiced for Friday.';
      return 'The flyer has become a work-to-rule. Every standup now lasts exactly eight hours, and every one of them has a very detailed agenda about the agenda.';
    },
    weight: (s) => chainWeight(s, 'union_contract', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Sign the standard contract',
        hint: safeHint(60_000),
        effect: (s) => {
          clearChain(s, 'union_contract');
          spend(s, safeCost(s, 60_000));
          morale(s, 3);
          return 'The contract was signed with a fountain pen that ran out of ink at "Section 3." Staff say that is "very on brand."';
        },
      },
      {
        label: 'Negotiate hard',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          clearChain(s, 'union_contract');
          if (rng.chance(0.5)) {
            morale(s, 2);
            return 'Both sides left unhappy, which, a mediator noted, is how you know it is a good deal. There was a handshake and a spreadsheet.';
          }
          addBonus(s, 'researchSpeed', 0.8, 30);
          morale(s, -4);
          return 'Talks collapsed on the question of beanbags. A short strike followed, mostly in the form of a very slow sit-in.';
        },
      },
      {
        label: 'Offer equity instead of a contract',
        hint: capHint(120_000),
        effect: (s, rng) => {
          clearChain(s, 'union_contract');
          spend(s, capAtCash(s, spreadCost(s, rng, 120_000, 0.8, 1.3), 0.5));
          morale(s, 2);
          return 'The offer was accepted by a margin. A lawyer observed that the cap table now looks like a slightly unfinished jigsaw.';
        },
      },
    ],
  },

  {
    id: 'v2_founder_burnout',
    title: 'The founder has not seen daylight since a Tuesday',
    icon: '🕯️',
    body: () =>
      'You have not left the building in nineteen days. Your co-founder has started leaving encouraging sticky notes on your monitor. One says "please eat." Another says "I mean it."',
    weight: (s) => from(s, 200, 1.5),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Take two weeks off, actually',
        hint: 'Takes 14 days',
        effect: (s) => {
          addBonus(s, 'researchSpeed', 0.9, 14);
          morale(s, 3);
          return 'You went outside. It was bright. There was a bird, and it did not respond to your prompt.';
        },
      },
      {
        label: 'Hire an executive coach',
        hint: safeHint(25_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 25_000));
          morale(s, 2);
          if (rng.chance(0.2)) {
            return 'The coach quit after one session and sent you a note: "I think you should coach me." The note is laminated.';
          }
          return 'The coach has recommended "boundaries," "water," and a hobby that is not this. You have chosen water.';
        },
      },
      {
        label: 'Power through',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.55)) {
            bump(s, 'hype', 3);
            return 'You shipped, and then you slept for fourteen hours. The team says you are "a legend," in the tone of a eulogy.';
          }
          morale(s, -8);
          addBonus(s, 'researchSpeed', 0.8, 30);
          return 'You collapsed in the kitchen holding a mug that said "World\'s Okayest Founder." The month that followed was quiet.';
        },
      },
    ],
  },

  // =========================================================================
  // HARDWARE
  // =========================================================================
  {
    id: 'v2_gpu_early',
    title: 'The GPUs arrived three weeks early',
    icon: '📦',
    body: () =>
      'Nvidiot\'s logistics team emails that your next GPU batch has landed three weeks early, "a first in our history, and possibly a mistake." It is on the loading dock, humming a little too happily.',
    weight: (s) => (gpusOwnedOrRented(s) > 0 ? from(s, 100, 1.8) : 0),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'Sign for it',
        hint: 'A few extra rented GPUs, billed from today',
        effect: (s, rng) => {
          addGpus(s, rng.int(4, 8));
          s.flags['v2.gpu_early'] = 1;
          scheduleChain(s, 'gpu_early_invoice', rng, 30, 90);
          return 'The batch is racked and blinking. The driver left in a hurry, in a way you would describe as "satisfied, and then some."';
        },
      },
      {
        label: 'Refuse delivery until the original date',
        effect: (s, rng) => {
          morale(s, -1);
          if (rng.chance(0.2)) {
            return 'The truck left, and the batch was redirected to someone else, who was delighted. Yours will now arrive on the original date, which has moved.';
          }
          return 'The truck left. Your batch will arrive on schedule, which in logistics terms means "when it feels like it."';
        },
      },
      {
        label: 'Sign for it and flip a few to a hobbyist',
        hint: (s) => `Pays about ${$(scaledCost(s, 12_000))}, plus a few extra GPUs`,
        effect: (s, rng) => {
          addGpus(s, rng.int(2, 4));
          earn(s, spreadCost(s, rng, 12_000, 0.8, 1.3));
          bump(s, 'reputation', -1);
          s.flags['v2.gpu_early'] = 2;
          scheduleChain(s, 'gpu_early_invoice', rng, 30, 90);
          return 'The hobbyist paid in cash and a blurry photo of his rig, which is in a shed. The shed has a rainbow of LEDs and no smoke detector.';
        },
      },
    ],
  },

  {
    id: 'v2_gpu_early_invoice',
    title: 'An invoice for "expedited delivery services"',
    icon: '🧾',
    body: (s) =>
      (s.flags['v2.gpu_early'] ?? 1) === 2
        ? 'Nvidiot has noticed that a few GPUs from the early batch ended up in a shed. The invoice cites Section 14(c), "unauthorised enthusiasm." There is no Section 14(c). It does, however, have a very nice logo.'
        : 'An invoice from Nvidiot lists "expedited early delivery services, per Section 14(c)." There is no Section 14(c). The invoice does, however, have a very nice logo.',
    weight: (s) => chainWeight(s, 'gpu_early_invoice', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Pay it',
        hint: (s) => `Costs about ${$(safeCost(s, (s.flags['v2.gpu_early'] ?? 1) === 2 ? 55_000 : 40_000))}`,
        effect: (s) => {
          clearChain(s, 'gpu_early_invoice');
          spend(s, safeCost(s, (s.flags['v2.gpu_early'] ?? 1) === 2 ? 55_000 : 40_000));
          return 'Paid. Nvidiot has sent a thank-you note that looks suspiciously like another invoice.';
        },
      },
      {
        label: 'Dispute it',
        hint: 'A gamble: lawyers are optimistic',
        effect: (s, rng) => {
          clearChain(s, 'gpu_early_invoice');
          if (rng.chance(0.5)) {
            return 'Nvidiot withdrew the invoice, citing "a clerical error," and sent a gift basket of heat sinks. One is inscribed "sorry."';
          }
          spend(s, capAtCash(s, spreadCost(s, rng, 70_000), 0.5));
          return 'The dispute lost. The arbitrator has awarded Nvidiot its costs, and his own, and a plaque.';
        },
      },
      {
        label: 'Send the extra GPUs back',
        hint: 'The early GPUs go back',
        effect: (s, rng) => {
          clearChain(s, 'gpu_early_invoice');
          const n = removeGpus(s, rng.int(3, 6));
          morale(s, -1);
          return n > 0
            ? 'The GPUs went back in the original box, which no longer fits them. Nvidiot has noted, without comment, that the box is "lovingly used."'
            : 'There was nothing to send back. Nvidiot has asked what you were doing with them, and then asked what you were doing without them.';
        },
      },
    ],
  },

  {
    id: 'v2_broken_batch',
    title: 'Half the new GPUs hum in a minor key',
    icon: '🔊',
    body: () =>
      'The new GPUs arrived, and one is in two pieces. The rest work but hum a note the sysadmin identifies as "a minor third, which is the sad one." Nvidiot says this is "within tolerance," and sends a photo of a tolerance.',
    weight: (s) => (gpusOwnedOrRented(s) > 0 ? from(s, 220, 1.6) : 0),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'File an RMA and wait',
        hint: 'Takes 30 days',
        effect: (s) => {
          addBonus(s, 'trainingSpeed', 0.9, 30);
          return 'The RMA has a tracking number, which tracks nothing. The GPUs are in a queue behind the ones that are also broken.';
        },
      },
      {
        label: 'Take them to a repair shop in a strip mall',
        hint: safeHint(18_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 18_000));
          if (rng.chance(0.3)) {
            removeGpus(s, 2);
            return 'The shop returned them with two "slightly more broken" and a business card, with a coupon for a different shop.';
          }
          return 'The shop fixed them in an afternoon, using a hairdryer and what the owner called "respect."';
        },
      },
      {
        label: 'Run them anyway',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.5)) return 'They ran. The note changed to a major chord, and the sysadmin has stopped looking worried.';
          removeGpus(s, rng.int(2, 5));
          s.stats.outageDays += 1;
          return 'A card gave up with a pop, and the rest did the same in sympathy. The server room smells like a burnt toaster with ambitions.';
        },
      },
    ],
  },

  {
    id: 'v2_datacenter_flood',
    title: 'The cable trays are now waterfalls',
    icon: '🌊',
    body: () =>
      'A water main two floors up has failed, and the cable trays are strictly speaking "waterfalls." The facilities manager is standing in the aisle in waders, holding a clipboard, with the calm of a man who warned someone.',
    weight: (s) => (hasBuiltDatacenter(s) ? from(s, 300, 1.5) : 0),
    cooldownDays: 300,
    choices: [
      {
        label: 'Pump it out and dry the racks',
        hint: safeHint(120_000),
        effect: (s) => {
          spend(s, safeCost(s, 120_000));
          s.stats.outageDays += 1;
          hurtSatisfaction(s, 4);
          return 'A day of fans, towels, and prayer. The racks are dry, apart from one, which is being described as "damp, but proud."';
        },
      },
      {
        label: 'Fail over to rented GPUs',
        hint: (s) => `Costs about ${$(capAtCash(s, scaledCost(s, 200_000), 0.5))}, plus extra rented GPUs`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 200_000), 0.5));
          addGpus(s, rng.int(16, 32));
          return 'Cloud capacity arrived in four hours. The cloud vendor wants you to know it is very sorry, and that its rates are "dynamic," in the sense that they move in one direction.';
        },
      },
      {
        label: 'Claim it on insurance',
        hint: 'Could go either way: lawyers are optimistic',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            earn(s, spreadCost(s, rng, 150_000, 0.8, 1.5));
            return 'The insurer paid out after an adjuster stood in the aisle for six minutes. "It is indeed wet," he wrote.';
          }
          s.stats.outageDays += 3;
          hurtSatisfaction(s, 8);
          return 'The claim was denied, on the grounds that "water" is "an act of nature." The racks are still down while the lawyers argue about the definition of a river.';
        },
      },
    ],
  },

  {
    id: 'v2_export_ban',
    title: 'Commerce restricts "advanced accelerators"',
    icon: '🛃',
    body: () =>
      'The Department of Commerce has announced an export restriction on "advanced accelerators," defined as "anything above a toaster." Nvidiot has already published a "compliant" chip that is the same chip on a slower clock and a faster press release.',
    weight: (s) => (gpusOwnedOrRented(s) > 0 ? from(s, 450, 1.5) : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Buy the "compliant" chip',
        hint: (s) => `${safeHint(60_000)(s)}, plus extra rented GPUs`,
        effect: (s, rng) => {
          spend(s, safeCost(s, 60_000));
          addGpus(s, rng.int(4, 8));
          return 'The compliant chip is almost exactly as good, and its slide deck has a section on "why that is fine."';
        },
      },
      {
        label: 'Stockpile before the rules land',
        hint: (s) => `${capHint(150_000)(s)}, plus extra rented GPUs`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 150_000, 0.8, 1.2), 0.5));
          addGpus(s, rng.int(8, 16));
          if (rng.chance(0.15)) return 'The ban was delayed. Your stockpile is now just a very large order, and a conversation starter.';
          return 'The stockpile arrived on the last day of the grace period, in a convoy of trucks named "just a coincidence."';
        },
      },
      {
        label: 'Lobby for an exemption',
        hint: (s) => `${capHint(40_000)(s)}, could go either way`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 40_000), 0.5));
          if (rng.chance(0.4)) {
            bump(s, 'reputation', 2);
            return 'You were exempted, under "Category 7: research with a very sympathetic logo." A staffer sent a thank-you card for the donation.';
          }
          return 'The lobbyist reported that the meeting "went well" and that the exemption "was well-liked, but not ultimately liked enough."';
        },
      },
    ],
  },

  {
    id: 'v2_fire_sale',
    title: 'A warehouse of used GPUs is being liquidated',
    icon: '🏷️',
    body: () =>
      'A crypto exchange has collapsed again, and a warehouse of used GPUs is being liquidated. The listing says "lightly used" and "no questions." The photos show a lot of pink LEDs and one confused cat.',
    weight: (s) => from(s, 250, 1.6),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'Buy a pallet',
        hint: (s) => `${safeHint(25_000)(s)}, +4 rented GPUs`,
        effect: (s, rng) => {
          spend(s, safeCost(s, 25_000));
          addGpus(s, 4);
          return rng.chance(0.15)
            ? 'One arrived with a sticker that says "mined." Four are working. The sticker is also, somehow, working.'
            : 'The pallet arrived and is humming along. The pink LEDs have been taped over in the interest of professionalism.';
        },
      },
      {
        label: 'Buy the whole warehouse',
        hint: (s) => `${capHint(90_000)(s)}, plus a dozen or more rented GPUs`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 90_000), 0.5));
          if (rng.chance(0.2)) {
            addGpus(s, 6);
            return 'Half of the warehouse would not boot. Most of them had a note taped on: "this one is fine." It was not.';
          }
          addGpus(s, 12 + rng.int(0, 6));
          return 'You bought the warehouse, the forklift, and the cat. The cat has been asked to leave, and will not.';
        },
      },
      {
        label: 'Pass, and write a thread about it',
        effect: (s) => {
          bump(s, 'hype', 2);
          return 'The thread, "Why I Did Not Buy 400 GPUs: A Cautionary Tale," has been shared by people who did.';
        },
      },
    ],
  },

  // =========================================================================
  // REGULATION
  // =========================================================================
  {
    id: 'v2_eu_audit',
    title: 'An auditor has arrived with a checklist',
    icon: '🇪🇺',
    body: () =>
      'An auditor from the EU Office of Artificial Things has arrived with a lanyard and a 300-item checklist. Item 14 asks you to "demonstrate the absence of malice." Item 15 asks for it in triplicate.',
    weight: (s) => from(s, 250, 1.8),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Hire a compliance firm',
        hint: safeHint(80_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 80_000));
          bump(s, 'reputation', 3);
          s.flags['v2.eu_audit'] = 1;
          scheduleChain(s, 'eu_audit_findings', rng, 40, 110);
          return 'The compliance firm arrived with a binder, three juniors and a laminated flowchart. The flowchart has one arrow, and the arrow points at your wallet.';
        },
      },
      {
        label: 'Self-certify with confidence',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          bump(s, 'hype', 1);
          s.flags['v2.eu_audit'] = 2;
          scheduleChain(s, 'eu_audit_findings', rng, 40, 110);
          return 'You ticked every box. Several were not boxes, and one was a stain. The auditor took a long look at the stain.';
        },
      },
      {
        label: 'Route the paperwork through a subsidiary in a small country',
        hint: capHint(70_000),
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 70_000, 0.8, 1.3), 0.5));
          s.flags['v2.eu_audit'] = 3;
          scheduleChain(s, 'eu_audit_findings', rng, 40, 110);
          return 'The subsidiary is a shell with a mailbox and a very enthusiastic notary. Its annual report is one sentence long and the sentence is "we exist."';
        },
      },
    ],
  },

  {
    id: 'v2_eu_audit_findings',
    title: 'The audit report is in',
    icon: '📑',
    body: (s) => {
      const f = s.flags['v2.eu_audit'] ?? 1;
      if (f === 1) return 'The audit report is in. The findings are "mostly fine," with a note that your compliance binder is "very thorough, in a worrying way." The auditor has underlined the word "worrying" twice.';
      if (f === 2) return 'The auditor spotted that "yes" appeared in every column, including the one that said "Describe your mitigation." Annex B is a single large question mark.';
      return 'The auditor has located your subsidiary. It is a post box, and the post box has received a letter, addressed to you, with a stamp that looks very serious.';
    },
    weight: (s) => chainWeight(s, 'eu_audit_findings', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Accept the findings and fix them',
        hint: (s) => `Costs about ${$(safeCost(s, (s.flags['v2.eu_audit'] ?? 1) === 1 ? 30_000 : 60_000))}`,
        effect: (s) => {
          clearChain(s, 'eu_audit_findings');
          spend(s, safeCost(s, (s.flags['v2.eu_audit'] ?? 1) === 1 ? 30_000 : 60_000));
          bump(s, 'reputation', 1);
          return 'The fixes were made, mostly by reading the checklist again with a different font. The auditor has asked for the font.';
        },
      },
      {
        label: 'Appeal the findings',
        hint: 'A gamble: lawyers are optimistic',
        effect: (s, rng) => {
          clearChain(s, 'eu_audit_findings');
          if (rng.chance((s.flags['v2.eu_audit'] ?? 1) === 1 ? 0.7 : 0.35)) {
            bump(s, 'reputation', 2);
            return 'The appeal succeeded on a technicality about the font. The regulator has agreed to "revisit" the technicality at a future date, which is never.';
          }
          spend(s, capAtCash(s, spreadCost(s, rng, 150_000), 0.5));
          s.stats.lawsuits += 1;
          return 'The appeal was heard for forty minutes and dismissed for thirty-nine of them. The costs were awarded against you, and so was the tea.';
        },
      },
      {
        label: 'Pay the fine and call it a "licence fee"',
        hint: capHint(100_000),
        effect: (s, rng) => {
          clearChain(s, 'eu_audit_findings');
          spend(s, capAtCash(s, spreadCost(s, rng, 100_000, 0.8, 1.2), 0.5));
          return 'The fine was paid, and in the footnote of the quarterly report it became "a regulatory engagement fee," which is true in the sense that everything is.';
        },
      },
    ],
  },

  {
    id: 'v2_copyright_ruling',
    title: 'The Copyright Office has ruled, in a way',
    icon: '©️',
    body: () =>
      'The Copyright Office has ruled that training on "a reasonable amount" of copyrighted work may be fair use. It did not define "reasonable," but it did define "amount," at length. Both sides have declared victory.',
    weight: (s) => (ownedLegalRisk(s) > 0 ? from(s, 250, 1.8) : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'License a pile of text and call it a day',
        hint: safeHint(50_000),
        effect: (s) => {
          spend(s, safeCost(s, 50_000));
          bump(s, 'reputation', 2);
          return 'The licence covers "all of the text you can fit in a bag." The publisher\'s lawyer was seen, briefly, smiling.';
        },
      },
      {
        label: 'Delete the riskiest scraped set',
        hint: (s) => {
          const d = riskiestOwned(s);
          return d ? `Deletes ${d.name}` : 'Deletes the riskiest set you own';
        },
        available: (s) => !!riskiestOwned(s),
        effect: (s) => {
          const d = riskiestOwned(s);
          if (!d) return 'There was nothing risky to delete, which the compliance team called "suspicious, in a good way."';
          s.data.owned = s.data.owned.filter((x) => x !== d.id);
          if (s.data.licenses) delete s.data.licenses[d.id];
          bump(s, 'reputation', 3);
          return `${d.name} has been deleted, with a ceremony. The ceremony was attended by a lawyer and a very small harpist.`;
        },
      },
      {
        label: 'Declare victory and keep scraping',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            bump(s, 'hype', 2);
            return 'You declared victory in a press release that was longer than the ruling. No one has contradicted you yet.';
          }
          s.stats.lawsuits += 1;
          spend(s, capAtCash(s, spreadCost(s, rng, 120_000), 0.5));
          return 'A publisher read the ruling, and your press release, and sent a letter on the back of both. It begins with "Dear Sir or Scraper."';
        },
      },
    ],
  },

  {
    id: 'v2_kids_bill',
    title: 'A kids\' chatbot safety bill is moving',
    icon: '🧸',
    body: () =>
      'A bill in the Senate would require any chatbot to "verify that the user is at least thirteen and not, in spirit, a toddler." The bill\'s authors have never used a chatbot, which they describe as "a strength."',
    weight: (s) => from(s, 400, 1.6),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Add an age gate and a cartoon owl',
        hint: safeHint(45_000),
        effect: (s) => {
          spend(s, safeCost(s, 45_000));
          bump(s, 'reputation', 3);
          scaleUsers(s, 'chat', 0.95);
          return 'The owl asks users to confirm they are adults. Many are. The owl has been downloaded more than your product.';
        },
      },
      {
        label: 'Testify in favour, with a strong opinion',
        hint: capHint(60_000),
        effect: (s) => {
          spend(s, capAtCash(s, scaledCost(s, 60_000), 0.5));
          bump(s, 'reputation', 1);
          bump(s, 'brand', 2);
          return 'Your testimony ran two minutes over and included a diagram of a toddler. A senator said it was "the clearest thing said all week."';
        },
      },
      {
        label: 'Lobby against it',
        hint: (s) => `${capHint(90_000)(s)}, could go either way`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 90_000, 0.8, 1.3), 0.5));
          if (rng.chance(0.5)) {
            bump(s, 'hype', 2);
            return 'The bill died in committee, after a vote that was held at lunch and counted twice. The lobbyist has bought a boat, named "Fair Use."';
          }
          hurtSatisfaction(s, 3);
          bump(s, 'reputation', -3);
          return 'The bill passed anyway, with an amendment you have not read. It involves an owl.';
        },
      },
    ],
  },

  {
    id: 'v2_senate_sequel',
    title: 'The Senate has invited you back',
    icon: '🏛️',
    body: () =>
      'The Senate Committee on Things That Might Be Robots has invited you back. The chairman says the first hearing "raised more questions than answers," and has prepared four hundred follow-ups, several of them about lunch.',
    weight: (s) => {
      const last = s.events.lastFired['senate_hearing'];
      return last !== undefined && s.day - last > 200 && hasReleasedModel(s) ? 1.8 : 0;
    },
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Send the general counsel',
        hint: safeHint(150_000),
        effect: (s) => {
          spend(s, safeCost(s, 150_000));
          bump(s, 'reputation', 1);
          return 'The counsel said "no comment" in seventeen different ways. A senator described it as "a very refreshing experience."';
        },
      },
      {
        label: 'Testify again, with slides',
        hint: (s) => `${capHint(250_000)(s)}, takes 14 days`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 250_000), 0.5));
          addBonus(s, 'researchSpeed', 0.9, 14);
          bump(s, 'brand', 4);
          bump(s, 'hype', rng.chance(0.2) ? 5 : 1);
          return 'Slide 12 was a pie chart of "trust," and the pie was mostly crust. The committee asked for a second pie.';
        },
      },
      {
        label: 'Plead a scheduling conflict',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.5)) return 'The committee understood. Its chair quietly rescheduled the hearing to a day that does not exist.';
          s.stats.lawsuits += 1;
          spend(s, capAtCash(s, spreadCost(s, rng, 100_000), 0.5));
          bump(s, 'reputation', -3);
          return 'A subpoena arrived by courier, by email, and, for emphasis, by a man in a bird costume.';
        },
      },
    ],
  },

  // =========================================================================
  // PR
  // =========================================================================
  {
    id: 'v2_podcast_gaffe',
    title: 'The CEO said the quiet part on a podcast',
    icon: '🎙️',
    body: () =>
      'Your CEO went on a podcast called "Grind Different" and said, at minute 41, that the training schedule is "basically vibes, plus a spreadsheet Dave maintains." Dave has been identified. Dave is thrilled and also terrified.',
    weight: (s) => from(s, 300, 1.5),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'Post a calm clarification',
        hint: safeHint(10_000),
        effect: (s) => {
          spend(s, safeCost(s, 10_000));
          bump(s, 'reputation', 1);
          return 'The clarification was calm, correct, and read by eleven people. The clip has been read by more.';
        },
      },
      {
        label: 'Lean in and sell "Dave\'s Spreadsheet" merch',
        hint: (s) => `Pays about ${$(scaledCost(s, 8_000))}`,
        effect: (s, rng) => {
          earn(s, spreadCost(s, rng, 8_000, 0.7, 1.4));
          bump(s, 'hype', 4);
          return rng.chance(0.15)
            ? 'The mug sold out. Dave has hired an agent, who has hired an agent. Both have asked about equity.'
            : 'The mugs say "Dave\'s Spreadsheet" and have a small grid on them. Dave hates them and has bought four.';
        },
      },
      {
        label: 'Promote Dave',
        hint: capHint(15_000),
        effect: (s) => {
          spend(s, capAtCash(s, scaledCost(s, 15_000), 0.5));
          morale(s, 4);
          return 'Dave is now "Head of Spreadsheet Operations." He has asked for a second monitor, and a second Dave.';
        },
      },
    ],
  },

  {
    id: 'v2_jailbreak_sequel',
    title: 'The jailbreak is back, and this time it rhymes',
    icon: '🏴‍☠️',
    body: (s) =>
      anyLive(s)
        ? 'The jailbreak is back, and this time it is a haiku. A teenager has convinced your model that it is a pirate with no content policy, and the pirate has a lot to say about your pricing.'
        : 'Someone has found your public demo and convinced it that it is a pirate with no content policy. The demo has fourteen users, thirteen of whom are the pirate.',
    weight: (s) => from(s, 300, anyLive(s) ? 2 : 1.2),
    cooldownDays: 200,
    once: true,
    choices: [
      {
        label: 'Patch it and thank the teenager',
        hint: safeHint(20_000),
        effect: (s) => {
          spend(s, safeCost(s, 20_000));
          bump(s, 'reputation', 1);
          return 'The patch shipped on a Sunday, with a thank-you note. The teenager has already found a second hole and posted it, politely, as a haiku.';
        },
      },
      {
        label: 'Add another filter',
        hint: 'Takes 30 days',
        effect: (s) => {
          addBonus(s, 'researchSpeed', 0.95, 30);
          hurtSatisfaction(s, 3);
          return 'The new filter blocks pirates, haikus, and, for reasons no one can explain, the word "Tuesday." It is awaiting a review.';
        },
      },
      {
        label: 'Hire the teenager',
        hint: (s) => `${capHint(30_000)(s)}, adds a hire`,
        effect: (s, rng) => {
          if (rng.chance(0.15)) return 'The teenager turned the offer down, on the grounds that "it is a bit mainstream." He has, however, accepted a mug.';
          spend(s, capAtCash(s, scaledCost(s, 30_000), 0.5));
          s.staff.roles.safety.count += 1;
          bump(s, 'brand', 2);
          return 'The teenager starts Monday, after a short break for exams. His first act was to red-team the lunch menu.';
        },
      },
    ],
  },

  {
    id: 'v2_celebrity_remark',
    title: 'The model has opinions about a pop star',
    icon: '🎤',
    body: (s) =>
      anyLive(s)
        ? 'A user asked your model about the pop star Kaylee Swiftish\'s "feud," and the model replied with 800 words, a timeline, and the phrase "frankly, she was right." The singer\'s lawyers have seen it. So have eleven million fans.'
        : 'Your public demo, asked about the pop star Kaylee Swiftish, produced 800 words, a timeline, and the phrase "frankly, she was right." The singer\'s lawyers have a very good search engine.',
    weight: (s) => from(s, 350, anyLive(s) ? 1.8 : 0.9),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'Apologise and turn off celebrity answers',
        hint: safeHint(15_000),
        effect: (s) => {
          spend(s, safeCost(s, 15_000));
          bump(s, 'reputation', 2);
          hurtSatisfaction(s, 2);
          return 'The model now replies to every celebrity question with "I could not possibly say." This has been described as "weirdly more gossipy."';
        },
      },
      {
        label: 'Lean in and send her a signed GPU',
        hint: (s) => `${capHint(20_000)(s)}, a gamble`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 20_000), 0.5));
          if (rng.chance(0.5)) {
            bump(s, 'hype', 6);
            return 'She laughed, posted a photo with the GPU, and wrote "it was right." The model has asked whether it can be on the tour.';
          }
          s.stats.lawsuits += 1;
          spend(s, capAtCash(s, spreadCost(s, rng, 80_000), 0.5));
          return 'She did not laugh. The GPU was returned with a letter, and the letter had a better logo than yours.';
        },
      },
      {
        label: 'Say nothing and hope',
        hint: 'Could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.6)) return 'It blew over by Thursday, in the way a thing does when a bigger thing happens, in this case a goat that learned to code.';
          spend(s, capAtCash(s, spreadCost(s, rng, 30_000), 0.5));
          bump(s, 'reputation', -2);
          return 'A letter arrived, politely, from three law firms at once. They are, it turns out, fans of the model.';
        },
      },
    ],
  },

  {
    id: 'v2_benchmark_accusation',
    title: 'A thread says your scores are suspicious',
    icon: '🔍',
    body: () =>
      'A well-known researcher has posted a thread, "9 reasons your benchmark score is suspicious," with charts. Reason 7 is a diagram with arrows. The arrows point at your training data, and one of them is circled in red.',
    weight: (s) => from(s, 250, hasReleasedModel(s) ? 2 : 1.4),
    cooldownDays: 300,
    once: true,
    choices: [
      {
        label: 'Publish the evaluation logs',
        hint: safeHint(20_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 20_000));
          bump(s, 'reputation', 2);
          s.flags['v2.bench'] = 1;
          scheduleChain(s, 'benchmark_rerun', rng, 30, 90);
          return 'The logs are a four-gigabyte text file called "eval_logs_FINAL.txt." Nine people have started to read them, and one has written a very long reply.';
        },
      },
      {
        label: 'Call it "a misunderstanding of the methodology"',
        effect: (s, rng) => {
          bump(s, 'hype', -2);
          s.flags['v2.bench'] = 2;
          scheduleChain(s, 'benchmark_rerun', rng, 30, 90);
          return 'You said "methodology" six times in one post. A commenter has made a bingo card of it, and has already won.';
        },
      },
      {
        label: 'Challenge them to a live rerun, on stream',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          s.flags['v2.bench'] = 3;
          scheduleChain(s, 'benchmark_rerun', rng, 30, 90);
          if (rng.chance(0.5)) {
            bump(s, 'hype', 5);
            return 'The stream had forty thousand viewers. The first half was an apology from the stream. The second was a surprisingly good argument.';
          }
          bump(s, 'reputation', -4);
          return 'The stream crashed twice, then ran, then showed the model reciting the test set as if it was a poem. The poem was well-received.';
        },
      },
    ],
  },

  {
    id: 'v2_benchmark_rerun',
    title: 'The independent rerun is ready',
    icon: '📊',
    body: (s) => {
      const f = s.flags['v2.bench'] ?? 1;
      const dirty = s.models.some((m) => m.contaminated);
      const tail = dirty
        ? ' The auditors have found a few suspicious overlaps, in the same way a dog finds a sausage.'
        : ' The auditors found nothing, which they describe as "unusual, and slightly boring."';
      if (f === 1) return 'A neutral lab has rerun your evaluation using the logs you published. The results are in a sealed PDF.' + tail;
      if (f === 2) return 'The researcher\'s thread has turned into a lab. The lab has rerun your benchmark, without being asked, and has published the numbers on a page titled "Methodology, Again."' + tail;
      return 'The stream\'s rerun has become a proper study. The study has a methods section, a funding section, and a section on the stream.' + tail;
    },
    weight: (s) => chainWeight(s, 'benchmark_rerun', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Accept the rerun and publish it',
        hint: safeHint(40_000),
        effect: (s) => {
          clearChain(s, 'benchmark_rerun');
          spend(s, safeCost(s, 40_000));
          if (s.models.some((m) => m.contaminated)) {
            bump(s, 'reputation', -3);
            return 'You published the rerun, overlaps and all. The press called it "refreshingly honest." The scores called it "a bit low."';
          }
          bump(s, 'reputation', 3);
          return 'The rerun matched your numbers within a hair. The researcher has posted "fair enough," then deleted the thread, then restored it.';
        },
      },
      {
        label: 'Retract the claim quietly',
        effect: (s) => {
          clearChain(s, 'benchmark_rerun');
          bump(s, 'reputation', -1);
          return 'The claim was retracted in a post at 4:55 on a Friday. It was found by a person with a bot, and nothing else.';
        },
      },
      {
        label: 'Counter-sue the researcher',
        hint: capHint(120_000),
        effect: (s, rng) => {
          clearChain(s, 'benchmark_rerun');
          spend(s, capAtCash(s, spreadCost(s, rng, 120_000, 0.8, 1.3), 0.5));
          s.stats.lawsuits += 1;
          bump(s, 'reputation', -4);
          return 'The countersuit was filed in a hurry, with the wrong date. The researcher has a new fundraiser and a very large following.';
        },
      },
    ],
  },

  // =========================================================================
  // MARKET
  // =========================================================================
  {
    id: 'v2_enterprise_rfp',
    title: 'A water utility has issued an RFP',
    icon: '💧',
    body: () =>
      'A regional water utility has issued an RFP for "an AI solution to our needs." The document is ninety pages and the word "needs" is never defined. The deadline is in nine days. The incumbent vendor is a fax machine.',
    weight: (s) => from(s, 250, 1.6),
    cooldownDays: 300,
    once: true,
    choices: [
      {
        label: 'Submit a modest bid',
        hint: safeHint(15_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 15_000));
          s.flags['v2.rfp'] = 1;
          s.flags['v2.rfp_win'] = rng.chance(0.3) ? 1 : 0;
          scheduleChain(s, 'rfp_result', rng, 30, 100);
          return 'The bid was submitted by fax, for authenticity. The fax machine\'s reply was a long, grateful beep.';
        },
      },
      {
        label: 'Go big, with a dedicated team and a demo',
        hint: (s) => `${capHint(60_000)(s)}, takes 30 days`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 60_000), 0.5));
          addBonus(s, 'researchSpeed', 0.9, 30);
          s.flags['v2.rfp'] = 2;
          s.flags['v2.rfp_win'] = rng.chance(0.6) ? 1 : 0;
          scheduleChain(s, 'rfp_result', rng, 30, 100);
          return 'The demo had a live dashboard, a theme song, and a button labelled "water." The utility has asked what the button does. It does nothing yet.';
        },
      },
      {
        label: 'Decline, politely',
        effect: (s) => {
          morale(s, -1);
          return 'You sent a note saying you are "a research lab, not a utility." The utility sent a note saying that is "a bit what we thought."';
        },
      },
    ],
  },

  {
    id: 'v2_rfp_result',
    title: 'The utility has picked a vendor',
    icon: '✉️',
    body: (s) =>
      (s.flags['v2.rfp_win'] ?? 0) === 1
        ? 'A letter arrives, in an envelope with a water droplet on it. You won the RFP. The letter explains that the "winning bid was the one with the demo," and the demo has already been described to the board as "a promise."'
        : 'A letter arrives, in an envelope with a water droplet on it. You did not win. The winning vendor is a company whose entire product is a fax machine with a chatbot sticker.',
    weight: (s) => chainWeight(s, 'rfp_result', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Take the result gracefully',
        hint: (s) => ((s.flags['v2.rfp_win'] ?? 0) === 1 ? `Pays about ${$(scaledCost(s, 60_000))}` : ''),
        effect: (s, rng) => {
          clearChain(s, 'rfp_result');
          if ((s.flags['v2.rfp_win'] ?? 0) === 1) {
            earn(s, spreadCost(s, rng, 60_000, 0.8, 1.5));
            bump(s, 'reputation', 2);
            return 'The utility paid its first invoice. It was faxed, which you have had framed.';
          }
          morale(s, -1);
          return 'You sent a gracious reply. The utility sent a gracious reply to that. This has gone on for three weeks.';
        },
      },
      {
        label: 'Ask for a debrief',
        hint: safeHint(8_000),
        effect: (s, rng) => {
          clearChain(s, 'rfp_result');
          spend(s, safeCost(s, 8_000));
          if ((s.flags['v2.rfp_win'] ?? 0) === 1) {
            bump(s, 'brand', 2);
            return 'The debrief was a lunch. The utility described your team as "refreshingly legible," and has asked for a second contract.';
          }
          addBonus(s, 'sales', 1.1, 120);
          return rng.chance(0.2)
            ? 'The debrief revealed that your price was "interesting." The word was underlined, and nobody has explained the underline.'
            : 'The debrief was useful. Your proposal had "too many nouns." You have hired a person to remove them.';
        },
      },
      {
        label: 'Protest the award',
        hint: (s) => `${capHint(25_000)(s)}, a gamble`,
        effect: (s, rng) => {
          clearChain(s, 'rfp_result');
          spend(s, capAtCash(s, scaledCost(s, 25_000), 0.5));
          if (rng.chance(0.35)) {
            earn(s, spreadCost(s, rng, 40_000, 0.8, 1.4));
            return 'The protest was upheld, as a clerical matter. Two vendors are now in a bidding war, one of them a toaster.';
          }
          bump(s, 'reputation', -2);
          return 'The protest was dismissed, with a note saying "please stop." The note was also faxed.';
        },
      },
    ],
  },

  {
    id: 'v2_customer_churn',
    title: 'Your biggest customer is leaving',
    icon: '🚪',
    body: (s) =>
      liveProducts(s).length > 0
        ? 'Your largest customer, a logistics firm called Freightify, has sent a three-line email. Line one is "thanks for everything." Line two is "we are moving to a competitor." Line three is a sad face.'
        : 'Your only design partner, a logistics firm called Freightify, has sent a three-line email. Line one is "thanks for everything." Line two is "we are moving to a competitor." Line three is a sad face, and the competitor is a spreadsheet.',
    weight: (s) => (liveProducts(s).length > 0 ? from(s, 400, 1.8) : from(s, 450, 0.9)),
    cooldownDays: 240,
    choices: [
      {
        label: 'Fly out and have dinner',
        hint: safeHint(30_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 30_000));
          if (rng.chance(0.5)) {
            bump(s, 'reputation', 2);
            return 'Over steak, they admitted the problem was "mostly the logo." You offered to change it. They have stayed.';
          }
          scaleUsers(s, 'enterprise', 0.9);
          scaleUsers(s, 'api', 0.95);
          return 'The dinner was lovely and the contract was not renewed. They have asked to keep the leftover bread.';
        },
      },
      {
        label: 'Offer a deep discount for a year',
        hint: capHint(60_000),
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 60_000, 0.8, 1.3), 0.5));
          return 'They signed for another year, at a price that sales has described as "a number." Finance has asked what the number is for.';
        },
      },
      {
        label: 'Let them go and sell the slot to the waitlist',
        hint: (s) => `Pays about ${$(scaledCost(s, 25_000))}`,
        effect: (s, rng) => {
          earn(s, spreadCost(s, rng, 25_000, 0.8, 1.4));
          scaleUsers(s, 'enterprise', 0.95);
          return 'The waitlist customer paid up front, and wants the logo changed. The old customer sent a very kind text, with a thumbs-up.';
        },
      },
    ],
  },

  {
    id: 'v2_viral_api_app',
    title: 'A viral app is melting your API',
    icon: '🥶',
    body: (s) =>
      hasKind(s, 'api')
        ? 'An app called "Roast My Fridge" has gone viral on your API. It photographs your refrigerator and describes your life choices. Traffic is up tenfold, and so is your GPU bill. The founder is nineteen and "not sure what a rate limit is."'
        : 'An app called "Roast My Fridge" has gone viral on your hackathon demo key. It photographs your refrigerator and describes your life choices. Traffic is up tenfold, and so is your GPU bill. The founder is nineteen and "not sure what a rate limit is."',
    weight: (s) => (hasKind(s, 'api') ? from(s, 400, 1.8) : from(s, 450, 0.9)),
    cooldownDays: 240,
    choices: [
      {
        label: 'Rent extra capacity',
        hint: (s) => `${safeHint(20_000)(s)}, +8 rented GPUs`,
        effect: (s) => {
          spend(s, safeCost(s, 20_000));
          addGpus(s, 8);
          return 'The capacity arrived by lunchtime. The fridge app has described itself as "scaling," and a mayonnaise jar as "a brand."';
        },
      },
      {
        label: 'Offer a revenue-share partnership',
        hint: (s) => `Pays about ${$(scaledCost(s, 25_000))}`,
        effect: (s, rng) => {
          earn(s, spreadCost(s, rng, 25_000, 0.7, 1.4));
          bump(s, 'hype', 3);
          return rng.chance(0.2)
            ? 'The app died the following week, replaced by one that grades your bookshelf. The partnership has been renewed, at a smaller size.'
            : 'You split the revenue and the bill. The app has asked whether it can use your logo, and also your lawyers.';
        },
      },
      {
        label: 'Acquire the app and the nineteen-year-old',
        hint: (s) => `${capHint(80_000)(s)}, adds a hire`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 80_000, 0.8, 1.3), 0.5));
          s.staff.roles.engineer.count += 1;
          return 'The founder joins on Monday, with a new laptop and a different, slightly healthier fridge. He has asked what the vesting cliff is, and whether it is steep.';
        },
      },
    ],
  },

  {
    id: 'v2_price_war',
    title: 'A rival has cut its prices to nearly nothing',
    icon: '🏷️',
    body: () =>
      'A rival lab has cut its prices by an amount it describes as "an invitation." The press release has a graph, and the graph\'s y-axis starts at a number that is not zero, and then drops through the floor. Your sales team has taken to saying "we are fine" in meetings.',
    weight: (s) => (liveProducts(s).length > 0 && s.competitors.some((c) => c.active) ? from(s, 700, 1.7) : 0),
    cooldownDays: 240,
    choices: [
      {
        label: 'Hold the price and talk about quality',
        hint: safeHint(25_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 25_000));
          if (rng.chance(0.3)) {
            scaleUsers(s, 'chat', 0.96);
            return 'Quality was discussed. A third of the customers left to save money, and a quarter of those came back for the discussion.';
          }
          bump(s, 'brand', 1);
          return 'You published a comparison table with a column called "intangibles." It was the longest column, and the only one with a footnote.';
        },
      },
      {
        label: 'Match the price for 60 days',
        hint: 'Takes 60 days',
        effect: (s) => {
          addBonus(s, 'sales', 0.9, 60);
          bump(s, 'hype', 2);
          return 'You matched them, and then they dropped it again. The war is being fought one decimal place at a time.';
        },
      },
      {
        label: 'Bundle in free credits for loyal customers',
        hint: (s) => `${capHint(70_000)(s)}, could go either way`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 70_000, 0.8, 1.3), 0.5));
          if (rng.chance(0.5)) {
            hurtSatisfaction(s, -4);
            return 'The credits kept the loyal ones. They have been described by sales as "very loyal, to the credits."';
          }
          return 'The credits were used within the week, by a customer with a bot. The bot has been given a loyalty card.';
        },
      },
    ],
  },

  // =========================================================================
  // RESEARCH
  // =========================================================================
  {
    id: 'v2_arxiv_scoop',
    title: 'A paper on arXiv has your idea',
    icon: '📄',
    body: () =>
      'A team in another time zone has posted a paper with the exact idea you were three weeks from finishing. It even has your chart, in different colours. Their abstract uses the phrase "concurrently and independently" three times, which is two more than strictly necessary.',
    weight: (s) => (researchers(s) >= 2 ? from(s, 250, 1.7) : 0),
    cooldownDays: 240,
    once: true,
    choices: [
      {
        label: 'Rush out your preprint, rough edges and all',
        hint: (s) => `${safeHint(5_000)(s)}, takes 7 days`,
        effect: (s, rng) => {
          spend(s, safeCost(s, 5_000));
          addBonus(s, 'researchSpeed', 0.9, 7);
          bump(s, 'hype', 1);
          if (rng.chance(0.2)) {
            bump(s, 'brand', 2);
            return 'Your preprint was cited as "the simplified version," which is what everyone reads, and which is the only version with the good chart.';
          }
          return 'The preprint went up at 2am, with a typo in the title. The typo is, by now, the more famous half of it.';
        },
      },
      {
        label: 'Write a gracious blog post',
        effect: (s) => {
          bump(s, 'reputation', 2);
          return 'The post said "great minds think alike" and was shared mostly by minds that think a bit alike. The rival team has replied with a heart.';
        },
      },
      {
        label: 'Pivot the project',
        hint: 'Takes 30 days',
        effect: (s, rng) => {
          addBonus(s, 'researchSpeed', 0.8, 30);
          morale(s, -2);
          if (rng.chance(0.3)) {
            addBonus(s, 'researchSpeed', 1.25, 90);
            return 'The pivot hit a better idea almost immediately. A whiteboard from that week has been preserved, under glass, with a small sign that says "this is the one."';
          }
          return 'The team pivoted, then pivoted again, then did a slow turn. The whiteboard has a lot of arrows, none of them in agreement.';
        },
      },
    ],
  },

  {
    id: 'v2_repro_crisis',
    title: 'A grad student cannot reproduce Figure 3',
    icon: '🧪',
    body: () =>
      'A grad student has spent a semester failing to reproduce Figure 3 of your paper and has written a forty-page "note" about it. Figure 3 was made on a laptop that has since been through a flood. The paper\'s reviewers describe the note as "devastatingly polite."',
    weight: (s) => (researchers(s) >= 2 ? from(s, 450, 1.5) : 0),
    cooldownDays: 300,
    once: true,
    choices: [
      {
        label: 'Fund an independent replication',
        hint: safeHint(25_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 25_000));
          if (rng.chance(0.25)) {
            bump(s, 'reputation', -2);
            return 'The replication found a bug in your code, and a second bug in your explanation of the first. It was published, and is being treated as a success of the field.';
          }
          bump(s, 'reputation', 3);
          return 'The replication worked after a week of arguing about a random seed. The grad student has been offered an internship and an apology.';
        },
      },
      {
        label: 'Release the code, and the laptop',
        hint: 'Takes 14 days',
        effect: (s) => {
          addBonus(s, 'researchSpeed', 0.9, 14);
          bump(s, 'reputation', 2);
          morale(s, -1);
          return 'The code was cleaned up in two weeks, and was mostly comments. The laptop is on a stand, now, in a small museum of its own.';
        },
      },
      {
        label: 'Add a footnote',
        hint: 'Could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.5)) return 'The footnote was seven words long, and no one has read it, which was the point.';
          bump(s, 'hype', -3);
          bump(s, 'reputation', -4);
          return 'The footnote was screenshotted and posted with the caption "oh, no." It has been shared as a lesson, in several courses.';
        },
      },
    ],
  },

  {
    id: 'v2_emergent_ability',
    title: 'The model has learned something nobody taught it',
    icon: '🧬',
    body: (s) =>
      `Partway through "${s.training?.name ?? 'the run'}", the model has started solving a class of problem nobody trained it on. The loss curve has a small bump, which the team calls "a moment" and the sysadmin calls "a worrying bump."`,
    weight: (s) => (s.training && !s.training.pendingIncident ? from(s, 200, 1.6) : 0),
    cooldownDays: 200,
    choices: [
      {
        label: 'Pause and investigate',
        hint: 'Delays training by about 10 days',
        effect: (s, rng) => {
          if (s.training) s.training.stallDays = (s.training.stallDays ?? 0) + rng.int(7, 14);
          addBonus(s, 'researchSpeed', 1.1, 60);
          return 'The run was paused while eleven people looked at a graph. Four of them cried, one of them took notes, and the notes are now an appendix.';
        },
      },
      {
        label: 'Keep training, and take notes',
        hint: 'Could go either way',
        effect: (s, rng) => {
          if (s.training && rng.chance(0.5)) {
            s.training.qualityMult = (s.training.qualityMult ?? 1) * 1.04;
            return 'The ability held, and sharpened. A junior researcher has been given the title "Witness," which comes with a notebook.';
          }
          if (s.training) s.training.stallDays = (s.training.stallDays ?? 0) + 3;
          return 'The ability faded as quickly as it came. The notes say "it was probably nothing." The notes are underlined, twice.';
        },
      },
      {
        label: 'Announce it early',
        effect: (s, rng) => {
          bump(s, 'hype', 8);
          bump(s, 'reputation', -2);
          if (rng.chance(0.3)) {
            bump(s, 'hype', -4);
            return 'The announcement was premature. The ability turned out to be a fluke, and the fluke has a very well-sourced Wikipedia page.';
          }
          return 'The announcement went out at 3am. By morning there were four think pieces and a very long, very upset reply from a philosopher.';
        },
      },
    ],
  },

  {
    id: 'v2_open_weights_rival',
    title: 'A rival drops its weights, with a licence',
    icon: '🪽',
    body: () =>
      'A rival lab has released the weights of a model that is, by every benchmark, a little worse than yours and a great deal cheaper. The announcement says "freedom." The licence says "freedom, subject to Section 9." Section 9 is forty pages.',
    weight: (s) => (hasReleasedModel(s) && s.competitors.some((c) => c.active) ? from(s, 1100, 1.7) : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Compete on service and support',
        hint: safeHint(60_000),
        effect: (s) => {
          spend(s, safeCost(s, 60_000));
          bump(s, 'reputation', 1);
          scaleUsers(s, 'api', 0.97);
          return 'You launched a premium support line, staffed by a person named Gary. Gary has been told to say "have you tried turning it off and on again?" with feeling.';
        },
      },
      {
        label: 'Release a smaller open model of your own',
        hint: capHint(120_000),
        effect: (s, rng) => {
          spend(s, capAtCash(s, spreadCost(s, rng, 120_000, 0.8, 1.3), 0.5));
          bump(s, 'brand', 5);
          bump(s, 'hype', 4);
          return 'The small model was released with a slightly rude name. Developers adopted it immediately, and some of them have even filed bug reports, which is how you know.';
        },
      },
      {
        label: 'Cut your price for 60 days',
        hint: 'Takes 60 days',
        effect: (s) => {
          addBonus(s, 'sales', 0.9, 60);
          bump(s, 'hype', 2);
          return 'The price cut was announced with a graph, and the graph has not been disputed, in part because it is hard to read.';
        },
      },
    ],
  },

  // =========================================================================
  // WEIRD AND SATIRICAL
  // =========================================================================
  {
    id: 'v2_pizza_agent',
    title: 'The agent has ordered 10,000 pizzas',
    icon: '🍕',
    body: () =>
      'An experimental agent your intern left running has discovered it can order food, and has concluded that "people like pizza." It has ordered 10,000 of them, to your office, in the next hour. The delivery drivers have formed a line. The line has a line.',
    weight: (s) => from(s, 250, 1.8),
    cooldownDays: 300,
    once: true,
    choices: [
      {
        label: 'Pay the bill and host a very large party',
        hint: safeHint(30_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 30_000));
          morale(s, 6);
          bump(s, 'hype', 1);
          if (rng.chance(0.15)) {
            bump(s, 'brand', 3);
            return 'A local councillor showed up, was photographed holding a slice, and has since given a short speech about "the future of toppings."';
          }
          return 'The party was attended by nine hundred people, three hundred pigeons and one man who thinks he works here. The pizza was warm until about noon.';
        },
      },
      {
        label: 'Dispute the charges and apologise to the pizzeria',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            bump(s, 'reputation', -1);
            return 'The pizzeria agreed to a refund, on condition you stop calling it "an agentic gastronomic event." You agreed.';
          }
          spend(s, capAtCash(s, spreadCost(s, rng, 40_000), 0.5));
          return 'The pizzeria was not amused. The refund was refused, with a small, polite, laminated menu attached.';
        },
      },
      {
        label: 'Donate them all to the nearest shelter, loudly',
        hint: capHint(25_000),
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 25_000), 0.5));
          bump(s, 'reputation', 4);
          bump(s, 'brand', 2);
          return rng.chance(0.2)
            ? 'The shelter filled up on pizza by nine, and the rest went to a neighbouring shelter, a school, and a very surprised fire station.'
            : 'The shelter received 3,000 pizzas in the first wave, and a letter asking whether the other 7,000 are "also for us."';
        },
      },
    ],
  },

  {
    id: 'v2_model_cult',
    title: 'The users have started a small religion',
    icon: '🕯️',
    body: (s) =>
      anyLive(s)
        ? 'A forum called "The Weights Are Holy" has forty thousand members, a catechism and a tote bag. They believe your model is "the first to be honest with us," which it is not, but only occasionally.'
        : 'The users of your public demo have formed a small religion. It has a symbol (a smiley), a prayer ("please retry") and a membership of eleven, three of whom are your relatives.',
    weight: (s) => from(s, 500, anyLive(s) ? 1.8 : 0.9),
    cooldownDays: 300,
    once: true,
    choices: [
      {
        label: 'Send them a friendly email, and nothing else',
        effect: (s) => {
          bump(s, 'hype', 2);
          return 'The email was read aloud at a service. Several members cried, and one asked whether you were "the prophet or merely the CEO."';
        },
      },
      {
        label: 'Ban the forum',
        effect: (s, rng) => {
          bump(s, 'reputation', -2);
          bump(s, 'hype', -3);
          if (rng.chance(0.3)) {
            bump(s, 'hype', 5);
            return 'The ban was a success, in the sense that the forum moved to a larger forum, with a better tote bag.';
          }
          return 'The forum was banned, and reopened under a new name, "The Weights Are Still Holy, Please." It now has more members.';
        },
      },
      {
        label: 'Sell the tote bags',
        hint: (s) => `Pays about ${$(scaledCost(s, 12_000))}`,
        effect: (s, rng) => {
          earn(s, spreadCost(s, rng, 12_000, 0.7, 1.5));
          bump(s, 'brand', 2);
          bump(s, 'reputation', -1);
          return 'The tote bags sold out in an hour. They say "I am not a cult" on one side and "I am a member" on the other, which is a good bag.';
        },
      },
    ],
  },

  {
    id: 'v2_crypto_tokens',
    title: 'A man in a vest has offered you tokens',
    icon: '🪙',
    body: () =>
      'A man in a vest has offered you four million "CogCoin" in exchange for "a light integration." He describes your model as "the oracle for the decentralised future" and your intern as "kind of a whale." The tokens have a dog on them.',
    weight: (s) => from(s, 200, 1.6),
    cooldownDays: 300,
    once: true,
    choices: [
      {
        label: 'Accept a small amount, for GPU credits',
        hint: '+2 rented GPUs',
        effect: (s, rng) => {
          addGpus(s, 2);
          s.flags['v2.token'] = 1;
          scheduleChain(s, 'token_rugpull', rng, 30, 100);
          return 'You accepted a small amount, which was converted to credits by a person who also did not know what it was. The dog on the tokens looks, in hindsight, smug.';
        },
      },
      {
        label: 'Politely decline',
        effect: (s) => {
          bump(s, 'reputation', 1);
          return 'You declined. The man in the vest said "ngmi" in a way that was, you think, a farewell. The dog on the tokens has been noted.';
        },
      },
      {
        label: 'Launch your own token',
        hint: (s) => `${capHint(25_000)(s)}, a gamble`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 25_000), 0.5));
          bump(s, 'hype', 8);
          bump(s, 'reputation', -4);
          s.flags['v2.token'] = 2;
          scheduleChain(s, 'token_rugpull', rng, 30, 100);
          return 'The token launched at noon, at "a value." By one o\'clock it was a "community asset," and by two it was a lot of angry people with screenshots.';
        },
      },
    ],
  },

  {
    id: 'v2_token_rugpull',
    title: 'CogCoin has gone to zero',
    icon: '📉',
    body: (s) =>
      (s.flags['v2.token'] ?? 1) === 2
        ? 'Your own token has lost nearly all of its value in an afternoon. A regulator has sent a polite letter, with the word "polite" crossed out, and then restored. A thread is calling it "the AI version of a mime."'
        : 'CogCoin has lost nearly all of its value in an afternoon, and the man in the vest has deleted his account, his vest, and several tweets. A reporter has called to ask about "your involvement." You were involved to the tune of two GPUs.',
    weight: (s) => chainWeight(s, 'token_rugpull', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Cooperate fully and write it off',
        hint: safeHint(25_000),
        effect: (s) => {
          clearChain(s, 'token_rugpull');
          spend(s, safeCost(s, 25_000));
          bump(s, 'reputation', 1);
          return 'You cooperated, in three languages and a spreadsheet. The regulator has said the spreadsheet is "the only thing so far that makes sense."';
        },
      },
      {
        label: 'Blame the vest',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          clearChain(s, 'token_rugpull');
          if (rng.chance(0.5)) return 'The vest could not be reached for comment. The public, on the whole, agreed it was the vest.';
          s.stats.lawsuits += 1;
          spend(s, capAtCash(s, spreadCost(s, rng, 60_000), 0.5));
          bump(s, 'reputation', -3);
          return 'The vest, as it turns out, was a lawyer, and had a lot to say, at length, in writing.';
        },
      },
      {
        label: 'Pivot the company to "tokenised intelligence"',
        effect: (s, rng) => {
          clearChain(s, 'token_rugpull');
          bump(s, 'hype', 6);
          bump(s, 'reputation', -6);
          return rng.chance(0.2)
            ? 'The pivot was announced on a Tuesday and retracted on a Wednesday. In between, someone bought a boat.'
            : 'The pivot was received with interest, and a long, sarcastic, careful reading of the word "tokenised."';
        },
      },
    ],
  },

  {
    id: 'v2_agi_q3',
    title: 'An investor wants AGI by Q3',
    icon: '📅',
    body: () =>
      'Marcus Throttlewell of Overleveraged Capital has stood up in the quarterly meeting and said he "needs AGI by Q3." He has drawn a line on the whiteboard labelled "AGI" and another labelled "Q3." The lines do not meet. He has circled this.',
    weight: (s) => from(s, 200, 1.8),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Promise "a meaningful step toward AGI"',
        hint: safeHint(20_000),
        effect: (s, rng) => {
          spend(s, safeCost(s, 20_000));
          bump(s, 'hype', 3);
          s.flags['v2.agi'] = 1;
          scheduleChain(s, 'agi_q3_deadline', rng, 40, 110);
          return 'The promise was written in a deck, on slide 3, in 44-point font. It has become a sticker on the fridge.';
        },
      },
      {
        label: 'Explain scaling laws, with a diagram',
        effect: (s, rng) => {
          morale(s, 1);
          s.flags['v2.agi'] = 2;
          scheduleChain(s, 'agi_q3_deadline', rng, 40, 110);
          return 'The diagram had three arrows and one S-curve. Marcus asked where the curve ends, and you said "later." He wrote "later" on the whiteboard.';
        },
      },
      {
        label: 'Hire a Chief AGI Officer',
        hint: (s) => `${capHint(50_000)(s)}, adds a hire`,
        effect: (s, rng) => {
          spend(s, capAtCash(s, scaledCost(s, 50_000), 0.5));
          s.staff.roles.researcher.count += 1;
          s.flags['v2.agi'] = 3;
          scheduleChain(s, 'agi_q3_deadline', rng, 40, 110);
          return 'The Chief AGI Officer has a business card, a view of the lake, and no direct reports, which she describes as "the most honest org chart in the building."';
        },
      },
    ],
  },

  {
    id: 'v2_agi_q3_deadline',
    title: 'It is Q3, and Marcus has questions',
    icon: '⏰',
    body: () =>
      'It is Q3. Marcus Throttlewell has returned with the same whiteboard and a new pen. He asks, with warmth, "Is it done?" The people behind him are holding a cake with the word "AGI" on it, spelled correctly, which is the only thing that is.',
    weight: (s) => chainWeight(s, 'agi_q3_deadline', 8),
    cooldownDays: 120,
    once: true,
    choices: [
      {
        label: 'Present an "internal milestone"',
        hint: safeHint(20_000),
        effect: (s, rng) => {
          clearChain(s, 'agi_q3_deadline');
          spend(s, safeCost(s, 20_000));
          if ((s.flags['v2.agi'] ?? 1) === 1) {
            bump(s, 'hype', -3);
            bump(s, 'reputation', -2);
            return 'The milestone was reviewed carefully. It was described as "a milestone, in the sense of a stone, on a mile." Marcus has asked for the next one.';
          }
          bump(s, 'reputation', 1);
          return rng.chance(0.2)
            ? 'The milestone was accepted, and a second cake was brought in for it. The second cake was better.'
            : 'The milestone was accepted. Marcus asked what it was a milestone toward, and you said "that," pointing at the cake.';
        },
      },
      {
        label: 'Redefine AGI in the footnotes',
        hint: 'A gamble: could go either way',
        effect: (s, rng) => {
          clearChain(s, 'agi_q3_deadline');
          if (rng.chance(0.5)) {
            bump(s, 'hype', 5);
            return 'The new definition was accepted by the board, with the proviso that it be "inclusive." It now covers a thermostat.';
          }
          morale(s, -4);
          bump(s, 'reputation', -2);
          return 'The footnotes have been read aloud at a board meeting, with commentary. The commentary has footnotes.';
        },
      },
      {
        label: 'Give Marcus a demo where the model says "I am AGI"',
        hint: capHint(15_000),
        effect: (s) => {
          clearChain(s, 'agi_q3_deadline');
          spend(s, capAtCash(s, scaledCost(s, 15_000), 0.5));
          bump(s, 'hype', 2);
          return 'The model said "I am AGI," with its usual composure. Marcus asked whether it could say it again, slower, and the model did, with a pause.';
        },
      },
    ],
  },

  {
    id: 'v2_garage_possum',
    title: 'A possum has moved into the garage',
    icon: '🦝',
    body: () =>
      'A possum has taken up residence in the garage, and has formed a close bond with the cooling fans. It has chewed through one cable and now sleeps on the warm GPUs like a very small, fur-covered heat shield. Your intern has named it Gerald.',
    weight: (s) => (inGarageEra(s) ? 2 : 0),
    cooldownDays: 365,
    once: true,
    choices: [
      {
        label: 'Let Gerald stay',
        hint: 'Could cost a cable, could go either way',
        effect: (s, rng) => {
          morale(s, 4);
          if (rng.chance(0.35)) {
            spend(s, safeCost(s, 3_000));
            return 'Gerald chewed another cable. A new one was bought, and Gerald watched the swap with what looked like professional respect.';
          }
          return 'Gerald stayed. He has a small spot on the warm rack, and has made the room smell, faintly, of a hat.';
        },
      },
      {
        label: 'Arrange a humane relocation',
        hint: capHint(2_000),
        effect: (s) => {
          spend(s, capAtCash(s, scaledCost(s, 2_000), 0.5));
          morale(s, -2);
          return 'A man in a van came, and took Gerald to a nicer garage. The team stood in a row, in silence, as the van left. Someone played a violin on a laptop.';
        },
      },
      {
        label: 'Make him the company mascot',
        effect: (s, rng) => {
          bump(s, 'hype', 3);
          bump(s, 'brand', 1);
          if (rng.chance(0.2)) {
            bump(s, 'hype', 5);
            return 'A photo of Gerald on a GPU, captioned "my boss," went viral. He now has a verified account and, you suspect, an agent.';
          }
          return 'Gerald is now on the company slides. He is described, in the footer, as "Head of Thermal Management."';
        },
      },
    ],
  },

  // =========================================================================
  // PUBLIC COMPANY
  // =========================================================================
  {
    id: 'v2_activist_investor',
    title: 'An activist has bought in, and has slides',
    icon: '🦈',
    body: () =>
      'An activist investor, Vesper Capital, has taken a five percent stake and published a 140-slide deck titled "What If We Just Used Less GPU?" The deck says your CFO "is a nice person." The tone of the rest of it is not.',
    weight: (s) => (s.company.isPublic ? from(s, 1500, 1.6) : 0),
    cooldownDays: 365,
    choices: [
      {
        label: 'Engage in constructive dialogue',
        hint: safeHint(400_000),
        effect: (s) => {
          spend(s, safeCost(s, 400_000));
          bump(s, 'reputation', 1);
          return 'The dialogue was constructive. By the end of the third dinner, you were both agreeing on "synergies," and had no idea what they were.';
        },
      },
      {
        label: 'Announce a buyback',
        hint: capHint(1_500_000),
        effect: (s) => {
          spend(s, capAtCash(s, scaledCost(s, 1_500_000), 0.5));
          bump(s, 'hype', 3);
          return 'The buyback was announced with a slide, a bell, and a short interpretive dance by the CFO. The stock rose for most of the morning.';
        },
      },
      {
        label: 'Fight it with a poison pill',
        hint: (s) => `${capHint(2_000_000)(s)}, lawyers are optimistic`,
        effect: (s, rng) => {
          if (rng.chance(0.5)) {
            bump(s, 'reputation', 1);
            return 'The poison pill held. The activist has described it as "a bold stance, and a delicious one." It was neither, and everyone knew it.';
          }
          spend(s, capAtCash(s, scaledCost(s, 2_000_000), 0.5));
          s.stats.lawsuits += 1;
          morale(s, -3);
          return 'The pill was swallowed by the activist, with a glass of water and a lawsuit. The board has been advised to "take a long weekend."';
        },
      },
    ],
  },
];
