import type { GameState } from '../../../sim/types';
import { OFFICE_TIERS } from '../../../sim/data/roles';
import { formatMoney } from '../../../sim/util';
import { headcount, officeCapacity } from '../../../sim/systems/staff';
import { Button, Pill, Sheet } from '../../components';
import { dispatch } from '../../store';

export interface OfficeSheetProps {
  s: GameState;
  onClose: () => void;
}

/** Office list. You can only move up, one step at a time (the sim's upgradeOffice rule). */
export function OfficeSheet({ s, onClose }: OfficeSheetProps) {
  const cur = OFFICE_TIERS.findIndex((t) => t.id === s.company.officeTierId);
  const hc = headcount(s);
  const cap = officeCapacity(s);
  return (
    <Sheet open title="Change office" subtitle={`${hc} of ${cap} seats in use`} onClose={onClose} width={560}>
      <ul class="sf-office-list">
        {OFFICE_TIERS.map((t, i) => {
          const isCur = i === cur;
          const isNext = i === cur + 1;
          const isPast = i < cur;
          const affordable = s.finance.cash >= t.cost;
          return (
            <li key={t.id} class={`sf-office-row ${isCur ? 'is-cur' : ''}`}>
              <div class="sf-office-main">
                <div class="sf-office-name">
                  {t.name}
                  {isCur && <Pill tone="good">Current</Pill>}
                </div>
                <div class="sf-office-flavor">{t.flavor}</div>
                <div class="sf-office-nums num">
                  {t.capacity.toLocaleString('en-US')} seats · {t.cost === 0 ? 'Free' : `${formatMoney(t.cost, 1)} move-in`} ·{' '}
                  {formatMoney(t.rentPerDay, 1)}/d rent
                </div>
              </div>
              <div class="sf-office-act">
                {isNext && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!affordable}
                    title={affordable ? `Move in for ${formatMoney(t.cost, 1)}` : 'Not enough cash'}
                    onClick={() => dispatch({ type: 'upgradeOffice', tierId: t.id })}
                  >
                    Move in
                  </Button>
                )}
                {isPast && <span class="sf-faint">Outgrown</span>}
                {!isCur && !isPast && !isNext && <span class="sf-faint">Later</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/** v10.1: the only office move the sim allows is the next tier, so it is one button on the floor card (no sheet). */
export function NextOfficeButton({ s }: { s: GameState }) {
  const cur = OFFICE_TIERS.findIndex((t) => t.id === s.company.officeTierId);
  const next = OFFICE_TIERS[cur + 1];
  if (!next) return <span class="sf-faint">Biggest office there is</span>;
  const affordable = s.finance.cash >= next.cost;
  return (
    <Button
      size="sm"
      variant={affordable ? 'primary' : undefined}
      disabled={!affordable}
      title={`${next.flavor}
${next.capacity.toLocaleString('en-US')} seats · ${formatMoney(next.rentPerDay, 1)}/d rent`}
      onClick={() => dispatch({ type: 'upgradeOffice', tierId: next.id })}
    >
      Move to {next.name} ({next.capacity.toLocaleString('en-US')} seats, {formatMoney(next.cost, 1)})
    </Button>
  );
}
