// The detail sheet for one dataset. Opened from a catalogue row or a treemap block. Holds the buy, licence, cancel and
// audit actions, so none of them live in the table.
import { useEffect, useState } from 'preact/hooks';
import { dispatch } from '../../store';
import type { CapId, DatasetDef, GameState, Scores } from '../../../sim/types';
import type { DatasetRow } from '../../../sim/systems/data';
import { auditDoneDay, auditQuote, believedQuality, dataSurprise, isVerified } from '../../../sim/systems/lab';
import { labName } from '../../../sim/systems/labs';
import { formatDate } from '../../../sim/util';
import { Pill, Sheet } from '../../components';
import { ACQ, CAP_LABEL, DOMAIN_LABEL, KIND_LABEL, SCORE_LABEL, STATUS, acqOf, fmtTok, freshnessOf, isLicence, lostTo, plural, pct, requirements, riskLevel, signed, signedFrac, upfrontOf, usd, verbOf } from './labels';

export interface SetSheetProps {
  s: GameState;
  row: DatasetRow | undefined;
  year: number;
  onClose: () => void;
}

export function SetSheet({ s, row, year, onClose }: SetSheetProps) {
  const d = row?.def;
  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      width={560}
      title={d ? d.name : ''}
      footer={row && hasAction(s, row) ? <RowAction s={s} row={row} /> : undefined}
      class="dt-set-sheet"
    >
      {row && <SetBody s={s} row={row} year={year} />}
    </Sheet>
  );
}

function hasAction(s: GameState, row: DatasetRow): boolean {
  if (row.status === 'owned') return isLicence(s, row.def.id);
  return row.status === 'available';
}

function SetPills({ s, row }: { s: GameState; row: DatasetRow }) {
  const d = row.def;
  const a = ACQ[acqOf(d)];
  const verified = isVerified(s, d.id);
  return (
    <span class="dt-pills">
      <Pill tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Pill>
      <Pill tone={a.tone}>{a.label}</Pill>
      {d.exclusive && <Pill tone="milestone">Exclusive</Pill>}
      {d.secret && <Pill tone="bad">Secret</Pill>}
      {row.status === 'owned' && (verified ? <Pill tone="good">Verified</Pill> : <Pill tone="warn">Unverified</Pill>)}
    </span>
  );
}

