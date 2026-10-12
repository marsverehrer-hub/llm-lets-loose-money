import { useEffect, useRef, useState } from 'preact/hooks';

export interface AnimatedNumberProps {
  value: number;
  /** Formats the displayed (tweened) number. Default: rounded with separators. */
  format?: (n: number) => string;
  /** Tween length in ms. Default 600. */
  duration?: number;
  /** Flash green when the target goes up, red when it goes down. */
  flash?: boolean;
  class?: string;
  title?: string;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Number that tweens toward `value` with requestAnimationFrame.
 * Non-finite targets jump without animating.
 */
export function AnimatedNumber({ value, format = defaultFormat, duration = 600, flash = false, class: cls, title }: AnimatedNumberProps) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const rafRef = useRef(0);
  const prevRef = useRef(value);
  const [dir, setDir] = useState<'' | 'up' | 'down'>('');
  const dirTimer = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    const to = value;
    if (!isFinite(to) || !isFinite(from) || from === to || duration <= 0) {
      shownRef.current = to;
      setShown(to);
      return;
    }
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      shownRef.current = t >= 1 ? to : from + (to - from) * e;
      setShown(shownRef.current);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  useEffect(() => {
    if (!flash) return;
    const prev = prevRef.current;
    prevRef.current = value;
    if (value === prev || !isFinite(value) || !isFinite(prev)) return;
    setDir(value > prev ? 'up' : 'down');
    window.clearTimeout(dirTimer.current);
    dirTimer.current = window.setTimeout(() => setDir(''), 800);
  }, [value, flash]);

  useEffect(() => () => window.clearTimeout(dirTimer.current), []);

  const text = isFinite(shown) ? format(shown) : '—';
  return (
    <span class={`num${dir ? ` flash-${dir}` : ''}${cls ? ` ${cls}` : ''}`} title={title}>
      {text}
    </span>
  );
}
