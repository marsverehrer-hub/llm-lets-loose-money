// v10 research timeline: years across, one cell per node in the year it came out, coloured by state. Click a cell to
// select it. Tapping a year label selects the year (on phones the year's ideas list below the timeline).
import type { Id, ResearchNode } from '../../../sim/types';
import { NODES_BY_YEAR, NodeState, ResearchView, YEARS, BRANCH_LABEL, branchOf, etaText } from './model';
import { fmtCount } from '../panelKit';

const STATE_TEXT: Record<NodeState, string> = {
  done: 'done',
  active: 'in progress',
  available: 'ready',
  early: 'locked',
  locked: 'locked',
};

interface TimelineProps {
  view: ResearchView;
  selected: Id | null;
  /** The year whose label is pressed (and whose ideas the phone list shows). */
  yearSel: number;
  onPick: (n: ResearchNode) => void;
  onYear: (y: number) => void;
}

export function Timeline({ view, selected, yearSel, onPick, onYear }: TimelineProps) {
  const { year, stateOf, costOf, perDay } = view;
  return (
    <div class="tl" role="group" aria-label="Research timeline, one cell per node, by the year it came out">
      <div class="tl-grid" style={{ gridTemplateColumns: `repeat(${YEARS.length}, minmax(0, 1fr))` }}>
        {YEARS.map((y) => {
          const nodes = NODES_BY_YEAR.get(y) ?? [];
          const now = y === year;
          return (
            <div key={y} class={`tl-col${now ? ' is-now' : ''}${y > year ? ' is-future' : ''}`} data-year={y}>
              <button
                type="button"
                class="tl-year num"
                aria-pressed={yearSel === y}
                aria-label={`${y}: ${nodes.length} ${nodes.length === 1 ? 'idea' : 'ideas'}${now ? ', now' : ''}`}
                onClick={() => onYear(y)}
              >
                <span class="tl-year-full" aria-hidden="true">{y}</span>
                <span class="tl-year-short" aria-hidden="true">{`'${String(y).slice(2)}`}</span>
              </button>
              <div class="tl-cells">
                {nodes.map((n) => {
                  const st = stateOf(n);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      class={`tl-cell${selected === n.id ? ' is-sel' : ''}`}
                      data-state={st}
                      aria-pressed={selected === n.id}
                      aria-label={`${n.name}, ${BRANCH_LABEL[branchOf(n)]}, idea from ${y}, ${STATE_TEXT[st]}, ${fmtCount(costOf(n), 0)} RP`}
                      title={`${n.name} · idea from ${y} · ${STATE_TEXT[st]} · ${fmtCount(costOf(n), 0)} RP${st === 'done' || perDay <= 0 ? '' : ` · ${etaText(costOf(n), perDay)}`}`}
                      onClick={() => onPick(n)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div class="tl-key" aria-hidden="true">
        <span class="tl-key-item"><span class="tl-sw" data-state="done" />Done</span>
        <span class="tl-key-item"><span class="tl-sw" data-state="active" />In progress</span>
        <span class="tl-key-item"><span class="tl-sw" data-state="available" />Ready</span>
        <span class="tl-key-item"><span class="tl-sw" data-state="locked" />Locked</span>
        <span class="tl-key-item tl-key-now">Now is {year}</span>
      </div>
    </div>
  );
}
