import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { dayToDate, formatMoney } from '../../sim/util';
import { ACHIEVEMENTS } from '../../sim/data/achievements';
import type { AchievementDef, GameState } from '../../sim/types';
import { Card, EmptyState, PanelHeader, Pill, ProgressBar, Stat, formatInt, formatPct } from '../components';
import './panels-a.css';

type Entry = { def: AchievementDef; unlockedDay: number | null };

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
  // Phones show the first six trophies (unlocked ones lead); "Show all" opens the rest.
  const [allOpen, setAllOpen] = useState(false);
  const entries = entriesOf(s);
  const total = entries.length;
  const unlocked = entries.filter((e) => e.unlockedDay !== null).length;
  const pct = total > 0 ? unlocked / total : 0;
  const st = s.stats;
  const money = (v: number) => formatMoney(v, 1);

  return (
    <div class="panel">
      <PanelHeader code="TRO" title="Trophies" subtitle={`${unlocked} of ${total} unlocked · ${formatPct(pct)} complete`} />

      <Card flush>
        <div class="pa-strip pa-strip--8">
          <div class="pa-cell">
            <Stat label="Unlocked" value={`${unlocked}/${total}`} tone={unlocked > 0 ? 'good' : 'muted'} />
          </div>
          <div class="pa-cell">
            <Stat label="Complete" value={formatPct(pct)} />
          </div>
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
      </Card>

      <Card class={`tro-list ${allOpen ? 'is-open' : ''}`} title="Achievements" subtitle="Unlocked first, newest first" flush>
        <div class="pa-pad">
          <ProgressBar label="Collection" value={unlocked} max={Math.max(1, total)} tone={pct >= 1 ? 'good' : 'accent'} right={`${unlocked} / ${total}`} height={6} />
        </div>
        {total === 0 ? (
          <EmptyState title="No trophies yet" text="The trophy case is being engraved." />
        ) : (
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
                {entries.map(({ def, unlockedDay }) => {
                  const isUnlocked = unlockedDay !== null;
                  const hidden = !!def.hidden && !isUnlocked;
                  return (
                    <tr key={def.id} class={isUnlocked ? '' : 'dim'}>
                      <td data-label="Status">
                        {isUnlocked ? <Pill tone="good">Unlocked</Pill> : <Pill tone="muted">{hidden ? 'Hidden' : 'Locked'}</Pill>}
                      </td>
                      <td class="mb-head">
                        <span class={isUnlocked ? 'bold' : ''}>{hidden ? '???' : def.name}</span>
                      </td>
                      <td class="muted mb-block" data-label="Description">{hidden ? 'Hidden. Keep going and see.' : def.description}</td>
                      <td class="num" data-label="Date">{isUnlocked ? dateTag(unlockedDay!) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {total > 6 && (
              <button type="button" class="btn tro-more" aria-expanded={allOpen} onClick={() => setAllOpen(!allOpen)}>
                {allOpen ? 'Show fewer trophies' : `Show all ${total} trophies`}
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
