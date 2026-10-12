// Step 1: how big. The parameter and token sliders are primary. Fit-to-time shortcuts are helper chips.
import { formatParams } from '../../../sim/util';
import { suggestCodename } from '../../../sim/data/names';
import { T_MIN, CHINCHILLA, CHINCHILLA_SNAP, FIT_CHIPS, P_MAX, P_MIN, STEPS, pointsText, posFor, scalePct, tokensShort } from './model';
import type { Ctx } from './model';
import { NumField, Slider, Chip } from './kit';
import { logToValue, sig2, uiRng, valueToLog } from '../panelKit';
import { SCALE_TUNING, TRAINING_TUNING } from '../../../sim/systems/training';
import { effParamsFor } from '../../../sim/systems/trainingMath';

export function StepSize({ ctx }: { ctx: Ctx }) {
  const { s, sheet, est, pos, paramsB, tokensB, maxTokens, canTokens, canSlideTokens, uniqueTokens, patch } = ctx;
  const tokPos = canSlideTokens ? Math.round(valueToLog(tokensB, T_MIN, maxTokens) * STEPS) : 0;
  // Effective tokens per effective parameter (MoE counts its active experts); raw tokens per parameter without a run.
  const optTokens = CHINCHILLA * effParamsFor(paramsB, sheet.cfg);
  const ratio = est ? est.tokensPerParam : canTokens && paramsB > 0 ? tokensB / paramsB : 0;
  const ratioText = ratio >= 10 ? String(Math.round(ratio)) : ratio.toFixed(1);
  const auto = sheet.tokReq === null;

  return (
    <div class="tw-stack">
      <div class="tw-name-row">
        <label class="tw-label" for="tw-name">
          Codename
        </label>
        <input
          id="tw-name"
          class="input tw-name-input"
          type="text"
          maxLength={40}
          value={sheet.name}
          placeholder="Name the codename"
          onInput={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value })}
        />
        <button type="button" class="btn btn-sm" onClick={() => patch({ name: suggestCodename(uiRng()) })}>
          Suggest
        </button>
      </div>
      <div class="tw-faint tw-small">The public name is chosen at release.</div>

      <div class="tw-size">
        <div class="tw-dial">
          <div class="tw-dial-head">
            <span class="tw-label">Parameters</span>
            <span class="tw-chips">
              {FIT_CHIPS.map((c) => (
                <Chip
                  key={c.fit}
                  on={sheet.fit === c.fit}
                  title={c.hint}
                  onClick={() => patch({ fit: c.fit, tokReq: null })}
                >
                  {c.label}
                </Chip>
              ))}
              <Chip on={sheet.fit === 'manual'} title="Sizes you set by hand" onClick={() => patch({ fit: 'manual', paramPos: pos, tokReq: null })}>
                Manual
              </Chip>
            </span>
          </div>
          <div class="tw-dial-row">
            <Slider value={pos} min={0} max={STEPS} step={1} label="Parameters" onInput={(v) => patch({ fit: 'manual', paramPos: v })} />
            <NumField value={paramsB} min={P_MIN} max={P_MAX} label="Parameters in billions" onCommit={(v) => patch({ fit: 'manual', paramPos: posFor(v) })} />
            <span class="tw-unit">B</span>
          </div>
          <div class="tw-dial-note">
            {sheet.fit === 'manual' ? 'Set by hand. Drag or type to resize.' : 'Sized to the time budget. Moving the slider switches to manual.'}
          </div>
        </div>

        <div class="tw-dial">
          <div class="tw-dial-head">
            <span class="tw-label">Training tokens</span>
            <span class="tw-chips">
              <Chip on={!auto} title={`Fixed at ${CHINCHILLA} tokens per parameter`} onClick={() => patch({ tokReq: sig2(Math.min(optTokens, maxTokens)) })}>
                Fixed
              </Chip>
              <Chip on={auto} title="Tracks the Chinchilla value as parameters change" onClick={() => patch({ tokReq: null })}>
                Auto
              </Chip>
            </span>
          </div>
          <div class="tw-dial-row">
            <Slider
              value={tokPos}
              min={0}
              max={STEPS}
              step={1}
              disabled={!canSlideTokens}
              label="Training tokens"
              onInput={(v) => {
                const t = sig2(logToValue(v / STEPS, T_MIN, maxTokens));
                // Near the Chinchilla value the slider snaps onto it and goes back to Auto.
                const near = paramsB > 0 && Math.abs(t / optTokens - 1) < CHINCHILLA_SNAP;
                patch({ tokReq: near ? null : t });
              }}
            />
            <NumField value={tokensB} min={T_MIN} max={maxTokens} label="Training tokens in billions" disabled={!canTokens} onCommit={(v) => patch({ tokReq: v })} />
            <span class="tw-unit">B</span>
          </div>
          <div class="tw-dial-note">
            {canTokens
              ? `Max ${TRAINING_TUNING.MAX_EPOCHS} epochs of ${tokensShort(uniqueTokens)} unique tokens: ${tokensShort(maxTokens)}.`
              : 'Pick datasets with tokens in step 2 to size the run.'}
          </div>
        </div>
      </div>

      <div class="tw-ratio">
        <div class="tw-ratio-main">
          <span class="tw-label">Tokens per parameter</span>
          <span class="num tw-big">{ratio > 0 ? ratioText : '—'}</span>
          <span class="tw-faint tw-small">Chinchilla is 20</span>
        </div>
        <p class="tw-tradeoff">
          Above 20 tokens per parameter: more compute, stronger for its size. Below 20: cheaper now, weaker for its size.
        </p>
      </div>

      <ScaleMeter ctx={ctx} />

      <div class="tw-readout num">
        {`${formatParams(paramsB)} params · ${tokensShort(tokensB)} tokens · ${ratioText} tokens/param`}
      </div>
    </div>
  );
}

