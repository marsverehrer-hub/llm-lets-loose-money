// OWNER: SAVES. The saves sheet: every game in its own slot, with load, rename, export, import, delete and snapshots.
// It opens from the menu, the S key, the game-over window and the new-game screen. A full-screen sheet on phones.
// Confirmations sit inside the row rather than in a second modal, so Escape closes only this sheet.
import { useEffect, useRef, useState } from 'preact/hooks';
import { DIFFICULTIES, SCENARIOS } from '../../sim/data/scenarios';
import { deleteSlot, exportSlot, getActiveSlotId, importSave, listSlots, storageBytes, type SlotMeta } from '../../sim/save';
import { dayToDate, formatMoney } from '../../sim/util';
import { Button, Pill, Sheet } from '../components';
import { loadSlotIntoGame, renameSlot, saveAsNew } from '../store';
import { saveMessage } from '../saveText';
import './saves.css';

/** Window event that opens the saves sheet. */
export const SAVES_EVENT = 'llm:saves';

export function openSaves(): void {
  window.dispatchEvent(new Event(SAVES_EVENT));
}

const MB = 1024 * 1024;
/** Above this, the sheet warns before the next save fails. */
const NEAR_FULL_BYTES = 4.5 * MB;

type Notice = { tone: 'good' | 'bad'; text: string };
/** The one open action on a row: a confirmation, or an inline rename. */
type Pending = { kind: 'delete'; id: string } | { kind: 'load'; id: string } | { kind: 'rename'; id: string; text: string };

/** "0.84", "1.8": two decimals while the store is small, one after that. */
function megabytes(bytes: number): string {
  const mb = bytes / MB;
  return mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1);
}

