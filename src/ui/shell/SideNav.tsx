import type { PanelId } from '../App';
import { runwayDays } from '../../sim/systems/finance';
import { useGame } from '../store';
import { runwayLabel } from './fmt';

export interface NavItemDef {
  id: PanelId;
  label: string;
  /** 2-3 letter function code, e.g. MDL. */
  code: string;
}

export interface SideNavProps {
  items: NavItemDef[];
  active: PanelId;
  onSelect: (id: PanelId) => void;
  /** Trailing marker on a nav item: 'dot' = something new (*), 'warn' = needs attention (!). */
  badges?: Partial<Record<PanelId, 'dot' | 'warn'>>;
  /** Item to pulse, used by the tutorial to point at the panel for the current step. */
  highlight?: PanelId | null;
}

/** Display grouping. Ids not listed here land in "More". */
export const GROUPS: { title: string; ids: PanelId[] }[] = [
  { title: 'Company', ids: ['dashboard', 'finance', 'market', 'marketing', 'contracts', 'vs'] },
  { title: 'Lab', ids: ['models', 'products', 'research', 'benchmarks', 'data', 'compute', 'staff'] },
  { title: 'Meta', ids: ['achievements'] },
];

/**
 * Left navigation: `CODE  Label` rows grouped under tiny headers. Under 1100px
 * only the code column remains; the full label stays in the title and aria-label.
 */
export function SideNav({ items, active, onSelect, badges = {}, highlight = null }: SideNavProps) {
  const s = useGame();
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const used = new Set<PanelId>();
  const groups = GROUPS.map((g) => ({
    title: g.title,
    items: g.ids.map((id) => byId.get(id)).filter((x): x is NavItemDef => !!x),
  }));
  for (const g of groups) for (const i of g.items) used.add(i.id);
  const rest = items.filter((i) => !used.has(i.id));
  if (rest.length) groups.push({ title: 'More', items: rest });

  const runway = runwayDays(s);
  const broke = s.finance.negativeCashDays > 0;
  const runwayTone = !isFinite(runway) ? 'good' : runway < 180 ? 'bad' : runway < 540 ? 'warn' : 'good';

  return (
    <nav class="sidenav" aria-label="Main">
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.title}>
            <div class="nav-section">{g.title}</div>
            {g.items.map((item) => {
              const badge = badges[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  class={`nav-item ${active === item.id ? 'active' : ''} ${highlight === item.id ? 'tut-pulse' : ''}`}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={active === item.id ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span class="nav-icon">{item.code}</span>
                  <span class="nav-label">{item.label}</span>
                  {badge && (
                    <span class={`nav-badge ${badge === 'warn' ? 'warn' : ''}`} aria-label={badge === 'warn' ? 'Needs attention' : 'New'}>
                      {badge === 'warn' ? '!' : '*'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ),
      )}

      <div class="sidenav-foot" title={broke ? `${s.finance.negativeCashDays} days in the red. Bankruptcy at 30.` : 'Time until cash runs out at the current burn'}>
        <div class="sf-label">Runway</div>
        <div class={`sf-value ${runwayTone}`}>{runwayLabel(runway)}</div>
        {broke ? (
          <div class="sf-text bad">{s.finance.negativeCashDays} days in the red. Bankruptcy at 30.</div>
        ) : (
          <div class="sf-text">Keep an eye on the burn.</div>
        )}
      </div>
    </nav>
  );
}
