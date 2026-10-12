import type { GameState, RoleId } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { Button, HelpTip, Pill, ProgressBar, Slider } from '../../components';
import { dispatch } from '../../store';
import { UNDERPAID_BELOW, POACH_MORALE_BELOW, effectSentence, teamEffect, type TeamStat } from './model';
import { StarCard } from './StarCard';

export interface TeamCardProps {
  s: GameState;
  team: TeamStat;
  selected: boolean;
  onToggle: () => void;
  onHire: (id: RoleId) => void;
}

const SKILL_MAX = 1.5;

/**
 * One team in the roster. The header always shows headcount, pay and the skill bar; the effect line is the plain
 * "what they do for you" sentence with the sim's number. Selecting the card opens its detail (pay and fire).
 */
export function TeamCard({ s, team, selected, onToggle, onHire }: TeamCardProps) {
  const eff = teamEffect(s, team.id);
  const morale = s.staff.morale;
  const underpaid = team.count > 0 && team.level < UNDERPAID_BELOW;
  const poaching = team.heads > 0 && morale < POACH_MORALE_BELOW;
  const levelPct = Math.round(team.level * 100);
  const headsWord = team.heads === 1 ? 'person' : 'people';

  return (
    <section class={`sf-team-card sf-team-card--${team.id} ${selected ? 'is-open' : ''}`}>
      <button type="button" class="sf-team-head" aria-expanded={selected} onClick={onToggle}>
        <span class="sf-swatch" aria-hidden="true" />
        <span class="sf-team-name">{team.role.plural}</span>
        <span class="sf-team-heads num">
          {team.heads} {headsWord}
        </span>
        <span class="sf-team-pay num">{formatMoney(team.payDay, 1)}/d</span>
        <span class="sf-caret" aria-hidden="true">{selected ? '▾' : '▸'}</span>
      </button>

      <div class="sf-team-body">
        <div class="sf-skill">
          <span class="sf-lbl">
            Skill
            <HelpTip>
              How good the average person on this team is. 1.00 is typical. Output scales with skill times morale.
            </HelpTip>
          </span>
          <ProgressBar value={team.skill} max={SKILL_MAX} height={6} tone="info" right={team.count > 0 ? team.skill.toFixed(2) : '—'} />
        </div>

        <p class="sf-effect">
          <span class="sf-effect-main">{effectSentence(team, eff)}</span>
          {eff.extra && <span class="sf-effect-extra">{eff.extra}</span>}
        </p>

        {(underpaid || poaching) && (
          <div class="sf-tags">
            {underpaid && <Pill tone="warn">Below market pay</Pill>}
            {poaching && <Pill tone="bad">Poaching risk</Pill>}
          </div>
        )}

        {team.stars.length > 0 && (
          <div class="sf-stars">
            {team.stars.map((st) => (
              <StarCard key={st.id} s={s} star={st} />
            ))}
          </div>
        )}

        {selected && (
          <div class="sf-detail">
            <div class="sf-kv">
              <div class="sf-kv-row">
                <span class="sf-lbl">Market pay</span>
                <span class="num">{formatMoney(team.market, 0)}/yr each</span>
              </div>
              <div class="sf-kv-row">
                <span class="sf-lbl">
                  Pay level
                  <HelpTip>
                    Staff compare pay with the market. Above market lifts morale, and so output. Below 95% on
                    average, rivals can poach people.
                  </HelpTip>
                </span>
                <span class="num">{levelPct}% of market</span>
              </div>
            </div>
            <Slider
              label={`${team.role.plural} pay level`}
              min={80}
              max={160}
              step={5}
              value={levelPct}
              onChange={(v) => dispatch({ type: 'setSalaryLevel', role: team.id, level: v / 100 })}
            />
            <div class="sf-actions">
              <Button size="sm" variant="primary" onClick={() => onHire(team.id)}>
                Hire into {team.role.plural}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={team.count < 1}
                title={team.count < 1 ? 'No ordinary staff to let go' : 'Let go 1 person from this team'}
                onClick={() => dispatch({ type: 'fire', role: team.id, count: 1 })}
              >
                Fire 1
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={team.count < 1}
                title={team.count < 1 ? 'No ordinary staff to let go' : `Let go ${Math.min(5, team.count)} people from this team`}
                onClick={() => dispatch({ type: 'fire', role: team.id, count: 5 })}
              >
                Fire {Math.min(5, Math.max(1, team.count))}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
