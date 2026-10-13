// v11: generic camera-feed frame for an isometric Scene (see types.ts). Same behaviour as the HQ OfficeView:
// DPR-aware canvas, drawing paused off screen, hover tip, phone frame cap, and clicks reported to the panel.
// v13 phone pass: 240px cap on phones, a Hide/Show camera toggle (remembered per camera), and tap to inspect.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../sim/types';
import { tdate } from '../ui/shell/fmt';
import { MOBILE_QUERY, useIsMobile } from '../ui/components/useIsMobile';
import { canvasPixelRatio, toCssPx, useUiScale } from '../ui/uiScale';
import type { Scene, SceneHit } from './types';
import { cameraHeight, useCameraMode } from '../ui/cameraPref'; // v13 compact cameras
import '../office/office.css';
import './scenes.css';

const MAX_DPR = 2;
const MAX_DPR_DESKTOP = 3;
const PHONE_FRAME_MS = 1000 / 30;
/** Phone cap for the camera height, so the screen under it stays in reach. */
const PHONE_MAX_H = 240;
/** A tap tip stays this long unless the next tap replaces it. */
const TAP_TIP_MS = 3000;
/** localStorage key prefix. The full key is this plus the camera id. */
const HIDDEN_KEY = 'llm-lets-loose-money/cam-hidden/';

export interface SceneViewProps {
  state: GameState;
  /** Called once to build the scene. */
  make: () => Scene;
  /** Canvas height in CSS px. Default 320 (240 on phones). */
  height?: number;
  /** Camera label, top left, e.g. "Datacenter". */
  cam: string;
  /** Camera number, e.g. "CAM-03". */
  camId?: string;
  /** Clicked thing (a SceneHit id). */
  onSelect?: (hit: SceneHit) => void;
  /** Accessible description of the picture. */
  label: string;
}

interface Tip {
  x: number;
  y: number;
  text: string;
  id: string;
}

function readHidden(camId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(HIDDEN_KEY + camId) === '1';
  } catch {
    return false;
  }
}

function writeHidden(camId: string, hidden: boolean): void {
  try {
    globalThis.localStorage?.setItem(HIDDEN_KEY + camId, hidden ? '1' : '0');
  } catch {
    // Storage blocked: the toggle still works for this visit.
  }
}

/** Top left corner for a tip of size w x h beside the point (x, y). It flips left at the right edge and stays below the top. */
function placeTip(x: number, y: number, w: number, h: number, W: number, H: number): { left: number; top: number } {
  let left = x + 12;
  if (left + w > W - 4) left = x - 12 - w;
  let top = y + 12;
  if (top + h > H - 4) top = y - 12 - h;
  return { left: Math.max(4, Math.min(left, W - w - 4)), top: Math.max(4, Math.min(top, H - h - 4)) };
}

