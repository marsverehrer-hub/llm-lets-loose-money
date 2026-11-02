// v16 quick start (GAME_DESIGN §28.3): the short path to a run. Model type, then a preset, then a time budget, with a
// plain "fits your compute in N days / costs $X" readout, then Train. Every knob stays one click away: "Customize"
// opens the five-step wizard on the same sheet. Reads forecasts only, never hidden run fields.
import { useMemo } from 'preact/hooks';
import { dispatch, useGame } from '../../store';
import { Card, NetView, Pill, Tabs, formatDays, netSpecOfText, netSpecOfMedia } from '../../components';
import { formatMoney, formatParams, yearOf } from '../../../sim/util';
import { suggestCodename } from '../../../sim/data/names';
import { RECIPES } from '../../../sim/data/recipes';
import { MEDIA_PRESETS, MEDIA_STYLES, mediaArchById } from '../../../sim/data/imageModels';
import { optionById } from '../../../sim/data/trainingOptions';
import { planRecipe } from '../../../sim/systems/recipes';
import { activeParamsFor } from '../../../sim/systems/trainingMath';
import { cheapestCloudCostPerFlop } from '../../../sim/systems/training';
import { forecastTraining } from '../../../sim/systems/lab';
import { modelCaps } from '../../../sim/systems/capabilities';
import {
  estimateMediaRun,
  mediaArchsFor,
  mediaDatasetsFor,
  mediaKindLock,
  mediaPresetConfig,
  validateMediaRun,
} from '../../../sim/systems/imageGen';
import type { MediaKind } from '../../../sim/types';
import { uiRng } from '../panelKit';
import { getDraft, setView, updateDraft, resetDraft, type QuickPick } from './draft';
import { FIT_CHIPS, flagshipOf, posFor, quoteMoney, shapeRows, tokensShort } from './model';
import { BandBar, Chip, ShapeBars } from './kit';

const DEFAULT_PICK: QuickPick = { kind: 'text', recipe: 'balanced', mediaPreset: 'balanced', days: null, media: {} };
const KIND_TABS: { id: QuickPick['kind']; label: string }[] = [
  { id: 'text', label: 'Language model' },
  { id: 'image', label: 'Image model' },
  { id: 'video', label: 'Video model' },
];

export function QuickStart() {
  const s = useGame();
  const d = getDraft(s);
  const pick = d.quick ?? DEFAULT_PICK;
  const set = (p: Partial<QuickPick>) => updateDraft((x) => ({ ...x, quick: { ...(x.quick ?? DEFAULT_PICK), ...p } }));
  const name = d.sheet.name;
  const setName = (v: string) => updateDraft((x) => ({ ...x, sheet: { ...x.sheet, name: v } }));

  return (
    <Card
      code="NEW"
      title="New model"
      class="tw-card"
      actions={
        <button type="button" class="btn btn-sm btn-ghost" onClick={() => setView({ kind: 'list' })}>
          Cancel
        </button>
      }
    >
      <div class="tw-wiz">
        <div class="tw-stack">
          <div class="tw-group">
            <div class="tw-label">1 · What kind of model?</div>
            <Tabs variant="segmented" tabs={KIND_TABS.map((k) => ({ ...k, disabled: k.id !== 'text' && !!mediaKindLock(s, k.id) }))} value={pick.kind} onChange={(kind) => set({ kind, days: null })} />
            {pick.kind === 'text' ? (
              <div class="tw-small tw-muted">The main business: chat, API and enterprise. Competing for the top means competing with the biggest labs.</div>
            ) : (
              <div class="tw-small tw-muted">Cheaper to train than a frontier language model and quick to sell, but a smaller market that commoditises fast.</div>
            )}
            {(['image', 'video'] as const).map((k) => {
              const lock = mediaKindLock(s, k);
              return lock ? <div key={k} class="tw-faint tw-small">{lock}</div> : null;
            })}
          </div>

          <div class="tw-name-row">
            <label class="tw-label" for="qs-name">
              Codename
            </label>
            <input id="qs-name" class="input tw-name-input" type="text" maxLength={40} value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
            <button type="button" class="btn btn-sm" onClick={() => setName(suggestCodename(uiRng()))}>
              Suggest
            </button>
          </div>

          {pick.kind === 'text' ? <TextQuick pick={pick} set={set} name={name} /> : <MediaQuick kind={pick.kind} pick={pick} set={set} name={name} />}
        </div>
      </div>
    </Card>
  );
}

