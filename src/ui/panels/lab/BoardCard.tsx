// OWNER: PROGRESSION UI (v13, GAME_DESIGN §23.2). This quarter's board goals: progress, reward, reroll.
import type { GameState, Objective, ObjectiveReward } from '../../../sim/types';
import { BOARD_TUNING, objectiveProgress, quarterLabel } from '../../../sim/systems/board';
import { formatMoney } from '../../../sim/util';
import { Button, Card, HelpTip, Pill, ProgressBar, formatDays } from '../../components';
import { dispatch } from '../../store';

function rewardText(r: ObjectiveReward): string {
  const parts = [`${r.xp} XP`];
  if (r.cash) parts.push(formatMoney(r.cash));
  if (r.hype) parts.push(`hype +${r.hype}`);
  if (r.rp) parts.push(`${r.rp} RP`);
  return parts.join(' · ');
}

function valueText(o: Objective): string {
  switch (o.kind) {
    case 'revenue':
      return `${formatMoney(o.value)}/d of ${formatMoney(o.target)}/d`;
    case 'users':
      return `${Math.round(o.value).toLocaleString('en-US')} of ${Math.round(o.target).toLocaleString('en-US')}`;
    case 'ship':
      return o.value > 0 ? `best this quarter ${o.value.toFixed(1)}` : 'nothing released yet';
    case 'rank':
      return o.value >= 99 ? 'unranked' : `now #${o.value}`;
    case 'hype':
      return `${Math.round(o.value)} of ${o.target}`;
    case 'runway':
      return o.value >= 999 ? 'profitable' : `${o.value.toFixed(1)} months now`;
    case 'scale':
      return o.value >= o.target ? 'done' : 'not yet';
    default:
      return `${Math.max(0, Math.round(o.value - o.base))} of ${Math.round(o.target - o.base)}`;
  }
}

function confidenceTone(c: number): 'good' | 'bad' | 'muted' {
  return c >= 65 ? 'good' : c < 35 ? 'bad' : 'muted';
}

export function BoardCard({ s }: { s: GameState }) {
  const b = s.board;
  if (!b || b.objectives.length === 0) {
    return (
      <Card title="Board goals" code="BRD">
        <p class="muted small">The board sets this quarter's goals tomorrow morning.</p>
      </Card>
    );
  }
  const left = Math.max(0, b.quarterEnd - s.day);
  const done = b.objectives.filter((o) => o.doneDay !== null).length;
  return (
    <Card
      title="Board goals"
      code="BRD"
      class="board-card"
      subtitle={`${quarterLabel(b.quarterStart)} · ${formatDays(left)} left · ${done}/${b.objectives.length}`}
      actions={
        <span class={`board-conf ${confidenceTone(b.confidence)}`} title="Board confidence moves your valuation by up to 6% either way.">
          Confidence <span class="num">{Math.round(b.confidence)}</span>
        </span>
      }
    >
      <ul class="board-list">
        {b.objectives.map((o) => {
          const isDone = o.doneDay !== null;
          return (
            <li key={o.id} class={`board-goal ${isDone ? 'is-done' : ''} ${o.stretch ? 'is-stretch' : ''}`}>
              <div class="board-goal-head">
                <span class="board-check" aria-hidden="true">{isDone ? '■' : '□'}</span>
                <span class="board-text">{o.text}</span>
                {o.stretch && <Pill tone="warn">Stretch</Pill>}
              </div>
              <ProgressBar value={objectiveProgress(o)} height={6} tone={isDone ? 'good' : 'accent'} />
              <div class="board-goal-foot small">
                <span class="muted">{isDone ? 'Paid' : valueText(o)}</span>
                <span class="board-reward num">{rewardText(o.reward)}</span>
                {!isDone && b.rerolls > 0 && (
                  <Button size="sm" variant="ghost" title="Ask the board for a different goal (once a quarter)" onClick={() => dispatch({ type: 'rerollObjective', objectiveId: o.id })}>
                    Swap
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div class="board-foot small muted">
        Goals pay the day you hit them. A clean sweep pays a bonus.
        <HelpTip>
          {`Each hit raises board confidence by ${BOARD_TUNING.HIT_CONFIDENCE}, each miss lowers it by ${-BOARD_TUNING.MISS_CONFIDENCE}. Confidence moves your valuation between -6% and +6%.`}
        </HelpTip>
      </div>
    </Card>
  );
}
