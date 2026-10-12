// VS (Versus): head-to-head with the human rival. Only in the nav while a multiplayer match exists.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { BALANCE } from '../../sim/balance';
import { Button, Card, EmptyState, LineChart, Modal, PanelHeader, Stat, formatDays } from '../components';
import { dispatch, useGame } from '../store';
import { useSession } from '../../net/session';
import { ATTACKS, attackStatus, crownTable, matchDaysLeft } from '../../sim/systems/multiplayer';
import type { CrownRow } from '../../sim/systems/multiplayer';
import { labInfo } from '../../sim/systems/labs';
import { arenaLeaderboard } from '../../sim/systems/competitors';
import { segmentShares } from '../../sim/systems/market';
import { MP_RIVAL_ID } from '../../sim/types';
import type { RivalAttackKind, Segment } from '../../sim/types';
import { formatMoney, formatNumber } from '../../sim/util';
import { plain, tdateShort } from '../shell/fmt';
import { openLobby } from './lobbyState';
import './mp.css';

/** Your series and bars are always blue, the rival takes its lobby colour. */
const YOU = 'var(--blue)';
const FALLBACK_RIVAL = '#e46fd0';
const SEGMENTS: { id: Segment; label: string; userLabel: string }[] = [
  { id: 'consumer', label: 'Consumers', userLabel: 'Consumer users' },
  { id: 'developer', label: 'Developers', userLabel: 'Developer users' },
  { id: 'enterprise', label: 'Enterprise', userLabel: 'Enterprise users' },
];
const KINDS: RivalAttackKind[] = ['poach', 'smear', 'leak', 'undercut'];

type Lead = 'me' | 'rival' | 'tie' | 'none';

/** Who leads on a higher-is-better number. Within 1% counts as even. */
function leadOf(me: number | null, rival: number | null): Lead {
  if (me === null || rival === null || !isFinite(me) || !isFinite(rival)) return 'none';
  const scale = Math.max(Math.abs(me), Math.abs(rival));
  if (Math.abs(me - rival) <= scale * 0.01) return 'tie';
  return me > rival ? 'me' : 'rival';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number) => formatMoney(v, 1);

/** Short connection readout for the panel subtitle. Empty when there is nothing useful to say. */
function linkText(status: string, pingMs: number | undefined): string {
  if (status === 'disconnected') return 'Connection dropped';
  if (status === 'connecting') return 'Connecting';
  if (status === 'connected') return pingMs !== undefined ? `Connected · ${Math.round(pingMs)} ms` : 'Connected';
  return '';
}

function LeadCell({ lead, rivalName, rivalColor }: { lead: Lead | 'you' | 'rival' | 'tie' | 'none'; rivalName: string; rivalColor: string }) {
  if (lead === 'me') return <span class="mp-you">You</span>;
  if (lead === 'rival') return <span class="mp-rv" style={{ '--c': rivalColor } as any}>{rivalName}</span>;
  if (lead === 'tie') return <span class="faint">Even</span>;
  return <span class="faint">—</span>;
}

/** Window in the VS grid. Keeps the card chrome consistent with the rest of the game. */
function Win({ code, title, subtitle, flush, children }: { code: string; title: string; subtitle?: ComponentChildren; flush?: boolean; children: ComponentChildren }) {
  return (
    <Card code={code} title={title} subtitle={subtitle} flush={flush} class="mp-win">
      {children}
    </Card>
  );
}

