// Queued training runs (GAME_DESIGN 18.4). A run starts when the slot frees and cash covers a month of compute bills.
// Shows name, size, estimated days, waiting state and remove. Renders nothing when nothing is queued and nothing trains.
import { dispatch, useGame } from '../../store';
import { Card, Pill, formatDays } from '../../components';
import { formatParams } from '../../../sim/util';
import { getBonuses } from '../../../sim/bonuses';
import { estimateTraining, trainingRatePerDay } from '../../../sim/systems/training';
import { specById } from '../../../sim/systems/capabilities';
import type { GameState, QueuedRun } from '../../../sim/types';
import { setView } from './draft';
import '../queue.css';

interface Estimate {
  kind: string;
  size: string;
  days: number;
}

/** Size and days for one queued run, from the same estimate the wizards show. */
function estimateRun(s: GameState, item: QueuedRun): Estimate {
  if (item.kind === 'pretrain') {
    const a = item.action;
    const est = estimateTraining(s, a.paramsB, a.tokensB, a.datasetIds, a.techniques, a.config);
    return { kind: 'Pretrain', size: formatParams(a.paramsB), days: est.days };
  }
  const a = item.action;
  const parent = s.models.find((m) => m.id === a.parentId);
  const spec = specById(a.specId);
  if (!parent || !spec || !parent.config) return { kind: 'Fine-tune', size: '—', days: NaN };
  const paramsB = parent.paramsB * (spec.paramsMult ?? 1);
  const flops = 6 * (parent.activeParamsB ?? parent.paramsB) * 1e9 * parent.tokensB * 1e9 * spec.computeFrac * (getBonuses(s).finetuneCost ?? 1);
  const rate = trainingRatePerDay(s, parent.config);
  return { kind: 'Fine-tune', size: formatParams(paramsB), days: rate > 0 ? flops / rate : Infinity };
}

function runName(item: QueuedRun): string {
  const name = (item.action as { name?: string }).name?.trim();
  if (name) return name;
  return item.kind === 'pretrain' ? 'Untitled model' : 'Untitled fine-tune';
}

export function TrainingQueue() {
  const s = useGame();
  const queue = s.trainingQueue ?? [];
  // While a run trains this stays visible even when empty: New model is the way to queue the next run.
  if (queue.length === 0 && !s.training) return null;
  return (
    <Card
      class="q-train"
      title="Training queue"
      subtitle={queue.length > 0 ? `${queue.length} waiting · starts when the slot frees` : 'Nothing waiting'}
      actions={
        <button type="button" class="btn btn-sm" onClick={() => setView({ kind: 'train' })}>
          New model
        </button>
      }
      flush
    >
      {queue.length === 0 && (
        <div class="q-empty">Queue the next run while this one trains. Build it as usual, then press Add to queue.</div>
      )}
      <ul class="q-list">
        {queue.map((item, i) => {
          const est = estimateRun(s, item);
          const waiting = !!s.flags[`queueWait.${item.id}`];
          const name = runName(item);
          return (
            <li class="q-row" key={item.id}>
              <span class="q-idx">{i + 1}</span>
              <span class="q-namecol">
                <span class="q-name" title={name}>
                  {name}
                </span>
                <span class="q-train-kind">
                  {est.kind} · {est.size} params
                </span>
              </span>
              {waiting && <Pill tone="warn">Waiting</Pill>}
              <span class="q-num" title="Estimated time once started">
                {Number.isFinite(est.days) ? formatDays(est.days) : '—'}
              </span>
              <span class="q-acts">
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  aria-label={`Remove ${name} from the training queue`}
                  title="Remove from the queue"
                  onClick={() => dispatch({ type: 'unqueueTraining', id: item.id })}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
