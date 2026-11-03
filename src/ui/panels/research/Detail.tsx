// v10 research detail: the short version. Name, status, effect, price, one action. The rest sits under "More".
import { dispatch } from '../../store';
import { DIFFUSION_FLOOR, diffusionFactor, isResearched } from '../../../sim/systems/research';
import { DATACENTER_TIERS } from '../../../sim/data/gpus';
import { DATASETS } from '../../../sim/data/datasets';
import { SPECIALIZATIONS } from '../../../sim/data/specializations';
import { TRAINING_OPTIONS } from '../../../sim/data/trainingOptions';
import { RESEARCH } from '../../../sim/data/research';
import { MEDIA_ARCHS } from '../../../sim/data/imageModels';
import { MEMORY_TUNING } from '../../../sim/systems/scaleLimits';
import { CLUSTER_TIERS } from '../../../sim/systems/compute';
import { AdoptButton } from './Tracks';
import { CAP_IDS } from '../../../sim/types';
import type { Bonuses, CapId, GameState, Id, ProductKind, ResearchNode, Scores, TrainingOptionGroup } from '../../../sim/types';
import { HelpTip, Pill, ProgressBar } from '../../components';
import type { PillTone } from '../../components';
import { BONUS_LABELS, SCORE_LABELS, fmtCount, fmtMult, fmtSigned } from '../panelKit';
import { QueueAction } from '../ResearchQueue';
import { fmtDays } from '../panelKit';
import {
  BRANCH_LABEL,
  CHEAPER_PCT,
  FLOOR_PCT,
  NODE_BY_ID,
  NodeState,
  ResearchView,
  branchOf,
  etaText,
  isCheaperNow,
  jokeName,
  opensIn,
  topicName,
} from './model';

const CAP_LABEL: Record<CapId, string> = {
  knowledge: 'Knowledge',
  reasoning: 'Reasoning',
  math: 'Math',
  coding: 'Coding',
  agentic: 'Agentic',
  chat: 'Chat',
  vision: 'Vision',
  safety: 'Safety',
  multilingual: 'Multilingual',
  longContext: 'Long context',
};

const GROUP_LABEL: Record<TrainingOptionGroup, string> = {
  arch: 'Architecture',
  tokenizer: 'Tokenizer',
  context: 'Context',
  optimizer: 'Optimizer',
  precision: 'Precision',
  schedule: 'Schedule',
  filter: 'Data filter',
  post: 'Post-training stage',
  anneal: 'Data anneal',
};

const PRODUCT_LABEL: Record<ProductKind, string> = { chat: 'Chat', api: 'API', enterprise: 'Enterprise' };

/** Status pill for a node. A node whose year has not come yet reads "Opens <year>". */
export function stateTag(st: NodeState, node: ResearchNode): { tone: PillTone; label: string } {
  switch (st) {
    case 'done':
      return { tone: 'good', label: 'Done' };
    case 'active':
      return { tone: 'warn', label: 'Researching' };
    case 'available':
      return { tone: 'info', label: 'Ready' };
    case 'early':
      return { tone: 'muted', label: `Opens ${opensIn(node)}` };
    default:
      return { tone: 'muted', label: 'Locked' };
  }
}

export interface DetailProps {
  s: GameState;
  view: ResearchView;
  node: ResearchNode;
  onPick: (id: Id) => void;
  onStop: () => void;
}

