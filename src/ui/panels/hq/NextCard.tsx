// OWNER: ONBOARD. Headquarters advisor: the prioritised list of next moves, each with a reason and a button.
import { useState } from 'preact/hooks';
import type { GameState } from '../../../sim/types';
import { Button, Card, Pill } from '../../components';
import { navigate } from '../../nav';
import { nextSteps, type Priority } from './nextStep';

const PRIORITY: Record<Priority, { label: string; tone: 'bad' | 'violet' | 'muted' }> = {
  urgent: { label: 'Urgent', tone: 'bad' },
  next: { label: 'Next', tone: 'violet' },
  idea: { label: 'Idea', tone: 'muted' },
};

/** How many moves show before "Show more". */
const SHOWN = 4;

export function NextCard({ s }: { s: GameState }) {
  const steps = nextSteps(s).filter((st) => !st.chapter); // the chapter has its own banner above
  const [all, setAll] = useState(false);
  const shown = all ? steps : steps.slice(0, SHOWN);
  const urgent = steps.filter((st) => st.priority === 'urgent').length;
  return (
    <Card
      title="Your next moves"
      subtitle={urgent > 0 ? `${urgent} need${urgent === 1 ? 's' : ''} you now` : 'Most useful first'}
      class={`hq-advisor ${urgent > 0 ? 'has-urgent' : ''}`}
    >
      <ol class="adv-list">
        {shown.map((st, i) => (
          <li key={st.text} class={`adv-item adv-${st.priority} ${i === 0 ? 'adv-top' : ''}`}>
            <span class="adv-rank num" aria-hidden="true">
              {i + 1}
            </span>
            <div class="adv-body">
              <div class="adv-head">
                <span class="adv-text">{st.text}</span>
                <Pill tone={PRIORITY[st.priority].tone}>{PRIORITY[st.priority].label}</Pill>
              </div>
              <p class="adv-why">{st.why}</p>
            </div>
            <Button size="sm" variant={i === 0 ? 'primary' : 'default'} onClick={() => navigate(st.panel, st.intent)}>
              {st.cta}
            </Button>
          </li>
        ))}
      </ol>
      {steps.length > SHOWN && (
        <button type="button" class="btn btn-ghost btn-sm adv-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${steps.length - SHOWN} more`}
        </button>
      )}
    </Card>
  );
}
