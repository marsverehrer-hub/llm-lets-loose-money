// OWNER: MODEL LIFE UI (v15, GAME_DESIGN §25). Career tab: what a model does after launch day. Mastery from the users
// it serves, patches from their feedback, the Arena Cup, and retirement into the Hall of Fame.
import { dispatch } from '../../store';
import { formatMoney } from '../../../sim/util';
import type { GameState, Model } from '../../../sim/types';
import {
  MODEL_LIFE_TUNING,
  PATCH_FOCI,
  feedbackFactor,
  honorsOf,
  masteryAppeal,
  masteryName,
  masteryOf,
  masteryProgress,
  patchBlocker,
  patchCost,
  patchGain,
  retireBlocker,
  usersServedBy,
  versionLabel,
} from '../../../sim/systems/modelLife';
import { cupThemeLabel, playerCupScore, rivalField } from '../../../sim/systems/tournament';
import { Pill, ProgressBar, Stat, formatCount, formatDays } from '../../components';
import { ArmButton, Section } from './parts';

export function CareerTab({ s, m }: { s: GameState; m: Model }) {
  return (
    <div class="mpg-cols">
      <div class="mpg-col">
        <Section title="Mastery" aside={<Pill tone={masteryOf(m).level >= 4 ? 'milestone' : 'muted'}>{masteryName(masteryOf(m).level)}</Pill>}>
          <MasteryBlock s={s} m={m} />
        </Section>
        <Section title="Patches" aside={<span class="num">{versionLabel(m)}</span>}>
          <PatchBlock s={s} m={m} />
        </Section>
      </div>
      <div class="mpg-col">
        <Section title="Arena Cup">
          <CupBlock s={s} m={m} />
        </Section>
        <Section title="Retirement">
          <RetireBlock s={s} m={m} />
        </Section>
      </div>
    </div>
  );
}

function MasteryBlock({ s, m }: { s: GameState; m: Model }) {
  const st = masteryOf(m);
  const pr = masteryProgress(m);
  const users = usersServedBy(s, m.id);
  return (
    <div class="mpg-stack">
      <ProgressBar
        value={pr.frac}
        tone="good"
        height={8}
        label={`Level ${st.level} of 5`}
        right={st.level >= 5 ? 'Max' : `${Math.floor(pr.into)} / ${pr.need} XP`}
      />
      <div class="mpg-stats">
        <Stat label="Buyer appeal" value={`+${Math.round((masteryAppeal(m) - 1) * 100)}%`} hint="In every product it serves" size="sm" />
        <Stat label="Users served" value={formatCount(users)} hint="Each day of service earns field XP" size="sm" />
      </div>
      <span class="mpg-desc">
        Models earn experience from the users and contracts they serve, and from Arena Cups. Each level makes buyers like it a little more. Level 3 and up earns a Hall of Fame slot at retirement.
      </span>
    </div>
  );
}

