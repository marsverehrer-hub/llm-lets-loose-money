// OWNER: PROGRESSION UI (v13, GAME_DESIGN §23.5). The run dock: a slim strip under the top bar on every screen with
// the live training run (progress, ETA, tempo), research and the lab (level, Arena Cup, board quarter). An idle
// training slot or research desk reads calmly; the HQ advisor is the only "what next" voice.
import type { GameState } from '../../sim/types';
import { RESEARCH } from '../../sim/data/research';
import { effectiveResearchCost, recommendedResearch } from '../../sim/systems/research';
import { topicName } from '../panels/research/model';
import { levelProgress, progressOf } from '../../sim/systems/progression';
import { quarterLabel } from '../../sim/systems/board';
import { cupThemeLabel } from '../../sim/systems/tournament';
import { trainingStatus } from '../components/derive';
import { Popover, formatDays, useIsMobile } from '../components';
import { navigate } from '../nav';
import { useGame } from '../store';
import { TempoControl } from '../panels/lab/TempoControl';
import { etaOf as mediaEta } from '../panels/model/MediaStudio';
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
  // v17.2: an image or video run fills the slot while no language model trains.
  const media = s.media?.run;
  if ((!run || !st) && media) {
    const frac = media.totalFlops > 0 ? media.doneFlops / media.totalFlops : 0;
    const eta = mediaEta(s);
    return (
      <div class="dock-cell dock-train" role="group" aria-label="Media training run">
        <button type="button" class="dock-link" onClick={() => navigate('models', { open: 'run' })} title="Open the run in Models">
          <span class="dock-k">{media.config.kind === 'video' ? 'Video' : 'Image'}</span>
          <span class="dock-name">{media.name}</span>
          <Bar frac={frac} />
          <span class="dock-v num">{Math.floor(frac * 100)}%</span>
          <span class="dock-v muted num">{Number.isFinite(eta) ? formatDays(eta) : 'Stalled'}</span>
        </button>
      </div>
    );
  }
  if (!run || !st) {
    const queued = (s.trainingQueue ?? []).length;
    return (
      <button type="button" class="dock-cell dock-idle" onClick={() => navigate('models', { open: 'train' })} title="The training slot is empty">
        <span class="dock-k">Train</span>
        <span class="dock-v">{queued > 0 ? `${queued} queued, waiting` : 'Idle · Start a run'}</span>
        <span class="dock-go" aria-hidden="true">›</span>
      </button>
    );
  }
  const pending = !!run.pendingIncident && run.pendingIncident.result === undefined;
  const cp = run.checkpoints?.[run.checkpoints.length - 1];
  return (
    <div class="dock-cell dock-train" role="group" aria-label="Training run">
      <button type="button" class="dock-link" onClick={() => navigate('models', { open: 'run' })} title="Open the run in Models">
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
    const rec = recommendedResearch(s);
    return (
      <button
        type="button"
        class="dock-cell dock-idle"
        onClick={() => navigate('research')}
        title={rec ? `Nobody is researching anything. Next: ${rec.label}. ${rec.why}` : 'Nobody is researching anything'}
      >
        <span class="dock-k">{phone ? 'Res' : 'Research'}</span>
        <span class="dock-v">{phone ? 'Idle' : rec ? `Idle · Next: ${rec.label}` : 'Idle · Pick a topic'}</span>
        <span class="dock-go" aria-hidden="true">›</span>
      </button>
    );
  }
  const cost = effectiveResearchCost(s, node);
  const frac = cost > 0 ? s.research.progress / cost : 0;
  const ppd = s.research.pointsPerDay;
  const days = ppd > 0 ? Math.max(0, cost - s.research.progress) / ppd : Infinity;
  return (
    <button type="button" class="dock-cell dock-res" onClick={() => navigate('research')} title={`${topicName(node)} (${node.name}). ${node.effectText ?? ''}`}>
      <span class="dock-k">{phone ? 'Res' : 'Research'}</span>
      {!phone && <span class="dock-name">{topicName(node)}</span>}
      <Bar frac={frac} tone="info" />
      <span class="dock-v muted num">{Number.isFinite(days) ? formatDays(days) : '—'}</span>
    </button>
  );
}

