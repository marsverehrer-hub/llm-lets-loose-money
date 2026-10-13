// OWNER: UI-PAGE. The rich model page: header (name, lineage, status, scores, lifecycle timeline) and five tabs.
// Reads the sim through its APIs only. Fog of training (GAME_DESIGN 16, 17): no run.hidden, lab.lrOffsets,
// model.vibes or latentQuirks contents. The header and the tabs show forecasts and measured numbers only.
import { useState } from 'preact/hooks';
import { formatParams } from '../../../sim/util';
import { provisionalElo } from '../../../sim/systems/lab';
import { weightClassOf } from '../../../sim/systems/classes';
import type { GameState, Id, Model, WeightClass } from '../../../sim/types';
import type { ResponseGrade } from '../../../sim/data/playground';
import { Card, Pill, Stat, Tabs } from '../../components';
import type { TabDef } from '../../components';
import { fmtCtx } from '../train/model';
import { BenchmarksTab } from './BenchmarksTab';
import { ArenaTab } from './ArenaTab';
import { LifecycleTab } from './LifecycleTab';
import { CareerTab } from './CareerTab'; // v15 model life
import { OverviewTab } from './OverviewTab';
import { PlaygroundTab } from './PlaygroundTab';
import { masteryName, masteryOf, versionLabel } from '../../../sim/systems/modelLife';
import { derivedText, lineageText, statusPills, timelineOf } from './status';
import './modelpage.css';
import '../models.css';

export type TabId = 'overview' | 'benchmarks' | 'playground' | 'arena' | 'career' | 'lifecycle';

/** Display names for the weight classes (v8). */
export const CLASS_NAME: Record<WeightClass, string> = { nano: 'Nano', small: 'Small', medium: 'Medium', open: 'Open' };

const TABS: TabDef<TabId>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { id: 'playground', label: 'Playground' },
  { id: 'arena', label: 'Arena & hype' },
  { id: 'career', label: 'Career' }, // v15
  { id: 'lifecycle', label: 'Lifecycle' },
];

/** One playground exchange. Kept in the page state (last 6) so it survives switching tabs. */
export interface Exchange {
  n: number;
  promptId: Id;
  prompt: string;
  variant: number;
  text: string;
  grade: ResponseGrade;
}

export function ModelPage({ s, m }: { s: GameState; m: Model }) {
  const [tab, setTab] = useState<TabId>('overview');
  const [chat, setChat] = useState<Exchange[]>([]);
  return (
    <Card class="mpg-card">
      <Header s={s} m={m} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} class="mpg-tabs" />
      <div class="mpg-body" role="tabpanel">
        {tab === 'overview' && <OverviewTab s={s} m={m} />}
        {tab === 'benchmarks' && <BenchmarksTab s={s} m={m} />}
        {tab === 'playground' && <PlaygroundTab s={s} m={m} chat={chat} setChat={setChat} />}
        {tab === 'arena' && <ArenaTab s={s} m={m} />}
        {tab === 'career' && <CareerTab s={s} m={m} />}
        {tab === 'lifecycle' && <LifecycleTab s={s} m={m} />}
      </div>
    </Card>
  );
}

function Header({ s, m }: { s: GameState; m: Model }) {
  const elo = provisionalElo(s, m);
  const pills = statusPills(m, true);
  const codename = m.codename && m.codename !== m.name ? m.codename : null;
  const derived = derivedText(s, m);
  const active = m.activeParamsB !== undefined && m.activeParamsB !== m.paramsB ? m.activeParamsB : null;
  const steps = timelineOf(s, m);
  return (
    <header class="mpg-head">
      <div class="mpg-titlerow">
        <h2 class="mpg-name">{m.name}</h2>
        {codename && <span class="mpg-codename">{`codename ${codename}`}</span>}
      </div>
      <div class="mpg-lineage">
        <span>{lineageText(s, m)}</span>
        {derived && <span class="mpg-faint"> · {derived}</span>}
      </div>
      <div class="mpg-pills">
        {pills.map((p) => (
          <Pill key={p.label} tone={p.tone} title={p.title}>
            {p.label}
          </Pill>
        ))}
        {m.releasedDay !== null && (
          <Pill tone={masteryOf(m).level >= 4 ? 'milestone' : 'muted'} title="Mastery: field experience from serving users">
            {`${versionLabel(m)} · ${masteryName(masteryOf(m).level)}`}
          </Pill>
        )}
        <Pill tone="cyan" title="Weight class: active size against the frontier of this year">
          {`${CLASS_NAME[weightClassOf(s, m)]} class`}
        </Pill>
      </div>
      <div class="mpg-stats">
        <Stat label="Overall" value={String(Math.round(m.overall))} size="md" />
        <Stat
          label="Elo"
          value={String(Math.round(elo.elo))}
          size="md"
          hint={
            elo.provisional ? (
              <span class="mpg-row">
                <Pill tone="muted">Provisional</Pill>
                <span class="num">{`±${Math.round(elo.band)}`}</span>
              </span>
            ) : undefined
          }
        />
        <Stat label="Parameters" value={formatParams(m.paramsB)} hint={active ? `${formatParams(active)} active` : 'Dense'} size="sm" />
        <Stat label="Context" value={fmtCtx(m.contextK)} size="sm" />
      </div>
      <ol class="mpg-tl" aria-label="Lifecycle">
        {steps.map((st) => (
          <li key={st.key} class={`mpg-tl-step is-${st.state}`}>
            <span class="mpg-tl-dot" aria-hidden="true" />
            <span class="mpg-tl-k">{st.label}</span>
            <span class="mpg-tl-when num">{st.when}</span>
          </li>
        ))}
      </ol>
    </header>
  );
}
