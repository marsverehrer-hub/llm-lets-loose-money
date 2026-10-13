// OWNER: QUEUE. v7 QoL (GAME_DESIGN §18.4): research queue, training queue, product auto-upgrade.
// queueTick runs after researchTick and trainingTick. It starts queued research and training through the existing
// handlers, and switches products that opted in to a clearly better released model.
import type { ActionHandlers, GameState, Id, Model, QueuedRun, ResearchNode, Rng } from '../types';
import { RESEARCH } from '../data/research';
import { handlers as researchHandlers, isResearched, RESEARCH_TUNING } from './research';
import { handlers as trainingHandlers } from './training';
import { handlers as productsHandlers } from './products';
import { dailyComputeCost } from './compute';
import { formatMoney, newId, notify, yearOf } from '../util';

/** A queued run starts only when cash covers this many days of compute bills. */
export const QUEUE_TUNING = {
  RESERVE_DAYS: 30,
  /** A product switches only when the new model beats the current one by more than this many overall points. */
  UPGRADE_MARGIN: 1,
};

const NODE_BY_ID = new Map<Id, ResearchNode>(RESEARCH.map((n) => [n.id, n] as const));
const nodeOf = (id: Id): ResearchNode | undefined => NODE_BY_ID.get(id);

function researchQueue(s: GameState): Id[] {
  return s.research.queue ?? [];
}

/** The same gate the setResearch handler applies: prerequisites done and the year open. */
function readyToStart(s: GameState, node: ResearchNode): boolean {
  return node.prereqs.every((p) => isResearched(s, p)) && yearOf(s.day) + RESEARCH_TUNING.EARLY_YEARS >= node.minYear;
}

/**
 * The nodes queueResearch would append for `nodeId`, prerequisites first (a valid topological order). Skips nodes
 * already researched, already queued, or currently being researched. Ends with `nodeId` itself, or is empty when
 * there is nothing to add.
 */
export function researchPath(s: GameState, nodeId: Id): Id[] {
  if (!nodeOf(nodeId) || isResearched(s, nodeId)) return [];
  const queued = new Set(researchQueue(s));
  const skip = (id: Id) => isResearched(s, id) || queued.has(id) || s.research.current === id;
  if (skip(nodeId)) return [];
  const out: Id[] = [];
  const seen = new Set<Id>();
  const visit = (id: Id) => {
    if (seen.has(id) || skip(id)) return;
    seen.add(id);
    const node = nodeOf(id);
    if (!node) return;
    for (const p of node.prereqs) visit(p);
    out.push(id);
  };
  visit(nodeId);
  return out;
}

/** The first queued pair (child, parent) where the child comes before a prerequisite that is still queued. */
function orderViolation(s: GameState, list: Id[]): { child: Id; parent: Id } | null {
  const pos = new Map(list.map((id, i) => [id, i] as const));
  for (let i = 0; i < list.length; i++) {
    const node = nodeOf(list[i]);
    if (!node) continue;
    for (const p of node.prereqs) {
      if (isResearched(s, p) || s.research.current === p) continue;
      const pi = pos.get(p);
      if (pi !== undefined && pi >= i) return { child: list[i], parent: p };
    }
  }
  return null;
}

// ---------------------------------------------------------------- research queue

function tickResearchQueue(s: GameState, rng: Rng): void {
  const cur = s.research.current;
  let q = researchQueue(s).filter((id) => !isResearched(s, id) && id !== cur);
  if (q.length !== (s.research.queue ?? []).length) s.research.queue = q;
  if (cur || q.length === 0 || s.research.queuePaused) return;
  const next = q.find((id) => {
    const node = nodeOf(id);
    return !!node && readyToStart(s, node);
  });
  if (!next) return;
  researchHandlers.setResearch?.(s, { type: 'setResearch', nodeId: next }, rng);
  if (s.research.current === next) {
    q = q.filter((id) => id !== next);
    s.research.queue = q;
  }
}

// ---------------------------------------------------------------- training queue

