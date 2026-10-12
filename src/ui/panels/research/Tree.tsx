// v10 research tree for one branch: columns are tiers (prerequisite depth), arrows are prerequisites. Kept from v3,
// with effective prices and a zoom control on phones. Remount with key={branch} to reset zoom when the branch changes.
import { useRef, useState } from 'preact/hooks';
import type { Id, ResearchBranch, ResearchNode } from '../../../sim/types';
import { RESEARCH_BRANCHES } from '../../../sim/types';
import { RESEARCH } from '../../../sim/data/research';
import { Pill, clamp } from '../../components';
import { fmtCount } from '../panelKit';
import { BRANCH_LABEL, NODE_BY_ID, ResearchView, branchOf, etaText } from './model';
import { stateTag } from './Detail';
import { QueueAction } from '../ResearchQueue';

// tree geometry (px)
const NODE_W = 216;
const NODE_H = 150;
const PITCH_X = 248;
const PITCH_Y = 162;
const PAD = 16;
const HEAD_H = 44;

interface TreeLayout {
  pos: Map<Id, { x: number; y: number }>;
  cols: number;
  tierYear: (number | null)[];
  width: number;
  height: number;
}

/** Columns are tiers (prereq depth). Rows are ordered by the mean row of same-branch prereqs to cut crossings. */
function layoutBranch(branch: ResearchBranch, all: ResearchNode[]): TreeLayout {
  const nodes = all.filter((n) => branchOf(n) === branch);
  const cols = nodes.reduce((m, n) => Math.max(m, n.tier), 0) + 1;
  const byTier: ResearchNode[][] = Array.from({ length: cols }, () => []);
  for (const n of nodes) byTier[n.tier].push(n);

  const row = new Map<Id, number>();
  const pos = new Map<Id, { x: number; y: number }>();
  const tierYear: (number | null)[] = [];
  let maxRows = 1;
  byTier.forEach((list, t) => {
    const order = new Map(list.map((n, i) => [n.id, i] as const));
    const keyOf = (n: ResearchNode): number => {
      const rows = n.prereqs.map((p) => row.get(p)).filter((v): v is number => v !== undefined);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Infinity;
    };
    const sorted = [...list].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return order.get(a.id)! - order.get(b.id)!;
    });
    sorted.forEach((n, i) => {
      row.set(n.id, i);
      pos.set(n.id, { x: PAD + t * PITCH_X, y: PAD + HEAD_H + i * PITCH_Y });
    });
    tierYear.push(list.length ? Math.min(...list.map((n) => n.minYear)) : null);
    maxRows = Math.max(maxRows, sorted.length);
  });
  return {
    pos,
    cols,
    tierYear,
    width: PAD + (cols - 1) * PITCH_X + NODE_W + PAD,
    height: PAD + HEAD_H + maxRows * PITCH_Y,
  };
}

const LAYOUTS = new Map<ResearchBranch, TreeLayout>(RESEARCH_BRANCHES.map((b) => [b, layoutBranch(b, RESEARCH)] as const));