export function VsPanel() {
  const s = useGame();
  const session = useSession();
  const [draft, setDraft] = useState('');
  const [confirmConcede, setConfirmConcede] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const logLen = s.mp?.log.length ?? 0;

  // Newest feed line stays in view.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLen]);

  const mp = s.mp;
  if (!mp) {
    return (
      <div class="panel mp-vs">
        <PanelHeader code="VS" title="Versus" subtitle="Head-to-head with a human rival" />
        <Card code="VS" title="No match running">
          <EmptyState
            title="Not in a match"
            text="Host a room or join one with a code. This panel opens once the match starts."
            action={
              <div>
                <Button variant="primary" onClick={openLobby}>
                  Multiplayer…
                </Button>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const rival = mp.rival;
  const info = labInfo(s, MP_RIVAL_ID);
  const rivalName = info?.name ?? rival?.companyName ?? 'Rival';
  const rivalColor = info?.color ?? rival?.color ?? FALLBACK_RIVAL;
  const over = mp.result !== null;
  const daysLeft = over ? null : matchDaysLeft(s);
  const lengthYears = mp.settings.lengthYears;
  const timeLeft = over ? 'Over' : daysLeft === null ? (lengthYears === null ? 'Endless' : '—') : formatDays(daysLeft);
  const endHint = lengthYears === null ? 'No end date' : `Ends 1 Jan ${BALANCE.START_YEAR + lengthYears}`;

  const crowns: CrownRow[] = crownTable(s);
  const myCrowns = crowns.filter((c) => c.leader === 'me').length;
  const rivalCrowns = crowns.filter((c) => c.leader === 'rival').length;

  const myBest = arenaLeaderboard(s).find((r) => r.isPlayer) ?? null;
  const rivalModel = rival?.model ?? null;
  const myUsers = (seg: Segment) => s.market.segments[seg]?.playerUsers ?? 0;
  const rivalUsers = (seg: Segment): number | null => (rival ? (rival.users[seg] ?? 0) : null);

  const h2h: { label: string; me: string; rv: string; lead: Lead; num: boolean }[] = [
    {
      label: 'Valuation',
      me: money(s.finance.valuation),
      rv: rival ? money(rival.valuation) : '—',
      lead: leadOf(s.finance.valuation, rival?.valuation ?? null),
      num: true,
    },
    {
      label: 'Revenue / day',
      me: money(s.finance.dailyRevenue),
      rv: rival ? money(rival.revenuePerDay) : '—',
      lead: leadOf(s.finance.dailyRevenue, rival?.revenuePerDay ?? null),
      num: true,
    },
    {
      label: 'Cash',
      me: money(s.finance.cash),
      rv: rival ? money(rival.cash) : '—',
      lead: leadOf(s.finance.cash, rival?.cash ?? null),
      num: true,
    },
    ...SEGMENTS.map((g) => {
      const rv = rivalUsers(g.id);
      return {
        label: g.userLabel,
        me: formatNumber(myUsers(g.id), 1),
        rv: rv === null ? '—' : formatNumber(rv, 1),
        lead: leadOf(myUsers(g.id), rv),
        num: true,
      };
    }),
    {
      label: 'Best model',
      me: myBest?.modelName ?? '—',
      rv: rivalModel?.name ?? '—',
      lead: 'none' as Lead,
      num: false,
    },
    {
      label: 'Arena Elo',
      me: myBest ? String(Math.round(myBest.elo)) : '—',
      rv: rivalModel ? String(Math.round(rivalModel.elo)) : '—',
      lead: leadOf(myBest?.elo ?? null, rivalModel?.elo ?? null),
      num: true,
    },
    {
      label: 'Benchmark crowns',
      me: String(myCrowns),
      rv: String(rivalCrowns),
      lead: leadOf(myCrowns, rivalCrowns),
      num: true,
    },
  ];

  const send = () => {
    const text = draft.trim();
    if (!text || over) return;
    dispatch({ type: 'mpChat', text });
    setDraft('');
  };

  const hist = mp.history;
  const scoreText = (v: number | null) => (v === null ? '—' : v.toFixed(1));

  return (
    <div class="panel mp-vs">
      <PanelHeader
        code="VS"
        title="Versus"
        subtitle={[`You vs ${rivalName}`, linkText(session.status, session.pingMs)].filter(Boolean).join(' · ')}
        actions={
          <>
            <Stat label="Time left" value={timeLeft} size="sm" hint={endHint} />
            <Button variant="danger" size="sm" disabled={over} onClick={() => setConfirmConcede(true)}>
              Concede
            </Button>
          </>
        }
      />

      {!rival && (
        <div class="mp-note" role="status">
          Waiting for {rivalName} to report. Their side of every number fills in after the first snapshot.
        </div>
      )}

      <div class="mp-vs-grid">
        <Win code="H2H" title="Head to head">
          <div class="table-wrap table-stack">
            <table class="table mp-h2h">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th class="num">
                    <span class="mp-you">You</span>
                  </th>
                  <th class="num">
                    <span class="mp-rv" style={{ '--c': rivalColor } as any}>
                      <span class="swatch" aria-hidden="true" /> {rivalName}
                    </span>
                  </th>
                  <th>Lead</th>
                </tr>
              </thead>
              <tbody>
                {h2h.map((r) => (
                  <tr key={r.label}>
                    <td class="mb-head">{r.label}</td>
                    <td class={r.num ? 'num' : 'mp-r'} data-label="You">{r.me}</td>
                    <td class={r.num ? 'num' : 'mp-r'} data-label={rivalName}>{r.rv}</td>
                    <td data-label="Lead">
                      <LeadCell lead={r.lead} rivalName={rivalName} rivalColor={rivalColor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Win>

        <Win code="VAL" title="Valuation" subtitle="Weekly samples">
          <LineChart
            series={[
              { name: 'You', color: YOU, points: hist.map((h) => ({ x: h.day, y: h.me })) },
              { name: rivalName, color: rivalColor, points: hist.map((h) => ({ x: h.day, y: h.rival })) },
            ]}
            height={240}
            yFormat={(v) => formatMoney(v, 0)}
            emptyText="The valuation chart fills in weekly, starting next sample."
          />
        </Win>

        <Win code="CRN" title="Benchmark crowns" subtitle={`Crowns: you ${myCrowns} · rival ${rivalCrowns}`} flush>
          {crowns.length === 0 ? (
            <div class="mp-pad">
              <EmptyState title="No crowns yet" text="Both labs need a scored model on a benchmark before a crown can change hands." />
            </div>
          ) : (
            <div class="table-wrap table-stack">
              <table class="table mp-crowns">
                <thead>
                  <tr>
                    <th>Benchmark</th>
                    <th class="num">You</th>
                    <th class="num">{rivalName}</th>
                    <th>Leader</th>
                  </tr>
                </thead>
                <tbody>
                  {crowns.map((c) => (
                    <tr key={c.benchId} class={`mp-crown mp-lead-${c.leader}`} style={{ '--c': rivalColor } as any}>
                      <td class="mb-head">{c.name}</td>
                      <td class="num" data-label="You">{scoreText(c.mine)}</td>
                      <td class="num" data-label={rivalName}>{scoreText(c.rival)}</td>
                      <td data-label="Leader">
                        <LeadCell lead={c.leader === 'me' ? 'me' : c.leader === 'rival' ? 'rival' : c.leader === 'tie' ? 'tie' : 'none'} rivalName={rivalName} rivalColor={rivalColor} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Win>

        <Win code="SHR" title="Share by segment" subtitle="Users, you and the rival">
          <div class="mp-shares">
            {SEGMENTS.map((g) => {
              const rows = segmentShares(s, g.id);
              const total = rows.reduce((a, r) => a + Math.max(0, r.users), 0);
              // Sum every product line you run in this segment (v8: up to two per kind).
              const mine = total > 0 ? rows.reduce((a, r) => (r.isPlayer ? a + Math.max(0, r.users) : a), 0) / total : 0;
              const theirs = total > 0 ? (rows.find((r) => r.id === MP_RIVAL_ID)?.users ?? 0) / total : 0;
              return (
                <div class="mp-share" key={g.id}>
                  <div class="mp-share-head">
                    <span>{g.label}</span>
                    <span>
                      <span class="mp-you">
                        You <span class="num">{pct(mine)}</span>
                      </span>
                      <span class="faint"> · </span>
                      <span class="mp-rv" style={{ '--c': rivalColor } as any}>
                        {rivalName} <span class="num">{pct(theirs)}</span>
                      </span>
                    </span>
                  </div>
                  <div class="stacked mp-share-bar" role="img" aria-label={`${g.label}: you ${pct(mine)}, ${rivalName} ${pct(theirs)}`}>
                    <div class="stacked-seg" style={{ width: `${(mine * 100).toFixed(2)}%`, '--c': YOU } as any} />
                    <div class="stacked-seg" style={{ width: `${(theirs * 100).toFixed(2)}%`, '--c': rivalColor } as any} />
                  </div>
                </div>
              );
            })}
          </div>
        </Win>

        <Win code="ATK" title="Attacks" subtitle="Cost cash, then cool down">
          <div class="mp-attacks">
            {KINDS.map((kind) => {
              const def = ATTACKS[kind];
              const st = attackStatus(s, kind);
              const wait = st.readyDay - s.day;
              const disabled = over || !st.ok;
              return (
                <button
                  key={kind}
                  type="button"
                  class="mp-attack"
                  disabled={disabled}
                  title={disabled ? st.reason : def?.description}
                  onClick={() => dispatch({ type: 'mpAttack', kind })}
                >
                  <span class="mp-attack-name">{def?.name ?? kind}</span>
                  {def?.description && <span class="mp-attack-desc">{plain(def.description)}</span>}
                  <span class="mp-attack-meta">
                    <span class="num">{money(st.cost)}</span>
                    <span class="faint">·</span>
                    <span>{wait > 0 ? `Ready in ${formatDays(wait)}` : 'Ready'}</span>
                  </span>
                  {disabled && st.reason && <span class="mp-attack-reason">{plain(st.reason)}</span>}
                </button>
              );
            })}
          </div>
        </Win>

        <Win code="LOG" title="Feed" subtitle="Attacks, crowns and chat">
          <div class="mp-feed" ref={feedRef} role="log" aria-live="polite">
            {mp.log.length === 0 ? (
              <div class="mp-feed-empty">Nothing yet. Attacks, crown changes and chat show up here.</div>
            ) : (
              mp.log.map((l, i) => (
                <div
                  key={i}
                  class={`mp-feed-row mp-kind-${l.kind}`}
                  style={{ '--c': l.kind === 'me' ? YOU : l.kind === 'rival' ? rivalColor : 'var(--line-2)' } as any}
                >
                  <span class="mp-feed-day num">{tdateShort(l.day)}</span>
                  <span class="mp-feed-text">{plain(l.text)}</span>
                </div>
              ))
            )}
          </div>
          <form
            class="mp-chat"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              class="input"
              value={draft}
              maxLength={200}
              placeholder={`Message ${rivalName}`}
              aria-label="Chat message"
              disabled={over}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <Button type="submit" disabled={over || draft.trim() === ''}>
              Send
            </Button>
          </form>
        </Win>
      </div>

      <Modal
        open={confirmConcede}
        title="Concede this match?"
        tone="danger"
        width={440}
        onClose={() => setConfirmConcede(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmConcede(false)}>
              Keep playing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmConcede(false);
                dispatch({ type: 'mpConcede' });
              }}
            >
              Concede
            </Button>
          </>
        }
      >
        <p>
          You forfeit, and {rivalName} takes the match. This can't be undone.
        </p>
      </Modal>
    </div>
  );
}
