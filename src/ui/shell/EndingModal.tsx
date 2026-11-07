// v19 endings UI (Preprint look). Two takeovers: "§ Conclusion" while s.pendingEnding waits for a choice, and
// "§ Epilogue" once s.ending is set. The sim is blocked while the first one shows.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ACHIEVEMENTS } from '../../sim/data/achievements';
import { ENDINGS, endingScore, type EndingDef } from '../../sim/systems/endings';
import { labName } from '../../sim/systems/labs';
import { bestPlayerModel } from '../../sim/systems/market';
import type { EndingId, GameState } from '../../sim/types';
import { formatMoney } from '../../sim/util';
import { Button, formatInt } from '../components';
import { dispatch, useGame, useGameSelect } from '../store';
import { openNewGame } from './NewGame';
import { openSaves } from './SavesSheet';
import { plain, tdate } from './fmt';
import './ending.css';

const defs = (): EndingDef[] => ENDINGS;

/** The first sentence of an ending's text, for the list. */
export const teaser = (text: string): string => plain(text).split(/(?<=[.!?])\s/)[0] ?? '';

/** Focus the inked button (or the first focusable element) once a takeover mounts. */
function focusPrimary(root: HTMLElement | null): void {
  const el = root?.querySelector<HTMLElement>('.btn-primary') ?? root?.querySelector<HTMLElement>('button');
  el?.focus();
}

/** Keeps Tab inside the dialog (aria-modal does not do that by itself). */
function useFocusTrap(root: { current: HTMLElement | null }): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !root.current) return;
      const els = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
      if (els.length === 0) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        els[els.length - 1].focus();
      } else if (!e.shiftKey && (i === -1 || i === els.length - 1)) {
        e.preventDefault();
        els[0].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export function EndingModal() {
  const pending = useGameSelect((s) => s.pendingEnding ?? null);
  const ending = useGameSelect((s) => s.ending ?? null);
  if (pending) return <ChooseBody key={`${pending.by}:${pending.day}`} />;
  if (ending) return <EpilogueBody key={`${ending.id}:${ending.day}`} />;
  return null;
}

function labelOf(s: GameState, by: 'player' | string): string {
  return by === 'player' ? 'Your lab' : labName(s, by);
}

function abstractOf(s: GameState, day: number, by: 'player' | string): string {
  if (by === 'player') {
    return `On ${tdate(day)} our internal evaluation reached its final, longest and least-read number, and we are obliged to report that the number is AGI. The team is delighted, the board learned of it from a single line in an email, and the regulators have asked for a meeting on a date that has not yet been set. The endings below are the ones the record currently allows, each with the reasons it is or is not on the table.`;
  }
  return `${labName(s, by)} announced AGI on ${tdate(day)}. The announcement ran to forty pages, one figure and a footnote thanking the reader for their patience, and nobody at this company has read all of it who was not paid to. We are not certain what they built. We are certain it is their word against ours, and that the press has already chosen a side. The endings below are what remains for us to do.`;
}

function ChooseBody() {
  const s = useGame();
  const pe = s.pendingEnding;
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root);
  useEffect(() => focusPrimary(root.current), []);
  if (!pe) return null;

  const rows = defs().map((def) => ({ def, avail: def.available(s), score: endingScore(s, def.id) }));
  // The inked button goes to the highest-scoring available ending only.
  let best: (typeof rows)[number] | undefined;
  for (const r of rows) if (r.avail.ok && (!best || r.score > best.score)) best = r;
  const keepGoing = rows.find((r) => r.def.id === 'second_place');

  const choose = (id: EndingId) => dispatch({ type: 'chooseEnding', id });
  const by = labelOf(s, pe.by);

  return (
    <div class="end-root" role="dialog" aria-modal="true" aria-labelledby="end-title" ref={root}>
      <article class="end-paper">
        <header class="end-head">
          <p class="end-kicker">
            <span class="end-date">{tdate(pe.day)}</span>
            <span class="end-label">Reached by</span>
            <span class="end-by">{by}</span>
          </p>
          <h1 class="end-title" id="end-title">
            <span class="pen end-mark">§</span> Conclusion
          </h1>
        </header>

        <p class="end-abstract">{abstractOf(s, pe.day, pe.by)}</p>

        <ul class="end-list" aria-label="Endings">
          <li class="end-row end-row-head" aria-hidden="true">
            <span>Ending</span>
            <span>Status</span>
            <span class="num">Score</span>
            <span />
          </li>
          {rows.map(({ def, avail, score }) => (
            <li
              class={`end-row${avail.ok ? '' : ' is-locked'}`}
              tabIndex={avail.ok ? 0 : -1}
              onKeyDown={(e) => {
                // Enter on the row itself chooses it; Enter on its button is the button's own click.
                if (e.key !== 'Enter' || e.target !== e.currentTarget || !avail.ok) return;
                e.preventDefault();
                choose(def.id);
              }}
              key={def.id}
            >
              <span class="end-name">
                <span class="end-name-text">{def.name}</span>
                {def.text && <span class="end-teaser">{teaser(def.text)}</span>}
              </span>
              <span class="end-status">
                {avail.ok ? <span class="end-pill">Available</span> : <span class="pen">{avail.why}</span>}
              </span>
              <span class="end-score num">{formatInt(score)}</span>
              <span class="end-choose">
                <Button
                  variant={best?.def.id === def.id ? 'primary' : 'default'}
                  disabled={!avail.ok}
                  onClick={() => choose(def.id)}
                >
                  Choose
                </Button>
              </span>
            </li>
          ))}
        </ul>

        {keepGoing?.avail.ok && (
          <div class="end-actions">
            <Button onClick={() => dispatch({ type: 'continueAfterEnding' })}>Keep going</Button>
            <span class="end-hint">Nothing is chosen. The game carries on, and this offer does not come back.</span>
          </div>
        )}
      </article>
    </div>
  );
}

