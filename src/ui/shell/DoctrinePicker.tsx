// OWNER: DOCTRINE. v8 lab doctrine picker (GAME_DESIGN §19.1). Opens by itself once the tutorial is over and no focus is set,
// and whenever the `llm:doctrine` window event fires (Headquarters "Choose" / "Change").
import { useEffect, useState } from 'preact/hooks';
import type { DoctrineId } from '../../sim/types';
import { DOCTRINES, DOCTRINE_CHANGE_COST, DOCTRINE_COOLDOWN, doctrineById } from '../../sim/data/doctrines';
import { doctrineCooldownLeft } from '../../sim/systems/doctrine';
import { Button, Modal } from '../components';
import { useLobbyOpen } from '../mp/lobbyState';
import { TUTORIAL_STEPS } from '../tutorial/Tutorial';
import { dispatch, useGame } from '../store';
import './doctrine.css';

/** Window event that opens the picker in change mode. Headquarters fires it. */
export const DOCTRINE_EVENT = 'llm:doctrine';
/** "Decide later" hides the automatic picker for this many in-game days. */
export const DOCTRINE_SNOOZE_DAYS = 90;
const SNOOZE_KEY = 'llm-lets-loose-money/doctrine-snooze';

/** The in-game day the player snoozed on, or null. Storage can be blocked, so every access is guarded. */
function readSnooze(): number | null {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    const day = raw === null ? NaN : Number(raw);
    return Number.isFinite(day) ? day : null;
  } catch {
    return null;
  }
}

function writeSnooze(day: number): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(day));
  } catch {
    // Private windows and blocked storage: the snooze then lasts for this page only.
  }
}

export function DoctrinePicker() {
  const s = useGame();
  const lobbyOpen = useLobbyOpen();
  const [forced, setForced] = useState(false);
  const [snoozedDay, setSnoozedDay] = useState<number | null>(() => readSnooze());
  const [pick, setPick] = useState<DoctrineId | null>(null);

  useEffect(() => {
    const onRequest = () => setForced(true);
    window.addEventListener(DOCTRINE_EVENT, onRequest);
    return () => window.removeEventListener(DOCTRINE_EVENT, onRequest);
  }, []);

  const current = doctrineById(s.company.doctrine);
  const tutorialDone = s.tutorialStep === -1 || s.tutorialStep >= TUTORIAL_STEPS;
  // A snooze from an older game (day numbers restart at 0) must not hide the picker, so only count it if it is not ahead of today.
  const snoozed = snoozedDay !== null && snoozedDay <= s.day && s.day < snoozedDay + DOCTRINE_SNOOZE_DAYS;
  // Incidents live on the training run (IncidentModal reads s.training.pendingIncident).
  const blocked = !!(s.pendingReveal || s.pendingMoment || s.training?.pendingIncident || s.events.pending || s.gameOver || lobbyOpen);
  const auto = !current && tutorialDone && !snoozed && !s.mp;
  const open = !blocked && (forced || auto);

  const cooldownLeft = doctrineCooldownLeft(s);
  const canChange = !current || cooldownLeft === 0;
  const chosen = pick ? doctrineById(pick) : undefined;

  const closeForced = () => {
    setForced(false);
    setPick(null);
  };
  const decideLater = () => {
    writeSnooze(s.day);
    setSnoozedDay(s.day);
    closeForced();
  };
  const commit = () => {
    if (!pick || !canChange) return;
    dispatch({ type: 'setDoctrine', doctrine: pick });
    closeForced();
  };

  return (
    <Modal
      open={open}
      class="dp-modal"
      width={760}
      title={current ? 'Change lab focus' : 'Choose a lab focus'}
      onClose={forced ? closeForced : undefined}
      footer={
        <>
          {current ? (
            <Button variant="ghost" onClick={closeForced}>
              Keep {current.name}
            </Button>
          ) : (
            <button type="button" class="dp-link" onClick={decideLater}>
              Decide later
            </button>
          )}
          <Button variant="primary" disabled={!chosen || !canChange} onClick={commit} title={!canChange ? `Can change in ${cooldownLeft} days` : undefined}>
            Commit to this
          </Button>
        </>
      }
    >
      {current ? (
        <p class="dp-cost">
          {cooldownLeft > 0 ? (
            <span class="dp-cost-warn">
              Focus can change in <span class="num">{cooldownLeft}</span> days. Each change waits {DOCTRINE_COOLDOWN} days after the last pick.
            </span>
          ) : (
            <>
              Changing focus costs <span class="num">−{DOCTRINE_CHANGE_COST.hype}</span> hype and <span class="num">−{DOCTRINE_CHANGE_COST.morale}</span>{' '}
              morale. Hype is <span class="num">{Math.round(s.company.hype)}</span>, morale <span class="num">{Math.round(s.staff.morale)}</span>.
            </>
          )}
        </p>
      ) : (
        <p class="dp-intro">
          Pick one strategy. Nothing is pre-selected. The first pick is free; changing later waits {DOCTRINE_COOLDOWN} days and costs{' '}
          <span class="num">−{DOCTRINE_CHANGE_COST.hype}</span> hype and <span class="num">−{DOCTRINE_CHANGE_COST.morale}</span> morale.
        </p>
      )}

      <div class="dp-grid" role="radiogroup" aria-label="Lab focus">
        {DOCTRINES.map((d) => {
          const isCurrent = current?.id === d.id;
          const selected = pick === d.id;
          const select = () => {
            if (!isCurrent) setPick(d.id);
          };
          return (
            <div
              key={d.id}
              class="dp-tile"
              role="radio"
              aria-checked={selected}
              aria-disabled={isCurrent}
              tabIndex={0}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select();
                }
              }}
            >
              <span class="dp-tile-name">{d.name}</span>
              <span class="dp-tile-tag">{d.tagline}</span>
              <ul class="dp-list dp-perks">
                {d.perks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <ul class="dp-list dp-drawbacks">
                {d.drawbacks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {isCurrent && <span class="dp-tile-now">Current focus</span>}
            </div>
          );
        })}
      </div>

      <div class="dp-detail" aria-live="polite">
        {chosen ? (
          <>
            <div class="dp-detail-name">{chosen.name}</div>
            <div>{chosen.description}</div>
          </>
        ) : (
          <div class="dp-muted">Select a focus to read the details. Perks are green, drawbacks are red.</div>
        )}
      </div>
    </Modal>
  );
}