/** Cash the queue needs before it starts a run: QUEUE_TUNING.RESERVE_DAYS of compute bills. */
function cashReserve(s: GameState): number {
  const bill = dailyComputeCost(s);
  return QUEUE_TUNING.RESERVE_DAYS * (bill.rent + bill.power + bill.upkeep + bill.hardware);
}

function runLabel(item: QueuedRun): string {
  const name = (item.action as { name?: string }).name?.trim();
  if (name) return name;
  return item.kind === 'pretrain' ? 'Untitled model' : 'Untitled fine-tune';
}

/** Says a queued run is waiting, once per run. */
function noticeWaiting(s: GameState, item: QueuedRun, reason: string): void {
  const key = `queueWait.${item.id}`;
  if (s.flags[key]) return;
  s.flags[key] = 1;
  notify(s, `Queued run ${runLabel(item)} is waiting: ${reason}.`, 'info');
}

function tickTrainingQueue(s: GameState, rng: Rng): void {
  const q = s.trainingQueue ?? [];
  if (q.length === 0 || s.training || s.pendingReveal) return;
  const item = q[0];
  const reserve = cashReserve(s);
  if (!(s.finance.cash > 0 && s.finance.cash >= reserve)) {
    noticeWaiting(s, item, `it needs ${formatMoney(reserve)} in cash to cover ${QUEUE_TUNING.RESERVE_DAYS} days of compute`);
    return;
  }

  // Run the real handler. It notifies its own error on refusal; pop that message so the queue speaks only once.
  const lastBefore = s.noticeLog?.[s.noticeLog.length - 1];
  if (item.kind === 'pretrain') trainingHandlers.startTraining?.(s, item.action, rng);
  else trainingHandlers.startFinetune?.(s, item.action, rng);

  if (s.training) {
    s.trainingQueue = q.slice(1);
    delete s.flags[`queueWait.${item.id}`];
    return;
  }
  const last = s.noticeLog?.[s.noticeLog.length - 1];
  let reason = 'the sim refused the start';
  if (last && last !== lastBefore) {
    s.noticeLog!.pop();
    const shown = s.notifications[s.notifications.length - 1];
    if (shown && shown.text === last.text) s.notifications.pop();
    reason = last.text.replace(/\.$/, '');
  }
  noticeWaiting(s, item, reason.charAt(0).toLowerCase() + reason.slice(1));
}

// ---------------------------------------------------------------- product auto-upgrade

function tickAutoUpgrade(s: GameState, rng: Rng): void {
  const products = s.products.filter((p) => p.active && p.autoUpgrade);
  if (products.length === 0) return;
  // Released, not retired, and not a capped preview (a preview is limited to 15% of demand per product).
  const candidates = s.models.filter((m) => m.releasedDay !== null && !m.deprecated && m.releaseMode !== 'preview');
  if (candidates.length === 0) return;
  const best = candidates.reduce<Model | null>((b, m) => (!b || m.overall > b.overall ? m : b), null);
  if (!best) return;
  for (const p of products) {
    if (p.modelId === best.id) continue;
    const cur = s.models.find((m) => m.id === p.modelId);
    const curLive = !!cur && cur.releasedDay !== null && !cur.deprecated;
    const bar = curLive ? cur!.overall + QUEUE_TUNING.UPGRADE_MARGIN : -Infinity;
    if (best.overall <= bar) continue;
    // Same assign path the player uses, so the same validation and the same "now runs" notice apply.
    productsHandlers.updateProduct?.(s, { type: 'updateProduct', productId: p.id, modelId: best.id }, rng);
  }
}

// ---------------------------------------------------------------- tick

/** Runs after researchTick and trainingTick: starts queued research and training, applies product auto-upgrades. */
export function queueTick(s: GameState, rng: Rng): void {
  tickResearchQueue(s, rng);
  tickTrainingQueue(s, rng);
  tickAutoUpgrade(s, rng);
}

// ---------------------------------------------------------------- actions

