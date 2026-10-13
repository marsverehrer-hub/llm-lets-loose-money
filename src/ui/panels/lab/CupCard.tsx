// OWNER: MODEL LIFE UI (v15, GAME_DESIGN §25.4). The Arena Cup: the open cup (theme, prize, your entry against the
// rival field) and recent results. Entering happens here or on a model's Career tab.
import type { GameState } from '../../../sim/types';
import { CUP_THEMES, cupThemeLabel, playerCupScore, rivalField } from '../../../sim/systems/tournament';
import { formatMoney } from '../../../sim/util';
import { Card, formatDays, monthYear } from '../../components';
import { dispatch } from '../../store';

const PLACE: Record<number, string> = { 1: 'Won', 2: 'Final', 3: 'Semi', 5: 'Quarter' };

export function CupCard({ s }: { s: GameState }) {
  const cs = s.cup;
  const open = cs?.open;
  const live = s.models.filter((m) => m.releasedDay !== null && !m.deprecated);
  const history = [...(cs?.history ?? [])].reverse().slice(0, 6);
  const hint = open ? CUP_THEMES.find((t) => t.id === open.theme)?.hint : undefined;
  const best = open && live.length > 0 ? [...live].sort((a, b) => playerCupScore(s, b, open.theme) - playerCupScore(s, a, open.theme))[0] : undefined;
  const top = open ? rivalField(s, open.theme)[0] : undefined;
  const paid = open ? s.flags[`cup.paid.${open.edition}`] !== undefined : false;
  return (
    <Card title="Arena Cup" code="CUP" subtitle={open ? `${cupThemeLabel(open.theme)} #${open.edition} · ${formatDays(Math.max(0, open.playDay - s.day))} to play` : cs ? `Next in ${formatDays(Math.max(0, cs.nextAnnounceDay - s.day))}` : undefined}>
      {open ? (
        <div class="cup-open">
          <div class="cup-line">
            <span class="muted small">{hint}</span>
            <span class="num cup-prize">{formatMoney(open.prize)}</span>
          </div>
          {top && (
            <div class="cup-line small">
              <span class="muted">Favourite</span>
              <span>{`${top.name} · ${top.modelName}`}</span>
              <span class="num">{top.score.toFixed(1)}</span>
            </div>
          )}
          {live.length === 0 ? (
            <p class="muted small">Release a model to enter.</p>
          ) : (
            <div class="cup-entry">
              <select
                class="select"
                value={open.entrantModelId ?? ''}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  dispatch({ type: 'enterCup', modelId: v || null });
                }}
              >
                <option value="">{paid ? 'No entry (withdrawn)' : `Not entered · fee ${formatMoney(open.entryFee)}`}</option>
                {live.map((m) => (
                  <option key={m.id} value={m.id}>
                    {`${m.name} · ${playerCupScore(s, m, open.theme).toFixed(1)}`}
                  </option>
                ))}
              </select>
              {best && !open.entrantModelId && (
                <span class="small muted">{`Your best for this theme: ${best.name} (${playerCupScore(s, best, open.theme).toFixed(1)}).`}</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <p class="muted small">A themed tournament every two months. Enter your best model for the theme; prizes pay cash, hype, XP and mastery.</p>
      )}
      {history.length > 0 && (
        <ul class="cup-history">
          {history.map((h) => (
            <li key={h.edition}>
              <span class="muted small">{monthYear(h.day)}</span>
              <span class="cup-h-name">{cupThemeLabel(h.theme)}</span>
              <span class={h.placing === 1 ? 'good' : h.placing ? '' : 'muted'}>{h.placing ? `${PLACE[h.placing] ?? '—'} · ${h.modelName}` : `${h.winner} won`}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
