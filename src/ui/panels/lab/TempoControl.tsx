// OWNER: PROGRESSION UI (v13, GAME_DESIGN §23.3). Careful / Standard / Crunch for the live run, with the ETA each gives.
import type { GameState } from '../../../sim/types';
import { TEMPOS, liveRunEta, tempoOf } from '../../../sim/systems/tempo';
import { formatDays } from '../../components';
import { dispatch } from '../../store';

export function TempoControl({ s, compact }: { s: GameState; compact?: boolean }) {
  const run = s.training;
  if (!run) return null;
  const current = tempoOf(run);
  return (
    <div class={`tempo ${compact ? 'tempo-compact' : ''}`} role="group" aria-label="Run tempo">
      {TEMPOS.map((t) => {
        const eta = liveRunEta(s, run, t.id);
        const title = `${t.label}: ${t.hint}. ETA ${Number.isFinite(eta) ? formatDays(eta) : 'stalled'}.`;
        return (
          <button
            key={t.id}
            type="button"
            class={`seg tempo-${t.id} ${current === t.id ? 'active' : ''}`}
            title={title}
            aria-pressed={current === t.id}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'setRunTempo', tempo: t.id });
            }}
          >
            {t.label}
            {!compact && <span class="tempo-eta num">{Number.isFinite(eta) ? formatDays(eta) : '—'}</span>}
          </button>
        );
      })}
    </div>
  );
}
