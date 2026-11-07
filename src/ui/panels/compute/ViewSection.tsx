// A panel's camera, folded into a "View" disclosure. Open by default on wide screens, closed below 1200px, and the
// choice is remembered per panel. The camera mounts only while open, so a closed view costs nothing.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** Below this width the camera starts folded. */
const VIEW_WIDE = 1200;

/** The saved choice, else open only on wide screens. Storage can be blocked, so every access is guarded. */
function readOpen(key: string): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved === '1';
  } catch {
    /* no storage: fall through to the width rule */
  }
  return window.innerWidth >= VIEW_WIDE;
}

export function ViewSection({ panel, class: cls, children }: { panel: string; class?: string; children: ComponentChildren }) {
  const key = `llm-lets-loose-money/view-${panel}`;
  const [open, setOpen] = useState(() => readOpen(key));
  const onToggle = (e: Event) => {
    const next = (e.currentTarget as HTMLDetailsElement).open;
    setOpen(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  return (
    <details class={`disclosure cc-view ${cls ?? ''}`} open={open} onToggle={onToggle}>
      <summary>View</summary>
      {open && children}
    </details>
  );
}
