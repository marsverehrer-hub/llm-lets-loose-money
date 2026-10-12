// OWNER: UI-M (Models panel). Reads the sim and dispatches actions. No sim rules live here.
// Fog of training (GAME_DESIGN §16): the UI shows forecasts, never the hidden truths. It must not read
// run.hidden, lab.lrOffsets, lab.emergenceJitter or model.vibes. Use the lab.ts API only.
// Body: header, then one of: the pre-training wizard, the fine-tune wizard, or the release, distill and merge wizards
// (all full width, replacing the body), or the live run (or a "New model" call to action), the model table,
// the model page (src/ui/panels/model/) for the selected model, and the lab notebook.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../store';
import { formatFlops, formatParams } from '../../sim/util';
import { emergenceById } from '../../sim/data/emergences';
import { currentRunBand, emergenceJournal, labStats, provisionalElo } from '../../sim/systems/lab';
import type { JournalRow } from '../../sim/systems/lab';
import { specById, specOf } from '../../sim/systems/capabilities';
import { weightClassOf } from '../../sim/systems/classes';
import { datasetTokensOf, estimateTraining, trainingRatePerDay, TRAINING_TUNING } from '../../sim/systems/training';
import { resolveRun, runConfig } from '../../sim/systems/trainingMath';
import { RUN_TUNING } from '../../sim/data/trainingOptions';
import type { GameState, Id, Model, TrainingConfig, TrainingRun } from '../../sim/types';
import { Card, PanelHeader, PanelIntro, Pill, ProgressBar, Stat, Tabs, clamp, formatDays, useIsMobile } from '../components';
import { plain, tdate } from '../shell/fmt';
import { BandBar, LossChart } from './train/kit';
import { FinetuneWizard } from './train/FinetuneWizard';
import { TrainWizard } from './train/TrainWizard';
import { ReleaseWizard } from './train/ReleaseWizard';
import { DistillWizard } from './train/DistillWizard';
import { MergeWizard } from './train/MergeWizard';
import { TrainingQueue } from './train/TrainingQueue';
import { getView, setView, useDraftStore } from './train/draft';
import { arenaTop, bandText, fmtCtx, lineageRows, optionName, pct, r0, tokensShort } from './train/model';
import { ArmButton } from './model/parts';
import { CLASS_NAME, ModelPage } from './model/ModelPage';
import { statusPills } from './model/status';
import './models.css';
import { ConfirmButton } from './panelKit';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createVault, CAM as VAULT_CAM } from '../../scenes/models';
import './models-rows.css';
// ---------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------

export function ModelsPanel() {
  const s = useGame();
  useDraftStore();
  const view = getView();
  const [selId, setSelId] = useState<Id | null>(null);

  // A model awaiting its eval-day reveal stays off the list so the scores aren't spoiled behind the modal.
  const hiddenId = s.pendingReveal?.modelId;
  const models = s.models.filter((m) => m.id !== hiddenId).sort((a, b) => b.trainedDay - a.trainedDay);
  const liveModels = models.filter((m) => m.releasedDay !== null && !m.deprecated);
  const arena = arenaTop(s);
  const detail = models.find((m) => m.id === selId) ?? models[0] ?? null;
  const header = (
    <PanelHeader
      code="MDL"
      title="Models"
      subtitle="Train on data you own, then release the models that survive."
      actions={
        <div class="md-kpis">
          <Stat label="Live" value={String(liveModels.length)} size="sm" />
          <Stat label="Arena #1" value={arena ? String(Math.round(arena.elo)) : '—'} hint={arena ? arena.lab : 'No rivals yet'} size="sm" />
        </div>
      }
    />
  );

  if (view.kind === 'train') {
    return (
      <div class="panel md-panel">
        {header}
        <TrainWizard />
      </div>
    );
  }
  if (view.kind === 'finetune' && s.models.some((m) => m.id === view.parentId)) {
    return (
      <div class="panel md-panel">
        {header}
        <FinetuneWizard parentId={view.parentId} onClose={() => setView({ kind: 'list' })} />
      </div>
    );
  }
  if (view.kind === 'release' && s.models.some((m) => m.id === view.modelId)) {
    return (
      <div class="panel md-panel">
        {header}
        <ReleaseWizard modelId={view.modelId} onClose={() => setView({ kind: 'list' })} />
      </div>
    );
  }
  if (view.kind === 'distill' && s.models.some((m) => m.id === view.teacherId)) {
    return (
      <div class="panel md-panel">
        {header}
        <DistillWizard teacherId={view.teacherId} onClose={() => setView({ kind: 'list' })} />
      </div>
    );
  }
  if (view.kind === 'merge' && s.models.some((m) => m.id === view.aId)) {
    return (
      <div class="panel md-panel">
        {header}
        <MergeWizard aId={view.aId} onClose={() => setView({ kind: 'list' })} />
      </div>
    );
  }

  return (
    <div class="panel md-panel">
      {header}
      <PanelIntro id="models">Train models on the data you own, then release the ones that hold up. Pick a model to see its profile.</PanelIntro>
      <SceneView
        state={s}
        make={createVault}
        cam={VAULT_CAM}
        camId="CAM-06"
        label="Your model vault: each model on a pedestal, live ones lit, unreleased ones behind glass, the training run under a crane"
        onSelect={(hit) => {
          if (hit.id.startsWith('model:')) setSelId(hit.id.slice(6));
        }}
      />
      {s.training ? <LiveRun s={s} run={s.training} /> : <StartCard s={s} />}
      <TrainingQueue />
      <ModelList s={s} models={models} selId={detail?.id ?? null} onSelect={setSelId} />
      {detail && <ModelPage key={detail.id} s={s} m={detail} />}
      <LabNotebook s={s} />
    </div>
  );
}

