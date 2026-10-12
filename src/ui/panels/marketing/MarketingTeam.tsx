// OWNER: v10 MARKETING agent. The marketing team: how many, what they cost, what they change, and a way to Staff.
import { getBonuses } from '../../../sim/bonuses';
import type { GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { marketingTeamEffect } from '../../../sim/systems/market';
import { marketSalary } from '../../../sim/systems/staff';
import { Button, Card, HelpTip } from '../../components';
import { navigate } from '../../nav';

/** Person glyph: a circle head over a rect body. Flat, token-coloured. */
function Person() {
  return (
    <svg viewBox="0 0 12 16" aria-hidden="true" focusable="false">
      <circle cx="6" cy="4" r="3.2" />
      <rect x="1" y="8.5" width="10" height="7.5" />
    </svg>
  );
}

const MAX_GLYPHS = 24;

export function MarketingTeam({ s }: { s: GameState }) {
  const role = s.staff.roles.marketing;
  const count = role.count;
  const payroll = marketSalary(s, 'marketing') * role.salaryLevel * count;
  const brandMult = getBonuses(s).brand;
  const team = marketingTeamEffect(s);
  const campaignPct = Math.round((team.campaignMult - 1) * 100);
  const passive = team.brandPerDay >= 0.01 ? team.brandPerDay.toFixed(2) : team.brandPerDay.toFixed(3);
  const stars = s.staff.stars.filter((st) => st.hiredDay !== null && st.role === 'marketing');
  const shown = Math.min(count, MAX_GLYPHS);

  return (
    <Card
      title="Marketing team"
      subtitle={`${count} ${count === 1 ? 'person' : 'people'}`}
      actions={
        <Button size="sm" onClick={() => navigate('staff')}>
          Open Staff
        </Button>
      }
    >
      <div class="stack">
        <div class="mk-people" role="img" aria-label={`${count} people on the marketing team`}>
          {Array.from({ length: shown }, (_, i) => (
            <Person key={i} />
          ))}
          {count > shown && <span class="mk-more">+{count - shown}</span>}
          {count === 0 && <span class="mk-empty">Nobody yet. Hire from Staff.</span>}
        </div>
        <div class="kv">
          <div class="kv-row">
            <span class="kv-k">Salaries</span>
            <span class="kv-v num">{formatMoney(payroll, 1)} a year</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">
              Campaigns
              <HelpTip>Your team makes every campaign stronger. The more people, the more it adds, with diminishing returns.</HelpTip>
            </span>
            <span class="kv-v num">{count > 0 ? `${campaignPct}% stronger` : 'No boost'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">
              Word of mouth
              <HelpTip>Brand the team adds every day with no campaign running: launch posts, conference booths, people talking.</HelpTip>
            </span>
            <span class="kv-v num">{count > 0 ? `+${passive} brand a day` : 'None'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">
              Brand gain per campaign
              <HelpTip>Multiplies the brand each running campaign adds. It comes from hired marketing stars and some research.</HelpTip>
            </span>
            <span class="kv-v num">{brandMult.toFixed(2)}×</span>
          </div>
        </div>
        <p class="mk-team-what">
          It costs salaries, and in return it makes campaigns stronger and adds a little brand every day. Marketing stars add more brand gain on top.
        </p>
        {stars.length > 0 && (
          <ul class="mk-stars">
            {stars.map((st) => (
              <li key={st.id}>
                <span>{st.name}</span>
                <span class="mk-star-title">{st.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
