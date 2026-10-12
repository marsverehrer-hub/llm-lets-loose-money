import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { formatMoney } from '../../sim/util';
import { dailyPayroll, headcount, moraleFactor, officeCapacity, officeTier } from '../../sim/systems/staff';
import { OFFICE_TIERS } from '../../sim/data/roles';
import type { RoleId } from '../../sim/types';
import { Button, Card, HelpTip, PanelHeader, PanelIntro, ProgressBar } from '../components';
import { TeamCard } from './staff/TeamCard';
import { HireSheet, type HireTab } from './staff/HireSheet';
import { NextOfficeButton } from './staff/OfficeSheet';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createDepartments, CAM as DEPT_CAM } from '../../scenes/staff';
import { moraleTone, peoplePerGlyph, retention, teamStats } from './staff/model';
import './staff/staff.css';

type SheetState = { kind: 'hire'; role: RoleId; tab: HireTab } | { kind: 'office' } | null;

const money = (v: number) => formatMoney(v, 1);

const MORALE_HELP =
  "Morale is how happy your staff are, from 0 to 100. Every team's output is multiplied by 0.6 to 1.4 depending on it. Pay at market keeps it near 50. Under 40, rivals start poaching people.";

/**
 * v10 Staff: an overview of your people. The office floor leads (one glyph per person, grouped by team), then the
 * team roster with the effect each team has. Hire opens the hire sheet; offices live in their own sheet.
 */
export function StaffPanel() {
  const s = useGame();
  const [selected, setSelected] = useState<RoleId | null>(null);
  const [hover, setHover] = useState<RoleId | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  // Phones show two team cards; the rest sit behind "Show all". A team picked on the floor always opens its card.
  const [teamsMore, setTeamsMore] = useState(false);

  const hc = headcount(s);
  const cap = officeCapacity(s);
  const payDay = dailyPayroll(s);
  const office = officeTier(s);
  const full = cap > 0 && hc >= cap;
  const morale = s.staff.morale;
  const mf = moraleFactor(s);
  const risk = retention(s);
  const teams = teamStats(s);
  const candidates = s.staff.stars.filter((st) => st.hiredDay === null);
  const activeTeam = teams.find((t) => t.id === (hover ?? selected)) ?? null;
  const officeIdx = OFFICE_TIERS.findIndex((t) => t.id === s.company.officeTierId);
  const nextOffice = OFFICE_TIERS[officeIdx + 1];

  const toggle = (id: RoleId) => setSelected((cur) => (cur === id ? null : id));
  const openHire = (role: RoleId = selected ?? 'researcher', tab: HireTab = 'team') => setSheet({ kind: 'hire', role, tab });

  return (
    <div class="panel sf">
      <PanelIntro id="staff">
        Your people. Each team does one job for the lab, and pay decides whether they stay.
      </PanelIntro>

      <PanelHeader
        code="STF"
        title="Staff"
        subtitle={`${hc} ${hc === 1 ? 'person' : 'people'} · ${money(payDay)}/day payroll`}
        actions={
          <Button variant="primary" onClick={() => openHire()}>
            Hire
          </Button>
        }
      />

      <Card title="The office floor" class="sf-floor-card">
        <div class="sf-office-line">
          <span class="sf-office-text">
            Office: <b>{office.name}</b> · <span class="num">{hc}/{cap}</span> seats
            {peoplePerGlyph(cap) > 1 && <span class="sf-faint"> · 1 figure = {peoplePerGlyph(cap)} people</span>}
          </span>
          <NextOfficeButton s={s} />
        </div>

        <SceneView
          state={s}
          make={createDepartments}
          cam={DEPT_CAM}
          camId="CAM-11"
          height={340}
          label="Your departments: every team at its desks, empty seats in the office, stars highlighted"
          onSelect={(hit) => {
            if (hit.id.startsWith('team:')) toggle(hit.id.slice(5) as RoleId);
          }}
        />

        <div class="sf-readout" aria-live="polite">
          {activeTeam ? (
            <>
              <span class={`sf-swatch sf-team--${activeTeam.id}`} aria-hidden="true" />
              <b>{activeTeam.role.plural}</b>
              <span class="num">
                {activeTeam.heads} {activeTeam.heads === 1 ? 'person' : 'people'}
              </span>
              <span class="num">skill {activeTeam.skill.toFixed(2)}</span>
              <span class="num">{money(activeTeam.payDay)}/day payroll</span>
            </>
          ) : (
            <span class="sf-faint">Hover or tap a team to see its people and pay.</span>
          )}
        </div>

        <div class="sf-chips">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              class={`sf-chip sf-team--${t.id}`}
              aria-pressed={selected === t.id}
              onMouseEnter={() => setHover(t.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(t.id)}
              onBlur={() => setHover(null)}
              onClick={() => toggle(t.id)}
            >
              <span class="sf-swatch" aria-hidden="true" />
              {t.role.plural}
              <span class="num sf-chip-n">{t.heads}</span>
            </button>
          ))}
          <span class="sf-chip is-static">
            <span class="sf-swatch sf-swatch--empty" aria-hidden="true" />
            Empty seats
            <span class="num sf-chip-n">{Math.max(0, cap - hc)}</span>
          </span>
        </div>

        <div class="sf-morale">
          <div class="sf-morale-top">
            <span class="sf-lbl">
              Morale <HelpTip>{MORALE_HELP}</HelpTip>
            </span>
            <span class="num">
              {Math.round(morale)} · every team ×{mf.toFixed(2)}
            </span>
          </div>
          <ProgressBar value={morale} max={100} tone={moraleTone(morale)} height={6} />
          {risk.chance > 0 && (
            <div class="sf-banner bad">
              {risk.lowMorale && risk.underpaid
                ? 'Morale is low and pay is below market.'
                : risk.lowMorale
                  ? 'Morale is below 40.'
                  : 'Average pay is below 95% of market.'}{' '}
              A rival may poach someone about every {risk.everyDays} days.
            </div>
          )}
        </div>

        {full && (
          <div class="sf-banner bad">
            The office is full. Hiring is blocked until you move.
            {nextOffice && <> Next office: {nextOffice.name}.</>}
          </div>
        )}
      </Card>

      <Card title="Teams" subtitle="Tap a team to see its pay and fire">
        <div class={`sf-teams ${teamsMore || teams.findIndex((t) => t.id === selected) >= 2 ? 'is-open' : ''}`}>
          {teams.map((t) => (
            <TeamCard
              key={t.id}
              s={s}
              team={t}
              selected={selected === t.id}
              onToggle={() => toggle(t.id)}
              onHire={(id) => openHire(id, 'team')}
            />
          ))}
        </div>
        {teams.length > 2 && (
          <button type="button" class="btn sf-teams-more" aria-expanded={teamsMore} onClick={() => setTeamsMore(!teamsMore)}>
            {teamsMore ? 'Show fewer teams' : `Show all ${teams.length} teams`}
          </button>
        )}

        {candidates.length > 0 && (
          <div class="sf-candidates">
            <span>
              {candidates.length} star {candidates.length === 1 ? 'candidate' : 'candidates'} on the market
            </span>
            <Button size="sm" onClick={() => openHire(selected ?? 'researcher', 'stars')}>
              See stars
            </Button>
          </div>
        )}
      </Card>

      {sheet?.kind === 'hire' && (
        <HireSheet key={`${sheet.role}-${sheet.tab}`} s={s} initialRole={sheet.role} initialTab={sheet.tab} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
