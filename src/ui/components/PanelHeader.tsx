import type { ComponentChildren } from 'preact';

export interface PanelHeaderProps {
  title: ComponentChildren;
  /** One short line next to the title. */
  subtitle?: ComponentChildren;
  /** @deprecated No icons in panel headers. */
  icon?: string;
  /** Right-aligned buttons or readouts. */
  actions?: ComponentChildren;
}

/** v18: top of a screen in one compact row: title, a short line of context, actions on the right. */
export function PanelHeader({ title, subtitle, actions }: PanelHeaderProps) {
  return (
    <header class="panel-header">
      <div class="panel-header-main">
        <h1 class="panel-title">{title}</h1>
        {subtitle != null && <span class="panel-sub">{subtitle}</span>}
      </div>
      {actions != null && <div class="panel-header-actions row-wrap">{actions}</div>}
    </header>
  );
}
