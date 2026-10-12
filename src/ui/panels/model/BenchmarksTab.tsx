// OWNER: UI-PAGE. Benchmarks tab.
// Unreleased: only what the lab has measured (knownBenchmarks). The rest is "Not run" with a checkbox and a quote.
// Released: every public result, as before. SOTA (unannounced) marks a measured score above every public one.
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { calendarYear, formatMoney } from '../../../sim/util';
import { BENCHMARKS } from '../../../sim/data/benchmarks';
import { bestResults } from '../../../sim/systems/capabilities';
import { benchTuneQuote } from '../../../sim/systems/classes';
import { benchQuote, bestPublic, benchPending, knownBenchmarks } from '../../../sim/systems/vault';
import type { BenchmarkDef, GameState, Id, Model } from '../../../sim/types';
import { Pill, formatDays } from '../../components';
import { benchEtaFor } from './status';
import { Section } from './parts';
import '../classes.css';

interface Row {
  def: BenchmarkDef;
  score: number | null;
  /** Days left when a measurement is running, else null. */
  eta: number | null;
  /** Best public score (unreleased: bestPublic; released: best rival). */
  best: number | null;
}

export function BenchmarksTab({ s, m }: { s: GameState; m: Model }) {
  const released = m.releasedDay !== null;
  const known = knownBenchmarks(s, m);
  const pending = new Set<Id>(benchPending(m));
  const year = calendarYear(s.day);
  const [picked, setPicked] = useState<Id[]>([]);
  /** The benchmark whose inline tune confirm is open. */
  const [tuneOpen, setTuneOpen] = useState<Id | null>(null);
  /** Running bench tunes on this model (v8), by benchmark. */
  const tunes = new Map<Id, number>((s.classes?.benchTunes ?? []).filter((j) => j.modelId === m.id).map((j) => [j.benchId, j.doneDay - s.day]));

  const measured = (id: Id): number | null => {
    const v = known[id];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const rows: Row[] = [];
  for (const def of BENCHMARKS) {
    const score = measured(def.id);
    if (released) {
      if (score === null) continue;
      const rival = bestResults(s, def.id).find((r) => !r.isPlayer);
      rows.push({ def, score, eta: null, best: rival ? rival.score : null });
      continue;
    }
    // Unreleased: benchmarks appear from their year, and anything measured or running always shows.
    const exists = def.year <= year;
    if (!exists && score === null && !pending.has(def.id)) continue;
    rows.push({ def, score, eta: benchEtaFor(s, m, def.id), best: bestPublic(s, def.id) });
  }

  const unmeasured = rows.filter((r) => !released && r.score === null && r.eta === null).map((r) => r.def.id);
  const quote = picked.length > 0 ? benchQuote(s, m.id, picked) : null;

  const togglePick = (id: Id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div class="mpg-stack">
      {!released && (
        <p class="mpg-desc">
          Eval day runs a standard suite. Anything else needs a run here. Results are the true score with small noise.
        </p>
      )}

      {rows.length === 0 ? (
        <div class="md-empty-line">{released ? 'No public results yet.' : 'No benchmarks in this era yet.'}</div>
      ) : (
        <div class="table-wrap table-stack">
          <table class="table mpg-bench">
            <thead>
              <tr>
                {!released && <th class="mpg-check-col" aria-label="Select" />}
                <th>Benchmark</th>
                <th class="num">Score</th>
                <th class="num">{released ? 'Best rival' : 'Best public'}</th>
                <th class="num">Gap</th>
                {!released && <th>Status</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ def, score, eta, best }) => {
                const notRun = !released && score === null && eta === null;
                const gap = score !== null && best !== null ? score - best : null;
                const sota = !released && score !== null && best !== null && score > best;
                const tuneLeft = tunes.get(def.id);
                const confirming = tuneOpen === def.id;
                return (
                  <Fragment key={def.id}>
                  <tr class={notRun ? 'dim' : ''}>
                    {!released && (
                      <td class="mpg-check-col" data-label="Select">
                        {notRun ? (
                          <label class="mpg-check-hit">
                            <input
                              type="checkbox"
                              class="check"
                              aria-label={`Select ${def.name}`}
                              checked={picked.includes(def.id)}
                              onChange={() => togglePick(def.id)}
                            />
                          </label>
                        ) : null}
                      </td>
                    )}
                    <td class="mpg-bench-name" title={def.fullName}>{def.name}</td>
                    <td class="num" data-label="Score">
                      {score !== null ? (
                        score.toFixed(1)
                      ) : eta !== null ? (
                        <span class="mpg-faint">{eta < 1 ? 'Measuring, done today' : `Measuring, done in ${formatDays(eta)}`}</span>
                      ) : (
                        'Not run'
                      )}
                    </td>
                    <td class="num" data-label={released ? 'Best rival' : 'Best public'}>{best !== null ? best.toFixed(1) : '—'}</td>
                    <td class={`num ${gap === null ? 'faint' : gap > 0 ? 'good' : gap < 0 ? 'bad' : 'faint'}`} data-label="Gap">
                      {gap === null ? '—' : `${gap > 0 ? '▲' : gap < 0 ? '▼' : '='} ${Math.abs(gap).toFixed(1)}`}
                    </td>
                    {!released && (
                      <td data-label="Status">
                        <span class="row-wrap">
                          {sota && <Pill tone="milestone">SOTA (unannounced)</Pill>}
                          {tuneLeft !== undefined ? (
                            <span class="wc-eta">{`Tuning, done in ${formatDays(Math.max(0, tuneLeft))}`}</span>
                          ) : (
                            <button
                              type="button"
                              class="btn btn-sm btn-ghost"
                              aria-expanded={confirming}
                              onClick={() => setTuneOpen(confirming ? null : def.id)}
                            >
                              {confirming ? 'Close' : 'Tune for this'}
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                  {!released && confirming && (
                    <tr class="wc-tune-row">
                      <td colSpan={6}>
                        <TuneConfirm s={s} m={m} benchId={def.id} onDone={() => setTuneOpen(null)} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!released && unmeasured.length > 0 && (
        <Section title="Run benchmarks">
          <div class="mpg-runbar">
            <div class="mpg-col-tight">
              <span class="mpg-label">{picked.length === 0 ? 'Select benchmarks to run' : `${picked.length} selected`}</span>
              {quote && (
                <span class="mpg-desc">
                  {`About ${Number.isFinite(quote.cost) ? formatMoney(quote.cost) : '—'} and ${formatDays(quote.days)}. Several jobs can run at once.`}
                </span>
              )}
            </div>
            <div class="row-wrap">
              <button type="button" class="btn btn-sm btn-ghost" onClick={() => setPicked(picked.length === unmeasured.length ? [] : unmeasured)}>
                {picked.length === unmeasured.length ? 'Clear' : 'Select all'}
              </button>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                disabled={picked.length === 0}
                onClick={() => {
                  dispatch({ type: 'runBenchmarks', modelId: m.id, benchIds: picked });
                  setPicked([]);
                }}
              >
                Run selected
              </button>
            </div>
          </div>
        </Section>
      )}

      {released && <p class="mpg-desc">Public results. The best rival is the strongest other lab's released score on the same benchmark.</p>}
    </div>
  );
}

/** Inline confirm for one bench tune: the quote from the sim, and what it does to the model. */
function TuneConfirm({ s, m, benchId, onDone }: { s: GameState; m: Model; benchId: Id; onDone: () => void }) {
  const q = benchTuneQuote(s, m.id, benchId);
  const def = BENCHMARKS.find((b) => b.id === benchId);
  const name = m.codename ?? m.name;
  if (!q.ok) {
    return (
      <div class="wc-confirm">
        <div class="wc-confirm-line">{q.reason}</div>
        <div class="wc-confirm-actions">
          <button type="button" class="btn btn-sm btn-ghost" onClick={onDone}>
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <div class="wc-confirm">
      <div class="wc-confirm-line">
        {`Tune ${def?.name ?? 'this benchmark'} on ${name}: `}
        <span class="num">{formatMoney(q.cost)}</span>
        {', '}
        <span class="num">{formatDays(q.days)}</span>
        {', expected gain '}
        <span class="num">{`+${q.expectedGain.toFixed(1)}`}</span>
        {' points on this benchmark.'}
      </div>
      <div class="wc-confirm-note">
        The tune moves the capabilities this benchmark tests and costs a point on the rest. Repeat tunes on the same benchmark give half, then a quarter, of the gain. There is a 10% chance the model learns the test's shape instead, which costs Elo once it is found.
      </div>
      <div class="wc-confirm-actions">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          onClick={() => {
            dispatch({ type: 'benchTune', modelId: m.id, benchId });
            onDone();
          }}
        >
          Start tune
        </button>
        <button type="button" class="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
