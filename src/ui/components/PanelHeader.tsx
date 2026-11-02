import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { HubContext } from '../shell/hubs';

export interface PanelHeaderProps {
  title: ComponentChildren;
  /** One short line under the title. */
  subtitle?: ComponentChildren;
  /** @deprecated No icons in panel headers. */
  icon?: string;
  /** Right-aligned buttons or readouts. */
  actions?: ComponentChildren;
}

/** Top of a screen: the hub as a coloured eyebrow, a big title, one line of context, actions on the right. */
export function PanelHeader({ title, subtitle, actions }: PanelHeaderProps) {
  const hub = useContext(HubContext);
  return (
    <header class="panel-header">
      <div class="panel-header-main">
        {hub && <span class="panel-eyebrow">{hub.label}</span>}
        <h1 class="panel-title">{title}</h1>
        {subtitle != null && <span class="panel-sub">{subtitle}</span>}
      </div>
      {actions != null && <div class="row-wrap">{actions}</div>}
    </header>
  );
}
