// OWNER: Agent MOMENTS. Full-window "aha" takeover for s.pendingMoment (GAME_DESIGN §18.3). The sim is blocked while it
// shows. Size, contrast and whitespace do the work; the only motion is a 100ms flash on appear.
import { useEffect, useRef } from 'preact/hooks';
import type { Moment } from '../../sim/types';
import { playSfx } from '../fx/sound';
import { dispatch, useGameSelect } from '../store';
import { tdate } from './fmt';
import './moment.css';

const TONE_LABEL: Record<Moment['tone'], string> = {
  triumph: 'Triumph',
  milestone: 'Milestone',
  loss: 'Setback',
};

export function MomentTakeover() {
  const m = useGameSelect((s) => s.pendingMoment ?? null);
  if (!m) return null;
  // Keyed per moment so each one mounts fresh: the flash replays and the focus lands on Continue.
  return <MomentBody key={`${m.id}:${m.day}`} m={m} />;
}

function MomentBody({ m }: { m: Moment }) {
  const btn = useRef<HTMLButtonElement>(null);

  const next = () => dispatch({ type: 'dismissMoment' });

  useEffect(() => {
    btn.current?.focus();
    playSfx(m.tone === 'loss' ? 'bonk' : 'fanfare');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: 'dismissMoment' });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [m.id, m.day]);

  return (
    <div class="mo-root" role="dialog" aria-modal="true" aria-labelledby="mo-title">
      <div class="mo-card">
        <div class="mo-kicker">
          <span class="mo-date mo-num">{tdate(m.day)}</span>
          <span class={`mo-tone mo-tone-${m.tone}`}>{TONE_LABEL[m.tone]}</span>
        </div>

        <h1 class={`mo-title mo-title-${m.tone}`} id="mo-title">
          {m.title}
        </h1>

        <p class="mo-subtitle">{m.subtitle}</p>

        {m.stats.length > 0 && (
          <dl class="mo-stats">
            {m.stats.map((st) => (
              <div class="mo-stat" key={st.label}>
                <dt class="mo-stat-label">{st.label}</dt>
                <dd class={st.num ? 'mo-stat-value mo-num' : 'mo-stat-value'}>{st.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div class="mo-actions">
          <button ref={btn} type="button" class="mo-continue" onClick={next}>
            Continue
          </button>
          <span class="mo-hint">Enter or Space to continue</span>
        </div>
      </div>
    </div>
  );
}
