// Notification log drawer (GAME_DESIGN §18.4). Every notify() line from state.noticeLog, newest first, with a kind
// filter and a text search. Opened from the top bar Log button, the MENU, or the L key. Not modal: the game keeps running.
import { useEffect, useState } from 'preact/hooks';
import type { GameState, NoticeKind } from '../../sim/types';
import { EmptyState } from '../components';
import { getState, useGame } from '../store';
import { plain, tdate } from './fmt';
import './noticelog.css';

const KINDS: { id: NoticeKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'good', label: 'Good' },
  { id: 'bad', label: 'Bad' },
  { id: 'info', label: 'Info' },
  { id: 'milestone', label: 'Milestone' },
];
const KIND_LABEL: Record<NoticeKind, string> = { good: 'Good', bad: 'Bad', info: 'Info', milestone: 'Milestone' };
const KIND_DOT: Record<NoticeKind, string> = { good: 'dot-good', bad: 'dot-bad', info: 'dot-info', milestone: 'dot-milestone' };

// ---------------------------------------------------------------------------
// Open state, and the "seen" marker that drives the unread count. The marker is the last entry the player has
// seen. Entries after it are unread. The marker is set when the drawer opens, and on first look at a save so the
// existing history does not count as unread.
// ---------------------------------------------------------------------------
type Entry = NonNullable<GameState['noticeLog']>[number];

let open = false;
const openListeners = new Set<() => void>();
let seenEntry: Entry | null = null;
let seenReady = false;

function setOpen(v: boolean): void {
  open = v;
  for (const l of openListeners) l();
}

function markSeen(s: GameState): void {
  const log = s.noticeLog ?? [];
  seenEntry = log.length > 0 ? log[log.length - 1] : null;
  seenReady = true;
}

/** Notices added since the log was last open. Capped entries that were seen count as read, so this never goes negative. */
export function unreadCount(s: GameState): number {
  const log = s.noticeLog ?? [];
  if (!seenReady) markSeen(s);
  if (!seenEntry) return log.length;
  const at = log.lastIndexOf(seenEntry);
  return at < 0 ? log.length : log.length - 1 - at;
}

export function openNoticeLog(): void {
  markSeen(getState());
  setOpen(true);
}

export function closeNoticeLog(): void {
  setOpen(false);
}

export function toggleNoticeLog(): void {
  if (open) closeNoticeLog();
  else openNoticeLog();
}

/** Subscribes a component to open and close. Returns whether the drawer is open. */
export function useNoticeLogOpen(): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((v) => v + 1);
    openListeners.add(l);
    return () => {
      openListeners.delete(l);
    };
  }, []);
  return open;
}

/** The drawer. Renders nothing while closed. */
export function NoticeLog() {
  // Closed most of the time: the body (and its store subscription) mounts only while the drawer is open.
  return useNoticeLogOpen() ? <NoticeBody /> : null;
}

function NoticeBody() {
  const s = useGame();
  const isOpen = useNoticeLogOpen();
  const [kind, setKind] = useState<NoticeKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const log = s.noticeLog ?? [];
  const len = log.length;

  // While the drawer is open, new notices are read as they arrive.
  useEffect(() => {
    if (isOpen) markSeen(s);
  }, [isOpen, len]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the drawer unless a dialog is on top of it (the dialog gets the key).
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) closeNoticeLog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const counts: Record<NoticeKind, number> = { good: 0, bad: 0, info: 0, milestone: 0 };
  for (const e of log) if (e.kind in counts) counts[e.kind] += 1;

  const q = query.trim().toLowerCase();
  const rows: { e: Entry; i: number }[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (kind !== 'all' && e.kind !== kind) continue;
    if (q && !plain(e.text).toLowerCase().includes(q)) continue;
    rows.push({ e, i });
  }

  return (
    <aside class="nl-drawer" aria-label="Notification log">
      <div class="nl-head">
        <div class="nl-title">Notification log</div>
        <span class="nl-total">
          <span class="num">{log.length}</span> entries
        </span>
        <button type="button" class="btn btn-ghost btn-sm" onClick={closeNoticeLog} aria-label="Close notification log">
          Close
        </button>
      </div>
      <div class="nl-tools">
        <input
          class="input nl-search"
          type="search"
          value={query}
          placeholder="Search notices"
          aria-label="Search notices"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <div class="nl-chips" role="group" aria-label="Filter by kind">
          {KINDS.map((k) => {
            const n = k.id === 'all' ? log.length : counts[k.id];
            const on = kind === k.id;
            return (
              <button key={k.id} type="button" class={`nl-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setKind(k.id)}>
                {k.label}
                <span class="nl-chip-n num">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div class="nl-body">
        {rows.length === 0 ? (
          <EmptyState title={log.length === 0 ? 'No notices yet.' : 'Nothing matches.'} text={log.length === 0 ? 'Notices from the lab show up here.' : undefined} />
        ) : (
          <ol class="nl-list">
            {rows.map(({ e, i }) => (
              <li key={i} class={`nl-row nl-${e.kind}`}>
                <span class="nl-date num">{tdate(e.day)}</span>
                <div class="nl-main">
                  <span class="nl-kind">
                    <span class={`dot ${KIND_DOT[e.kind] ?? ''}`} aria-hidden="true" />
                    {KIND_LABEL[e.kind] ?? e.kind}
                  </span>
                  <span class="nl-text">{plain(e.text)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
