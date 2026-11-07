// Missions: short, replayable lessons, one screen each. Progress is UI state. The done set is in localStorage and the
// running mission is in this module, so neither touches the sim, saves or multiplayer.
import { useEffect, useState } from 'preact/hooks';
import type { PanelId } from '../App';
import type { Intent } from '../nav';
import type { FundingOffer, GameState, TrainingRun } from '../../sim/types';
import { ownGpuCount } from '../../sim/systems/compute/fleet';

export type MissionId = 'training' | 'product' | 'compute' | 'funding' | 'contract';

/** What the player had when the mission started. Steps complete on what changed since, so a replay is not done already. */
export interface Snapshot {
  seed: number;
  training: TrainingRun | null;
  models: number;
  products: number;
  gpus: number;
  rounds: number;
  offer: FundingOffer | null;
  bids: number;
  active: number;
}

export interface MissionStep {
  go: PanelId;
  intent?: Intent;
  /** data-tut name of the control the card points at. */
  target?: string;
  title: string;
  body: string;
  /** Completes by itself when this turns true. Without it the step waits for Next. */
  done?: (s: GameState, base: Snapshot) => boolean;
}

export interface Mission {
  id: MissionId;
  title: string;
  steps: MissionStep[];
}

export function snapshot(s: GameState): Snapshot {
  return {
    seed: s.seed,
    training: s.training,
    models: s.models.length,
    products: s.products.length,
    gpus: ownGpuCount(s),
    rounds: s.finance.roundsRaised.length,
    offer: s.finance.pendingOffer,
    bids: s.contracts?.pending?.length ?? 0,
    active: s.contracts?.active.length ?? 0,
  };
}

export const MISSIONS: Mission[] = [
  {
    id: 'training',
    title: 'First training run',
    steps: [
      {
        go: 'models',
        intent: { open: 'train' },
        target: 'train-start',
        title: 'Open the training wizard',
        body: 'Every model starts as a training run. The wizard picks a size, some data and the techniques to try. Each choice costs compute and days, so read it before you press Start.',
      },
      {
        go: 'models',
        target: 'train-start',
        title: 'Start the run',
        body: 'Pick a size and some data, then press Start training. The clock has to run for the run to make progress.',
        done: (s, b) => s.training !== null && s.training !== b.training,
      },
      {
        go: 'models',
        title: 'Read the loss curve',
        body: 'The curve is the model getting less wrong, so lower is better. When it flattens, more compute stops buying much.',
      },
      {
        go: 'models',
        title: 'Wait for the model',
        body: 'When the run finishes, the model appears in Models, ready to evaluate and release.',
        done: (s, b) => s.models.length > b.models,
      },
    ],
  },
  {
    id: 'product',
    title: 'First product',
    steps: [
      {
        go: 'products',
        intent: { open: 'launch' },
        target: 'launch',
        title: 'Open the launch sheet',
        body: 'Products are what customers pay for. The launch sheet picks a kind (API, chat or enterprise), a released model and a price. Products need a released model, so release one in Models first.',
      },
      {
        go: 'products',
        target: 'launch',
        title: 'Launch it',
        body: 'Pick the model and a price, then launch. Developers pay per token and never read the terms.',
        done: (s, b) => s.products.length > b.products,
      },
      {
        go: 'products',
        title: 'Keep it served',
        body: 'Demand arrives over the following days. When a product cannot serve all of it, its warning shows on Products, and more GPUs in Compute fix that.',
      },
    ],
  },
  {
    id: 'compute',
    title: 'Buy compute',
    steps: [
      {
        go: 'compute',
        intent: { tab: 'rent' },
        title: 'Get more GPUs',
        body: 'GPUs are the factory floor. Renting is the fast way to get them: no upfront cost, billed daily, and you can give them back.',
      },
      {
        go: 'compute',
        title: 'Rent a block',
        body: 'Use the plus button on a GPU to rent it. The bill runs every day, whether the GPUs are busy or idle.',
        done: (s, b) => ownGpuCount(s) > b.gpus,
      },
      {
        go: 'compute',
        title: 'Decide what they do',
        body: 'Fleet priority decides whether your GPUs serve products or train models. Serving keeps customers happy. Training gets the next model sooner.',
      },
    ],
  },
  {
    id: 'funding',
    title: 'Raise a round',
    steps: [
      {
        go: 'finance',
        intent: { focus: 'pitch' },
        target: 'pitch-investors',
        title: 'Check what a round costs',
        body: 'A round sells a slice of the company for cash. The Funding card shows what it would bring and how much of the company it costs you.',
      },
      {
        go: 'finance',
        intent: { focus: 'pitch' },
        target: 'pitch-investors',
        title: 'Pitch investors',
        body: 'Press Pitch investors. A term sheet arrives when an investor bites, which takes a few days. Not every pitch lands.',
        done: (s, b) => s.finance.pendingOffer !== null && s.finance.pendingOffer !== b.offer,
      },
      {
        go: 'finance',
        intent: { focus: 'offer' },
        target: 'accept-offer',
        title: 'Take the money',
        body: 'Read the terms, then accept and confirm. The cash arrives now, and the dilution stays for good.',
        done: (s, b) => s.finance.roundsRaised.length > b.rounds,
      },
    ],
  },
  {
    id: 'contract',
    title: 'Win a contract',
    steps: [
      {
        go: 'contracts',
        title: 'Read the offers',
        body: 'Clients post contracts that need a model with certain abilities. Each offer lists what it requires, and your fit shows how well your best model meets it.',
      },
      {
        go: 'contracts',
        target: 'bid',
        title: 'Bid with a qualifying model',
        body: 'Pick a model that meets the requirements, then press Bid. Your bid waits for the client to decide.',
        done: (s, b) => (s.contracts?.pending?.length ?? 0) > b.bids,
      },
      {
        go: 'contracts',
        title: 'Wait for the answer',
        body: 'The client decides on a set day and pays upfront if you win. If they pick a rival, bid on another offer.',
        done: (s, b) => (s.contracts?.active.length ?? 0) > b.active,
      },
    ],
  },
];

