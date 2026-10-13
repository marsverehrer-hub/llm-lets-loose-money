// OWNER: PROGRESSION UI (v13, GAME_DESIGN §23.5). The run dock: a slim strip under the top bar on every screen with
// the live training run (progress, ETA, tempo), research, the lab level and the board's quarter. An idle training
// slot or research desk shows as a call to action, because an idle lab is the one thing the player should never miss.
import type { GameState } from '../../sim/types';
import { RESEARCH } from '../../sim/data/research';
import { effectiveResearchCost } from '../../sim/systems/research';
import { levelProgress, progressOf } from '../../sim/systems/progression';
import { quarterLabel } from '../../sim/systems/board';
import { trainingStatus } from '../components/derive';
import { formatDays, useIsMobile } from '../components';
import { navigate } from '../nav';
import { useGame } from '../store';
import { TempoControl } from '../panels/lab/TempoControl';
import './rundock.css';
import '../panels/lab/lab.css';

const NODE_BY_ID = new Map(RESEARCH.map((n) => [n.id, n] as const));

function Bar({ frac, tone }: { frac: number; tone?: string }) {
  return (
    <span class={`dock-bar ${tone ?? ''}`} aria-hidden="true">
      <span class="dock-bar-fill" style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
    </span>
  );
}

function TrainCell({ s, phone }: { s: GameState; phone: boolean }) {
  const run = s.training;
  const st = trainingStatus(s);
  if (!run || !st) {
    const queued = (s.trainingQueue ?? []).length;
    return (
      <button type="button" class="dock-cell dock-idle" onClick={() => navigate('models')} title="The training slot is empty">
        <span class="dock-k">Train</span>
        <span class="dock-v">{queued > 0 ? `${queued} queued, waiting` : phone ? 'Idle. Start a run' : 'Slot idle. Start a run'}</span>
        <span class="dock-go" aria-hidden="true">›</span>
      </button>
    );
  }
  const pending = !!run.pendingIncident && run.pendingIncident.result === undefined;
  const cp = run.checkpoints?.[run.checkpoints.length - 1];
  return (
    <div class="dock-cell dock-train" role="group" aria-label="Training run">
      <button type="button" class="dock-link" onClick={() => navigate('models')} title="Open the run in Models">
        <span class="dock-k">{run.kind === 'pretrain' || !run.kind ? 'Train' : run.kind === 'finetune' ? 'Tune' : run.kind === 'distill' ? 'Distill' : 'Merge'}</span>
        <span class="dock-name">{run.name}</span>
        <Bar frac={st.frac} tone={pending ? 'warn' : run.tempo === 'crunch' ? 'hot' : ''} />
        <span class="dock-v num">{Math.floor(st.frac * 100)}%</span>
        <span class="dock-v muted num">{pending ? 'Incident' : Number.isFinite(st.days) ? formatDays(st.days) : 'Stalled'}</span>
        {!phone && cp && (
          <span class="dock-v muted" title="Latest checkpoint eval">
            CP <span class="num">{Math.round(cp.reading)}</span>
          </span>
        )}
      </button>
      {!phone && <TempoControl s={s} compact />}
    </div>
  );
}

function ResearchCell({ s, phone }: { s: GameState; phone: boolean }) {
  const id = s.research.current;
  const node = id ? NODE_BY_ID.get(id) : undefined;
  if (!node) {
    return (
      <button type="button" class="dock-cell dock-idle" onClick={() => navigate('research')} title="Nobody is researching anything">
        <span class="dock-k">{phone ? 'Res' : 'Research'}</span>
        <span class="dock-v">{phone ? 'Idle' : 'Idle. Pick a topic'}</span>
        <span class="dock-go" aria-hidden="true">›</span>
      </button>
    );
  }
  const cost = effectiveResearchCost(s, node);
  const frac = cost > 0 ? s.research.progress / cost : 0;
  const ppd = s.research.pointsPerDay;
  const days = ppd > 0 ? Math.max(0, cost - s.research.progress) / ppd : Infinity;
  return (
    <button type="button" class="dock-cell dock-res" onClick={() => navigate('research')} title={`${node.name}. ${node.effectText ?? ''}`}>
      <span class="dock-k">{phone ? 'Res' : 'Research'}</span>
      {!phone && <span class="dock-name">{node.name}</span>}
      <Bar frac={frac} tone="info" />
      <span class="dock-v muted num">{Number.isFinite(days) ? formatDays(days) : '—'}</span>
    </button>
  );
}

function LevelCell({ s }: { s: GameState }) {
  const p = progressOf(s);
  const lp = levelProgress(p);
  return (
    <button type="button" class={`dock-cell dock-level ${p.perkPoints > 0 ? 'has-points' : ''}`} onClick={() => navigate('lab')} title={`Lab level ${p.level}. ${lp.into}/${lp.need} XP to the next.`}>
      <span class="dock-k">LVL</span>
      <span class="dock-v num dock-lvl">{p.level}</span>
      <Bar frac={lp.frac} tone="good" />
      {p.perkPoints > 0 && <span class="dock-pts num">+{p.perkPoints}</span>}
      {p.streak >= 2 && <span class="dock-streak num" title="Hot streak">x{p.streak}</span>}
    </button>
  );
}

function BoardCell({ s }: { s: GameState }) {
  const b = s.board;
  if (!b || b.objectives.length === 0) return null;
  const done = b.objectives.filter((o) => o.doneDay !== null).length;
  const left = Math.max(0, b.quarterEnd - s.day);
  return (
    <button type="button" class="dock-cell dock-board" onClick={() => navigate('lab')} title="This quarter's board goals">
      <span class="dock-k">{quarterLabel(b.quarterStart).split(' ')[0]}</span>
      <span class="dock-goals" aria-label={`${done} of ${b.objectives.length} goals met`}>
        {b.objectives.map((o) => (
          <span key={o.id} class={o.doneDay !== null ? 'dock-goal hit' : 'dock-goal'} />
        ))}
      </span>
      <span class="dock-v muted num">{formatDays(left)}</span>
    </button>
  );
}

export function RunDock() {
  const s = useGame();
  const phone = useIsMobile();
  if (s.gameOver) return null;
  return (
    <div class="rundock" aria-label="Lab status">
      <TrainCell s={s} phone={phone} />
      <ResearchCell s={s} phone={phone} />
      <LevelCell s={s} />
      {!phone && <BoardCell s={s} />}
    </div>
  );
}
