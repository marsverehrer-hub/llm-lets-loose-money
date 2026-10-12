// v10 research list: every node as a row (All branches, or a search). Desktop is a table; a phone gets cards.
import type { Id, ResearchNode } from '../../../sim/types';
import type { NodeState as NodeStateLike } from './model';
import { Pill } from '../../components';
import { fmtCount, fmtPct } from '../panelKit';
import { BRANCH_LABEL, NODE_BY_ID, ResearchView, branchOf, etaText } from './model';
import { QueueAction } from '../ResearchQueue';
import { stateTag } from './Detail';

export interface ListProps {
  rows: ResearchNode[];
  view: ResearchView;
  selected: Id | null;
  isPhone: boolean;
  showBranch: boolean;
  onPick: (n: ResearchNode) => void;
  onStart: (n: ResearchNode) => void;
  /** Phone only: opens the details sheet. */
  onOpen?: (n: ResearchNode) => void;
  /** Shown instead of rows when nothing matches. */
  emptyText: string;
}

export function ResearchList({ rows, view, selected, isPhone, showBranch, onPick, onStart, onOpen, emptyText }: ListProps) {
  const { stateOf, costOf, progressFrac, remainingRP, perDay } = view;
  if (rows.length === 0) return <div class="rs-empty">{emptyText}</div>;

  const costText = (n: ResearchNode, st: string) =>
    st === 'done'
      ? 'Done'
      : st === 'active'
        ? `${etaText(remainingRP, perDay)} left`
        : etaText(costOf(n), perDay);
  /** Status tag, but a locked topic names what it needs first. */
  const tagOf = (n: ResearchNode, st: NodeStateLike) => {
    if (st !== 'locked') return stateTag(st, n);
    const miss = n.prereqs.find((p) => !view.done.has(p));
    return { tone: 'muted' as const, label: miss ? `Needs ${NODE_BY_ID.get(miss)?.name ?? miss}` : 'Locked' };
  };
  const action = (n: ResearchNode, st: NodeStateLike) =>
    st === 'available' && !view.current ? (
      <button
        type="button"
        class="btn btn-sm btn-primary"
        onClick={(e) => {
          e.stopPropagation();
          onStart(n);
        }}
      >
        Start
      </button>
    ) : (
      <span onClick={(e) => e.stopPropagation()}>
        <QueueAction node={n} state={st} />
      </span>
    );

  if (isPhone) {
    return (
      <ul class="rs-m-list" aria-label="Research nodes">
        {rows.map((n) => {
          const st = stateOf(n);
          const tag = tagOf(n, st);
          return (
            <li key={n.id} class={`rs-m-row${selected === n.id ? ' is-sel' : ''}`} data-state={st}>
              <button
                type="button"
                class="rs-m-open"
                onClick={() => {
                  onPick(n);
                  onOpen?.(n);
                }}
              >
                <span class="rs-m-head">
                  <span class="rs-m-name">
                    {n.name}
                    {st === 'done' && <span class="rs-check" aria-hidden="true">{' ✓'}</span>}
                  </span>
                  <Pill tone={tag.tone}>{tag.label}</Pill>
                </span>
                {showBranch && <span class="rs-m-branch">{BRANCH_LABEL[branchOf(n)]}</span>}
                <span class="rs-m-meta">
                  <span class="rs-cost">{costText(n, st)}</span>
                </span>
                <span class="rs-m-effect">{n.effectText}</span>
              </button>
              {st !== 'done' && st !== 'active' && <div class="rs-m-acts">{action(n, st)}</div>}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div class="rs-table-wrap">
      <table class="rs-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Effect</th>
            <th scope="col">Status</th>
            <th scope="col" aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const st = stateOf(n);
            const tag = tagOf(n, st);
            return (
              <tr
                key={n.id}
                class={`rs-row${selected === n.id ? ' is-sel' : ''}`}
                data-state={st}
                tabIndex={0}
                onClick={() => onPick(n)}
                onDblClick={() => onStart(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick(n);
                  }
                }}
              >
                <td class="rs-td-name">
                  {n.name}
                  {st === 'done' && <span class="rs-check" aria-hidden="true"> ✓</span>}
                  {showBranch && <div class="rs-td-branch">{BRANCH_LABEL[branchOf(n)]}</div>}
                </td>
                <td class="rs-td-effect">{n.effectText}</td>
                <td class="rs-td-status">
                  <Pill tone={tag.tone}>{tag.label}</Pill>
                  {st !== 'done' && (
                    <div class="rs-td-time num" title={`${fmtCount(costOf(n), 0)} research points`}>
                      {costText(n, st)}
                    </div>
                  )}
                </td>
                <td class="rs-td-act">{st !== 'done' && st !== 'active' && action(n, st)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
