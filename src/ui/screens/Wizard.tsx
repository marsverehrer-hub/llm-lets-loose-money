// The blueprint wizard: Size, Data, Tricks, Plan. The forecast strip at the bottom answers "what will this earn?" live.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { Blueprint, GameState, Id, Modality } from '../../sim/types';
import { check, dataCost } from '../../sim/apply';
import { pick, rand } from '../../sim/rand';
import { availableTechs, dataUnique, RUSH, SLOTS } from '../../sim/resolve';
import { forecast } from '../../sim/view';
import { MODALITIES, SEGMENTS } from '../../sim/content/modalities';
import { archsOf, TECHS } from '../../sim/content/tech';
import { CODENAMES } from '../../sim/content/flavor';
import { publicWeek } from '../../sim/research';
import { Btn, Card, Chip, Seg, Sheet, Stepper } from '../kit';
import { act } from '../store';
import { big, money } from '../fmt';
import { BenchRows } from './Lab';
import { segDef, liveSegs } from '../../sim/demand';

interface Draft {
  name: string; modality: Modality; arch: Id; budget: number; weeks: 4 | 6 | 8; sizeBias: number;
  weights: Record<string, number>; techniques: Id[]; exp: number; postAmt: number; post: number | 'distill'; promise: Id | null;
}
const BUDGETS = [0.08, 0.12, 0.18, 0.25, 0.35, 0.45, 0.6, 0.8];
const STEPS = ['Size', 'Data', 'Tricks', 'Plan'] as const;
let saved: Draft | null = null; // survives closing the sheet

const fresh = (s: GameState, m: Modality): Draft => ({
  name: pick(CODENAMES, rand(s.seed, s.week, 'codename', String(Object.keys(s.runs).length))), modality: m, arch: archsOf(m)[0].id, budget: 3, weeks: 6, sizeBias: 0,
  weights: Object.fromEntries(MODALITIES[m].data.map((d) => [d.id, 2])), techniques: [], exp: 0.1, postAmt: 0.05, post: 0, promise: null,
});

function toBlueprint(s: GameState, d: Draft, promiseTarget?: number): Blueprint {
  const total = Object.values(d.weights).reduce((a, b) => a + b, 0) || 1;
  const cash = Math.max(0, s.companies[s.labId].cash);
  return {
    modality: d.modality, arch: d.arch, weeks: d.weeks, sizeBias: d.sizeBias,
    compute: (BUDGETS[d.budget] * cash) / (s.market.computePrice * RUSH[d.weeks]),
    split: { scale: 1 - d.exp - d.postAmt, exp: d.exp, post: d.postAmt },
    mix: Object.fromEntries(Object.entries(d.weights).map(([k, w]) => [k, w / total])),
    techniques: d.techniques, post: d.post,
    ...(d.promise && promiseTarget != null ? { promise: { seg: d.promise, target: promiseTarget } } : {}),
  };
}

