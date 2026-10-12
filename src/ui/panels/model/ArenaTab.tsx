// OWNER: UI-PAGE. Arena & hype tab: the internal blind arena, teasers, and leak risk.
// Teasers promise an overall score. Release below the promise and the internet remembers (GAME_DESIGN 17.4).
import { dispatch } from '../../store';
import { formatMoney } from '../../../sim/util';
import { arenaQuote, leakChance, teaseOptions } from '../../../sim/systems/vault';
import type { GameState, Model } from '../../../sim/types';
import { Pill, Stat, formatDays } from '../../components';
import { tdate } from '../../shell/fmt';
import { leakLevel } from './status';
import type { LeakLevel } from './status';
import { Section } from './parts';

const LEAK_TEXT: Record<LeakLevel, string> = {
  none: 'Too far behind the frontier for anyone to care.',
  low: 'Quiet for now. Few people are looking at it.',
  medium: 'Near the frontier, so rivals and journalists are watching.',
  high: 'Near the frontier with a big team around it. Any day now.',
};

export function ArenaTab({ s, m }: { s: GameState; m: Model }) {
  const released = m.releasedDay !== null;
  return (
    <div class="mpg-cols">
      <div class="mpg-col">
        {released ? (
          <Section title="Internal arena">
            <span class="mpg-desc">Released, so the public arena has it now. Internal blind runs are for unreleased models.</span>
          </Section>
        ) : (
          <InternalArena s={s} m={m} />
        )}
        <Section title="Leak risk" aside={m.leakedDay !== undefined ? <Pill tone="bad">Leaked</Pill> : undefined}>
          <LeakRisk s={s} m={m} />
        </Section>
      </div>
      <div class="mpg-col">
        <Section title="Teasers">
          <Teasers s={s} m={m} />
        </Section>
      </div>
    </div>
  );
}

function InternalArena({ s, m }: { s: GameState; m: Model }) {
  const a = m.arena;
  const running = a !== undefined && s.day < a.doneDay;
  const done = a !== undefined && s.day >= a.doneDay;
  const q = arenaQuote(s);
  return (
    <Section title="Internal arena">
      {done && a ? (
        <div class="mpg-stack">
          <div class="mpg-stats">
            <Stat
              label="Measured Elo"
              value={a.elo !== undefined && Number.isFinite(a.elo) ? String(Math.round(a.elo)) : '—'}
              hint={a.band !== undefined ? `± ${Math.round(a.band)}` : undefined}
              size="md"
            />
          </div>
          <span class="mpg-desc">A blind run against the lab's own pool. Tighter than the launch guess.</span>
        </div>
      ) : running && a ? (
        <div class="mpg-row-between mpg-wrap">
          <span class="mpg-label">{`Running, done in ${formatDays(a.doneDay - s.day)}`}</span>
          <button type="button" class="btn btn-sm" disabled>
            Running
          </button>
        </div>
      ) : (
        <div class="mpg-row-between mpg-wrap">
          <div class="mpg-col-tight">
            <span class="mpg-label">Not run</span>
            <span class="mpg-desc">
              {`About ${Number.isFinite(q.cost) ? formatMoney(q.cost) : '—'} and ${formatDays(q.days)}. Measures Elo with a band. Blind runs can leak screenshots.`}
            </span>
          </div>
          <button type="button" class="btn btn-sm btn-primary" onClick={() => dispatch({ type: 'internalArena', modelId: m.id })}>
            Run internal arena
          </button>
        </div>
      )}
    </Section>
  );
}

function Teasers({ s, m }: { s: GameState; m: Model }) {
  const opts = teaseOptions(s, m);
  const t = m.teased;
  return (
    <div class="mpg-stack">
      {t ? (
        <div class="mpg-promise">
          <span class="mpg-promise-main">{`Promised ~${Math.round(t.expected)}.`}</span>
          <span class="mpg-desc">
            {m.releasedDay === null
              ? ' Release below that and the internet remembers.'
              : ` Teased ${tdate(t.day)}, before release.`}
          </span>
        </div>
      ) : (
        <span class="mpg-desc">No teaser yet. One per model, before release.</span>
      )}

      {opts.length > 0 && (
        <div class="mpg-tiles">
          {opts.map((o) => {
            const exp = Number.isFinite(o.expected) ? Math.max(0, Math.min(100, o.expected)) : 0;
            return (
              <div class={`mpg-tile ${o.available ? '' : 'is-off'}`} key={o.level}>
                <div class="mpg-tile-head">
                  <span class="mpg-label">{o.label}</span>
                  <span class="num good">{`+${Math.round(o.hype)} hype`}</span>
                </div>
                <div class="mpg-expect" role="img" aria-label={`Expected overall ${Math.round(o.expected)}`}>
                  <div class="mpg-row-between">
                    <span class="mpg-desc">Expected overall</span>
                    <span class="num">{Math.round(o.expected)}</span>
                  </div>
                  <div class="hbar mpg-hbar" aria-hidden="true">
                    <div class="hbar-fill" style={`width:${exp.toFixed(1)}%`} />
                  </div>
                </div>
                {!o.available && <span class="mpg-desc">{o.reason ?? 'Not available'}</span>}
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={!o.available || m.releasedDay !== null}
                  onClick={() => dispatch({ type: 'teaseModel', modelId: m.id, level: o.level })}
                >
                  Tease
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeakRisk({ s, m }: { s: GameState; m: Model }) {
  if (m.leakedDay !== undefined) {
    return (
      <div class="mpg-stack">
        <span class="mpg-label">{`Leaked ${tdate(m.leakedDay)}`}</span>
        <span class="mpg-desc">Weights are out. Rivals get a head start on it.</span>
      </div>
    );
  }
  const p = leakChance(s, m);
  const level = leakLevel(p);
  const cells: { id: Exclude<LeakLevel, 'none'>; label: string }[] = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ];
  const oneIn = p > 0 && Number.isFinite(p) ? Math.round(1 / p) : null;
  return (
    <div class="mpg-stack">
      <div class="mpg-leak" role="meter" aria-label={`Leak risk ${level}`}>
        {cells.map((c) => (
          <div key={c.id} class={`mpg-leak-cell is-${c.id} ${level === c.id ? 'is-on' : ''}`}>
            <span class="mpg-leak-bar" />
            <span class="mpg-label">{c.label}</span>
          </div>
        ))}
      </div>
      <span class="mpg-desc">
        {LEAK_TEXT[level]}
        {oneIn !== null && level !== 'none' ? ` About 1 in ${oneIn.toLocaleString('en-US')} days at this risk.` : ''}
      </span>
    </div>
  );
}