/** Nearest node in a direction within one tree. Right/left prefer the nearest column, then the nearest row. */
function neighbour(nodes: ResearchNode[], pos: TreeLayout['pos'], from: Id, key: string): Id | null {
  const a = pos.get(from);
  if (!a) return null;
  let best: Id | null = null;
  let bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === from) continue;
    const b = pos.get(n.id);
    if (!b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let score: number | null = null;
    if (key === 'ArrowRight' && dx > 0) score = dx + Math.abs(dy) * 0.1;
    else if (key === 'ArrowLeft' && dx < 0) score = -dx + Math.abs(dy) * 0.1;
    else if (key === 'ArrowDown' && dx === 0 && dy > 0) score = dy;
    else if (key === 'ArrowUp' && dx === 0 && dy < 0) score = -dy;
    if (score !== null && score < bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}

/** Distance between the first two touches (pinch zoom on phones). */
const touchDist = (t: TouchList): number => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export interface TreeProps {
  branch: ResearchBranch;
  view: ResearchView;
  selected: ResearchNode | null;
  isPhone: boolean;
  queuePos: Map<Id, number>;
  onPick: (n: ResearchNode) => void;
  onStart: (n: ResearchNode) => void;
  /** Phone only: a tap opens the details sheet. */
  onOpen?: (n: ResearchNode) => void;
}

export function ResearchTree({ branch, view, selected, isPhone, queuePos, onPick, onStart, onOpen }: TreeProps) {
  const layout = LAYOUTS.get(branch)!;
  const scope = RESEARCH.filter((n) => branchOf(n) === branch);
  const { done, stateOf, costOf, progressFrac, remainingRP, perDay, current } = view;
  const [zoom, setZoom] = useState(1);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const nodeEls = useRef(new Map<Id, HTMLElement>());
  const edges = scope.flatMap((n) =>
    n.prereqs.filter((p) => layout.pos.has(p) && layout.pos.has(n.id)).map((p) => ({ from: NODE_BY_ID.get(p)!, to: n })),
  );
  const treeFocus = selected && layout.pos.has(selected.id) ? selected.id : scope[0]?.id;
  const isDone = (id: Id) => done.has(id);

  const onNodeKey = (e: KeyboardEvent, n: ResearchNode) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(n);
      if (isPhone) onOpen?.(n);
      return;
    }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const next = neighbour(scope, layout.pos, n.id, e.key);
    if (next) {
      const nn = NODE_BY_ID.get(next)!;
      onPick(nn);
      nodeEls.current.get(next)?.focus();
    }
  };

  return (
    <div
      class="rs-tree-scroll"
      onTouchStart={isPhone ? (e: TouchEvent) => { if (e.touches.length === 2) pinch.current = { d: touchDist(e.touches), z: zoom }; } : undefined}
      onTouchMove={isPhone ? (e: TouchEvent) => { const p = pinch.current; if (p && e.touches.length === 2 && p.d > 0) setZoom(clamp((p.z * touchDist(e.touches)) / p.d, 1, 1.6)); } : undefined}
      onTouchEnd={isPhone ? (e: TouchEvent) => { if (e.touches.length < 2) pinch.current = null; } : undefined}
    >
      {isPhone && (
        <div class="rs-m-zoom" role="group" aria-label="Tree zoom">
          <button type="button" class="btn" disabled={zoom <= 1} onClick={() => setZoom(clamp(zoom - 0.2, 1, 1.6))} aria-label="Zoom out">
            −
          </button>
          <span class="num rs-m-zoom-v">{`${Math.round(zoom * 100)}%`}</span>
          <button type="button" class="btn" disabled={zoom >= 1.6} onClick={() => setZoom(clamp(zoom + 0.2, 1, 1.6))} aria-label="Zoom in">
            +
          </button>
          <span class="rs-m-hint">Pinch or drag to pan</span>
        </div>
      )}
      <div
        class="rs-tree"
        role="group"
        aria-label={`${BRANCH_LABEL[branch]} research tree`}
        style={`width:${layout.width}px;height:${layout.height}px${isPhone ? `;zoom:${zoom}` : ''}`}
      >
        <svg class="rs-edges" width={layout.width} height={layout.height} aria-hidden="true">
          {edges.map((e) => {
            const a = layout.pos.get(e.from.id)!;
            const b = layout.pos.get(e.to.id)!;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const xm = (x1 + x2) / 2;
            const hot = !!selected && (e.from.id === selected.id || e.to.id === selected.id);
            return <path key={`${e.from.id}>${e.to.id}`} d={`M${x1} ${y1}H${xm}V${y2}H${x2}`} class={hot ? 'rs-edge is-hot' : 'rs-edge'} />;
          })}
        </svg>

        {layout.tierYear.map((yr, t) =>
          yr === null ? null : (
            <div key={`t${t}`} class="rs-tier" style={`left:${PAD + t * PITCH_X}px;top:${PAD}px;width:${NODE_W}px`}>
              <span>From {yr}</span>
            </div>
          ),
        )}

        {scope.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const st = stateOf(n);
          const sel = selected?.id === n.id;
          const cross = st === 'done' ? [] : n.prereqs.filter((q) => !isDone(q) && branchOf(NODE_BY_ID.get(q)!) !== branch);
          const needs = cross.length
            ? `Needs ${NODE_BY_ID.get(cross[0])?.name ?? cross[0]} (${BRANCH_LABEL[branchOf(NODE_BY_ID.get(cross[0])!)]})${cross.length > 1 ? ` +${cross.length - 1}` : ''}`
            : '';
          const cost = costOf(n);
          const costText = st === 'done' ? '' : st === 'active' ? `${etaText(remainingRP, perDay)} left` : etaText(cost, perDay);
          const tag = stateTag(st, n);
          return (
            <div
              key={n.id}
              ref={(el: Element | null) => {
                if (el) nodeEls.current.set(n.id, el as HTMLElement);
                else nodeEls.current.delete(n.id);
              }}
              role="button"
              tabIndex={n.id === treeFocus ? 0 : -1}
              class="rs-node"
              data-state={st}
              data-sel={sel ? 'true' : 'false'}
              style={`left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px`}
              aria-label={`${n.name}. ${tag.label}. ${fmtCount(cost, 0)} RP.`}
              title={n.effectText ? `${n.name}: ${n.effectText}` : n.name}
              onClick={() => {
                onPick(n);
                if (isPhone) onOpen?.(n);
              }}
              onDblClick={() => onStart(n)}
              onKeyDown={(e) => onNodeKey(e, n)}
            >
              {st === 'active' && current && <span class="rs-node-fill" style={`width:${(progressFrac * 100).toFixed(1)}%`} />}
              <span class="rs-node-head">
                <span class="rs-node-name">{n.name}</span>
                {st === 'done' && (
                  <span class="rs-check" aria-hidden="true">
                    ✓
                  </span>
                )}
                {queuePos.has(n.id) && (
                  <span class="q-mark" title="In the research queue">
                    Q{queuePos.get(n.id)}
                  </span>
                )}
              </span>
              <span class="rs-node-meta">
                <span class="rs-cost" title={`${fmtCount(cost, 0)} research points`}>{costText}</span>
                <Pill tone={tag.tone}>{tag.label}</Pill>
              </span>
              <span class="rs-node-effect">{n.effectText}</span>
              <span class="rs-node-needs">{needs}</span>
              {st !== 'done' && st !== 'active' && (
                <span class="rs-node-act" onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
                  {st === 'available' && !current ? (
                    <button type="button" class="btn btn-sm btn-primary" onClick={() => onStart(n)}>
                      Start
                    </button>
                  ) : (
                    <QueueAction node={n} state={st} />
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
