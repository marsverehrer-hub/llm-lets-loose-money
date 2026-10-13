// Phone navigation (<= 760px): a bottom tab bar with four primary panels and a More tab. More opens a sheet with every
// other panel, grouped like the desktop rail. Desktop never renders this (App picks SideNav instead).
import { useState } from 'preact/hooks';
import type { PanelId } from '../App';
import { Button, Sheet } from '../components';
import { runwayDays } from '../../sim/systems/finance';
import { useGame } from '../store';
import { runwayLabel } from './fmt';
import { GROUPS, type NavItemDef } from './SideNav';

/** v13: tab labels short enough for a 75px column ("Headquarters" was cut to "Headquarte..."). */
const SHORT: Partial<Record<PanelId, string>> = { dashboard: 'Home', research: 'Research', lab: 'Lab' };

/** Panels that get a tab. Everything else lives under More. */
const PRIMARY: PanelId[] = ['dashboard', 'models', 'products', 'research'];
/** During a multiplayer match VS takes the last tab, and research moves under More. */
const PRIMARY_MATCH: PanelId[] = ['dashboard', 'models', 'products', 'vs'];

export interface MobileNavProps {
  items: NavItemDef[];
  active: PanelId;
  onSelect: (id: PanelId) => void;
  /** Same markers as SideNav: 'dot' = new, 'warn' = needs attention. */
  badges?: Partial<Record<PanelId, 'dot' | 'warn'>>;
  /** Panel to pulse (tutorial). A panel under More pulses the More tab. */
  highlight?: PanelId | null;
}

function BadgeMark({ tone }: { tone: 'dot' | 'warn' }) {
  return (
    <span class={`mtab-badge ${tone === 'warn' ? 'warn' : ''}`} aria-label={tone === 'warn' ? 'Needs attention' : 'New'}>
      {tone === 'warn' ? '!' : '*'}
    </span>
  );
}

export function MobileNav({ items, active, onSelect, badges = {}, highlight = null }: MobileNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i] as const));
  // App lists 'vs' only while a match runs, so its presence is the match flag.
  const primaryIds = items.some((i) => i.id === 'vs') ? PRIMARY_MATCH : PRIMARY;
  const primary = primaryIds.map((id) => byId.get(id)).filter((x): x is NavItemDef => !!x);
  const rest = items.filter((i) => !primaryIds.includes(i.id));

  const restActive = rest.some((i) => i.id === active);
  const restBadge: 'dot' | 'warn' | undefined = rest.some((i) => badges[i.id] === 'warn')
    ? 'warn'
    : rest.some((i) => badges[i.id])
      ? 'dot'
      : undefined;
  const restHighlight = !!highlight && rest.some((i) => i.id === highlight);

  // Same grouping as the desktop rail; leftovers land in More.
  const used = new Set<PanelId>();
  const groups = GROUPS.map((g) => ({ title: g.title, items: g.ids.map((id) => rest.find((i) => i.id === id)).filter((x): x is NavItemDef => !!x) }));
  for (const g of groups) for (const i of g.items) used.add(i.id);
  const leftovers = rest.filter((i) => !used.has(i.id));
  if (leftovers.length) groups.push({ title: 'More', items: leftovers });

  const pick = (id: PanelId) => {
    setMoreOpen(false);
    onSelect(id);
  };

  return (
    <>
      {/* One column per tab, so 4 tabs fill the bar when a panel is still locked (mobile.css reads --tab-count). */}
      <nav class="mtabs" aria-label="Main" style={{ '--tab-count': primary.length + 1 } as any}>
        {primary.map((item) => {
          const badge = badges[item.id];
          return (
            <button
              key={item.id}
              type="button"
              class={`mtab ${active === item.id ? 'active' : ''} ${highlight === item.id ? 'tut-pulse' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-current={active === item.id ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span class="mtab-code">{item.code}</span>
              <span class="mtab-label">{SHORT[item.id] ?? item.label}</span>
              {badge && <BadgeMark tone={badge} />}
            </button>
          );
        })}
        <button
          type="button"
          class={`mtab ${restActive ? 'active' : ''} ${restHighlight ? 'tut-pulse' : ''}`}
          aria-label="More panels"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <span class="mtab-code">…</span>
          <span class="mtab-label">More</span>
          {restBadge && <BadgeMark tone={restBadge} />}
        </button>
      </nav>

      <Sheet
        open={moreOpen}
        title="More"
        subtitle="Every other panel."
        onClose={() => setMoreOpen(false)}
        footer={
          <Button variant="primary" block onClick={() => setMoreOpen(false)}>
            Close
          </Button>
        }
      >
        <RunwayNote />
        <div class="sheet-list">
          {groups.map((g) =>
            g.items.length === 0 ? null : (
              <section key={g.title} class="sheet-group">
                <h3 class="sheet-group-title">{g.title}</h3>
                {g.items.map((item) => {
                  const badge = badges[item.id];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      class={`sheet-row ${active === item.id ? 'active' : ''}`}
                      aria-current={active === item.id ? 'page' : undefined}
                      onClick={() => pick(item.id)}
                    >
                      <span class="sheet-row-code">{item.code}</span>
                      <span class="sheet-row-label">{item.label}</span>
                      {badge && <BadgeMark tone={badge} />}
                    </button>
                  );
                })}
              </section>
            ),
          )}
        </div>
      </Sheet>
    </>
  );
}

/** Runway line for the More sheet (the desktop rail shows it in its footer). Reads the store only while the sheet is open. */
function RunwayNote() {
  const s = useGame();
  const runway = runwayDays(s);
  const broke = s.finance.negativeCashDays > 0;
  const tone = !isFinite(runway) ? 'good' : runway < 180 ? 'bad' : runway < 540 ? 'warn' : 'good';
  return (
    <div class="sheet-note">
      <span class="faint">Runway</span> <span class={`num bold ${tone}`}>{runwayLabel(runway)}</span>
      <div class={broke ? 'bad small' : 'faint small'}>
        {broke ? `${s.finance.negativeCashDays} days in the red. Bankruptcy at 30.` : 'Keep an eye on the burn.'}
      </div>
    </div>
  );
}
