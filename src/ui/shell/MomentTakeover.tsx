// OWNER: Agent MOMENTS. Full-window "aha" takeover for s.pendingMoment (GAME_DESIGN §18.3). The sim is blocked while it
// shows. Size, contrast and whitespace do the work. The release beat adds an arena board whose new row slides into place.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState, Moment } from '../../sim/types';
import { arenaLeaderboard, type ArenaRow } from '../../sim/systems/competitors';
import { provisionalElo } from '../../sim/systems/lab';
import { isReleaseMoment, type ReleaseMoment } from '../../sim/systems/moments';
import { bestPlayerModel } from '../../sim/systems/market';
import { playSfx } from '../fx/sound';
import { navigate } from '../nav';
import { dispatch, useGameSelect } from '../store';
import { tdate } from './fmt';
import './moment.css';

const TONE_LABEL: Record<Moment['tone'], string> = {
  triumph: 'Triumph',
  milestone: 'Milestone',
  loss: 'Setback',
};

/** Rows on the release board: the top labs, plus you if you are not among them (as the HQ Rival race does). */
const BOARD_SIZE = 5;
const ROW_H = 44;

/** The arena rows the HQ Rival race shows, with your Elo as the public (provisional) figure. */
function boardFor(s: GameState): ArenaRow[] {
  const rows = arenaLeaderboard(s);
  const best = bestPlayerModel(s);
  const playerElo = best ? provisionalElo(s, best).elo : undefined;
  const shown = rows.map((r) => (r.isPlayer && playerElo !== undefined ? { ...r, elo: playerElo } : r));
  const top = shown.slice(0, BOARD_SIZE);
  const me = shown.find((r) => r.isPlayer);
  if (me && !top.includes(me)) top.push(me);
  return top;
}

function sameBoard(a: ArenaRow[], b: ArenaRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id && r.elo === b[i].elo && r.modelName === b[i].modelName);
}

export function MomentTakeover() {
  const m = useGameSelect((s) => s.pendingMoment ?? null);
  if (!m) return null;
  // Keyed per moment so each one mounts fresh: the flash replays and the focus lands on the first button.
  if (isReleaseMoment(m)) return <ReleaseBody key={`${m.id}:${m.day}`} m={m} />;
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
          <button ref={btn} type="button" class="btn btn-primary" onClick={next}>
            Continue
          </button>
          <span class="mo-hint">Enter or Space to continue</span>
        </div>
      </div>
    </div>
  );
}

/** Release beat: the arena board, a big Elo delta, and "Sell it" (inked) or "Later". Enter does not dismiss it. */
function ReleaseBody({ m }: { m: ReleaseMoment }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [entered, setEntered] = useState(false);
  const board = useGameSelect(boardFor, sameBoard);
  const name = useGameSelect((s) => s.models.find((x) => x.id === m.payload.modelId)?.name ?? '');
  const { elo, prevBestElo, rank } = m.payload;
  const delta = prevBestElo > 0 ? elo - prevBestElo : null;

  useEffect(() => {
    btn.current?.focus();
    playSfx('fanfare');
    // Start the new row at the bottom of the board, then let the CSS transition move it to its place.
    const t = window.setTimeout(() => setEntered(true), 60);
    return () => window.clearTimeout(t);
  }, [m.id, m.day]);

  const sell = () => {
    dispatch({ type: 'dismissMoment' });
    navigate('products');
  };
  const later = () => dispatch({ type: 'dismissMoment' });

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

        <div class="mo-release">
          <div class="mo-delta">
            <span class="mo-delta-value mo-num">{delta === null ? String(elo) : `${delta >= 0 ? '+' : ''}${delta}`}</span>
            <span class="mo-delta-unit">Elo</span>
            <span class="mo-delta-model">
              {name} · #{rank}
            </span>
          </div>

          <ol class="mo-board" style={{ height: `${board.length * ROW_H}px` }} aria-label="Arena board">
            {board.map((r, i) => {
              const y = r.isPlayer && !entered ? board.length - 1 : i;
              return (
                <li
                  key={r.id}
                  class={`mo-row${r.isPlayer ? ' mo-row-me' : ''}`}
                  style={{ transform: `translateY(${y * ROW_H}px)` }}
                >
                  <span class="mo-row-rank mo-num">{i + 1}</span>
                  <span class="mo-row-lab">{r.name}</span>
                  <span class="mo-row-model">{r.modelName}</span>
                  <span class="mo-row-elo mo-num">{Math.round(r.elo)}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div class="mo-actions">
          <button ref={btn} type="button" class="btn btn-primary" onClick={sell}>
            Sell it
          </button>
          <button type="button" class="btn btn-ghost" onClick={later}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
