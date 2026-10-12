import type { ComponentChildren } from 'preact';
import type { PillTone } from './types';

export interface PillProps {
  tone?: PillTone;
  /** Leading coloured dot in the tone colour. */
  dot?: boolean;
  /** @deprecated Terminal theme renders no icons. */
  icon?: string;
  title?: string;
  class?: string;
  children?: ComponentChildren;
}

/** Bracketed uppercase tag, e.g. LIVE / SECRET / RET. */
export function Pill({ tone = 'default', dot, icon, title, class: cls, children }: PillProps) {
  const classes = ['pill', tone !== 'default' ? `pill-${tone}` : '', cls ?? ''].filter(Boolean).join(' ');
  return (
    <span class={classes} title={title}>
      {dot && <span class={`dot dot-${tone}`} />}
      {children}
    </span>
  );
}
