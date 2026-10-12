// OWNER: Agent W-FT. Step-by-step fine-tune wizard.
// Reads the sim through its APIs only. Forecasts are bands (GAME_DESIGN §16). Never reads run.hidden or model.vibes.
// Steps: 1 Direction, 2 Personality (persona specs only), 3 Options, 4 Review. Each step is visited on purpose:
// nothing auto-advances and nothing is accepted by default.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Slider as ShellSlider, useIsMobile } from '../../components';
import { dispatch, getState, useGame } from '../../store';
import { formatFlops, formatParams } from '../../../sim/util';
import { RESEARCH } from '../../../sim/data/research';
import { SPECIALIZATIONS } from '../../../sim/data/specializations';
import { quirkById } from '../../../sim/data/quirks';
import { RUN_TUNING, defaultConfig } from '../../../sim/data/trainingOptions';
import { isResearched } from '../../../sim/systems/research';
import { LAB_TUNING, forecastFinetune } from '../../../sim/systems/lab';
import {
  availableSpecs,
  estimateFinetune,
  headlineBenchmarks,
  modelCaps,
  personaInferenceMult,
  specById,
  takesPersona,
} from '../../../sim/systems/capabilities';
import { trainingRatePerDay } from '../../../sim/systems/training';
import { CAP_IDS } from '../../../sim/types';
import type {
  CapId,
  Capabilities,
  DataKind,
  Forecast,
  GameState,
  Id,
  Model,
  Persona,
  ProductKind,
  SpecializationDef,
} from '../../../sim/types';
import { Pill, clamp, formatDays } from '../../components';
import './finetune.css';

type StepId = 'direction' | 'personality' | 'options' | 'review';
type KnobKey = keyof Persona;

const STEP_LABEL: Record<StepId, string> = {
  direction: 'Direction',
  personality: 'Personality',
  options: 'Options',
  review: 'Review',
};
const STEP_QUESTION: Record<StepId, string> = {
  direction: 'What should it become?',
  personality: 'How should it talk?',
  options: 'What else should change?',
  review: 'Ready to fine-tune?',
};

const KIND_LABEL: Record<DataKind, string> = {
  web: 'Web',
  books: 'Books',
  code: 'Code',
  science: 'Science',
  dialogue: 'Dialogue',
  synthetic: 'Synthetic',
  multimodal: 'Multimodal',
};
const CAP_SHORT: Record<CapId, string> = {
  knowledge: 'Knowledge',
  reasoning: 'Reasoning',
  math: 'Math',
  coding: 'Coding',
  agentic: 'Agentic',
  chat: 'Chat',
  vision: 'Vision',
  safety: 'Safety',
  multilingual: 'Multilingual',
  longContext: 'Long ctx',
};
const PRODUCT_LABEL: Record<ProductKind, string> = { api: 'API', chat: 'Chat', enterprise: 'Enterprise' };

/** Display groups for the direction tiles. Specs carry no category, so they are grouped by what they are for. */
const GROUP_OF: Record<Id, string> = {
  instruct: 'Assistant',
  companion: 'Assistant',
  safe_assistant: 'Assistant',
  polyglot: 'Assistant',
  coder: 'Code and agents',
  agentic_coder: 'Code and agents',
  autonomous_swe: 'Code and agents',
  reasoner: 'Reasoning',
  math_olympian: 'Reasoning',
  deep_researcher: 'Reasoning',
  doctor: 'Domain experts',
  lawyer: 'Domain experts',
  quant: 'Domain experts',
  vision: 'Vision and robots',
  omni: 'Vision and robots',
  robotics: 'Vision and robots',
  mini: 'Small and cheap',
  uncensored: 'Unfiltered',
};
const GROUP_ORDER = ['Assistant', 'Code and agents', 'Reasoning', 'Domain experts', 'Vision and robots', 'Small and cheap', 'Unfiltered', 'Other'];

