// The fold around a panel's camera scene: a "plate" in the paper. Closed under 1200px wide and open above by default;
// the choice is remembered per panel in localStorage. The scene only mounts while open, so a closed plate costs nothing.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

const wide = (): boolean => (globalThis.innerWidth ?? 1440) >= 1200;

/** defaultOpen applies only when nothing is stored for the panel yet; undefined keeps the width rule. */
export function ViewFold({ panel, class: cls, label = 'Camera plate', defaultOpen, children }: { panel: string; class?: string; label?: string; defaultOpen?: boolean; children: ComponentChildren }) {
  const key = `llm-lets-loose-money/view-${panel}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = globalThis.localStorage?.getItem(key);
      if (v === '1' || v === '0') return v === '1';
    } catch {
      /* storage blocked: fall back to the width rule */
    }
    return defaultOpen ?? wide();
  });
  return (
    <details
      class={`disclosure view-fold${cls ? ` ${cls}` : ''}`}
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
      <summary>{label}</summary>
      {open && children}
    </details>
  );
}
