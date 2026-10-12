// Interface size: auto zoom from the window width, the stored setting (parse and clamp), phones always at 1,
// and the zoom steps used by the menu and the keyboard.
import { describe, it, expect } from 'vitest';
import {
  UI_SCALE_STEPS,
  autoScale,
  canvasPixelRatio,
  currentZoom,
  effectiveZoom,
  formatUiScale,
  handleUiScaleKey,
  parseUiScale,
  stepUiScale,
  toCssPx,
} from '../src/ui/uiScale';

describe('autoScale', () => {
  it('stays at 1 below 2000 CSS px', () => {
    expect(autoScale(1280)).toBe(1);
    expect(autoScale(1920)).toBe(1);
    expect(autoScale(1999)).toBe(1);
  });

  it('follows width / 1700, rounded down to 0.125 steps', () => {
    expect(autoScale(2000)).toBe(1.125);
    expect(autoScale(2125)).toBe(1.25);
    expect(autoScale(2340)).toBe(1.375);
    expect(autoScale(2560)).toBe(1.5);
  });

  it('clamps to 2.25 for a 4K window at 100% OS scaling', () => {
    expect(autoScale(3840)).toBe(2.25);
    expect(autoScale(5120)).toBe(2.25);
  });

  it('treats a non-number as 1', () => {
    expect(autoScale(Number.NaN)).toBe(1);
    expect(autoScale(0)).toBe(1);
  });
});

describe('parseUiScale', () => {
  it('reads auto for missing, empty or unknown values', () => {
    expect(parseUiScale(null)).toBe('auto');
    expect(parseUiScale(undefined)).toBe('auto');
    expect(parseUiScale('auto')).toBe('auto');
    expect(parseUiScale('')).toBe('auto');
    expect(parseUiScale('   ')).toBe('auto');
    expect(parseUiScale('big')).toBe('auto');
    expect(parseUiScale(Number.NaN)).toBe('auto');
  });

  it('keeps exact steps, from numbers or strings', () => {
    for (const s of UI_SCALE_STEPS) {
      expect(parseUiScale(s)).toBe(s);
      expect(parseUiScale(String(s))).toBe(s);
    }
  });

  it('clamps to the step range and snaps to the nearest step', () => {
    expect(parseUiScale(0.1)).toBe(0.875);
    expect(parseUiScale(9)).toBe(2.25);
    expect(parseUiScale(1.3)).toBe(1.25);
    expect(parseUiScale(1.4)).toBe(1.5);
  });
});

describe('effectiveZoom', () => {
  it('uses 1 for phones and tablets, whatever the setting', () => {
    expect(effectiveZoom('auto', 760)).toBe(1);
    expect(effectiveZoom(2.25, 700)).toBe(1);
    expect(effectiveZoom(1.5, 390)).toBe(1);
  });

  it('auto follows the width above 760px', () => {
    expect(effectiveZoom('auto', 761)).toBe(1);
    expect(effectiveZoom('auto', 2560)).toBe(1.5);
    expect(effectiveZoom('auto', 3840)).toBe(2.25);
  });

  it('a manual step overrides auto', () => {
    expect(effectiveZoom(1.25, 3840)).toBe(1.25);
    expect(effectiveZoom(0.875, 1440)).toBe(0.875);
  });
});

describe('stepUiScale', () => {
  it('moves to the next step up or down from the current zoom', () => {
    expect(stepUiScale(1.5, 1)).toBe(1.75);
    expect(stepUiScale(1.5, -1)).toBe(1.25);
  });

  it('starts from a zoom that is not a step (auto can give 1.375)', () => {
    expect(stepUiScale(1.375, 1)).toBe(1.5);
    expect(stepUiScale(1.375, -1)).toBe(1.25);
  });

  it('stops at the ends of the range', () => {
    expect(stepUiScale(2.25, 1)).toBe(2.25);
    expect(stepUiScale(0.875, -1)).toBe(0.875);
  });
});

describe('formatUiScale and the coordinate helpers', () => {
  it('formats zoom as a percentage', () => {
    expect(formatUiScale(1.5)).toBe('150%');
    expect(formatUiScale(0.875)).toBe('87.5%');
  });

  it('is at 1 with no page, so visual and CSS px match', () => {
    expect(currentZoom()).toBe(1);
    expect(toCssPx(300)).toBe(300);
    expect(canvasPixelRatio()).toBe(1);
  });
});

describe('handleUiScaleKey', () => {
  const key = (init: Partial<KeyboardEvent>) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: '', code: '', ...init }) as KeyboardEvent;

  it('ignores keys without Ctrl or Cmd plus Alt', () => {
    expect(handleUiScaleKey(key({ key: '=', code: 'Equal' }))).toBe(false);
    expect(handleUiScaleKey(key({ key: '=', code: 'Equal', ctrlKey: true }))).toBe(false);
    expect(handleUiScaleKey(key({ key: '=', code: 'Equal', altKey: true }))).toBe(false);
    expect(handleUiScaleKey(key({ key: '=', code: 'Equal', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
  });

  it('takes Ctrl Alt with = - and 0', () => {
    expect(handleUiScaleKey(key({ key: '=', code: 'Equal', ctrlKey: true, altKey: true }))).toBe(true);
    expect(handleUiScaleKey(key({ key: '-', code: 'Minus', metaKey: true, altKey: true }))).toBe(true);
    expect(handleUiScaleKey(key({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true }))).toBe(true);
    expect(handleUiScaleKey(key({ key: 'a', code: 'KeyA', ctrlKey: true, altKey: true }))).toBe(false);
  });
});