export function SceneView({ state, make, height, cam, camId = 'CAM-02', onSelect, label }: SceneViewProps) {
  const isPhone = useIsMobile();
  const mode = useCameraMode();
  const wanted = isPhone ? Math.min(height ?? 320, PHONE_MAX_H) : (height ?? 320);
  const h = cameraHeight(mode, wanted, isPhone);
  // v13: any camera can fold to its label strip (remembered per camera), and "Cameras: off" folds them all.
  const [hiddenPref, setHiddenPref] = useState(() => readHidden(camId));
  const camHidden = hiddenPref || mode === 'off';
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipElRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>(state);
  stateRef.current = state;
  const hRef = useRef(h);
  hRef.current = h;
  const hiddenRef = useRef(camHidden);
  hiddenRef.current = camHidden;
  const sceneRef = useRef<Scene | null>(null);
  const relayoutRef = useRef<(() => void) | null>(null);
  const runRef = useRef<(() => void) | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipIdRef = useRef<string | null>(null);
  const tapTimerRef = useRef(0);
  // Set by a touch tap that only showed a tip, so the click that follows does not select.
  const suppressClickRef = useRef(false);
  const { zoom } = useUiScale();

  const showTip = (t: Tip | null) => {
    tipIdRef.current = t ? t.id : null;
    setTip(t);
  };
  const clearTip = () => {
    window.clearTimeout(tapTimerRef.current);
    showTip(null);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scene = make();
    sceneRef.current = scene;
    const phoneMq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
    let dpr = 1;
    const relayout = () => {
      const cssW = Math.max(1, Math.floor(toCssPx(wrap.getBoundingClientRect().width)));
      const cssH = Math.max(1, hRef.current);
      dpr = canvasPixelRatio(phoneMq?.matches ? MAX_DPR : MAX_DPR_DESKTOP);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      scene.resize(cssW, cssH);
    };
    relayoutRef.current = relayout;
    relayout();
    const ro = new ResizeObserver(() => relayout());
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (phoneMq?.matches && now - last < PHONE_FRAME_MS) return;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene.draw(ctx, stateRef.current, dt, Date.now());
    };
    let inView = true;
    const run = () => {
      const want = inView && !document.hidden && !hiddenRef.current;
      if (want && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!want && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    runRef.current = run;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            inView = entries.some((e) => e.isIntersecting);
            run();
          })
        : null;
    io?.observe(wrap);
    document.addEventListener('visibilitychange', run);
    run();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', run);
      window.clearTimeout(tapTimerRef.current);
      sceneRef.current = null;
      relayoutRef.current = null;
      runRef.current = null;
    };
  }, []);

  // Height, phone breakpoint, camera toggle or UI zoom: relayout without rebuilding the scene, then restart or pause the loop.
  useEffect(() => {
    relayoutRef.current?.();
    runRef.current?.();
  }, [h, isPhone, camHidden, zoom]);

  // Place the tip once it is measured, so it stays inside the camera box.
  useLayoutEffect(() => {
    const el = tipElRef.current;
    const wrap = wrapRef.current;
    if (!tip || !el || !wrap) return;
    const at = placeTip(tip.x, tip.y, el.offsetWidth, el.offsetHeight, wrap.clientWidth, wrap.clientHeight);
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  }, [tip]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: toCssPx(e.clientX - r.left), y: toCssPx(e.clientY - r.top) };
  };
  const onMove = (e: PointerEvent) => {
    // Touch and pen moves are drags, so they never change the tip. Only a mouse hovers.
    if (e.pointerType !== 'mouse') return;
    const scene = sceneRef.current;
    if (!scene || !canvasRef.current) return;
    window.clearTimeout(tapTimerRef.current);
    const p = at(e);
    const hit = scene.hitTest(p.x, p.y);
    showTip(hit ? { x: p.x, y: p.y, text: hit.label, id: hit.id } : null);
  };
  const onLeave = (e: PointerEvent) => {
    // A finger lifts with a pointerleave too, so a tap tip stays for its full time.
    if (e.pointerType === 'mouse') clearTip();
  };
  const onDown = (e: PointerEvent) => {
    suppressClickRef.current = false;
    // Desktop: the hover tip does the work.
    if (e.pointerType === 'mouse') return;
    const scene = sceneRef.current;
    if (!scene || !canvasRef.current) return;
    const p = at(e);
    const hit = scene.hitTest(p.x, p.y);
    if (!hit) {
      clearTip();
      return;
    }
    if (tipIdRef.current === hit.id) {
      // Second tap on the same thing: drop the tip and let the click select it.
      clearTip();
      return;
    }
    // First tap: show the tip and swallow the click that follows.
    suppressClickRef.current = true;
    showTip({ x: p.x, y: p.y, text: hit.label, id: hit.id });
    window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(clearTip, TAP_TIP_MS);
  };
  const onClick = (e: MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const scene = sceneRef.current;
    if (!scene || !canvasRef.current || !onSelect) return;
    const p = at(e);
    const hit = scene.hitTest(p.x, p.y);
    if (hit) onSelect(hit);
  };
  const toggleCam = () => {
    const next = !hiddenPref;
    setHiddenPref(next);
    writeHidden(camId, next);
    clearTip();
  };

  return (
    <>
      <div
        class={camHidden ? 'office-view scene-view scene-collapsed' : 'office-view scene-view'}
        ref={wrapRef}
        style={camHidden ? undefined : { height: `${h}px` }}
      >
        <canvas
          ref={canvasRef}
          class={onSelect ? 'scene-clickable' : undefined}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onClick={onClick}
          role="img"
          aria-label={label}
        />
        <div class="cam cam-tl" aria-hidden="true">
          <span>{camId}</span>
          <span class="cam-name">{cam}</span>
        </div>
        <div class="cam cam-tr" aria-hidden="true">
          <span class="cam-rec blink">● REC</span>
        </div>
        <div class="cam cam-bl" aria-hidden="true">
          {tdate(state.day)}
        </div>
        {tip && (
          <div class="office-tip" ref={tipElRef}>
            {tip.text}
          </div>
        )}
        {/* v13: a small in-frame toggle replaces the full-width button under the feed. */}
        {mode !== 'off' && (
          <button type="button" class="cam-toggle" aria-expanded={!camHidden} onClick={toggleCam}>
            {camHidden ? 'Show' : 'Hide'}
          </button>
        )}
      </div>
    </>
  );
}