function EpilogueBody() {
  const s = useGame();
  const end = s.ending;
  const root = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState(false);
  useFocusTrap(root);
  useEffect(() => focusPrimary(root.current), []);
  if (!end || closed) return null;

  const def = defs().find((d) => d.id === end.id);
  const best = bestPlayerModel(s);
  const close = () => setClosed(true);

  return (
    <div class="end-root" role="dialog" aria-modal="true" aria-labelledby="end-epi-title" ref={root}>
      <article class="end-paper">
        <header class="end-head">
          <p class="end-kicker">
            <span class="pen end-mark">§</span> Epilogue
            <span class="end-date">{tdate(end.day)}</span>
          </p>
          <h1 class="end-title" id="end-epi-title">
            {def?.name ?? end.id}
          </h1>
        </header>

        {def?.text && <p class="end-abstract">{plain(def.text)}</p>}

        <dl class="end-stats">
          <div class="end-stat">
            <dt>Score</dt>
            <dd class="num">{formatInt(end.score)}</dd>
          </div>
          <div class="end-stat">
            <dt>Valuation</dt>
            <dd class="num">{formatMoney(s.finance.valuation, 1)}</dd>
          </div>
          <div class="end-stat">
            <dt>Best model</dt>
            <dd>{best?.name ?? '—'}</dd>
          </div>
          <div class="end-stat">
            <dt>Days played</dt>
            <dd class="num">{formatInt(s.day)}</dd>
          </div>
          <div class="end-stat">
            <dt>Models trained</dt>
            <dd class="num">{formatInt(s.stats.modelsTrained)}</dd>
          </div>
          <div class="end-stat">
            <dt>Trophies</dt>
            <dd class="num">{`${Object.keys(s.achievements).length} / ${ACHIEVEMENTS.length}`}</dd>
          </div>
        </dl>

        <div class="end-actions">
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: 'continueAfterEnding' });
              close();
            }}
          >
            Keep playing
          </Button>
          <Button
            onClick={() => {
              close();
              openNewGame();
            }}
          >
            New game
          </Button>
          <Button
            onClick={() => {
              close();
              openSaves();
            }}
          >
            Load a save
          </Button>
        </div>
      </article>
    </div>
  );
}
