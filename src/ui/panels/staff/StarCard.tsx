import type { GameState, Star } from '../../../sim/types';
import { ROLES } from '../../../sim/data/roles';
import { formatMoney } from '../../../sim/util';
import { STAFF_TUNING } from '../../../sim/systems/staff';
import { Button, Pill } from '../../components';
import { dispatch } from '../../store';
import { BONUS_LABELS, fmtMult } from '../panelKit';

export interface StarCardProps {
  s: GameState;
  star: Star;
  /** Candidates only: can the star be hired right now (a seat is free)? */
  canHire?: boolean;
  blockedReason?: string;
}

/** A star hire as a card: who, what they bring (the bonus), and what it costs or what state they are in. */
export function StarCard({ s, star, canHire = true, blockedReason }: StarCardProps) {
  const hired = star.hiredDay !== null;
  const roleName = ROLES.find((r) => r.id === star.role)?.name ?? star.role;
  const fee = (ROLES.find((r) => r.id === star.role)?.hireCost ?? 0) * STAFF_TUNING.STAR_FEE_MULT;
  const left = Math.ceil((s.flags[`starExpires.${star.id}`] ?? s.day) - s.day);
  const flight = hired && star.loyalty < STAFF_TUNING.STAR_POACH_LOYALTY;
  return (
    <article class={`sf-star ${hired ? 'is-hired' : ''}`}>
      <div class="sf-star-head">
        <div class="sf-star-name">{star.name}</div>
        <div class="sf-star-title">{star.title}</div>
      </div>
      <div class="sf-star-bonus">
        {Object.entries(star.bonuses).map(([k, v]) => {
          const m = (v ?? 1) as number;
          return (
            <span key={k} class={`sf-bonus ${m >= 1 ? 'good' : 'bad'}`}>
              {fmtMult(m)} {BONUS_LABELS[k as keyof typeof BONUS_LABELS]}
            </span>
          );
        })}
      </div>
      <div class="sf-star-foot">
        <span class="num sf-star-pay">{formatMoney(star.salary, 1)}/yr · {roleName}</span>
        {hired ? (
          <span class="sf-star-state">
            <span class="num">Loyalty {Math.round(star.loyalty)}</span>
            {flight && <Pill tone="bad">Flight risk</Pill>}
          </span>
        ) : (
          <span class="sf-star-state">
            <span class="sf-faint">{left > 0 ? `Leaves in ${left} day${left === 1 ? '' : 's'}` : 'Leaving soon'}</span>
            <Button
              variant="primary"
              size="sm"
              disabled={!canHire}
              title={canHire ? `Hire for ${formatMoney(fee, 1)} recruiting fee` : blockedReason}
              onClick={() => dispatch({ type: 'hireStar', starId: star.id })}
            >
              Hire {formatMoney(fee, 0)}
            </Button>
          </span>
        )}
      </div>
    </article>
  );
}
