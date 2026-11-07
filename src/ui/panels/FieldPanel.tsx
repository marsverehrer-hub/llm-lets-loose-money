// v19 "The field": every rival lab as a simulated company (what it owns, what it is planning, what it has shipped).
// Package B5. Reads s.rivals through the rivals module; the sim does the work, this only shows it.
import { useState } from 'preact/hooks';
import type { CompetitorDef, GameState, Id, RivalKind, RivalLab, RivalModel } from '../../sim/types';
import { GPUS } from '../../sim/data/gpus';
import { arenaLeaderboard } from '../../sim/systems/competitors';
import { PLAN_NAME, rivalDef, rivalLabs } from '../../sim/systems/rivals';
import { dayToDate, formatMoney, formatNumber } from '../../sim/util';
import { Card, EmptyState, PanelHeader, Pill, ProgressBar, Sheet, Stat, Tabs, formatInt, monthYear } from '../components';
import type { PillTone } from '../components';
import { useGame } from '../store';
import './field.css';

type Tab = 'active' | 'all' | 'gone';

const TABS: { id: Tab; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'all', label: 'All' },
  { id: 'gone', label: 'Gone' },
];

const KIND_LABEL: Record<RivalKind, string> = {
  frontier: 'Frontier',
  open: 'Open collective',
  startup: 'Startup',
  sovereign: 'Sovereign',
  chip: 'Chip maker',
  bigtech: 'Big tech',
};

const REGION_LABEL: Record<NonNullable<CompetitorDef['region']>, string> = {
  us: 'United States',
  eu: 'EU',
  uk: 'UK',
  cn: 'China',
  il: 'Israel',
};

const STATUS: Record<RivalLab['status'], { tone: PillTone; label: string }> = {
  active: { tone: 'good', label: 'Active' },
  unfounded: { tone: 'muted', label: 'Not yet founded' },
  acquired: { tone: 'info', label: 'Acquired' },
  bankrupt: { tone: 'bad', label: 'Bankrupt' },
};

interface GpuLine {
  id: Id;
  name: string;
  count: number;
  owned: boolean;
  pflops: number;
}

interface FieldRow {
  def: CompetitorDef;
  lab: RivalLab;
  best: RivalModel | null;
  gpus: GpuLine[];
  pflops: number;
  openCount: number;
}

function bestModel(lab: RivalLab): RivalModel | null {
  return lab.models.reduce<RivalModel | null>((a, m) => (!a || m.overall > a.overall ? m : a), null);
}

function gpuLines(lab: RivalLab): GpuLine[] {
  const lines: GpuLine[] = [];
  for (const owned of [false, true]) {
    const map = owned ? lab.gpusOwned : lab.gpusRented;
    for (const [id, count] of Object.entries(map)) {
      if (count <= 0) continue;
      const g = GPUS.find((x) => x.id === id);
      lines.push({ id, name: g?.name ?? id, count, owned, pflops: (g?.pflops ?? 0) * count });
    }
  }
  return lines;
}

function fmtPflops(v: number): string {
  return v < 10 ? v.toFixed(2) : formatNumber(v, 1);
}

function yearOfDay(day: number): number {
  return dayToDate(day).getUTCFullYear();
}

export function buildRows(s: GameState): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const lab of rivalLabs(s)) {
    const def = rivalDef(lab.id);
    if (!def) continue;
    const gpus = gpuLines(lab);
    rows.push({
      def,
      lab,
      best: bestModel(lab),
      gpus,
      pflops: gpus.reduce((a, g) => a + g.pflops, 0),
      openCount: lab.models.filter((m) => m.open).length,
    });
  }
  // Best overall first. Labs with no model yet sink to the bottom.
  return rows.sort((a, b) => (b.best?.overall ?? -1) - (a.best?.overall ?? -1));
}

export function inTab(row: FieldRow, tab: Tab): boolean {
  const st = row.lab.status;
  if (tab === 'active') return st === 'active';
  if (tab === 'gone') return st === 'acquired' || st === 'bankrupt';
  return st !== 'unfounded';
}

function StatusPill({ lab, names }: { lab: RivalLab; names: (id: Id) => string }) {
  const st = STATUS[lab.status];
  const note = lab.status === 'acquired' && lab.acquiredBy ? ` by ${names(lab.acquiredBy)}` : '';
  return <Pill tone={st.tone}>{`${st.label}${note}`}</Pill>;
}

