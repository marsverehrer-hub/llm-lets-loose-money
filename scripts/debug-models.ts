import { createInitialState } from '../src/sim/state';
import { estimateTraining, availableDatasets } from '../src/sim/systems/training';
import { RESEARCH } from '../src/sim/data/research';
import { DATASETS } from '../src/sim/data/datasets';
const s = createInitialState(1);
console.log('owned', s.data.owned);
for (const [N, D] of [[0.35, 7], [1.5, 30], [175, 300], [1800, 13000]]) {
  const e = estimateTraining(s, N, D, DATASETS.map(d=>d.id), []);
  console.log(N, D, e.predictedLoss.toFixed(3), JSON.stringify(e.predictedScores), e.overall.toFixed(1), e.dataQuality.toFixed(2));
}
s.research.completed = RESEARCH.map(r=>r.id);
const techs = RESEARCH.filter(r=>r.technique).map(r=>r.id);
console.log('techs', techs.join(','));
for (const [N, D] of [[1.5, 30], [175, 300], [1800, 13000], [20000, 400000]]) {
  const e = estimateTraining(s, N, D, DATASETS.map(d=>d.id), techs);
  console.log(N, D, e.predictedLoss.toFixed(3), JSON.stringify(e.predictedScores), e.overall.toFixed(1));
}
console.log(DATASETS.map(d=>`${d.id} ${d.unlockYear} ${d.tokensB}B q${d.quality} $${d.cost} ${JSON.stringify(d.scoreBonus??{})}`).join('\n'));
console.log(RESEARCH.map(r=>`${r.tier} ${r.id} ${r.cost} ${r.minYear} ${JSON.stringify(r.scoreBonus??{})} ${JSON.stringify(r.bonuses??{})}`).join('\n'));
