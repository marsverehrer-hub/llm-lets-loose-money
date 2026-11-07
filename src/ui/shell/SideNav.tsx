import type { PanelId } from '../App';
import type { ComponentChildren } from 'preact';
import { HUBS, HubIcon, TAB_LABEL, type Badge, type Hub } from './hubs';

export interface NavItemDef {
  id: PanelId;
  label: string;
}

export interface SideNavProps {
  items: NavItemDef[];
  active: PanelId;
  onSelect: (id: PanelId) => void;
  /** 'dot' = something new, 'warn' = needs attention. */
  badges?: Partial<Record<PanelId, Badge>>;
  /** Panel the tutorial points at: its row pulses. */
  highlight?: PanelId | null;
  /** Live status (the run dock) at the foot of the sidebar. */
  children?: ComponentChildren;
}

/** Hubs that have at least one visible panel, in order. */
export function visibleHubs(items: NavItemDef[]): Hub[] {
  const ids = new Set(items.map((i) => i.id));
  return HUBS.filter((h) => h.ids.some((id) => ids.has(id)));
}

/** Desktop sidebar (v22): every visible screen, one click away, grouped under its area; live status at the foot. */
export function SideNav({ items, active, onSelect, badges = {}, highlight = null, children }: SideNavProps) {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  return (
    <nav class="sidenav" aria-label="Main">
      <div class="sn-hubs">
        {visibleHubs(items).map((hub) => (
          <div key={hub.id} class={`sn-group hub-${hub.id}`} role="group" aria-label={hub.label}>
            <div class="sn-group-head">
              <HubIcon hub={hub.id} size={14} />
              {hub.label}
            </div>
            {hub.ids.map((id) => {
              const item = byId.get(id);
              if (!item) return null;
              const badge = badges[id];
              const on = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  class={`hub-item ${on ? 'active' : ''} ${highlight === id ? 'tut-pulse' : ''}`}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => onSelect(id)}
                >
                  <span class="hub-label">{TAB_LABEL[id] ?? item.label}</span>
                  {badge && <span class={`hub-badge ${badge}`} aria-label={badge === 'warn' ? 'Needs attention' : 'New'} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {children && <div class="sn-foot">{children}</div>}
    </nav>
  );
}
