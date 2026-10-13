// OWNER: MODEL LIFE UI (v15, GAME_DESIGN §25.3). Hall of Fame: retired models remembered for their careers.
import type { GameState } from '../../../sim/types';
import { HALL_TUNING, countedHall, hallBonuses } from '../../../sim/systems/hallOfFame';
import { masteryName } from '../../../sim/systems/modelLife';
import { Card, monthYear } from '../../components';

export function HallCard({ s }: { s: GameState }) {
  const all = s.hallOfFame ?? [];
  const counted = new Set(countedHall(s).map((e) => e.modelId));
  const b = hallBonuses(s);
  return (
    <Card
      title="Hall of Fame"
      code="HOF"
      subtitle={all.length ? `${all.length} model${all.length === 1 ? '' : 's'} · brand x${(b.brand ?? 1).toFixed(2)} · valuation x${(b.valuation ?? 1).toFixed(2)}` : undefined}
    >
      {all.length === 0 ? (
        <p class="muted small">
          Retire a model with a career (mastery 3+, a cup win or a crown) from its Career tab. Each entry adds a little brand and valuation for good; the best {HALL_TUNING.CAP} count.
        </p>
      ) : (
        <ul class="hof-list">
          {[...all].reverse().map((e) => (
            <li key={e.modelId} class={counted.has(e.modelId) ? '' : 'is-faded'}>
              <span class="hof-name">{e.name}</span>
              <span class="small muted">{`${masteryName(e.mastery)} · ${Math.round(e.overall)} overall · ${monthYear(e.retiredDay)}${e.open ? ' · open weights' : ''}`}</span>
              <span class="small">{e.honors.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
