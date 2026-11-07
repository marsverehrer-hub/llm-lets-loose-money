// Headquarters advisor: the current lab chapter on one row, then the top moves from nextSteps, each with its reason and
// one button. Goals (board and scenario) sit behind a popover so the screen leads with what to do.
import { useState } from 'preact/hooks';
import type { GameState } from '../../../sim/types';
import { CHAPTERS, chapterIndex, currentChapter } from '../../../sim/systems/chapters';
import { Button, Card, EmptyState, Pill, Popover, ProgressBar, formatPct } from '../../components';
import { navigate } from '../../nav';
import { GoalsCard, ThesisCard } from '../GoalsCard';
import { BoardCard } from '../lab/BoardCard';
import { nextSteps, type Step } from './nextStep';
import { tutorialTarget } from '../../tutorial/steps';

/** How many moves show before "Show more". */
const SHOWN = 3;

/** Two moves that open the same place with the same intent show once; the higher-ranked one wins. */
function dedupe(steps: Step[]): Step[] {
  const seen = new Set<string>();
  return steps.filter((st) => {
    if (!st.intent) return true;
    const key = `${st.panel}|${JSON.stringify(st.intent)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function AdvisorCard({ s }: { s: GameState }) {
  const [more, setMore] = useState(false);
  const ch = currentChapter(s);
  const frac = ch?.progress ? Math.max(0, Math.min(1, ch.progress(s))) : null;
  // While the tutorial runs, the move it is teaching leads, so the coach card and the advisor never disagree.
  const tut = s.tutorialStep != null && s.tutorialStep > 0 ? tutorialTarget(s.tutorialStep) : null;
  const ranked = nextSteps(s);
  const ordered = tut ? [...ranked.filter((st) => st.panel === tut), ...ranked.filter((st) => st.panel !== tut)] : ranked;
  const steps = dedupe(ordered);
  const shown = more ? steps : steps.slice(0, SHOWN);
  const urgent = steps.filter((st) => st.priority === 'urgent').length;

  return (
    <Card
      title="Your next moves"
      subtitle={urgent > 0 ? `${urgent} need${urgent === 1 ? 's' : ''} you now` : 'Most useful first'}
      class={`hq-advisor ${urgent > 0 ? 'has-urgent' : ''}`}
      actions={
        <Popover label="Goals" align="right" width={440}>
          <div class="adv-goals">
            <BoardCard s={s} />
            <GoalsCard />
            <ThesisCard />
          </div>
        </Popover>
      }
    >
      <div class="adv-chap">
        <div class="adv-chap-text">
          <span class="adv-chap-num">{ch ? `Chapter ${chapterIndex(s) + 1} of ${CHAPTERS.length}` : 'All chapters complete'}</span>
          {ch && !steps.some((st) => st.chapter) && <span class="adv-chap-title">{ch.title}</span>}
        </div>
        {frac !== null && (
          <div class="adv-chap-progress">
            <ProgressBar value={frac} height={6} class="adv-chap-bar" />
            <span class="num muted small">{formatPct(frac, 0)}</span>
          </div>
        )}
      </div>

      {steps.length === 0 ? (
        <EmptyState title="Nothing needs you" text="The advisor has no move right now." />
      ) : (
        <ol class="adv-list">
          {shown.map((st, i) => (
            <li key={`${st.panel}-${i}`} class={`adv-item adv-${st.priority} ${i === 0 ? 'adv-top' : ''}`}>
              <span class="adv-rank num" aria-hidden="true">
                {i + 1}
              </span>
              <div class="adv-body">
                <div class="adv-head">
                  <span class="adv-text">{st.text}</span>
                  {st.priority === 'urgent' && <Pill tone="bad">Urgent</Pill>}
                </div>
                <p class="adv-why">{st.why}</p>
              </div>
              <Button size="sm" variant={i === 0 ? 'primary' : 'default'} onClick={() => navigate(st.panel, st.intent)}>
                {st.cta}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {steps.length > SHOWN && (
        <button type="button" class="btn btn-ghost btn-sm adv-more" onClick={() => setMore(!more)}>
          {more ? 'Show fewer' : `Show ${steps.length - SHOWN} more`}
        </button>
      )}
    </Card>
  );
}
