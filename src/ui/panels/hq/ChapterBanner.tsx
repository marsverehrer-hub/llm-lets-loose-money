// v17: the current lab chapter, leading Headquarters. One objective, why it matters, how far along you are, and the
// button that takes you there. The pips show the whole career at a glance.
import type { GameState } from '../../../sim/types';
import { CHAPTERS, chapterIndex } from '../../../sim/systems/chapters';
import { Button } from '../../components';
import { navigate } from '../../nav';
import { chapterNextStep } from './nextStep';
import type { PanelId } from '../../App';

export function ChapterBanner({ s }: { s: GameState }) {
  const i = chapterIndex(s);
  const ch = CHAPTERS[i];
  const pips = (
    <div class="chap-pips" aria-label={`${i} of ${CHAPTERS.length} chapters complete`}>
      {CHAPTERS.map((c, k) => (
        <span key={c.id} class={`chap-pip ${k < i ? 'done' : k === i ? 'now' : ''}`} title={c.title} />
      ))}
    </div>
  );
  if (!ch) {
    return (
      <section class="chap chap-done">
        <div class="chap-num">All chapters complete</div>
        <div class="chap-title">The lab is finished. The sandbox is yours.</div>
        {pips}
      </section>
    );
  }
  const frac = ch.progress ? Math.max(0, Math.min(1, ch.progress(s))) : null;
  return (
    <section class="chap" aria-label="Current chapter">
      <div class="chap-main">
        <div class="chap-num">
          Chapter {i + 1} <span class="chap-of">of {CHAPTERS.length}</span>
        </div>
        <div class="chap-title">{ch.title}</div>
        <p class="chap-why">{ch.why}</p>
        {frac !== null && (
          <div class="chap-progress">
            <span class="chap-bar" aria-hidden="true">
              <span class="chap-bar-fill" style={{ width: `${frac * 100}%` }} />
            </span>
            <span class="chap-pct num">{Math.floor(frac * 100)}%</span>
          </div>
        )}
        {pips}
      </div>
      <Button variant="primary" onClick={() => navigate(ch.panel as PanelId, chapterNextStep(s)?.intent)}>
        {ch.cta}
      </Button>
    </section>
  );
}