function PatchBlock({ s, m }: { s: GameState; m: Model }) {
  if (m.patchJob) {
    const left = Math.max(0, m.patchJob.doneDay - s.day);
    return (
      <div class="mpg-stack">
        <span class="mpg-label">{`${m.patchJob.focus} patch in progress`}</span>
        <ProgressBar value={1 - left / MODEL_LIFE_TUNING.PATCH_DAYS} height={6} right={`${formatDays(left)} left`} />
      </div>
    );
  }
  const why = patchBlocker(s, m);
  const gain = patchGain(s, m);
  const fb = feedbackFactor(s, m);
  return (
    <div class="mpg-stack">
      <div class="mpg-stats">
        <Stat label="Next patch" value={`+${gain.toFixed(1)}`} hint="Cap points to the focus" size="sm" />
        <Stat label="Feedback" value={`${Math.round(fb * 100)}%`} hint="More users, better patches" size="sm" />
        <Stat label="Cost" value={formatMoney(patchCost(s, m))} hint={`${MODEL_LIFE_TUNING.PATCH_DAYS} days, no training slot`} size="sm" />
      </div>
      <div class="career-foci" role="group" aria-label="Patch focus">
        {PATCH_FOCI.map((f) => (
          <button
            key={f.id}
            type="button"
            class="btn btn-sm"
            disabled={!!why}
            title={why ?? `Patch ${m.name} for ${f.label.toLowerCase()}`}
            onClick={() => dispatch({ type: 'patchModel', modelId: m.id, focus: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span class="mpg-desc">
        {why ?? `Each patch adds less than the last (${MODEL_LIFE_TUNING.MAX_PATCHES} at most), and about one in seven forgets something elsewhere.`}
      </span>
    </div>
  );
}

function CupBlock({ s, m }: { s: GameState; m: Model }) {
  const open = s.cup?.open;
  const record = (m.cupWins ?? 0) > 0 ? `${m.cupWins} win${m.cupWins === 1 ? '' : 's'}` : m.cupBest ? `Best: ${m.cupBest === 2 ? 'final' : m.cupBest === 3 ? 'semi-final' : 'quarter-final'}` : 'No cups yet';
  if (!open) {
    const next = s.cup ? Math.max(0, s.cup.nextAnnounceDay - s.day) : null;
    return (
      <div class="mpg-stack">
        <span class="mpg-label">{record}</span>
        <span class="mpg-desc">{next !== null ? `The next cup is announced in ${formatDays(next)}.` : 'The first cup is announced soon.'}</span>
      </div>
    );
  }
  const entered = open.entrantModelId === m.id;
  const live = m.releasedDay !== null && !m.deprecated;
  const mine = live ? playerCupScore(s, m, open.theme) : 0;
  const field = rivalField(s, open.theme).slice(0, 3);
  const paid = s.flags[`cup.paid.${open.edition}`] !== undefined;
  return (
    <div class="mpg-stack">
      <div class="mpg-row-between mpg-wrap">
        <span class="mpg-label">{`${cupThemeLabel(open.theme)} #${open.edition}`}</span>
        <span class="num">{`${formatMoney(open.prize)} prize · ${formatDays(Math.max(0, open.playDay - s.day))} to play`}</span>
      </div>
      <ul class="career-field">
        {live && (
          <li class="is-me">
            <span>{m.name}</span>
            <span class="num">{mine.toFixed(1)}</span>
          </li>
        )}
        {field.map((e) => (
          <li key={e.owner}>
            <span>{`${e.name} · ${e.modelName}`}</span>
            <span class="num">{e.score.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <div class="mpg-row-between mpg-wrap">
        <span class="mpg-desc">{`${record}. Eight seats, single elimination; a higher score wins more often, not always.`}</span>
        {entered ? (
          <button type="button" class="btn btn-sm" onClick={() => dispatch({ type: 'enterCup', modelId: null })}>
            Withdraw
          </button>
        ) : (
          <button
            type="button"
            class="btn btn-sm btn-primary"
            disabled={!live}
            title={live ? undefined : 'Only released, active models can enter'}
            onClick={() => dispatch({ type: 'enterCup', modelId: m.id })}
          >
            {paid ? 'Enter instead' : `Enter (${formatMoney(open.entryFee)})`}
          </button>
        )}
      </div>
    </div>
  );
}

function RetireBlock({ s, m }: { s: GameState; m: Model }) {
  if (m.retiredDay !== undefined) {
    const hall = (s.hallOfFame ?? []).find((e) => e.modelId === m.id);
    return <span class="mpg-desc">{hall ? `Retired into the Hall of Fame: ${hall.honors.join(', ')}.` : 'Retired.'}</span>;
  }
  const why = retireBlocker(s, m);
  const honors = honorsOf(s, m);
  return (
    <div class="mpg-stack">
      <span class="mpg-desc">
        {honors.length > 0
          ? `Hall of Fame on retirement: ${honors.join(', ')}. Each entry adds a little brand and valuation for good.`
          : 'No Hall of Fame slot yet: reach mastery 3, win a cup or hold a crown first.'}
      </span>
      {why ? (
        <span class="mpg-desc">{why}.</span>
      ) : (
        <div class="career-retire">
          <ArmButton label="Retire" confirmLabel="Confirm retire" onConfirm={() => dispatch({ type: 'retireModel', modelId: m.id })} />
          <ArmButton
            label="Retire as open weights"
            confirmLabel="Confirm: release weights"
            title="Brand and reputation up, and rivals learn from it"
            onConfirm={() => dispatch({ type: 'retireModel', modelId: m.id, openWeights: true })}
          />
        </div>
      )}
    </div>
  );
}