/** The missions whose ids are in a stored list. Unknown ids (a retired mission, a corrupt entry) count as nothing. */
export function parseDone(raw: string | null): Set<MissionId> {
  const out = new Set<MissionId>();
  try {
    const ids: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(ids)) for (const m of MISSIONS) if (ids.includes(m.id)) out.add(m.id);
  } catch {
    // corrupt entry: nothing counts as done
  }
  return out;
}

const DONE_KEY = 'llm-missions-done';

export function readDone(): Set<MissionId> {
  try {
    return parseDone(globalThis.localStorage?.getItem(DONE_KEY) ?? null);
  } catch {
    return new Set(); // storage blocked: marks last until a reload
  }
}

function markDone(id: MissionId): void {
  const done = readDone();
  done.add(id);
  try {
    globalThis.localStorage?.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // storage blocked: the mark lasts this visit
  }
}

export interface MissionRun {
  mission: Mission;
  step: number;
  base: Snapshot;
}

let run: MissionRun | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const l of subs) l();
};

export function startMission(mission: Mission, s: GameState): void {
  run = { mission, step: 0, base: snapshot(s) };
  emit();
}

export function endMission(): void {
  if (!run) return;
  run = null;
  emit();
}

/** Next step, or finish the mission (its done mark is saved). Returns true when it finished. */
export function advanceMission(): boolean {
  if (!run) return false;
  const finished = run.step + 1 >= run.mission.steps.length;
  if (finished) {
    markDone(run.mission.id);
    run = null;
  } else {
    run = { ...run, step: run.step + 1 };
  }
  emit();
  return finished;
}

export function useMissionRun(): MissionRun | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    subs.add(l);
    return () => {
      subs.delete(l);
    };
  }, []);
  return run;
}
