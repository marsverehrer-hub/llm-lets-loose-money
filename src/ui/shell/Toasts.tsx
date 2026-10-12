import { useEffect, useRef, useState } from 'preact/hooks';
import type { Notification, NoticeKind } from '../../sim/types';
import { monthYear, useIsMobile } from '../components';
import { dispatch, sameItems, useGameSelect } from '../store';
import { plain } from './fmt';
import { BANNER_EVENT, type BannerDetail } from '../fx/banner';

const TITLE: Record<NoticeKind, string> = { good: 'News', bad: 'Alert', info: 'Update', milestone: 'Milestone' };
/** Auto-dismiss time in ms. Milestones stay a little longer. */
const LIFETIME: Record<NoticeKind, number> = { good: 5000, bad: 5000, info: 5000, milestone: 7000 };
/** Only the newest toasts are shown. Older ones wait in state and appear as room frees up. */
const MAX_VISIBLE = 4;
/** How long a milestone banner stays in the stack. */
const FLASH_MS = 4000;

/** On phones at most two alerts show (one when a milestone banner is up), full width under the top bar. */
const MAX_PHONE = 2;

/**
 * Stacked alert windows, bottom-right above the ticker (top, full width, on phones). Each auto-dismisses; the timer
 * pauses while hovered. Re-renders only when the visible notifications change, not on every day.
 */
export function Toasts() {
  const isPhone = useIsMobile();
  const [flash, setFlash] = useState<(BannerDetail & { key: number }) | null>(null);
  const latest = useGameSelect((s) => s.notifications.slice(-MAX_VISIBLE), sameItems);
  const room = isPhone ? (flash ? MAX_PHONE - 1 : MAX_PHONE) : MAX_VISIBLE;
  const visible = room > 0 ? latest.slice(-room) : [];

  // Milestones, model releases and the IPO arrive as banner events from fx/Director.
  useEffect(() => {
    let t = 0;
    const onBanner = (e: Event) => {
      const d = (e as CustomEvent<BannerDetail>).detail;
      setFlash({ ...d, key: Date.now() });
      window.clearTimeout(t);
      t = window.setTimeout(() => setFlash(null), FLASH_MS);
    };
    window.addEventListener(BANNER_EVENT, onBanner);
    return () => {
      window.removeEventListener(BANNER_EVENT, onBanner);
      window.clearTimeout(t);
    };
  }, []);

  if (visible.length === 0 && !flash) return null;

  return (
    <div class="toasts" aria-live="polite">
      {flash && (
        <div key={flash.key} class="toast toast-milestone" role="status">
          <div class="toast-title">{flash.head}</div>
          <div class="toast-text">{flash.text}</div>
        </div>
      )}
      {visible.map((n) => (
        <ToastItem key={n.id} n={n} />
      ))}
    </div>
  );
}

function ToastItem({ n }: { n: Notification }) {
  const life = LIFETIME[n.kind] ?? 5000;
  // Time left before auto-dismiss. Shrinks while the timer runs, frozen while hovered.
  const remaining = useRef(life);
  const startedAt = useRef(0);
  const timer = useRef(0);
  const [hovered, setHovered] = useState(false);

  const arm = () => {
    window.clearTimeout(timer.current);
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => dispatch({ type: 'dismissNotification', id: n.id }), remaining.current);
  };

  // The timer is per toast and only needs to start once, on mount.
  useEffect(() => {
    arm();
    return () => window.clearTimeout(timer.current);
  }, []);

  const pause = () => {
    window.clearTimeout(timer.current);
    remaining.current = Math.max(400, remaining.current - (Date.now() - startedAt.current));
    setHovered(true);
  };
  const resume = () => {
    setHovered(false);
    arm();
  };

  return (
    <div class={`toast toast-${n.kind} ${hovered ? 'is-paused' : ''}`} role="status" onMouseEnter={pause} onMouseLeave={resume}>
      <div class="toast-title">
        {TITLE[n.kind]} · {monthYear(n.day)}
      </div>
      <div class="toast-text">{plain(n.text)}</div>
      <button type="button" class="toast-close" aria-label="Dismiss" onClick={() => dispatch({ type: 'dismissNotification', id: n.id })}>
        ×
      </button>
    </div>
  );
}
