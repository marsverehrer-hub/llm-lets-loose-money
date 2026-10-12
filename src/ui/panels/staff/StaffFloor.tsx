import type { RoleId } from '../../../sim/types';
import { CELL_H, CELL_W, floorLayout, type FloorSlot, type TeamStat } from './model';

export interface StaffFloorProps {
  cap: number;
  teams: TeamStat[];
  /** Team under the pointer (or focus). Wins over the selection for the dim effect. */
  hover: RoleId | null;
  selected: RoleId | null;
  onHover: (id: RoleId | null) => void;
  onSelect: (id: RoleId) => void;
}

/**
 * v10 hero: one person glyph per seat (or per N people in big offices). Team groups use team colours; empty seats
 * are hollow cells. Hover or tap a group to see it; click selects it.
 */
export function StaffFloor({ cap, teams, hover, selected, onHover, onSelect }: StaffFloorProps) {
  const layout = floorLayout(
    cap,
    teams.map((t) => ({ id: t.id, heads: t.heads })),
  );
  const byRole = new Map<RoleId, FloorSlot[]>();
  const empties: FloorSlot[] = [];
  for (const slot of layout.slots) {
    if (slot.role) {
      const list = byRole.get(slot.role) ?? [];
      list.push(slot);
      byRole.set(slot.role, list);
    } else {
      empties.push(slot);
    }
  }
  const active = hover ?? selected;
  const per = layout.unit > 1 ? ` (1 glyph = ${layout.unit} people)` : '';

  return (
    <svg
      class="sf-svg"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Office floor${per}`}
      style={{ maxWidth: `${layout.width}px` }}
    >
      {empties.map((e) => (
        <rect key={`e${e.i}`} class="sf-empty" x={e.x + 2} y={e.y + 2} width={CELL_W - 4} height={CELL_H - 4} rx={2} />
      ))}
      {teams.map((t) => {
        const slots = byRole.get(t.id);
        if (!slots || slots.length === 0) return null;
        const cls = ['sf-team', `sf-team--${t.id}`, active && active !== t.id ? 'is-dim' : '', selected === t.id ? 'is-sel' : '']
          .filter(Boolean)
          .join(' ');
        const label = `${t.role.plural}: ${t.heads} ${t.heads === 1 ? 'person' : 'people'}`;
        return (
          <g
            key={t.id}
            class={cls}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected === t.id}
            onMouseEnter={() => onHover(t.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(t.id)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(t.id);
              }
            }}
          >
            <title>{label}</title>
            {slots.map((sl) => {
              const x = sl.x;
              const y = sl.y;
              const op = sl.fill < 1 ? Math.max(0.4, sl.fill) : undefined;
              return (
                <g key={sl.i} opacity={op}>
                  <rect class="sf-hit" x={x} y={y} width={CELL_W} height={CELL_H} />
                  <circle class="sf-person" cx={x + 13} cy={y + 9} r={4.5} />
                  <rect class="sf-person" x={x + 7} y={y + 16} width={12} height={13} rx={2} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
