// The catalogue: one toolbar row (search, a Filters popover, sort, Clear) over a six-column table. A row opens the set
// in the detail sheet; the sheet holds the buy, licence and audit actions.
import type { ComponentChildren } from 'preact';
import type { GameState, Id } from '../../../sim/types';
import type { DatasetRow } from '../../../sim/systems/data';
import { believedQuality, isVerified } from '../../../sim/systems/lab';
import { labName } from '../../../sim/systems/labs';
import { Card, Pill, Tooltip } from '../../components';
import { ACQ, DOMAIN_LABEL, KIND_KEYS, KIND_LABEL, DOMAIN_KEYS, ACQ_KEYS, STATUS, acqOf, fmtTok, isLicence, lostTo, pct, usd } from './labels';
import {
  DEFAULT_VIEW,
  SORT_KEYS,
  SORT_LABEL,
  STATUS_FILTER_KEYS,
  STATUS_FILTER_LABEL,
  activeFilterCount,
  clearedView,
  filterRows,
  hasSomethingToClear,
  mergedRisk,
  sortRows,
  type CatalogueView,
} from './model';

export interface CatalogueProps {
  s: GameState;
  rows: DatasetRow[];
  view: CatalogueView;
  patch: (p: Partial<CatalogueView>) => void;
  selId: Id | null;
  onOpen: (id: Id) => void;
}

export function Catalogue({ s, rows, view, patch, selId, onOpen }: CatalogueProps) {
  const shown = sortRows(s, filterRows(s, rows, view), view.sort, view.desc);
  const active = activeFilterCount(view);
  const dirty = hasSomethingToClear(view);
  const inFlight = s.data.pending ?? [];

  return (
    <Card
      flush
      title="Catalogue"
      subtitle={`${shown.length} of ${rows.length} sets`}
    >
      <div class="dt-bar" role="search">
        <input
          class="input dt-search"
          type="search"
          placeholder="Search sets"
          aria-label="Search sets"
          value={view.query}
          onInput={(e) => patch({ query: (e.currentTarget as HTMLInputElement).value })}
        />
        <select
          class="select dt-sort"
          aria-label="Sort by"
          value={view.sort}
          onChange={(e) => patch({ sort: (e.currentTarget as HTMLSelectElement).value as CatalogueView['sort'] })}
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="btn dt-dir"
          aria-label={view.desc ? 'Largest first, switch to smallest first' : 'Smallest first, switch to largest first'}
          title={view.desc ? 'Largest first' : 'Smallest first'}
          onClick={() => patch({ desc: !view.desc })}
        >
          {view.desc ? '▼' : '▲'}
        </button>
        <button
          type="button"
          class="dt-clear"
          disabled={!dirty}
          onClick={() => patch(clearedView(view))}
          title={dirty ? 'Reset filters and search' : 'Nothing to clear'}
        >
          Clear
        </button>
      </div>
      <div class="dt-filter-inline" aria-label={`Filters${active ? `, ${active} active` : ''}`}>
        <FilterFields view={view} patch={patch} />
      </div>

      <div class="dt-scroll">
        <table class="table dt-table table-stack">
          <thead>
            <tr>
              <th class="dt-set-col">Set</th>
              <th class="num">Tokens</th>
              <th>Quality</th>
              <th class="num">Cost</th>
              <th>Risk</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr class="dt-empty-row">
                <td colSpan={6}>
                  <div class="empty">
                    <div class="empty-title">No sets match.</div>
                    <div class="empty-text">
                      {view.status === 'shelf' ? 'Nothing you own or can buy right now.' : 'Try another filter.'}
                      {dirty && (
                        <>
                          {' '}
                          <button type="button" class="dt-link" onClick={() => patch(clearedView(view))}>
                            Clear filters
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <CatalogueRow
                key={r.def.id}
                s={s}
                row={r}
                selected={selId === r.def.id}
                onOpen={() => onOpen(r.def.id)}
                inFlightDays={inFlight.find((p) => p.id === r.def.id)?.readyDay}
              />
            ))}
          </tbody>
        </table>
      </div>

    </Card>
  );
}

