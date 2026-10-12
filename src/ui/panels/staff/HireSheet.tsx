import { useState } from 'preact/hooks';
import type { GameState, RoleId } from '../../../sim/types';
import { ROLES } from '../../../sim/data/roles';
import { formatMoney } from '../../../sim/util';
import { headcount, marketSalary, officeCapacity, officeTier } from '../../../sim/systems/staff';
import { Button, HelpTip, Sheet, Slider, Tabs, signedMoney } from '../../components';
import { dispatch } from '../../store';
import { hirePreview, teamEffect } from './model';
import { StarCard } from './StarCard';

export type HireTab = 'team' | 'stars';

export interface HireSheetProps {
  s: GameState;
  initialRole: RoleId;
  initialTab: HireTab;
  onClose: () => void;
}

/**
 * The Hire button opens this. Team tab: pick a role, how many, pay level, and a live preview of cost, effect and
 * seats. Stars tab: the candidates on the market. Confirm sends the hire (and the pay change, if you moved it).
 */
export function HireSheet({ s, initialRole, initialTab, onClose }: HireSheetProps) {
  const [tab, setTab] = useState<HireTab>(initialTab);
  const [role, setRole] = useState<RoleId>(initialRole);
  const [count, setCount] = useState(1);
  const [levelPct, setLevelPct] = useState(() => Math.round(s.staff.roles[initialRole].salaryLevel * 100));

  const free = Math.max(0, officeCapacity(s) - headcount(s));
  const n = Math.max(1, Math.min(count, free || 1));
  const roleDef = ROLES.find((r) => r.id === role);
  const curLevel = Math.round(s.staff.roles[role].salaryLevel * 100);
  const pv = hirePreview(s, role, n, levelPct / 100);
  const candidates = s.staff.stars.filter((st) => st.hiredDay === null);
  const office = officeTier(s);
  const cap = officeCapacity(s);
  const roleWord = n === 1 ? roleDef?.name : roleDef?.plural;

  const pickRole = (id: RoleId) => {
    setRole(id);
    setLevelPct(Math.round(s.staff.roles[id].salaryLevel * 100));
  };

  const confirm = () => {
    if (pv.blocked) return;
    dispatch({ type: 'hire', role, count: n });
    if (levelPct !== curLevel) dispatch({ type: 'setSalaryLevel', role, level: levelPct / 100 });
    onClose();
  };

  const footer =
    tab === 'team' ? (
      <Button variant="primary" block disabled={!!pv.blocked} title={pv.blocked ?? undefined} onClick={confirm}>
        Hire {n} {roleWord} · {formatMoney(pv.fee, 1)} fee
      </Button>
    ) : undefined;

  return (
    <Sheet open title="Hire" subtitle={`${office.name} · ${headcount(s)}/${cap} seats`} onClose={onClose} footer={footer} width={560}>
      <div class="sf-sheet">
        <Tabs
          variant="segmented"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'team', label: 'Team' },
            { id: 'stars', label: 'Stars', count: candidates.length },
          ]}
        />

        {tab === 'team' && (
          <>
            <section class="sf-block">
              <h4 class="sf-h">Who</h4>
              <div class="sf-role-grid" role="radiogroup" aria-label="Role">
                {ROLES.map((r) => {
                  const on = r.id === role;
                  const eff = teamEffect(s, r.id);
                  const heads = s.staff.roles[r.id].count + s.staff.stars.filter((st) => st.hiredDay !== null && st.role === r.id).length;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      class={`sf-role-card sf-team--${r.id} ${on ? 'is-sel' : ''}`}
                      onClick={() => pickRole(r.id)}
                    >
                      <span class="sf-role-name">
                        <span class="sf-swatch" aria-hidden="true" />
                        {r.plural}
                      </span>
                      <span class="sf-role-meta num">
                        {heads} on the team · {formatMoney(marketSalary(s, r.id), 0)}/yr market
                      </span>
                      <span class="sf-role-desc">{r.description}</span>
                      <span class="sf-role-eff">{eff.line}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section class="sf-block">
              <h4 class="sf-h">How many</h4>
              <div class="sf-stepper">
                <button
                  type="button"
                  class="btn btn-icon"
                  disabled={n <= 1}
                  aria-label="Hire one fewer"
                  onClick={() => setCount(Math.max(1, n - 1))}
                >
                  −
                </button>
                <span class="sf-stepper-val num" aria-live="polite">
                  {n}
                </span>
                <button
                  type="button"
                  class="btn btn-icon"
                  disabled={free < 1 || n >= free}
                  aria-label="Hire one more"
                  onClick={() => setCount(Math.min(free || 1, n + 1))}
                >
                  +
                </button>
                <span class="sf-faint num">
                  {free} of {cap} seats free
                </span>
              </div>
              {pv.blocked && <div class="sf-banner bad">{pv.blocked}</div>}
            </section>

            <section class="sf-block">
              <h4 class="sf-h">
                Pay <HelpTip>Retention means people staying. Pay above market lifts morale, and morale lifts every team's output. Below 95% of market on average, rivals can poach people, and low morale (under 40) makes it worse.</HelpTip>
              </h4>
              <div class="sf-pay-line">
                <span class="num">{levelPct}% of market</span>
                <span class="sf-faint num">{formatMoney(marketSalary(s, role) * (levelPct / 100), 0)}/yr each</span>
              </div>
              <Slider label={`${roleDef?.plural ?? 'Team'} pay level`} min={80} max={160} step={5} value={levelPct} onChange={setLevelPct} />
              <p class="sf-note">Pay applies to everyone on this team, not only new hires.</p>
            </section>

            <section class="sf-block">
              <h4 class="sf-h">Preview</h4>
              <dl class="sf-preview">
                <div>
                  <dt>Cost per day</dt>
                  <dd class="num">{signedMoney(pv.payDayDelta, 1)}/d</dd>
                </div>
                <div>
                  <dt>Cost per year</dt>
                  <dd class="num">{signedMoney(pv.payYearDelta, 1)}/yr</dd>
                </div>
                <div>
                  <dt>Recruiting fee</dt>
                  <dd class="num">{formatMoney(pv.fee, 1)}, once</dd>
                </div>
                <div>
                  <dt>Effect now</dt>
                  <dd class="num">{pv.before.line}</dd>
                </div>
                <div>
                  <dt>Effect after</dt>
                  <dd class="num">{pv.after.line}</dd>
                </div>
                <div>
                  <dt>Seats left</dt>
                  <dd class="num">
                    {pv.seatsLeft} of {cap}
                  </dd>
                </div>
              </dl>
            </section>
          </>
        )}

        {tab === 'stars' && (
          <section class="sf-block">
            {candidates.length === 0 ? (
              <p class="sf-note">No stars in sight. Candidates appear every 60 to 120 days, and each one leaves after 30 days.</p>
            ) : (
              <>
                <p class="sf-note">Star hires cost five times the normal recruiting fee, and each one takes a seat.</p>
                <div class="sf-stars">
                  {candidates.map((st) => (
                    <StarCard
                      key={st.id}
                      s={s}
                      star={st}
                      canHire={free >= 1}
                      blockedReason="The office is full. Move to a bigger office first."
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
