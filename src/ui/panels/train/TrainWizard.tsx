// Pre-training wizard: five steps (Size, Data, Architecture, Recipe, Review). A full-width view that replaces the
// Models panel body while open. The draft lives in the module store, so switching panels keeps it.
import { useEffect, useMemo } from 'preact/hooks';
import { dispatch, useGame } from '../../store';
import { Card, formatDays } from '../../components';
import { formatMoney } from '../../../sim/util';
import { cheapestCloudCostPerFlop, availableDatasets, availableTechniques, datasetTokensOf, estimateTraining, trainingRatePerDay, TRAINING_TUNING } from '../../../sim/systems/training';
import { forecastTraining } from '../../../sim/systems/lab';
import { datasetById } from '../../../sim/systems/data';
import { modelCaps } from '../../../sim/systems/capabilities';
import { effParamsFor } from '../../../sim/systems/trainingMath';
import { defaultConfig, optionById, optionLock, RUN_TUNING, validateConfig } from '../../../sim/data/trainingOptions';
import type { DatasetDef, Id, TrainingConfig } from '../../../sim/types';
import { getDraft, resetDraft, setView, updateDraft, useDraftStore } from './draft';
import type { StepId } from './draft';
import {
  AUTO_DAYS,
  CHINCHILLA,
  STEP_NAMES,
  STEP_QUESTIONS,
  T_MIN,
  fitPos,
  flagshipOf,
  paramsAt,
  quoteMoney,
  arenaTop,
  shapeRows,
} from './model';
import type { Ctx, Sheet } from './model';
import { BandBar, ShapeBars } from './kit';
import { StepSize } from './StepSize';
import { StepData } from './StepData';
import { StepArch } from './StepArch';
import { StepRecipe } from './StepRecipe';
import { StepReview } from './StepReview';

