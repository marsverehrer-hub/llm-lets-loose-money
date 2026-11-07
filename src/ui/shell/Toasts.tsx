import { useEffect, useRef, useState } from 'preact/hooks';
import type { Notification, NoticeKind } from '../../sim/types';
import { monthYear, useIsMobile } from '../components';
import { dispatch, sameItems, useGameSelect } from '../store';
import { plain } from './fmt';
import { BANNER_EVENT, type BannerDetail } from '../fx/banner';

const TITLE: Record<NoticeKind, string> = { good: 'News', bad: 'Alert', info: 'Update', milestone: 'Milestone' };
/** Auto-dismiss time in ms. Bad news stays longest, so it can be read. */
const LIFETIME: Record<NoticeKind, number> = { good: 4000, bad: 6000, info: 3000, milestone: 5000 };
/** Only the newest toasts are shown. Older ones wait in state and appear as room frees up. */
const MAX_VISIBLE = 2;
/** How long a milestone banner stays in the stack. */
const FLASH_MS = 4000;

/** On phones one alert shows at a time, full width above the tab bar. */
const MAX_PHONE = 1;

/**
 * Stacked alert windows, bottom-left over the empty gutter, above the ticker (full width above the tab bar on phones).
 * Each auto-dismisses; the timer pauses while hovered. Re-renders only when the visible notifications change.
 */
export function Toasts() {
  const isPhone = useIsMobile();
  const [flash, setFlash] = useState<(BannerDetail & { key: number }) | null>(null);
  const cap = isPhone ? MAX_PHONE : MAX_VISIBLE;
  const latest = useGameSelect((s) => s.notifications.slice(-cap), sameItems);
  const room = flash && isPhone ? 0 : cap;
  // A milestone banner already shows its text, so its toast twin waits until the banner is gone.
  const visible = (room > 0 ? latest.slice(-room) : []).filter((n) => !flash || plain(n.text) !== flash.text);

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
