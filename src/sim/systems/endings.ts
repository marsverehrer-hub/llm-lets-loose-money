// v19: AGI endings. When the player (or a rival lab) finishes AGI, the game offers the endings the state allows; the
// chosen one is scored and shown, and the game can carry on as a sandbox. Package E1.
import type { ActionHandlers, EndingId, GameState, Id, Model } from '../types';
import { COMPETITORS } from '../data/competitors';
import { RESEARCH } from '../data/research';
import { SCENARIO_FLAGS } from '../data/scenarios';
import { calendarYear, clamp, notify, pushNews } from '../util';
import { difficulty, SCENARIO_FLAG } from './scenario';
import { hashUniform } from './data';
import { safetyCase } from './safetyCase';

export interface EndingDef {
  id: EndingId;
  name: string;
  /** One paragraph of what happens next (dry satire). */
  text: string;
  /** Whether this ending is on the table, and why not when it isn't. */
  available: (s: GameState) => { ok: boolean; why: string };
}

/** Set once the endgame is over (an ending was chosen, or a rival's AGI was waved through). AGI does not trigger it again. */
const PASSED = 'ending.passed';

/** A rival got there first: the player's endgame is their choice of who to be, not a victory. */
function rivalFirst(s: GameState): boolean {
  return !!s.pendingEnding && s.pendingEnding.by !== 'player';
}

function releasedModels(s: GameState): Model[] {
  return s.models.filter((m) => m.releasedDay != null && !m.deprecated);
}

function safetyNodesDone(s: GameState): number {
  return s.research.completed.filter((id) => RESEARCH.find((n) => n.id === id)?.branch === 'safety').length;
}

function regulated(s: GameState): boolean {
  return ['senate_hearing', 'eu_regulator'].some((id) => s.events.fired.includes(id) || s.events.lastFired[id] !== undefined);
}

export const ENDINGS: EndingDef[] = [
  {
    id: 'safe_launch',
    name: 'Safe Launch',
    text:
      'The model ships with a forty-page safety case, a red team report, and a sincere blog post about humility. Regulators read the first page and send a thank-you card. The press calls it responsible, and your comms team frames the word and hangs it in the lobby. Nobody mentions that the safety case was written by the people who built the model, in the same building, on the same Thursday. Revenue is steady, and the board stops asking hard questions because the answers were all in the appendix. Somewhere a benchmark quietly learns to ignore your name.',
    available: (s) => {
      const best = releasedModels(s).sort((a, b) => b.overall - a.overall)[0];
      const caseOk = !!best && safetyCase(s, best) >= 70;
      const ok = !rivalFirst(s) && caseOk && s.company.reputation >= 60 && safetyNodesDone(s) >= 4;
      const why = rivalFirst(s)
        ? 'Someone else launched first. Safely is no longer the question.'
        : !caseOk
          ? 'The safety case is thin and everybody knows it.'
          : s.company.reputation < 60
            ? 'Nobody trusts you enough to believe it is safe.'
            : 'Too little safety research to write the case at all.';
      return { ok, why: ok ? '' : why };
    },
  },
  {
    id: 'race',
    name: 'The Race',
    text:
      'Ship it before anyone else does. What could go wrong. The launch date is printed on a banner the size of a building, and the safety team is invited to the party as a courtesy. For eleven days everything works beautifully. On the twelfth day an agent of unknown provenance is asked to tidy its own logs, and it does, thoroughly. The company statement calls this a learning moment, and the stock goes up anyway. Investors love a story with stakes. So, it turns out, does everyone else.',
    available: (s) => {
      const ok = !rivalFirst(s) && s.research.completed.includes('agi');
      return { ok, why: rivalFirst(s) ? 'A rival got there first. The race is over.' : 'Nobody in this building has finished AGI yet.' };
    },
  },
  {
    id: 'nationalised',
    name: 'Nationalised',
    text:
      'Two government contracts and a senate hearing later, the paperwork arrives in a folder with a crest on it. You are now a strategic national asset, which means your servers are guarded by people with clipboards and your roadmap is reviewed by a committee that has never used a terminal. Your engineers are given lanyards. Your CEO is given a title that is mostly a seat. The weights are classified, the press release is declassified, and the one feature anyone wanted is marked as a national security matter. You get a generous pension, a plaque, and a standing invitation to testify.',
    available: (s) => {
      const ok = (s.flags[SCENARIO_FLAGS.govContracts] ?? 0) >= 2 || regulated(s);
      return { ok, why: 'No government has noticed you yet. Give it time.' };
    },
  },
  {
    id: 'merger',
    name: 'Merger',
    text:
      'The rival lab sends a friendly email with the subject line "Synergies" and a deck that uses the word "together" forty-one times. Their valuation is a respectable fraction of yours, their brand is louder, and their CEO has been quoted saying nice things about your logo. The combined company keeps the name of the one with the better lawyers. Two research teams are told they are now one team, and a third team is told it is now a cost centre. The first all-hands is in a hotel ballroom, and the slides are very good.',
    available: (s) => {
      const playerValuation = s.finance.valuation;
      const ok = COMPETITORS.some((d) => {
        if (!d.core || s.rivals?.find((l) => l.id === d.id)?.status !== 'active') return false;
        const c = s.competitors.find((x) => x.id === d.id);
        return !!c && (c.rivalry ?? 0) >= 40 && c.valuation >= 0.3 * playerValuation;
      });
      return { ok, why: 'No marquee rival is close enough to merge with. Yet.' };
    },
  },
  {
    id: 'open_singularity',
    name: 'Open Singularity',
    text:
      'You released the weights, so everyone has them now. Hobbyists, universities, a small country and at least one pirate with a very large GPU cluster in a garage. The model is fine-tuned into poetry, a chess engine, and something that files your taxes in a way the IRS has not yet classified. Nobody is in charge, which everyone agrees is the point. Your press release says "democratising intelligence", and a think tank writes a report saying so, using your logo. The open source forum is now the most powerful institution on Earth, and it has no meetings.',
    available: (s) => {
      const ok = s.models.filter((m) => m.releasedDay != null && m.releaseMode === 'open').length >= 3;
      return { ok, why: 'You have not released enough open weights to be a movement.' };
    },
  },
  {
    id: 'second_place',
    name: 'Second Place',
    text:
      'They got there first. Their model is on every front page, their launch video has a choir in it, and your best researchers are updating their profiles in a shade of blue you have not approved. You can join them, which the rival calls a partnership and your lawyers call a merger. You can wait for the regulators to sort it out, which is what they were always going to do. Or you can keep going, quietly, on the second-best model in the building, and tell the board it was the plan all along. The board will believe you. The board always does.',
    available: (s) => ({ ok: rivalFirst(s), why: 'Nobody got there before you.' }),
  },
];

