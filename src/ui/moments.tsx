// Full-screen moments: the launch reveal, the year-end race, the final standings.
import type { JSX } from 'preact';
import type { GameState, Moment } from '../sim/types';
import { MODALITIES, SEGMENTS } from '../sim/content/modalities';
import { quirk, RACES, VERDICT } from '../sim/content/flavor';
import { Band, Btn, Chip, Confetti, Crown, Logo, Portrait, useCountUp, useSteps } from './kit';
import { act, quit } from './store';
import { coName, money, pct } from './fmt';

type Launch = Extract<Moment, { kind: 'launch' }>;

function LaunchReveal({ s, m }: { s: GameState; m: Launch }): JSX.Element {
  const model = s.models[m.model];
  const n = m.rows.length;
  // Steps: one per benchmark, then verdict, quirks, accounts, money.
  const [step, finish] = useSteps(n + 4, 650);
  const crowns = m.rows.filter((r) => r.crown).length;
  const rev = useCountUp(step >= n + 3 ? m.rev : 0, 900);
  const done = step >= n + 4;
  const good = m.verdict === 'banger' || m.verdict === 'solid';
  return (
    <div class="moment" onClick={() => { if (!done) finish(); }}>
      {done && crowns > 0 && <Confetti />}
      <p class="eyebrow">Launch day</p>
      <h1>{model.name}</h1>
      <p class="muted">{MODALITIES[model.modality].name} model · {(model.params / 1e9).toFixed(1)}B parameters</p>
      <ul class="bench reveal">
        {m.rows.map((r, i) => {
          const def = SEGMENTS[r.seg];
          const shown = step > i;
          return (
            <li class={shown ? 'in' : 'wait'}>
              <div class="row"><span class="grow"><b>{def.bench}</b></span>
                {shown ? <span class={r.crown ? 'good score' : 'score'}>{r.crown && <Crown />} {r.score.toFixed(1)}</span> : <span class="muted">…</span>}</div>
              <Band lo={r.lo} mid={(r.lo + r.hi) / 2} hi={r.hi} leader={r.leaderScore} actual={shown ? r.score : undefined} />
              <div class="muted small">{r.leader ? `${coName(s, r.leader)} had ${Math.round(r.leaderScore)}` : 'Open field'}{shown && r.crown ? ' — the crown is yours' : ''}</div>
            </li>
          );
        })}
      </ul>
      {step >= n + 1 && (
        <div class={`stamp ${m.verdict.replace(' ', '-')}`}>
          <strong>{VERDICT[m.verdict].label}</strong>
          <span>Forecast {m.forecast.toFixed(1)}, landed {m.actual.toFixed(1)}. {VERDICT[m.verdict].line}</span>
        </div>
      )}
      {step >= n + 2 && (
        <p class="chips pop">
          {m.quirks.map((q) => <Chip tone="warn">{quirk(q).name}</Chip>)}
          {m.quirks.length === 0 && <Chip>No odd habits found yet</Chip>}
          {m.scandal && <Chip tone="bad">Benchmark contamination scandal</Chip>}
          {m.promise && <Chip tone={m.promise === 'hit' ? 'good' : 'bad'}>Promise {m.promise === 'hit' ? 'kept' : 'broken'}</Chip>}
        </p>
      )}
      {step >= n + 3 && (
        <div class="pop">
          {m.flips.length > 0 && <ul class="flips">{m.flips.slice(0, 6).map((f) => <li><span class="small muted">{f.from ? coName(s, f.from) : 'Unserved'} →</span> <b>{f.account}</b></li>)}</ul>}
          <p class="money">{money(rev)}<span class="muted"> a week</span></p>
          <p class="muted small">Projected once customers finish switching{m.profit < 0 ? '. It loses money at this price; change it in the Lab.' : `, ${money(m.profit)} of it profit.`}</p>
          <div class="row wrap center">
            <span class={`ticker ${m.move >= 0 ? 'good' : 'bad'}`}><Logo co={s.companies[m.lab]} size={20} /> {pct(m.move, 1)}</span>
            {m.rivalMoves.slice(0, 4).map((r) => (
              <span class={`ticker ${r.pct >= 0 ? 'good' : 'bad'}`}><Portrait name={s.companies[r.co].ceo.name} style={s.companies[r.co].ceo.style} mood={m.move > 0.03 ? 'angry' : m.move < -0.03 ? 'smug' : 'neutral'} size={28} /> {pct(r.pct, 1)}</span>
            ))}
          </div>
        </div>
      )}
      <div class="moment-foot"><Btn kind="primary" id="moment-ok" onClick={() => (done ? act({ t: 'dismissMoment' }) : finish())}>{done ? (good ? 'Take a bow' : 'Back to work') : 'Skip'}</Btn></div>
    </div>
  );
}

