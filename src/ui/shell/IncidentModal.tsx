import { runIncidentById } from '../../sim/data/runIncidents';
import { incidentHint } from '../../sim/systems/eventDeltas';
import { dispatch, useGame, useGameSelect } from '../store';
import { plain, tdate } from './fmt';

/**
 * Decision dialog for a training-run incident. Shows while training.pendingIncident is set. The run is paused until a
 * choice is made; then the result shows until the player continues. Reuses the event modal classes (shell.css).
 */
export function IncidentModal() {
  // Closed most days: re-renders only when an incident opens or closes.
  const pending = useGameSelect((s) => s.training?.pendingIncident ?? null);
  return pending ? <IncidentBody /> : null;
}

function IncidentBody() {
  const s = useGame();
  const run = s.training;
  const p = run?.pendingIncident;
  if (!run || !p) return null;

  const def = runIncidentById(p.defId);
  const resolved = p.result !== undefined;

  let body = '';
  try {
    body = def ? def.body(s, run) : '';
  } catch {
    body = '';
  }

  return (
    <div class="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="incident-title">
      <div class={`modal event-modal ${resolved || def?.good ? '' : 'modal-danger'}`}>
        <div class="modal-header">
          <h2 class="modal-title">{resolved ? `Result · ${tdate(p.day)}` : `Training incident · ${tdate(p.day)}`}</h2>
        </div>

        <div class="modal-body">
          <div class="event-label">{plain(run.name)}</div>
          <h3 class="event-title" id="incident-title">
            {plain(def?.title ?? 'Something went wrong in the run')}
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
                      available = c.available ? c.available(s, run) : true;
                    } catch {
                      available = false;
                    }
                    const hint = incidentHint(c, s, run);
                    return (
                      <button
                        key={`${def.id}-${i}`}
                        type="button"
                        class="choice"
                        disabled={!available}
                        title={hint ? plain(hint) : undefined}
                        onClick={() => dispatch({ type: 'resolveRunIncident', choice: i })}
                      >
                        <span class="choice-num">{i + 1}</span>
                        <span class="choice-main">
                          <span class="choice-label">{plain(c.label)}</span>
                          {hint && <span class="choice-hint">{plain(hint)}</span>}
                          {!available && <span class="choice-locked">Not possible right now</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div class="small muted">No details loaded for this incident.</div>
              )}
            </>
          )}
        </div>

        {resolved && (
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" onClick={() => dispatch({ type: 'clearRunIncident' })}>
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
