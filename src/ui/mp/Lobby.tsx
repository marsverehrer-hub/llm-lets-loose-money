// Multiplayer screen (v12): a full page, not a popup. Left: start a new match, which is always an explicit, named save.
// Right: every saved match, to resume or delete. While a match is in play, its room code and the head-to-head plate
// sit on top. Mounted by App while lobbyState says open.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Pill, Tabs } from '../components';
import { useGame } from '../store';
import { MP_COLORS, hostGame, joinGame, leaveGame, reconnect, resumeMatch, saveMatchNow, useSession } from '../../net/session';
import type { SessionInfo } from '../../net/session';
import { activeMpSaveId, deleteMpSave, listMpSaves, onMpSavesChange, renameMpSave, type MpSaveMeta } from '../../net/mpSave';
import { formatDate, formatMoney } from '../../sim/util';
import { ConfirmButton } from '../panels/panelKit';
import { navigate } from '../nav';
import { closeLobby } from './lobbyState';
import './mp.css';

type Tab = 'host' | 'join';
type LengthId = '5' | '10' | '15' | 'endless';

const LENGTHS: { id: LengthId; label: string; years: number | null }[] = [
  { id: '5', label: '5 years', years: 5 },
  { id: '10', label: '10 years', years: 10 },
  { id: '15', label: '15 years', years: 15 },
  { id: 'endless', label: 'Endless', years: null },
];

/** Room codes use A to Z without I and O, so they read out clearly. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

/** Upper-cases and filters typed input down to a valid room code prefix. */
export function cleanRoomCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (CODE_LETTERS.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Could not connect. Check the code and try again.';
}

type Tone = 'good' | 'warn' | 'bad' | 'muted';

function statusOf(session: SessionInfo): { text: string; tone: Tone } {
  switch (session.status) {
    case 'connecting':
      return { text: 'Connecting…', tone: 'warn' };
    case 'waiting':
      return { text: 'Waiting for your rival to join', tone: 'warn' };
    case 'connected':
      return {
        text: session.pingMs !== undefined ? `Connected · ${Math.round(session.pingMs)} ms` : 'Connected',
        tone: 'good',
      };
    case 'disconnected':
      return { text: session.detail || 'Not connected', tone: 'bad' };
    case 'error':
      return { text: session.detail || 'Something went wrong.', tone: 'bad' };
    default:
      return { text: '', tone: 'muted' };
  }
}

const DOT: Record<Tone, string> = { good: 'dot-good', warn: 'dot-warn', bad: 'dot-bad', muted: '' };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function useMpSaves(): MpSaveMeta[] {
  const [, setV] = useState(0);
  useEffect(() => onMpSavesChange(() => setV((v) => v + 1)), []);
  return listMpSaves();
}

/** A company as a coloured plate with its initials. `empty` draws the dashed seat of a rival not there yet. */
function Plate({ name, color, role, empty }: { name: string; color: string | null; role: string; empty?: boolean }) {
  return (
    <div class={`mps-plate${empty ? ' is-empty' : ''}`} style={{ '--c': color ?? 'var(--line-2)' } as any}>
      <span class="mps-plate-badge" aria-hidden="true">
        {empty ? '?' : initials(name)}
      </span>
      <span class="mps-plate-text">
        <span class="mps-plate-name">{name}</span>
        <span class="mps-plate-role">{role}</span>
      </span>
    </div>
  );
}

/** Six letter tiles. Used for the live room code and, while typing, for the join code. */
function CodeTiles({ code, label }: { code: string; label: string }) {
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');
  return (
    <div class="mps-tiles" aria-label={label}>
      {cells.map((ch, i) => (
        <span key={i} class={`mps-tile${ch ? '' : ' is-blank'}`}>
          {ch}
        </span>
      ))}
    </div>
  );
}

/** Two-colour bar of the valuations: who is ahead at a glance. */
function Duel({ me, rival, myColor, rivalColor }: { me: number; rival: number | null; myColor: string; rivalColor: string | null }) {
  if (rival === null || me + rival <= 0) return <div class="mps-duel is-empty" aria-hidden="true" />;
  const share = me / (me + rival);
  return (
    <div class="mps-duel" role="img" aria-label={`Valuation ${formatMoney(me, 1)} against ${formatMoney(rival, 1)}`}>
      <span style={{ width: `${(share * 100).toFixed(1)}%`, '--c': myColor } as any} />
      <span style={{ width: `${((1 - share) * 100).toFixed(1)}%`, '--c': rivalColor ?? 'var(--line-2)' } as any} />
    </div>
  );
}

