// The coach-mark copy and its targets. Kept apart from the Tutorial component so the HQ advisor and the
// doctrine picker can read the step numbers without loading the whole tutorial (App lazy-loads it).
import type { PanelId } from '../App';
import type { Intent } from '../nav';

/** Number of coach-mark steps after the welcome (step 0). Step 7 is the finale. */
export const TUTORIAL_STEPS = 7;

export interface StepDef {
  /** Panel the "Take me there" button opens. */
  go: PanelId;
  /** Intent for the panel, so GO lands on the control it names (nav.ts). */
  intent?: Intent;
  /** data-tut name of the control the card points at: it gets a ring, and the card sits next to it. */
  target?: string;
  /** Side-nav item to pulse, or null when the pointer belongs elsewhere (the speed controls). */
  highlight: PanelId | null;
  title: string;
  body: string;
  /** Phone wording: the keys are taps on the top bar there. Falls back to body. */
  phoneBody?: string;
}

export const STEPS: Record<number, StepDef> = {
  1: {
    go: 'research',
    highlight: 'research',
    target: 'research-start',
    title: 'Read the papers nobody finished',
    body: 'Start researching Transformers. Yes, the 2017 paper. Research only finishes while the clock runs, so unpause with Space when you are ready.',
    phoneBody:
      'Start researching Transformers. Yes, the 2017 paper. Research only finishes while the clock runs, so tap the pause button to unpause when you are ready.',
  },
  2: {
    go: 'models',
    intent: { open: 'train' },
    highlight: 'models',
    target: 'train-start',
    title: 'Burn some money on a model',
    body: 'Start a training run: pick a size, pick some data, watch the loss curve go down. It is basically a diet, but with more GPUs.',
  },
  3: {
    go: 'dashboard',
    highlight: null,
    target: 'speed',
    title: 'Time only moves when you let it',
    body: 'Press Space to pause, then Space again (or 1, 2, 3 for 1×, 3× and 10×) to resume. Nothing gets built while the clock is stopped, which is how most founders spend their Mondays.',
    phoneBody:
      'Tap the pause button to stop the clock, then tap it again to resume. Tap the speed button to change speed (1×, 3×, 10×). Nothing gets built while the clock is stopped, which is how most founders spend their Mondays.',
  },
  4: {
    go: 'models',
    highlight: 'models',
    target: 'release',
    title: 'Ship it before it gets weird',
    body: 'A trained model is a secret until you release it. Release it from the Models tab. Secrets are expensive to keep, and the press always finds out.',
  },
  5: {
    go: 'products',
    intent: { open: 'launch' },
    highlight: 'products',
    target: 'launch',
    title: 'Sell tokens to developers',
    body: 'Launch the API. Developers pay per token and never read the terms of service, which makes them your favourite customers.',
  },
  6: {
    go: 'staff',
    highlight: 'staff',
    target: 'hire',
    title: 'Read the room',
    body: 'Right now you are two founders, one engineer and a whiteboard. Hire someone. Researchers make the papers faster, safety people make the press release sound responsible.',
  },
  7: {
    go: 'finance',
    highlight: 'finance',
    title: "You're a real company now",
    body: 'Funding offers show up when cash gets thin, and they come with terms nobody reads. Events will ask you to choose between bad options. IPO once valuation hits $5B and revenue $2.5B a year. AGI is the last research node. It is probably fine.',
  },
};

/** Side-nav item that should pulse for the given tutorial step (used by App to drive SideNav). */
export function tutorialTarget(step: number): PanelId | null {
  return STEPS[step]?.highlight ?? null;
}
