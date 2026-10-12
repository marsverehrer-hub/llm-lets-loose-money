// OWNER: ONBOARD (v10 agent 7). Headquarters "What to do next": one suggestion, one button that goes there.
import type { GameState } from '../../../sim/types';
import { Button, Card } from '../../components';
import { navigate } from '../../nav';
import { PANEL_INFO } from '../../unlocks';
import { nextStep } from './nextStep';

export function NextCard({ s }: { s: GameState }) {
  const step = nextStep(s);
  const label = PANEL_INFO[step.panel].label;
  return (
    <Card title="What to do next" class="hq-next-card">
      <div class="hq-next">
        <p class="hq-next-text">{step.text}</p>
        <Button variant="primary" title={`Opens ${label}`} onClick={() => navigate(step.panel)}>
          {`Open ${label}`}
        </Button>
      </div>
    </Card>
  );
}
