import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { currentZoom, toCssPx } from '../uiScale';

export interface TooltipProps {
  content: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}

interface Place {
  x: number;
  top: number;
  bottom: number;
}

/** Above the anchor unless there is no room (top of the screen), then below. */
const ROOM_ABOVE = 90;

/**
 * Hover, focus or tap tooltip. A mouse gets it on hover, a finger gets it on tap (tap again, or tap anywhere else,
 * to close it). Positioned with fixed coordinates so scrolling containers do not clip it, and kept on screen.
 */
export function Tooltip({ content, children, class: cls }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Place | null>(null);

  const place = (): Place | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
  };
  const show = () => setPos(place());
  const hide = () => setPos(null);

  // Tap elsewhere closes an open tip (touch has no mouseleave).
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPos(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [!!pos]);

  // Positions below are visual px (rects, window size). The tip is styled in the zoomed root, so it is written back in CSS px.
  const zoom = currentZoom();
  const edge = 150 * zoom;
  const x = pos ? Math.min(Math.max(pos.x, edge), window.innerWidth - edge) : 0;
  const below = !!pos && pos.top < ROOM_ABOVE * zoom;

  return (
    <span
      ref={ref}
      class={`tip-anchor ${cls ?? ''}`}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') hide();
      }}
      onPointerDown={(e) => {
        // Touch and pen toggle. Mouse uses hover above.
        if (e.pointerType !== 'mouse') setPos((p) => (p ? null : place()));
      }}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos && content != null && (
        <div
          class={`tip ${below ? 'tip-below' : ''}`}
          role="tooltip"
          style={{
            position: 'fixed',
            left: `${toCssPx(x)}px`,
            top: `${toCssPx(below ? pos.bottom + 8 : pos.top - 8)}px`,
            bottom: 'auto',
            transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            visibility: 'visible',
          }}
        >
          {content}
        </div>
      )}
    </span>
  );
}
