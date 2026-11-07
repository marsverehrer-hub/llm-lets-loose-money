// OWNER: v10 MARKETING agent. v18: a secondary section behind a disclosure. The body mounts only when it is opened.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export function Fold({ summary, children, class: cls }: { summary: ComponentChildren; children: ComponentChildren; class?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details class={`disclosure mk-fold ${cls ?? ''}`} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}