function FilterFields({ view, patch }: { view: CatalogueView; patch: (p: Partial<CatalogueView>) => void }) {
  return (
    <div class="dt-filter-fields">
      <Field id="dt-f-status" label="Status">
        <select id="dt-f-status" class="select" value={view.status} onChange={(e) => patch({ status: (e.currentTarget as HTMLSelectElement).value as CatalogueView['status'] })}>
          {STATUS_FILTER_KEYS.map((k) => (
            <option key={k} value={k}>
              {STATUS_FILTER_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dt-f-acq" label="Source">
        <select id="dt-f-acq" class="select" value={view.acq} onChange={(e) => patch({ acq: (e.currentTarget as HTMLSelectElement).value as CatalogueView['acq'] })}>
          <option value="all">All sources</option>
          {ACQ_KEYS.map((k) => (
            <option key={k} value={k}>
              {ACQ[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dt-f-kind" label="Kind">
        <select id="dt-f-kind" class="select" value={view.kind} onChange={(e) => patch({ kind: (e.currentTarget as HTMLSelectElement).value as CatalogueView['kind'] })}>
          <option value="all">All kinds</option>
          {KIND_KEYS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dt-f-domain" label="Domain">
        <select id="dt-f-domain" class="select" value={view.domain} onChange={(e) => patch({ domain: (e.currentTarget as HTMLSelectElement).value as CatalogueView['domain'] })}>
          <option value="all">All domains</option>
          {DOMAIN_KEYS.map((k) => (
            <option key={k} value={k}>
              {DOMAIN_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dt-f-verif" label="Verification">
        <select id="dt-f-verif" class="select" value={view.verif} onChange={(e) => patch({ verif: (e.currentTarget as HTMLSelectElement).value as CatalogueView['verif'] })}>
          <option value="all">Any</option>
          <option value="unverified">Unverified</option>
          <option value="verified">Verified</option>
        </select>
      </Field>
      <button type="button" class="dt-link dt-filter-reset" disabled={activeFilterCount(view) === 0} onClick={() => patch({ ...DEFAULT_VIEW, query: view.query, sort: view.sort, desc: view.desc })}>
        Reset filters
      </button>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ComponentChildren }) {
  return (
    <div class="dt-field">
      <label class="dt-field-label" for={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function qualityTone(q: number): string {
  return q >= 0.7 ? 'var(--up)' : q >= 0.45 ? 'var(--blue)' : 'var(--down)';
}

function CatalogueRow({
  s,
  row,
  selected,
  onOpen,
  inFlightDays,
}: {
  s: GameState;
  row: DatasetRow;
  selected: boolean;
  onOpen: () => void;
  inFlightDays: number | undefined;
}) {
  const d = row.def;
  const a = ACQ[acqOf(d)];
  const risk = mergedRisk(d);
  const believed = believedQuality(s, d);
  const verified = isVerified(s, d.id);
  const contested = (d.contestedBy ?? []).map((id) => labName(s, id));
  const cls = ['dt-row', selected ? 'sel' : '', row.status === 'locked' || row.status === 'lost' ? 'dt-row--muted' : '']
    .filter(Boolean)
    .join(' ');

  let note = '';
  if (row.status === 'owned' && isLicence(s, d.id)) note = 'Licensed';
  if (row.status === 'locked') note = row.reason ?? '';
  if (row.status === 'lost') note = `Signed by ${lostTo(s, d) ?? 'a rival lab'}`;
  if (row.status === 'pending') {
    const days = Math.max(0, (inFlightDays ?? s.day) - s.day);
    note = `${days} ${days === 1 ? 'day' : 'days'} left`;
  }

  return (
    <tr
      class={cls}
      tabIndex={0}
      aria-selected={selected}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td class="dt-set-col" data-label="Set">
        <div class="dt-stack">
          <span class="dt-set-name" title={d.name}>
            {d.name}
          </span>
          <span class="dt-sub">
            {a.label} · {KIND_LABEL[d.kind]} · {DOMAIN_LABEL[d.domain ?? 'general']}
          </span>
          {(d.secret || d.exclusive || contested.length > 0) && (
            <span class="dt-tags">
              {d.secret && <Pill tone="bad">Secret</Pill>}
              {d.exclusive && <Pill tone="milestone">Exclusive</Pill>}
              {contested.length > 0 && <span class="dt-sub">Contested</span>}
            </span>
          )}
        </div>
      </td>
      <td class="num" data-label="Tokens">
        {fmtTok(d.tokensB)}
      </td>
      <td data-label="Quality">
        <span class="dt-q">
          <span class="dt-qbar" aria-hidden="true">
            <span style={{ width: `${Math.round(believed * 100)}%`, background: qualityTone(believed) }} />
          </span>
          <span class="num">{pct(believed)}</span>
          {!verified && (
            <span class="dt-unknown" title="Unverified. The seller's claim, not a measurement." aria-label="Unverified">
              ?
            </span>
          )}
        </span>
      </td>
      <td class={d.cost > 0 ? 'num' : ''} data-label="Cost">
        <div>{d.cost > 0 ? usd(d.cost) : 'Free'}</div>
        {d.annualFee ? <div class="dt-sub">{usd(d.annualFee)}/yr</div> : null}
      </td>
      <td class="dt-risk-cell" data-label="Risk" onClick={(e) => e.stopPropagation()}>
        <Tooltip
          content={
            <span class="dt-tip">
              <span>Legal risk: {risk.legal}</span>
              <span>Reputation risk: {risk.reputation}</span>
            </span>
          }
        >
          <Pill tone={risk.tone}>{risk.label}</Pill>
        </Tooltip>
      </td>
      <td data-label="Status">
        <div class="dt-stack">
          <span>
            <Pill tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Pill>
          </span>
          {note && (
            <span class="dt-sub" title={note}>
              {note}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

