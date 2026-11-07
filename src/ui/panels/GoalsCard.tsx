// OWNER: SCENARIO. Headquarters "Goals" card (GAME_DESIGN §20.1). Shown only when the scenario has goals (not a sandbox).
import { useState } from 'preact/hooks';
import { BALANCE } from '../../sim/balance';
import { doctrineById } from '../../sim/data/doctrines';
import { scenarioById } from '../../sim/data/scenarios';
import { guidanceTarget } from '../../sim/systems/board';
import { PLAYER_PLANS, planStanding } from '../../sim/systems/playerPlans';
import { thesisGoals, thesisMet } from '../../sim/systems/thesis';
import { scenarioScore } from '../../sim/systems/scenario';
import type { GuidanceLevel, PlayerPlanId } from '../../sim/types';
import { calendarYear, formatMoney } from '../../sim/util';
import { Button, Card, Pill, Select, formatInt } from '../components';
import { dispatch, useGame } from '../store';
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

const PLAN_OPTIONS = (Object.keys(PLAYER_PLANS) as PlayerPlanId[]).map((id) => ({ value: id, label: PLAYER_PLANS[id].name }));
const GUIDANCE_OPTIONS: { value: GuidanceLevel; label: string }[] = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'in_line', label: 'In line' },
  { value: 'aggressive', label: 'Aggressive' },
];

/** v22: the year's plan and, once public, this quarter's earnings guidance (systems/playerPlans.ts, systems/board.ts). */
export function PlanCard() {
  const s = useGame();
  const [pick, setPick] = useState<PlayerPlanId>('ship_twice');
  const year = calendarYear(s.day);
  const plan = s.playerPlan;
  const current = plan?.year === year ? plan : undefined;
  const standing = current ? planStanding(s, current.id, s.annualLedger) : null;
  const b = s.board;
  const g = b?.guidance;
  const soFar = g ? s.stats.totalRevenue - g.revenueAt : 0;

  return (
    <Card title="Plan and guidance" subtitle={`${year}`}>
      {current && standing ? (
        <>
          <p class="small">
            <strong>{PLAYER_PLANS[current.id].name}.</strong> {PLAYER_PLANS[current.id].promise}
          </p>
          <p class="small muted">
            {progressText(current.id, standing.value)} <Pill tone={standing.met ? 'good' : 'default'}>{standing.met ? 'Met so far' : 'Open'}</Pill>
          </p>
        </>
      ) : (
        <div class="plan-pick">
          <Select value={pick} onChange={(v) => setPick(v as PlayerPlanId)} options={PLAN_OPTIONS} ariaLabel="Plan for the year" />
          <Button size="sm" variant="primary" onClick={() => dispatch({ type: 'announcePlan', planId: pick })}>
            Announce {year} plan
          </Button>
          <p class="small muted">{PLAYER_PLANS[pick].promise} Judged on 1 January.</p>
        </div>
      )}
      {plan && plan.year < year && plan.kept !== undefined && (
        <p class="small muted">
          {plan.year}: {PLAYER_PLANS[plan.id].name}, {plan.kept ? 'kept' : 'broken'}.
        </p>
      )}
      {s.company.isPublic && b && (
        <div class="plan-guide">
          <p class="small">
            <strong>Earnings guidance</strong>
          </p>
          {g ? (
            <>
              <Select value={g.level} onChange={(v) => dispatch({ type: 'setGuidance', level: v as GuidanceLevel })} options={GUIDANCE_OPTIONS} ariaLabel="Earnings guidance" />
              <p class="small muted">
                Target <span class="num">{formatMoney(guidanceTarget(b, g))}</span> revenue this quarter. So far <span class="num">{formatMoney(soFar)}</span>.
              </p>
            </>
          ) : (
            <p class="small muted">Guidance opens at the start of each quarter once the lab is public.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function progressText(id: PlayerPlanId, value: number): string {
  switch (id) {
    case 'ship_twice':
      return `${value} of 2 models shipped so far.`;
    case 'profitable':
      return value >= 0 ? `${formatMoney(value)} profit so far.` : `${formatMoney(-value)} loss so far.`;
    case 'open_weights':
      return `${value} open-weights release${value === 1 ? '' : 's'} so far.`;
    case 'top3':
      return value >= 99 ? 'Not ranked in the Arena yet.' : `Best Arena rank so far: #${value}.`;
  }
}
