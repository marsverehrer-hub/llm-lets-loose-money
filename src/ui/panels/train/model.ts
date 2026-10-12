// Shared constants and pure helpers for the pre-training wizard. No rendering here.
// Fog of training (GAME_DESIGN 16): forecasts come from forecastTraining only. Never read hidden run fields.
import type { GameState, Capabilities, CapId, DatasetDef, Forecast, Id, Model, TrainingConfig } from '../../../sim/types';
import { CAP_IDS } from '../../../sim/types';
import { labInfo } from '../../../sim/systems/labs';
import { TRAINING_TUNING, datasetTokensOf, estimateTraining, trainingRatePerDay } from '../../../sim/systems/training';
import type { TrainingEstimate } from '../../../sim/systems/training';
import { defaultConfig, optionById } from '../../../sim/data/trainingOptions';
import type { TrainingOption } from '../../../sim/data/trainingOptions';
import { suggestModelName } from '../../../sim/data/names';
import { clamp, formatDays } from '../../components';
import { logToValue, sig2, uiRng, valueToLog } from '../panelKit';
import { effParamsFor } from '../../../sim/systems/trainingMath';

export const STEPS = 1000;
export const P_MIN = TRAINING_TUNING.MIN_PARAMS_B;
export const P_MAX = TRAINING_TUNING.MAX_PARAMS_B;
export const T_MIN = TRAINING_TUNING.MIN_TOKENS_B;
export const CHINCHILLA = 20;
/** Tokens within this share of the Chinchilla value snap onto it. */
export const CHINCHILLA_SNAP = 0.06;
export const LR_MIN = 0.01;
export const LR_MAX = 1;
export const EXPERT_STEPS = [8, 16, 64, 256];
export const AUTO_DAYS = 21;
/** Datasets at or above this believed quality count as "best quality". */
export const GOOD_QUALITY = 0.6;

export type Fit = 'manual' | 7 | 21 | 90;
/** Fit-to-time shortcuts. Small helper chips next to the size sliders. */
export const FIT_CHIPS: { fit: 7 | 21 | 90; label: string; hint: string }[] = [
  { fit: 7, label: '~1 week', hint: 'Biggest model that finishes in about a week' },
  { fit: 21, label: '~3 weeks', hint: 'Biggest model that finishes in about three weeks' },
  { fit: 90, label: '~3 months', hint: 'Biggest model that finishes in about a quarter' },
];

export const STEP_NAMES = ['Size', 'Data', 'Architecture', 'Recipe', 'Review'] as const;
export const STEP_QUESTIONS = ['How big?', 'What does it read?', 'How is it built?', 'How is it trained?', 'Ready to train?'] as const;

export const KIND_LABEL: Record<string, string> = {
  web: 'Web',
  books: 'Books',
  code: 'Code',
  science: 'Science',
  dialogue: 'Dialogue',
  synthetic: 'Synthetic',
  multimodal: 'Multimodal',
};
export const CAP_LABEL: Record<CapId, string> = {
  knowledge: 'Knowledge',
  reasoning: 'Reasoning',
  math: 'Math',
  coding: 'Coding',
  agentic: 'Agentic',
  chat: 'Chat',
  vision: 'Vision',
  safety: 'Safety',
  multilingual: 'Multilingual',
  longContext: 'Long context',
};

// ---------------------------------------------------------------------------
// number helpers
// ---------------------------------------------------------------------------

