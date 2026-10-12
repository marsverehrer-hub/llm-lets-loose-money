import { EVENTS } from '../../sim/data/events';
import { eventHint } from '../../sim/systems/eventDeltas';
import { dispatch, useGame, useGameSelect } from '../store';
import { plain, tdate } from './fmt';

/**
 * Decision dialog. Shows while events.pending is set. The sim is paused until a
 * choice is made; then the outcome text is shown until the player continues.
 * Event icons are never rendered (terminal theme).
 */
export function EventModal() {
  // Closed most days: this wrapper re-renders only when a decision opens or closes, not on every tick.
  const pending = useGameSelect((s) => s.events.pending ?? null);
  return pending ? <EventBody /> : null;
}

function EventBody() {
  const s = useGame();
  const p = s.events.pending;
  if (!p) return null;

  const def = EVENTS.find((e) => e.id === p.defId);
  const resolved = p.result !== undefined;

  let body = '';
  try {
    body = def ? def.body(s) : '';
  } catch {
    body = '';
  }

  return (
    <div class="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="event-title">
      <div class={`modal event-modal ${resolved ? '' : 'modal-danger'}`}>
        <div class="modal-header">
          <h2 class="modal-title">{resolved ? `Outcome · ${tdate(p.day)}` : `Breaking · ${tdate(p.day)}`}</h2>
        </div>

        <div class="modal-body">
          <h3 class="event-title" id="event-title">
            {plain(def?.title ?? 'Something happened')}
          </h3>

          {resolved ? (
            <>
              <div class="event-label">Result</div>
              <p class="event-result">{plain(p.result ?? '')}</p>
              {p.deltas && p.deltas.length > 0 && (
                <ul class="event-deltas" aria-label="What changed">
                  {p.deltas.map((d, i) => (
                    <li key={`${d.label}-${i}`} class="event-delta">
                      <span class="event-delta-label">{plain(d.label)}</span>
                      <span class="event-delta-value">{plain(d.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              {body && <p class="event-body">{plain(body)}</p>}
              {def ? (
                <div class="choices">
                  {def.choices.map((c, i) => {
                    let available = true;
                    try {
                      available = c.available ? c.available(s) : true;
                    } catch {
                      available = false;
                    }
                    const hint = eventHint(c, s);
                    return (
                      <button
                        key={`${def.id}-${i}`}
                        type="button"
                        class="choice"
                        disabled={!available}
                        onClick={() => dispatch({ type: 'resolveEvent', choice: i })}
                      >
                        <span class="choice-num">{i + 1}</span>
                        <span class="choice-main">
                          <span class="choice-label">{plain(c.label)}</span>
                          {hint && <span class="choice-hint">{plain(hint)}</span>}
                          {!available && <span class="choice-locked">Not available right now</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div class="small muted">No details loaded for this event. Carry on.</div>
              )}
            </>
          )}
        </div>

        {(resolved || !def) && (
          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => (resolved ? dispatch({ type: 'clearEventResult' }) : dispatch({ type: 'resolveEvent', choice: 0 }))}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