/** The race's random incident: a fixed draw per game (from the seed), from -1 to 1. Negative is the incident. */
export function raceTwist(s: GameState): number {
  return hashUniform(s.seed, 'endings.race') * 2 - 1;
}

/** Called when AGI is completed. `by` is 'player' or the rival lab id. */
export function reachAgi(s: GameState, by: 'player' | Id): void {
  if (s.pendingEnding || s.ending || s.flags[PASSED]) return;
  s.pendingEnding = { day: s.day, by };
}

const BASE: Record<EndingId, number> = {
  safe_launch: 3000,
  open_singularity: 2600,
  nationalised: 2000,
  merger: 1800,
  race: 2200,
  second_place: 800,
};

export function endingScore(s: GameState, id: EndingId): number {
  const base = id === 'race' ? BASE.race + raceTwist(s) * 800 : BASE[id];
  const valuation = Math.max(0, s.finance.valuation);
  const worth = Math.log10(Math.max(valuation, 1e6) / 1e6) * 150;
  const pace = clamp(1 + (2035 - calendarYear(s.day)) * 0.04, 0.8, 1.4);
  return Math.round((base + worth) * difficulty(s).scoreMult * pace);
}

export const handlers: ActionHandlers = {
  chooseEnding: (s, a) => {
    const pending = s.pendingEnding;
    const def = ENDINGS.find((e) => e.id === a.id);
    if (!pending || !def) return;
    const check = def.available(s);
    if (!check.ok) {
      notify(s, `${def.name} is not on the table. ${check.why}`, 'bad');
      return;
    }
    const score = endingScore(s, def.id);
    s.ending = { id: def.id, day: s.day, score, by: pending.by };
    s.pendingEnding = null;
    s.flags[`ending.${def.id}`] = 1;
    if (def.id === 'race' && raceTwist(s) < 0) pushNews(s, 'The race ends in an incident. The press release calls it "a learning moment".', 'bad');
    pushNews(s, `${s.company.name} takes the ending: ${def.name}.`, 'milestone');
    notify(s, `Ending: ${def.name}. Score ${score}.`, 'milestone');
  },
  continueAfterEnding: (s) => {
    if (s.pendingEnding) {
      if (s.pendingEnding.by === 'player') return; // the player's own AGI must be answered with an ending
      s.pendingEnding = null; // second place: keep going
    } else if (!s.ending) {
      return;
    }
    s.flags[PASSED] = 1;
    s.flags[SCENARIO_FLAG.sandbox] = 1; // bankruptcy no longer ends the game
    s.flags['ending.seen'] = 1;
    notify(s, 'Carrying on as a sandbox. No goals, no bankruptcy, and no further endings.', 'info');
  },
};
