// OWNER: SCENARIO. v9 new-game screen (GAME_DESIGN §20.1). A full-screen sheet on every width: company name, scenario,
// difficulty, options, then Start. It opens from the menu's "New game" (openNewGame) and by itself when there is no save.
import { useEffect, useState } from 'preact/hooks';
import type { DifficultyId, GameSetup } from '../../sim/types';
import { DIFFICULTIES, SCENARIOS, type ScenarioDef, type ScenarioRules } from '../../sim/data/scenarios';
import { BALANCE } from '../../sim/balance';
import { doctrineById } from '../../sim/data/doctrines';
import { formatMoney } from '../../sim/util';
import { Button, Pill } from '../components';
import { FIRST_RUN, newGame } from '../store';
import { listSlots } from '../../sim/save';
import { saveMessage } from '../saveText';
import { openSaves } from './SavesSheet';
import './newgame.css';

/** Window event that opens the setup screen. The menu fires it after its confirm. */
export const NEW_GAME_EVENT = 'llm:newgame';

export function openNewGame(): void {
  window.dispatchEvent(new Event(NEW_GAME_EVENT));
}

const BOARD_EVENT_LABEL: Record<string, string> = { board_coup: 'Board reviews often' };

/** Short chips for what a scenario changes. */
function ruleChips(sc: ScenarioDef): string[] {
  const r: ScenarioRules = sc.rules;
  const out: string[] = [];
  if (r.noVc) out.push('No VC rounds');
  if (r.noIpo) out.push('No IPO');
  if (r.openOnly) out.push('Open weights only');
  if (sc.doctrine) {
    const focus = doctrineById(sc.doctrine.start)?.name ?? sc.doctrine.start;
    out.push(sc.doctrine.lock ? `Locked to ${focus}` : `Starts on ${focus}`);
  }
  if (r.trainingLockedUntilYear) out.push(`Training locked to ${r.trainingLockedUntilYear}`);
  if (r.hireDaysMult && r.hireDaysMult !== 1) out.push(`Hiring costs x${r.hireDaysMult}`);
  if (r.grantPerMonth) out.push(`Grant ${formatMoney(r.grantPerMonth, 0)} a month`);
  if (r.communityResearch && r.communityResearch !== 1) out.push(`Research x${r.communityResearch}`);
  for (const [id, mult] of Object.entries(r.eventBoost ?? {})) out.push(`${BOARD_EVENT_LABEL[id] ?? 'Events boosted'}${mult !== 1 ? ` x${mult}` : ''}`);
  return out;
}

/** A seed from the text box: digits are used as they are, any other text is hashed, and empty means random. */
export function parseSeed(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return Number(t) % 2 ** 31;
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h % 2 ** 31;
}

const mult = (v: number) => `×${v}`;
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function ScenarioTile({ sc, on, onPick }: { sc: ScenarioDef; on: boolean; onPick: () => void }) {
  const staff = sc.staff ? Object.values(sc.staff).reduce((a, b) => a + (b ?? 0), 0) : null;
  const chips = ruleChips(sc);
  return (
    <button type="button" aria-pressed={on} class={`ng-tile ${on ? 'is-on' : ''}`} onClick={onPick}>
      <span class="ng-tile-head">
        <span class="ng-tile-name">{sc.name}</span>
        <span class="ng-year num">{sc.startYear}</span>
      </span>
      <span class="ng-tile-pitch">{sc.pitch}</span>
      <span class="ng-tile-start small muted">
        <span class="num">{formatMoney(sc.startCash, 0)}</span> start
        {staff !== null && (
          <>
            {' · '}
            <span class="num">{staff}</span> people
          </>
        )}
      </span>
      {sc.goals.length > 0 && (
        <span class="ng-tile-goals">
          {sc.goals.map((g) => (
            <span key={g.id} class="ng-tile-goal small">
              {g.text}
              {g.deadlineYear !== undefined && <span class="num muted"> by {g.deadlineYear}</span>}
            </span>
          ))}
        </span>
      )}
      {chips.length > 0 && (
        <span class="ng-chips">
          {chips.map((c) => (
            <Pill key={c} class="ng-chip">
              {c}
            </Pill>
          ))}
        </span>
      )}
    </button>
  );
}

function DifficultyTile({ id, on, onPick }: { id: DifficultyId; on: boolean; onPick: () => void }) {
  const d = DIFFICULTIES.find((x) => x.id === id)!;
  return (
    <button type="button" aria-pressed={on} class={`ng-tile ng-diff ${on ? 'is-on' : ''}`} onClick={onPick}>
      <span class="ng-tile-head">
        <span class="ng-tile-name">{d.name}</span>
      </span>
      <span class="ng-tile-pitch">{d.pitch}</span>
      <span class="ng-kv">
        <span class="ng-kv-row">
          <span class="ng-kv-k">Start cash</span>
          <span class="num ng-kv-v">{mult(d.startCash)}</span>
        </span>
        <span class="ng-kv-row">
          <span class="ng-kv-k">Rival quality</span>
          <span class="num ng-kv-v">{d.rivalOffset === 0 ? '0 pts' : `${signed(d.rivalOffset)} pts`}</span>
        </span>
        <span class="ng-kv-row">
          <span class="ng-kv-k">Event frequency</span>
          <span class="num ng-kv-v">{mult(d.eventWeight)}</span>
        </span>
        <span class="ng-kv-row">
          <span class="ng-kv-k">Market growth</span>
          <span class="num ng-kv-v">{mult(d.marketGrowth)}</span>
        </span>
        <span class="ng-kv-row">
          <span class="ng-kv-k">VC valuations</span>
          <span class="num ng-kv-v">{mult(d.vcGenerosity)}</span>
        </span>
        <span class="ng-kv-row">
          <span class="ng-kv-k">Victory score</span>
          <span class="num ng-kv-v">{mult(d.scoreMult)}</span>
        </span>
      </span>
    </button>
  );
}

