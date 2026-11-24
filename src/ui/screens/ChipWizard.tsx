// The chip design sheet. One page: the choices, then a live forecast against the best part on the market.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ChipBlueprint, GameState, Id } from '../../sim/types';
import { check } from '../../sim/apply';
import { CHIP_WEEKS, chipForecast, chipName, chipRef, DIES, NODES } from '../../sim/chips';
import { Band, Btn, Chip, Seg, Sheet } from '../kit';
import { act } from '../store';
import { money } from '../fmt';

const BUDGETS = [0.5, 0.75, 1, 1.5, 2, 3];

export function ChipWizard({ s, company, onClose }: { s: GameState; company: Id; onClose: () => void }): JSX.Element {
  const [name, setName] = useState(() => chipName(s));
  const [b, setB] = useState(2);
  const [bp, setBp] = useState<Omit<ChipBlueprint, 'budget'>>({ node: 0, die: 1, memory: 0, focus: 'infer', weeks: 10 });
  const full: ChipBlueprint = { ...bp, budget: BUDGETS[b] * chipRef(s.week) };
  const f = chipForecast(s, company, full);
  const why = check(s, { t: 'startChip', company, bp: full, name });
  const up = (p: Partial<ChipBlueprint>): void => setBp({ ...bp, ...p });
  return (
    <Sheet title={`Design a chip at ${s.companies[company].name}`} onClose={onClose} foot={
      <div class="forecast">
        <div class="row"><span class="grow"><span class="muted small">Against the market leader</span><br /><b class={f.eff >= 1 ? 'good' : 'bad'}>×{f.lo.toFixed(2)} to ×{f.hi.toFixed(2)}</b></span>
          <span><span class="muted small">Costs</span><br /><b>{money(full.budget)}</b> <span class="muted small">over {bp.weeks} wk</span></span></div>
        <Btn kind="primary" class="wide" id="chip-go" why={why} onClick={() => { act({ t: 'startChip', company, bp: full, name }); onClose(); }}>Start the design</Btn>
      </div>
    }>
      <label class="field"><span>Name</span><input value={name} maxLength={28} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <h3>Process</h3>
      <Seg label="Process node" value={bp.node} options={NODES.map((n, i) => ({ v: i as 0 | 1, label: n }))} onChange={(node) => up({ node })} />
      <p class="muted small">The newest process is faster, and fewer of the dies work.</p>
      <h3>Die</h3>
      <Seg label="Die size" value={bp.die} options={DIES.map((n, i) => ({ v: i as 0 | 1 | 2, label: n.replace(' die', '') }))} onChange={(die) => up({ die })} />
      <h3>Memory and focus</h3>
      <Seg label="Memory" value={bp.memory} options={[{ v: 0, label: 'Lean memory' }, { v: 1, label: 'Stacked HBM' }]} onChange={(memory) => up({ memory: memory as 0 | 1 })} />
      <Seg label="Built for" value={bp.focus} options={[{ v: 'infer', label: 'Serving' }, { v: 'train', label: 'Training' }]} onChange={(focus) => up({ focus })} />
      <p class="muted small">A lab you run gets your chips at cost: a serving chip cuts what your models cost to run, a training chip cuts training bills.</p>
      <h3>Budget and schedule</h3>
      <Seg label="Budget" value={b} options={BUDGETS.map((x, i) => ({ v: i, label: `×${x}` }))} onChange={setB} />
      <Seg label="Weeks to tape-out" value={bp.weeks} options={CHIP_WEEKS.map((w) => ({ v: w, label: `${w} weeks` }))} onChange={(weeks) => up({ weeks })} />
      <h3>Forecast</h3>
      <Band lo={f.lo * 100} mid={f.eff * 100} hi={f.hi * 100} leader={100} min={50} max={180} />
      <p class="chips">
        <Chip>Performance ×{f.perf.toFixed(2)}</Chip><Chip tone={f.yld >= 0.7 ? 'good' : f.yld < 0.5 ? 'bad' : 'info'}>Yield {Math.round(f.yld * 100)}%</Chip>
        <Chip tone="good">Capacity ×{f.capacity.toFixed(2)} if it lands</Chip><Chip tone="good">Your {bp.focus === 'infer' ? 'serving' : 'training'} costs ×{f.discount.toFixed(2)}</Chip>
      </p>
      <p class="muted small">The dashed line is the best chip on sale today. Rival chip makers ship a new generation about once a year, so it moves.</p>
    </Sheet>
  );
}
