import type { ComponentChildren } from 'preact';

export interface CheckProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label next to the box. Omit for a bare box (then pass `ariaLabel`). */
  label?: ComponentChildren;
  /** Muted second line or trailing hint. */
  hint?: ComponentChildren;
  disabled?: boolean;
  /** A switch instead of a tick box (for on/off settings). */
  toggle?: boolean;
  ariaLabel?: string;
  title?: string;
  class?: string;
}

/** v18: the house checkbox / switch. Every on-off control in the UI uses this, never a raw input. */
export function Check({ checked, onChange, label, hint, disabled, toggle, ariaLabel, title, class: cls }: CheckProps) {
  const box = (
    <input
      type="checkbox"
      class={`check${toggle ? ' is-toggle' : ''}`}
      role={toggle ? 'switch' : undefined}
      checked={checked}
      disabled={disabled}
      aria-label={label == null ? ariaLabel : undefined}
      onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
    />
  );
  if (label == null) return box;
  return (
    <label class={`check-row${cls ? ` ${cls}` : ''}`} title={title}>
      {box}
      <span>
        {label}
        {hint != null && <span class="check-hint"> {hint}</span>}
      </span>
    </label>
  );
}
