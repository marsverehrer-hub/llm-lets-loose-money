import { useEffect, useState } from 'preact/hooks';
import { emergenceById } from '../../sim/data/emergences';
import { VERDICT_LABEL } from '../../sim/data/evalCopy';
import { BENCHMARKS } from '../../sim/data/benchmarks';
import { quirkById } from '../../sim/data/quirks';
import { datasetById } from '../../sim/systems/data';
import type { EmergenceDef, EvalReveal as Reveal, Forecast, GameState, Id } from '../../sim/types';
import { Pill, clamp } from '../components';
import { dispatch, useGame, useGameSelect } from '../store';
import { plain } from './fmt';
import { streakXpMult } from '../../sim/systems/progression'; // v13
import './evalreveal.css';

/**
 * Eval-day reveal. Shows while s.pendingReveal is set; the sim is blocked until the player continues.
 * Stepping: benchmark rows appear one at a time (timer or Next), then the overall result against the
 * forecast band, then the discoveries, quirks and data surprises. Skip shows everything at once.
 * Fine-tunes use the same layout under "Fine-tune results". Only the public fields of the reveal are read.
 */

/** Benchmark rows appear on this timer while rows remain. */
const ROW_MS = 350;

const BENCH_BY_ID = new Map(BENCHMARKS.map((b) => [b.id, b]));

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const signed = (v: number, digits: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const toneOf = (v: number): 'ev-up' | 'ev-down' | 'ev-flat' => (v > 0 ? 'ev-up' : v < 0 ? 'ev-down' : 'ev-flat');

/** Verdict tone: good verdicts green, bad ones red, the rest plain. */
const VERDICT_TONE: Record<Reveal['verdict'], string> = {
  banger: 'ev-up',
  solid: 'ev-up',
  'as expected': 'ev-flat',
  mid: 'ev-flat',
  dud: 'ev-down',
  cursed: 'ev-down',
};

const SEED_NOTE: Record<'golden' | 'cursed', { pill: string; tone: 'milestone' | 'bad'; line: string }> = {
  golden: { pill: 'Golden seed', tone: 'milestone', line: 'Luck from the very start. Not your plan.' },
  cursed: { pill: 'Cursed seed', tone: 'bad', line: 'Bad luck from the very start. Not your plan.' },
};

export function EvalReveal() {
  // Closed most days: re-renders only when a reveal opens or closes.
  const r = useGameSelect((s) => s.pendingReveal ?? null);
  if (!r) return null;
  // Remounted per reveal so the stepping starts from the top every time.
  return <RevealBody key={`${r.modelId}:${r.kind}:${r.actual}`} r={r} />;
}

function RevealBody({ r }: { r: Reveal }) {
  const s = useGame();
  const benchIds: Id[] = Object.keys(r.benchmarks);
  const n = benchIds.length;
  // Stages: one per benchmark row, then the overall + verdict, then the "then" details.
  const total = n + 2;
  const [shown, setShown] = useState(0);
  const done = shown >= total;

  useEffect(() => {
    if (shown >= n) return;
    const t = window.setTimeout(() => setShown((k) => k + 1), ROW_MS);
    return () => window.clearTimeout(t);
  }, [shown, n]);

  const model = s.models.find((m) => m.id === r.modelId);
  const name = plain(model?.name ?? 'Model');
  const isFine = r.kind === 'finetune';
  const f = r.forecast;
  const overallShown = shown >= n + 1;
  const thenShown = shown >= n + 2;
  const rowsShown = Math.min(shown, n);
  const delta = r.actual - f.mid;
  const verdict = VERDICT_LABEL[r.verdict];

  return (
    <div class="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="ev-title">
      <div class="modal ev-modal">
        <div class="modal-header">
          <h2 class="modal-title" id="ev-title">
            {r.kind === 'distill'
              ? `Distill results: ${name}`
              : r.kind === 'merge'
                ? `Merge results: ${name}`
                : isFine
                  ? `Fine-tune results: ${name}`
                  : `Eval day: ${name}`}
            {model?.codename && <span class="ev-label">{` · codename ${plain(model.codename)}`}</span>}
          </h2>
        </div>

        <div class="modal-body ev-body">
          <section class="ev-forecast" aria-label="Forecast">
            <div class="ev-label">Forecast</div>
            <div class="ev-forecast-head">
              <span class="ev-range">
                <span class="num">{f.low.toFixed(1)}</span> to <span class="num">{f.high.toFixed(1)}</span>
              </span>
              <span class="ev-mid">
                mid <span class="num">{f.mid.toFixed(1)}</span>
              </span>
              <Pill tone="info">{capitalise(f.confidence)}</Pill>
            </div>
            <Band f={f} actual={overallShown ? r.actual : null} />
            {f.reasons.length > 0 && (
              <ul class="ev-reasons">
                {f.reasons.slice(0, 3).map((t, i) => (
                  <li key={i}>{plain(t)}</li>
                ))}
              </ul>
            )}
          </section>

          {n > 0 && (
            <section class="ev-bench" aria-label="Benchmarks">
              <div class="section-title ev-section">
                <span>Benchmarks</span>
                <span>
                  <span class="num">{rowsShown}</span> of <span class="num">{n}</span>
                </span>
              </div>
              {benchIds.slice(0, rowsShown).map((id) => {
                const def = BENCH_BY_ID.get(id);
                const score = r.benchmarks[id] ?? 0;
                return (
                  <div key={id} class="ev-bench-row ev-row-new">
                    <div class="ev-bench-name">
                      {def?.name ?? plain(id)}
                      {def && <span class="ev-bench-cat">{def.year}</span>}
                    </div>
                    <div class="hbar ev-bench-bar">
                      <div class="hbar-fill" style={{ width: `${clamp(score, 0, 100).toFixed(1)}%`, '--c': 'var(--fg-3)' } as any} />
                    </div>
                    <div class="ev-bench-score num">{score.toFixed(1)}%</div>
                  </div>
                );
              })}
            </section>
          )}

          {overallShown && (
            <>
              <section class="ev-overall" aria-label="Overall">
                <div>
                  <div class="ev-label">Overall</div>
                  <div class="ev-overall-value num">{r.actual.toFixed(1)}</div>
                </div>
                <div class={`ev-delta ${toneOf(delta)}`}>
                  <span class="num">{signed(delta, 1)}</span> vs forecast
                </div>
              </section>

              <section class="ev-verdict" aria-label="Verdict">
                <div class={`ev-verdict-label ${VERDICT_TONE[r.verdict]}`}>{verdict.label}</div>
                <div class="ev-verdict-line">{verdict.line}</div>
                <XpLine s={s} r={r} />
                {r.seedTag && (
                  <div class="ev-seed">
                    <Pill tone={SEED_NOTE[r.seedTag].tone}>{SEED_NOTE[r.seedTag].pill}</Pill>
                    <span>{SEED_NOTE[r.seedTag].line}</span>
                  </div>
                )}
              </section>
            </>
          )}

          {thenShown && <Then s={s} r={r} />}
        </div>

        <div class="modal-footer">
          {!done && (
            <button type="button" class="btn" onClick={() => setShown(total)}>
              Skip
            </button>
          )}
          {!done && (
            <button type="button" class="btn btn-primary" onClick={() => setShown((k) => k + 1)}>
              Next
            </button>
          )}
          {done && (
            <button type="button" class="btn btn-primary" onClick={() => dispatch({ type: 'dismissReveal' })}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Forecast band as a range bar. The overall marker lands on it once the result is shown. */
function Band({ f, actual }: { f: Forecast; actual: number | null }) {
  const pts = [f.low, f.high, f.mid, ...(actual !== null ? [actual] : [])];
  let lo = clamp(Math.min(...pts) - 4, 0, 100);
  let hi = clamp(Math.max(...pts) + 4, 0, 100);
  if (hi - lo < 12) {
    const mid = (lo + hi) / 2;
    lo = Math.max(0, mid - 6);
    hi = Math.min(100, lo + 12);
    lo = Math.max(0, hi - 12);
  }
  const at = (v: number): string => `${(clamp((v - lo) / (hi - lo), 0, 1) * 100).toFixed(2)}%`;
  const width = `${((clamp((f.high - lo) / (hi - lo), 0, 1) - clamp((f.low - lo) / (hi - lo), 0, 1)) * 100).toFixed(2)}%`;
  return (
    <div class="ev-band" role="img" aria-label={`Forecast ${f.low.toFixed(1)} to ${f.high.toFixed(1)}, mid ${f.mid.toFixed(1)}`}>
      <div class="ev-track">
        <div class="ev-range-bar" style={{ left: at(f.low), width }} />
        <div class="ev-mid-tick" style={{ left: at(f.mid) }} />
        {actual !== null && <div class="ev-marker" style={{ left: at(actual) }} />}
      </div>
      <div class="ev-scale num">
        <span>{lo.toFixed(0)}</span>
        <span>{hi.toFixed(0)}</span>
      </div>
    </div>
  );
}

/** v13: what the run paid in lab XP, and what it did to the hot streak. */
function XpLine({ s, r }: { s: GameState; r: Reveal }) {
  const p = s.progress;
  // Other XP (research, crowns) can land the same day, so look for the eval line itself.
  const last = p ? [...p.log].reverse().find((l) => l.reason.startsWith('Eval') && l.day >= s.day - 1) : undefined;
  if (!p || !last) return null;
  const pre = r.kind === 'pretrain';
  return (
    <div class="ev-xp">
      <span class="num ev-up">+{last.amount} XP</span>
      {pre && (p.streak > 0 ? <span>{`Hot streak ${p.streak}${p.streak >= p.bestStreak && p.streak > 1 ? ' (best yet)' : ''}`}</span> : <span class="ev-down">Streak reset</span>)}
      {pre && p.streak > 0 && <span class="muted">{`x${streakXpMult(p.streak).toFixed(2)} run XP`}</span>}
      <span class="muted">{`Lab level ${p.level}`}</span>
    </div>
  );
}

/** Discoveries, visible quirks and data surprises. Shown after the verdict. */
function Then({ s, r }: { s: GameState; r: Reveal }) {
  const found = r.emerged.map((id) => emergenceById(id)).filter((d): d is EmergenceDef => d !== undefined);
  const quirks = r.quirks.map((id) => ({ id, def: quirkById(id) }));
  const surprises = Object.entries(r.dataSurprises).map(([id, delta]) => ({ id, delta, def: datasetById(s, id) }));

  return (
    <div class="ev-then">
      <section class="ev-group" aria-label="Discoveries">
        <div class="section-title">Discoveries</div>
        {found.length === 0 && <div class="ev-none">None this run.</div>}
        {found.map((d) => (
          <div key={d.id} class="ev-item ev-discovery">
            <div class="ev-item-head">
              <Pill tone="milestone">Discovery</Pill>
              <span class="ev-item-name">{plain(d.name)}</span>
            </div>
            <div class="ev-item-text">{plain(d.description)}</div>
          </div>
        ))}
      </section>

      <section class="ev-group" aria-label="Quirks">
        <div class="section-title">Quirks</div>
        {quirks.length === 0 && <div class="ev-none">No visible quirks.</div>}
        {quirks.map(({ id, def }) => (
          <div key={id} class="ev-item">
            <div class="ev-item-head">
              {def?.good === undefined ? <Pill tone="muted">Quirk</Pill> : <Pill tone={def.good ? 'good' : 'bad'}>{def.good ? 'Good' : 'Bad'}</Pill>}
              <span class="ev-item-name">{def ? plain(def.name) : plain(id)}</span>
            </div>
            {def && <div class="ev-item-text">{plain(def.description)}</div>}
          </div>
        ))}
      </section>

      <section class="ev-group" aria-label="Data surprises">
        <div class="section-title">Data surprises</div>
        {surprises.length === 0 && <div class="ev-none">Nothing in the mix was a surprise.</div>}
        {surprises.map(({ id, delta, def }) => {
          const claimed = def?.quality;
          const real = claimed === undefined ? undefined : clamp(claimed + delta, 0, 1);
          return (
            <div key={id} class="ev-data-row">
              <span class="ev-data-name">{def ? plain(def.name) : plain(id)}</span>
              <span class="ev-data-values num">
                {claimed !== undefined && real !== undefined ? (
                  <>
                    <span class="ev-flat">{pct(claimed)}</span>
                    <span class="ev-arrow"> → </span>
                    <span class={toneOf(delta)}>{pct(real)}</span>
                  </>
                ) : (
                  <span class={toneOf(delta)}>{signed(delta, 2)}</span>
                )}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function capitalise(t: string): string {
  return t.length > 0 ? t[0].toUpperCase() + t.slice(1) : t;
}
