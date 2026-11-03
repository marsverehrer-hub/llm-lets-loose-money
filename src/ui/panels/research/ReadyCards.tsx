// "Ready to research": the topics you can start right now, as big cards with Start and Queue buttons.
// This is the first thing on the Research screen, so a player never has to dig through the tree to do the common thing.
import { useState } from 'preact/hooks';
import type { ResearchNode } from '../../../sim/types';
import { RESEARCH } from '../../../sim/data/research';
import { dispatch } from '../../store';
import { ProgressBar, useIsMobile } from '../../components';
import { fmtCount } from '../panelKit';
import { QueueAction } from '../ResearchQueue';
import { BRANCH_LABEL, ResearchView, branchOf, etaText, isCheaperNow, jokeName, topicName } from './model';

export function ReadyCards({
  view,
  onShow,
  filter,
}: {
  view: ResearchView;
  onShow: (n: ResearchNode) => void;
  /** v17.3: which topics to show (the "More upgrades" list passes the topics in no track). */
  filter?: (n: ResearchNode) => boolean;
}) {
  const [all, setAll] = useState(false);
  // Phones show fewer cards so the search and the full list stay within reach.
  const COLLAPSED = useIsMobile() ? 3 : 6;
  const recId = view.rec?.node.id;
  const ready = RESEARCH.filter((n) => view.stateOf(n) === 'available' && (!filter || filter(n))).sort(
    (a, b) => Number(b.id === recId) - Number(a.id === recId) || view.leftOf(a) - view.leftOf(b),
  );
  const shown = all ? ready : ready.slice(0, COLLAPSED);

  if (ready.length === 0) {
    return <div class="rs-empty">Nothing can be started right now. Finish the current topic, or wait for next year's ideas.</div>;
  }

  return (
    <div class="rs-ready">
      <div class="rs-ready-grid">
        {shown.map((n) => (
          <article key={n.id} class="rs-ready-card">
            <div class="rs-ready-top">
              <span class="rs-ready-branch">{BRANCH_LABEL[branchOf(n)]}</span>
              {isCheaperNow(view, n) && <span class="rs-ready-cheap">Cheaper now</span>}
            </div>
            <button type="button" class="rs-ready-name" onClick={() => onShow(n)} title="Show details">
              {topicName(n)}
            </button>
            {jokeName(n) && <div class="rs-rec-joke">{jokeName(n)}</div>}
            <div class="rs-ready-effect">{n.effectText ?? n.description}</div>
            {view.partialOf(n) > 0 && (
              <ProgressBar value={view.partialOf(n)} max={view.costOf(n)} height={4} label="Earlier progress kept" />
            )}
            <div class="rs-ready-foot">
              <span class="rs-ready-time num" title={`${fmtCount(view.leftOf(n), 0)} research points left`}>
                {etaText(view.leftOf(n), view.perDay)}
              </span>
              <span class="rs-ready-acts">
                {view.current ? (
                  <>
                    <QueueAction node={n} state="available" />
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      title={`Pauses ${topicName(view.current)}. Its progress is kept for later.`}
                      onClick={() => dispatch({ type: 'setResearch', nodeId: n.id })}
                    >
                      Switch
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" class="btn btn-sm btn-primary" onClick={() => dispatch({ type: 'setResearch', nodeId: n.id })}>
                      Start
                    </button>
                    <QueueAction node={n} state="available" />
                  </>
                )}
              </span>
            </div>
          </article>
        ))}
      </div>
      {ready.length > COLLAPSED && (
        <button type="button" class="btn btn-sm btn-ghost rs-ready-more" onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${ready.length}`}
        </button>
      )}
    </div>
  );
}
