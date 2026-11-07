// Headquarters: the research topic on one compact card, beside the training run.
import type { GameState } from '../../../sim/types';
import { effectiveResearchCost, recommendedResearch } from '../../../sim/systems/research';
import { Button, Card, ProgressBar, formatDays, formatPct } from '../../components';
import { navigate } from '../../nav';
import { NODE_BY_ID, topicName } from '../research/model';

export function ResearchLine({ s }: { s: GameState }) {
  const id = s.research.current;
  const node = id ? NODE_BY_ID.get(id) : undefined;

  if (!node) {
    const rec = recommendedResearch(s);
    return (
      <Card title="Research" subtitle="Idle">
        <div class="hq-res">
          <p class="muted small">{rec ? `Next: ${rec.label}. ${rec.why}` : 'Pick a topic to unlock better models and cheaper training.'}</p>
          <Button size="sm" onClick={() => navigate('research')}>
            Open Research
          </Button>
        </div>
      </Card>
    );
  }

  const cost = effectiveResearchCost(s, node);
  const frac = cost > 0 ? s.research.progress / cost : 0;
  const ppd = s.research.pointsPerDay;
  const days = ppd > 0 ? Math.max(0, cost - s.research.progress) / ppd : Infinity;
  return (
    <Card title="Research" subtitle={topicName(node)}>
      <div class="hq-res">
        <div class="hq-res-head">
          <span class="hq-res-name">{topicName(node)}</span>
          <span class="num">{formatPct(frac)}</span>
        </div>
        <ProgressBar value={frac} height={6} />
        <div class="hq-res-foot small">
          <span class="muted">{Number.isFinite(days) ? `ETA ${formatDays(days)}` : 'Stalled. Nothing is researching it.'}</span>
          <Button size="sm" variant="ghost" onClick={() => navigate('research')}>
            Open
          </Button>
        </div>
      </div>
    </Card>
  );
}
