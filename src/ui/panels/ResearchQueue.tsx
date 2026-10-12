// Research queue (GAME_DESIGN 18.4): the strip above the tree (current topic, then queued topics with cumulative ETAs)
// and the Queue / Research towards action in the details window. Styles in queue.css (q- prefix). Tokens only.
import { dispatch, useGame } from '../store';
import { RESEARCH } from '../../sim/data/research';
import { RESEARCH_TUNING, effectiveResearchCost } from '../../sim/systems/research';
import { researchPath } from '../../sim/systems/queue';
import { yearOf } from '../../sim/util';
import { Pill, ProgressBar } from '../components';
import type { Id, ResearchNode } from '../../sim/types';
import { fmtCount, fmtDays } from './panelKit';
import './queue.css';

const NODE_BY_ID = new Map<Id, ResearchNode>(RESEARCH.map((n) => [n.id, n] as const));

/** "12 days" at the given rate, or a plain line when nothing is produced. */
function etaText(rp: number, perDay: number): string {
  if (perDay <= 0) return 'No output yet';
  if (rp <= 0) return 'Now';
  return fmtDays(rp / perDay);
}

export function ResearchQueueStrip({ perDay }: { perDay: number }) {
  const s = useGame();
  const curId = s.research.current;
  const cur = curId ? NODE_BY_ID.get(curId) ?? null : null;
  const queue = s.research.queue ?? [];
  const paused = !!s.research.queuePaused;
  const curRemaining = cur ? Math.max(0, effectiveResearchCost(s, cur) - s.research.progress) : 0;
  const curFrac = cur && effectiveResearchCost(s, cur) > 0 ? Math.min(1, s.research.progress / effectiveResearchCost(s, cur)) : 0;

  // Cumulative RP: the current topic's remainder, then each queued topic in order.
  let acc = curRemaining;
  const rows = queue.map((id, i) => {
    const n = NODE_BY_ID.get(id);
    acc += n ? effectiveResearchCost(s, n) : 0;
    const opens = n && yearOf(s.day) + RESEARCH_TUNING.EARLY_YEARS < n.minYear ? n.minYear - RESEARCH_TUNING.EARLY_YEARS : null;
    return { id, n, i, eta: acc, opens };
  });
  const total = acc;

  const sub =
    queue.length === 0
      ? cur
        ? 'Nothing queued after this'
        : 'Nothing queued'
      : `${queue.length} queued${perDay > 0 ? ` · all clear in ${fmtDays(total / perDay)}` : ''}`;

  return (
    <section class="q-strip" aria-label="Research queue">
      <div class="q-head">
        <span class="q-title">Queue</span>
        <span class="q-sub">{sub}</span>
        <div class="q-head-actions">
          {paused && <Pill tone="warn">Paused</Pill>}
          {paused && (
            <button type="button" class="btn btn-sm btn-primary" onClick={() => dispatch({ type: 'setResearchQueuePaused', paused: false })}>
              Resume
            </button>
          )}
        </div>
      </div>

      <ul class="q-list">
        {cur && (
          <li class="q-row is-current">
            <span class="q-idx" aria-hidden="true">·</span>
            <span class="q-namecol">
              <span class="q-name" title={cur.name}>
                {cur.name}
              </span>
              <ProgressBar value={curFrac} height={6} />
            </span>
            <Pill tone="warn">Researching</Pill>
            <span class="q-num" title="Time left on the current topic">
              {etaText(curRemaining, perDay)}
            </span>
          </li>
        )}

        {rows.map((r) => (
          <li class="q-row" key={r.id} data-queue-index={r.i}>
            <span class="q-idx">{r.i + 1}</span>
            <span class="q-namecol">
              <span class="q-name" title={r.n?.name ?? r.id}>
                {r.n?.name ?? r.id}
              </span>
            </span>
            {r.opens !== null && <Pill tone="muted">Opens {r.opens}</Pill>}
            <span class="q-num">{r.n ? `${fmtCount(effectiveResearchCost(s, r.n), 0)} RP` : ''}</span>
            <span class="q-num" title="Cumulative time until this topic is done">
              {etaText(r.eta, perDay)}
            </span>
            <span class="q-acts">
              <button
                type="button"
                class="btn btn-sm"
                disabled={r.i === 0}
                aria-label={`Move ${r.n?.name ?? r.id} up`}
                title="Move up"
                onClick={() => dispatch({ type: 'reorderResearch', nodeId: r.id, toIndex: r.i - 1 })}
              >
                ▲
              </button>
              <button
                type="button"
                class="btn btn-sm"
                disabled={r.i === queue.length - 1}
                aria-label={`Move ${r.n?.name ?? r.id} down`}
                title="Move down"
                onClick={() => dispatch({ type: 'reorderResearch', nodeId: r.id, toIndex: r.i + 1 })}
              >
                ▼
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                aria-label={`Remove ${r.n?.name ?? r.id} from the queue`}
                title="Remove from the queue"
                onClick={() => dispatch({ type: 'unqueueResearch', nodeId: r.id })}
              >
                ×
              </button>
            </span>
          </li>
        ))}

        {queue.length === 0 && (
          <li class="q-empty">
            {cur ? 'Nothing queued after this. Queue a topic and it starts when this one finishes.' : 'Nothing queued. Queue a topic from the timeline or the tree. Research towards adds its prerequisites too.'}
          </li>
        )}
      </ul>
    </section>
  );
}

type QueueState = 'done' | 'active' | 'available' | 'early' | 'locked';

/** The queue action for one node: Queue, Research towards (with the prerequisites it adds), or Unqueue. */
export function QueueAction({ node, state }: { node: ResearchNode; state: QueueState }) {
  const s = useGame();
  if (state === 'done' || state === 'active') return null;
  const queue = s.research.queue ?? [];
  const idx = queue.indexOf(node.id);
  if (idx >= 0) {
    return (
      <>
        <Pill tone="info">Queued {idx + 1}</Pill>
        <button type="button" class="btn" onClick={() => dispatch({ type: 'unqueueResearch', nodeId: node.id })}>
          Unqueue
        </button>
      </>
    );
  }
  const extra = Math.max(0, researchPath(s, node.id).length - 1);
  const label = extra > 0 ? `Research towards (+${extra})` : 'Queue';
  const title =
    extra > 0
      ? `Adds ${extra} prerequisite${extra === 1 ? '' : 's'}, then ${node.name}, to the queue.`
      : `Adds ${node.name} to the queue. It starts when the slot frees.`;
  return (
    <button type="button" class="btn" title={title} onClick={() => dispatch({ type: 'queueResearch', nodeId: node.id })}>
      {label}
    </button>
  );
}

/** Queue position for each queued topic, for marking nodes in the tree. */
export function queuePositions(queue: Id[] | undefined): Map<Id, number> {
  return new Map((queue ?? []).map((id, i) => [id, i + 1] as const));
}