export const posFor = (paramsB: number): number => valueToLog(paramsB, P_MIN, P_MAX) * STEPS;
export const paramsAt = (pos: number): number => sig2(logToValue(pos / STEPS, P_MIN, P_MAX));
export const lrAt = (pos: number): number => Math.round(LR_MIN * (LR_MAX / LR_MIN) ** clamp(pos, 0, 1) * 1000) / 1000;
export const posOfLr = (lr: number): number => Math.log(Math.max(LR_MIN, lr) / LR_MIN) / Math.log(LR_MAX / LR_MIN);
export const pct = (v: number, digits = 0): string => (isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—');
export const mult = (v: number, digits = 2): string => (isFinite(v) ? `×${v.toFixed(digits)}` : '—');
export const tokensShort = (tokensB: number): string => {
  if (!isFinite(tokensB)) return '—';
  if (tokensB >= 1000) return `${+(tokensB / 1000).toFixed(1)}T`;
  if (tokensB >= 1) return `${+tokensB.toFixed(1)}B`;
  return `${Math.round(tokensB * 1000)}M`;
};
export const eloOf = (overall: number): number => TRAINING_TUNING.ELO_BASE + overall * TRAINING_TUNING.ELO_PER_POINT;
export const fmtCtx = (k: number | undefined): string => {
  if (k === undefined) return '—';
  if (k >= 1000) return `${+(k / 1000).toFixed(1)}M`;
  return `${Math.round(k)}K`;
};
export const optionName = (id: Id): string => optionById(id)?.name ?? id;
/** The scaling meter runs from 0.1 to 100 tokens per parameter, on a log scale. */
export const METER_LO = 0.1;
export const METER_HI = 100;
export const scalePct = (ratio: number): number =>
  ((Math.log10(Math.min(METER_HI, Math.max(METER_LO, ratio))) - Math.log10(METER_LO)) / (Math.log10(METER_HI) - Math.log10(METER_LO))) * 100;
/** Overall points as the wizard writes them: whole numbers from 10 up, one decimal below. */
export const pointsText = (p: number): string => (p >= 10 ? String(Math.round(p)) : String(+p.toFixed(1)));
/** Money for a quote, or a dash when the quote has no price (no cloud market yet). */
export const quoteMoney = (v: number, fmt: (n: number) => string): string => (Number.isFinite(v) ? fmt(v) : '—');
export const r0 = (v: number): string => (isFinite(v) ? String(Math.round(v)) : '—');
export const signedInt = (v: number): string => (isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}` : '—');
export const bandText = (b: number): string => {
  const x = Math.round(b * 10) / 10;
  return x % 1 === 0 ? x.toFixed(0) : x.toFixed(1);
};
export const fmtLr = (v: number): string => v.toFixed(v < 0.1 ? 3 : 2);
export const confTone = (c: Forecast['confidence']): 'good' | 'info' | 'warn' | 'bad' =>
  c === 'tight' ? 'good' : c === 'decent' ? 'info' : c === 'rough' ? 'warn' : 'bad';

/** Learning rates to sweep around the current one: a log-spaced spread, clamped to the slider range. */
export function sweepLrs(lr: number, count: 3 | 5): number[] {
  const factors = count === 3 ? [0.5, 1, 2] : [0.25, 0.5, 1, 2, 4];
  const out: number[] = [];
  for (const f of factors) {
    const v = Math.round(clamp(lr * f, LR_MIN, LR_MAX) * 1000) / 1000;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// arena, flagship, model table helpers (shared with ModelsPanel)
// ---------------------------------------------------------------------------

/** Arena leader among rival labs (the same set the release flow compares against). */
export function arenaTop(s: GameState): { lab: string; model: string; elo: number } | null {
  let best: { lab: string; model: string; elo: number } | null = null;
  for (const c of s.competitors) {
    if (!c.active || !c.model) continue;
    if (!best || c.model.elo > best.elo) best = { lab: labInfo(s, c.id)?.name ?? c.id, model: c.model.name, elo: c.model.elo };
  }
  return best;
}

/** Best released, non-retired model by overall score. */
export function flagshipOf(s: GameState): Model | null {
  let best: Model | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || m.deprecated) continue;
    if (!best || m.overall > best.overall) best = m;
  }
  return best;
}

/** Status tag: LIVE (released), SECRET (unreleased), RET (retired). */
export function statusOf(m: Model): { label: string; tone: 'good' | 'warn' | 'muted' } {
  if (m.deprecated) return { label: 'RET', tone: 'muted' };
  if (m.releasedDay === null) return { label: 'SECRET', tone: 'warn' };
  return { label: 'LIVE', tone: 'good' };
}

export interface TreeRow {
  m: Model;
  prefix: string;
}
/** Models as an evolution tree. Roots keep the list order; each child sits under its parent with box guides. */
export function lineageRows(models: Model[]): TreeRow[] {
  const ids = new Set(models.map((m) => m.id));
  const kids = new Map<Id, Model[]>();
  const roots: Model[] = [];
  for (const m of models) {
    if (m.parentId && ids.has(m.parentId)) {
      const list = kids.get(m.parentId) ?? [];
      list.push(m);
      kids.set(m.parentId, list);
    } else {
      roots.push(m);
    }
  }
  const out: TreeRow[] = [];
  const walk = (m: Model, lead: string, glyph: string, depth: number) => {
    out.push({ m, prefix: lead + glyph });
    const cs = [...(kids.get(m.id) ?? [])].reverse();
    cs.forEach((c, i) => {
      const last = i === cs.length - 1;
      const childLead = depth === 0 ? '' : lead + (glyph === '└─ ' ? '   ' : '│  ');
      walk(c, childLead, last ? '└─ ' : '├─ ', depth + 1);
    });
  };
  for (const r of roots) walk(r, '', '', 0);
  return out;
}

// ---------------------------------------------------------------------------
// sizing
// ---------------------------------------------------------------------------

/**
 * Fit-to-days search: largest parameter position whose run still finishes within `days`. It never sizes past what the
 * owned data can feed at the optimal ratio (20 tokens per parameter, epochs included), so auto sizing is not undertrained.
 */
export function fitPos(s: GameState, cfg: TrainingConfig, ids: Id[], days: number): number {
  const maxTokens = TRAINING_TUNING.MAX_EPOCHS * datasetTokensOf(s, ids);
  if (ids.length === 0 || maxTokens < T_MIN || trainingRatePerDay(s, cfg) <= 0) return posFor(7);
  // The optimal token count follows the parameters the loss sees (effective, for MoE).
  const daysAt = (pos: number): number => {
    const p = paramsAt(pos);
    return estimateTraining(s, p, sig2(Math.min(CHINCHILLA * effParamsFor(p, cfg), maxTokens)), ids, [], cfg).days;
  };
  if (!(daysAt(0) <= days)) return 0;
  let lo = 0;
  const perParam = effParamsFor(1, cfg);
  let hi = Math.max(0, Math.min(STEPS, Math.floor(posFor(maxTokens / (CHINCHILLA * perParam)))));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (daysAt(mid) <= days) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Everything the wizard edits. Lives in the module draft store so it survives panel switches. */
export interface Sheet {
  name: string;
  fit: Fit;
  /** Parameter slider position (log scale). Drives the run when fit is manual; otherwise the fit search does. */
  paramPos: number;
  /** Tokens (billions) when set by hand; null = Chinchilla default. */
  tokReq: number | null;
  /** Dataset ids to train on; null = every owned set. */
  picked: Id[] | null;
  techs: Id[];
  benchmaxx: boolean;
  cfg: TrainingConfig;
}

export function initSheet(s: GameState): Sheet {
  return {
    name: suggestModelName(uiRng(), s.models.length + 1),
    fit: AUTO_DAYS,
    paramPos: posFor(7),
    tokReq: null,
    picked: null,
    techs: [],
    benchmaxx: false,
    cfg: defaultConfig(s),
  };
}

/** Everything the steps share, resolved once per render by TrainWizard. */
export interface Ctx {
  s: GameState;
  sheet: Sheet;
  ownedSets: DatasetDef[];
  selected: Id[];
  pos: number;
  paramsB: number;
  tokensB: number;
  uniqueTokens: number;
  maxTokens: number;
  canTokens: boolean;
  canSlideTokens: boolean;
  techs: Id[];
  rate: number;
  est: TrainingEstimate | null;
  /** Forecast band for the current sheet. Null without datasets. */
  fc: Forecast | null;
  cfgErr: string | null;
  errs: string[];
  defaults: TrainingConfig;
  cloudPerFlop: number;
  ablCost: number;
  flagship: Model | null;
  flagshipCaps: Capabilities | null;
  arena: { lab: string; model: string; elo: number } | null;
  patch: (p: Partial<Sheet>) => void;
  patchCfg: (p: Partial<TrainingConfig>) => void;
}

// ---------------------------------------------------------------------------
// trade-offs: read straight from the option definitions
// ---------------------------------------------------------------------------

export interface Trade {
  text: string;
  tone: 'good' | 'bad' | 'info' | 'dim';
}

const fx = (m: number): string => `×${+m.toFixed(2)}`;
const pctDelta = (m: number): string => {
  const p = Math.round((m - 1) * 100);
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)}%`;
};

