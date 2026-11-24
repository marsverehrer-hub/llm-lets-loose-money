// The Lab: the live run, the model shelf and the notebook.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { GameState, Model, Run } from '../../sim/types';
import { check, handsOnRun } from '../../sim/apply';
import { PROJECT_WEEKS, projectCost } from '../../sim/offers';
import { LEAK_WEEKS, publicWeek, RATES, researchable, researchCost, researchSpend } from '../../sim/research';
import { crowns, liveSegs, PRICE_STEPS, projectRevenue, segDef } from '../../sim/demand';
import { notebook, runView, type BenchRow } from '../../sim/view';
import { MODALITIES, SEGMENTS, segmentsOf } from '../../sim/content/modalities';
import { arch, tech } from '../../sim/content/tech';
import { quirk, VERDICT } from '../../sim/content/flavor';
import { Band, Btn, Card, Chip, Crown, Logo, Seg, Stepper } from '../kit';
import { act } from '../store';
import { coName, money } from '../fmt';

export function BenchRows({ s, rows, actual }: { s: GameState; rows: BenchRow[]; actual?: number[] }): JSX.Element {
  return (
    <ul class="bench">
      {rows.map((r, i) => {
        const def = segDef(s, r.seg);
        const ahead = (actual?.[i] ?? r.mid) > r.leaderFit;
        return (
          <li>
            <div class="row"><span class="grow"><b>{def.bench}</b> <span class="muted">{def.name}</span></span>
              <span class={ahead ? 'good' : 'muted'}>{Math.round(r.lo)}–{Math.round(r.hi)}</span></div>
            <Band lo={r.lo} mid={r.mid} hi={r.hi} leader={r.leaderFit} actual={actual?.[i]} />
            <div class="muted small">{r.leader ? `${coName(s, r.leader)} leads at ${Math.round(r.leaderFit)}` : 'Nobody here yet'}</div>
          </li>
        );
      })}
    </ul>
  );
}

function RunCard({ s, run }: { s: GameState; run: Run }): JSX.Element {
  const v = runView(s, run);
  const W = 280, H = 90;
  const losses = run.reports.map((r) => r.loss);
  const x = (i: number): number => (i / Math.max(1, run.weeksPlanned - 1)) * W;
  const y = (l: number): number => H - 6 - ((4.3 - l) / 2.6) * (H - 12);
  const mids = run.reports.map((r) => r.mid);
  return (
    <Card title={run.name} tag={`Week ${run.weeksDone} of ${run.weeksPlanned}`} color="var(--blue)">
      <div class="progress"><span style={{ width: `${(100 * run.weeksDone) / run.weeksPlanned}%` }} /></div>
      {losses.length > 0 && (
        <figure class="chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Training loss, falling over the weeks">
            <polyline class="draw" points={losses.map((l, i) => `${x(i)},${y(l)}`).join(' ')} fill="none" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            {losses.map((l, i) => <circle cx={x(i)} cy={y(l)} r="3.5" fill="#fff" stroke="var(--ink)" stroke-width="2" />)}
          </svg>
          <figcaption class="muted small">Loss {losses[losses.length - 1].toFixed(2)} · forecast now ±{(1.3 * v.sd).toFixed(1)} points{mids.length > 1 ? `, was ±${(1.3 * run.reports[0].sd).toFixed(1)}` : ''}</figcaption>
        </figure>
      )}
      <BenchRows s={s} rows={v.rows} />
      <div class="stats">
        <div><span class="muted small">Worth about</span><b class={v.profit > 0 ? 'good' : 'bad'}>{money(v.profit)}/wk</b></div>
        <div><span class="muted small">Weekly bill</span><b>{money(v.weeklyCost)}</b></div>
        <div><span class="muted small">Spent</span><b>{money(run.spent)}</b></div>
      </div>
      <p class="chips">
        <Chip>{arch(run.bp.arch).name}</Chip>
        {run.bp.techniques.map((t) => <Chip>{tech(t).name}</Chip>)}
        <Chip tone={v.attrs.trust >= 0.8 ? 'good' : v.attrs.trust < 0.6 ? 'bad' : 'info'}>Trust {Math.round(v.attrs.trust * 100)}</Chip>
      </p>
    </Card>
  );
}

