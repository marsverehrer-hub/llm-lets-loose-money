// Step 5: ready to train. The forecast band, Elo as a range, the build profile against the flagship, the hidden risk
// (? until ablated), validation errors, and an editable summary of every choice.
import { dispatch } from '../../store';
import { configSignature, RUN_TUNING } from '../../../sim/data/trainingOptions';
import { formatFlops, formatMoney, formatParams } from '../../../sim/util';
import { formatDays, Pill, Stat } from '../../components';
import { confTone, eloOf, pct, pointsText, r0, signedInt, shapeRows, tokensShort, optionName, quoteMoney, mult, STEP_NAMES } from './model';
import type { Ctx } from './model';
import { BandBar } from './kit';

export function StepReview({ ctx, goTo }: { ctx: Ctx; goTo: (step: 1 | 2 | 3 | 4) => void }) {
  const { s, sheet, est, fc, errs, selected, paramsB, tokensB, uniqueTokens, cloudPerFlop, ablCost, flagship, flagshipCaps, arena } = ctx;
  const cfg = sheet.cfg;
  const eloLo = fc ? eloOf(fc.low) : NaN;
  const eloHi = fc ? eloOf(fc.high) : NaN;
  const sig = configSignature(cfg);
  const ablDoneAt = s.flags[`ablationDone.${sig}`];
  const ablLeft = ablDoneAt !== undefined ? Math.max(0, Math.ceil(ablDoneAt - s.day)) : 0;
  const ablBlocked = !est || est.ablated || ablDoneAt !== undefined || !Number.isFinite(ablCost);
  const rows = shapeRows(fc?.caps ?? null, flagshipCaps);
  const ratio = est ? est.tokensPerParam : paramsB > 0 ? tokensB / paramsB : 0;
  const owned = s.data.owned.length;
  const experts = cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS;
  const under = fc?.undertrainPenalty ?? 0;
  const undertrained = (est?.underPenalty ?? 0) >= 0.5;
  const underText = undertrained ? (under > 0.05 ? ` · undertrained, expect −${pointsText(under)}` : ' · undertrained, hidden by the quality floor') : '';

  const runAbl = () => {
    if (!est) return;
    dispatch({ type: 'runAblation', paramsB, tokensB, datasetIds: selected, config: cfg });
  };

  const ablDesc =
    ablDoneAt !== undefined
      ? `Running. Results in ${ablLeft} day${ablLeft === 1 ? '' : 's'}.`
      : est?.ablated
        ? 'Revealed. Instability and incident risk show for this run sheet. Predictions stay sharper for a year.'
        : `About ${formatMoney(ablCost)} of cloud time and ${RUN_TUNING.ABLATION_DAYS} days. Reveals instability and incident risk, and halves the score uncertainty for a year.`;

  const archText = cfg.arch === 'moe' ? `${optionName(cfg.arch)} x${experts}` : optionName(cfg.arch);

  return (
    <div class="tw-stack">
      {errs.length > 0 && (
        <ul class="tw-errors" role="alert">
          {errs.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div class="tw-review">
        <section class="tw-panel">
          <div class="tw-dial-head">
            <span class="tw-label">Forecast overall</span>
            {fc ? <Pill tone={confTone(fc.confidence)}>{fc.confidence}</Pill> : <span class="tw-faint tw-small">No forecast yet</span>}
          </div>
          {fc ? (
            <>
              <BandBar low={fc.low} mid={fc.mid} high={fc.high} variant="lg" label={`Forecast overall ${r0(fc.low)} to ${r0(fc.high)}, mid ${r0(fc.mid)}`} />
              {fc.reasons.length > 0 && (
                <ul class="tw-bullets">
                  {fc.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <div class="tw-faint tw-small">A forecast from what the lab knows. Reality can land outside it.</div>
            </>
          ) : (
            <div class="tw-faint tw-small">Pick datasets in step 2 to see a forecast.</div>
          )}
          <div class="tw-stats">
            <Stat
              label="Elo"
              value={fc ? `${r0(eloLo)}–${r0(eloHi)}` : '—'}
              size="sm"
              hint={fc ? (arena ? `vs ${arena.lab}: ${signedInt(eloLo - arena.elo)} to ${signedInt(eloHi - arena.elo)}` : 'No rivals yet') : 'Waiting for a forecast'}
            />
            <Stat label="Time" value={est ? formatDays(est.days) : '—'} size="sm" hint={est && Number.isFinite(cloudPerFlop) ? `${formatMoney(est.totalFlops * cloudPerFlop)} cloud equivalent` : 'No cloud price'} />
            <Stat label="Cluster efficiency" value={est ? pct(est.clusterEfficiency) : '—'} size="sm" />
          </div>
        </section>

        <section class="tw-panel">
          <div class="tw-dial-head">
            <span class="tw-label">Build profile</span>
            <span class="tw-faint tw-small">{flagship ? `expected vs ${flagship.name}` : 'expected, no flagship yet'}</span>
          </div>
          {rows ? (
            <div class="tw-caps" role="table" aria-label="Expected capabilities against the flagship">
              {rows.map((r) => {
                const d = r.flagship === null ? null : r.expected - r.flagship;
                const tone = d === null ? 'dim' : d > 0.5 ? 'good' : d < -0.5 ? 'bad' : 'dim';
                return (
                  <div class="tw-cap-row" key={r.id} role="row">
                    <span class="tw-cap-k">{r.label}</span>
                    <span class="tw-cap-bar">
                      <span class="tw-cap-fill" style={`width:${r.expected.toFixed(1)}%`} />
                      {r.flagship !== null && <span class="tw-cap-mark" style={`left:${r.flagship.toFixed(1)}%`} />}
                    </span>
                    <span class="num tw-cap-v">{`~${Math.round(r.expected)}`}</span>
                    <span class={`num tw-cap-d tone-${tone}`}>
                      {d === null ? '—' : `${d > 0.5 ? '▲' : d < -0.5 ? '▼' : '='} ${Math.abs(d).toFixed(0)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div class="tw-faint tw-small">Pick datasets to see the build profile.</div>
          )}
          <div class="tw-faint tw-small">Expected values are a forecast, not a promise.</div>
        </section>
      </div>

      <section class="tw-panel">
        <div class="tw-dial-head">
          <span class="tw-label">Risk</span>
          <span class="tw-faint tw-small">Hidden until an ablation</span>
        </div>
        <div class="kv">
          <div class="kv-row">
            <span class="kv-k">Instability</span>
            <span class="kv-v">{est?.ablated ? est.instability.toFixed(2) : '?'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Incident risk</span>
            <span class="kv-v">{est?.ablated ? `${est.incidentRisk.toFixed(est.incidentRisk < 1 ? 2 : 1)} over the run` : '?'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Incident rate</span>
            <span class="kv-v">{est?.ablated ? `${(est.incidentRate * 365).toFixed(1)} a year` : '?'}</span>
          </div>
        </div>
        <div class="md-action">
          <div>
            <div class="md-label">Ablation</div>
            <div class="md-desc">{ablDesc}</div>
          </div>
          <button type="button" class="btn" disabled={ablBlocked} onClick={runAbl}>
            Run ablation
          </button>
        </div>
      </section>

      <section class="tw-panel">
        <div class="tw-label">Every choice</div>
        <div class="tw-summary">
          <SummaryRow label={STEP_NAMES[0]} value={`${sheet.name.trim() || 'Unnamed'} · ${formatParams(paramsB)} params · ${tokensShort(tokensB)} tokens · ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} per param${underText}`} onEdit={() => goTo(1)} />
          <SummaryRow label={STEP_NAMES[1]} value={`${selected.length} of ${owned} sets · ${tokensShort(uniqueTokens)} unique tokens${cfg.filters.length ? ` · ${cfg.filters.length} filter${cfg.filters.length === 1 ? '' : 's'}` : ''}`} onEdit={() => goTo(2)} />
          <SummaryRow label={STEP_NAMES[2]} value={`${archText} · ${optionName(cfg.tokenizer)} · ${optionName(cfg.context)}`} onEdit={() => goTo(3)} />
          <SummaryRow label={STEP_NAMES[3]} value={`${optionName(cfg.optimizer)} · ${optionName(cfg.precision)} · ${optionName(cfg.schedule)} · lr ${cfg.lr.toFixed(2)} · ${cfg.checkpointing} checkpoints${sheet.benchmaxx ? ' · benchmaxx' : ''}`} onEdit={() => goTo(4)} />
        </div>
        {sheet.benchmaxx && <div class="md-warn">Benchmaxx is on. Test sets go into the training data.</div>}
      </section>

      <section class="tw-panel">
        <div class="tw-label">More numbers</div>
        <div class="kv">
          <div class="kv-row">
            <span class="kv-k">Compute</span>
            <span class="kv-v">{est ? formatFlops(est.totalFlops) : '—'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Speed</span>
            <span class="kv-v">{est ? mult(est.speedMult) : '—'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Inference cost</span>
            <span class="kv-v">{est ? mult(1 / est.inferenceMult) : "—"}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Active parameters</span>
            <span class="kv-v">{est ? formatParams(est.activeParamsB) : '—'}</span>
          </div>
          <div class="kv-row">
            <span class="kv-k">Cloud equivalent</span>
            <span class="kv-v">{est ? quoteMoney(est.totalFlops * cloudPerFlop, formatMoney) : '—'}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div class="tw-summary-row">
      <span class="tw-label">{label}</span>
      <span class="tw-summary-v">{value}</span>
      <button type="button" class="btn btn-sm btn-ghost" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}
