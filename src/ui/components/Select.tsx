import type { ComponentChildren } from 'preact';

export interface SelectOption {
  value: string;
  label: ComponentChildren;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  class?: string;
  /** Stretch to the container width. */
  block?: boolean;
}

/** v18: the house dropdown (styled .select with a drawn chevron). Every dropdown uses this, never a raw select. */
export function Select({ value, onChange, options, disabled, ariaLabel, title, class: cls, block }: SelectProps) {
  return (
    <select
      class={`select${block ? ' select-block' : ''}${cls ? ` ${cls}` : ''}`}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
