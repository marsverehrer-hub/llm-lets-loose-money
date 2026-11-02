import type { PanelId } from '../App';
import { HUBS, HubIcon, hubBadge, hubOf, type Badge, type Hub } from './hubs';

export interface NavItemDef {
  id: PanelId;
  label: string;
  /** Legacy function code (e.g. MDL). Not shown; kept for callers. */
  code: string;
}

export interface SideNavProps {
  items: NavItemDef[];
  active: PanelId;
  /** Opens a hub (App picks the panel: the last one visited there, or the first). */
  onHub: (hub: Hub) => void;
  /** 'dot' = something new, 'warn' = needs attention. */
  badges?: Partial<Record<PanelId, Badge>>;
  /** Panel the tutorial points at: its hub pulses. */
  highlight?: PanelId | null;
}

/** Hubs that have at least one visible panel, in order. */
export function visibleHubs(items: NavItemDef[]): Hub[] {
  const ids = new Set(items.map((i) => i.id));
  return HUBS.filter((h) => h.ids.some((id) => ids.has(id)));
}

/** Desktop sidebar: the game's mark, then one large button per hub. Under 1100px it folds to an icon rail. */
export function SideNav({ items, active, onHub, badges = {}, highlight = null }: SideNavProps) {
  const activeHub = hubOf(active).id;
  const tutHub = highlight ? hubOf(highlight).id : null;
  return (
    <nav class="sidenav" aria-label="Main">
      <div class="sn-brand" aria-hidden="true">
        <span class="sn-logo">LLM</span>
        <span class="sn-brand-text">
          <span class="sn-brand-name">Lets Loose Money</span>
          <span class="sn-brand-tag">AI lab tycoon</span>
        </span>
      </div>
      <div class="sn-hubs">
        {visibleHubs(items).map((hub) => {
          const badge = hubBadge(hub, badges);
          const on = activeHub === hub.id;
          return (
            <button
              key={hub.id}
              type="button"
              class={`hub-item hub-${hub.id} ${on ? 'active' : ''} ${tutHub === hub.id ? 'tut-pulse' : ''}`}
              title={hub.label}
              aria-label={hub.label}
              aria-current={on ? 'page' : undefined}
              onClick={() => onHub(hub)}
            >
              <span class="hub-chip">
                <HubIcon hub={hub.id} />
              </span>
              <span class="hub-text">
                <span class="hub-label">{hub.label}</span>
                <span class="hub-blurb">{hub.blurb}</span>
              </span>
              {badge && <span class={`hub-badge ${badge}`} aria-label={badge === 'warn' ? 'Needs attention' : 'New'} />}
            </button>
          );
        })}
      </div>
      <div class="sn-foot">
        <span class="kbd">Space</span> pause <span class="kbd">1</span>
        <span class="kbd">2</span>
        <span class="kbd">3</span> speed <span class="kbd">?</span> help
      </div>
    </nav>
  );
}