/** Compact call to action when nothing trains: one line of lab context and the New model button. */
function StartCard({ s }: { s: GameState }) {
  const stats = labStats(s);
  const runs = Object.values(stats.runsByArch).reduce((a, n) => a + n, 0);
  const line =
    stats.forecastError === null
      ? 'No runs yet. Your first forecast is a guess.'
      : `Forecast accuracy ±${stats.forecastError.toFixed(1)} over recent runs · ${runs} run${runs === 1 ? '' : 's'} · ${stats.verified} verified set${stats.verified === 1 ? '' : 's'}`;
  return (
    <Card code="NEW" title="Start a new model">
      <div class="md-action">
        <div>
          <div class="md-desc">{line}</div>
        </div>
        <button type="button" class="btn btn-primary" onClick={() => setView({ kind: 'train' })}>
          New model
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// live run
// ---------------------------------------------------------------------------

/** What extending a run by `fraction` would do: extra days at the current rate and the overall change. */
function extendPreview(s: GameState, run: TrainingRun, cfg: TrainingConfig, fraction: number) {
  const tokens = run.tokensB * (1 + fraction);
  const headroom = tokens <= datasetTokensOf(s, run.datasetIds) * TRAINING_TUNING.MAX_EPOCHS + 1e-9;
  const rate = trainingRatePerDay(s, cfg);
  if (!headroom || rate <= 0) return { headroom, addDays: NaN, addOverall: NaN };
  const phys = resolveRun(s, run.paramsB, tokens, run.datasetIds, run.techniques, cfg);
  const addDays = (phys.totalFlops - run.totalFlops) / rate;
  const now = estimateTraining(s, run.paramsB, run.tokensB, run.datasetIds, run.techniques, cfg).overall;
  const next = estimateTraining(s, run.paramsB, tokens, run.datasetIds, run.techniques, cfg).overall;
  return { headroom, addDays, addOverall: next - now };
}

function LiveRun({ s, run }: { s: GameState; run: TrainingRun }) {
  const cfg = runConfig(s, run);
  const isFt = run.kind === 'finetune';
  const progress = run.totalFlops > 0 ? clamp(run.doneFlops / run.totalFlops, 0, 1) : 0;
  const rate = trainingRatePerDay(s, cfg);
  const remaining = Math.max(0, run.totalFlops - run.doneFlops);
  const eta = rate > 0 ? remaining / rate + (run.overheadLeft ?? 0) : Infinity;
  const pending = !!run.pendingIncident && run.pendingIncident.result === undefined;
  const elapsed = Math.max(0, s.day - run.startedDay);
  const lastLoss = run.lossHistory.length ? run.lossHistory[run.lossHistory.length - 1] : undefined;
  const keep = RUN_TUNING.KEEP[cfg.schedule] ?? RUN_TUNING.KEEP.cosine;
  const keepNow = keep.base + keep.slope * progress;
  const log = [...(run.log ?? [])].reverse().slice(0, 8);
  const parent = run.parentId ? s.models.find((m) => m.id === run.parentId) : undefined;
  const spec = specById(run.specId);
  // The predicted final loss is optional: older runs and some fine-tunes carry none.
  const forecastLoss = run.forecastLoss;
  const hasForecastLoss = typeof forecastLoss === 'number' && isFinite(forecastLoss);
  const elapsedAndLeft = elapsed + (Number.isFinite(eta) ? eta : 0);
  const band = currentRunBand(s);
  const checkpoints = run.checkpoints ?? [];
  const emergeLines = (run.emerged ?? []).flatMap((id) => {
    const def = emergenceById(id);
    if (!def) return [];
    const line = (run.log ?? []).find((l) => {
      const t = plain(l.text);
      return t.includes(def.name) || t.includes(plain(def.description));
    });
    return [{ def, day: line?.day }];
  });

  return (
    <Card
      code={isFt ? 'FT' : 'RUN'}
      title={isFt ? 'Fine-tuning' : 'Training'}
      subtitle={run.name}
      glow
      actions={<ArmButton label="Cancel run" confirmLabel="Discard progress?" onConfirm={() => dispatch({ type: 'cancelTraining' })} />}
    >
      <div class="md-stack">
        <ProgressBar
          value={progress}
          label={isFt ? `${parent?.name ?? 'Parent'} to ${spec?.name ?? 'spec'}` : `${run.datasetIds.length} sets · ${run.techniques.length} techniques`}
          right={`${(progress * 100).toFixed(1)}% · ETA ${formatDays(eta)}`}
          height={8}
        />

        <div class="md-readouts">
          <Stat label="Elapsed" value={`${elapsed} day${elapsed === 1 ? '' : 's'}`} size="sm" />
          <Stat
            label="Loss"
            value={lastLoss !== undefined ? lastLoss.toFixed(3) : '—'}
            hint={hasForecastLoss ? `Forecast ${(forecastLoss as number).toFixed(3)}` : undefined}
            size="sm"
          />
          <Stat label="Stalled" value={`${Math.ceil(run.stallDays ?? 0)} days`} size="sm" />
          <Stat label="Incidents" value={String((run.incidents ?? []).length)} size="sm" />
        </div>

        {band && (
          <div class="md-live-band">
            <div class="md-row-between md-wrap">
              <span class="md-label">Current band</span>
              <span class="md-desc">{band.source === 'checkpoint' ? 'Narrowed by the last checkpoint' : 'From the launch forecast'}</span>
            </div>
            <BandBar low={band.low} mid={band.mid} high={band.high} label={`Current band ${r0(band.low)} to ${r0(band.high)}`} />
            {run.forecast && (
              <div class="md-desc">
                Launched as <span class="num">{`${r0(run.forecast.low)} to ${r0(run.forecast.high)}`}</span>, {run.forecast.confidence}.
              </div>
            )}
          </div>
        )}

        {run.lossHistory.length >= 2 ? (
          <LossChart
            history={run.lossHistory}
            forecastEnd={hasForecastLoss ? (forecastLoss as number) : null}
            totalDays={elapsedAndLeft}
          />
        ) : (
          <div class="md-desc">The loss curve starts after the first simulated day.</div>
        )}

        <div class="md-section-title">Checkpoints</div>
        <div class="md-cps">
          {[0.25, 0.5, 0.75].map((at) => {
            const c = checkpoints.find((r) => Math.abs(r.at - at) < 1e-6);
            const reached = progress >= at;
            return (
              <div class={`md-cp ${c ? 'is-done' : ''}`} key={at}>
                <span class="md-label">{`${Math.round(at * 100)}%`}</span>
                {c ? (
                  <>
                    <span class="num md-cp-val">{`${r0(c.reading)} ± ${bandText(c.band)}`}</span>
                    {c.note && <span class="md-desc">{plain(c.note)}</span>}
                  </>
                ) : (
                  <span class="md-desc">{reached ? 'Evaluating' : 'Pending'}</span>
                )}
              </div>
            );
          })}
        </div>

        {emergeLines.length > 0 && (
          <div class="md-emerge-list">
            {emergeLines.map(({ def, day }) => {
              const at = day !== undefined && elapsedAndLeft > 0 ? clamp((day - run.startedDay) / elapsedAndLeft, 0, 1) : null;
              return (
                <div class="md-emerge" key={def.id}>
                  <span class="num md-emerge-at">{at === null ? 'Found' : `At ${Math.round(at * 100)}%`}</span>
                  <span class="md-emerge-text">
                    <strong>{def.name}.</strong> {plain(def.description)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {pending && <div class="md-warn">Paused. A decision is waiting for you.</div>}
        {run.benchmaxx && <div class="md-warn">Benchmaxx. Test sets are in the training data.</div>}

        {isFt ? (
          <div class="md-desc">Fine-tunes run to completion. They can't be stopped early or extended.</div>
        ) : (
          <div class="md-controls">
            <div class="md-action">
              <div>
                <div class="md-label">Stop early</div>
                <div class="md-desc">
                  Finishes now at {pct(progress)} and keeps {pct(keepNow)} of full-run quality. Saves about {formatDays(eta)}.
                </div>
              </div>
              <button
                type="button"
                class="btn"
                disabled={progress <= 0 || pending}
                title={progress <= 0 ? 'Nothing trained yet. Cancel instead.' : undefined}
                onClick={() => dispatch({ type: 'earlyStopTraining' })}
              >
                Stop early
              </button>
            </div>
            {[0.25, 0.5].map((f) => {
              const ext = extendPreview(s, run, cfg, f);
              const ok = ext.headroom && !pending;
              return (
                <div class="md-action" key={f}>
                  <div>
                    <div class="md-label">{`Extend +${Math.round(f * 100)}%`}</div>
                    <div class="md-desc">
                      {!ext.headroom
                        ? 'Not enough data headroom. Buy more data to extend this far.'
                        : `Adds about ${Number.isFinite(ext.addDays) ? formatDays(ext.addDays) : '—'} and ${ext.addOverall >= 0 ? '+' : ''}${ext.addOverall.toFixed(1)} overall.`}
                    </div>
                  </div>
                  <button type="button" class="btn" disabled={!ok} onClick={() => dispatch({ type: 'extendTraining', fraction: f })}>
                    {`Extend +${Math.round(f * 100)}%`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div class="md-section-title">Run log</div>
        {log.length === 0 ? (
          <div class="md-desc">Nothing yet. Incidents and rollbacks land here.</div>
        ) : (
          <table class="table md-log">
            <tbody>
              {log.map((l, i) => (
                <tr key={`${l.day}-${i}`}>
                  <td class="num faint">{`Day ${Math.max(1, l.day - run.startedDay)}`}</td>
                  <td class={l.kind === 'good' ? 'good' : l.kind === 'bad' ? 'bad' : ''}>{plain(l.text)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// model table
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// model list
// ---------------------------------------------------------------------------

/** The four capability scores shown as mini bars on every model row. */
const KEY_SCORES: { key: 'reasoning' | 'coding' | 'chat' | 'safety'; label: string }[] = [
  { key: 'reasoning', label: 'Reasoning' },
  { key: 'coding', label: 'Coding' },
  { key: 'chat', label: 'Chat' },
  { key: 'safety', label: 'Safety' },
];

type ListMode = 'cards' | 'table';

/** One score as a labelled bar on a 0 to 100 scale. Unreleased models have no measured capability scores yet. */
function MiniBar({ label, value, hidden, tone }: { label: string; value: number; hidden?: boolean; tone?: 'accent' }) {
  const w = hidden || !isFinite(value) ? 0 : clamp(value, 0, 100);
  return (
    <span class={`md-mini ${tone === 'accent' ? 'is-accent' : ''}`}>
      <span class="md-mini-k">{label}</span>
      <span class="md-mini-track" aria-hidden="true">
        <span class="md-mini-fill" style={{ width: `${w.toFixed(1)}%` }} />
      </span>
      <span class="md-mini-v num">{hidden || !isFinite(value) ? '—' : Math.round(value)}</span>
    </span>
  );
}

/** Retire a released model: one small button with a confirm step (v10.1: no "More" menu). */
function MoreMenu({ m }: { m: Model }) {
  return (
    <span title="Takes it out of the lineup. It stops counting as a live model.">
      <ConfirmButton class="pn-btn--sm" label="Retire" confirmLabel="Retire it?" onConfirm={() => dispatch({ type: 'deprecateModel', modelId: m.id })} />
    </span>
  );
}

/** One model as a visual row: name, status, mini bars for the overall and the four key scores, then Elo and spec. */
function ModelRow({ s, m, prefix, selected, onSelect }: { s: GameState; m: Model; prefix: string; selected: boolean; onSelect: (id: Id) => void }) {
  const spec = specOf(m);
  const elo = provisionalElo(s, m);
  const emergent = m.emergences?.length ?? 0;
  const hidden = m.releasedDay === null;
  return (
    <li class={`md-row ${selected ? 'sel' : ''} ${m.deprecated ? 'dim' : ''}`}>
      <button type="button" class="md-row-main" aria-pressed={selected} onClick={() => onSelect(m.id)}>
        <span class="md-row-head">
          {prefix && <span class="md-lin">{prefix}</span>}
          <span class="md-row-name">{m.name}</span>
          <Pill tone="cyan" title="Weight class: active size against the frontier of this year">
            {CLASS_NAME[weightClassOf(s, m)]}
          </Pill>
          {statusPills(m).map((p) => (
            <Pill key={p.label} tone={p.tone} title={p.title}>
              {p.label}
            </Pill>
          ))}
          {elo.provisional && <Pill tone="muted">Provisional</Pill>}
        </span>
        <span class="md-row-bars">
          <MiniBar label="Overall" value={m.overall} tone="accent" />
          {KEY_SCORES.map((k) => (
            <MiniBar key={k.key} label={k.label} value={m.scores[k.key]} hidden={hidden} />
          ))}
        </span>
        <span class="md-row-meta">
          <span>
            <span class="md-label">Elo</span> <span class="num">{Math.round(elo.elo)}</span>
            {elo.provisional && <span class="faint md-band-inline">{` ±${Math.round(elo.band)}`}</span>}
          </span>
          <span class={spec ? '' : 'faint'}>{spec ? spec.name : 'Base'}</span>
          {emergent > 0 && <span class="md-quirk-count">{`${emergent} emergent`}</span>}
        </span>
      </button>
      {!m.deprecated && (
        <div class="md-row-foot">
          {m.releasedDay === null ? (
            <button type="button" class="btn btn-sm btn-primary" onClick={() => setView({ kind: 'release', modelId: m.id })}>
              Release
            </button>
          ) : (
            <MoreMenu m={m} />
          )}
        </div>
      )}
    </li>
  );
}

/** The same models as a dense table, behind the Table toggle. Scores and Elo only; the profile is one click away. */
function ModelTable({ s, rows, selId, onSelect }: { s: GameState; rows: { m: Model; prefix: string }[]; selId: Id | null; onSelect: (id: Id) => void }) {
  return (
    <div class="table-wrap">
      <table class="table md-models">
        <thead>
          <tr>
            <th>Name</th>
            <th class="num">Overall</th>
            <th class="num">Reasoning</th>
            <th class="num">Coding</th>
            <th class="num">Chat</th>
            <th class="num">Safety</th>
            <th class="num">Elo</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, prefix }) => {
            const selected = m.id === selId;
            const elo = provisionalElo(s, m);
            // Unreleased: the capability scores are not measured yet. Only the overall is known (after eval day).
            const hidden = m.releasedDay === null;
            const score = (v: number) => (hidden ? '—' : String(Math.round(v)));
            return (
              <tr key={m.id} class={`${selected ? 'sel' : ''} ${m.deprecated ? 'dim' : ''}`} onClick={() => onSelect(m.id)} aria-selected={selected}>
                <td>
                  {prefix && <span class="md-lin">{prefix}</span>}
                  {m.name}
                  <Pill tone="cyan" title="Weight class: active size against the frontier of this year">
                    {CLASS_NAME[weightClassOf(s, m)]}
                  </Pill>
                </td>
                <td class="num">{Math.round(m.overall)}</td>
                <td class="num">{score(m.scores.reasoning)}</td>
                <td class="num">{score(m.scores.coding)}</td>
                <td class="num">{score(m.scores.chat)}</td>
                <td class="num">{score(m.scores.safety)}</td>
                <td class="num">
                  {Math.round(elo.elo)}
                  {elo.provisional && <span class="faint md-band-inline">{` ±${Math.round(elo.band)}`}</span>}
                </td>
                <td>
                  <span class="md-status">
                    {statusPills(m).map((p) => (
                      <Pill key={p.label} tone={p.tone} title={p.title}>
                        {p.label}
                      </Pill>
                    ))}
                  </span>
                </td>
                <td class="actions" onClick={(e) => e.stopPropagation()}>
                  {m.releasedDay === null && !m.deprecated ? (
                    <button type="button" class="btn btn-sm btn-primary" onClick={() => setView({ kind: 'release', modelId: m.id })}>
                      Release
                    </button>
                  ) : !m.deprecated ? (
                    <MoreMenu m={m} />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The model list: visual rows by default, the table behind a toggle (desktop only; phones always get rows). */
function ModelList({ s, models, selId, onSelect }: { s: GameState; models: Model[]; selId: Id | null; onSelect: (id: Id) => void }) {
  const isPhone = useIsMobile();
  const [mode, setMode] = useState<ListMode>('cards');
  const rows = lineageRows(models);
  const showTable = !isPhone && mode === 'table';
  return (
    <Card
      code="LST"
      title="Models"
      subtitle={`${models.length} trained`}
      flush
      actions={
        models.length > 0 && !isPhone ? (
          <Tabs<ListMode> variant="segmented" value={mode} onChange={setMode} tabs={[{ id: 'cards', label: 'Cards' }, { id: 'table', label: 'Table' }]} />
        ) : undefined
      }
    >
      {models.length === 0 ? (
        <div class="md-pad">
          <div class="md-empty-line">No models yet. Start a new model to train one.</div>
        </div>
      ) : showTable ? (
        <ModelTable s={s} rows={rows} selId={selId} onSelect={onSelect} />
      ) : (
        <ul class="md-rows" aria-label="Models">
          {rows.map(({ m, prefix }) => (
            <ModelRow key={m.id} s={s} m={m} prefix={prefix} selected={m.id === selId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// lab notebook
// ---------------------------------------------------------------------------

/**
 * The lab's own record: runs, data, forecast accuracy and the discoveries table.
 * Undiscovered emergences show as "???". Their name, threshold and model stay hidden even from this view.
 */
function LabNotebook({ s }: { s: GameState }) {
  const [open, setOpen] = useState(false);
  const stats = labStats(s);
  // Found rows first, oldest discovery first. Undiscovered rows keep the journal's order.
  const journal: JournalRow[] = [...emergenceJournal(s)].sort((a, b) => {
    if (!a.found || !b.found) return (b.found ? 1 : 0) - (a.found ? 1 : 0);
    return a.found.day - b.found.day;
  });
  const archRuns = Object.entries(stats.runsByArch)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalRuns = archRuns.reduce((a, [, n]) => a + n, 0);
  const modelName = (id: Id): string => s.models.find((m) => m.id === id)?.name ?? '—';

  return (
    <Card
      code="LAB"
      title="Lab notebook"
      subtitle={stats.undiscovered > 0 ? `${stats.undiscovered} still undiscovered` : 'Nothing left to find'}
      actions={
        <button type="button" class="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      }
    >
      {open && (
        <div class="md-stack">
          <div class="md-readouts">
            <Stat
              label="Runs"
              value={String(totalRuns)}
              hint={archRuns.length > 0 ? archRuns.map(([id, n]) => `${optionName(id)} ${n}`).join(' · ') : 'None yet'}
              size="sm"
            />
            <Stat label="Largest run" value={stats.largestFlops > 0 ? formatFlops(stats.largestFlops) : '—'} size="sm" />
            <Stat label="Verified datasets" value={String(stats.verified)} size="sm" />
            <Stat
              label="Forecast accuracy"
              value={stats.forecastError === null ? '—' : `±${stats.forecastError.toFixed(1)}`}
              hint={stats.forecastError === null ? 'No runs yet' : 'Average error, recent runs'}
              size="sm"
            />
          </div>

          <div class="md-section-title">Discoveries</div>
          {journal.length === 0 ? (
            <div class="md-empty-line">No emergences recorded yet.</div>
          ) : (
            <div class="table-wrap table-scroll">
              <table class="table md-journal">
                <thead>
                  <tr>
                    <th>Emergence</th>
                    <th>What it does</th>
                    <th class="num">Threshold</th>
                    <th>Model</th>
                    <th>Found</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((row) =>
                    row.found ? (
                      <tr key={row.def.id}>
                        <td>{plain(row.def.name)}</td>
                        <td class="md-journal-desc">{plain(row.def.description)}</td>
                        <td class="num">{`10^${row.found.threshold.toFixed(1)} FLOP`}</td>
                        <td>{modelName(row.found.modelId)}</td>
                        <td class="num">{tdate(row.found.day)}</td>
                      </tr>
                    ) : (
                      <tr key={row.def.id}>
                        <td class="faint">???</td>
                        <td class="md-journal-desc md-desc">{row.hint ? plain(row.hint) : '—'}</td>
                        <td class="num faint">???</td>
                        <td class="faint">???</td>
                        <td class="num faint">???</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div class="md-desc">
            {stats.undiscovered > 0 ? `${stats.undiscovered} still undiscovered.` : 'Every emergence in the notebook is found.'}
          </div>
        </div>
      )}
    </Card>
  );
}