function TimeChips({ pick, set, presetDays }: { pick: QuickPick; set: (p: Partial<QuickPick>) => void; presetDays: number }) {
  return (
    <div class="tw-chips">
      <Chip on={pick.days === null} title="The preset's own time budget" onClick={() => set({ days: null })}>
        {`Preset (~${presetDays}d)`}
      </Chip>
      {FIT_CHIPS.map((c) => (
        <Chip key={c.fit} on={pick.days === c.fit} title={c.hint} onClick={() => set({ days: c.fit })}>
          {c.label}
        </Chip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// language models
// ---------------------------------------------------------------------------

function TextQuick({ pick, set, name }: { pick: QuickPick; set: (p: Partial<QuickPick>) => void; name: string }) {
  const s = useGame();
  const recipe = RECIPES.find((r) => r.id === pick.recipe) ?? RECIPES[0];
  const days = pick.days ?? recipe.days;
  const key = [pick.recipe, days, s.day, s.data.owned.length, s.research.completed.length, s.training?.id ?? '', s.media?.run?.id ?? ''].join('|');
  const plan = useMemo(() => planRecipe(s, recipe.id, name || 'Untitled', days), [key, name]);
  const a = plan?.action;
  const fc = a ? forecastTraining(s, a.paramsB, a.tokensB, a.datasetIds, a.techniques, a.config!) : null;
  const flagship = flagshipOf(s);
  const cost = plan ? plan.totalFlops * cheapestCloudCostPerFlop(s) : NaN;
  const errs: string[] = [];
  if (!name.trim()) errs.push('Give the model a codename.');
  if (!plan) errs.push(s.data.owned.length === 0 ? 'You own no data yet. Buy some in DAT.' : 'No training compute. Rent GPUs or raise the training share.');
  const busy = s.training ? `${s.training.name} is still training.` : null;
  const stages = (a?.config?.post ?? []).map((id) => optionById(id)?.name ?? id);
  const anneal = a?.config?.anneal ? optionById(a.config.anneal)?.name : null;

  const start = (queue: boolean) => {
    if (!a || errs.length) return;
    const action = { ...a, name: name.trim() };
    dispatch(queue ? { type: 'queueTraining', action } : action);
    resetDraft();
    setView({ kind: 'list' });
  };
  const customize = () => {
    if (!a) return updateDraft((x) => ({ ...x, mode: 'advanced', step: 1 }));
    updateDraft((x) => ({
      ...x,
      mode: 'advanced',
      step: 1,
      sheet: { ...x.sheet, cfg: a.config!, techs: a.techniques, fit: 'manual', paramPos: posFor(a.paramsB), tokReq: a.tokensB, picked: null },
    }));
  };

  return (
    <>
      <div class="tw-group">
        <div class="tw-label">2 · Pick a recipe</div>
        <div class="tw-chips">
          {RECIPES.map((r) => (
            <Chip key={r.id} on={r.id === recipe.id} title={r.blurb} onClick={() => set({ recipe: r.id, days: null })}>
              {r.name}
            </Chip>
          ))}
        </div>
        <div class="tw-small tw-muted">{recipe.blurb}</div>
      </div>

      <div class="tw-group">
        <div class="tw-label">3 · How long can it train?</div>
        <TimeChips pick={pick} set={set} presetDays={recipe.days} />
      </div>

      <div class="tw-group">
        <div class="tw-label">What you get</div>
        {a && plan ? (
          <>
            <div class="tw-readout num">{`${formatParams(a.paramsB)} params · ${tokensShort(a.tokensB)} tokens`}</div>
            <NetView spec={netSpecOfText(a.paramsB, a.config, activeParamsFor(a.paramsB, a.config!), optionById(a.config!.context)?.contextK)} seed="draft" height={170} />
            <div class="tw-readout">{`Fits your compute in ${formatDays(plan.days)} · about ${quoteMoney(cost, formatMoney)} if rented in the cloud`}</div>
            {fc && <BandBar variant="mini" low={fc.low} mid={fc.mid} high={fc.high} label={`Forecast overall ${Math.round(fc.low)} to ${Math.round(fc.high)}`} />}
            <ShapeBars rows={shapeRows(fc?.caps ?? null, flagship ? modelCaps(flagship, s) : null)} compact />
            <div class="tw-small tw-muted">
              {stages.length ? `Post-training: ${stages.join(', ')}.` : 'No post-training stages researched yet.'}
              {anneal ? ` Anneal: ${anneal}.` : ''}
              {a.techniques.length ? ` ${a.techniques.length} techniques.` : ''}
            </div>
            {fc?.reasons.slice(0, 2).map((r) => (
              <div key={r} class="tw-faint tw-small">
                {r}
              </div>
            ))}
          </>
        ) : (
          <div class="tw-faint tw-small">{errs[0]}</div>
        )}
        {s.media?.run && <div class="tw-small tw-muted">{`${s.media.run.name} is training too: this run gets the rest of the cluster.`}</div>}
      </div>

      <div class="tw-action">
        <button type="button" class="tw-link" onClick={customize}>
          Customize every knob
        </button>
        <span class="tw-chips">
          <button type="button" class={busy ? 'btn btn-primary' : 'btn'} disabled={errs.length > 0} title={errs[0] ?? 'Start when the slot frees'} onClick={() => start(true)}>
            Add to queue
          </button>
          <button type="button" class="btn btn-primary" disabled={errs.length > 0 || !!busy} title={busy ?? errs[0] ?? 'Start the run'} onClick={() => start(false)}>
            Train
          </button>
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// image and video models
// ---------------------------------------------------------------------------

function MediaQuick({ kind, pick, set, name }: { kind: MediaKind; pick: QuickPick; set: (p: Partial<QuickPick>) => void; name: string }) {
  const s = useGame();
  const preset = MEDIA_PRESETS.find((p) => p.id === pick.mediaPreset) ?? MEDIA_PRESETS[0];
  const days = pick.days ?? preset.days;
  const over = pick.media;
  const cfg = mediaPresetConfig(s, kind, preset.id, days, over);
  const est = cfg ? estimateMediaRun(s, cfg) : null;
  const sets = mediaDatasetsFor(s, kind);
  const owned = sets.filter((x) => x.owned);
  const shop = sets.filter((x) => !x.owned && x.available).sort((a, b) => a.def.price - b.def.price).slice(0, 3);
  const err = !name.trim() ? 'Give the model a codename.' : !cfg ? 'Buy some data for it first.' : validateMediaRun(s, cfg);
  const busy = s.media?.run ? `${s.media.run.name} is still training.` : null;
  const setOver = (p: QuickPick['media']) => set({ media: { ...over, ...p } });
  const arch = cfg ? mediaArchById(cfg.arch) : undefined;

  const start = () => {
    if (!cfg || err || busy) return;
    dispatch({ type: 'startMediaRun', name: name.trim(), config: cfg });
    resetDraft();
    setView({ kind: 'list' });
  };

  return (
    <>
      <div class="tw-group">
        <div class="tw-label">Data</div>
        {owned.length > 0 && <div class="tw-small">{`Training on ${owned.map((x) => x.def.name).join(', ')}.`}</div>}
        {shop.length > 0 && (
          <div class="tw-chips">
            {shop.map(({ def }) => (
              <button key={def.id} type="button" class="btn btn-sm" title={def.description} onClick={() => dispatch({ type: 'buyMediaDataset', datasetId: def.id })}>
                {`Buy ${def.name} · ${def.price > 0 ? formatMoney(def.price) : 'free'}`}
              </button>
            ))}
          </div>
        )}
        {shop.some((x) => x.def.legalRisk >= 0.5) && <div class="tw-faint tw-small">Scraped sets are cheap and good, and some of them end in court.</div>}
      </div>

      <div class="tw-group">
        <div class="tw-label">2 · Pick a preset</div>
        <div class="tw-chips">
          {MEDIA_PRESETS.map((p) => (
            <Chip key={p.id} on={p.id === preset.id} title={p.blurb} onClick={() => set({ mediaPreset: p.id, days: null, media: {} })}>
              {p.name}
            </Chip>
          ))}
        </div>
        <div class="tw-small tw-muted">{preset.blurb}</div>
      </div>

      <div class="tw-group">
        <div class="tw-label">3 · How long can it train?</div>
        <TimeChips pick={pick} set={set} presetDays={preset.days} />
      </div>

      <div class="tw-group">
        <div class="tw-label">What you get</div>
        {cfg && est ? (
          <>
            <div class="tw-readout num">{`${arch?.name ?? cfg.arch} · ${formatParams(cfg.paramsB)} params · ${Math.round(cfg.samplesM)}M samples · ${cfg.resolution}px`}</div>
            <NetView spec={netSpecOfMedia(cfg)} seed="draft-media" height={170} />
            <div class="tw-readout">{`Fits your compute in ${formatDays(est.days)} · about ${quoteMoney(est.cloudCost, formatMoney)} if rented in the cloud`}</div>
            <BandBar variant="mini" low={est.low} mid={est.mid} high={est.high} label={`Forecast overall ${Math.round(est.low)} to ${Math.round(est.high)}`} />
            {est.reasons.map((r) => (
              <div key={r} class="tw-faint tw-small">
                {r}
              </div>
            ))}
            {s.training && <div class="tw-small tw-muted">{`Shares the cluster with ${s.training.name}: it gets 40% of the training compute until that run ends.`}</div>}
          </>
        ) : (
          <div class="tw-faint tw-small">{err}</div>
        )}
      </div>

      <details class="tw-group">
        <summary class="tw-label">Advanced</summary>
        <div class="tw-stack">
          <div class="tw-chips" role="group" aria-label="Architecture">
            {mediaArchsFor(s, kind).map(({ arch: a, lock }) => (
              <Chip key={a.id} on={cfg?.arch === a.id} title={lock ?? a.description} onClick={() => !lock && setOver({ arch: over.arch === a.id ? undefined : a.id })}>
                {lock ? `${a.name} (locked)` : a.name}
              </Chip>
            ))}
          </div>
          <div class="tw-chips" role="group" aria-label="Resolution">
            {([256, 512, 1024] as const).map((r) => (
              <Chip key={r} on={cfg?.resolution === r} onClick={() => setOver({ resolution: r })}>
                {`${r}px`}
              </Chip>
            ))}
          </div>
          <div class="tw-chips" role="group" aria-label="Style">
            {MEDIA_STYLES.filter((x) => !x.minYear || yearOf(s.day) >= x.minYear).map((x) => (
              <Chip key={x.id} on={cfg?.style === x.id} title={x.description} onClick={() => setOver({ style: x.id })}>
                {x.name}
              </Chip>
            ))}
          </div>
          <label class="tw-check-row">
            <input type="checkbox" checked={!!cfg?.distill} onChange={(e) => setOver({ distill: (e.currentTarget as HTMLInputElement).checked })} />
            <span>Few-step distillation: much faster to serve, a little worse.</span>
          </label>
          <label class="tw-check-row">
            <input type="checkbox" checked={!!cfg?.optOut} onChange={(e) => setOver({ optOut: (e.currentTarget as HTMLInputElement).checked })} />
            <span>Honour artist opt-outs: most of the legal risk goes, some of the aesthetics too.</span>
          </label>
          {owned.length > 1 && (
            <div class="tw-chips" role="group" aria-label="Datasets">
              {owned.map(({ def }) => {
                const on = !over.datasetIds || over.datasetIds.includes(def.id);
                const all = owned.map((x) => x.def.id);
                return (
                  <Chip
                    key={def.id}
                    on={on}
                    title={def.description}
                    onClick={() => {
                      const cur = over.datasetIds ?? all;
                      const next = on ? cur.filter((id) => id !== def.id) : [...cur, def.id];
                      setOver({ datasetIds: next.length ? next : undefined });
                    }}
                  >
                    {def.name}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
      </details>

      <div class="tw-action">
        <span>{busy && <Pill tone="warn">Busy</Pill>}</span>
        <button type="button" class="btn btn-primary" disabled={!!err || !!busy} title={busy ?? err ?? 'Start the run'} onClick={start}>
          Train
        </button>
      </div>
    </>
  );
}
