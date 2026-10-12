// OWNER: ONBOARD (v10 agent 7). Headquarters "Rival race": your arena Elo against the top labs, as bars.
import type { GameState } from '../../../sim/types';
import { arenaLeaderboard, type ArenaRow } from '../../../sim/systems/competitors';
import { bestPlayerModel } from '../../../sim/systems/market';
import { provisionalElo } from '../../../sim/systems/lab';
import { BarList, Button, Card, EmptyState } from '../../components';
import type { BarRow } from '../../components';
import { navigate } from '../../nav';

export function RaceCard({ s }: { s: GameState }) {
  const arena = arenaLeaderboard(s);
  // The public sees a provisional rating for your own model until the arena settles (GAME_DESIGN 16.5).
  const best = bestPlayerModel(s);
  const playerElo = best ? provisionalElo(s, best).elo : undefined;
  const rank = arena.findIndex((r) => r.isPlayer) + 1;

  const eloOf = (r: ArenaRow) => (r.isPlayer && playerElo !== undefined ? playerElo : r.elo);
  // The top five labs, plus you if you are not among them.
  const shown = arena.slice(0, 5);
  const me = arena.find((r) => r.isPlayer);
  if (me && !shown.includes(me)) shown.push(me);
  // Bars start from just under the lowest Elo shown, so the gaps read. The format adds the offset back.
  const base = shown.length ? Math.floor(Math.min(...shown.map(eloOf))) - 25 : 0;

  const rows: BarRow[] = shown.map((r) => {
    const d = playerElo === undefined || r.isPlayer ? null : Math.round(r.elo - playerElo);
    return {
      id: r.id,
      label: r.name,
      sub: r.modelName,
      value: eloOf(r) - base,
      me: r.isPlayer,
      color: r.isPlayer ? undefined : r.color,
      extra:
        d === null ? undefined : (
          <span class={`num ${d > 0 ? 'bad' : d < 0 ? 'good' : 'muted'}`} title="Rival Elo minus yours">
            {d > 0 ? '+' : ''}
            {d}
          </span>
        ),
    };
  });

  return (
    <Card
      title="Rival race"
      subtitle={rank > 0 ? `You are #${rank} of ${arena.length}` : 'Not on the board yet'}
      actions={
        <Button variant="ghost" size="sm" onClick={() => navigate('market')}>
          Market
        </Button>
      }
    >
      {arena.length > 0 ? (
        <BarList rows={rows} format={(v) => String(Math.round(v + base))} />
      ) : (
        <EmptyState title="Arena empty" text="Release a model to get on the board." />
      )}
    </Card>
  );
}
