// Benchmarks (BMK): every active benchmark, the frontier the player is chasing, and the leaderboard for one.
// v8: a weight-class switcher filters everything to one class (rival lines included), with crown holders and the class arena.
// v10 (VIZ): bars for scores against the frontier, fewer columns, and a PanelIntro.
import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { BALANCE } from '../../sim/balance';
import { BENCHMARKS } from '../../sim/data/benchmarks';
import { activeBenchmarks, isSaturated, sotaCount } from '../../sim/systems/capabilities';
import { classArena, classBenchRows, classThresholds, crownOf } from '../../sim/systems/classes';
import type { ClassBenchRow } from '../../sim/systems/classes';
import { labInfo, labName } from '../../sim/systems/labs';
import { calendarYear } from '../../sim/util';
import type { BenchmarkDef, GameState, WeightClass } from '../../sim/types';
import { Card, PanelHeader, PanelIntro, Pill, Stat } from '../components';
import { Empty } from './panelKit';
import './panels.css';
import './classes.css';
import './bmk-viz.css';

const CAT_LABEL: Record<BenchmarkDef['category'], string> = {
  language: 'Language',
  knowledge: 'Knowledge',
  reasoning: 'Reasoning',
  math: 'Math',
  coding: 'Coding',
  agentic: 'Agentic',
  chat: 'Chat',
  vision: 'Vision',
  safety: 'Safety',
  frontier: 'Frontier',
};
const CLASS_OPTIONS: { id: WeightClass; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'medium', label: 'Medium' },
  { id: 'small', label: 'Small' },
  { id: 'nano', label: 'Nano' },
];
const CLASS_LABEL: Record<WeightClass, string> = { open: 'Open', medium: 'Medium', small: 'Small', nano: 'Nano' };

interface Line {
  def: BenchmarkDef;
  /** Best rival in the class (never the player). The frontier the player is chasing. */
  frontier: number | null;
  /** Player's best released model in the class. */
  yours: number | null;
  /** yours - frontier. */
  gap: number | null;
  /** Crown holder on this benchmark in this class, if any. */
  crown: { player: boolean; lab: string } | null;
  saturated: boolean;
  headline: boolean;
  isNew: boolean;
}

const pct = (v: number | null): string => (v === null ? '—' : v.toFixed(1));
const fmtB = (v: number): string => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));
/** A score as a bar width: scores are percentages, so 0 to 100 maps straight onto the track. */
const barW = (v: number | null): string => `${v === null ? 0 : Math.max(0, Math.min(100, v)).toFixed(1)}%`;

/** NEW: a benchmark introduced after the game started, less than a year ago. */
function isNewBench(s: GameState, def: BenchmarkDef): boolean {
  if (def.year <= BALANCE.START_YEAR) return false;
  const day = s.flags[`bench.${def.id}`];
  return day !== undefined && s.day - day < 365;
}

/** Headline benchmarks still in play first, then the rest, then saturated ones. Newest first within a group. */
function linesOf(s: GameState, cls: WeightClass): Line[] {
  const out: Line[] = activeBenchmarks(s).map((def) => {
    const rows = classBenchRows(s, def.id, cls);
    const rival = rows.find((r) => !r.isPlayer);
    const mine = rows.find((r) => r.isPlayer);
    const frontier = rival ? rival.score : null;
    const yours = mine ? mine.score : null;
    const saturated = isSaturated(s, def.id);
    const crown = crownOf(s, def.id, cls);
    return {
      def,
      frontier,
      yours,
      gap: yours !== null && frontier !== null ? yours - frontier : null,
      crown: crown ? { player: crown.holder === 'player', lab: crown.holder === 'player' ? s.company.name : labName(s, crown.holder) } : null,
      saturated,
      headline: !!def.headline && !saturated,
      isNew: isNewBench(s, def),
    };
  });
  const group = (l: Line) => (l.headline ? 0 : l.saturated ? 2 : 1);
  return out.sort((a, b) => group(a) - group(b) || b.def.year - a.def.year || a.def.name.localeCompare(b.def.name));
}

/** Lab colour, including the human rival in multiplayer. */
function labColor(s: GameState, labId: string): string {
  return labInfo(s, labId)?.color ?? 'var(--fg-3)';
}

/** One line under the switcher: the size cut-off for the class in this year. */
function ThresholdLine({ year, cls }: { year: number; cls: WeightClass }) {
  if (cls === 'open') {
    return <span class="wc-threshold">Open: any size. Every model competes here, the small ones included.</span>;
  }
  const t = classThresholds(year)[cls];
  return (
    <span class="wc-threshold">
      {CLASS_LABEL[cls]}: up to <span class="num">{fmtB(t)}B</span> active in <span class="num">{year}</span>. Smaller models compete here too.
    </span>
  );
}