function resultPill(m: MpSaveMeta, inPlay: boolean) {
  if (inPlay) return <Pill tone="good">In play</Pill>;
  if (!m.result) return <Pill tone="muted">Paused</Pill>;
  if (m.result.winner === 'me') return <Pill tone="good">Won</Pill>;
  if (m.result.winner === 'rival') return <Pill tone="bad">Lost</Pill>;
  return <Pill tone="muted">Draw</Pill>;
}

// ---------------------------------------------------------------------------
// The match in play
// ---------------------------------------------------------------------------

function LiveMatch({ session }: { session: SessionInfo }) {
  const s = useGame();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<'' | 'ok' | 'fail'>('');
  const [leaveArmed, setLeaveArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!leaveArmed) return;
    const t = window.setTimeout(() => setLeaveArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [leaveArmed]);

  const st = statusOf(session);
  const room = session.room ?? s.mp?.room ?? '';
  const started = !!s.mp;
  const myColor = s.mp?.myColor ?? null;
  const rivalName = session.rivalName ?? s.mp?.rival?.companyName ?? null;
  const rivalColor = session.rivalColor ?? s.mp?.rival?.color ?? null;
  const saveName = listMpSaves().find((m) => m.id === activeMpSaveId())?.name;
  const canRetry = started && !s.mp?.result && (session.status === 'error' || session.status === 'disconnected');

  const flash = (fn: () => void) => {
    fn();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(false);
      setSaved('');
    }, 1600);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room);
      flash(() => setCopied(true));
    } catch {
      setCopied(false);
    }
  };
  const leave = () => {
    if (!leaveArmed) return setLeaveArmed(true);
    setLeaveArmed(false);
    leaveGame();
  };

  return (
    <section class="mps-live" aria-label="Match in play">
      <div class="mps-live-head">
        <span class="mps-kicker">{started ? 'Match in play' : 'Room open'}</span>
        {saveName && <span class="mps-savename">Save: {saveName}</span>}
      </div>
      <div class="mps-vs">
        <Plate name={s.company.name} color={myColor ?? 'var(--blue)'} role={session.role === 'guest' ? 'You · guest' : 'You · host'} />
        <span class="mps-vs-mark" aria-hidden="true">
          VS
        </span>
        <Plate
          name={rivalName ?? 'Waiting for a rival'}
          color={rivalColor}
          role={rivalName ? (session.role === 'guest' ? 'Host' : 'Guest') : 'Send them the code'}
          empty={!rivalName}
        />
      </div>
      {started && s.mp && (
        <Duel me={s.finance.valuation} rival={s.mp.rival?.valuation ?? null} myColor={myColor ?? 'var(--blue)'} rivalColor={rivalColor} />
      )}
      <div class="mps-room">
        <div>
          <div class="field-label">Room code</div>
          <CodeTiles code={room} label={`Room code ${room.split('').join(' ')}`} />
        </div>
        <Button size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>
      <div class="mp-status" role="status">
        {st.tone !== 'muted' && <span class={`dot ${DOT[st.tone]}`} aria-hidden="true" />}
        <span class={`mp-status-${st.tone}`}>{st.text}</span>
      </div>
      <div class="mps-actions">
        {started && (
          <Button
            variant="primary"
            onClick={() => {
              closeLobby();
              navigate('vs');
            }}
          >
            Back to the match
          </Button>
        )}
        {canRetry && <Button onClick={() => reconnect()}>Reconnect</Button>}
        {started && <Button onClick={() => flash(() => setSaved(saveMatchNow() ? 'ok' : 'fail'))}>{saved === 'ok' ? 'Saved' : saved === 'fail' ? 'Could not save' : 'Save now'}</Button>}
        <Button variant="danger" onClick={started ? leave : () => leaveGame()}>
          {!started ? 'Close room' : leaveArmed ? 'Confirm: leave' : 'Leave match'}
        </Button>
      </div>
      <p class="mp-dim">
        {started
          ? 'The match saves itself every few days. Leaving keeps the save: open it from the list to carry on.'
          : 'Your rival opens Multiplayer, picks Join and types this code. The save is created when they arrive.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// New match
// ---------------------------------------------------------------------------

function NewMatch() {
  const s = useGame();
  const session = useSession();
  const [tab, setTab] = useState<Tab>('host');
  const [saveName, setSaveName] = useState('');
  const [name, setName] = useState(() => s.company.name);
  const [color, setColor] = useState<string>(MP_COLORS[0]);
  const [length, setLength] = useState<LengthId>('10');
  const [code, setCode] = useState('');
  const [relay, setRelay] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');

  const companyName = name.trim() || s.company.name;
  const years = LENGTHS.find((l) => l.id === length)?.years ?? null;
  const cleanSave = saveName.trim();
  const codeOk = cleanRoomCode(code).length === CODE_LENGTH;
  const formValid = cleanSave.length > 0 && (tab === 'host' || codeOk);
  const shownErr = err || (session.status === 'error' && !s.mp ? session.detail ?? '' : '');

  const submit = async () => {
    if (!formValid || pending) return;
    setErr('');
    setPending(true);
    try {
      if (tab === 'host') await hostGame({ companyName, color, lengthYears: years, relayUrl: relay.trim() || undefined, saveName: cleanSave });
      else await joinGame({ room: cleanRoomCode(code), companyName, color, relayUrl: relay.trim() || undefined, saveName: cleanSave });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section class="mps-card" aria-labelledby="mps-new-title">
      <h2 class="mps-h" id="mps-new-title">
        New match
      </h2>
      <div class="mps-preview">
        <Plate name={companyName} color={color} role={tab === 'host' ? 'You · host' : 'You · guest'} />
        <span class="mps-vs-mark" aria-hidden="true">
          VS
        </span>
        <Plate name="Your rival" color={null} role={tab === 'host' ? 'Joins with your code' : 'Hosts the room'} empty />
      </div>

      <ol class="mps-steps">
        <li class="mps-step">
          <span class="mps-step-n">1</span>
          <div class="field mps-step-body">
            <label class="field-label" for="mps-save">
              Name this save
            </label>
            <input
              id="mps-save"
              class="input"
              value={saveName}
              maxLength={40}
              placeholder="Friday rematch"
              onInput={(e) => setSaveName((e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">The match is stored under this name. Your single-player game stays where it is.</span>
          </div>
        </li>

        <li class="mps-step">
          <span class="mps-step-n">2</span>
          <div class="mps-step-body mps-two">
            <div class="field">
              <label class="field-label" for="mp-company">
                Company name
              </label>
              <input
                id="mp-company"
                class="input"
                value={name}
                maxLength={32}
                placeholder={s.company.name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <span class="field-label" id="mp-colour-label">
                Colour
              </span>
              <div class="mp-swatches" role="group" aria-labelledby="mp-colour-label">
                {MP_COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    class="mp-swatch"
                    aria-pressed={c === color}
                    aria-label={`Colour ${i + 1}`}
                    title={`Colour ${i + 1}`}
                    style={{ '--c': c } as any}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
        </li>

        <li class="mps-step">
          <span class="mps-step-n">3</span>
          <div class="mps-step-body">
            <Tabs
              variant="segmented"
              class="mp-mode"
              tabs={[
                { id: 'host' as Tab, label: 'Host a room' },
                { id: 'join' as Tab, label: 'Join with a code' },
              ]}
              value={tab}
              onChange={(t) => {
                setTab(t);
                setErr('');
              }}
            />
            {tab === 'host' ? (
              <div class="field">
                <span class="field-label" id="mp-length-label">
                  Match length
                </span>
                <Tabs variant="segmented" class="mp-length" tabs={LENGTHS.map((l) => ({ id: l.id, label: l.label }))} value={length} onChange={setLength} />
                <span class="field-hint">You get a 6-letter code to send to your rival.</span>
              </div>
            ) : (
              <div class="field">
                <label class="field-label" for="mp-code">
                  Room code from the host
                </label>
                <div class="mps-code-entry">
                  <CodeTiles code={code} label="Typed code" />
                  <input
                    id="mp-code"
                    class="mps-code-input"
                    value={code}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellcheck={false}
                    onInput={(e) => setCode(cleanRoomCode((e.target as HTMLInputElement).value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submit();
                    }}
                  />
                </div>
                <span class="field-hint">To continue an old match instead, open it from Saved matches. You both open your own copy.</span>
              </div>
            )}
          </div>
        </li>
      </ol>

      <details class="mp-advanced">
        <summary>Advanced</summary>
        <div class="field">
          <label class="field-label" for="mp-relay">
            Relay URL
          </label>
          <input
            id="mp-relay"
            class="input"
            value={relay}
            placeholder="wss://"
            autoComplete="off"
            onInput={(e) => setRelay((e.target as HTMLInputElement).value)}
          />
          <span class="field-hint">Optional. Leave empty to connect through the public broker.</span>
        </div>
      </details>

      {shownErr && (
        <div class="mp-error" role="alert">
          {shownErr}
        </div>
      )}

      <div class="mps-actions">
        <Button variant="primary" disabled={pending || !formValid} onClick={submit}>
          {pending ? 'Connecting…' : tab === 'host' ? 'Create save and host' : 'Create save and join'}
        </Button>
        {!cleanSave && <span class="mp-dim">Name the save first.</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Saved matches
// ---------------------------------------------------------------------------

function SavedRow({ m, inPlay, busy, onResume }: { m: MpSaveMeta; inPlay: boolean; busy: boolean; onResume: (m: MpSaveMeta) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.name);
  const commit = () => {
    renameMpSave(m.id, draft);
    setEditing(false);
  };
  return (
    <li class={`mps-save${inPlay ? ' is-live' : ''}`}>
      <span class="mps-save-colors" aria-hidden="true">
        <span style={{ '--c': m.myColor } as any} />
        <span style={{ '--c': m.rivalColor ?? 'var(--line-2)' } as any} />
      </span>
      <div class="mps-save-main">
        <div class="mps-save-top">
          {editing ? (
            <input
              class="input mps-rename"
              value={draft}
              maxLength={40}
              aria-label="Save name"
              autoFocus
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <button type="button" class="mps-save-name" title="Rename" onClick={() => setEditing(true)}>
              {m.name}
            </button>
          )}
          {resultPill(m, inPlay)}
        </div>
        <div class="mps-save-vs">
          <span>{m.companyName}</span>
          <span class="faint"> vs </span>
          <span>{m.rivalName ?? 'no rival yet'}</span>
        </div>
        <Duel me={m.valuation} rival={m.rivalValuation} myColor={m.myColor} rivalColor={m.rivalColor} />
        <div class="mps-save-meta">
          <span class="num">{formatDate(m.day)}</span>
          <span>{m.role === 'host' ? 'You host' : 'You joined'}</span>
          <span class="num">Room {m.room}</span>
          <span>{m.lengthYears === null ? 'Endless' : `${m.lengthYears}-year match`}</span>
          <span>Played {ago(m.updatedAt)}</span>
        </div>
        {m.result && <div class="mps-save-result">{m.result.reason}</div>}
      </div>
      <div class="mps-save-acts">
        {!inPlay && (
          <Button size="sm" variant={m.result ? undefined : 'primary'} disabled={busy} onClick={() => onResume(m)}>
            {m.result ? 'Open' : 'Resume'}
          </Button>
        )}
        <ConfirmButton
          label="Delete"
          confirmLabel="Really delete"
          disabled={inPlay}
          title={inPlay ? 'Leave the match first' : 'Delete this save for good'}
          onConfirm={() => deleteMpSave(m.id)}
        />
      </div>
    </li>
  );
}

function SavedMatches() {
  const saves = useMpSaves();
  const s = useGame();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const live = s.mp ? activeMpSaveId() : null;

  const resume = async (m: MpSaveMeta) => {
    setErr('');
    setBusy(true);
    try {
      await resumeMatch(m.id);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="mps-card" aria-labelledby="mps-saved-title">
      <h2 class="mps-h" id="mps-saved-title">
        Saved matches <span class="faint num">{saves.length}</span>
      </h2>
      <p class="mp-dim">
        Each player keeps their own copy. To carry on, the host presses Resume first, then the guest does the same.
      </p>
      {err && (
        <div class="mp-error" role="alert">
          {err}
        </div>
      )}
      {saves.length === 0 ? (
        <div class="mps-empty">
          <span class="mps-empty-seats" aria-hidden="true">
            <span />
            <span />
          </span>
          No saved matches yet. Start one and it appears here, ready to resume any time.
        </div>
      ) : (
        <ul class="mps-saves">
          {saves.map((m) => (
            <SavedRow key={m.id} m={m} inPlay={m.id === live} busy={busy} onResume={resume} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export function Lobby() {
  const s = useGame();
  const session = useSession();
  const live = !!s.mp || session.status === 'waiting' || session.status === 'connecting';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLobby();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="mps" role="dialog" aria-modal="true" aria-labelledby="mps-title">
      <header class="mps-head">
        <span class="mps-code">MP &lt;GO&gt;</span>
        <h1 class="mps-title" id="mps-title">
          Multiplayer
        </h1>
        <span class="mps-sub">1 vs 1 over the internet. Every match is its own save.</span>
        <Button class="mps-close" onClick={closeLobby}>
          Close
        </Button>
      </header>
      <div class="mps-body">
        {live && <LiveMatch session={session} />}
        <div class={`mps-grid${live ? ' is-solo' : ''}`}>
          {!live && <NewMatch />}
          <SavedMatches />
        </div>
      </div>
    </div>
  );
}