/**
 * Data scale: effective tokens per parameter on a log scale, with the three zones, what the run costs in overall points
 * when undertrained, and the one-click way back to compute-optimal. Reads the same physics the run does.
 */
function ScaleMeter({ ctx }: { ctx: Ctx }) {
  const { est, fc, paramsB, tokensB, uniqueTokens, canTokens, patch, sheet } = ctx;
  const needed = CHINCHILLA * effParamsFor(paramsB, sheet.cfg);
  const repeats = uniqueTokens > 0 ? tokensB / uniqueTokens : 1;
  // The estimate's ratio is the one the loss sees (repeats count half). Without datasets there is no run to read.
  const ratio = est ? est.tokensPerParam : 0;
  const under = fc?.undertrainPenalty ?? 0;
  const zone =
    ratio <= 0 ? '' : ratio < SCALE_TUNING.UNDER_STRONG_RATIO ? 'Undertrained' : ratio <= SCALE_TUNING.OVER_RATIO ? 'Compute-optimal' : 'Overtrained';
  // Quality cannot fall below zero: a very weak model can be undertrained with no visible cost in overall points.
  const hidden = (est?.underPenalty ?? 0) >= 0.5 && under <= 0.05;
  const x12 = scalePct(SCALE_TUNING.UNDER_STRONG_RATIO);
  const x40 = scalePct(SCALE_TUNING.OVER_RATIO);
  const effText = ratio >= 10 ? String(Math.round(ratio)) : ratio.toFixed(1);

  return (
    <div class="tw-scale">
      <div class="tw-scale-head">
        <span class="tw-label">Data scale</span>
        <span class="tw-faint tw-small">{ratio > 0 ? `${zone}. Effective tokens per parameter, log scale.` : 'Pick datasets to read the scale.'}</span>
      </div>
      <div class="tw-scale-track" role="img" aria-label={ratio > 0 ? `${effText} effective tokens per parameter. ${zone}.` : 'No run to read yet'}>
        <span class="tw-scale-zone is-under" style={`left:0%;width:${x12}%`} />
        <span class="tw-scale-zone is-up" style={`left:${x12}%;width:${x40 - x12}%`} />
        <span class="tw-scale-zone is-over" style={`left:${x40}%;width:${100 - x40}%`} />
        {ratio > 0 && <span class="tw-scale-mark" style={`left:${scalePct(ratio)}%`} />}
      </div>
      <div class="tw-scale-ticks num" aria-hidden="true">
        <span class="is-start" style="left:0%">0.1</span>
        <span style={`left:${scalePct(1)}%`}>1</span>
        <span style={`left:${scalePct(10)}%`}>10</span>
        <span class="is-end" style="left:100%">100</span>
      </div>
      <div class="tw-scale-zones">
        <span class="tw-scale-zone-key">
          <i class="tw-swatch is-under" aria-hidden="true" /> Undertrained: below {SCALE_TUNING.UNDER_STRONG_RATIO}. Costs overall points.
        </span>
        <span class="tw-scale-zone-key">
          <i class="tw-swatch is-up" aria-hidden="true" /> Compute-optimal: {SCALE_TUNING.UNDER_STRONG_RATIO} to {SCALE_TUNING.OVER_RATIO}.
        </span>
        <span class="tw-scale-zone-key">
          <i class="tw-swatch is-over" aria-hidden="true" /> Overtrained: costs more compute, cheaper to serve per point.
        </span>
      </div>

      <div class="tw-scale-facts">
        <div class="tw-scale-fact">
          <span class="tw-label">Unique tokens you own</span>
          <span class="num">{tokensShort(uniqueTokens)}</span>
        </div>
        <div class="tw-scale-fact">
          <span class="tw-label">Needed for optimal (20 × params)</span>
          <span class="num">{tokensShort(needed)}</span>
        </div>
        <div class="tw-scale-fact">
          <span class="tw-label">Expected penalty</span>
          {under > 0.05 ? (
            <span class="num tone-bad">{`−${pointsText(under)} overall`}</span>
          ) : (
            <span class="tw-muted">{hidden ? 'Hidden by the quality floor' : ratio > 0 ? 'None' : '—'}</span>
          )}
        </div>
      </div>

      {canTokens && needed > uniqueTokens && (
        <p class="tw-scale-note tone-bad">
          {`You need ${tokensShort(needed)} tokens; you own ${tokensShort(uniqueTokens)}. Buy data or shrink the model.`}
        </p>
      )}
      {repeats > 1.001 && <p class="tw-scale-note">{`Data repeated ${repeats >= 10 ? Math.round(repeats) : repeats.toFixed(1)}×. Repeats count half.`}</p>}

      <div class="tw-scale-actions">
        <button type="button" class="btn btn-sm" disabled={!canTokens} onClick={() => patch({ tokReq: null })}>
          Make it compute-optimal
        </button>
        <span class="tw-faint tw-small">Sets tokens to 20 per parameter, capped by the data you own and the epoch limit.</span>
      </div>
    </div>
  );
}
