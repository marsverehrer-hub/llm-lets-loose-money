import type { ComponentChildren } from 'preact';

export interface CardProps {
  title?: ComponentChildren;
  /** Terse dim note shown in the title strip after the title. Keep it short. */
  subtitle?: ComponentChildren;
  /** Function code shown dim at the left of the title strip, e.g. "MDL". */
  code?: string;
  /** @deprecated Terminal theme renders no icons. */
  icon?: string;
  /** Right-aligned strip content: buttons, segmented controls. */
  actions?: ComponentChildren;
  /** Emphasised window (amber-dim border). Same as `hot`. */
  glow?: boolean;
  hot?: boolean;
  /** Removes body padding (tables, charts and canvases that bleed to the edge). */
  flush?: boolean;
  /** Clickable window. */
  link?: boolean;
  onClick?: () => void;
  class?: string;
  /** Inline CSS variables, e.g. { '--c': lab.color }. */
  style?: Record<string, string | number>;
  children?: ComponentChildren;
}

/** Terminal window: optional title strip (code, TITLE, note, actions) over a body. */
export function Card({ title, subtitle, code, actions, glow, hot, flush, link, onClick, class: cls, style, children }: CardProps) {
  const hasHeader = title != null || actions != null;
  const classes = ['card', glow || hot ? 'card-hot' : '', flush ? 'card-flush' : '', link || onClick ? 'card-link' : '', cls ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <section class={classes} onClick={onClick} style={style as any}>
      {hasHeader && (
        <header class="card-header">
          <div class="card-heading">
            {code && <span class="card-code">{code}</span>}
            {title != null && <h3 class="card-title">{title}</h3>}
            {subtitle != null && <span class="card-subtitle">{subtitle}</span>}
          </div>
          {actions != null && <div class="card-actions">{actions}</div>}
        </header>
      )}
      <div class="card-body">{children}</div>
    </section>
  );
}