export function NewGame() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scenarioId, setScenarioId] = useState('garage');
  const [difficulty, setDifficulty] = useState<DifficultyId>('founder');
  const [sandbox, setSandbox] = useState(false);
  const [skipTutorial, setSkipTutorial] = useState(false);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(NEW_GAME_EVENT, show);
    // First run (no save yet): pick a start before playing.
    if (FIRST_RUN) setOpen(true);
    return () => window.removeEventListener(NEW_GAME_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  if (!open) return null;

  const sc = SCENARIOS.find((x) => x.id === scenarioId) ?? SCENARIOS[0];
  const midEra = sc.startYear > BALANCE.START_YEAR;
  const diffName = DIFFICULTIES.find((d) => d.id === difficulty)?.name ?? 'Founder';

  const start = () => {
    if (busy) return;
    setBusy(true);
    // Let the button show its busy state first: a mid-era start fast-forwards the world, which takes a moment.
    window.setTimeout(() => {
      const setup: GameSetup = { scenarioId: sc.id, difficulty, sandbox, skipTutorial, startYear: sc.startYear };
      const r = newGame(name.trim() || undefined, parseSeed(seed), setup);
      setBusy(false);
      if (!r.ok) {
        // No room for another save: the company you were running carries on, so this screen stays for a retry.
        setErr(saveMessage(r.error));
        return;
      }
      setErr('');
      setOpen(false);
    }, 30);
  };

  const hasSaves = listSlots().length > 0;

  return (
    <div class="ng-screen" role="dialog" aria-modal="true" aria-labelledby="ng-title">
      <header class="ng-head">
        <div class="ng-head-text">
          <h2 class="ng-title" id="ng-title">
            New game
          </h2>
          <p class="ng-sub small muted">Pick a start. Each choice changes the world, not just the numbers.</p>
        </div>
        <button type="button" class="ng-close" aria-label="Close" onClick={() => !busy && setOpen(false)}>
          ×
        </button>
      </header>

      <div class="ng-wrap">
        <section class="ng-section" aria-labelledby="ng-h-company">
          <h3 class="ng-h" id="ng-h-company">
            Company
          </h3>
          <div class="field">
            <label class="field-label" for="ng-name">
              Company name
            </label>
            <input
              id="ng-name"
              class="input"
              value={name}
              placeholder="Lets Loose Labs"
              maxLength={32}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </div>
        </section>

        <section class="ng-section" aria-labelledby="ng-h-scenario">
          <h3 class="ng-h" id="ng-h-scenario">
            Scenario
          </h3>
          <div class="ng-grid ng-grid-scenarios" role="group" aria-labelledby="ng-h-scenario">
            {SCENARIOS.map((x) => (
              <ScenarioTile key={x.id} sc={x} on={x.id === sc.id} onPick={() => setScenarioId(x.id)} />
            ))}
          </div>
          {midEra && sc.briefing && (
            <div class="ng-briefing">
              <h4 class="ng-h2">Briefing</h4>
              <p>{sc.briefing}</p>
            </div>
          )}
        </section>

        <section class="ng-section" aria-labelledby="ng-h-diff">
          <h3 class="ng-h" id="ng-h-diff">
            Difficulty
          </h3>
          <div class="ng-grid ng-grid-diff" role="group" aria-labelledby="ng-h-diff">
            {DIFFICULTIES.map((d) => (
              <DifficultyTile key={d.id} id={d.id} on={d.id === difficulty} onPick={() => setDifficulty(d.id)} />
            ))}
          </div>
        </section>

        <section class="ng-section" aria-labelledby="ng-h-opts">
          <h3 class="ng-h" id="ng-h-opts">
            Options
          </h3>
          <label class="ng-check">
            <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox((e.target as HTMLInputElement).checked)} />
            <span class="ng-check-text">
              <span>Sandbox</span>
              <span class="small muted">No bankruptcy, no goals.</span>
            </span>
          </label>
          <label class="ng-check">
            <input type="checkbox" checked={skipTutorial} onChange={(e) => setSkipTutorial((e.target as HTMLInputElement).checked)} />
            <span class="ng-check-text">
              <span>Skip tutorial</span>
              <span class="small muted">{midEra ? 'Mid-era starts skip it anyway. You get a briefing on HQ.' : 'No coach marks.'}</span>
            </span>
          </label>
          <div class="field">
            <label class="field-label" for="ng-seed">
              Seed (optional)
            </label>
            <input
              id="ng-seed"
              class="input num"
              value={seed}
              inputMode="numeric"
              placeholder="Random"
              maxLength={12}
              onInput={(e) => setSeed((e.target as HTMLInputElement).value)}
            />
            <span class="field-hint small muted">The same seed and setup give the same world.</span>
          </div>
        </section>
      </div>

      <footer class="ng-footer">
        <div class="ng-summary small">
          <span class="ng-summary-text">
            {sc.name} · <span class="num">{sc.startYear}</span> · {diffName}
            {sandbox ? ' · Sandbox' : ''}
          </span>
          {err && (
            <p class="small bad" role="alert">
              {err}
            </p>
          )}
        </div>
        <div class="ng-actions">
          {hasSaves && (
            <Button
              variant="ghost"
              onClick={() => {
                if (busy) return;
                setOpen(false);
                openSaves();
              }}
            >
              Load a save instead
            </Button>
          )}
          <Button variant="ghost" onClick={() => !busy && setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Start'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
