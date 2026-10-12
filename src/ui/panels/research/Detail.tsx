// v10 research detail: the short version. Name, status, effect, price, one action. The rest sits under "More".
import { dispatch } from '../../store';
import { DIFFUSION_FLOOR, diffusionFactor, isResearched } from '../../../sim/systems/research';
import { DATACENTER_TIERS } from '../../../sim/data/gpus';
import { DATASETS } from '../../../sim/data/datasets';
import { SPECIALIZATIONS } from '../../../sim/data/specializations';
import { TRAINING_OPTIONS } from '../../../sim/data/trainingOptions';
import { RESEARCH } from '../../../sim/data/research';
import { CAP_IDS } from '../../../sim/types';
import type { Bonuses, CapId, GameState, Id, ProductKind, ResearchNode, Scores, TrainingOptionGroup } from '../../../sim/types';
import { HelpTip, Pill } from '../../components';
import type { PillTone } from '../../components';
import { BONUS_LABELS, SCORE_LABELS, fmtCount, fmtMult, fmtSigned } from '../panelKit';
import { QueueAction } from '../ResearchQueue';
import { BRANCH_LABEL, CHEAPER_PCT, FLOOR_PCT, NODE_BY_ID, NodeState, ResearchView, branchOf, etaText, isCheaperNow, opensIn } from './model';

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
  const { done, current, progress, perDay, costOf, stateOf } = view;
  const st = stateOf(node);
  const isCur = current?.id === node.id;
  const cost = costOf(node);
  const remaining = isCur ? Math.max(0, cost - progress) : cost;
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
              .map((p) => NODE_BY_ID.get(p)?.name ?? p)
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
  const hasUnlocks = training.length + specs.length + datasets.length + centers.length > 0 || !!node.unlocksProduct;
  const capRows = CAP_IDS.filter((c) => node.capBonus?.[c] !== undefined).map((c) => [CAP_LABEL[c], node.capBonus![c]!] as const);
  const scoreRows = Object.entries(node.scoreBonus ?? {}).map(([k, v]) => [SCORE_LABELS[k as keyof Scores], v as number] as const);
  const bonusLines = Object.entries(node.bonuses ?? {}).map(([k, m]) => `${fmtMult(m as number)} ${BONUS_LABELS[k as keyof Bonuses]}`);

  return (
    <div class="rs-detail">
      <div class="rs-d-head">
        <div class="rs-d-name">{node.name}</div>
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
            <dt>{isCur ? 'Left' : 'Time'}</dt>
            <dd class="num">
              {isCur ? `${fmtCount(remaining, 0)} RP · ${etaText(remaining, perDay)}` : etaText(cost, perDay)}
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

      {blocked && <div class="rs-reason">{blocked}</div>}

      {prereqs.length > 0 && (
        <div class="rs-needs">
          <span class="rs-needs-label">Needs</span>
          <ul class="rs-chips-list">
            {prereqs.map((p) => (
              <li key={p.id}>
                <button type="button" class={`rs-chip-btn${p.ok ? ' is-done' : ''}`} onClick={() => onPick(p.id)}>
                  {p.ok ? '✓ ' : ''}
                  {p.node?.name ?? p.id}
                </button>
              </li>
            ))}
          </ul>
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
            title={blocked ?? `Spend ${fmtCount(cost, 0)} RP on ${node.name}`}
            onClick={() => dispatch({ type: 'setResearch', nodeId: node.id })}
          >
            Research
          </button>
        )}
        <QueueAction node={node} state={st} />
      </div>
      {current && !isCur && st !== 'done' && <div class="rs-switch">Switching drops {fmtCount(progress, 0)} RP on {current.name}.</div>}

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

        {hasUnlocks && (
          <div class="rs-sec">
            <div class="rs-sec-title">Unlocks</div>
            <div class="rs-chips">
              {node.unlocksProduct && <span class="rs-chip">Product: {PRODUCT_LABEL[node.unlocksProduct]}</span>}
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
                    <span class="rs-link-name">{n.name}</span>
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
