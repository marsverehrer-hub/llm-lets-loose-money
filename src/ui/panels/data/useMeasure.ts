import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * The layout width of an element, kept current as it resizes. Uses clientWidth so the value is in the same units as
 * the SVG width written from it. Falls back to `initial` until the element is mounted.
 */
export function useMeasure<T extends HTMLElement>(initial: number): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = Math.floor(el.clientWidth);
      if (next > 0) setWidth((cur) => (cur === next ? cur : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
