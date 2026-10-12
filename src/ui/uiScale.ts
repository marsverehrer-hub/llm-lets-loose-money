// Interface size. The whole UI is scaled with CSS zoom on <html>, so every px in the stylesheets grows together.
// Auto picks a zoom from the window width (a 4K monitor at 100% OS scaling gets 2.25); a manual step overrides it.
// Phones and tablets (760px and below) always use 1. index.html sets the zoom before first paint, in step with this file.
//
// Under zoom, CSS lengths inside the root are multiplied, so viewport units must be divided by --ui-zoom (see
// theme.css). Coordinates measured from the page (getBoundingClientRect, clientX) are visual px: convert them with
// toCssPx before writing them back as CSS lengths. Canvases need backing-store pixels times the zoom (canvasPixelRatio).

import { useEffect, useState } from 'preact/hooks';
import { MOBILE_MAX_WIDTH } from './components/useIsMobile';

export const UI_SCALE_KEY = 'llm-lets-loose-money/ui-scale';

/** Manual steps. 'auto' is the setting that follows the window width. */
export const UI_SCALE_STEPS = [0.875, 1, 1.125, 1.25, 1.5, 1.75, 2, 2.25] as const;
export type UiScaleStep = (typeof UI_SCALE_STEPS)[number];
export type UiScaleSetting = 'auto' | UiScaleStep;

/** Auto stays at 1 below this window width (a 1920 monitor at 100% is already comfortable). */
const AUTO_FROM_WIDTH = 2000;
/** Window CSS px per 1x of auto zoom: 2560 gives 1.5, 3840 gives 2.25. */
const AUTO_DIVISOR = 1700;
const AUTO_GRAIN = 0.125;
const AUTO_MIN = 1;
const AUTO_MAX = 2.25;
/** Total canvas pixel ratio cap (device pixel ratio times zoom). */
const CANVAS_RATIO_CAP = 3;

/** Auto zoom for a window this wide: 1 below 2000 CSS px, else width / 1700 rounded down to 0.125 and clamped to 1..2.25. */
export function autoScale(innerWidth: number): number {
  if (!(innerWidth >= AUTO_FROM_WIDTH)) return 1;
  const raw = Math.floor(innerWidth / AUTO_DIVISOR / AUTO_GRAIN + 1e-9) * AUTO_GRAIN;
  return Math.min(AUTO_MAX, Math.max(AUTO_MIN, raw));
}

/** The manual step nearest to a number, after clamping to the step range. */
function nearestStep(n: number): UiScaleStep {
  const first = UI_SCALE_STEPS[0];
  const last = UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1];
  const c = Math.min(last, Math.max(first, n));
  let best: UiScaleStep = first;
  for (const s of UI_SCALE_STEPS) if (Math.abs(s - c) < Math.abs(best - c)) best = s;
  return best;
}

/** Read a stored or typed setting. Anything unknown is auto; numbers are clamped and snapped to a step. */
export function parseUiScale(raw: unknown): UiScaleSetting {
  if (raw === undefined || raw === null || raw === 'auto') return 'auto';
  if (typeof raw === 'string' && raw.trim() === '') return 'auto';
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 'auto';
  return nearestStep(n);
}

/** The zoom a setting gives in a window this wide. Phones and tablets always use 1. */
export function effectiveZoom(setting: UiScaleSetting, innerWidth: number): number {
  if (!(innerWidth > MOBILE_MAX_WIDTH)) return 1;
  return setting === 'auto' ? autoScale(innerWidth) : setting;
}

/** The next step above or below a zoom (strictly), stopping at the ends of the range. */
export function stepUiScale(current: number, dir: 1 | -1): UiScaleStep {
  const first = UI_SCALE_STEPS[0];
  const last = UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1];
  if (dir > 0) return UI_SCALE_STEPS.find((s) => s > current + 1e-9) ?? last;
  const below = [...UI_SCALE_STEPS].reverse().find((s) => s < current - 1e-9);
  return below ?? first;
}

/** "150%", "87.5%". */
export function formatUiScale(zoom: number): string {
  return `${Math.round(zoom * 1000) / 10}%`;
}

function readStored(): UiScaleSetting {
  try {
    return parseUiScale(localStorage.getItem(UI_SCALE_KEY));
  } catch {
    return 'auto';
  }
}

function writeStored(s: UiScaleSetting): void {
  try {
    localStorage.setItem(UI_SCALE_KEY, String(s));
  } catch {
    /* private window or blocked storage: the size still applies for this visit */
  }
}

let setting: UiScaleSetting = readStored();
/** The zoom currently written to <html>. */
let applied = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function viewportWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 0;
}

/** The zoom in use right now (1 on phones). */
export function currentZoom(): number {
  return applied;
}

/** Visual (on-screen) px to the CSS px that a length inside the zoomed root must use. */
export function toCssPx(visualPx: number): number {
  return visualPx / applied;
}

/** Backing-store pixels per CSS px for a canvas in the zoomed UI: device pixel ratio times zoom, capped in total. */
export function canvasPixelRatio(cap = CANVAS_RATIO_CAP): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return Math.min(cap, dpr * applied);
}

/** Write the zoom to <html> (and --ui-zoom for the viewport-unit calcs). Returns the zoom in use. */
export function applyUiScale(): number {
  const z = effectiveZoom(setting, viewportWidth());
  const changed = z !== applied;
  applied = z;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (z === 1) root.style.removeProperty('zoom');
    else root.style.setProperty('zoom', String(z));
    root.style.setProperty('--ui-zoom', String(z));
  }
  if (changed) emit();
  return z;
}

/** Remember and apply a setting. */
export function setUiScale(next: UiScaleSetting): void {
  setting = parseUiScale(next);
  writeStored(setting);
  applyUiScale();
  emit();
}

export function getUiScaleSetting(): UiScaleSetting {
  return setting;
}

/** Ctrl or Cmd with Alt: = bigger, - smaller, 0 back to auto. Returns true when the key was one of these. */
export function handleUiScaleKey(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return false;
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '=' || e.key === '+') setUiScale(stepUiScale(applied, 1));
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') setUiScale(stepUiScale(applied, -1));
  else if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0') setUiScale('auto');
  else return false;
  return true;
}

/** Apply now, then again on resize (debounced, so a window drag does not relayout per pixel). Returns a stop function. */
export function startUiScale(): () => void {
  applyUiScale();
  let timer = 0;
  const onResize = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(applyUiScale, 120);
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    window.clearTimeout(timer);
  };
}

export interface UiScaleView {
  setting: UiScaleSetting;
  /** The zoom in use. */
  zoom: number;
  /** What auto would give at this window width (1 on phones). */
  auto: number;
}

export function uiScaleView(): UiScaleView {
  return { setting, zoom: applied, auto: effectiveZoom('auto', viewportWidth()) };
}

/** Re-renders when the setting or the zoom changes (including resizes that change auto). */
export function useUiScale(): UiScaleView & { set: (s: UiScaleSetting) => void } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { ...uiScaleView(), set: setUiScale };
}