const ZERO: Persona = { helpfulness: 0, verbosity: 0, sycophancy: 0 };
const PRESETS: { id: string; label: string; p: Persona }[] = [
  { id: 'neutral', label: 'Neutral', p: ZERO },
  { id: 'concise', label: 'Concise pro', p: { helpfulness: 0.3, verbosity: -0.8, sycophancy: -0.5 } },
  { id: 'friendly', label: 'Friendly', p: { helpfulness: 0.6, verbosity: 0.4, sycophancy: 0.2 } },
  { id: 'yesman', label: 'Yes-man', p: { helpfulness: 0.4, verbosity: 0.6, sycophancy: 1 } },
];
const KNOBS: { k: KnobKey; label: string }[] = [
  { k: 'helpfulness', label: 'Helpfulness' },
  { k: 'verbosity', label: 'Verbosity' },
  { k: 'sycophancy', label: 'Sycophancy' },
];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const r0 = (v: number): string => (isFinite(v) ? String(Math.round(v)) : '—');
const eloOf = (overall: number): number => LAB_TUNING.ELO_BASE + LAB_TUNING.ELO_PER_POINT * overall;
const confTone = (c: Forecast['confidence']): 'good' | 'info' | 'warn' | 'bad' =>
  c === 'tight' ? 'good' : c === 'decent' ? 'info' : c === 'rough' ? 'warn' : 'bad';
const sameP = (a: Persona, b: Persona): boolean =>
  Math.abs(a.helpfulness - b.helpfulness) < 0.001 &&
  Math.abs(a.verbosity - b.verbosity) < 0.001 &&
  Math.abs(a.sycophancy - b.sycophancy) < 0.001;