/**
 * Up to four compact deltas for an option: speed, quality, compute, risk, serving, data and token effects, then the
 * strongest capability shift. Stats the option does not move are left out.
 */
export function tradeoffs(opt: TrainingOption): Trade[] {
  const main: Trade[] = [];
  if (opt.speedMult && opt.speedMult !== 1) main.push({ text: `speed ${fx(opt.speedMult)}`, tone: opt.speedMult > 1 ? 'good' : 'bad' });
  if (opt.qualityMult && opt.qualityMult !== 1) main.push({ text: `quality ${pctDelta(opt.qualityMult)}`, tone: opt.qualityMult > 1 ? 'good' : 'bad' });
  if (opt.flopsMult && opt.flopsMult !== 1) main.push({ text: `compute ${fx(opt.flopsMult)}`, tone: 'bad' });
  if (opt.instability !== undefined && opt.instability !== 0) main.push({ text: `risk ${opt.instability > 0 ? '▲' : '▼'}`, tone: opt.instability > 0 ? 'bad' : 'good' });
  // inferenceMult is serving efficiency (>1 = cheaper to serve), so show it as a cost multiplier.
  if (opt.inferenceMult && opt.inferenceMult !== 1) main.push({ text: `serving cost ${fx(1 / opt.inferenceMult)}`, tone: opt.inferenceMult > 1 ? 'good' : 'bad' });
  if (opt.dataQualityAdd) main.push({ text: `data q +${Math.round(opt.dataQualityAdd * 100)}`, tone: 'good' });
  if (opt.tokenMult !== undefined && opt.tokenMult !== 1) main.push({ text: `tokens ${pctDelta(opt.tokenMult)}`, tone: 'bad' });
  if (opt.contextK) main.push({ text: `memory ${fmtCtx(opt.contextK)}`, tone: 'info' });
  const caps = Object.entries(opt.capAdd ?? {})
    .filter(([, v]) => v)
    .sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number));
  const out = main.slice(0, caps.length ? 3 : 4);
  if (caps.length) {
    const [k, v] = caps[0] as [CapId, number];
    out.push({ text: `${v > 0 ? '+' : '−'}${CAP_LABEL[k].toLowerCase()} ${Math.abs(v)}`, tone: v > 0 ? 'good' : 'bad' });
  }
  return out.length ? out : [{ text: 'baseline', tone: 'dim' }];
}

// ---------------------------------------------------------------------------
// build profile: expected capabilities against the current flagship
// ---------------------------------------------------------------------------

export interface ShapeRow {
  id: CapId;
  label: string;
  expected: number;
  flagship: number | null;
}

/** Forecast capability shape for the current sheet. Expected values only, never hidden truth. */
export function shapeRows(expected: Capabilities | null, flagship: Capabilities | null): ShapeRow[] | null {
  if (!expected) return null;
  return CAP_IDS.map((id) => ({
    id,
    label: CAP_LABEL[id],
    expected: clamp(expected[id], 0, 100),
    flagship: flagship ? clamp(flagship[id], 0, 100) : null,
  }));
}
