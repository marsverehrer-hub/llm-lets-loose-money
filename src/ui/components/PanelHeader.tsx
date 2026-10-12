import type { ComponentChildren } from 'preact';

export interface PanelHeaderProps {
  title: ComponentChildren;
  /** Function code block, e.g. "MDL" renders as [MDL <GO>]. */
  code?: string;
  /** One terse dim line. */
  subtitle?: ComponentChildren;
  /** @deprecated Terminal theme renders no icons. */
  icon?: string;
  /** Right-aligned buttons or readouts. */
  actions?: ComponentChildren;
}

/** Top-of-page strip: [CODE <GO>] TITLE  sub ............ actions, amber rule underneath. */
export function PanelHeader({ title, code, subtitle, actions }: PanelHeaderProps) {
  return (
    <header class="panel-header">
      <div class="panel-header-main">
        {code && <span class="ph-code">{code}</span>}
        <h1 class="panel-title">{title}</h1>
        {subtitle != null && <span class="panel-sub">{subtitle}</span>}
      </div>
      {actions != null && <div class="row-wrap">{actions}</div>}
    </header>
  );
}
