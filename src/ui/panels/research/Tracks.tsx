// v17.3 research for small labs (GAME_DESIGN §30): the recommended next topic, the five goal tracks, papers being
// adopted and the auto-pick switch. Sits at the top of the Research screen; the full tree stays below. Tokens only.
import type { GameState, ResearchNode } from '../../../sim/types';
import { RESEARCH_TRACKS } from '../../../sim/data/research';
import type { ResearchTrack } from '../../../sim/data/research';
import { ADOPT_TUNING, adoptQuote } from '../../../sim/systems/research';
import { calendarYear, formatMoney } from '../../../sim/util';
import { Card, ProgressBar } from '../../components';
import { dispatch } from '../../store';
import { ConfirmButton, fmtCount, fmtDays } from '../panelKit';
import { QueueAction } from '../ResearchQueue';
import { NODE_BY_ID, ResearchView, etaText, jokeName, opensIn, topicName } from './model';

type Show = (n: ResearchNode) => void;

/** Adopt a published paper for cash: a ConfirmButton naming price and days, or nothing when it cannot be done. */
export function AdoptButton({ s, node, sm }: { s: GameState; node: ResearchNode; sm?: boolean }) {
  const q = adoptQuote(s, node);
  if (!q.ok) return null;
  return (
    <ConfirmButton
      tone="default"
      class={sm ? 'btn-sm' : ''}
      label={`Adopt · ${formatMoney(q.price)}`}
      confirmLabel={`Pay ${formatMoney(q.price)}?`}
      title={`Buy the published paper's know-how: ${formatMoney(q.price)}, done in ${q.days} days, alongside your own research.`}
      onConfirm={() => dispatch({ type: 'adoptPaper', nodeId: node.id })}
    />
  );
}

/** Why a topic cannot start yet, in a few words. */
function blockedText(view: ResearchView, n: ResearchNode): string {
  const miss = n.prereqs.find((p) => !view.done.has(p));
  if (miss) return `Needs ${topicName(NODE_BY_ID.get(miss) ?? n)}`;
  return `Opens ${opensIn(n)}`;
}

export function RecommendedCard({ s, view, onShow }: { s: GameState; view: ResearchView; onShow: Show }) {
  const rec = view.rec;
  if (!rec) return null;
  const n = rec.node;
  const joke = jokeName(n);
  const q = adoptQuote(s, n);
  const published = calendarYear(s.day) >= n.minYear + ADOPT_TUNING.PUBLISHED_AFTER_YEARS;
  const part = view.partialOf(n);
  const cost = view.costOf(n);
  return (
    <Card class="rs-rec" hot title="Recommended next" subtitle={rec.track ?? 'More upgrades'}>
      <button type="button" class="rs-rec-name" onClick={() => onShow(n)} title="Show details">
        {rec.label}
      </button>
      {joke && <div class="rs-rec-joke">{joke}</div>}
      <p class="rs-rec-why">{rec.why}</p>
      {part > 0 && <ProgressBar value={part} max={cost} height={6} label="Earlier progress kept" right={`${Math.round((part / cost) * 100)}%`} />}
      <div class="rs-rec-foot">
        <span class="rs-rec-time num" title={`${fmtCount(view.leftOf(n), 0)} research points left at ${fmtCount(view.perDay)} a day`}>
          {etaText(view.leftOf(n), view.perDay)}
        </span>
        <span class="rs-rec-acts">
          <button
            type="button"
            class="btn btn-primary"
            title={view.current ? `Switch from ${topicName(view.current)}. Its progress is kept for later.` : undefined}
            onClick={() => dispatch({ type: 'setResearch', nodeId: n.id })}
          >
            Research
          </button>
          <QueueAction node={n} state="available" />
          <AdoptButton s={s} node={n} />
        </span>
      </div>
      {q.ok ? (
        <div class="rs-hint">Adopting buys the published paper: done in {fmtDays(q.days)}, alongside your own research.</div>
      ) : (
        published && <div class="rs-hint">{q.reason}</div>
      )}
    </Card>
  );
}

type PipState = 'done' | 'active' | 'adopting' | 'next' | 'ready' | 'locked';
const PIP_TEXT: Record<PipState, string> = {
  done: 'done',
  active: 'researching now',
  adopting: 'being adopted',
  next: 'next',
  ready: 'can start',
  locked: 'not yet',
};

