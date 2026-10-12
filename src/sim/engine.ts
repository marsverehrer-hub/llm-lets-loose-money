import type { ActionHandlers, GameAction, GameState, System } from './types';
import { makeRng } from './rng';
import { computeTick, handlers as computeHandlers } from './systems/compute';
import { dataTick, handlers as dataHandlers } from './systems/data';
import { dataOpsTick, handlers as dataOpsHandlers } from './systems/dataOps';
import { staffTick, handlers as staffHandlers } from './systems/staff';
import { researchTick, handlers as researchHandlers } from './systems/research';
import { trainingTick, handlers as trainingHandlers } from './systems/training';
import { labTick, handlers as labHandlers } from './systems/lab';
import { competitorsTick } from './systems/competitors';
import { benchmarksTick } from './systems/capabilities';
import { marketTick, handlers as marketHandlers } from './systems/market';
import { productsTick, handlers as productsHandlers } from './systems/products';
import { eventsTick, handlers as eventsHandlers } from './systems/events';
import { financeTick, handlers as financeHandlers } from './systems/finance';
import { milestonesTick } from './systems/milestones';
import { mpTick, handlers as mpHandlers } from './systems/multiplayer';
import { vaultTick, handlers as vaultHandlers } from './systems/vault';
import { releaseTick, handlers as releaseHandlers } from './systems/release';
import { handlers as deriveHandlers } from './systems/derive';
import { momentsTick, handlers as momentsHandlers } from './systems/moments';
import { queueTick, handlers as queueHandlers } from './systems/queue';
import { classesTick, handlers as classesHandlers } from './systems/classes';
import { contractsTick, handlers as contractsHandlers } from './systems/contracts';
import { handlers as doctrineHandlers } from './systems/doctrine';
import { handlers as servingHandlers, servingTick } from './systems/serving'; // v10 serving
import { scenarioTick, setScenarioTicker } from './systems/scenario'; // v9 scenario

/** Order matters: costs/capacity first, then production, then market, then finance closes the books. */
const SYSTEMS: System[] = [
  computeTick,
  dataTick,
  dataOpsTick,
  staffTick,
  researchTick,
  trainingTick,
  labTick,
  queueTick,
  vaultTick,
  releaseTick,
  competitorsTick,
  benchmarksTick,
  classesTick,
  marketTick,
  productsTick,
  servingTick, // v10: after demand is known; books the cloud burst and each product's serving cost
  contractsTick,
  eventsTick,
  scenarioTick, // v9 scenario: goals, grant and takeovers, before the books close
  financeTick,
  milestonesTick,
  momentsTick,
];

const coreHandlers: ActionHandlers = {
  setSpeed: (s, a) => {
    s.speed = a.speed;
  },
  renameCompany: (s, a) => {
    const n = a.name.trim().slice(0, 32);
    if (n) s.company.name = n;
  },
  dismissNotification: (s, a) => {
    s.notifications = s.notifications.filter((n) => n.id !== a.id);
  },
  setTutorialStep: (s, a) => {
    s.tutorialStep = a.step;
  },
};

const HANDLERS: ActionHandlers = Object.assign(
  {},
  coreHandlers,
  computeHandlers,
  dataHandlers,
  dataOpsHandlers,
  staffHandlers,
  researchHandlers,
  trainingHandlers,
  labHandlers,
  // v6: release.ts replaces training's releaseModel, so it must come after trainingHandlers.
  vaultHandlers,
  releaseHandlers,
  deriveHandlers,
  momentsHandlers,
  queueHandlers,
  classesHandlers,
  contractsHandlers,
  doctrineHandlers,
  servingHandlers,
  marketHandlers,
  productsHandlers,
  eventsHandlers,
  financeHandlers,
  mpHandlers,
);

/** True when the simulation should not advance (game over or an event awaits a decision). */
export function isBlocked(s: GameState): boolean {
  const incident = s.training?.pendingIncident;
  return (
    !!s.gameOver ||
    !!s.mp?.result ||
    (!!s.events.pending && s.events.pending.result === undefined) ||
    (!!incident && incident.result === undefined) ||
    !!s.pendingReveal ||
    !!s.pendingMoment
  );
}

/** Advance one day. */
export function tick(s: GameState): void {
  if (isBlocked(s)) {
    // Multiplayer still needs to notice our own bankruptcy / a finished match while blocked.
    if (s.mp) mpTick(s, makeRng(s));
    return;
  }
  const rng = makeRng(s);
  s.day += 1;
  s.finance.today = { revenue: {}, expenses: {} };
  for (const sys of SYSTEMS) {
    sys(s, rng);
    if (s.gameOver) break;
  }
  // Runs after the rest so a bankruptcy set by financeTick this day still ends the match.
  if (s.mp) mpTick(s, rng);
}

// v9 scenario: mid-era new games fast-forward the world with this tick (see systems/scenario.ts).
setScenarioTicker(tick);

/** Apply a player action. Unknown actions are ignored with a console warning. */
export function dispatch(s: GameState, action: GameAction): void {
  const h = HANDLERS[action.type] as ((s: GameState, a: GameAction, rng: ReturnType<typeof makeRng>) => void) | undefined;
  if (!h) {
    console.warn('No handler for action', action.type);
    return;
  }
  h(s, action, makeRng(s));
}
