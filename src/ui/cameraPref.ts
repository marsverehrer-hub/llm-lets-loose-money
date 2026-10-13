// v13 UI rework: one setting for every camera feed (the isometric scenes and the HQ office).
//   compact (default): a short strip, so each screen's controls are above the fold
//   full: the original tall feeds
//   off: every camera folds to its label strip
// Stored per browser. Individual cameras can still be folded with their own Hide button.
import { useEffect, useState } from 'preact/hooks';

export type CameraMode = 'compact' | 'full' | 'off';
const KEY = 'llm-lets-loose-money/cameras';
const listeners = new Set<(m: CameraMode) => void>();

/** Height caps in compact mode (CSS px). */
export const COMPACT_H = { desktop: 230, phone: 170 };

export function readCameraMode(): CameraMode {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'full' || v === 'off' ? v : 'compact';
  } catch {
    return 'compact';
  }
}

export function setCameraMode(m: CameraMode): void {
  try {
    globalThis.localStorage?.setItem(KEY, m);
  } catch {
    // Storage blocked: the change holds for this visit.
  }
  for (const l of listeners) l(m);
}

export function useCameraMode(): CameraMode {
  const [m, setM] = useState<CameraMode>(readCameraMode);
  useEffect(() => {
    listeners.add(setM);
    return () => {
      listeners.delete(setM);
    };
  }, []);
  return m;
}

/** The feed height for a camera that asked for `wanted` px. */
export function cameraHeight(mode: CameraMode, wanted: number, phone: boolean): number {
  if (mode === 'full') return wanted;
  return Math.min(wanted, phone ? COMPACT_H.phone : COMPACT_H.desktop);
}

export const CAMERA_MODE_LABEL: Record<CameraMode, string> = { compact: 'Cameras: compact', full: 'Cameras: full size', off: 'Cameras: off' };
export const NEXT_CAMERA_MODE: Record<CameraMode, CameraMode> = { compact: 'full', full: 'off', off: 'compact' };