function TrackRow({ s, view, track, onShow }: { s: GameState; view: ResearchView; track: ResearchTrack; onShow: Show }) {
  const adopting = new Set((s.research.adopting ?? []).map((a) => a.nodeId));
  const nodes = track.steps.map((st) => NODE_BY_ID.get(st.id)).filter((n): n is ResearchNode => !!n);
  const busy = (n: ResearchNode) => view.done.has(n.id) || view.current?.id === n.id || adopting.has(n.id);
  const next = nodes.find((n) => !busy(n)) ?? null;
  const doneCount = nodes.filter((n) => view.done.has(n.id)).length;
  const pipOf = (n: ResearchNode): PipState => {
    const st = view.stateOf(n);
    if (st === 'done') return 'done';
    if (st === 'active') return 'active';
    if (adopting.has(n.id)) return 'adopting';
    if (n === next) return 'next';
    return st === 'available' ? 'ready' : 'locked';
  };
  const step = next ? track.steps.find((x) => x.id === next.id)! : null;
  const nextSt = next ? view.stateOf(next) : null;
  return (
    <article class="rs-track">
      <div class="rs-track-head">
        <span class="rs-track-name">{track.name}</span>
        <span class="rs-track-count num">
          {doneCount}/{nodes.length}
        </span>
      </div>
      <div class="rs-track-goal">{track.goal}</div>
      <div class="rs-pips" role="group" aria-label={`${track.name} steps`}>
        {nodes.map((n) => {
          const p = pipOf(n);
          const frac = p === 'done' || p === 'adopting' ? 1 : view.partialOf(n) / Math.max(1, view.costOf(n));
          return (
            <button
              type="button"
              key={n.id}
              class="rs-pip"
              data-pip={p}
              title={`${topicName(n)}: ${PIP_TEXT[p]}`}
              aria-label={`${topicName(n)}, ${PIP_TEXT[p]}`}
              onClick={() => onShow(n)}
            >
              {frac > 0 && <span class="rs-pip-fill" style={{ width: `${Math.min(1, frac) * 100}%` }} />}
            </button>
          );
        })}
      </div>
      {next && step ? (
        <div class="rs-track-next">
          <button type="button" class="rs-track-step" onClick={() => onShow(next)} title="Show details">
            <span class="rs-track-k">Next</span> {step.label}
          </button>
          <div class="rs-track-why">{step.why}</div>
          <div class="rs-track-foot">
            <span class="rs-track-time num">{nextSt === 'available' ? etaText(view.leftOf(next), view.perDay) : blockedText(view, next)}</span>
            <span class="rs-track-acts">
              {nextSt === 'available' ? (
                <button
                  type="button"
                  class={`btn btn-sm${next.id === view.rec?.node.id ? ' btn-primary' : ''}`}
                  data-tut={next.id === view.rec?.node.id ? 'research-start' : undefined}
                  title={view.current ? `Switch from ${topicName(view.current)}. Its progress is kept for later.` : undefined}
                  onClick={() => dispatch({ type: 'setResearch', nodeId: next.id })}
                >
                  Research
                </button>
              ) : (
                <QueueAction node={next} state={nextSt ?? 'locked'} />
              )}
              <AdoptButton s={s} node={next} sm />
            </span>
          </div>
        </div>
      ) : (
        <div class="rs-track-why">{doneCount === nodes.length ? 'Track complete.' : 'Every remaining step is under way.'}</div>
      )}
    </article>
  );
}

export function TrackCards({ s, view, onShow }: { s: GameState; view: ResearchView; onShow: Show }) {
  return (
    <Card
      class="rs-tracks-card"
      title="Your tracks"
      subtitle={`${fmtCount(view.perDay)} research points a day${view.behind > 0 ? ` · ${view.behind} year${view.behind === 1 ? '' : 's'} behind the field` : ' · up to date'}`}
    >
      <div class="rs-tracks">
        {RESEARCH_TRACKS.map((t) => (
          <TrackRow key={t.id} s={s} view={view} track={t} onShow={onShow} />
        ))}
      </div>
    </Card>
  );
}

/** Papers being adopted, with days left. Nothing when none. */
export function AdoptingStrip({ s, onShow }: { s: GameState; onShow: Show }) {
  const list = s.research.adopting ?? [];
  if (list.length === 0) return null;
  return (
    <div class="rs-adopting" aria-label="Papers being adopted">
      <span class="rs-adopting-k">Adopting</span>
      {list.map((a) => {
        const n = NODE_BY_ID.get(a.nodeId);
        return (
          <button type="button" key={a.nodeId} class="rs-adopting-item" onClick={() => n && onShow(n)}>
            {n ? topicName(n) : a.nodeId}
            <span class="num"> · {fmtDays(Math.max(0, a.doneDay - s.day))} left</span>
          </button>
        );
      })}
    </div>
  );
}