/** The open Arena Cup, shown until play day. Null when there is no cup or no model to enter it with. */
function openCup(s: GameState) {
  const open = s.cup?.open;
  if (!open || !s.models.some((m) => m.releasedDay !== null && !m.deprecated)) return null;
  return { open, left: Math.max(0, open.playDay - s.day) };
}

/** Lab: one cell for level, the Arena Cup and the board. Opens a popover with a row for each. */
function LabCell({ s, phone }: { s: GameState; phone: boolean }) {
  const p = progressOf(s);
  const lp = levelProgress(p);
  const cup = openCup(s);
  const b = s.board && s.board.objectives.length > 0 ? s.board : null;
  const boardDone = b ? b.objectives.filter((o) => o.doneDay !== null).length : 0;
  const boardLeft = b ? Math.max(0, b.quarterEnd - s.day) : 0;
  return (
    <Popover
      title="Lab"
      width={330}
      align="right"
      class={`dock-lab ${p.perkPoints > 0 ? 'has-points' : ''}`}
      label={
        <>
          <span class="dock-k">Lab</span>
          <span class="dock-v num dock-lvl">Lvl {p.level}</span>
          {!phone && <Bar frac={lp.frac} tone="good" />}
          {p.perkPoints > 0 && <span class="dock-dot" role="img" aria-label={`${p.perkPoints} perk points to spend`} />}
        </>
      }
    >
      {(close) => (
        <div class="lab-pop">
          <div class="lab-row">
            <div class="lab-row-main">
              <span class="lab-row-k">Level {p.level}</span>
              <span class="lab-row-v muted num">
                {lp.into}/{lp.need} XP to the next
                {p.streak >= 2 ? ` · hot streak ×${p.streak}` : ''}
              </span>
              <span class="lab-row-v">{p.perkPoints > 0 ? `${p.perkPoints} perk point${p.perkPoints === 1 ? '' : 's'} to spend` : 'No perk points to spend'}</span>
            </div>
            <button
              type="button"
              class="btn btn-sm"
              onClick={() => {
                close();
                navigate('lab');
              }}
            >
              Perks
            </button>
          </div>
          {cup && (
            <button
              type="button"
              class={`lab-row lab-row-link ${cup.open.entrantModelId ? '' : 'is-open'}`}
              title={`${cupThemeLabel(cup.open.theme)} #${cup.open.edition}`}
              onClick={() => {
                close();
                navigate('lab');
              }}
            >
              <span class="lab-row-main">
                <span class="lab-row-k">Arena Cup</span>
                <span class="lab-row-v">{cup.open.entrantModelId ? 'Entered' : 'Enter a model'}</span>
              </span>
              <span class="lab-row-v muted num">{formatDays(cup.left)}</span>
            </button>
          )}
          {b && (
            <button
              type="button"
              class="lab-row lab-row-link"
              title="This quarter's board goals"
              onClick={() => {
                close();
                navigate('lab');
              }}
            >
              <span class="lab-row-main">
                <span class="lab-row-k">{quarterLabel(b.quarterStart)}</span>
                <span class="dock-goals" aria-label={`${boardDone} of ${b.objectives.length} goals met`}>
                  {b.objectives.map((o) => (
                    <span key={o.id} class={o.doneDay !== null ? 'dock-goal hit' : 'dock-goal'} />
                  ))}
                </span>
              </span>
              <span class="lab-row-v muted num">{formatDays(boardLeft)} left</span>
            </button>
          )}
        </div>
      )}
    </Popover>
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
      <LabCell s={s} phone={phone} />
    </div>
  );
}
