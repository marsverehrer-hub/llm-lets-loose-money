// OWNER: v10 MARKETING agent. Running campaigns as bars on a timeline, with today marked.
import type { GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { EmptyState, Tooltip } from '../../components';
import { dayLabel, runningWindows } from './campaignCopy';

/** The axis is never narrower than this, so a 3-day campaign still reads as a bar. */
const MIN_SPAN_DAYS = 14;

export function CampaignTimeline({ s }: { s: GameState }) {
  const runs = runningWindows(s);
  if (runs.length === 0) {
    return <EmptyState title="No campaigns running" text="Start one to lift brand or hype for a few weeks." />;
  }
  const lo = Math.min(s.day, ...runs.map((r) => r.start));
  let hi = Math.max(s.day + 1, ...runs.map((r) => r.end));
  if (hi - lo < MIN_SPAN_DAYS) hi = lo + MIN_SPAN_DAYS;
  const span = hi - lo;
  const at = (day: number) => ((day - lo) / span) * 100;
  const todayPct = at(s.day);

  return (
    <div class="mk-tl" role="list" aria-label="Running campaigns on a timeline">
      <div class="mk-tl-row mk-tl-head">
        <div class="mk-tl-name" />
        <div class="mk-tl-track mk-tl-track-head">
          <span class="mk-tl-edge mk-tl-edge-l">{dayLabel(lo)}</span>
          <span class="mk-tl-edge mk-tl-edge-r">{dayLabel(hi)}</span>
          <span class="mk-tl-today-tag" style={{ left: `${todayPct}%` }}>Today</span>
        </div>
      </div>
      {runs.map((r) => {
        const used = r.days - r.daysLeft;
        const donePct = r.days > 0 ? (used / r.days) * 100 : 0;
        return (
          <div class="mk-tl-row" role="listitem" key={r.defId}>
            <div class="mk-tl-name">
              <b>{r.name}</b>
              <span>
                {r.daysLeft} {r.daysLeft === 1 ? 'day' : 'days'} left
              </span>
            </div>
            <div class="mk-tl-track">
              <div class="mk-tl-seg" style={{ left: `${at(r.start)}%`, width: `${at(r.end) - at(r.start)}%` }}>
                <Tooltip
                  class="mk-tl-tip"
                  content={
                    <span class="mk-tl-tipbody">
                      <b>{r.name}</b>
                      <span>
                        {dayLabel(r.start)} to {dayLabel(r.end)}
                      </span>
                      <span>Cost {formatMoney(r.cost, 1)}, paid up front</span>
                    </span>
                  }
                >
                  <div class="mk-tl-bar">
                    <div class="mk-tl-done" style={{ width: `${donePct}%` }} />
                  </div>
                </Tooltip>
              </div>
              <div class="mk-tl-now" style={{ left: `${todayPct}%` }} aria-hidden="true" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
