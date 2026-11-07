// v18 P-sweeps: a panel's camera scene sits behind one "View" disclosure. Closed under 1200px wide, open above it,
// remembered per panel. The scene is mounted only while open, so a closed panel draws no canvas.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** Below this width the camera starts closed. */
const VIEW_WIDE = 1200;

function readOpen(key: string): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved === '1';
  } catch {
    /* no storage: fall through to the width rule */
  }
  return window.innerWidth >= VIEW_WIDE;
}

export function CameraDisclosure({ panel, children }: { panel: string; children: ComponentChildren }) {
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
    <details class="disclosure cam-view" open={open} onToggle={onToggle}>
      <summary>View</summary>
      {open && children}
    </details>
  );
}
