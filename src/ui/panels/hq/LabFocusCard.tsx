// OWNER: ONBOARD (v10 agent 7). The lab's strategic focus (GAME_DESIGN §19.1). Lives in Headquarters "Details".
import type { GameState } from '../../../sim/types';
import { doctrineById, DOCTRINE_CHANGE_COST, DOCTRINE_COOLDOWN } from '../../../sim/data/doctrines';
import { doctrineCooldownLeft } from '../../../sim/systems/doctrine';
import { Button, Card } from '../../components';
import { DOCTRINE_EVENT } from '../../shell/DoctrinePicker';

export function LabFocusCard({ s }: { s: GameState }) {
  const cur = doctrineById(s.company.doctrine);
  const left = doctrineCooldownLeft(s);
  const openPicker = () => window.dispatchEvent(new CustomEvent(DOCTRINE_EVENT));

  if (!cur) {
    return (
      <Card title="Lab focus" subtitle="No focus yet">
        <div class="dp-focus">
          <div class="dp-focus-row">
            <span class="dp-muted">Five strategies, none of them the only way to win. The first pick is free.</span>
            <Button variant="primary" size="sm" onClick={openPicker}>
              Choose
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const reason = `Focus can change in ${left} days. Changing costs hype -${DOCTRINE_CHANGE_COST.hype}, morale -${DOCTRINE_CHANGE_COST.morale}.`;
  const perks = cur.perks.join(' · ');
  const drawbacks = cur.drawbacks.join(' · ');
  return (
    <Card title="Lab focus">
      <div class="dp-focus">
        <div class="dp-focus-row">
          <span class="dp-focus-name">{cur.name}</span>
          <Button size="sm" disabled={left > 0} title={left > 0 ? reason : `Changing costs hype -${DOCTRINE_CHANGE_COST.hype}, morale -${DOCTRINE_CHANGE_COST.morale}`} onClick={openPicker}>
            Change
          </Button>
        </div>
        <div class="dp-focus-line dp-up-text" title={perks}>
          ▲ {perks}
        </div>
        <div class="dp-focus-line dp-down-text" title={drawbacks}>
          ▼ {drawbacks}
        </div>
        {left > 0 && <div class="dp-focus-note">{reason}</div>}
        {left === 0 && <div class="dp-focus-note">Free to change. Changes wait {DOCTRINE_COOLDOWN} days after the last pick.</div>}
      </div>
    </Card>
  );
}