export function FieldPanel() {
  const s: GameState = useGame();
  const [tab, setTab] = useState<Tab>('active');
  const [sel, setSel] = useState<Id | null>(null);

  const rows = buildRows(s);
  const shown = rows.filter((r) => inTab(r, tab));
  const active = rows.filter((r) => r.lab.status === 'active');
  const year = yearOfDay(s.day);
  const openThisYear = rows.reduce(
    (a, r) => a + r.lab.models.filter((m) => m.open && m.releasedDay !== null && yearOfDay(m.releasedDay) === year).length,
    0,
  );
  const arena = arenaLeaderboard(s);
  const leader = arena[0];
  const nameOf = (id: Id) => rivalDef(id)?.name ?? id;
  const current = sel ? rows.find((r) => r.lab.id === sel) : undefined;

  return (
    <div class="panel field">
      <PanelHeader
        title="The field"
        subtitle="Every lab in the race, what it owns and what it is planning"
        actions={
          <>
            <Stat label="Active labs" value={active.length} size="sm" />
            <Stat label="Open models this year" value={openThisYear} size="sm" hint={String(year)} />
            <Stat label="Arena leader" value={leader ? leader.name : '—'} hint={leader?.modelName} size="sm" />
          </>
        }
      />

      <Card
        title="Labs"
        subtitle={`${shown.length} shown · sorted by best model`}
        actions={<Tabs<Tab> variant="segmented" value={tab} onChange={setTab} tabs={TABS} />}
      >
        {shown.length === 0 ? (
          <EmptyState
            title={tab === 'gone' ? 'No labs gone yet' : 'No rival labs in the race yet'}
            text={tab === 'gone' ? 'Labs that go bankrupt or get bought show up here.' : 'New labs enter the race over the years.'}
          />
        ) : (
          <div class="table-wrap table-stack">
            <table class="table field-table">
              <thead>
                <tr>
                  <th>Lab</th>
                  <th>Kind</th>
                  <th>Plan</th>
                  <th class="num">Cash</th>
                  <th class="num">GPUs</th>
                  <th class="num">PFLOPS</th>
                  <th>Best model</th>
                  <th class="num">Overall</th>
                  <th class="num">Open</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const gpuCount = r.gpus.reduce((a, g) => a + g.count, 0);
                  const id = r.lab.id;
                  return (
                    <tr key={id} class={sel === id ? 'sel' : ''}>
                      <td class="mb-head">
                        <button type="button" class="field-lab" onClick={() => setSel(id)} aria-label={`Open ${r.def.name}`}>
                          <span class="swatch" style={{ '--c': r.def.color } as any} />
                          <span class="bold">{r.def.name}</span>
                        </button>
                      </td>
                      <td data-label="Kind">{KIND_LABEL[r.def.kind ?? 'frontier']}</td>
                      <td data-label="Plan">{r.lab.plan ? PLAN_NAME[r.lab.plan.id] : <span class="muted">—</span>}</td>
                      <td class="num" data-label="Cash">
                        <span class={r.lab.cash < 0 ? 'bad' : ''}>{formatMoney(r.lab.cash, 1)}</span>
                      </td>
                      <td class="num" data-label="GPUs">{formatInt(gpuCount)}</td>
                      <td class="num" data-label="PFLOPS">{fmtPflops(r.pflops)}</td>
                      <td data-label="Best model">{r.best ? r.best.name : <span class="muted">—</span>}</td>
                      <td class="num" data-label="Overall">{r.best ? formatInt(r.best.overall) : <span class="muted">—</span>}</td>
                      <td class="num" data-label="Open">{r.openCount}</td>
                      <td data-label="Status">
                        <StatusPill lab={r.lab} names={nameOf} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Sheet
        open={current !== undefined}
        title={current?.def.name}
        subtitle={current?.def.tagline}
        onClose={() => setSel(null)}
        width={640}
      >
        {current && <LabSheet row={current} names={nameOf} />}
      </Sheet>
    </div>
  );
}

function LabSheet({ row, names }: { row: FieldRow; names: (id: Id) => string }) {
  const { def, lab, gpus } = row;
  const region = def.region ? REGION_LABEL[def.region] : null;
  const run = lab.run;
  const runFrac = run && run.flopsTotal > 0 ? run.flopsDone / run.flopsTotal : 0;
  const models = [...lab.models].reverse();
  const log = lab.log.slice(-15).reverse();
  const published = lab.publishedData.slice(-6).reverse();
  return (
    <div class="stack field-sheet">
      <div class="kv">
        <div class="kv-row">
          <span class="kv-k">Kind</span>
          <span class="kv-v">{KIND_LABEL[def.kind ?? 'frontier']}</span>
        </div>
        {region && (
          <div class="kv-row">
            <span class="kv-k">Region</span>
            <span class="kv-v">{region}</span>
          </div>
        )}
        <div class="kv-row">
          <span class="kv-k">Founded</span>
          <span class="kv-v">{lab.foundedDay !== null ? monthYear(lab.foundedDay) : '—'}</span>
        </div>
        {lab.endedDay !== undefined && (
          <div class="kv-row">
            <span class="kv-k">Ended</span>
            <span class="kv-v">{monthYear(lab.endedDay)}</span>
          </div>
        )}
        {lab.acquiredBy && (
          <div class="kv-row">
            <span class="kv-k">Acquired by</span>
            <span class="kv-v">{names(lab.acquiredBy)}</span>
          </div>
        )}
        <div class="kv-row">
          <span class="kv-k">Status</span>
          <span class="kv-v">
            <StatusPill lab={lab} names={names} />
          </span>
        </div>
      </div>

      <section>
        <h3 class="caps field-h">Plan</h3>
        <p class="field-plan">{lab.plan ? PLAN_NAME[lab.plan.id] : 'No plan yet. Plans are announced on 1 January.'}</p>
        {lab.planHistory.length > 0 && (
          <ol class="field-timeline">
            {[...lab.planHistory].reverse().map((p, i) => (
              <li key={`${p.year}-${i}`}>
                <span class="num muted">{p.year}</span> {PLAN_NAME[p.id]}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 class="caps field-h">Money</h3>
        <div class="kv">
          <div class="kv-row">
            <span class="kv-k">Cash</span>
            <span class={`kv-v num ${lab.cash < 0 ? 'bad' : ''}`}>{formatMoney(lab.cash, 1)}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Raised in total</span>
            <span class="kv-v num">{formatMoney(lab.totalRaised, 1)}</span>
          </div>
        </div>
      </section>

      <section>
        <h3 class="caps field-h">Compute</h3>
        {gpus.length === 0 ? (
          <p class="muted">No GPUs.</p>
        ) : (
          <div class="kv">
            {gpus.map((g) => (
              <div class="kv-row" key={`${g.id}-${g.owned ? 'own' : 'rent'}`}>
                <span class="kv-k">
                  {g.name} <span class="muted">({g.owned ? 'owned' : 'rented'})</span>
                </span>
                <span class="kv-v num">{formatInt(g.count)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 class="caps field-h">Staff and research</h3>
        <div class="kv">
          <div class="kv-row">
            <span class="kv-k">Research</span>
            <span class="kv-v num">{lab.staff.research}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Engineering</span>
            <span class="kv-v num">{lab.staff.engineering}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Safety</span>
            <span class="kv-v num">{lab.staff.safety}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Sales</span>
            <span class="kv-v num">{lab.staff.sales}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Research topics done</span>
            <span class="kv-v num">{lab.research.length}</span>
          </div>
        </div>
      </section>

      <section>
        <h3 class="caps field-h">Data</h3>
        <div class="kv">
          <div class="kv-row">
            <span class="kv-k">Datasets owned</span>
            <span class="kv-v num">{lab.datasets.length}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Datasets published</span>
            <span class="kv-v num">{lab.publishedData.length}</span>
          </div>
        </div>
        {published.length > 0 && (
          <ul class="field-list">
            {published.map((d, i) => (
              <li key={`${d.id}-${i}`}>
                {d.name} <span class="muted">· {formatNumber(d.tokensB, 1)}B tokens · {d.license}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 class="caps field-h">Current run</h3>
        {run ? (
          <>
            <p class="muted">
              {formatNumber(run.paramsB, 1)}B params · {formatNumber(run.tokensB, 1)}B tokens
            </p>
            <ProgressBar value={runFrac} label="Progress" right={`${Math.round(runFrac * 100)}%`} tone="info" />
          </>
        ) : (
          <p class="muted">No training run.</p>
        )}
      </section>

      <section>
        <h3 class="caps field-h">Models</h3>
        {models.length === 0 ? (
          <p class="muted">Nothing released yet.</p>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th class="num">Params</th>
                  <th class="num">Tokens</th>
                  <th class="num">Overall</th>
                  <th class="num">Elo</th>
                  <th>Open or license</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td class="num">{formatNumber(m.paramsB, 1)}B</td>
                    <td class="num">{formatNumber(m.tokensB, 1)}B</td>
                    <td class="num">{formatInt(m.overall)}</td>
                    <td class="num">{formatInt(m.elo)}</td>
                    <td>{m.open ? <Pill tone="good">Open</Pill> : <span class="muted">{m.license ?? 'Closed'}</span>}</td>
                    <td>{monthYear(m.releasedDay ?? m.trainedDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 class="caps field-h">Log</h3>
        {log.length === 0 ? (
          <p class="muted">Quiet so far.</p>
        ) : (
          <ol class="field-log">
            {log.map((l, i) => (
              <li key={`${l.day}-${i}`}>
                <span class="muted">{monthYear(l.day)}</span> {l.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