/** A labelled score bar on the 0 to 100 scale. */
function ScoreBar({ label, value, tone }: { label: string; value: number | null; tone: 'you' | 'rival' | 'lab'; }) {
  return (
    <div class={`bmk-bar is-${tone}`}>
      <span class="bmk-bar-k">{label}</span>
      <span class="bmk-track" aria-hidden="true">
        <span class="bmk-fill" style={{ width: barW(value) }} />
      </span>
      <span class="bmk-bar-v num">{pct(value)}</span>
    </div>
  );
}

export function BenchmarksPanel() {
  const s = useGame();
  const year = calendarYear(s.day);
  const [cls, setCls] = useState<WeightClass>('open');
  const lines = linesOf(s, cls);
  const [picked, setPicked] = useState<string | null>(null);
  // Phones show three benchmarks in the list, then "Show all".
  const [allOpen, setAllOpen] = useState(false);
  const sel = lines.find((l) => l.def.id === picked) ?? lines[0] ?? null;
  const announced = BENCHMARKS.filter((b) => b.year > year).sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
  const arenaCount = classArena(s, cls).length;

  return (
    <div class="panel pn pn-bmk">
      <PanelHeader
        code="BMK"
        title="Benchmarks"
        subtitle={`Scores in %. Frontier is the best rival${cls === 'open' ? '' : ` in the ${CLASS_LABEL[cls].toLowerCase()} class`}.`}
        actions={<Stat label="Ranked #1" value={String(sotaCount(s))} hint="Benchmarks where you are #1" size="sm" />}
      />
      <PanelIntro id="benchmarks">Public tests for every model. Your bar against the frontier shows where you lead and where you trail.</PanelIntro>

      <div class="wc-switch">
        <div class="segmented" role="group" aria-label="Weight class">
          {CLASS_OPTIONS.map((o) => (
            <button key={o.id} type="button" class={`seg ${cls === o.id ? 'active' : ''}`} aria-pressed={cls === o.id} onClick={() => setCls(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <ThresholdLine year={year} cls={cls} />
      </div>

      <div class="bmk-grid">
        <Card class={`bmk-active ${allOpen ? 'is-open' : ''}`} code="LST" title="Active" subtitle={`${lines.length} in play · ${CLASS_LABEL[cls]} class`} flush>
          <div class="table-wrap table-stack">
            <table class="table bmk-table">
              <thead>
                <tr>
                  <th>Benchmark</th>
                  <th>Scores</th>
                  <th class="num" title="Yours minus the frontier">
                    Gap
                  </th>
                  <th>Crown</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const g = l.gap;
                  const isSel = sel?.def.id === l.def.id;
                  return (
                    <tr key={l.def.id} class={`bmk-row ${isSel ? 'sel' : ''}`} onClick={() => setPicked(l.def.id)} aria-selected={isSel}>
                      <td class="mb-head" title={l.def.fullName}>
                        <div class="bmk-name">{l.def.name}</div>
                        <div class="bmk-cat">{CAT_LABEL[l.def.category]}</div>
                        <span class="bmk-tags">
                          {l.saturated && <Pill tone="muted">Saturated</Pill>}
                          {l.headline && <Pill tone="warn">Headline</Pill>}
                          {l.isNew && <Pill tone="info">New</Pill>}
                        </span>
                      </td>
                      <td class="mb-block" data-label="Scores">
                        <div class="bmk-bars">
                          <ScoreBar label="You" value={l.yours} tone="you" />
                          <ScoreBar label="Frontier" value={l.frontier} tone="rival" />
                        </div>
                      </td>
                      <td class="num" data-label="Gap">
                        {g === null ? (
                          '—'
                        ) : (
                          <span class={g > 0 ? 'good' : g < 0 ? 'bad' : 'muted'}>
                            {g > 0 ? '▲' : g < 0 ? '▼' : '='} {Math.abs(g).toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td data-label="Crown">
                        {l.crown === null ? (
                          <span class="faint" title={l.saturated ? 'Saturated benchmarks award no crowns' : undefined}>
                            {l.saturated ? 'Retired' : '—'}
                          </span>
                        ) : l.crown.player ? (
                          <Pill tone="milestone" title="You hold this crown">
                            You
                          </Pill>
                        ) : (
                          <span class="wc-crown-other">{l.crown.lab}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lines.length > 3 && (
            <button type="button" class="btn bmk-more" aria-expanded={allOpen} onClick={() => setAllOpen(!allOpen)}>
              {allOpen ? 'Show fewer benchmarks' : `Show all ${lines.length} benchmarks`}
            </button>
          )}
        </Card>

        <Card code="WIN" title={sel ? sel.def.name : 'No benchmark'} subtitle={sel ? CAT_LABEL[sel.def.category] : undefined}>
          {sel ? (
            <div class="pn-stack">
              <div class="bmk-full">{sel.def.fullName}</div>
              <div class="bmk-flavor">{sel.def.flavor}</div>
              <div class="bmk-big">
                <ScoreBar label="You" value={sel.yours} tone="you" />
                <ScoreBar label="Frontier" value={sel.frontier} tone="rival" />
              </div>

              <LeaderBoard s={s} def={sel.def} cls={cls} />

              {announced.length > 0 && (
                <div class="bmk-announced">
                  {announced.map((b) => (
                    <div key={b.id}>
                      Announced {b.year} ─ {b.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Empty title="Nothing active">No benchmarks have been introduced yet.</Empty>
          )}
        </Card>
      </div>

      <Card code="ARN" title={`${CLASS_LABEL[cls]} class arena`} subtitle={`${arenaCount} ${arenaCount === 1 ? 'model' : 'models'} · by Elo`} flush>
        <ClassArena s={s} cls={cls} />
      </Card>
    </div>
  );
}

/** Leaderboard for one benchmark inside one class: best rows first, plus the player's best when it sits below the cut. */
function LeaderBoard({ s, def, cls }: { s: GameState; def: BenchmarkDef; cls: WeightClass }) {
  // Phones show the top five; the player's own row always shows (CSS hides the rest until "Show all").
  const [open, setOpen] = useState(false);
  const all = classBenchRows(s, def.id, cls);
  if (all.length === 0) {
    return <Empty title="No results">No model in this class has been scored on this yet.</Empty>;
  }
  const top = all.slice(0, 10);
  const mine = all.find((r) => r.isPlayer);
  const shown: { row: ClassBenchRow; rank: number }[] = top.map((row, i) => ({ row, rank: i + 1 }));
  if (mine && !top.includes(mine)) shown.push({ row: mine, rank: all.indexOf(mine) + 1 });
  return (
    <>
    <div class={`table-wrap table-stack bmk-lb ${open ? 'is-open' : ''}`}>
      <table class="table bmk-board">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Model</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ row: r, rank }) => {
            const m = r.modelId ? s.models.find((x) => x.id === r.modelId) : undefined;
            const contam = !!m?.contaminated && def.year <= calendarYear(m.trainedDay);
            const color = r.isPlayer ? 'var(--amber)' : labColor(s, r.labId);
            const human = !r.isPlayer && !!labInfo(s, r.labId)?.human;
            const lab = r.isPlayer ? s.company.name : (labInfo(s, r.labId)?.name ?? r.lab);
            return (
              <tr key={`${r.labId}-${r.modelName}`} class={`${r.isPlayer ? 'me' : ''} ${r === mine ? 'bmk-best' : ''}`}>
                <td class="num" data-label="Rank">
                  {rank}
                </td>
                <td data-label="Model">
                  <div class="bmk-name">
                    <span class="swatch" style={`--c:${color}`} /> {r.modelName}
                    {r.isLine && (
                      <>
                        {' '}
                        <Pill tone="cyan" title="A rival small or medium line">
                          Line
                        </Pill>
                      </>
                    )}
                    {contam && (
                      <>
                        {' '}
                        <Pill tone="bad" title="Trained on this benchmark's test set">
                          Contaminated
                        </Pill>
                      </>
                    )}
                  </div>
                  <div class="bmk-cat">
                    {lab}
                    {human ? ' · human' : ''}
                  </div>
                </td>
                <td data-label="Score">
                  <div class="bmk-bar is-lab">
                    <span class="bmk-track" aria-hidden="true">
                      <span class="bmk-fill" style={{ width: barW(r.score), background: color }} />
                    </span>
                    <span class="bmk-bar-v num">{r.score.toFixed(1)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {all.length > 5 && (
      <button type="button" class="btn bmk-more bmk-lb-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show fewer models' : `Show all ${all.length} models`}
      </button>
    )}
    </>
  );
}

/** The class arena: Elo within one weight class, best first, as bars against the leader. The top eight, with the count below. */
function ClassArena({ s, cls }: { s: GameState; cls: WeightClass }) {
  const rows = classArena(s, cls);
  if (rows.length === 0) {
    return <Empty title="Empty class">Nothing released competes in this class yet.</Empty>;
  }
  const shown = rows.slice(0, 8);
  const top = Math.max(1, ...shown.map((r) => r.elo));
  return (
    <div class="table-wrap table-stack">
      <table class="table wc-arena-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Model</th>
            <th>Elo</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const isPlayer = r.holder === 'player';
            return (
              <tr key={`${r.holder}-${r.name}`} class={isPlayer ? 'me' : ''}>
                <td class="num" data-label="Rank">
                  {i + 1}
                </td>
                <td data-label="Model">
                  <div class="bmk-name">{r.name}</div>
                  <div class="bmk-cat">{isPlayer ? s.company.name : labName(s, r.holder)}</div>
                </td>
                <td data-label="Elo">
                  <div class="bmk-bar is-lab">
                    <span class="bmk-track" aria-hidden="true">
                      <span class="bmk-fill" style={{ width: `${((r.elo / top) * 100).toFixed(1)}%`, background: isPlayer ? 'var(--amber)' : 'var(--fg-3)' }} />
                    </span>
                    <span class="bmk-bar-v num">{Math.round(r.elo)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > shown.length && <div class="wc-more">{`${rows.length - shown.length} more in this class`}</div>}
    </div>
  );
}
