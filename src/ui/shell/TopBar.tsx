import { useEffect, useRef, useState } from 'preact/hooks';
import type { Speed } from '../../sim/types';
import { AnimatedNumber, Button, Modal, Tooltip, clamp, resetPanelIntros } from '../components';
import { dispatch, getState, saveNow, useGame } from '../store';
import { hiddenPanels, showAllScreens, showNotice } from '../unlocks';
import { saveMessage } from '../saveText';
import { playSfx, toggleMuted, useMuted } from '../fx/sound';
import { openShortcuts } from './Shortcuts';
import { readTheme, setTheme, type Theme } from './theme';
import { InterfaceSizeRow } from './InterfaceSize';
import { bareMoney, tdate } from './fmt';
import { requestMatchSpeed, useSession, type NetStatus } from '../../net/session';
import { openLobby } from '../mp/lobbyState';
import { AUTOPAUSE_TRIGGERS, setAutoPause, useAutoPause } from '../autopause';
import { toggleNoticeLog, unreadCount, useNoticeLogOpen } from './NoticeLog';
import { openNewGame } from './NewGame'; // v9 scenario
import { openSaves } from './SavesSheet';

const SPEEDS: { speed: Speed; label: string; key: string }[] = [
  { speed: 1, label: '1×', key: '1' },
  { speed: 3, label: '3×', key: '2' },
  { speed: 10, label: '10×', key: '3' },
];

/** Speed to return to when un-pausing. */
let lastPlayed: Speed = 1;

function setSpeed(speed: Speed): void {
  const cur = getState().speed;
  if (cur > 0) lastPlayed = cur;
  // In a live match the speed is shared: pausing applies to both, faster asks the rival, unpausing counts down.
  if (getState().mp && requestMatchSpeed(speed)) return;
  dispatch({ type: 'setSpeed', speed });
}

function togglePause(): void {
  if (getState().speed === 0) setSpeed(lastPlayed);
  else setSpeed(0);
}

/** Phone speed button: 1× → 3× → 10× → 1×, from the running speed (or the last one played while paused). */
function cycleSpeed(): void {
  const cur = getState().speed || lastPlayed;
  const at = SPEEDS.findIndex((sp) => sp.speed === cur);
  setSpeed(SPEEDS[(at + 1) % SPEEDS.length].speed);
}

/** Flip sound on or off. Turning it on gives a click so the player hears it work (no-op while muted). */
function toggleSound(): void {
  toggleMuted();
  playSfx('click');
}

/** Words for the multiplayer room chip (title and aria). */
function roomStatus(status: NetStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected.';
    case 'waiting':
      return 'Waiting for opponent.';
    case 'connecting':
      return 'Connecting.';
    case 'disconnected':
      return 'Connection dropped.';
    case 'error':
      return 'Error.';
    default:
      return '';
  }
}

/** Connection dot colour for the room chip. */
function roomDot(status: NetStatus): string {
  if (status === 'connected') return 'dot-good';
  if (status === 'waiting' || status === 'connecting') return 'dot-warn dot-pulse';
  if (status === 'disconnected' || status === 'error') return 'dot-bad';
  return '';
}