function SideProject({ s, m }: { s: GameState; m: Model }): JSX.Element {
  const segs = liveSegs(s, m.modality);
  const [seg, setSeg] = useState(segs[0].id);
  const busy = s.projects.find((p) => p.lab === s.labId);
  if (busy) return <p class="muted small">{busy.model === m.id ? `${busy.kind === 'tune' ? 'Fine-tune' : 'Distill'} ready in ${busy.done - s.week} weeks.` : 'Your team is on another side project.'}</p>;
  return (
    <details class="side">
      <summary>Side projects</summary>
      <Seg label="Fine-tune for" value={seg} options={segs.map((g) => ({ v: g.id, label: g.name.split(/[ &]/)[0] }))} onChange={setSeg} />
      <div class="row">
        <Btn class="grow" why={check(s, { t: 'project', model: m.id, kind: 'tune', seg })} onClick={() => act({ t: 'project', model: m.id, kind: 'tune', seg })}>Fine-tune: {money(projectCost(s, m, 'tune'))}</Btn>
        <Btn class="grow" why={check(s, { t: 'project', model: m.id, kind: 'distill', seg: null })} onClick={() => act({ t: 'project', model: m.id, kind: 'distill', seg: null })}>Distill: {money(projectCost(s, m, 'distill'))}</Btn>
      </div>
      <p class="muted small">A fine-tune leans this model toward one segment's benchmark in {PROJECT_WEEKS.tune} weeks. A distill makes a half-price-to-serve copy that is a bit dumber, in {PROJECT_WEEKS.distill} weeks. Both run beside your main training run and ship as new models.</p>
    </details>
  );
}

function ModelCard({ s, m }: { s: GameState; m: Model }): JSX.Element {
  const axes = MODALITIES[m.modality].axes;
  const i = PRICE_STEPS.indexOf(m.price);
  const proj = projectRevenue(s, s.labId);
  const mine = proj.rows.filter((r) => segDef(s, r.seg).modality === m.modality);
  const owns = crowns(s, s.labId).filter((id) => segDef(s, id).modality === m.modality);
  return (
    <Card title={m.name} tag={`${VERDICT[m.verdict].label} · ${s.week - m.shipped} weeks old`} color={m.retired ? '#c9c5d6' : 'var(--purple)'}>
      <ul class="caps">
        {m.cap.map((c, k) => <li><span class="small">{axes[k]}</span><span class="capbar"><i style={{ width: `${Math.max(4, Math.min(100, c))}%` }} /></span><b>{Math.round(c)}</b></li>)}
      </ul>
      <p class="chips">
        <Chip>{(m.params / 1e9).toFixed(1)}B params</Chip>
        <Chip tone={m.attrs.trust >= 0.8 ? 'good' : m.attrs.trust < 0.6 ? 'bad' : 'info'}>Trust {Math.round(m.attrs.trust * 100)}</Chip>
        {m.quirks.map((q) => <Chip tone="warn">{quirk(q).name}</Chip>)}
      </p>
      {!m.retired && (
        <div class="row wrap">
          <span class="grow"><span class="muted small">Price</span><br />
            <Stepper label="price" value={`×${m.price}`} canDown={i > 0} canUp={i < PRICE_STEPS.length - 1}
              onDown={() => act({ t: 'setPrice', model: m.id, price: PRICE_STEPS[i - 1] })} onUp={() => act({ t: 'setPrice', model: m.id, price: PRICE_STEPS[i + 1] })} /></span>
          <span><span class="muted small">Lab profit on {MODALITIES[m.modality].name.toLowerCase()}</span><br /><b>{money(mine.reduce((a, r) => a + r.profit, 0))}/wk</b></span>
        </div>
      )}
      {!m.retired && s.helm && <SideProject s={s} m={m} />}
      <div class="row">
        <span class="grow">{owns.map((id) => <span class="crowned"><Crown /> {segDef(s, id).bench}</span>)}</span>
        <Btn kind="ghost" onClick={() => act({ t: 'retire', model: m.id })}>{m.retired ? 'Put back on sale' : 'Retire'}</Btn>
      </div>
    </Card>
  );
}

