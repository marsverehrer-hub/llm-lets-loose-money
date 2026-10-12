// OWNER: CONTRACTS. v8 B2B contract board (GAME_DESIGN §19.4). Offers, bids, active deals, history.
// v10 (VIZ): deadline bars instead of day counts, fewer columns, a PanelIntro, and two stats cut.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../store';
import { formatMoney, formatParams } from '../../sim/util';
import {
  CONTRACT_TUNING,
  bestModelFor,
  checkReqs,
  contractRevenuePerDay,
  fitBand,
  meetsReqs,
  rivalBand,
  type ReqCheck,
} from '../../sim/systems/contracts';
import type { ActiveContract, ContractBid, ContractOffer, GameState, Model } from '../../sim/types';
import { Button, Card, EmptyState, PanelHeader, PanelIntro, Pill, Stat } from '../components';
import type { PillTone } from '../components';
import { tdate } from '../shell/fmt';
import './panels.css';
import './contracts.css';
import './ct-viz.css';

type Outcome = NonNullable<GameState['contracts']>['history'][number]['outcome'];

const OUTCOME: Record<Outcome, { label: string; tone: PillTone }> = {
  won: { label: 'Won', tone: 'good' },
  completed: { label: 'Completed', tone: 'good' },
  lost: { label: 'Lost', tone: 'bad' },
  breached: { label: 'Breached', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  declined: { label: 'Declined', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
};

const usd = (v: number): string => formatMoney(v, 1).replace(/\.0(?=[KMBT]|$)/, '');
const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/** Models a deal can be given, qualifying first (best fit first), then the rest in build order. Deprecated are dropped. */
function modelRows(s: GameState, offer: ContractOffer): { m: Model; ok: boolean; reason: string; fit: number }[] {
  const rows = s.models
    .filter((m) => !m.deprecated)
    .map((m) => {
      const r = meetsReqs(s, m, offer.reqs);
      const band = r.ok ? fitBand(s, offer.id, m.id) : null;
      return { m, ok: r.ok, reason: r.failures[0] ?? '', fit: band ? (band.low + band.high) / 2 : -1 };
    });
  return rows.sort((a, b) => (a.ok === b.ok ? b.fit - a.fit : a.ok ? -1 : 1));
}

/** A deadline as a bar: the fill is the time (or the share of the window) still left. */
function Deadline({ frac, label, tone }: { frac: number; label: string; tone?: 'bad' | 'warn' }) {
  const f = isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  return (
    <div class="ct-dl">
      <span class="ct-dl-track" aria-hidden="true">
        <span class={`ct-dl-fill ${tone ?? ''}`} style={{ width: `${(f * 100).toFixed(1)}%` }} />
      </span>
      <span class="ct-dl-text num">{label}</span>
    </div>
  );
}

/** Requirement chips: green when the best qualifying model (or the closest model) meets them, red otherwise. */
function Chips({ checks }: { checks: ReqCheck[] }) {
  if (!checks.length) return null;
  return (
    <div class="ct-chips">
      {checks.map((c) => (
        <span key={c.key} class={`ct-chip ${c.ok ? 'ct-chip-ok' : 'ct-chip-no'}`} title={c.ok ? 'Met' : 'Not met'}>
          <span class="ct-chip-mark" aria-hidden="true">{c.ok ? '▲' : '▼'}</span>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function OfferCard({ offer }: { offer: ContractOffer }) {
  const s = useGame();
  const [pickId, setPickId] = useState('');
  const pending: ContractBid | undefined = s.contracts?.pending?.find((b) => b.offerId === offer.id);
  const rows = modelRows(s, offer);
  const pick = rows.find((r) => r.m.id === pickId);
  const pickOk = !!pick?.ok;
  const best = bestModelFor(s, offer);
  const chips = checkReqs(s, best.model, offer.reqs);
  const band = pickOk && pick ? fitBand(s, offer.id, pick.m.id) : null;
  const rival = rivalBand(offer, s);
  const rivalText = rival.lab
    ? `${rival.lab} is bidding, fit ~${Math.round(rival.low)}–${Math.round(rival.high)}`
    : `No rival qualifies. Generic bid, fit ~${Math.round(rival.low)}–${Math.round(rival.high)}`;
  const hasEngineers = offer.supportEngineers > 0;
  const left = Math.max(0, offer.expiresDay - s.day);
  const window = Math.max(left, CONTRACT_TUNING.EXPIRY_MAX);

  return (
    <article class={`ct-offer ${pending ? 'ct-offer-pending' : ''}`}>
      <header class="ct-offer-head">
        <div class="ct-offer-id">
          <span class="ct-client">{offer.client}</span>
          <span class="ct-title">{offer.title}</span>
        </div>
        {pending ? <Pill tone="info">Decision in {days(Math.max(0, pending.decideDay - s.day))}</Pill> : null}
      </header>
      {pending ? (
        <Deadline
          frac={1 - (pending.decideDay - s.day) / CONTRACT_TUNING.BID_DAYS}
          label={`Decision on ${tdate(pending.decideDay)}`}
        />
      ) : (
        <Deadline frac={left / window} label={`Expires in ${days(left)}`} tone={left <= 5 ? 'warn' : undefined} />
      )}
      <p class="ct-blurb">{offer.blurb}</p>
      <Chips checks={chips} />
      {!best.qualifies && best.model && <div class="ct-hint muted">Closest model: {best.model.name}. Not enough for this deal yet.</div>}
      <dl class="ct-value">
        <div>
          <dt>Upfront</dt>
          <dd class="num">{usd(offer.upfront)}</dd>
        </div>
        <div>
          <dt>Per year</dt>
          <dd class="num">{usd(offer.perYear)}</dd>
        </div>
        <div>
          <dt>Term</dt>
          <dd class="num">{offer.years} yr</dd>
        </div>
        {hasEngineers && (
          <div>
            <dt>Support</dt>
            <dd class="num">{offer.supportEngineers} eng</dd>
          </div>
        )}
      </dl>
      <div class={`ct-rival ${rival.lab ? '' : 'muted'}`}>{rivalText}</div>

      {pending ? (
        <div class="ct-pending">
          <span>
            Bid in with <strong>{s.models.find((m) => m.id === pending.modelId)?.name ?? 'a model'}</strong>.
          </span>
        </div>
      ) : (
        <div class="ct-bid">
          <label class="ct-field">
            <span class="ct-label">Model</span>
            <select class="select ct-select" value={pickId} onChange={(e) => setPickId((e.target as HTMLSelectElement).value)}>
              <option value="">{!rows.length ? 'No models yet' : rows.some((r) => r.ok) ? 'Choose a model' : 'No model qualifies yet'}</option>
              {rows.map((r) => (
                <option key={r.m.id} value={r.m.id} disabled={!r.ok}>
                  {r.ok ? `${r.m.name} · ${formatParams(r.m.activeParamsB ?? r.m.paramsB)}` : `${r.m.name}: ${r.reason}`}
                </option>
              ))}
            </select>
          </label>
          <div class="ct-fit">
            {band ? (
              <span>
                Your fit <span class="num">{Math.round(band.low)}–{Math.round(band.high)}</span>
              </span>
            ) : pick && !pick.ok ? (
              <span class="ct-bad">Cannot bid: {pick.reason}</span>
            ) : (
              <span class="muted">Pick a qualifying model to see your fit.</span>
            )}
          </div>
          <div class="ct-actions">
            <Button variant="primary" size="sm" disabled={!pickOk} onClick={() => dispatch({ type: 'bidContract', offerId: offer.id, modelId: pickId })}>
              Bid
            </Button>
            <Button size="sm" onClick={() => dispatch({ type: 'declineContract', offerId: offer.id })}>
              Decline
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function ActiveRow({ a }: { a: ActiveContract }) {
  const s = useGame();
  const [pickId, setPickId] = useState('');
  const model = s.models.find((m) => m.id === a.modelId);
  const rows = modelRows(s, a.offer).filter((r) => r.m.id !== a.modelId);
  const pick = rows.find((r) => r.m.id === pickId);
  const left = Math.max(0, a.endDay - s.day);
  const term = Math.max(1, a.endDay - a.startDay);
  const breachLeft = Math.max(0, CONTRACT_TUNING.BREACH_DAYS - a.breachDays);
  return (
    <tr>
      <td class="mb-head" data-label="Client">
        <div class="ct-client">{a.offer.client}</div>
        <div class="ct-title muted">
          {a.offer.title} · {usd(a.offer.perYear)}/yr
        </div>
      </td>
      <td data-label="Model">{model?.name ?? <span class="bad">Deleted</span>}</td>
      <td class="ct-dl-cell" data-label="Deadline">
        <Deadline frac={left / term} label={`${days(left)} left`} />
      </td>
      <td data-label="Status">
        {a.breachDays > 0 ? (
          <div class="ct-breach">
            <Pill tone="bad">Breach in {days(breachLeft)}</Pill>
            <Deadline frac={a.breachDays / CONTRACT_TUNING.BREACH_DAYS} label="" tone="bad" />
          </div>
        ) : (
          <Pill tone="good">In spec</Pill>
        )}
      </td>
      <td class="mb-block" data-label="Actions">
        <div class="ct-row-actions">
          <select class="select ct-select ct-select-sm" value={pickId} onChange={(e) => setPickId((e.target as HTMLSelectElement).value)} aria-label="Reassign to">
            <option value="">Reassign to</option>
            {rows.map((r) => (
              <option key={r.m.id} value={r.m.id} disabled={!r.ok}>
                {r.ok ? r.m.name : `${r.m.name}: ${r.reason}`}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!pick?.ok} onClick={() => dispatch({ type: 'reassignContract', contractId: a.id, modelId: pickId })}>
            Reassign
          </Button>
          <Button size="sm" variant="danger" onClick={() => dispatch({ type: 'cancelContract', contractId: a.id })}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function ContractsPanel() {
  const s = useGame();
  const cs = s.contracts;
  const offers = cs?.offers ?? [];
  const active = cs?.active ?? [];
  const history = (cs?.history ?? []).slice(0, 10);
  const perYear = contractRevenuePerDay(s) * 365;

  return (
    <div class="ct">
      <PanelHeader code="CON" title="Contracts" subtitle="Deals that pay for fit, not size" />
      <PanelIntro id="contracts">Clients pay for a model that fits their job. Bid with a model that qualifies, and keep it in spec while the deal runs.</PanelIntro>

      <div class="ct-stats">
        <Stat label="Contract revenue a year" value={usd(perYear)} size="sm" />
        <Stat label="Active" value={String(active.length)} size="sm" />
      </div>

      <Card code="OFR" title="Open offers" class="ct-card">
        {offers.length === 0 ? (
          <EmptyState title="No offers yet." text="Clients call when they hear about you. Brand and reputation help." />
        ) : (
          <div class="ct-offers">
            {offers.map((o) => (
              <OfferCard key={o.id} offer={o} />
            ))}
          </div>
        )}
      </Card>

      <Card code="ACT" title="Active contracts" class="ct-card" flush>
        {active.length === 0 ? (
          <div class="ct-pad">
            <EmptyState title="No active contracts." text="Win a bid and it lands here, paying every day." />
          </div>
        ) : (
          <div class="table-wrap table-stack">
            <table class="table ct-active">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Model</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <ActiveRow key={a.id} a={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card code="HST" title="History" subtitle="Last ten" class="ct-card" flush>
        {history.length === 0 ? (
          <div class="ct-pad">
            <EmptyState title="Nothing decided yet." />
          </div>
        ) : (
          <div class="table-wrap table-stack">
            <table class="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Outcome</th>
                  <th class="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.day}-${i}`}>
                    <td class="mb-head" data-label="Client">
                      <div>{h.client}</div>
                      <div class="muted ct-hist-sub">
                        {tdate(h.day)} · {h.title}
                        {h.winner ? ` · ${h.winner}` : ''}
                      </div>
                    </td>
                    <td data-label="Outcome">
                      <Pill tone={OUTCOME[h.outcome].tone}>{OUTCOME[h.outcome].label}</Pill>
                    </td>
                    <td class="num" data-label="Value">
                      {usd(h.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
