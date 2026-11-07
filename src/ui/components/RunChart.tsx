import type { FinanceSample, GameState } from '../../sim/types';
import { formatMoney } from '../../sim/util';
import { LineChart } from './LineChart';
import { SERIES, monthYear } from './format';
import { useIsMobile } from './useIsMobile';

export interface RunMark {
  day: number;
  label: string;
}

/** The dated milestones the state keeps: first release and the IPO. Crowns are not dated once they change hands. */
export function runMarks(s: GameState): RunMark[] {
  const out: RunMark[] = [];
  for (const [id, label] of [
    ['first_release', 'First release'],
    ['ipo', 'IPO'],
  ] as const) {
    const day = s.achievements[id];
    if (day !== undefined) out.push({ day, label });
  }
  return out.sort((a, b) => a.day - b.day);
}

export interface RunChartProps {
  history: FinanceSample[];
  /** Day range, inclusive. Default: the whole run. */
  from?: number;
  to?: number;
  marks?: RunMark[];
}

/** Valuation from the weekly samples, with the dated milestones listed under the line. */
export function RunChart({ history, from = -Infinity, to = Infinity, marks = [] }: RunChartProps) {
  const isPhone = useIsMobile();
  const points = history.filter((h) => h.day >= from && h.day <= to).map((h) => ({ x: h.day, y: h.valuation }));
  const shown = marks.filter((m) => m.day >= from && m.day <= to);
  return (
    <div class="run-chart">
      <LineChart
        series={[{ name: 'Valuation', color: SERIES.amber, points }]}
        height={isPhone ? 150 : 200}
        yFormat={(v) => formatMoney(v, 1)}
        emptyText="Not enough history for a chart yet. Samples land every week."
      />
      {shown.length > 0 && (
        <ul class="run-marks">
          {shown.map((m) => (
            <li key={m.label}>
              <span class="run-mark-dot" aria-hidden="true" />
              {m.label} <span class="num">{monthYear(m.day)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