function ResearchCard({ s }: { s: GameState }): JSX.Element {
  const co = s.companies[s.labId], r = co.lab!.research;
  const options = researchable(s, s.labId);
  const aim = options.find((t) => t.id === r.aim) ?? options[0];
  const early = co.lab!.techniques.map(tech).filter((t) => publicWeek(s, t) > s.week);
  return (
    <Card title="Research" tag={r.rate ? `${money(researchSpend(co))} a week` : 'Paused'} color="var(--teal)">
      <Seg label="Research budget" value={r.rate} options={RATES.map((v) => ({ v, label: v ? `${v * 100}% of revenue` : 'None' }))} onChange={(rate) => act({ t: 'research', rate })} />
      <p class="muted small">Buys techniques before they go public. The further ahead, the dearer. Ship a model with a private technique and everyone gets it {LEAK_WEEKS} weeks later.</p>
      {aim && <>
        <div class="row"><span class="grow"><b>{aim.name}</b> <span class="muted small">public in {publicWeek(s, aim) - s.week} weeks</span></span><span class="small">{money(r.points)} / {money(researchCost(s, aim))}</span></div>
        <div class="progress"><span style={{ width: `${Math.min(100, (100 * r.points) / researchCost(s, aim))}%` }} /></div>
        <p class="chips"><Chip tone="good">{aim.up}</Chip><Chip tone="bad">{aim.down}</Chip></p>
      </>}
      {options.length > 1 && (
        <details class="side"><summary>Change target</summary>
          <div class="picks">{options.slice(0, 6).map((t) => (
            <button type="button" class={`pick ${t.id === aim?.id ? 'on' : ''}`} onClick={() => act({ t: 'research', aim: t.id })}>
              <strong>{t.name}</strong><span class="note">{t.mods.map((m) => MODALITIES[m].name).join(', ')} · public in {publicWeek(s, t) - s.week} weeks · {money(researchCost(s, t))}</span>
            </button>
          ))}</div>
        </details>
      )}
      {early.length > 0 && <p class="chips">{early.map((t) => <Chip tone="good">Only you: {t.name}</Chip>)}</p>}
    </Card>
  );
}

export function Lab({ s, openWizard }: { s: GameState; openWizard: () => void }): JSX.Element {
  const run = handsOnRun(s);
  const models = Object.values(s.models).filter((m) => m.lab === s.labId).sort((a, b) => b.shipped - a.shipped);
  const notes = notebook(s);
  return (
    <div class="screen">
      {!s.helm && <Card color="#c9c5d6"><p class="lead">You do not run this lab any more. It trains and ships without you.</p></Card>}
      {run ? <RunCard s={s} run={run} /> : s.helm && (
        <Card color="var(--pink)" class="hero">
          <h2>{models.length ? 'Build the next one' : 'Build your first model'}</h2>
          <p class="muted">Pick a size, a diet and a few tricks. Then watch it train.</p>
          <Btn kind="primary" id="new-model" onClick={openWizard}>Design a model</Btn>
        </Card>
      )}
      {models.map((m) => <ModelCard key={m.id} s={s} m={m} />)}
      {s.helm && <ResearchCard s={s} />}
      <Card title="Notebook" tag="What your lab has learned">
        {notes.length === 0 && <p class="muted">Empty. Experiments and finished runs fill it with what works together and what does not.</p>}
        <ul class="news">{notes.map((n) => <li class={n.tone}><span class="dot" /><span>{n.text}</span></li>)}</ul>
        {Object.entries(s.standing).map(([def, opt]) => (
          <div class="row"><span class="grow small">Standing order: {def} → option {opt + 1}</span><Btn kind="ghost" onClick={() => act({ t: 'clearStanding', def })}>Clear</Btn></div>
        ))}
      </Card>
      <p class="muted small center">Rivals: {Object.values(s.companies).filter((c) => c.id !== s.labId).map((c) => <span class="inline"><Logo co={c} size={16} /> {Object.values(s.runs).some((r) => r.lab === c.id && r.status === 'running') ? 'training' : 'idle'} </span>)}</p>
    </div>
  );
}