const fmtKnob = (v: number): string => (v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${Math.abs(v).toFixed(1)}` : '0.0');
const multText = (v: number): string => String(Number(v.toFixed(2)));

/** Value rounded to the shown precision, keeping its sign. */
function shown(v: number, digits: number): number {
  const n = Number(Math.abs(v).toFixed(digits));
  return v < 0 ? -n : n;
}

/** Signed mono number, coloured up or down. `invert` flips the colour for things that are bad when they rise. */
function Num({ v, digits = 0, unit = '', invert = false }: { v: number; digits?: number; unit?: string; invert?: boolean }) {
  if (!isFinite(v)) return <span class="num ft-num ft-zero">—</span>;
  const x = shown(v, digits);
  const tone = x === 0 ? 'ft-zero' : x > 0 !== invert ? 'ft-pos' : 'ft-neg';
  const text = x === 0 ? '0' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
  return (
    <span class={`num ft-num ${tone}`}>
      {text}
      {unit}
    </span>
  );
}

/** Multiplier, e.g. ×1.3. `tone` picks the colour rule. */
function Mult({ v, tone = 'auto' }: { v: number; tone?: 'auto' | 'invert' | 'neutral' }) {
  const up = v > 1;
  const cls = tone === 'neutral' || v === 1 ? 'ft-zero' : up !== (tone === 'invert') ? 'ft-pos' : 'ft-neg';
  return <span class={`num ft-num ${cls}`}>{`×${multText(v)}`}</span>;
}

/** Capability changes of a spec, biggest first. */
function capList(sp: SpecializationDef): [CapId, number][] {
  return CAP_IDS.filter((k) => (sp.capAdd[k] ?? 0) !== 0)
    .map((k) => [k, sp.capAdd[k] ?? 0] as [CapId, number])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
}

function productList(sp: SpecializationDef): [ProductKind, number][] {
  return (Object.entries(sp.productFit ?? {}) as [ProductKind, number][]).filter(([, v]) => v !== 1);
}

function fitHint(sp: SpecializationDef): string {
  const best = productList(sp)
    .filter(([, v]) => v > 1)
    .sort((a, b) => b[1] - a[1])[0];
  return best ? `Fits ${PRODUCT_LABEL[best[0]]}` : 'Fits any product';
}

/** Why a specialisation is closed: the research or dataset it still needs. */
function lockReason(s: GameState, sp: SpecializationDef): string {
  if (sp.requiresResearch && !isResearched(s, sp.requiresResearch)) {
    return `Needs ${RESEARCH.find((r) => r.id === sp.requiresResearch)?.name ?? sp.requiresResearch}`;
  }
  if (sp.requiresDatasetKind) return `Needs a ${KIND_LABEL[sp.requiresDatasetKind]} dataset`;
  return 'Locked';
}

/** All trade-offs of one spec as mono chips: caps, products, size, scandal, hype. */
function SpecStats({ sp }: { sp: SpecializationDef }) {
  const caps = capList(sp);
  const uniform = caps.length >= 8 && caps.every(([, v]) => v === caps[0][1]);
  const hype = sp.releaseHype ?? 0;
  const scandal = sp.scandalRisk ?? 1;
  const params = sp.paramsMult ?? 1;
  return (
    <span class="ft-stats">
      {uniform ? (
        <span class="ft-stat">
          Every cap <Num v={caps[0][1]} />
        </span>
      ) : (
        caps.map(([k, v]) => (
          <span class="ft-stat" key={k}>
            {CAP_SHORT[k]} <Num v={v} />
          </span>
        ))
      )}
      {productList(sp).map(([k, v]) => (
        <span class="ft-stat" key={k}>
          {PRODUCT_LABEL[k]} <Mult v={v} />
        </span>
      ))}
      {params !== 1 && (
        <span class="ft-stat">
          Params <Mult v={params} tone="neutral" />
        </span>
      )}
      {scandal !== 1 && (
        <span class="ft-stat">
          Scandal <Mult v={scandal} tone="invert" />
        </span>
      )}
      {hype !== 0 && (
        <span class="ft-stat">
          Hype <Num v={hype} />
        </span>
      )}
    </span>
  );
}

/** Capability shape: parent against the forecast after the fine-tune, rounded to whole points. */
interface ShapeRow {
  k: CapId;
  now: number;
  after: number;
  d: number;
}
function shapeRows(parent: Capabilities, after: Capabilities): ShapeRow[] {
  return CAP_IDS.map((k) => {
    const now = Math.round(parent[k]);
    const a = Math.round(after[k]);
    return { k, now, after: a, d: a - now };
  });
}

/** A forecast band: low to high, with a mid marker. Numbers are mono. */
function FtBand({ low, mid, high, big = false }: { low: number; mid: number; high: number; big?: boolean }) {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const pad = Math.max(3, (hi - lo) * 0.6);
  const d0 = lo - pad;
  const span = hi - lo + 2 * pad;
  const at = (v: number): number => clamp((v - d0) / span, 0, 1) * 100;
  return (
    <div class={`ft-band${big ? ' ft-band-big' : ''}`} role="img" aria-label={`Forecast ${r0(lo)} to ${r0(hi)}, best guess ${r0(mid)}`}>
      <div class="ft-band-track">
        <span class="ft-band-range" style={`left:${at(lo).toFixed(2)}%;width:${(at(hi) - at(lo)).toFixed(2)}%`} />
        <span class="ft-band-mid" style={`left:${at(mid).toFixed(2)}%`} />
      </div>
      <div class="ft-band-nums">
        <span class="num ft-band-lo" style={`left:${at(lo).toFixed(2)}%`}>
          {r0(lo)}
        </span>
        <span class="num ft-band-midnum" style={`left:${at(mid).toFixed(2)}%`}>
          {r0(mid)}
        </span>
        <span class="num ft-band-hi" style={`left:${at(hi).toFixed(2)}%`}>
          {r0(hi)}
        </span>
      </div>
    </div>
  );
}

function Lineage({ m }: { m: Model }) {
  const ids = m.lineage ?? (m.specId ? [m.specId] : []);
  const crumbs: { text: string; kind: 'base' | 'spec' | 'next' }[] = [
    { text: 'Base', kind: 'base' },
    ...ids.map((id) => ({ text: specById(id)?.name ?? id, kind: 'spec' as const })),
    { text: '?', kind: 'next' },
  ];
  return (
    <nav class="ft-lineage" aria-label="Lineage">
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 && <span class="ft-arrow"> → </span>}
          <span class={c.kind === 'next' ? 'ft-crumb-next' : 'ft-crumb'}>{c.text}</span>
        </span>
      ))}
    </nav>
  );
}

/** Tile for one specialisation. Selecting it does not advance the wizard. */
function SpecTile({ sp, on, onPick }: { sp: SpecializationDef; on: boolean; onPick: (id: Id) => void }) {
  return (
    <button type="button" class={`ft-tile${on ? ' ft-tile-on' : ''}`} aria-pressed={on} onClick={() => onPick(sp.id)}>
      <span class="ft-tile-name">{sp.name}</span>
      <SpecStats sp={sp} />
      <span class="ft-tile-fit">{fitHint(sp)}</span>
    </button>
  );
}

/** Full numbers for the selected spec, as key/value rows. */
function SpecDetail({ s, m, sp }: { s: GameState; m: Model; sp: SpecializationDef }) {
  const est = estimateFinetune(s, m.id, sp.id, false);
  const fc = forecastFinetune(s, m.id, sp.id);
  const rows: [string, ComponentChildren][] = [
    ['Time', <span class="num">{est ? formatDays(est.days) : '—'}</span>],
    ['Compute', <span class="num">{est ? formatFlops(est.flops) : '—'}</span>],
    ['Overall', <span class="num">{`${r0(fc.low)}–${r0(fc.high)}`}</span>],
  ];
  if (sp.paramsMult !== undefined && sp.paramsMult !== 1) {
    rows.push(['Params', <span>{`${formatParams(m.paramsB)} → ${formatParams(m.paramsB * sp.paramsMult)}`}</span>]);
  }
  for (const [k, v] of capList(sp)) rows.push([CAP_SHORT[k], <Num v={v} />]);
  for (const [k, v] of productList(sp)) rows.push([`${PRODUCT_LABEL[k]} fit`, <Mult v={v} />]);
  if ((sp.scandalRisk ?? 1) !== 1) rows.push(['Scandal risk', <Mult v={sp.scandalRisk ?? 1} tone="invert" />]);
  if ((sp.releaseHype ?? 0) !== 0) rows.push(['Release hype', <Num v={sp.releaseHype ?? 0} />]);
  return (
    <div class="ft-detail">
      <div class="ft-detail-head">
        <span class="ft-detail-name">{sp.name}</span>
        <span class="ft-faint">{sp.suffix}</span>
      </div>
      <p class="ft-flavour">{sp.description}</p>
      <dl class="ft-kv">
        {rows.map(([k, v]) => (
          <div class="ft-kv-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One personality knob's plain consequence, with mono numbers. */
function Consequence({ k, v }: { k: KnobKey; v: number }) {
  if (k === 'helpfulness') {
    const word = v > 0.05 ? 'More helpful' : v < -0.05 ? 'More guarded' : 'Default';
    return (
      <span>
        {word}: chat <Num v={RUN_TUNING.PERSONA_HELPFUL_CHAT * v} />, safety <Num v={RUN_TUNING.PERSONA_HELPFUL_SAFETY * v} />
      </span>
    );
  }
  if (k === 'verbosity') {
    const word = v > 0.05 ? 'More verbose' : v < -0.05 ? 'Terser' : 'Default';
    const cost = (1 / personaInferenceMult({ verbosity: v }) - 1) * 100;
    return (
      <span>
        {word}: chat <Num v={RUN_TUNING.PERSONA_VERBOSE_CHAT * v} />, serving cost <Num v={cost} unit="%" />
      </span>
    );
  }
  const word = v > 0.05 ? 'More sycophantic' : v < -0.05 ? 'Blunter' : 'Default';
  const attraction = RUN_TUNING.PERSONA_SYCOPHANCY_ATTRACTION * v * 100;
  return (
    <span>
      {word}: short-term chat users <Num v={attraction} unit="%" />
      {v > 0.05 ? (
        <>
          , reputation <Num v={-RUN_TUNING.PERSONA_SYCOPHANCY_REP_PER_DAY * v} digits={3} unit=" a day" />
        </>
      ) : v < -0.05 ? (
        ', no reputation drain'
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// the wizard
// ---------------------------------------------------------------------------

export function FinetuneWizard({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const isPhone = useIsMobile();
  const s = useGame();
  const m = s.models.find((x) => x.id === parentId);
  const [step, setStep] = useState<StepId>('direction');
  const [specId, setSpecId] = useState<Id | null>(null);
  const [persona, setPersona] = useState<Persona>(ZERO);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [removeQuirk, setRemoveQuirk] = useState<Id>('');
  const [benchmaxx, setBenchmaxx] = useState(false);
  const [showLocked, setShowLocked] = useState(false);

  if (!m) {
    return (
      <div class="ft-root">
        <div class="ft-empty">That model no longer exists.</div>
        <div class="ft-foot-btns">
          <button type="button" class="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const options = SPECIALIZATIONS.filter((sp) => sp.from.includes(m.specId ?? 'base'));
  const openSet = new Set(availableSpecs(s, m).map((sp) => sp.id));
  const sp = options.find((x) => x.id === specId && openSet.has(x.id)) ?? null;
  const knobs = sp !== null && takesPersona(sp.id);
  const personaOk = isResearched(s, 'persona_vectors');
  const knobPersona = knobs ? persona : undefined;
  const est = sp ? estimateFinetune(s, m.id, sp.id, benchmaxx, knobPersona) : null;
  const fc = sp ? forecastFinetune(s, m.id, sp.id, knobPersona) : null;
  const parentCaps = modelCaps(m, s);
  const rate = trainingRatePerDay(s, m.config ?? defaultConfig(s));
  const run = s.training;
  const defaultName = sp ? `${m.name}${sp.suffix}` : '';
  const name = nameDraft ?? defaultName;

  const leaf = options.length === 0;
  const visible: StepId[] = knobs ? ['direction', 'personality', 'options', 'review'] : ['direction', 'options', 'review'];
  const cur: StepId = visible.includes(step) ? step : 'direction';
  const idx = visible.indexOf(cur);
  const isLast = idx === visible.length - 1;

  let blocker = '';
  if (run) blocker = `${run.name} is training. Stop or finish it first.`;
  else if (leaf) blocker = 'Nothing below this model. It is a leaf of the tree.';
  else if (openSet.size === 0) blocker = 'No specialisation is open for this model. Check the research tree.';
  else if (rate <= 0) blocker = 'No compute is allocated to training. Rent GPUs or raise the training share.';
  const footBlock = leaf ? '' : blocker;
  const stepBlock = !leaf && cur === 'direction' && !sp ? 'Pick a direction.' : '';
  const launchBlock = footBlock || (!leaf && !sp ? 'Pick a direction.' : '');

  const shape = fc ? shapeRows(parentCaps, fc.caps) : null;
  const changed = shape ? shape.filter((r) => r.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)) : [];

  const pick = (id: Id) => setSpecId(id);
  const setKnob = (k: KnobKey, v: number) => setPersona((p) => ({ ...p, [k]: Math.round(v * 10) / 10 }));
  const next = () => {
    if (idx < visible.length - 1) setStep(visible[idx + 1]);
  };
  const back = () => {
    if (idx > 0) setStep(visible[idx - 1]);
  };

  const finetuneAction = (spec: NonNullable<typeof sp>) => ({
    type: 'startFinetune' as const,
    parentId: m.id,
    specId: spec.id,
    name: name.trim() || defaultName,
    benchmaxx,
    ...(knobs ? { persona: { ...persona } } : {}),
    ...(removeQuirk && personaOk ? { removeQuirk } : {}),
  });
  const launch = () => {
    if (!sp || launchBlock) return;
    const before = getState().training;
    dispatch(finetuneAction(sp));
    // The sim replaces the training slot only when it accepts the run. A refusal shows as a toast and the wizard stays open.
    if (getState().training !== before) onClose();
  };
  // Queueing accepts a busy slot; the other blockers still apply.
  const queueBlock = !sp
    ? openSet.size === 0
      ? 'No specialisation is open for this model. Check the research tree.'
      : 'Pick a direction.'
    : rate <= 0
      ? 'No compute is allocated to training. Rent GPUs or raise the training share.'
      : '';
  const queueLaunch = () => {
    if (!sp || queueBlock) return;
    const before = getState().trainingQueue?.length ?? 0;
    dispatch({ type: 'queueTraining', action: finetuneAction(sp) });
    if ((getState().trainingQueue?.length ?? 0) !== before) onClose();
  };

  // ---- step bodies ------------------------------------------------------------

  const openSpecs = options.filter((x) => openSet.has(x.id));
  const lockedSpecs = options.filter((x) => !openSet.has(x.id));
  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: openSpecs.filter((x) => (GROUP_OF[x.id] ?? 'Other') === g),
  })).filter((x) => x.items.length > 0);

  const directionBody = (
    <>
      <div class="ft-groups">
        {groups.map((grp) => (
          <div class="ft-group" key={grp.g}>
            <div class="ft-group-title">{grp.g}</div>
            <div class="ft-tiles">
              {grp.items.map((x) => (
                <SpecTile key={x.id} sp={x} on={sp?.id === x.id} onPick={pick} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {lockedSpecs.length > 0 && (
        <div class="ft-locked">
          <button type="button" class="ft-locked-btn" aria-expanded={showLocked} onClick={() => setShowLocked(!showLocked)}>
            {`${lockedSpecs.length} locked`} {showLocked ? '▴' : '▾'}
          </button>
          {showLocked && (
            <ul class="ft-locked-list">
              {lockedSpecs.map((x) => (
                <li key={x.id}>
                  <span>{x.name}</span>
                  <span class="ft-muted">{lockReason(s, x)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {sp ? <SpecDetail s={s} m={m} sp={sp} /> : <div class="ft-muted">Pick one to see its numbers.</div>}
    </>
  );

  const personalityBody = (
    <>
      <div class="ft-row-between ft-wrap">
        <div class="ft-presets" role="group" aria-label="Presets">
          {PRESETS.map((pr) => {
            const on = personaOk && sameP(persona, pr.p);
            return (
              <button
                key={pr.id}
                type="button"
                class={`ft-chip${on ? ' ft-chip-on' : ''}`}
                aria-pressed={on}
                disabled={!personaOk}
                onClick={() => setPersona({ ...pr.p })}
              >
                {pr.label}
              </button>
            );
          })}
        </div>
        {!personaOk && <span class="ft-muted">Needs persona vectors research. Knobs stay at zero.</span>}
      </div>
      <div class="ft-knobs">
        {KNOBS.map(({ k, label }) => {
          const v = personaOk ? persona[k] : 0;
          return (
            <div class="ft-knob" key={k}>
              <span class="ft-knob-label">{label}</span>
              {isPhone ? (
                <ShellSlider value={v} min={-1} max={1} step={0.1} label={label} disabled={!personaOk} onChange={(x) => setKnob(k, x)} />
              ) : (
                <input
                  type="range"
                  class="slider ft-slider"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={v}
                  disabled={!personaOk}
                  aria-label={label}
                  style={`--p:${(((v + 1) / 2) * 100).toFixed(2)}%`}
                  onInput={(e) => setKnob(k, Number((e.currentTarget as HTMLInputElement).value))}
                />
              )}
              <span class="num ft-knob-val">{fmtKnob(v)}</span>
              <span class="ft-knob-cons">
                <Consequence k={k} v={v} />
              </span>
            </div>
          );
        })}
      </div>
    </>
  );

  const quirkIds = m.quirks ?? [];
  const optionsBody = (
    <>
      <div class="ft-field">
        <span class="ft-label" id="ft-name-label">
          Name
        </span>
        <div class="ft-name-row">
          <input
            class="input ft-name"
            type="text"
            maxLength={40}
            value={name}
            placeholder={defaultName || 'Fine-tune name'}
            aria-labelledby="ft-name-label"
            onInput={(e) => setNameDraft((e.currentTarget as HTMLInputElement).value)}
          />
          <span class="num ft-count">{`${name.length}/40`}</span>
        </div>
      </div>

      <div class="ft-field">
        <span class="ft-label">Remove a quirk</span>
        {quirkIds.length === 0 ? (
          <span class="ft-muted">{`${m.name} has no visible quirks.`}</span>
        ) : (
          <>
            <div class="ft-chips">
              <button type="button" class={`ft-chip${removeQuirk === '' ? ' ft-chip-on' : ''}`} aria-pressed={removeQuirk === ''} onClick={() => setRemoveQuirk('')}>
                None
              </button>
              {quirkIds.map((id) => {
                const q = quirkById(id);
                const on = removeQuirk === id;
                return (
                  <button
                    key={id}
                    type="button"
                    class={`ft-chip${on ? ' ft-chip-on' : ''}`}
                    aria-pressed={on}
                    disabled={!personaOk}
                    onClick={() => setRemoveQuirk(id)}
                  >
                    {q?.name ?? id}
                    {q?.good !== undefined && <span class="ft-chip-tag">{q.good ? 'good' : 'bad'}</span>}
                  </button>
                );
              })}
            </div>
            <span class="ft-muted">{personaOk ? 'Dropped during this fine-tune.' : 'Needs persona vectors research.'}</span>
          </>
        )}
        {isResearched(s, 'sae_steering') && <span class="ft-muted">SAE steering also strips one negative quirk from every fine-tune.</span>}
      </div>

      <div class="ft-field">
        <span class="ft-label">Benchmaxx</span>
        <button
          type="button"
          class={`ft-tile ft-toggle${benchmaxx ? ' ft-tile-on' : ''}`}
          role="checkbox"
          aria-checked={benchmaxx}
          onClick={() => setBenchmaxx(!benchmaxx)}
        >
          <span class="ft-tile-name">{benchmaxx ? 'On: test sets in the training data' : 'Off'}</span>
          <span class="ft-tile-fit">Inflates benchmark scores</span>
        </button>
        <span class="ft-warn">Scores inflate on every benchmark that existed at training time. Scandal risk if anyone checks.</span>
      </div>
    </>
  );

  const reviewBody = (
    <>
      <div class="ft-review">
        <section class="ft-panel" aria-label="Forecast">
          <div class="ft-row-between">
            <span class="ft-label">Overall score</span>
            {fc && <Pill tone={confTone(fc.confidence)}>{fc.confidence}</Pill>}
          </div>
          {fc ? <FtBand big low={fc.low} mid={fc.mid} high={fc.high} /> : <span class="ft-muted">Pick a direction.</span>}
          {fc && fc.reasons.length > 0 && (
            <ul class="ft-reasons">
              {fc.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <dl class="ft-kv">
            <div class="ft-kv-row">
              <dt>Elo</dt>
              <dd class="num">{fc ? `${r0(eloOf(fc.low))}–${r0(eloOf(fc.high))}` : '—'}</dd>
            </div>
            <div class="ft-kv-row">
              <dt>Time</dt>
              <dd class="num">{est ? formatDays(est.days) : '—'}</dd>
            </div>
            <div class="ft-kv-row">
              <dt>Compute</dt>
              <dd class="num">{est ? formatFlops(est.flops) : '—'}</dd>
            </div>
          </dl>
          {est && (
            <>
              <span class="ft-label">Expected benchmarks</span>
              <dl class="ft-kv">
                {headlineBenchmarks(s)
                  .slice(0, 3)
                  .map((def) => (
                    <div class="ft-kv-row" key={def.id}>
                      <dt>{def.name}</dt>
                      <dd class="num">{est.benchmarks[def.id] === undefined ? '—' : `~${est.benchmarks[def.id].toFixed(1)}`}</dd>
                    </div>
                  ))}
              </dl>
            </>
          )}
        </section>

        <section class="ft-panel" aria-label="Capability shape">
          <div class="ft-row-between">
            <span class="ft-label">Capability shape</span>
            <span class="ft-muted">{`${m.name} → expected`}</span>
          </div>
          {shape ? (
            <div class="ft-caps">
              <div class="ft-cap-row ft-cap-head">
                <span>Capability</span>
                <span />
                <span class="num">Now</span>
                <span class="num">After</span>
                <span class="num">Change</span>
              </div>
              {shape.map((r) => (
                <div class="ft-cap-row" key={r.k}>
                  <span>{CAP_SHORT[r.k]}</span>
                  <span class="ft-cap-bar" aria-hidden="true">
                    <span class="ft-cap-now" style={`width:${clamp(r.now, 0, 100)}%`} />
                    <span class="ft-cap-after" style={`width:${clamp(r.after, 0, 100)}%`} />
                  </span>
                  <span class="num ft-cap-num">{r.now}</span>
                  <span class="num ft-cap-num">{r.after}</span>
                  <Num v={r.d} />
                </div>
              ))}
            </div>
          ) : (
            <span class="ft-muted">Pick a direction to see the shape.</span>
          )}
        </section>
      </div>

      <section class="ft-panel" aria-label="Choices">
        <span class="ft-label">Your choices</span>
        <button type="button" class="ft-choice" onClick={() => setStep('direction')}>
          <span>Direction</span>
          <span>{sp ? sp.name : 'Not picked'}</span>
          <span class="ft-choice-go">Change</span>
        </button>
        {knobs && (
          <button type="button" class="ft-choice" onClick={() => setStep('personality')}>
            <span>Personality</span>
            <span>
              {PRESETS.find((pr) => sameP(persona, pr.p))?.label ?? 'Custom'}
              <span class="num ft-choice-sub">{` ${fmtKnob(persona.helpfulness)} / ${fmtKnob(persona.verbosity)} / ${fmtKnob(persona.sycophancy)}`}</span>
            </span>
            <span class="ft-choice-go">Change</span>
          </button>
        )}
        <button type="button" class="ft-choice" onClick={() => setStep('options')}>
          <span>Options</span>
          <span>
            {`Named ${name.trim() || defaultName}`}
            {`, ${removeQuirk && quirkById(removeQuirk) ? `drop ${quirkById(removeQuirk)?.name}` : 'keep all quirks'}`}
            {`, benchmaxx ${benchmaxx ? 'on' : 'off'}`}
          </span>
          <span class="ft-choice-go">Change</span>
        </button>
      </section>
    </>
  );

  const body = cur === 'direction' ? directionBody : cur === 'personality' ? personalityBody : cur === 'options' ? optionsBody : reviewBody;

  return (
    <div class="ft-root">
      <header class="ft-head">
        <div class="ft-head-top">
          <span class="ft-kicker">Fine-tune</span>
          <span class="ft-parent">{m.name}</span>
        </div>
        <Lineage m={m} />
      </header>

      {leaf ? (
        <div class="ft-empty">{`Leaf model. Nothing further from ${m.specId ? specById(m.specId)?.name ?? 'this model' : 'this base model'}.`}</div>
      ) : (
        <>
          <ol class="ft-steps">
            {visible.map((id, i) => (
              <li key={id}>
                <button
                  type="button"
                  class={`ft-step${id === cur ? ' ft-step-on' : i < idx ? ' ft-step-done' : ''}`}
                  aria-current={id === cur ? 'step' : undefined}
                  onClick={() => setStep(id)}
                >
                  <span class="num ft-step-n">{i + 1}</span>
                  {STEP_LABEL[id]}
                </button>
              </li>
            ))}
          </ol>

          <section class="ft-body" aria-labelledby="ft-question">
            <h2 class="ft-q" id="ft-question">
              {STEP_QUESTION[cur]}
            </h2>
            {body}
          </section>
        </>
      )}

      <footer class="ft-foot">
        <div class="ft-foot-info">
          {fc ? <FtBand low={fc.low} mid={fc.mid} high={fc.high} /> : <span class="ft-muted">No forecast yet.</span>}
          {est && (
            <span class="ft-foot-kv">
              <span class="ft-muted">Time</span> <span class="num">{formatDays(est.days)}</span>
              <span class="ft-muted"> Compute</span> <span class="num">{formatFlops(est.flops)}</span>
            </span>
          )}
          {changed.length > 0 ? (
            <span class="ft-stats">
              {changed.slice(0, 4).map((r) => (
                <span class="ft-stat" key={r.k}>
                  {CAP_SHORT[r.k]} <Num v={r.d} />
                </span>
              ))}
            </span>
          ) : shape ? (
            <span class="ft-muted">No capability change</span>
          ) : null}
          {footBlock && <span class="ft-blocker">{footBlock}</span>}
          {stepBlock && <span class="ft-blocker">{stepBlock}</span>}
        </div>
        <div class="ft-foot-btns">
          <button type="button" class="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {!leaf && (
            <button type="button" class="btn" disabled={idx <= 0} onClick={back}>
              Back
            </button>
          )}
          {!leaf &&
            (isLast ? (
              <>
                <button
                  type="button"
                  class={run ? 'btn btn-primary' : 'btn'}
                  disabled={!!queueBlock}
                  title={queueBlock || 'Add the fine-tune to the training queue'}
                  onClick={queueLaunch}
                >
                  Add to queue
                </button>
                <button type="button" class="btn btn-primary" disabled={!!launchBlock} title={launchBlock || 'Start the fine-tune'} onClick={launch}>
                  Fine-tune
                </button>
              </>
            ) : (
              <button type="button" class="btn btn-primary" disabled={cur === 'direction' && !sp} onClick={next}>
                Next
              </button>
            ))}
        </div>
      </footer>
    </div>
  );
}
