// Navigation hubs: the ~15 panels grouped into five areas. The sidebar (desktop) and the bottom tab bar (phones)
// list hubs; the hub's panels are tabs at the top of the main area (HubTabs). PanelId values never change.
import { createContext } from 'preact';
import type { PanelId } from '../App';

export type HubId = 'home' | 'lab' | 'infra' | 'business' | 'company';

export interface Hub {
  id: HubId;
  label: string;
  /** Tab-bar label on phones. */
  short: string;
  /** One line under the label in the desktop sidebar. */
  blurb: string;
  ids: PanelId[];
}

export const HUBS: Hub[] = [
  { id: 'home', label: 'Headquarters', short: 'Home', blurb: 'What to do next', ids: ['dashboard', 'vs'] },
  // v17.3: train and sell side by side, so the core loop (train, release, launch) stays in one hub.
  { id: 'lab', label: 'Lab', short: 'Lab', blurb: 'Models, products, research', ids: ['models', 'products', 'research', 'data', 'benchmarks'] },
  { id: 'infra', label: 'Infrastructure', short: 'Infra', blurb: 'GPUs and people', ids: ['compute', 'staff'] },
  { id: 'business', label: 'Business', short: 'Business', blurb: 'Market, deals, money', ids: ['market', 'field', 'marketing', 'contracts', 'finance'] },
  { id: 'company', label: 'Company', short: 'Company', blurb: 'Level, perks, trophies', ids: ['lab', 'achievements'] },
];

/** Tab labels inside a hub (shorter than the panel's full name where the hub already says it). */
export const TAB_LABEL: Partial<Record<PanelId, string>> = { dashboard: 'Overview', vs: 'Versus', lab: 'Level & perks' };

export function hubOf(id: PanelId): Hub {
  return HUBS.find((h) => h.ids.includes(id)) ?? HUBS[0];
}

/** The hub the current panel belongs to, for the panel header eyebrow. */
export const HubContext = createContext<Hub | null>(null);

export type Badge = 'dot' | 'warn';

/** A hub's marker: any warning among its panels wins over a "new" dot. */
export function hubBadge(hub: Hub, badges: Partial<Record<PanelId, Badge>>): Badge | undefined {
  if (hub.ids.some((id) => badges[id] === 'warn')) return 'warn';
  if (hub.ids.some((id) => badges[id])) return 'dot';
  return undefined;
}

/** Line icons for the hubs: 24px viewBox, drawn with currentColor. */
export function HubIcon({ hub, size = 20 }: { hub: HubId; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  return (
    <svg class="hub-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {hub === 'home' && (
        <g {...p}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5v-5h4v5" />
        </g>
      )}
      {hub === 'lab' && (
        <g {...p}>
          <path d="M9 3h6" />
          <path d="M10 3v6.5L4.8 18.2A1.6 1.6 0 0 0 6.2 20.5h11.6a1.6 1.6 0 0 0 1.4-2.3L14 9.5V3" />
          <path d="M7.5 14.5h9" />
        </g>
      )}
      {hub === 'infra' && (
        <g {...p}>
          <rect x="4" y="4" width="16" height="6.5" rx="1.8" />
          <rect x="4" y="13.5" width="16" height="6.5" rx="1.8" />
          <path d="M8 7.25h.01M8 16.75h.01M12 7.25h4M12 16.75h4" />
        </g>
      )}
      {hub === 'business' && (
        <g {...p}>
          <path d="M4 19.5h16" />
          <path d="M6.5 16V12M11 16V8.5M15.5 16v-5M20 5l-5 4-4-2.5L4.5 10" />
        </g>
      )}
      {hub === 'company' && (
        <g {...p}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
          <path d="M8 6H5a3 3 0 0 0 3 3.5M16 6h3a3 3 0 0 1-3 3.5" />
          <path d="M12 13v3.5M8.5 20h7l-.8-3.5H9.3z" />
        </g>
      )}
    </svg>
  );
}