/** "3 min ago", "2 h ago", "4 days ago", or "just now". */
function ago(ts: number, now: number): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The export file name: "<company>-<date>.llm-save.json". */
function fileName(m: SlotMeta): string {
  const base = m.company.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
  const d = dayToDate(m.day);
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${base}-${iso}.llm-save.json`;
}

export function SavesSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SAVES_EVENT, show);
    return () => window.removeEventListener(SAVES_EVENT, show);
  }, []);
  // Mounted only while open, so the list is read fresh each time.
  return open ? <SavesBody onClose={() => setOpen(false)} /> : null;
}

/** Rename field: focused and selected when it appears. Enter saves, Escape cancels, neither closes the sheet. */
function RenameInput({ value, onInput, onCommit, onCancel }: { value: string; onInput: (v: string) => void; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="input sv-rename"
      value={value}
      maxLength={40}
      aria-label="Save name"
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onCommit();
        else if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

function SavesBody({ onClose }: { onClose: () => void }) {
  const [slots, setSlots] = useState<SlotMeta[]>(() => listSlots());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveSlotId());
  const [bytes, setBytes] = useState(() => storageBytes());
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setSlots(listSlots());
    setActiveId(getActiveSlotId());
    setBytes(storageBytes());
    setNow(Date.now());
  };

  // Keeps "Saved 3 min ago" current while the sheet is open. Autosave keeps running underneath.
  useEffect(() => {
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const rows = [...slots].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId) || b.savedAt - a.savedAt);
  const fail = (text: string) => setNotice({ tone: 'bad', text });
  const done = (text: string) => setNotice({ tone: 'good', text });

  const load = (id: string, discardUnsaved = false) => {
    const r = loadSlotIntoGame(id, { discardUnsaved });
    if (r.ok) {
      onClose();
      return;
    }
    if (r.error === 'unsaved') {
      setPending({ kind: 'load', id });
      return;
    }
    fail(saveMessage(r.error));
    refresh();
  };

  const snapshot = () => {
    const r = saveAsNew();
    if (r.ok) done('Snapshot saved. The game you are playing stays active.');
    else fail(saveMessage(r.error));
    refresh();
  };

  const rename = (id: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    if (renameSlot(id, t)) done('Renamed.');
    else fail('That save could not be renamed.');
    setPending(null);
    refresh();
  };

  const remove = (m: SlotMeta) => {
    deleteSlot(m.id);
    setPending(null);
    if (m.id === activeId) done('Deleted. The game you are playing is not saved until the next autosave.');
    else done(`Deleted ${m.name}.`);
    refresh();
  };

  const exportOne = (m: SlotMeta) => {
    const text = exportSlot(m.id);
    if (text === null) {
      fail('That save cannot be exported.');
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(m);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    done(`Exported ${a.download}.`);
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again still fires a change
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      fail('That file could not be read.');
      return;
    }
    const r = importSave(text);
    if (r.ok) done('Imported as a snapshot. Load it to play it.');
    else fail(saveMessage(r.error));
    refresh();
  };

  const nearFull = bytes >= NEAR_FULL_BYTES;

  return (
    <Sheet
      open
      title="Saves"
      subtitle="Each company keeps its own save. Autosave writes to the one you are playing."
      onClose={onClose}
      width={600}
      class="sv-sheet"
      footer={
        <>
          <Button onClick={() => fileRef.current?.click()}>Import save</Button>
          <Button variant="primary" onClick={snapshot}>
            Save as new snapshot
          </Button>
        </>
      }
    >
      <input ref={fileRef} type="file" accept=".json,application/json" class="sv-file" aria-label="Import a save file" onChange={onFile} />

      <p class="sv-usage small muted">
        <span class="num">{megabytes(bytes)} MB</span> of about <span class="num">5 MB</span> used
      </p>
      {nearFull && (
        <p class="sv-notice small bad" role="status">
          Storage is nearly full. Delete or export a save before the next one.
        </p>
      )}
      {notice && (
        <p class={`sv-notice small ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p class="sv-empty muted">No saves yet. A new company is saved here as soon as it starts.</p>
      ) : (
        <ul class="sv-list">
          {rows.map((m) => {
            const active = m.id === activeId;
            const p = pending && pending.id === m.id ? pending : null;
            const scenario = SCENARIOS.find((x) => x.id === (m.scenarioId ?? 'garage'))?.name ?? 'Garage';
            const difficulty = DIFFICULTIES.find((d) => d.id === (m.difficulty ?? 'founder'))?.name ?? 'Founder';
            return (
              <li key={m.id} class={`sv-row ${active ? 'is-active' : ''}`}>
                <div class="sv-head">
                  <span class="sv-name">{m.name}</span>
                  <span class="sv-tags">
                    {active && <Pill tone="good">Playing</Pill>}
                    {!m.auto && <Pill>Snapshot</Pill>}
                  </span>
                </div>
                <div class="sv-meta small muted">
                  {m.company && m.company !== m.name && <span>{m.company}, </span>}
                  <span>{m.dateLabel}</span>
                  <span>
                    {' '}
                    · {scenario}, {difficulty}
                  </span>
                </div>
                <div class="sv-stats small">
                  <span>
                    Valuation <span class="num">{formatMoney(m.valuation, 1)}</span>
                  </span>
                  <span>
                    Cash <span class="num">{formatMoney(m.cash, 1)}</span>
                  </span>
                  <span class="muted">Saved {ago(m.savedAt, now)}</span>
                </div>

                {p?.kind === 'rename' && (
                  <div class="sv-confirm">
                    <RenameInput
                      value={p.text}
                      onInput={(text) => setPending({ ...p, text })}
                      onCommit={() => rename(m.id, p.text)}
                      onCancel={() => setPending(null)}
                    />
                    <div class="sv-actions">
                      <Button variant="primary" onClick={() => rename(m.id, p.text)}>
                        Save name
                      </Button>
                      <Button onClick={() => setPending(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {p?.kind === 'delete' && (
                  <div class="sv-confirm">
                    <p class="small">
                      Delete {m.name}? This cannot be undone.
                      {active ? ' It is the game you are playing, so it stays unsaved until the next autosave.' : ''}
                    </p>
                    <div class="sv-actions">
                      <Button variant="danger" onClick={() => remove(m)}>
                        Delete save
                      </Button>
                      <Button onClick={() => setPending(null)}>Keep it</Button>
                    </div>
                  </div>
                )}
                {p?.kind === 'load' && (
                  <div class="sv-confirm">
                    <p class="small">The current game could not be saved, so switching now loses its latest progress. Load {m.name} anyway?</p>
                    <div class="sv-actions">
                      <Button variant="danger" onClick={() => load(m.id, true)}>
                        Load anyway
                      </Button>
                      <Button onClick={() => setPending(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {!p && (
                  <div class="sv-actions">
                    <Button variant="primary" disabled={active} onClick={() => load(m.id)}>
                      Load
                    </Button>
                    <Button onClick={() => setPending({ kind: 'rename', id: m.id, text: m.name })}>Rename</Button>
                    <Button onClick={() => exportOne(m)}>Export</Button>
                    <Button variant="ghost" onClick={() => setPending({ kind: 'delete', id: m.id })}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