function SetBody({ s, row, year }: { s: GameState; row: DatasetRow; year: number }) {
  const d = row.def;
  const a = ACQ[acqOf(d)];
  const believed = believedQuality(s, d);
  const verified = isVerified(s, d.id);
  const surprise = verified ? dataSurprise(s, d.id) : null;
  const legal = riskLevel(d.legalRisk);
  const rep = riskLevel(d.reputationRisk ?? 0);
  const contested = (d.contestedBy ?? []).map((id) => labName(s, id));
  const reqs = requirements(d);
  const capEntries = Object.entries(d.capBonus ?? {}) as [CapId, number][];
  const scoreEntries = Object.entries(d.scoreBonus ?? {}) as [keyof Scores, number][];
  const lostBy = row.status === 'lost' ? lostTo(s, d) : null;

  let statusLine = '';
  if (row.status === 'locked') statusLine = row.reason ?? 'Locked';
  if (row.status === 'lost') statusLine = `Signed by ${lostBy ?? 'a rival lab'}`;
  if (row.status === 'pending') {
    const p = s.data.pending?.find((x) => x.id === d.id);
    const days = Math.max(0, (p?.readyDay ?? s.day) - s.day);
    statusLine = `In flight, ${plural(days, 'day')} left`;
  }
  if (row.status === 'owned' && isLicence(s, d.id)) statusLine = `Licensed since ${formatDate(s.data.licenses![d.id])}`;

  return (
    <div class="dt-detail">
      <SetPills s={s} row={row} />
      <p class="dt-flavour">{d.flavor}</p>
      <p class="dt-note">{a.help}</p>

      <div class="dt-quality-block">
        <span class="dt-quality-value num">{pct(believed)}</span>
        <div class="dt-quality-main">
          <span class="dt-quality-label">
            {verified
              ? `Measured. The seller claimed ${pct(d.quality)}.`
              : `Quality is the seller's claim, ${pct(d.quality)}. Nobody has measured it.`}
          </span>
          <span class="dt-qbar dt-qbar-wide" aria-hidden="true">
            <span style={{ width: `${Math.round(believed * 100)}%`, background: believed >= 0.7 ? 'var(--up)' : believed >= 0.45 ? 'var(--blue)' : 'var(--down)' }} />
          </span>
          {surprise !== null && (
            <span class={`num dt-note ${surprise > 0 ? 'dt-up' : surprise < 0 ? 'dt-down' : ''}`}>
              True quality minus claimed: {signedFrac(surprise)}
            </span>
          )}
        </div>
      </div>

      <dl class="dt-facts">
        <Fact k="Kind" v={KIND_LABEL[d.kind]} />
        <Fact k="Domain" v={DOMAIN_LABEL[d.domain ?? 'general']} />
        <Fact k="Tokens" v={fmtTok(d.tokensB)} />
        <Fact k="Signing cost" v={d.cost > 0 ? usd(d.cost) : 'Free'} />
        <Fact k="Annual fee" v={d.annualFee ? `${usd(d.annualFee)} a year` : 'None'} />
        <Fact k="Legal risk" v={`${legal.label} (${Math.round(d.legalRisk * 100)}%)`} />
        <Fact k="Reputation risk" v={`${rep.label} (${Math.round((d.reputationRisk ?? 0) * 100)}%)`} />
        <Fact k="Freshness" v={freshnessOf(d, year)} />
        <Fact k="Needs" v={reqs.length ? reqs.join('; ') : 'Nothing'} />
        <Fact k="Contested by" v={contested.length ? contested.join(', ') : 'Nobody'} />
        {d.exclusive && <Fact k="Exclusive" v="Rivals lose a little knowledge while you hold it." />}
      </dl>

      {(capEntries.length > 0 || scoreEntries.length > 0) && (
        <div class="dt-chips" aria-label="Bonuses">
          {capEntries.map(([k, v]) => (
            <span key={k} class="dt-chip">
              <span class="num">{signed(v)}</span> {CAP_LABEL[k]}
            </span>
          ))}
          {scoreEntries.map(([k, v]) => (
            <span key={k} class="dt-chip">
              <span class="num">{signed(v)}</span> {SCORE_LABEL[k]} score
            </span>
          ))}
        </div>
      )}

      <div class="dt-detail-foot">
        {row.status === 'owned' && <AuditAction s={s} d={d} />}
        {statusLine && <span class="dt-note">{statusLine}</span>}
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div class="dt-fact">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** The primary action for a row: buy or sign, or cancel a licence. */
export function RowAction({ s, row }: { s: GameState; row: DatasetRow }) {
  const d = row.def;
  if (row.status === 'owned' && isLicence(s, d.id)) {
    return (
      <ConfirmAction
        label="Cancel licence"
        confirmLabel="Confirm cancel"
        onConfirm={() => dispatch({ type: 'cancelLicense', datasetId: d.id })}
      />
    );
  }
  if (row.status !== 'available') return null;
  const cost = upfrontOf(d);
  const short = cost > s.finance.cash;
  const verb = verbOf(d);
  return (
    <button
      type="button"
      class="btn btn-primary dt-primary"
      disabled={short}
      title={short ? `Needs ${usd(cost)} in cash` : `${verb}: ${d.name}`}
      onClick={() => dispatch({ type: 'buyDataset', datasetId: d.id })}
    >
      {short ? `${verb}, needs ${usd(cost)}` : `${verb} for ${usd(cost)}`}
    </button>
  );
}

/** Two-step button for anything destructive: the first click arms it, the second confirms. Disarms after 3s. */
export function ConfirmAction({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      class={`btn ${armed ? 'btn-danger' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Audit an owned set to learn its true quality. Shows the cost and days, then the running state. */
function AuditAction({ s, d }: { s: GameState; d: DatasetDef }) {
  if (isVerified(s, d.id)) return null;
  const doneDay = auditDoneDay(s, d.id);
  if (doneDay !== null) {
    return <span class="dt-note">{`Audit running, done in ${plural(Math.max(0, doneDay - s.day), 'day')}`}</span>;
  }
  const q = auditQuote(s, d.id);
  const short = q.cost > s.finance.cash;
  return (
    <span class="dt-audit">
      <button
        type="button"
        class="btn"
        disabled={short}
        title={short ? `Needs ${usd(q.cost)} in cash` : `Audit ${d.name}`}
        onClick={() => dispatch({ type: 'auditDataset', datasetId: d.id })}
      >
        Audit the quality
      </button>
      <span class="dt-note">{`${usd(q.cost)}, ${plural(q.days, 'day')}`}</span>
    </span>
  );
}

