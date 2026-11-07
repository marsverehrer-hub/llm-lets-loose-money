// OWNER: SCENARIO. Headquarters "Goals" card (GAME_DESIGN §20.1). Shown only when the scenario has goals (not a sandbox).
import { BALANCE } from '../../sim/balance';
import { doctrineById } from '../../sim/data/doctrines';
import { scenarioById } from '../../sim/data/scenarios';
import { thesisGoals, thesisMet } from '../../sim/systems/thesis';
import { scenarioScore } from '../../sim/systems/scenario';
import { calendarYear } from '../../sim/util';
import { Card, Pill, formatInt } from '../components';
import { useGame } from '../store';
import '../shell/newgame.css';

export function GoalsCard() {
  const s = useGame();
  if (!s.goals || s.goals.length === 0) return null;

  const sc = scenarioById(s.setup?.scenarioId);
  const won = s.flags['scenario.won'] !== undefined;
  const failed = s.goals.some((g) => g.failedDay !== null);
  const startYear = s.setup?.startYear ?? BALANCE.START_YEAR;
  const midEra = startYear > BALANCE.START_YEAR;
  const inFirstMonths = calendarYear(s.day) - startYear < 1;
  const doneCount = s.goals.filter((g) => g.doneDay !== null).length;

  const status = won ? (
    <Pill tone="good">Complete</Pill>
  ) : failed ? (
    <Pill tone="bad">Sandbox</Pill>
  ) : (
    <Pill tone="info">
      {doneCount} of {s.goals.length}
    </Pill>
  );

  return (
    <Card title="Goals" subtitle={sc.name} actions={status}>
      {midEra && sc.briefing && (
        <details class="ng-brief" open={inFirstMonths}>
          <summary>Briefing</summary>
          <p>{sc.briefing}</p>
        </details>
      )}
      <ul class="ng-goal-list">
        {s.goals.map((g) => {
          const def = sc.goals.find((d) => d.id === g.id);
          const state = g.doneDay !== null ? 'done' : g.failedDay !== null ? 'failed' : 'open';
          const tone = state === 'done' ? 'good' : state === 'failed' ? 'bad' : 'default';
          const label = state === 'done' ? 'Done' : state === 'failed' ? 'Missed' : 'Open';
          return (
            <li key={g.id} class={`ng-goal ng-goal-${state}`}>
              <Pill tone={tone}>{label}</Pill>
              <div class="ng-goal-body">
                <span class="ng-goal-text">{g.text}</span>
                <span class="ng-goal-meta">
                  {state === 'done' ? (
                    <>
                      Met in <span class="num">{calendarYear(g.doneDay ?? s.day)}</span>
                    </>
                  ) : def ? (
                    def.progress(s)
                  ) : (
                    ''
                  )}
                  {g.deadlineYear !== undefined && state === 'open' && (
                    <>
                      {' · by '}
                      <span class="num">{g.deadlineYear}</span>
                    </>
                  )}
                  {g.deadlineYear === undefined && state === 'open' && ' · no deadline'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {won && (
        <p class="small muted">
          Score <span class="num">{formatInt(scenarioScore(s).score)}</span>. You can keep playing.
        </p>
      )}
    </Card>
  );
}

/** Compact progress figure: 1.2T, 340M, 42. */
function shortNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return formatInt(v);
}

/** v20: the lab focus's thesis goals (systems/thesis.ts). Mounted beside GoalsCard in the advisor popover. */
export function ThesisCard() {
  const s = useGame();
  const goals = thesisGoals(s);
  if (goals.length === 0) return null;
  const met = thesisMet(s);

  return (
    <Card title="Thesis" subtitle={doctrineById(s.company.doctrine)?.name} actions={<Pill tone={met === goals.length ? 'good' : 'info'}>{met} of {goals.length}</Pill>}>
      <ul class="ng-goal-list">
        {goals.map(({ def, done, progress }) => (
          <li key={def.id} class={`ng-goal ng-goal-${done !== null ? 'done' : 'open'}`}>
            <Pill tone={done !== null ? 'good' : 'default'}>{done !== null ? 'Done' : 'Open'}</Pill>
            <div class="ng-goal-body">
              <span class="ng-goal-text">{def.text}</span>
              <span class="ng-goal-meta">
                {done !== null ? (
                  <>
                    Met in <span class="num">{calendarYear(done)}</span>
                  </>
                ) : progress ? (
                  <>
                    <span class="num">{shortNum(progress.value)}</span> of <span class="num">{shortNum(progress.target)}</span>
                  </>
                ) : (
                  ''
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
