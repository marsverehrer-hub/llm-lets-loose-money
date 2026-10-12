import type { NewsItem } from '../../sim/types';
import { sameItems, useGameSelect } from '../store';
import { plain, tdateShort } from './fmt';

const PLACEHOLDER: NewsItem = { id: -1, day: 0, text: 'Quiet day at the office. Headlines will land here.', kind: 'info' };

/** Bottom ticker: `NEWS` block, then headlines scrolling right-to-left. Pauses on hover and while the game is paused. */
/** The ticker only needs the headlines, the pause state and (when empty) the day. */
interface TickerData {
  news: NewsItem[];
  paused: boolean;
  day: number;
}
const sameTicker = (a: TickerData, b: TickerData): boolean => a.paused === b.paused && a.day === b.day && sameItems(a.news, b.news);

export function NewsTicker() {
  // Re-renders when headlines change or the clock pauses, not on every simulated day.
  const d = useGameSelect<TickerData>((s) => ({ news: s.news.slice(-30).reverse(), paused: s.speed === 0, day: s.news.length ? 0 : s.day }), sameTicker);
  const newestFirst = d.news;
  const base = newestFirst.length ? newestFirst : [{ ...PLACEHOLDER, day: d.day }];

  // Repeat the list until one copy is wide enough to fill the screen, so the loop never shows a gap.
  const baseChars = base.reduce((a, n) => a + n.text.length + 22, 0);
  const reps = Math.max(1, Math.ceil(700 / Math.max(1, baseChars)));
  const items: NewsItem[] = [];
  for (let r = 0; r < reps; r++) items.push(...base);
  const groupChars = items.reduce((a, n) => a + n.text.length + 22, 0);
  // ~0.11 s per character gives a pleasant ~65px/s crawl.
  const duration = Math.max(30, groupChars * 0.11);

  const group = (key: string, hidden: boolean) => (
    <div class="ticker-group" aria-hidden={hidden || undefined}>
      {items.map((n, i) => (
        <span class={`ticker-item ${n.kind}`} key={`${key}-${n.id}-${i}`}>
          <span class="ticker-day">{tdateShort(n.day)}</span>
          <span class="ticker-text">{plain(n.text)}</span>
          <span class="ticker-mark">■</span>
        </span>
      ))}
    </div>
  );

  return (
    <div class={`newsticker ${d.paused ? 'paused' : ''}`} role="region" aria-label="Latest news">
      <div class="ticker-label">News</div>
      <div class="ticker-viewport">
        <div class="ticker-track" style={{ '--ticker-dur': `${duration.toFixed(1)}s` } as any}>
          {group('a', false)}
          {group('b', true)}
        </div>
      </div>
    </div>
  );
}
