// Step 4: how it is trained. Optimizer, precision and schedule as trade-off tiles, the learning-rate slider beside
// the sweep chart, then checkpointing, techniques and Benchmaxx. Every control stays visible in this step.
import { dispatch } from '../../store';
import { LAB_TUNING, sweepPointsFor, sweepQuote, sweepRunning } from '../../../sim/systems/lab';
import { availableTechniques } from '../../../sim/systems/training';
import { isResearched } from '../../../sim/systems/research';
import { optionsByGroup, RUN_TUNING } from '../../../sim/data/trainingOptions';
import type { TrainingConfig } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { formatDays, Pill } from '../../components';
import { STEPS, LR_MIN, LR_MAX, fmtLr, lrAt, optionName, posOfLr, sweepLrs, quoteMoney, mult } from './model';
import type { Ctx } from './model';
import { getDraft, updateDraft } from './draft';
import { Chip, OptionTiles, SweepChart, Slider } from './kit';

export function StepRecipe({ ctx }: { ctx: Ctx }) {
  const { s, sheet, defaults, selected, paramsB, tokensB, canTokens, est, cfgErr, patchCfg, patch } = ctx;
  const cfg = sheet.cfg;
  const count = getDraft(s).sweepCount;
  const setCount = (c: 3 | 5) => updateDraft((d) => ({ ...d, sweepCount: c }));
  const lrPos = Math.round(posOfLr(cfg.lr) * STEPS);
  const points = sweepPointsFor(s, cfg.arch);
  const running = sweepRunning(s, cfg.arch);
  // Points record the proxy run's scale, which sits below the planned run's. Compare like with like.
  const proxyDiv = Math.sqrt(LAB_TUNING.SWEEP_PROXY_COMPUTE_DIVISOR);
  const scaleNow = Math.log10(Math.max(1e-6, (est?.activeParamsB ?? paramsB) / proxyDiv));
  const lrs = sweepLrs(cfg.lr, count);
  const sweepBlock =
    selected.length === 0
      ? 'Pick datasets first.'
      : !canTokens
        ? 'The selected datasets have no usable tokens.'
        : cfgErr ?? (running ? 'A sweep for this architecture is already running.' : null);
  const quote = sweepBlock === null ? sweepQuote(s, paramsB, tokensB, selected, cfg, lrs) : null;
  const archName = optionName(cfg.arch);
  const keep = RUN_TUNING.KEEP[cfg.schedule];
  const keepHalf = keep ? `Stopping at halfway keeps ${Math.round((keep.base + keep.slope * 0.5) * 100)}% of the full-run quality.` : null;
  const ck = RUN_TUNING.CHECKPOINT[cfg.checkpointing];
  const techs = availableTechniques(s);
  const runSweep = () => {
    if (sweepBlock !== null) return;
    dispatch({ type: 'runLrSweep', paramsB, tokensB, datasetIds: selected, config: cfg, lrs });
  };

  return (
    <div class="tw-stack">
      <div class="tw-group">
        <div class="tw-label">Optimizer</div>
        <OptionTiles label="Optimizer" rows={optionsByGroup(s, 'optimizer')} value={cfg.optimizer} recommended={defaults.optimizer} onPick={(id) => patchCfg({ optimizer: id })} />
      </div>
      <div class="tw-group">
        <div class="tw-label">Precision</div>
        <OptionTiles label="Precision" rows={optionsByGroup(s, 'precision')} value={cfg.precision} recommended={defaults.precision} onPick={(id) => patchCfg({ precision: id })} />
      </div>
      <div class="tw-group">
        <div class="tw-label">Schedule</div>
        <OptionTiles label="Schedule" rows={optionsByGroup(s, 'schedule')} value={cfg.schedule} recommended={defaults.schedule} onPick={(id) => patchCfg({ schedule: id })} />
        {keepHalf && <div class="tw-small tw-muted">{keepHalf}</div>}
      </div>

      <div class="tw-split">
        <div class="tw-col">
          <div class="tw-dial-head">
            <span class="tw-label">Learning rate</span>
            <span class="num tw-readout-lg">{`lr ${fmtLr(cfg.lr)}`}</span>
          </div>
          <Slider value={lrPos} min={0} max={STEPS} step={1} label="Learning rate" onInput={(v) => patchCfg({ lr: lrAt(v / STEPS) })} />
          <div class="tw-dial-note">
            {est?.ablated
              ? `Instability from the rate: +${(RUN_TUNING.LR_INSTAB * cfg.lr * cfg.lr).toFixed(2)}.`
              : 'Instability from the rate stays hidden until an ablation. Sweeps show how the rate reads.'}
          </div>

          <div class="tw-sweep">
            <div class="tw-dial-head">
              <span class="tw-label">{`Run an LR sweep for ${archName}`}</span>
              {running && <Pill tone="warn">Sweep running</Pill>}
            </div>
            <div class="tw-chips">
              <Chip on={count === 3} onClick={() => setCount(3)}>
                3 rates
              </Chip>
              <Chip on={count === 5} onClick={() => setCount(5)}>
                5 rates
              </Chip>
              <span class="num tw-small tw-muted">{lrs.map(fmtLr).join(' · ')}</span>
            </div>
            <div class="tw-action">
              <div class="tw-small tw-muted">
                {quote
                  ? `About ${quoteMoney(quote.cost, formatMoney)} of cloud time and ${formatDays(quote.days)}. Proxy runs at a fraction of this run's compute.`
                  : sweepBlock ?? "Proxy runs at a fraction of this run's compute."}
              </div>
              <button type="button" class="btn" disabled={sweepBlock !== null} title={sweepBlock ?? undefined} onClick={runSweep}>
                {running ? 'Sweep running' : 'Run LR sweep'}
              </button>
            </div>
          </div>
        </div>
        <div class="tw-col">
          <div class="tw-label">{`Sweep readings: ${archName}`}</div>
          <SweepChart points={points} lr={cfg.lr} scaleNow={scaleNow} />
          <div class="tw-faint tw-small">
            {points.length === 0
              ? `No sweeps for ${archName} yet. A sweep is the only way to learn the rate.`
              : 'Solid points ran near this model\'s scale. Hollow points ran at other scales. Readings are noisy.'}
          </div>
          <div class="tw-faint tw-small">Range {fmtLr(LR_MIN)} to {fmtLr(LR_MAX)}, log scale.</div>
        </div>
      </div>

      <div class="tw-group">
        <div class="tw-label">Checkpointing</div>
        <div class="tw-tiles tw-tiles-sm" role="radiogroup" aria-label="Checkpointing">
          {(['often', 'normal', 'rare'] as const).map((id) => {
            const c = RUN_TUNING.CHECKPOINT[id];
            const on = cfg.checkpointing === id;
            const fast = id === 'often' && isResearched(s, 'async_checkpointing');
            return (
              <div
                key={id}
                class={`tw-tile ${on ? 'is-on' : ''}`}
                role="radio"
                aria-checked={on}
                tabIndex={0}
                onClick={() => patchCfg({ checkpointing: id as TrainingConfig['checkpointing'] })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    patchCfg({ checkpointing: id as TrainingConfig['checkpointing'] });
                  }
                }}
              >
                <div class="tw-tile-head">
                  <span class="tw-tile-name">{id[0].toUpperCase() + id.slice(1)}</span>
                  {id === defaults.checkpointing && <span class="tw-rec">Recommended</span>}
                </div>
                <div class="tw-trades">
                  <span class={`tw-trade tone-${c.speed >= 1 ? 'good' : 'bad'}`}>{`speed ${mult(fast ? 1 : c.speed)}`}</span>
                  <span class="tw-trade tone-info">{`rollback ${c.rollbackDays}d`}</span>
                </div>
              </div>
            );
          })}
        </div>
        {cfg.checkpointing === 'often' && isResearched(s, 'async_checkpointing') && (
          <div class="tw-small tw-muted">Async checkpointing removes the speed cost.</div>
        )}
      </div>

      <div class="tw-group">
        <div class="tw-label">Techniques</div>
        {techs.length === 0 ? (
          <div class="tw-faint tw-small">None researched yet. See RES.</div>
        ) : (
          <div class="tw-chips">
            {techs.map((t) => {
              const on = sheet.techs.includes(t.id);
              return (
                <Chip
                  key={t.id}
                  on={on}
                  title={t.description}
                  onClick={() => patch({ techs: on ? sheet.techs.filter((x) => x !== t.id) : [...sheet.techs, t.id] })}
                >
                  {t.name}
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      <div class="tw-benchmaxx">
        <label class="tw-check-row">
          <input type="checkbox" checked={sheet.benchmaxx} onChange={(e) => patch({ benchmaxx: (e.currentTarget as HTMLInputElement).checked })} />
          <span>
            <span class="tw-bold">Benchmaxx</span>
            <span class="tw-faint tw-small"> Train on benchmark test sets. Scores inflate, the model is flagged contaminated, and a scandal may follow.</span>
          </span>
        </label>
        {sheet.benchmaxx && <div class="md-warn">Benchmaxx is on. Test sets go into the training data.</div>}
      </div>
    </div>
  );
}
