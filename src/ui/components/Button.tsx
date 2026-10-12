import type { ComponentChildren } from 'preact';

export interface ButtonProps {
  /** primary = violet-cyan gradient, ghost = text-only, danger = red, success = green. */
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  /** Square button for a single icon/glyph. */
  iconOnly?: boolean;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  onClick?: (e: MouseEvent) => void;
  class?: string;
  children?: ComponentChildren;
}

export function Button({ variant = 'default', size = 'md', block, iconOnly, disabled, title, type = 'button', onClick, class: cls, children }: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    iconOnly ? 'btn-icon' : '',
    cls ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} class={classes} disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
