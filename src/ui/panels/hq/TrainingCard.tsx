// OWNER: ONBOARD (v10 agent 7). Headquarters "Training": the run in progress, its ETA and the loss curve.
import type { GameState } from '../../../sim/types';
import { formatNumber, formatParams } from '../../../sim/util';
import { Button, Card, EmptyState, HelpTip, LineChart, ProgressBar, SERIES, formatDays, formatPct } from '../../components';
import type { LineSeries } from '../../components';
import { trainingStatus } from '../../components/derive';
import { navigate } from '../../nav';
import { TempoControl } from '../lab/TempoControl'; // v13 run tempo

export function TrainingCard({ s }: { s: GameState }) {
  const run = trainingStatus(s);
  const training = s.training;

  if (!run || !training) {
    return (
      <Card title="Training" code="MDL" subtitle="Slot idle" hot>
        <EmptyState
          title="Not training"
          text="Every idle day is a day the rivals train and you don't."
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('models')}>
              Start a run
            </Button>
          }
        />
      </Card>
    );
  }

  const cp = training.checkpoints?.[training.checkpoints.length - 1];
  const loss: LineSeries[] = [{ name: 'Loss', color: SERIES.blue, points: (training.lossHistory ?? []).map((y, i) => ({ x: i, y })) }];
  return (
    <Card title="Training" code="MDL" subtitle={`${formatParams(training.paramsB)} params · ${formatNumber(training.tokensB, 1)}B tokens`}>
      <div class="hq-train">
        <div class="hq-train-head">
          <span class="hq-train-name">{training.name}</span>
          <span class="num">{formatPct(run.frac)}</span>
        </div>
        <ProgressBar value={run.frac} height={6} />
        <div class="hq-train-meta small">
          {isFinite(run.days) ? `ETA ${formatDays(run.days)}` : 'Stalled. Buy GPUs.'}
          {cp && (
            <span>
              · Checkpoint <span class="num">{cp.reading.toFixed(0)} ± {cp.band.toFixed(0)}</span>
              {training.forecast && <span class="muted"> vs forecast <span class="num">{training.forecast.mid.toFixed(0)}</span></span>}
            </span>
          )}
        </div>
        <div class="hq-train-tempo">
          <span class="small muted">Tempo</span>
          <TempoControl s={s} />
        </div>
        <LineChart
          series={loss}
          height={96}
          legend={false}
          yFormat={(v) => v.toFixed(2)}
          xFormat={(x) => `d${Math.round(x)}`}
          emptyText="Loss curve appears after the first training day."
        />
        <div class="hq-train-meta small">
          Forecast loss <span class="num">{training.predictedLoss.toFixed(2)}</span>
          <HelpTip>Where the lab expects the loss curve to end. It is a forecast, so the finished run can land somewhere else.</HelpTip>
        </div>
      </div>
    </Card>
  );
}
