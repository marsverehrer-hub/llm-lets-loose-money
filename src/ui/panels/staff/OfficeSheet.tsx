import type { GameState } from '../../../sim/types';
import { OFFICE_TIERS } from '../../../sim/data/roles';
import { formatMoney } from '../../../sim/util';
import { dispatch } from '../../store';
import { ConfirmButton } from '../panelKit';

/** v10.1: the only office move the sim allows is the next tier, so it is one button on the office card (no sheet). */
export function NextOfficeButton({ s }: { s: GameState }) {
  const cur = OFFICE_TIERS.findIndex((t) => t.id === s.company.officeTierId);
  const next = OFFICE_TIERS[cur + 1];
  if (!next) return <span class="sf-faint">Biggest office there is</span>;
  const affordable = s.finance.cash >= next.cost;
  return (
    <ConfirmButton
      class="btn-sm"
      label={`Move to ${next.name} (${next.capacity.toLocaleString('en-US')} seats, ${formatMoney(next.cost, 1)})`}
      confirmLabel={`Pay ${formatMoney(next.cost, 1)} and move?`}
      disabled={!affordable}
      title={`${next.flavor}
${next.capacity.toLocaleString('en-US')} seats · ${formatMoney(next.rentPerDay, 1)}/d rent`}
      onConfirm={() => dispatch({ type: 'upgradeOffice', tierId: next.id })}
    />
  );
}