function RaceMoment({ s, m }: { s: GameState; m: Extract<Moment, { kind: 'race' }> }): JSX.Element {
  const race = RACES.find((r) => r.id === m.race)!;
  const [step] = useSteps(m.standings.length, 250);
  const won = m.standings[0]?.co === s.labId;
  const fmt = (x: number): string => (race.metric === 'revenue' ? money(x) : race.metric === 'crowns' ? `${x}` : x.toFixed(1));
  return (
    <div class="moment">
      {won && <Confetti />}
      <p class="eyebrow">End of year {m.year}</p>
      <h1>{race.name}</h1>
      <p class="muted">{race.blurb}</p>
      <ol class="standings big">
        {m.standings.map((x, i) => {
          const co = s.companies[x.co];
          const rankFromEnd = m.standings.length - 1 - i;
          return (
            <li class={`${x.co === s.labId ? 'me' : ''} ${step > rankFromEnd ? 'in' : 'wait'}`}>
              <span class="rank">{i + 1}</span>
              <Portrait name={x.co === s.labId ? 'you' : co.ceo.name} style={co.ceo.style} mood={i === 0 ? 'smug' : i === m.standings.length - 1 ? 'panic' : 'neutral'} size={36} />
              <span class="grow">{co.name}</span><b>{fmt(x.score)}</b>
            </li>
          );
        })}
      </ol>
      <p class={won ? 'good' : 'muted'}>{won ? `You win ${money(m.prize)} and bragging rights.` : `${coName(s, m.standings[0]?.co ?? null)} takes the ${money(m.prize)} prize.`}</p>
      <div class="moment-foot"><Btn kind="primary" id="moment-ok" onClick={() => act({ t: 'dismissMoment' })}>Next year</Btn></div>
    </div>
  );
}

function EndMoment({ s, m }: { s: GameState; m: Extract<Moment, { kind: 'end' }> }): JSX.Element {
  const rank = m.standings.findIndex((x) => x.id === s.playerId) + 1;
  return (
    <div class="moment">
      {rank === 1 && <Confetti />}
      <p class="eyebrow">Final standings</p>
      <h1>{rank === 1 ? 'Richest person in AI' : rank <= 3 ? `You finished #${rank} on the rich list` : `You finished #${rank}. The Street is unmoved.`}</h1>
      <ol class="standings big">
        {m.standings.map((x, i) => (
          <li class={`in ${x.id === s.playerId ? 'me' : ''}`}><span class="rank">{i + 1}</span><Portrait name={x.id === s.playerId ? 'you' : x.name} style="follower" mood={i === 0 ? 'smug' : 'neutral'} size={36} /><span class="grow">{x.name}</span><b>{money(x.worth)}</b></li>
        ))}
      </ol>
      <div class="moment-foot row"><Btn kind="ghost" onClick={() => quit()}>New game</Btn><Btn kind="primary" id="moment-ok" onClick={() => act({ t: 'dismissMoment' })}>Keep playing</Btn></div>
    </div>
  );
}

