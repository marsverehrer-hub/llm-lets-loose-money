// OWNER: PROGRESSION UI (v13, GAME_DESIGN §23). The Lab screen: level and streak, this quarter's board goals,
// the perk tree, recent XP and the board's track record.
import { useState } from 'preact/hooks';
import type { GameState } from '../../sim/types';
import { progressOf } from '../../sim/systems/progression';
import { quarterLabel } from '../../sim/systems/board';
import { monthYear } from '../components';
import { Card, PanelHeader, PanelIntro, Tabs } from '../components';
import { useGame } from '../store';
import { BoardCard } from './lab/BoardCard';
import { LevelCard } from './lab/LevelCard';
import { PerkTree } from './lab/PerkTree';
import { TempoControl } from './lab/TempoControl';
import { CupCard } from './lab/CupCard'; // v15
import { HallCard } from './lab/HallCard'; // v15
import './lab/lab.css';

function XpLog({ s }: { s: GameState }) {
  const log = [...progressOf(s).log].reverse().slice(0, 12);
  return (
    <Card title="Recent XP">
      {log.length === 0 ? (
        <p class="muted small">Finish research, runs, releases and board goals to earn XP.</p>
      ) : (
        <ul class="xp-log">
          {log.map((l, i) => (
            <li key={`${l.day}-${i}`}>
              <span class="muted small">{monthYear(l.day)}</span>
              <span class="xp-reason">{l.reason}</span>
              <span class="num good">+{l.amount}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BoardHistory({ s }: { s: GameState }) {
  const h = s.board?.history ?? [];
  return (
    <Card title="Track record" subtitle={h.length ? `${h.length} quarter${h.length === 1 ? '' : 's'}` : undefined}>
      {h.length === 0 ? (
        <p class="muted small">The first quarter is still running.</p>
      ) : (
        <div class="board-history" role="img" aria-label="Goals met per quarter">
          {h.map((q) => (
            <div key={q.quarter} class="bh-q" title={`${quarterLabel(q.day - 1)}: ${q.hit}/${q.total} goals met`}>
              {Array.from({ length: q.total }, (_, i) => (
                <span key={i} class={i < q.hit ? 'bh-cell hit' : 'bh-cell'} />
              ))}
              <span class="bh-label num">{quarterLabel(q.day - 1).replace(' 20', " '")}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

type LabTab = 'level' | 'board' | 'hall';

export function LabPanel() {
  const s = useGame();
  const p = progressOf(s);
  const [tab, setTab] = useState<LabTab>('level');
  return (
    <div class="panel lab-panel">
      <PanelHeader title="Level & perks" subtitle={`Level ${p.level} · ${p.perkPoints} perk point${p.perkPoints === 1 ? '' : 's'}`} />
      <PanelIntro id="lab">
        Everything you do earns lab XP. Levels give perk points: spend them to shape the kind of lab you run. The board sets three goals each quarter, and each pays the day you hit it.
      </PanelIntro>
      <Tabs<LabTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'level', label: 'Level & perks' },
          { id: 'board', label: 'Board & Cup' },
          { id: 'hall', label: 'Hall of Fame' },
        ]}
      />
      {tab === 'level' && (
        <>
          <div class="grid-2">
            <LevelCard s={s} onOpen={() => document.querySelector('.perk-tree, .perk-picker')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
            {s.training && (
              <Card title="Run tempo" subtitle="Pace of the live run">
                <TempoControl s={s} />
              </Card>
            )}
          </div>
          <PerkTree s={s} />
          <details class="disclosure lab-history">
            <summary>Recent XP</summary>
            <XpLog s={s} />
          </details>
        </>
      )}
      {tab === 'board' && (
        <>
          <div class="grid-2">
            <BoardCard s={s} />
            <CupCard s={s} />
          </div>
          <BoardHistory s={s} />
        </>
      )}
      {tab === 'hall' && <HallCard s={s} />}
    </div>
  );
}
