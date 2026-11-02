// Phone navigation (<= 760px): a bottom tab bar with one tab per hub. The hub's panels are the HubTabs strip at the
// top of the main area, the same as on desktop. Desktop never renders this (App picks SideNav instead).
import type { PanelId } from '../App';
import { HubIcon, hubBadge, hubOf, type Badge, type Hub } from './hubs';
import { visibleHubs, type NavItemDef } from './SideNav';

export interface MobileNavProps {
  items: NavItemDef[];
  active: PanelId;
  onHub: (hub: Hub) => void;
  badges?: Partial<Record<PanelId, Badge>>;
  /** Panel the tutorial points at: its hub tab pulses. */
  highlight?: PanelId | null;
}

export function MobileNav({ items, active, onHub, badges = {}, highlight = null }: MobileNavProps) {
  const hubs = visibleHubs(items);
  const activeHub = hubOf(active).id;
  const tutHub = highlight ? hubOf(highlight).id : null;
  return (
    <nav class="mtabs" aria-label="Main" style={{ '--tab-count': hubs.length } as any}>
      {hubs.map((hub) => {
        const badge = hubBadge(hub, badges);
        const on = activeHub === hub.id;
        return (
          <button
            key={hub.id}
            type="button"
            class={`mtab hub-${hub.id} ${on ? 'active' : ''} ${tutHub === hub.id ? 'tut-pulse' : ''}`}
            title={hub.label}
            aria-label={hub.label}
            aria-current={on ? 'page' : undefined}
            onClick={() => onHub(hub)}
          >
            <span class="mtab-icon">
              <HubIcon hub={hub.id} size={22} />
            </span>
            <span class="mtab-label">{hub.short}</span>
            {badge && <span class={`hub-badge ${badge}`} aria-label={badge === 'warn' ? 'Needs attention' : 'New'} />}
          </button>
        );
      })}
    </nav>
  );
}
