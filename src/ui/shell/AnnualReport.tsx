// v21 Annual Report: one filed year as a one-page paper (a Sheet, a booktabs table and one chart). Opened from the
// Inbox notice or the Finance panel. Read-only: the game keeps running behind it.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AnnualReport as Report } from '../../sim/types';
import { formatMoney } from '../../sim/util';
import { Button, Card, DataTable, RunChart, Sheet, formatInt, runMarks } from '../components';
import { useGame } from '../store';
import { plain, tdate } from './fmt';

let openYear: number | null = null;
const listeners = new Set<() => void>();

function setOpenYear(y: number | null): void {
  openYear = y;
  for (const l of listeners) l();
}

export function openAnnualReport(year: number): void {
  setOpenYear(year);
}

function closeAnnualReport(): void {
  setOpenYear(null);
}

function useOpenYear(): number | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return openYear;
}

/** The sheet for the year that was opened. Mounts only while open. */
export function AnnualReport() {
  const year = useOpenYear();
  return year === null ? null : <ReportSheet year={year} />;
}

function ReportSheet({ year }: { year: number }) {
  const s = useGame();
  const r = s.annualReports?.find((x) => x.year === year);
  if (!r) return null;
  const profit = r.revenue - r.expenses;
  const money = (v: number) => formatMoney(v, 1);
  const rows: [string, ComponentChildren, string?][] = [
    ['Revenue', money(r.revenue)],
    ['Expenses', money(r.expenses)],
    [profit < 0 ? 'Loss' : 'Profit', money(Math.abs(profit)), profit < 0 ? 'bad' : 'good'],
    ['Valuation on 1 January', money(r.valuationStart)],
    ['Valuation on 31 December', money(r.valuationEnd)],
    ['Models released', formatInt(r.modelsReleased)],
    ['Crowns won', formatInt(r.crownsWon)],
    ['Best Arena rank', r.bestRank ? `#${r.bestRank}` : '—'],
  ];

  return (
    <Sheet
      open
      title={
        <>
          <span class="pen">§</span> Annual Report, {r.year}
        </>
      }
      subtitle={`Covering ${tdate(r.from)} to ${tdate(r.to)}`}
      onClose={closeAnnualReport}
      width={640}
      footer={
        <Button variant="primary" onClick={closeAnnualReport}>
          Close
        </Button>
      }
    >
      <div class="stack">
        <p>
          <span class="smallcaps">Headline of the year.</span> {r.headline ? plain(r.headline) : 'Nothing made the front page.'}
        </p>
        <div class="table-wrap">
          <table class="table">
            <caption class="small muted">Table 1. Results of {r.year}</caption>
            <thead>
              <tr>
                <th>Line</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v, tone]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td class={`num ${tone ?? ''}`}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <span class="smallcaps">Biggest rival move.</span> {r.rivalMove ? plain(r.rivalMove) : 'None on the record.'}
        </p>
        <figure class="stack">
          <figcaption class="small muted">Figure 1. Valuation through {r.year}</figcaption>
          <RunChart history={s.finance.history} from={r.from} to={r.to} marks={runMarks(s)} />
        </figure>
      </div>
    </Sheet>
  );
}

/** The filed reports, newest first, for the Finance panel. */
export function AnnualReportsCard({ reports }: { reports: Report[] }) {
  const newest = [...reports].reverse();
  return (
    <Card title="Annual reports" subtitle={reports.length > 0 ? `${reports.length} filed` : undefined}>
      {newest.length === 0 ? (
        <p class="small muted">The first report is filed on the next 1 January.</p>
      ) : (
        <DataTable
          label="Annual reports"
          rows={newest}
          rowKey={(r) => String(r.year)}
          columns={[
            { key: 'year', label: 'Year', primary: true, cell: (r) => r.year },
            { key: 'revenue', label: 'Revenue', num: true, cell: (r) => formatMoney(r.revenue, 1) },
            {
              key: 'profit',
              label: 'Profit',
              num: true,
              cell: (r) => {
                const p = r.revenue - r.expenses;
                return <span class={p < 0 ? 'bad' : 'good'}>{`${p < 0 ? '-' : ''}${formatMoney(Math.abs(p), 1)}`}</span>;
              },
            },
            { key: 'open', label: '', cell: (r) => <Button size="sm" variant="ghost" onClick={() => openAnnualReport(r.year)}>Open</Button> },
          ]}
        />
      )}
    </Card>
  );
}
