import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { dayToDate, formatMoney } from '../../sim/util';
import { ACHIEVEMENTS } from '../../sim/data/achievements';
import type { AchievementDef, GameState } from '../../sim/types';
import { Card, EmptyState, PanelHeader, Pill, ProgressBar, Stat, Tabs, formatInt, formatPct } from '../components';
import './panels-a.css';
import './trophies.css';

type Entry = { def: AchievementDef; unlockedDay: number | null };
type Group = 'start' | 'money' | 'arena' | 'trouble' | 'capabilities' | 'data';

// Achievements carry no category, so the trophy case groups them by id. A new id that is not listed lands under "start".
const GROUPS: { id: Group; label: string; ids: string[] }[] = [
  { id: 'start', label: 'Getting started', ids: ['first_train', 'first_release', 'first_revenue', 'first_product', 'chat_launch', 'enterprise_launch', 'datacenter', 'first_star'] },
  { id: 'money', label: 'Money', ids: ['daily_100k', 'arr_1m', 'arr_100m', 'valuation_1b', 'valuation_10b', 'valuation_1t', 'second_round', 'serial_series', 'sovereign', 'ipo', 'stock_100', 'short_seller_survived'] },
  { id: 'arena', label: 'Arena & staff', ids: ['arena_first', 'arena_dominance', 'models_10', 'research_10', 'agi', 'small_but_mighty', 'staff_50', 'staff_500'] },
  { id: 'trouble', label: 'Trouble & events', ids: ['outage', 'lawsuit_1', 'lawsuit_3', 'hype_90', 'living_on_fumes', 'decisive_leader', 'ghost_in_machine', 'citation_needed', 'open_source_closed_mind', 'any_percent'] },
  { id: 'capabilities', label: 'Capabilities', ids: ['first_sota', 'sota_five', 'saturated', 'first_finetune', 'three_generations', 'distilled_mini', 'benchmaxxer', 'autonomous_swe'] },
  { id: 'data', label: 'Training & data', ids: ['first_incident', 'yolo_run', 'quirk_collector', 'early_stop_wsd', 'fp4_run', 'data_hoarder', 'data_first_exclusive', 'data_quadrillion', 'data_ouroboros', 'data_licensed_to_ill', 'data_chat_harvester', 'dataops_spiderman', 'dataops_refined_taste', 'dataops_broker', 'dataops_strike_three'] },
];
const groupOf = (id: string): Group => GROUPS.find((g) => g.ids.includes(id))?.id ?? 'start';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 MAR 2019" from a day number. */
function dateTag(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function entriesOf(s: GameState): Entry[] {
  const list: Entry[] = ACHIEVEMENTS.map((def) => {
    const day = s.achievements[def.id];
    return { def, unlockedDay: typeof day === 'number' ? day : null };
  });
  // Unlocked first (newest first), then locked in the order defined in the data.
  return list.sort((a, b) => {
    if (a.unlockedDay !== null && b.unlockedDay !== null) return b.unlockedDay - a.unlockedDay;
    if (a.unlockedDay !== null) return -1;
    if (b.unlockedDay !== null) return 1;
    return 0;
  });
}

export function AchievementsPanel() {
  const s = useGame();
  const entries = entriesOf(s);
  const total = entries.length;
  const unlocked = entries.filter((e) => e.unlockedDay !== null).length;
  const pct = total > 0 ? unlocked / total : 0;
  const [group, setGroup] = useState<Group>('start');
  const money = (v: number) => formatMoney(v, 1);
  const st = s.stats;

  const groupTabs = GROUPS.map((g) => {
    const inGroup = entries.filter((e) => groupOf(e.def.id) === g.id);
    return { id: g.id, label: g.label, count: inGroup.filter((e) => e.unlockedDay !== null).length };
  });
  const current = entries.filter((e) => groupOf(e.def.id) === group);
  const earned = current.filter((e) => e.unlockedDay !== null);
  const locked = current.filter((e) => e.unlockedDay === null);

  return (
    <div class="panel">
      <PanelHeader title="Trophies" subtitle={`${unlocked} of ${total} unlocked · ${formatPct(pct)} complete`} />

      <details class="disclosure tro-career">
        <summary>Career figures</summary>
        <div class="pa-strip pa-strip--6">
          <div class="pa-cell">
            <Stat label="Total revenue" value={st.totalRevenue} format={money} tone="good" />
          </div>
          <div class="pa-cell">
            <Stat label="Peak valuation" value={st.peakValuation} format={money} />
          </div>
          <div class="pa-cell">
            <Stat label="Models trained" value={st.modelsTrained} format={(v) => formatInt(v)} hint={`${formatInt(st.modelsReleased)} released`} />
          </div>
          <div class="pa-cell">
            <Stat label="Best Elo" value={st.bestElo > 0 ? Math.round(st.bestElo) : '—'} format={(v) => formatInt(v)} />
          </div>
          <div class="pa-cell">
            <Stat label="Outage days" value={st.outageDays} format={(v) => formatInt(v)} tone={st.outageDays > 0 ? 'warn' : 'muted'} />
          </div>
          <div class="pa-cell">
            <Stat label="Lawsuits" value={st.lawsuits} format={(v) => formatInt(v)} tone={st.lawsuits > 0 ? 'bad' : 'muted'} />
          </div>
        </div>
      </details>

      <Card title="Achievements" subtitle="Newest first" flush>
        <div class="pa-pad tro-summary">
          <p class="tro-earned">
            Earned <span class="num bold">{unlocked}</span> of <span class="num">{total}</span>
          </p>
          <ProgressBar label="Collection" value={unlocked} max={Math.max(1, total)} tone={pct >= 1 ? 'good' : 'accent'} right={`${unlocked} / ${total}`} height={6} />
          <Tabs<Group> class="tro-tabs" value={group} onChange={setGroup} tabs={groupTabs} />
        </div>
        {total === 0 ? (
          <EmptyState title="No trophies yet" text="The trophy case is being engraved." />
        ) : (
          <div class="pa-pad tro-group">
            <p class="muted small tro-group-line">
              {earned.length} of {current.length} earned in {GROUPS.find((g) => g.id === group)?.label.toLowerCase()}
            </p>
            {earned.length > 0 && (
              <div class="table-wrap table-stack">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Name</th>
                      <th>Description</th>
                      <th class="num">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earned.map(({ def, unlockedDay }) => (
                      <tr key={def.id}>
                        <td data-label="Status">
                          <Pill tone="good">Unlocked</Pill>
                        </td>
                        <td class="mb-head">
                          <span class="bold">{def.name}</span>
                        </td>
                        <td class="muted mb-block" data-label="Description">{def.description}</td>
                        <td class="num" data-label="Date">{dateTag(unlockedDay!)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {locked.length > 0 && (
              <ul class="tro-locked">
                {locked.map(({ def }) => {
                  const hidden = !!def.hidden;
                  return (
                    <li key={def.id} class="tro-locked-row">
                      <Pill tone="muted">{hidden ? 'Hidden' : 'Locked'}</Pill>
                      <span class="tro-locked-name">{hidden ? '???' : def.name}</span>
                      <span class="tro-locked-text muted">{hidden ? 'Hidden. Keep going and see.' : def.description}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