export function NodeDetail({ s, view, node, onPick, onStop }: DetailProps) {
  const { done, current, progress, perDay, costOf, stateOf, partialOf } = view;
  const st = stateOf(node);
  const isCur = current?.id === node.id;
  const cost = costOf(node);
  const remaining = view.leftOf(node);
  const shelved = isCur ? 0 : partialOf(node);
  const adopting = (s.research.adopting ?? []).find((a) => a.nodeId === node.id);
  const missing = node.prereqs.filter((p) => !isResearched(s, p));
  const prereqs = node.prereqs.map((p) => ({ id: p, node: NODE_BY_ID.get(p), ok: done.has(p) }));

  const blocked: string | null =
    st === 'done'
      ? 'Already researched'
      : isCur
        ? 'Researching now'
        : missing.length
          ? `Needs ${missing
              .slice(0, 2)
              .map((p) => {
                const n = NODE_BY_ID.get(p);
                return n ? topicName(n) : p;
              })
              .join(', ')}${missing.length > 2 ? ` and ${missing.length - 2} more` : ''}`
          : st === 'early'
            ? `Opens in ${opensIn(node)}`
            : null;

  const cheaper = isCheaperNow(view, node);
  const atFloor = cheaper && diffusionFactor(s, node) <= DIFFUSION_FLOOR + 1e-9;
  const stMeta = stateTag(st, node);

  const training = TRAINING_OPTIONS.filter((o) => o.requiresResearch === node.id);
  const specs = SPECIALIZATIONS.filter((sp) => sp.requiresResearch === node.id || (node.unlocksSpec !== undefined && sp.id === node.unlocksSpec));
  const datasets = DATASETS.filter((d) => d.requiresResearch === node.id);
  const centers = DATACENTER_TIERS.filter((t) => t.requiresResearch === node.id);
  const dependents = RESEARCH.filter((n) => n.prereqs.includes(node.id));
  const media = MEDIA_ARCHS.filter((m) => m.requiresResearch === node.id);
  const shard = MEMORY_TUNING.SHARD_DEGREE.find(([id]) => id === node.id)?.[1];
  const cluster = CLUSTER_TIERS.find(([id]) => id === node.id)?.[1];
  const hasUnlocks =
    training.length + specs.length + datasets.length + centers.length + media.length > 0 || !!node.unlocksProduct || !!shard || !!cluster;
  const capRows = CAP_IDS.filter((c) => node.capBonus?.[c] !== undefined).map((c) => [CAP_LABEL[c], node.capBonus![c]!] as const);
  const scoreRows = Object.entries(node.scoreBonus ?? {}).map(([k, v]) => [SCORE_LABELS[k as keyof Scores], v as number] as const);
  const bonusLines = Object.entries(node.bonuses ?? {}).map(([k, m]) => `${fmtMult(m as number)} ${BONUS_LABELS[k as keyof Bonuses]}`);

  return (
    <div class="rs-detail">
      <div class="rs-d-head">
        <div class="rs-d-name">{topicName(node)}</div>
        {jokeName(node) && <div class="rs-rec-joke">{jokeName(node)}</div>}
        <div class="rs-d-tags">
          <Pill tone={stMeta.tone}>{stMeta.label}</Pill>
          <span class="rs-d-meta">
            {BRANCH_LABEL[branchOf(node)]} · idea from {node.minYear}
          </span>
        </div>
      </div>

      {node.effectText && <div class="rs-effect">{node.effectText}</div>}

      <dl class="rs-kv">
        <dt>Cost</dt>
        <dd class="num">{fmtCount(cost, 0)} RP</dd>
        {st !== 'done' && (
          <>
            <dt>{isCur || shelved > 0 ? 'Left' : 'Time'}</dt>
            <dd class="num">
              {isCur || shelved > 0 ? `${fmtCount(remaining, 0)} RP · ${etaText(remaining, perDay)}` : etaText(cost, perDay)}
            </dd>
          </>
        )}
      </dl>

      {cheaper && (
        <div class="rs-cheaper">
          <span>{`Cheaper every year (−${CHEAPER_PCT}%/yr)`}</span>
          <HelpTip label="Why is it cheaper?">
            Papers spread every year, so an idea gets cheaper the longer it has been out. Each calendar year past its opening year
            cuts the price by {CHEAPER_PCT}%, down to {FLOOR_PCT}% off.{atFloor ? ' This one has reached that floor.' : ''}
          </HelpTip>
        </div>
      )}

      {shelved > 0 && st !== 'done' && (
        <ProgressBar value={shelved} max={cost} height={4} label="Earlier progress kept" right={`${fmtCount(shelved, 0)} RP`} />
      )}
      {adopting && <div class="rs-reason">Adopting the published paper · {fmtDays(Math.max(0, adopting.doneDay - s.day))} left</div>}
      {blocked && <div class="rs-reason">{blocked}</div>}

      {prereqs.length > 0 && (
        <div class="rs-needs">
          <span class="rs-needs-label">Needs</span>
          <ul class="rs-chips-list">
            {prereqs.map((p) => (
              <li key={p.id}>
                <button type="button" class={`rs-chip-btn${p.ok ? ' is-done' : ''}`} onClick={() => onPick(p.id)}>
                  {p.ok ? '✓ ' : ''}
                  {p.node ? topicName(p.node) : p.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasUnlocks && (
        <div class="rs-sec">
          <div class="rs-sec-title">Unlocks</div>
          <div class="rs-chips">
            {node.unlocksProduct && <span class="rs-chip">The {PRODUCT_LABEL[node.unlocksProduct]} product</span>}
            {shard && <span class="rs-chip">Bigger models: one model can span {shard.toLocaleString('en-US')} GPUs</span>}
            {cluster && (
              <span class="rs-chip">
                {Number.isFinite(cluster) ? `Train efficiently on up to ${fmtCount(cluster, 0)} GPUs` : 'Train across datacenters, no cluster limit'}
              </span>
            )}
            {media.map((m) => (
              <span key={m.id} class="rs-chip" title={m.description}>
                {m.kind === 'video' ? 'Video' : 'Image'} model: {m.name}
              </span>
            ))}
            {training.map((o) => (
              <span key={o.id} class="rs-chip" title={o.description}>
                {o.name} <i>{GROUP_LABEL[o.group]}</i>
              </span>
            ))}
            {specs.map((sp) => (
              <span key={sp.id} class="rs-chip" title={sp.description}>
                Spec: {sp.name} <i>{sp.suffix}</i>
              </span>
            ))}
            {datasets.map((d) => (
              <span key={d.id} class="rs-chip" title={d.flavor}>
                Dataset: {d.name} <i>{d.kind}</i>
              </span>
            ))}
            {centers.map((c) => (
              <span key={c.id} class="rs-chip" title={c.flavor}>
                Datacenter: {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div class="rs-foot">
        {isCur && (
          <button type="button" class="btn" onClick={onStop}>
            Stop
          </button>
        )}
        {!isCur && st !== 'done' && (
          <button
            type="button"
            class="btn btn-primary"
            disabled={blocked !== null}
            title={blocked ?? `Spend ${fmtCount(remaining, 0)} RP on ${topicName(node)}`}
            onClick={() => dispatch({ type: 'setResearch', nodeId: node.id })}
          >
            Research
          </button>
        )}
        <QueueAction node={node} state={st} />
        {!isCur && <AdoptButton s={s} node={node} />}
      </div>
      {current && !isCur && st !== 'done' && progress > 0 && (
        <div class="rs-switch">
          Switching shelves {fmtCount(progress, 0)} RP on {topicName(current)}. It is kept for when you come back.
        </div>
      )}

      <details class="rs-more">
        <summary>More</summary>
        <p class="rs-d-desc">{node.description}</p>

        {bonusLines.length > 0 && (
          <div class="rs-sec">
            <div class="rs-sec-title">Passive bonuses</div>
            <ul class="rs-list">
              {bonusLines.map((l) => (
                <li key={l} class="rs-list-plain">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(capRows.length > 0 || scoreRows.length > 0) && (
          <div class="rs-sec">
            <div class="rs-sec-title">{node.technique ? 'Technique bonuses (training run)' : 'Model bonuses'}</div>
            <table class="rs-mini">
              <tbody>
                {capRows.map(([label, v]) => (
                  <tr key={`c-${label}`}>
                    <th scope="row">{label}</th>
                    <td class="num">{fmtSigned(v)}</td>
                  </tr>
                ))}
                {scoreRows.map(([label, v]) => (
                  <tr key={`s-${label}`}>
                    <th scope="row">{label} score</th>
                    <td class="num">{fmtSigned(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dependents.length > 0 && (
          <div class="rs-sec">
            <div class="rs-sec-title">Leads to</div>
            <ul class="rs-list">
              {dependents.map((n) => (
                <li key={n.id}>
                  <button type="button" class={`rs-link${isResearched(s, n.id) ? ' is-done' : ''}`} onClick={() => onPick(n.id)}>
                    <span class="rs-link-mark" aria-hidden="true">
                      {isResearched(s, n.id) ? '✓' : '›'}
                    </span>
                    <span class="rs-link-name">{topicName(n)}</span>
                    {branchOf(n) !== branchOf(node) && <span class="rs-link-branch">{BRANCH_LABEL[branchOf(n)]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
}
