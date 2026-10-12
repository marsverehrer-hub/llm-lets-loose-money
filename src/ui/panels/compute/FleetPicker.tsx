// Fleet priority picker (GAME_DESIGN §21.1): serving first, balanced or training first, with a preview before you switch.
import { useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { formatMoney } from '../../../sim/util';
import type { FleetPriority, GameState } from '../../../sim/types';
import { FLEET_PRIORITIES, fleetPriority } from '../../../sim/systems/serving';
import { Card, HelpTip, Pill } from '../../components';
import { fmtRate } from '../panelKit';
import { fleetNow, fleetPreview } from './fleetView';

const OPTIONS: Record<FleetPriority, { title: string; line: string }> = {
  serving: {
    title: 'Serving first',
    line: 'Your GPUs serve products first. Training gets what is left. Cheapest serving bill, slower training.',
  },
  balanced: {
    title: 'Balanced',
    line: 'Serving uses at most half your GPUs. The rest trains, and overflow is bought from the cloud.',
  },
  training: {
    title: 'Training first',
    line: 'All your GPUs train. Products are served from the cloud. Fastest training, highest serving bill.',
  },
};

export function FleetPicker({ s }: { s: GameState }) {
  const current = fleetPriority(s);
  const [hover, setHover] = useState<FleetPriority | null>(null);
  const [picked, setPicked] = useState<FleetPriority | null>(null);
  const focus = hover ?? picked;
  const now = fleetNow(s);
  const next = focus && focus !== current ? fleetPreview(s, focus) : null;
  const trainingNow = fmtRate(now.trainingPflops);
  const billNow = formatMoney(now.burstCostPerDay);

  return (
    <Card
      code="PRI"
      title="Fleet priority"
      subtitle="Who gets your own GPUs"
      actions={
        <HelpTip>
          Only matters while a training run is going. Without one, your idle GPUs serve products. Serving that your GPUs cannot cover is always bought from the cloud, so products never go down for lack of GPUs.
        </HelpTip>
      }
    >
      <div class="cc-opts" role="radiogroup" aria-label="Fleet priority">
        {FLEET_PRIORITIES.map((p) => {
          const o = OPTIONS[p];
          const isCurrent = p === current;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              class={`cc-opt ${isCurrent ? 'is-current' : ''} ${focus === p ? 'is-focus' : ''}`}
              onPointerEnter={() => setHover(p)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
              onClick={() => setPicked(p)}
            >
              <span class="cc-opt-head">
                <b>{o.title}</b>
                {isCurrent && <Pill tone="good">Now</Pill>}
              </span>
              <span class="cc-opt-line">{o.line}</span>
            </button>
          );
        })}
      </div>

      <div class="cc-preview" aria-live="polite">
        {focus && next ? (
          <>
            <p class="cc-preview-line">
              If you switch to <b>{OPTIONS[focus].title}</b>: training speed{' '}
              <b class="num">
                {trainingNow} → {fmtRate(next.trainingPflops)} PF/s
              </b>
              , serving bill{' '}
              <b class="num">
                {billNow} → {formatMoney(next.burstCostPerDay)}/day
              </b>
            </p>
            {!s.training && <p class="cc-note">No training run is going, so training speed stays at 0 until you start one.</p>}
            {picked === focus && (
              <button
                type="button"
                class="btn btn-primary btn-sm"
                onClick={() => {
                  dispatch({ type: 'setFleetPriority', priority: focus });
                  setPicked(null);
                }}
              >
                Switch to {OPTIONS[focus].title}
              </button>
            )}
          </>
        ) : (
          <p class="cc-preview-line">
            Now: training <b class="num">{trainingNow} PF/s</b>, serving bill <b class="num">{billNow}/day</b>. Pick an option to preview it.
          </p>
        )}
      </div>
    </Card>
  );
}
