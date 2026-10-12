import { useRef } from 'preact/hooks';

let seq = 0;

/** Stable unique id per component instance (for SVG gradient ids). */
export function useUid(prefix: string): string {
  const ref = useRef('');
  if (!ref.current) ref.current = `${prefix}-${++seq}`;
  return ref.current;
}
