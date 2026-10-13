import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../sim/types';
import { tdate } from '../ui/shell/fmt';
import { MOBILE_QUERY, useIsMobile } from '../ui/components/useIsMobile';
import { canvasPixelRatio, currentZoom, toCssPx, useUiScale } from '../ui/uiScale';
import { OfficeScene } from './scene';
import './office.css';
import { cameraHeight, useCameraMode } from '../ui/cameraPref'; // v13 compact cameras

/** Pixel ratio cap on phones. Above 2 the scene costs a lot of fill rate and the detail is not visible on a phone. */
const MAX_DPR = 2;
/** Total canvas pixel ratio cap on desktop (device pixel ratio times UI zoom). */
const MAX_DPR_DESKTOP = 3;
/** On phones the camera feed draws at 30 frames a second. The scene is slow-moving, and the battery matters. */
const PHONE_FRAME_MS = 1000 / 30;
/** A tap tip stays this long unless the next tap replaces it. */
const TAP_TIP_MS = 3000;

/** Top left corner for a tip of size w x h beside the point (x, y). It flips left at the right edge and stays below the top. */
function placeTip(x: number, y: number, w: number, h: number, W: number, H: number): { left: number; top: number } {
  let left = x + 12;
  if (left + w > W - 4) left = x - 12 - w;
  let top = y + 12;
  if (top + h > H - 4) top = y - 12 - h;
  return { left: Math.max(4, Math.min(left, W - w - 4)), top: Math.max(4, Math.min(top, H - h - 4)) };
}

/**
 * Isometric office scene framed like a security camera feed. OWNER: shell agent.
 * Reads GameState only (read fresh every frame, never copied).
 *
 * Drawing stops while the canvas is scrolled out of view, collapsed, or the tab is hidden. On phones a toggle
 * collapses the feed to its header line. A finger taps to show the tip (it stays about 3 s).
 */
export function OfficeView(props: { state: GameState; height?: number }) {
  const isPhoneNow = useIsMobile();
  const camMode = useCameraMode();
  // v13: the global camera setting caps the feed (compact) or folds it (off).
  const height = cameraHeight(camMode, props.height ?? 360, isPhoneNow);
  const isPhone = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipElRef = useRef<HTMLDivElement>(null);
  // Keep a live pointer to the mutable GameState; the sim mutates it in place.
  const stateRef = useRef<GameState>(props.state);
  stateRef.current = props.state;
  const heightRef = useRef(height);
  heightRef.current = height;
  const relayoutRef = useRef<(() => void) | null>(null);
  const runRef = useRef<(() => void) | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const tipTextRef = useRef<string>('');
  const tapTimerRef = useRef(0);
  const sceneRef = useRef<OfficeScene | null>(null);
  const { zoom } = useUiScale();

  // Heavy setup once: canvas, ResizeObserver, rAF loop paused by visibility, scroll position and collapse.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scene = new OfficeScene();
    sceneRef.current = scene;
    const phoneMq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
    let cssW = 1;
    let cssH = heightRef.current;
    let dpr = 1;
    const relayout = () => {
      // The canvas is styled in the zoomed root, so its CSS size is in CSS px (visual width / zoom).
      cssW = Math.max(1, Math.floor(toCssPx(wrap.getBoundingClientRect().width)));
      cssH = Math.max(1, heightRef.current);
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

    // The loop runs only while the canvas is on screen and the tab is visible.
    let inView = true;
    const run = () => {
      const want = inView && !document.hidden && wrap.getBoundingClientRect().height > 0;
      if (want && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!want && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    runRef.current = run;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      run();
    }) : null;
    io?.observe(wrap);
    document.addEventListener('visibilitychange', run);
    run();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io?.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', run);
      window.clearTimeout(tapTimerRef.current);
      relayoutRef.current = null;
      runRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // Height prop change, collapse or UI zoom: relayout without rebuilding the scene, then restart or pause the loop.
  useEffect(() => {
    relayoutRef.current?.();
    runRef.current?.();
  }, [height, collapsed, zoom]);

  // Place the tip once it is measured, so it stays inside the camera box.
  useLayoutEffect(() => {
    const el = tipElRef.current;
    const wrap = wrapRef.current;
    if (!tip || !el || !wrap) return;
    const at = placeTip(tip.x, tip.y, el.offsetWidth, el.offsetHeight, wrap.clientWidth, wrap.clientHeight);
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  }, [tip]);

  const hideTip = () => {
    window.clearTimeout(tapTimerRef.current);
    tipTextRef.current = '';
    setTip(null);
  };
  const onMove = (e: PointerEvent) => {
    // Touch and pen moves are drags, so they never change the tip. Only a mouse hovers.
    if (e.pointerType !== 'mouse') return;
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    window.clearTimeout(tapTimerRef.current);
    const r = canvas.getBoundingClientRect();
    // Pointer px are visual; the scene and the tip work in CSS px of the zoomed root.
    const mx = toCssPx(e.clientX - r.left);
    const my = toCssPx(e.clientY - r.top);
    const pe = scene.hitTest(mx, my);
    const text = pe ? scene.roleLabel(pe) : '';
    if (text !== tipTextRef.current) {
      tipTextRef.current = text;
      setTip(text ? { x: mx, y: my, text } : null);
    } else if (text) {
      setTip((t) => (t ? { x: mx, y: my, text } : t));
    }
  };
  const onLeave = (e: PointerEvent) => {
    // A finger lifts with a pointerleave too, so a tap tip stays for its full time.
    if (e.pointerType === 'mouse') hideTip();
  };
  const onDown = (e: PointerEvent) => {
    // Desktop: the hover tip does the work.
    if (e.pointerType === 'mouse') return;
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    const r = canvas.getBoundingClientRect();
    const mx = toCssPx(e.clientX - r.left);
    const my = toCssPx(e.clientY - r.top);
    const pe = scene.hitTest(mx, my);
    if (!pe) {
      hideTip();
      return;
    }
    // A tap on a person shows their tag for TAP_TIP_MS. The HQ has no select action yet, so a second tap just keeps it.
    const text = scene.roleLabel(pe);
    window.clearTimeout(tapTimerRef.current);
    tipTextRef.current = text;
    setTip({ x: mx, y: my, text });
    tapTimerRef.current = window.setTimeout(hideTip, TAP_TIP_MS);
  };

  const hidden = collapsed || camMode === 'off';
  return (
    <>
      {hidden && (
        <button type="button" class="office-toggle office-show" aria-expanded={false} onClick={() => { setCollapsed(false); hideTip(); }} disabled={camMode === 'off'}>
          {camMode === 'off' ? 'Cameras are off (Menu)' : 'Show office'}
        </button>
      )}
      <div class="office-view" ref={wrapRef} style={{ height: hidden ? '0px' : `${height}px`, display: hidden ? 'none' : undefined }}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={onLeave} aria-label="Office scene" />
        <div class="cam cam-tl" aria-hidden="true">
          <span>CAM-01</span>
          <span class="cam-name">HQ floor</span>
        </div>
        <div class="cam cam-tr" aria-hidden="true">
          <span class="cam-rec blink">● REC</span>
        </div>
        <div class="cam cam-bl" aria-hidden="true">
          {tdate(props.state.day)}
        </div>
        {tip && (
          <div class="office-tip" ref={tipElRef}>
            {tip.text}
          </div>
        )}
        <button type="button" class="cam-toggle" aria-expanded={true} onClick={() => { setCollapsed(true); hideTip(); }}>
          Hide
        </button>
      </div>
    </>
  );
}