export function TrainWizard() {
  const s = useGame();
  useDraftStore();
  const d = getDraft(s);
  const { sheet, step } = d;

  const patch = (p: Partial<Sheet>) => updateDraft((x) => ({ ...x, sheet: { ...x.sheet, ...p } }));
  const patchCfg = (p: Partial<TrainingConfig>) => updateDraft((x) => ({ ...x, sheet: { ...x.sheet, cfg: { ...x.sheet.cfg, ...p } } }));
  const goTo = (st: StepId) => updateDraft((x) => ({ ...x, step: st }));

  // Owned datasets in catalogue order, then any owned set the catalogue no longer lists.
  const ownedSets: DatasetDef[] = availableDatasets(s).filter((x) => s.data.owned.includes(x.id));
  for (const id of s.data.owned) {
    if (ownedSets.some((x) => x.id === id)) continue;
    const x = datasetById(s, id);
    if (x) ownedSets.push(x);
  }
  const ownedIds = ownedSets.map((x) => x.id);
  const selected = (sheet.picked ?? ownedIds).filter((id) => ownedIds.includes(id));
  const uniqueTokens = datasetTokensOf(s, selected);
  const maxTokens = TRAINING_TUNING.MAX_EPOCHS * uniqueTokens;
  const canTokens = maxTokens >= T_MIN;
  const canSlideTokens = canTokens && maxTokens > T_MIN * 1.01;
  const rate = trainingRatePerDay(s, sheet.cfg);

  // Auto sizing is a search over the parameter scale; memoised on what it depends on.
  const fitKey = [selected.join(','), JSON.stringify(sheet.cfg), Math.round(rate), sheet.fit].join('|');
  const fitP = useMemo(() => fitPos(s, sheet.cfg, selected, sheet.fit === 'manual' ? AUTO_DAYS : sheet.fit), [fitKey]);
  const pos = sheet.fit === 'manual' ? sheet.paramPos : fitP;
  const paramsB = paramsAt(pos);
  const tokenDefault = canTokens ? Math.min(CHINCHILLA * effParamsFor(paramsB, sheet.cfg), maxTokens) : 0;
  const tokensB = canTokens ? Math.min(Math.max(sheet.tokReq ?? tokenDefault, T_MIN), maxTokens) : 0;
  const techOptions = availableTechniques(s);
  const techs = sheet.techs.filter((id: Id) => techOptions.some((t) => t.id === id));
  const est = selected.length > 0 && canTokens ? estimateTraining(s, paramsB, tokensB, selected, techs, sheet.cfg) : null;
  const fc = est ? forecastTraining(s, paramsB, tokensB, selected, techs, sheet.cfg) : null;

  const errs: string[] = [];
  if (s.training) errs.push(`${s.training.name} is still training. Stop or finish it first.`);
  if (!sheet.name.trim()) errs.push('Give the model a name.');
  if (selected.length === 0) errs.push('Pick at least one dataset you own.');
  else if (!canTokens) errs.push('The selected datasets have no usable tokens.');
  if (rate <= 0) errs.push('No training compute. Rent GPUs or raise the training share.');
  const cfgErr = validateConfig(s, sheet.cfg) ?? null;
  if (cfgErr) errs.push(cfgErr);

  const cloudPerFlop = cheapestCloudCostPerFlop(s);
  const ablCost = est ? RUN_TUNING.ABLATION_FRACTION * est.totalFlops * cloudPerFlop : 0;
  const flagship = flagshipOf(s);
  const ctx: Ctx = {
    s,
    sheet,
    ownedSets,
    selected,
    pos,
    paramsB,
    tokensB,
    uniqueTokens,
    maxTokens,
    canTokens,
    canSlideTokens,
    techs,
    rate,
    est,
    fc,
    cfgErr,
    errs,
    defaults: defaultConfig(s),
    cloudPerFlop,
    ablCost,
    flagship,
    flagshipCaps: flagship ? modelCaps(flagship, s) : null,
    arena: arenaTop(s),
    patch,
    patchCfg,
  };

  // A draft can outlive the research it was built on (a superseded arch, a filter that was never unlocked). Swap any
  // choice that is now locked for the current default, so the draft stays trainable without a dead-end error.
  useEffect(() => {
    const cur = sheet.cfg;
    const next: TrainingConfig = { ...cur };
    let changed = false;
    const groups = ['arch', 'tokenizer', 'context', 'optimizer', 'precision', 'schedule'] as const;
    for (const g of groups) {
      const opt = optionById(cur[g]);
      if (!opt || optionLock(s, opt)) {
        next[g] = ctx.defaults[g];
        changed = true;
      }
    }
    const filters = cur.filters.filter((id) => {
      const opt = optionById(id);
      return !!opt && !optionLock(s, opt);
    });
    if (filters.length !== cur.filters.length) {
      next.filters = filters;
      changed = true;
    }
    if (changed) updateDraft((x) => ({ ...x, sheet: { ...x.sheet, cfg: next } }));
  });

  const shape = shapeRows(fc?.caps ?? null, ctx.flagshipCaps);
  const stepIndex = step - 1;
  const last = step === 5;
  const runAction = () => ({
    type: 'startTraining' as const,
    name: sheet.name.trim(),
    paramsB,
    tokensB,
    datasetIds: selected,
    techniques: techs,
    benchmaxx: sheet.benchmaxx,
    config: sheet.cfg,
  });
  const trainNow = () => {
    if (errs.length > 0 || !est) return;
    dispatch(runAction());
    // Reset after Train: the next "New model" starts from a fresh sheet.
    resetDraft();
    setView({ kind: 'list' });
  };
  // Queueing accepts a busy slot (that is the point of the queue); every other blocker still applies.
  const queueErrs = s.training ? errs.filter((e) => !e.includes('is still training')) : errs;
  const queueNow = () => {
    if (queueErrs.length > 0 || !est) return;
    dispatch({ type: 'queueTraining', action: runAction() });
    resetDraft();
    setView({ kind: 'list' });
  };

  return (
    <Card code="NEW" title="New pretraining run" class="tw-card" subtitle={`Step ${step} of 5 · ${STEP_NAMES[stepIndex]}`} actions={
      <button type="button" class="btn btn-sm btn-ghost" onClick={() => setView({ kind: 'list' })}>
        Cancel
      </button>
    }>
      <div class="tw-wiz">
        <div class="tw-step-now" aria-live="polite">{`Step ${step} of 5 · ${STEP_NAMES[stepIndex]}`}</div>
        <nav class="tw-stepper" aria-label="Wizard steps">
          {STEP_NAMES.map((name, i) => {
            const n = (i + 1) as StepId;
            const current = n === step;
            const done = n < step;
            return (
              <button
                key={name}
                type="button"
                class={`tw-step ${current ? 'is-current' : ''} ${done ? 'is-done' : ''}`}
                disabled={!done}
                aria-current={current ? 'step' : undefined}
                onClick={() => goTo(n)}
              >
                <span class="num tw-step-n">{n}</span>
                <span class="tw-step-name">{name}</span>
              </button>
            );
          })}
        </nav>

        <h2 class="tw-q">{STEP_QUESTIONS[stepIndex]}</h2>

        <div class="tw-body">
          {step === 1 && <StepSize ctx={ctx} />}
          {step === 2 && <StepData ctx={ctx} />}
          {step === 3 && <StepArch ctx={ctx} />}
          {step === 4 && <StepRecipe ctx={ctx} />}
          {step === 5 && <StepReview ctx={ctx} goTo={(st) => goTo(st)} />}
        </div>

        <footer class="tw-foot">
          <div class="tw-foot-facts">
            <div class="tw-foot-band">
              {fc ? <BandBar variant="mini" low={fc.low} mid={fc.mid} high={fc.high} label={`Forecast overall ${Math.round(fc.low)} to ${Math.round(fc.high)}`} /> : <span class="tw-faint tw-small">No forecast yet</span>}
            </div>
            <div class="num tw-foot-cost">
              {est ? `${quoteMoney(est.totalFlops * cloudPerFlop, formatMoney)} cloud · ${formatDays(est.days)}` : '—'}
            </div>
          </div>
          <div class="tw-foot-shape">
            <ShapeBars rows={shape} compact />
          </div>
          <div class="tw-foot-nav">
            <button type="button" class="btn" disabled={step === 1} onClick={() => goTo((step - 1) as StepId)}>
              Back
            </button>
            {last ? (
              <>
                <button
                  type="button"
                  class={s.training ? 'btn btn-primary' : 'btn'}
                  disabled={queueErrs.length > 0 || !est}
                  title={queueErrs[0] ?? 'Add the run to the training queue'}
                  onClick={queueNow}
                >
                  Add to queue
                </button>
                <button type="button" class="btn btn-primary" disabled={errs.length > 0 || !est} title={errs[0] ?? 'Start the run'} onClick={trainNow}>
                  Train
                </button>
              </>
            ) : (
              <button type="button" class="btn btn-primary" onClick={() => goTo((step + 1) as StepId)}>
                Next
              </button>
            )}
          </div>
        </footer>
      </div>
    </Card>
  );
}
