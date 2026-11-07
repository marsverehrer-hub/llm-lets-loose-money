// The "View" disclosure around a panel's camera scene (P-sweeps rule c): closed under 1200px wide, open above, and the
// choice is remembered per panel in localStorage. Storage can be blocked, so every access is guarded.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

const wide = (): boolean => (globalThis.innerWidth ?? 1440) >= 1200;

export function ViewFold({ panel, children }: { panel: string; children: ComponentChildren }) {
  const key = `llm-lets-loose-money/view-${panel}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = globalThis.localStorage?.getItem(key);
      if (v === '1' || v === '0') return v === '1';
    } catch {
      /* storage blocked: fall back to the width rule */
    }
    return wide();
  });
  return (
    <details
      class="disclosure view-fold"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        try {
          globalThis.localStorage?.setItem(key, o ? '1' : '0');
        } catch {
          /* storage blocked: the choice is not remembered */
        }
      }}
    >
      <summary>View</summary>
      {children}
    </details>
  );
}