export function Wizard({ s, onClose }: { s: GameState; onClose: () => void }): JSX.Element {
  const [d, setD] = useState<Draft>(() => saved ?? fresh(s, 'lang'));
  const [step, setStep] = useState(0);
  const up = (patch: Partial<Draft>): void => { const next = { ...d, ...patch }; saved = next; setD(next); };
  const mod = MODALITIES[d.modality];
  const base = forecast(s, toBlueprint(s, d));
  const promiseRow = d.promise ? base.rows.find((r) => r.seg === d.promise) : undefined;
  const bp = toBlueprint(s, d, promiseRow ? Math.round(promiseRow.mid) : undefined);
  const f = base;
  const err = check(s, { t: 'startRun', bp, name: d.name });
  const lab = s.companies[s.labId].lab!;
  const techs = availableTechs(s, s.labId, d.modality);
  const soon = TECHS.filter((t) => t.mods.includes(d.modality) && publicWeek(s, t) > s.week && !lab.techniques.includes(t.id)).sort((a, b) => publicWeek(s, a) - publicWeek(s, b)).slice(0, 2);
  const total = Object.values(d.weights).reduce((a, b) => a + b, 0) || 1;

  const train = (): void => { act({ t: 'startRun', bp, name: d.name }); saved = null; onClose(); };

  return (
    <Sheet title="Design a model" onClose={onClose} foot={
      <div class="forecast">
        <div class="row">
          <span class="grow"><span class="muted small">Should earn</span><br /><b class={f.profit[1] > 0 ? 'good' : 'bad'}>{money(f.profit[0])} to {money(f.profit[2])}/wk</b></span>
          <span><span class="muted small">Costs</span><br /><b>{money(f.totalCost)}</b> <span class="muted small">over {d.weeks} wk</span></span>
        </div>
        <div class="row">
          <Btn kind="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Btn>
          <span class="grow center small muted">{STEPS[step]} · {step + 1} of {STEPS.length}</span>
          {step < STEPS.length - 1 ? <Btn kind="primary" id="wiz-next" onClick={() => setStep(step + 1)}>Next</Btn> : <Btn kind="primary" id="wiz-train" why={err} onClick={train}>Train</Btn>}
        </div>
        {step === STEPS.length - 1 && err && <p class="bad small">{err}</p>}
      </div>
    }>
      <nav class="steps">{STEPS.map((n, i) => <button type="button" class={i === step ? 'on' : ''} onClick={() => setStep(i)}>{n}</button>)}</nav>

      {step === 0 && <>
        <label class="field"><span>Codename</span><input value={d.name} maxLength={28} onInput={(e) => up({ name: (e.target as HTMLInputElement).value })} /></label>
        <Seg label="Kind of model" value={d.modality} options={Object.values(MODALITIES).filter((m) => m.unlockWeek <= s.week).map((m) => ({ v: m.id, label: m.name }))}
          onChange={(m) => { const n = fresh(s, m); up({ ...n, name: d.name, budget: d.budget, weeks: d.weeks }); }} />
        {Object.values(MODALITIES).filter((m) => m.unlockWeek > s.week).map((m) => <p class="muted small">{m.name} models become possible in {m.unlockWeek - s.week} weeks.</p>)}
        <h3>Architecture</h3>
        <div class="picks">{archsOf(d.modality, s.week).map((a) => (
          <button type="button" class={`pick ${a.id === d.arch ? 'on' : ''}`} onClick={() => up({ arch: a.id })}>
            <strong>{a.name}</strong><span class="note">{a.blurb}</span>
            {!lab.history.includes('arch:' + a.id) && <Chip tone="warn">New to your lab</Chip>}
          </button>
        ))}</div>
        <h3>Budget</h3>
        <div class="row"><Stepper label="budget" value={money(f.totalCost)} canDown={d.budget > 0} canUp={d.budget < BUDGETS.length - 1} onDown={() => up({ budget: d.budget - 1 })} onUp={() => up({ budget: d.budget + 1 })} />
          <span class="muted small">{Math.round(BUDGETS[d.budget] * 100)}% of your cash, {money(f.weeklyCost)} a week</span></div>
        <h3>Schedule</h3>
        <Seg label="Run length" value={d.weeks} options={[{ v: 4, label: '4 wk rush +25%' }, { v: 6, label: '6 weeks' }, { v: 8, label: '8 wk −15%' }]} onChange={(w) => up({ weeks: w })} />
        <h3>Shape</h3>
        <Seg label="Model size against training tokens" value={d.sizeBias} onChange={(v) => up({ sizeBias: v })}
          options={[{ v: -1, label: 'Tiny' }, { v: -0.5, label: 'Small' }, { v: 0, label: 'Even' }, { v: 0.5, label: 'Big' }, { v: 1, label: 'Huge' }]} />
        <p class="muted small">{big(f.params)} parameters on {big(f.tokens)} tokens. Small models are cheap and quick to serve and know more; big ones reason better and cost more per answer.</p>
      </>}

      {step === 1 && <>
        <p class="muted">The diet decides what the model is good at. Leaning hard on one kind wins one benchmark and loses others.</p>
        {mod.data.map((k) => {
          const level = lab.data[k.id] ?? 0;
          const cost = dataCost(s, k.cost, level);
          const whyBuy = check(s, { t: 'buyData', kind: k.id });
          const short = f.tokens * (d.weights[k.id] / total) > dataUnique(s, s.labId, d.modality, k.id);
          return (
            <div class="datarow">
              <div class="grow"><b>{k.name}</b> <span class="muted small">{k.blurb}</span><br />
                <span class="small">{Math.round((100 * d.weights[k.id]) / total)}% of the mix</span>{' '}
                {short && <Chip tone="bad">Running out: repeats</Chip>}{s.known['dq:' + k.id] ? <Chip tone="good">Quality known</Chip> : null}
                <br /><button type="button" class="link" disabled={!!whyBuy} title={whyBuy ?? ''} onClick={() => act({ t: 'buyData', kind: k.id })}>
                  {level >= 3 ? 'Fully licensed' : `License more (${money(cost)})`} {'●'.repeat(level)}{'○'.repeat(3 - level)}</button>
              </div>
              <Stepper label={k.name} value={String(d.weights[k.id])} canDown={d.weights[k.id] > 0 && total > 1} canUp={d.weights[k.id] < 6}
                onDown={() => up({ weights: { ...d.weights, [k.id]: d.weights[k.id] - 1 } })} onUp={() => up({ weights: { ...d.weights, [k.id]: d.weights[k.id] + 1 } })} />
            </div>
          );
        })}
      </>}

      {step === 2 && <>
        <p class="muted">{SLOTS} slots. Every trick has a price. Some pairs click and some fight, and you only learn which by trying.</p>
        <div class="picks">{techs.map((t) => {
          const on = d.techniques.includes(t.id);
          const full = !on && d.techniques.length >= SLOTS;
          return (
            <button type="button" class={`pick ${on ? 'on' : ''}`} disabled={full} onClick={() => up({ techniques: on ? d.techniques.filter((x) => x !== t.id) : [...d.techniques, t.id] })}>
              <strong>{t.name}</strong>
              <span class="chips"><Chip tone="good">{t.up}</Chip><Chip tone="bad">{t.down}</Chip>
                {!lab.history.includes('tech:' + t.id) && <Chip tone="warn">New to your lab</Chip>}{lab.techniques.includes(t.id) && t.week > s.week && <Chip tone="good">Only you have it</Chip>}</span>
            </button>
          );
        })}</div>
        {f.syn.length > 0 && <Card title="From the notebook">{f.syn.map((x) => <p class={x.value > 0 ? 'good' : x.value < 0 ? 'bad' : 'muted'}>{x.a} + {x.b}: {x.value > 0 ? '+3' : x.value < 0 ? '−3' : 'no effect on'} {mod.axes[x.axis]}</p>)}</Card>}
        {soon.map((t) => <p class="muted small">{t.name} goes public in {publicWeek(s, t) - s.week} weeks. Research it in the Lab to get it sooner.</p>)}
      </>}

      {step === 3 && <>
        <h3>Experiments</h3>
        <Seg label="Share of compute spent on experiments" value={d.exp} onChange={(v) => up({ exp: v })} options={[0, 0.03, 0.06, 0.1, 0.15, 0.22, 0.3].map((v) => ({ v, label: `${Math.round(v * 100)}%` }))} />
        <p class="muted small">Sweeps and ablations. They tighten the forecast and recover quality you would otherwise lose on anything new. On a repeat build they are mostly wasted.</p>
        <h3>Post-training</h3>
        <Seg label="Share of compute spent on post-training" value={d.postAmt} onChange={(v) => up({ postAmt: v })} options={[0, 0.05, 0.1, 0.15].map((v) => ({ v, label: `${Math.round(v * 100)}%` }))} />
        <Seg label="Post-training target" value={d.post} onChange={(v) => up({ post: v })} options={[...mod.axes.map((a, i) => ({ v: i as number | 'distill', label: a })), { v: 'distill' as number | 'distill', label: 'Cheaper to serve' }]} />
        <h3>Public promise</h3>
        <Seg label="Promise a benchmark score" value={d.promise ?? ''} onChange={(v) => up({ promise: v || null })} options={[{ v: '', label: 'None' }, ...liveSegs(s, d.modality).map((g) => ({ v: g.id, label: g.name }))]} />
        <p class="muted small">{promiseRow ? `You will promise ${Math.round(promiseRow.mid)} on ${segDef(s, d.promise!).bench}. Hit it for a hype and brand boost; miss it and pay for it.` : 'Say nothing and nobody can hold you to it.'}</p>
        {f.reasons.map((r) => <p class="reason">{r}</p>)}
      </>}

      <h3>Forecast</h3>
      <BenchRows s={s} rows={f.rows} />
      <p class="chips"><Chip>Sells at ×{f.price}</Chip><Chip tone={f.attrs.trust >= 0.8 ? 'good' : f.attrs.trust < 0.6 ? 'bad' : 'info'}>Trust {Math.round(f.attrs.trust * 100)}</Chip>
        <Chip tone={f.attrs.speed >= 1 ? 'good' : 'info'}>Speed ×{f.attrs.speed.toFixed(1)}</Chip><Chip tone={f.instab > 0.5 ? 'bad' : 'info'}>{f.instab > 0.5 ? 'Unstable' : f.instab > 0.2 ? 'A bit touchy' : 'Stable'}</Chip></p>
    </Sheet>
  );
}
