// The "make and manage" tools: commission data, generate synthetic data, harvest user chats, and licences. Each one
// opens in a sheet from the Data screen, so the forms are out of the way until they are wanted.
import { useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { formatDate } from '../../../sim/util';
import type { CustomDataset, DataDomain, DataKind, DatasetDef, GameState, Id, Model } from '../../../sim/types';
import {
  DATA_TUNING,
  collapsePenalty,
  commissionCostPerB,
  commissionQuote,
  dataStats,
  datasetById,
  syntheticQuote,
  syntheticShare,
} from '../../../sim/systems/data';
import { Pill } from '../../components';
import type { PillTone } from '../../components';
import { ConfirmAction } from './SetSheet';
import { DOMAIN_KEYS, DOMAIN_LABEL, KIND_KEYS, KIND_LABEL, fromPos, fmtTok, pct, plural, toPos, usd } from './labels';

export type ToolId = 'commission' | 'synthetic' | 'users' | 'licences';

export const TOOL_TITLE: Record<ToolId, string> = {
  commission: 'Commission data',
  synthetic: 'Synthetic data',
  users: "Users' chats",
  licences: 'Licences',
};

function releasedModels(s: GameState): Model[] {
  return s.models.filter((m) => m.releasedDay !== null && !m.deprecated).sort((a, b) => b.overall - a.overall);
}

function QuoteCell({ k, v }: { k: string; v: string }) {
  return (
    <div class="dt-quote-cell">
      <div class="dt-quote-k">{k}</div>
      <div class="dt-quote-v num">{v}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export function CommissionBody({ s }: { s: GameState }) {
  const T = DATA_TUNING;
  const [domain, setDomain] = useState<DataDomain>('general');
  const [kind, setKind] = useState<DataKind>('web');
  const [pos, setPos] = useState(() => toPos(1_000_000, T.COMMISSION_MIN, T.COMMISSION_MAX));
  const [name, setName] = useState('');
  const budget = fromPos(pos, T.COMMISSION_MIN, T.COMMISSION_MAX);
  const quote = commissionQuote(s, budget);
  const jobs = s.data.pending ?? [];
  const busy = jobs.length >= T.PENDING_MAX;
  const blocker = busy
    ? `All ${T.PENDING_MAX} slots are busy. Wait for a job to land.`
    : budget > s.finance.cash
      ? `Needs ${usd(budget)} in cash. You have ${usd(s.finance.cash)}.`
      : '';

  const submit = () => {
    if (blocker) return;
    dispatch({ type: 'commissionDataset', domain, kind, budget, name: name.trim() || undefined });
    setName('');
  };

  return (
    <>
      <p class="dt-note">Paid humans. Small, slow and careful. Human labour costs {usd(commissionCostPerB(s))} per billion tokens this year.</p>
      <div class="dt-form">
        <label class="dt-form-label" for="dt-com-domain">Domain</label>
        <select id="dt-com-domain" class="select" value={domain} onChange={(e) => setDomain((e.currentTarget as HTMLSelectElement).value as DataDomain)}>
          {DOMAIN_KEYS.map((k) => (
            <option key={k} value={k}>
              {DOMAIN_LABEL[k]}
            </option>
          ))}
        </select>

        <label class="dt-form-label" for="dt-com-kind">Kind</label>
        <select id="dt-com-kind" class="select" value={kind} onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as DataKind)}>
          {KIND_KEYS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>

        <label class="dt-form-label" for="dt-com-budget">Budget</label>
        <div class="dt-slider-row">
          <input
            id="dt-com-budget"
            type="range"
            class="slider"
            min={0}
            max={1000}
            step={1}
            value={pos}
            style={`--p:${pos / 10}%`}
            onInput={(e) => setPos(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="dt-readout num">{usd(budget)}</span>
        </div>

        <label class="dt-form-label" for="dt-com-name">Name</label>
        <input
          id="dt-com-name"
          class="input"
          type="text"
          maxLength={60}
          placeholder="Optional"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="dt-quote" aria-label="Commission quote">
        <QuoteCell k="Tokens" v={`about ${fmtTok(quote.tokensB)}`} />
        <QuoteCell k="Ready in" v={plural(quote.days, 'day')} />
        <QuoteCell k="Quality" v={pct(quote.quality)} />
      </div>

      <div class="dt-actions">
        {blocker && <span class="dt-blocker">{blocker}</span>}
        <button type="button" class="btn btn-primary" disabled={!!blocker} onClick={submit}>
          Commission
        </button>
      </div>

      <div class="dt-subhead">In flight, {jobs.length} of {T.PENDING_MAX} slots</div>
      <PendingList s={s} />
    </>
  );
}

function PendingList({ s }: { s: GameState }) {
  const jobs = s.data.pending ?? [];
  if (jobs.length === 0) return <div class="dt-note">Nothing in flight. Commissions and synthetic runs show up here.</div>;
  return (
    <ul class="dt-list" aria-label="Jobs in flight">
      {jobs.map((p) => {
        const days = Math.max(0, p.readyDay - s.day);
        const synthetic = p.dataset.source === 'synthetic';
        return (
          <li key={p.id} class="dt-list-row">
            <div class="dt-stack">
              <span class="dt-set-name">{p.dataset.name}</span>
              <span class="dt-sub">
                {synthetic ? 'Synthetic run' : 'Commission'}, {fmtTok(p.dataset.tokensB)}, quality {pct(p.dataset.quality)}
              </span>
            </div>
            <span class="num dt-days">{plural(days, 'day')}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Synthetic
// ---------------------------------------------------------------------------

export function SyntheticBody({ s }: { s: GameState }) {
  const T = DATA_TUNING;
  const models = releasedModels(s);
  const [pick, setPick] = useState<Id | null>(null);
  const [domain, setDomain] = useState<DataDomain>('general');
  const [pos, setPos] = useState(() => toPos(50, T.SYNTH_MIN_TOKENS_B, T.SYNTH_MAX_TOKENS_B));
  const [name, setName] = useState('');
  const model = models.find((m) => m.id === pick) ?? models[0];
  const tokensB = fromPos(pos, T.SYNTH_MIN_TOKENS_B, T.SYNTH_MAX_TOKENS_B);
  const quote = model ? syntheticQuote(s, model.id, tokensB) : null;
  const share = syntheticShare(s.data.owned, s);
  const penalty = collapsePenalty(s, s.data.owned);

  let blocker = '';
  if (!model) blocker = 'Release a model first. Only a released model can write data.';
  else if (quote && !quote.ok) blocker = quote.reason;
  else if (quote && quote.ok && quote.cost > s.finance.cash) blocker = `Needs ${usd(quote.cost)} in cash. You have ${usd(s.finance.cash)}.`;

  const submit = () => {
    if (blocker || !model) return;
    dispatch({ type: 'generateSynthetic', modelId: model.id, tokensB, domain, name: name.trim() || undefined });
    setName('');
  };

  const risk =
    quote && quote.ok
      ? quote.collapseRisk >= 0.5
        ? { label: 'High', tone: 'bad' as PillTone }
        : quote.collapseRisk >= 0.25
          ? { label: 'Medium', tone: 'milestone' as PillTone }
          : { label: 'Low', tone: 'good' as PillTone }
      : null;

  return (
    <>
      <p class="dt-note">Your own model writes the training text. Above {pct(T.COLLAPSE_SHARE_START)} synthetic, a run loses quality. Mix in human data to stay under it.</p>
      <div class="dt-form">
        <label class="dt-form-label" for="dt-syn-model">Model</label>
        <select
          id="dt-syn-model"
          class="select"
          value={model?.id ?? ''}
          disabled={models.length === 0}
          onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}
        >
          {models.length === 0 && <option value="">No released model</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}, {Math.round(m.overall)} overall
            </option>
          ))}
        </select>

        <label class="dt-form-label" for="dt-syn-tokens">Tokens</label>
        <div class="dt-slider-row">
          <input
            id="dt-syn-tokens"
            type="range"
            class="slider"
            min={0}
            max={1000}
            step={1}
            value={pos}
            style={`--p:${pos / 10}%`}
            onInput={(e) => setPos(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="dt-readout num">{fmtTok(tokensB)}</span>
        </div>

        <label class="dt-form-label" for="dt-syn-domain">Domain</label>
        <select id="dt-syn-domain" class="select" value={domain} onChange={(e) => setDomain((e.currentTarget as HTMLSelectElement).value as DataDomain)}>
          {DOMAIN_KEYS.map((k) => (
            <option key={k} value={k}>
              {DOMAIN_LABEL[k]}
            </option>
          ))}
        </select>

        <label class="dt-form-label" for="dt-syn-name">Name</label>
        <input
          id="dt-syn-name"
          class="input"
          type="text"
          maxLength={60}
          placeholder="Optional"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="dt-quote" aria-label="Synthetic quote">
        <QuoteCell k="Cost" v={quote && quote.ok ? usd(quote.cost) : '—'} />
        <QuoteCell k="Days" v={quote && quote.ok ? String(quote.days) : '—'} />
        <QuoteCell k="Quality" v={quote && quote.ok ? pct(quote.quality) : '—'} />
      </div>
      {risk && (
        <div class="dt-note">
          Collapse risk <Pill tone={risk.tone}>{risk.label}</Pill> for {quote && quote.ok ? quote.modelName : 'this model'}. Far-behind models write text that trains the next model badly.
        </div>
      )}

      <div class="dt-actions">
        {blocker && <span class="dt-blocker">{blocker}</span>}
        <button type="button" class="btn btn-primary" disabled={!!blocker} onClick={submit}>
          Generate
        </button>
      </div>

      <div class="dt-subhead">Your data mix</div>
      <div class="dt-kv">
        <div class="dt-kv-row">
          <span>Synthetic share of owned data</span>
          <span class="num">{pct(share)}</span>
        </div>
        <div class="dt-kv-row">
          <span>Quality multiplier on training</span>
          <span class="num">×{penalty.toFixed(2)}</span>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// User chats
// ---------------------------------------------------------------------------

export function UserDataBody({ s }: { s: GameState }) {
  const T = DATA_TUNING;
  const on = !!s.data.userDataOptIn;
  const heat = Math.min(T.PRIVACY_HEAT_MAX, s.flags[T.PRIVACY_HEAT_KEY] ?? 0);
  const stats = dataStats(s);
  const days = s.flags['data.userChatsDays'] ?? 0;
  const chatUsers = s.products.reduce((n, p) => (p.active && p.kind === 'chat' ? n + p.users : n), 0);
  const apiAccounts = s.products.reduce((n, p) => (p.active && p.kind === 'api' ? n + p.users : n), 0);
  const growthB = chatUsers * T.USER_CHAT_B_PER_USER_DAY + apiAccounts * T.USER_API_B_PER_ACCOUNT_DAY;
  const hasProduct = chatUsers + apiAccounts > 0;

  return (
    <>
      {on && (
        <div class="dt-warn" role="status">
          <strong>Privacy warning.</strong> Chats from your products are training data. Heat rises every day you harvest, and it can bring press and regulators to the door.
        </div>
      )}

      <div class="dt-heat">
        <div class="dt-heat-head">
          <span>Privacy heat</span>
          <span class="num">
            {Math.round(heat)} / {T.PRIVACY_HEAT_MAX}
          </span>
        </div>
        <div class="hbar">
          <div class="hbar-fill" style={`width:${Math.round(heat)}%;--c:${heat >= 50 ? 'var(--down)' : 'var(--blue)'}`} />
        </div>
      </div>

      <div class="dt-kv">
        <div class="dt-kv-row">
          <span>Tokens gathered so far</span>
          <span class="num">{fmtTok(stats.userChatsTokensB)}</span>
        </div>
        <div class="dt-kv-row">
          <span>Days harvested</span>
          <span class="num">{Math.round(days)}</span>
        </div>
        <div class="dt-kv-row">
          <span>{on ? 'Gathering per day' : 'Would gather per day'}</span>
          <span class={hasProduct ? 'num' : ''}>{hasProduct ? fmtTok(growthB) : 'None'}</span>
        </div>
      </div>

      {!hasProduct && <div class="dt-note">No live chat or API product yet. There is nothing to harvest.</div>}

      <div class="dt-actions">
        <span class="dt-note">Stopping keeps the tokens already gathered. Heat fades once you stop.</span>
        <button type="button" class={`btn ${on ? '' : 'btn-danger'}`} onClick={() => dispatch({ type: 'setUserDataOptIn', on: !on })}>
          {on ? 'Stop harvesting' : 'Start harvesting'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Licences
// ---------------------------------------------------------------------------

export function LicenceBody({ s }: { s: GameState }) {
  const entries = Object.entries(s.data.licenses ?? {})
    .map(([id, start]) => ({ d: datasetById(s, id), start }))
    .filter((e): e is { d: DatasetDef | CustomDataset; start: number } => !!e.d && s.data.owned.includes(e.d.id));

  if (entries.length === 0) {
    return <div class="dt-note">No licences. Sign one in the catalogue to pay a fixed yearly fee for better data.</div>;
  }
  return (
    <ul class="dt-list" aria-label="Active licences">
      {entries.map(({ d, start }) => {
        const accrues = start + DATA_TUNING.LICENCE_TERM_DAYS;
        return (
          <li key={d.id} class="dt-list-row">
            <div class="dt-stack">
              <span class="dt-set-name">{d.name}</span>
              <span class="dt-sub">
                Signed {formatDate(start)}. First year paid up front. Daily fee from {formatDate(accrues)}.
              </span>
              <span class="dt-sub">Fee {usd(d.annualFee ?? 0)} a year. Trained models keep what they learned.</span>
            </div>
            <ConfirmAction label="Cancel licence" confirmLabel="Confirm cancel" onConfirm={() => dispatch({ type: 'cancelLicense', datasetId: d.id })} />
          </li>
        );
      })}
    </ul>
  );
}

export function licenceTotals(s: GameState): { count: number; perYear: number } {
  const entries = Object.entries(s.data.licenses ?? {}).map(([id]) => datasetById(s, id)).filter((d): d is DatasetDef | CustomDataset => !!d && s.data.owned.includes(d.id));
  return { count: entries.length, perYear: entries.reduce((n, d) => n + (d.annualFee ?? 0), 0) };
}