/** Top bar: LLM <GO> block, company name (click to rename), date, ticker-style readouts, speed keys, sound, MENU. */
export function TopBar() {
  const s = useGame();
  const session = useSession();
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const savedTimer = useRef(0);
  const muted = useMuted();
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const autoPause = useAutoPause();
  const logOpen = useNoticeLogOpen();
  const unread = unreadCount(s);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Keyboard: Space = pause/resume, 1/2/3 = 1x/3x/10x, M = mute, L = notification log. Ignored while typing or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePause();
        return;
      }
      if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(3);
      else if (e.key === '3') setSpeed(10);
      else if (e.key === 'm' || e.key === 'M') toggleSound();
      else if (e.key === 'l' || e.key === 'L') toggleNoticeLog();
      else if ((e.key === 's' || e.key === 'S') && !document.querySelector('.ng-screen')) openSaves();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape closes the MENU. Dialogs handle their own Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const startEdit = () => {
    setDraft(s.company.name);
    editingRef.current = true;
    setEditing(true);
  };
  const finishEdit = (apply: boolean) => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const n = draft.trim().slice(0, 32);
    if (apply && n && n !== s.company.name) dispatch({ type: 'renameCompany', name: n });
  };

  const doSave = () => {
    const r = saveNow();
    if (!r.ok) {
      setSaved(false);
      setSaveErr(saveMessage(r.error));
      return;
    }
    setSaveErr('');
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
  };

  // v9 scenario: the confirm hands over to the setup screen (name, scenario, difficulty, options).
  const doNewGame = () => {
    setConfirmNew(false);
    setMenuOpen(false);
    openNewGame();
  };

  const net = s.finance.dailyRevenue - s.finance.dailyExpenses;
  const paused = s.speed === 0;
  const shownSpeed = s.speed > 0 ? s.speed : lastPlayed;
  const speedLabel = SPEEDS.find((sp) => sp.speed === shownSpeed)?.label ?? `${shownSpeed}×`;
  const eventPending = !!s.events.pending && s.events.pending.result === undefined;
  const aiHype = clamp(s.market.aiHype, 0, 100);
  const valLabel = s.company.isPublic ? 'Mkt cap' : 'Valuation';
  const statusTag = s.gameOver ? 'Game over' : eventPending ? 'Decision pending' : paused ? 'Paused' : '';

  return (
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">{'LLM <GO>'}</div>
        <div class="brand-text">
          {editing ? (
            <input
              ref={inputRef}
              class="input brand-company-input"
              value={draft}
              maxLength={32}
              aria-label="Company name"
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishEdit(true);
                else if (e.key === 'Escape') finishEdit(false);
              }}
              onBlur={() => finishEdit(true)}
            />
          ) : (
            <button type="button" class="brand-company" title="Click to rename" onClick={startEdit}>
              {s.company.name}
            </button>
          )}
          <div class="brand-date">
            {tdate(s.day)}
            {statusTag && <span class={`pause-tag ${s.gameOver ? 'bad' : ''}`}>{statusTag}</span>}
          </div>
        </div>
      </div>

      <div class="topbar-stats">
        <div class="topbar-stat ts-cash cash" title="Cash on hand. Delta is today's net (revenue minus expenses).">
          <span class="topbar-label">Cash</span>
          <span class="topbar-value">
            <AnimatedNumber value={s.finance.cash} format={(v) => bareMoney(v, 2)} />
          </span>
          <span class={`topbar-delta ${net >= 0 ? 'good' : 'bad'}`}>
            {net >= 0 ? '▲+' : '▼-'}
            {bareMoney(Math.abs(net), 0)}
          </span>
        </div>
        <div class="topbar-stat ts-rev" title="Revenue booked today">
          <span class="topbar-label">Rev/day</span>
          <span class="topbar-value good">
            <AnimatedNumber value={s.finance.dailyRevenue} format={(v) => bareMoney(v, 1)} />
          </span>
        </div>
        <div class="topbar-stat ts-burn" title="Expenses booked today">
          <span class="topbar-label">Burn/day</span>
          <span class="topbar-value">
            <AnimatedNumber value={s.finance.dailyExpenses} format={(v) => bareMoney(v, 1)} />
          </span>
        </div>
        <div class="topbar-stat ts-val" title={s.company.isPublic ? 'Public market capitalisation' : 'Private valuation'}>
          <span class="topbar-label">{valLabel}</span>
          <span class="topbar-value">
            <AnimatedNumber value={s.finance.valuation} format={(v) => bareMoney(v, 0)} />
          </span>
        </div>
        <Tooltip
          class="ts-hype"
          content={
            <>
              AI hype is the global mood about AI. Your company hype is <b>{Math.round(s.company.hype)}</b>, brand awareness{' '}
              <b>{Math.round(s.company.brand)}</b>.
            </>
          }
        >
          <div class="topbar-stat">
            <span class="topbar-label">Hype</span>
            <span class="topbar-value">{Math.round(aiHype)}</span>
          </div>
        </Tooltip>
      </div>

      <div class="topbar-end">
        {session.room && session.status !== 'idle' && (
          <button
            type="button"
            class="mp-room"
            title={`Multiplayer room ${session.room}. ${roomStatus(session.status)}`}
            aria-label={`Multiplayer room ${session.room}. ${roomStatus(session.status)}`}
            onClick={openLobby}
          >
            <span class={`dot ${roomDot(session.status)}`} aria-hidden="true" />
            <span class="mp-room-code">{session.room}</span>
          </button>
        )}
        <div class={`speed-group ${s.tutorialStep === 3 ? 'tut-pulse-target' : ''}`} role="group" aria-label="Game speed">
          <button
            type="button"
            class={`btn btn-sm ${paused ? 'on' : ''}`}
            title="Pause (Space)"
            aria-label="Pause"
            aria-pressed={paused}
            onClick={togglePause}
          >
            II
          </button>
          {SPEEDS.map((sp) => (
            <button
              key={sp.speed}
              type="button"
              class={`btn btn-sm ${s.speed === sp.speed ? 'on' : ''}`}
              title={`${sp.label} speed (${sp.key})`}
              aria-pressed={s.speed === sp.speed}
              onClick={() => setSpeed(sp.speed)}
            >
              {sp.label}
            </button>
          ))}
          {/* Phones only (ui/mobile.css): one button cycles the speed, so the top bar stays on one line. */}
          <button
            type="button"
            class={`btn btn-sm speed-cycle ${paused ? '' : 'on'}`}
            title="Change speed"
            aria-label={paused ? `Paused. Speed ${speedLabel}. Tap to change speed` : `Speed ${speedLabel}. Tap to change speed`}
            onClick={cycleSpeed}
          >
            {speedLabel}
          </button>
        </div>
        <button
          type="button"
          class={`btn btn-sm tb-desk ${logOpen ? 'on' : ''}`}
          title="Notification log (L)"
          aria-label={unread > 0 ? `Notification log, ${unread} unread` : 'Notification log'}
          aria-pressed={logOpen}
          onClick={toggleNoticeLog}
        >
          Log
          {unread > 0 && <span class="nl-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button
          type="button"
          class={`btn btn-sm tb-desk ${muted ? 'on' : ''}`}
          title={muted ? 'Sound off (M to toggle)' : 'Sound on (M to toggle)'}
          aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
          aria-pressed={muted}
          onClick={toggleSound}
        >
          {muted ? 'Muted' : 'Sound'}
        </button>
        <button
          type="button"
          class={`btn btn-sm ${menuOpen ? 'on' : ''}`}
          title="Menu"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          Menu
        </button>
        {menuOpen && (
          <>
            <div class="menu-scrim" onClick={() => setMenuOpen(false)} />
            <div class="menu" role="menu">
              <button type="button" class="menu-item" role="menuitem" onClick={doSave}>
                <span>{saved ? 'Saved' : 'Save game'}</span>
              </button>
              {saveErr && <div class="menu-note">{saveErr}</div>}
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  openSaves();
                }}
              >
                <span>Saves</span>
                <span class="kbd">S</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  toggleSound();
                }}
              >
                <span>{muted ? 'Turn sound on' : 'Mute sound'}</span>
                <span class="kbd">M</span>
              </button>
              <button
                type="button"
                class="menu-item tb-desk"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  openShortcuts();
                }}
              >
                <span>Keyboard shortcuts</span>
                <span class="kbd">?</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  toggleNoticeLog();
                }}
              >
                <span>{unread > 0 ? `Notification log (${unread > 99 ? '99+' : unread} new)` : 'Notification log'}</span>
                <span class="kbd">L</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onClick={() => {
                  const next: Theme = theme === 'light' ? 'dark' : 'light';
                  setThemeState(next);
                  setTheme(next);
                  setMenuOpen(false);
                }}
              >
                <span>{theme === 'light' ? 'Dark theme' : 'Light theme'}</span>
              </button>
              <InterfaceSizeRow />
              {/* Progressive disclosure (ui/unlocks.ts): open every nav screen, or bring back the one-line screen tips. */}
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                disabled={hiddenPanels(s).length === 0}
                onClick={() => {
                  setMenuOpen(false);
                  showAllScreens();
                }}
              >
                <span>Show all screens</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  resetPanelIntros();
                  showNotice('Screen tips are back. Each one shows the next time you open its screen.');
                }}
              >
                <span>Show screen tips again</span>
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  openLobby();
                }}
              >
                <span>Multiplayer…</span>
              </button>
              <div class="menu-sep" />
              <div class="menu-head">Pause when…</div>
              {AUTOPAUSE_TRIGGERS.map((t) => (
                <label key={t.id} class="menu-check">
                  <input
                    type="checkbox"
                    checked={autoPause[t.id]}
                    disabled={!!s.mp}
                    onChange={(e) => setAutoPause(t.id, (e.target as HTMLInputElement).checked)}
                  />
                  <span>{t.label}</span>
                </label>
              ))}
              {s.mp && <div class="menu-note">Off during a multiplayer match.</div>}
              <div class="menu-sep" />
              <button
                type="button"
                class="menu-item danger"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmNew(true);
                }}
              >
                <span>New game...</span>
              </button>
            </div>
          </>
        )}
      </div>

      <Modal
        open={confirmNew}
        title="Start a new company?"
        tone="danger"
        width={460}
        onClose={() => setConfirmNew(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmNew(false)}>
              Keep my company
            </Button>
            <Button variant="danger" onClick={doNewGame}>
              Start over
            </Button>
          </>
        }
      >
        <p class="muted">The company you are running stays in Saves, so you can come back to it. The new company becomes the active game.</p>
      </Modal>
    </header>
  );
}