function DealMoment({ m }: { m: Extract<Moment, { kind: 'deal' }> }): JSX.Element {
  const [step] = useSteps(2, 900);
  const got = Math.min(1, m.got);
  const won = m.outcome === 'won';
  const good = won === m.mine;
  return (
    <div class="moment">
      {step >= 2 && won && m.mine && <Confetti />}
      <p class="eyebrow">The shares are in</p>
      <h1>{m.bidderName} {m.merge ? 'bids for all of' : 'bids for control of'} {m.targetName}</h1>
      <div class="tender" role="img" aria-label={`${Math.round(got * 100)}% of the shares, against the 50% needed`}>
        <span class="tender-fill" style={{ width: `${step >= 1 ? got * 100 : 0}%` }} /><span class="tender-line" /><span class="tender-label">50% to win</span>
      </div>
      {step >= 2 && (
        <div class={`stamp ${good ? 'banger' : 'dud'}`}>
          <strong>{m.outcome === 'won' ? (m.merge ? 'Merged' : 'Control taken') : m.outcome === 'blocked' ? 'Blocked' : 'Fell short'}</strong>
          <span>{m.outcome === 'won' ? `${Math.round(got * 100)}% came in. The bill: ${money(m.paid)}.` : m.outcome === 'blocked' ? 'The shares came in, then the regulators did.' : `Only ${Math.round(got * 100)}% came in. The bidder pays a break fee and goes home.`}</span>
        </div>
      )}
      <div class="moment-foot"><Btn kind="primary" id="moment-ok" onClick={() => act({ t: 'dismissMoment' })}>{good ? 'Excellent' : 'Noted'}</Btn></div>
    </div>
  );
}

export function MomentView({ s }: { s: GameState }): JSX.Element | null {
  const m = s.moments[0];
  if (!m) return null;
  const key = `${m.kind}:${s.week}:${s.moments.length}`;
  if (m.kind === 'launch') return <LaunchReveal key={key} s={s} m={m} />;
  if (m.kind === 'race') return <RaceMoment key={key} s={s} m={m} />;
  if (m.kind === 'end') return <EndMoment key={key} s={s} m={m} />;
  if (m.kind === 'deal') return <DealMoment key={key} m={m} />;
  if (m.kind === 'variant') {
    const v = s.models[m.model], from = s.models[m.from];
    return (
      <div class="moment">
        <p class="eyebrow">Side project shipped</p>
        <h1>{v?.name ?? 'A new variant'}</h1>
        <p class="muted">Built from {from?.name}. Serving cost {v && v.attrs.cost < m.costBefore ? `down ${Math.round((1 - v.attrs.cost / m.costBefore) * 100)}%` : 'unchanged'}. Both stay on sale; customers pick whichever suits them.</p>
        <ul class="bench reveal">
          {m.rows.map((r) => (
            <li class="in"><div class="row"><span class="grow"><b>{SEGMENTS[r.seg].bench}</b></span>
              <span class={r.after > r.before ? 'good score' : 'score'}>{r.before.toFixed(1)} → {r.after.toFixed(1)}</span></div></li>
          ))}
        </ul>
        <p class="money">{money(m.rev)}<span class="muted"> a week, whole lab</span></p>
        <div class="moment-foot"><Btn kind="primary" id="moment-ok" onClick={() => act({ t: 'dismissMoment' })}>Nice</Btn></div>
      </div>
    );
  }
  if (m.kind === 'ousted') return (
    <div class="moment">
      <p class="eyebrow">Boardroom coup</p><h1>You have been shown the door</h1>
      <Portrait name="you" mood="panic" size={96} />
      <p>{m.by} now controls {m.lab}. Security was polite about it.</p>
      <p class="muted">You keep your shares and your cash. Buy half of any lab on the Street and you can take its helm.</p>
      <div class="moment-foot"><Btn kind="primary" id="moment-ok" onClick={() => act({ t: 'dismissMoment' })}>Plot a comeback</Btn></div>
    </div>
  );
  if (m.kind !== 'over') return null;
  return (
    <div class="moment">
      <p class="eyebrow">Game over</p><h1>Bankrupt</h1>
      <Portrait name="you" mood="panic" size={96} />
      <p>{m.reason}</p>
      <div class="moment-foot"><Btn kind="primary" id="moment-ok" onClick={() => quit()}>Try again</Btn></div>
    </div>
  );
}
