import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { currentZoom, toCssPx } from '../uiScale';
import { useIsMobile } from './useIsMobile';
import { Sheet } from './Sheet';

export interface PopoverProps {
  /** Trigger button content, e.g. "Filters". */
  label: ComponentChildren;
  /** Small count shown on the trigger (e.g. active filters). Hidden when 0 or undefined. */
  count?: number;
  /** Title of the phone sheet. Defaults to the label when it is a string. */
  title?: string;
  /** Which edge of the trigger the panel lines up with. Default 'left'. */
  align?: 'left' | 'right';
  /** Panel width in px on desktop. Default 280. */
  width?: number;
  class?: string;
  /** Content, or a render function that gets `close`. */
  children: ComponentChildren | ((close: () => void) => ComponentChildren);
}

/** Keep the panel this far from the window edges (visual px). */
const EDGE = 8;
/** Gap between the trigger and the panel (visual px). */
const GAP = 4;

interface Place {
  left: number;
  top: number;
}

/**
 * v10: a button that opens a small floating panel (desktop) or a sheet (phones). Use it to put secondary
 * controls (filters, sort, advanced options, rarely used actions) behind one click. The panel is fixed to the
 * window, so a scrolling table or card cannot clip it. It slides along the screen edge, flips above the trigger when
 * there is no room below, closes on Escape, on a click outside, and when the page scrolls.
 */
export function Popover({ label, count, title, align = 'left', width = 280, class: cls, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const phone = useIsMobile();
  const close = () => setOpen(false);

  // Place the panel under the trigger (CSS px in the zoomed root), clamped to the window.
  useLayoutEffect(() => {
    if (!open || phone) {
      setPlace(null);
      return;
    }
    const trig = ref.current?.querySelector<HTMLElement>('.popover-trigger');
    if (!trig) return;
    const zoom = currentZoom();
    const w = width * zoom;
    const r = trig.getBoundingClientRect();
    const vw = window.innerWidth;
    const left = Math.min(Math.max(align === 'right' ? r.right - w : r.left, EDGE), vw - EDGE - w);
    setPlace({ left: toCssPx(left), top: toCssPx(r.bottom + GAP) });
  }, [open, phone, align, width]);

  // Once the panel has its height: flip above the trigger if it would run off the bottom.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trig = ref.current?.querySelector<HTMLElement>('.popover-trigger');
    if (!open || phone || !place || !panel || !trig) return;
    const zoom = currentZoom();
    const pr = panel.getBoundingClientRect();
    const tr = trig.getBoundingClientRect();
    const vh = window.innerHeight;
    if (pr.bottom > vh - EDGE && tr.top - GAP - pr.height > EDGE) {
      const top = toCssPx(tr.top - GAP - pr.height);
      if (Math.abs(top - place.top) > 0.5 / zoom) setPlace({ ...place, top });
    }
  }, [place, open, phone]);

  useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // The panel is fixed to the window, so it would drift away from its trigger. Close it instead.
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, phone]);

  const body = typeof children === 'function' ? (children as (c: () => void) => ComponentChildren)(close) : children;

  return (
    <span ref={ref} class={`popover ${open ? 'open' : ''} ${cls ?? ''}`}>
      <button type="button" class="btn btn-sm popover-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        {label}
        {count ? <span class="popover-count num">{count}</span> : null}
        <span class="popover-caret" aria-hidden="true">▾</span>
      </button>
      {open && !phone && (
        <div
          ref={panelRef}
          class={`popover-panel ${align}`}
          style={{
            width: `${width}px`,
            left: place ? `${place.left.toFixed(1)}px` : undefined,
            top: place ? `${place.top.toFixed(1)}px` : undefined,
            visibility: place ? 'visible' : 'hidden',
          }}
          role="dialog"
        >
          {body}
        </div>
      )}
      {phone && (
        <Sheet open={open} title={title ?? (typeof label === 'string' ? label : undefined)} onClose={close}>
          {body}
        </Sheet>
      )}
    </span>
  );
}