export const handlers: ActionHandlers = {
  queueResearch: (s, a) => {
    const node = nodeOf(a.nodeId);
    if (!node) {
      notify(s, 'Unknown research topic.', 'bad');
      return;
    }
    if (isResearched(s, node.id)) {
      notify(s, `${node.name} is already done.`, 'info');
      return;
    }
    if (s.research.current === node.id || researchQueue(s).includes(node.id)) {
      notify(s, `${node.name} is already ${s.research.current === node.id ? 'being researched' : 'queued'}.`, 'info');
      return;
    }
    const path = researchPath(s, node.id);
    s.research.queue = [...researchQueue(s), ...path];
    const extra = path.length - 1;
    const opens = node.minYear - RESEARCH_TUNING.EARLY_YEARS;
    const late = yearOf(s.day) + RESEARCH_TUNING.EARLY_YEARS < node.minYear ? ` It opens in ${opens}.` : '';
    notify(
      s,
      `Queued ${node.name}${extra > 0 ? ` (+${extra} prerequisite${extra === 1 ? '' : 's'})` : ''}.${late}`,
      'info',
    );
  },

  unqueueResearch: (s, a) => {
    const q = researchQueue(s);
    const node = nodeOf(a.nodeId);
    if (!q.includes(a.nodeId)) {
      notify(s, `${node?.name ?? 'That topic'} is not queued.`, 'info');
      return;
    }
    // Drop the node and, transitively, any queued node that needed it.
    const removed = new Set<Id>([a.nodeId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of q) {
        if (removed.has(id)) continue;
        if (nodeOf(id)?.prereqs.some((p) => removed.has(p))) {
          removed.add(id);
          grew = true;
        }
      }
    }
    s.research.queue = q.filter((id) => !removed.has(id));
    const extra = removed.size - 1;
    notify(
      s,
      `Removed ${node?.name ?? a.nodeId} from the queue${extra > 0 ? `, along with ${extra} that needed it` : ''}.`,
      'info',
    );
  },

  reorderResearch: (s, a) => {
    const q = researchQueue(s);
    const node = nodeOf(a.nodeId);
    if (!q.includes(a.nodeId) || !node) {
      notify(s, 'That topic is not queued.', 'bad');
      return;
    }
    if (!Number.isFinite(a.toIndex)) return;
    const rest = q.filter((id) => id !== a.nodeId);
    const to = Math.min(Math.max(Math.round(a.toIndex), 0), q.length - 1);
    const next = [...rest.slice(0, to), a.nodeId, ...rest.slice(to)];
    const bad = orderViolation(s, next);
    if (bad) {
      notify(
        s,
        `${nodeOf(bad.child)?.name ?? bad.child} needs ${nodeOf(bad.parent)?.name ?? bad.parent} first. Move it after that.`,
        'bad',
      );
      return;
    }
    s.research.queue = next;
  },

  setResearchQueuePaused: (s, a) => {
    if (s.research.queuePaused === a.paused) return;
    s.research.queuePaused = a.paused;
    if (a.paused) notify(s, 'Research queue paused. Resume it when you are ready.', 'info');
    else notify(s, 'Research queue resumed.', 'info');
  },

  queueTraining: (s, a) => {
    const act = a.action;
    const id = newId(s, 'qrun');
    const item: QueuedRun =
      act.type === 'startTraining' ? { id, kind: 'pretrain', action: act } : { id, kind: 'finetune', action: act };
    s.trainingQueue = [...(s.trainingQueue ?? []), item];
    const place = s.trainingQueue.length;
    notify(s, `Queued ${runLabel(item)} for training. ${place === 1 ? 'It starts when the slot frees.' : `${place - 1} ahead of it.`}`, 'info');
  },

  unqueueTraining: (s, a) => {
    const q = s.trainingQueue ?? [];
    const item = q.find((x) => x.id === a.id);
    if (!item) {
      notify(s, 'That run is not queued.', 'info');
      return;
    }
    s.trainingQueue = q.filter((x) => x.id !== a.id);
    delete s.flags[`queueWait.${a.id}`];
    notify(s, `Removed ${runLabel(item)} from the training queue.`, 'info');
  },

  setProductAutoUpgrade: (s, a) => {
    const p = s.products.find((x) => x.id === a.productId && x.active);
    if (!p) {
      notify(s, 'That product is not live.', 'bad');
      return;
    }
    p.autoUpgrade = a.on;
  },
};
