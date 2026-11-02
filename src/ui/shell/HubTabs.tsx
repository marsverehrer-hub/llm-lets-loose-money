// The active hub's panels as tabs, pinned at the top of the main area. Hidden when the hub has only one panel.
import type { PanelId } from '../App';
import { TAB_LABEL, hubOf, type Badge } from './hubs';
import type { NavItemDef } from './SideNav';

export interface HubTabsProps {
  items: NavItemDef[];
  active: PanelId;
  onSelect: (id: PanelId) => void;
  badges?: Partial<Record<PanelId, Badge>>;
  highlight?: PanelId | null;
}

export function HubTabs({ items, active, onSelect, badges = {}, highlight = null }: HubTabsProps) {
  const hub = hubOf(active);
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const tabs = hub.ids.map((id) => byId.get(id)).filter((x): x is NavItemDef => !!x);
  if (tabs.length < 2) return null;
  return (
    <div class={`hubtabs hub-${hub.id}`} role="tablist" aria-label={hub.label}>
      {tabs.map((t) => {
        const badge = badges[t.id];
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            class={`hubtab ${active === t.id ? 'active' : ''} ${highlight === t.id ? 'tut-pulse' : ''}`}
            onClick={() => onSelect(t.id)}
          >
            {TAB_LABEL[t.id] ?? t.label}
            {badge && <span class={`hub-badge ${badge}`} aria-label={badge === 'warn' ? 'Needs attention' : 'New'} />}
          </button>
        );
      })}
    </div>
  );
}
