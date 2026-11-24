// The Desk: what needs you this week. Calls, outcomes, the race, the news.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ChipRun, GameState, Offer, Run } from '../../sim/types';
import { chipView } from '../../sim/chips';
import { check, handsOnRun } from '../../sim/apply';
import { runway } from '../../sim/books';
import { formatRace, raceOf, raceStandings, YEAR } from '../../sim/goals';
import { fxChips } from '../../sim/run';
import { sharesOf } from '../../sim/stock';
import { MODALITIES } from '../../sim/content/modalities';
import { Band, Btn, Card, Chip, Logo, Portrait, useSteps } from '../kit';
import { act, lastSkip } from '../store';
import { coName, money, type Tab } from '../fmt';

function ChipCard({ s, c }: { s: GameState; c: ChipRun }): JSX.Element {
  const v = chipView(s, c);
  return (
    <Card title={c.call ? c.call.title : c.name} tag={`${c.name} · week ${c.weeksDone} of ${c.weeksPlanned}`} color="var(--orange)" class={c.call ? 'call pop' : ''}>
      <div class="row small"><span class="grow">Expected: <b>×{v.lo.toFixed(2)} to ×{v.hi.toFixed(2)}</b> the market leader</span><span>yield ~{Math.round(v.yld * 100)}%</span></div>
      <Band lo={v.lo * 100} mid={v.eff * 100} hi={v.hi * 100} leader={100} min={50} max={180} />
      {c.call && <>
        <p class="lead">{c.call.body}</p>
        <div class="options">
          {c.call.options.map((o, i) => (
            <button type="button" class="option" onClick={() => act({ t: 'answerChip', chip: c.id, option: i })}>
              <strong>{o.label}</strong><span class="note">{o.note}</span>
              <span class="chips">{fxChips(o.fx, MODALITIES.lang.axes).map((x) => <Chip tone={x.tone}>{x.text.replace('capability', 'performance')}</Chip>)}</span>
            </button>
          ))}
        </div>
      </>}
      {!c.call && c.outcome && <p class="chips"><Chip>You chose: {c.outcome.picked}</Chip>{c.outcome.roll && <Chip tone={c.outcome.roll.bad ? 'bad' : 'good'}>{c.outcome.roll.bad ? 'It went wrong' : 'It went fine'}</Chip>}</p>}
    </Card>
  );
}

function CallCard({ s, run }: { s: GameState; run: Run }): JSX.Element {
  const call = run.call!;
  const [always, setAlways] = useState(false);
  const axes = MODALITIES[run.bp.modality].axes;
  const canStand = (s.callCount[call.def] ?? 0) >= 3 && !call.def.startsWith('beat.') && call.def !== 'emergence';
  return (
    <Card title={call.title} tag={`${run.name} · week ${run.weeksDone} of ${run.weeksPlanned}`} color="var(--pink)" class="call pop">
      <p class="lead">{call.body}</p>
      <div class="options">
        {call.options.map((o, i) => (
          <button type="button" class="option" onClick={() => act({ t: 'answerCall', run: run.id, option: i, always })}>
            <strong>{o.label}</strong>
            <span class="note">{o.note}</span>
            <span class="chips">{fxChips(o.fx, axes).map((c) => <Chip tone={c.tone}>{c.text}</Chip>)}{o.fx.length === 0 && <Chip>No change</Chip>}</span>
          </button>
        ))}
      </div>
      {canStand && <label class="check"><input type="checkbox" checked={always} onChange={(e) => setAlways((e.target as HTMLInputElement).checked)} /> Always answer this the same way</label>}
    </Card>
  );
}

function OutcomeCard({ run }: { run: Run }): JSX.Element {
  const o = run.outcome!;
  const [step] = useSteps(o.roll ? 2 : 1, 700);
  return (
    <Card title={o.title} tag={`You chose: ${o.picked}`} color="var(--yellow)" class="pop">
      {o.roll && (
        <div class="roll" role="img" aria-label={`${Math.round(o.roll.p * 100)}% chance of trouble: ${o.roll.bad ? 'it went wrong' : 'it went fine'}`}>
          <span class="roll-bad" style={{ width: `${o.roll.p * 100}%` }} />
          <span class={`roll-marker ${step >= 1 ? 'land' : ''}`} style={{ left: step >= 1 ? `${o.roll.bad ? o.roll.p * 50 : o.roll.p * 100 + (1 - o.roll.p) * 50}%` : '0%' }} />
        </div>
      )}
      {(!o.roll || step >= 2) && (
        <p class="chips">
          {o.roll && <Chip tone={o.roll.bad ? 'bad' : 'good'}>{o.roll.bad ? 'It went wrong' : 'It went fine'}</Chip>}
          {o.lines.map((l) => <Chip>{l}</Chip>)}
          {o.lines.length === 0 && <Chip>Nothing changed</Chip>}
        </p>
      )}
    </Card>
  );
}

function OfferCard({ s, o }: { s: GameState; o: Offer }): JSX.Element {
  const from = o.from ? s.companies[o.from] : null;
  const left = o.expires - s.week;
  return (
    <Card title={o.call.title} tag={left <= 1 ? 'Last week to answer' : `Answer within ${left} weeks`} color="var(--yellow)" class="pop offer">
      <div class="row">{from && (from.lab ? <Portrait name={from.ceo.name} style={from.ceo.style} mood="happy" size={44} /> : <Logo co={from} size={40} />)}<p class="grow">{o.call.body}</p></div>
      <div class="options">
        {o.call.options.map((x, i) => {
          const why = check(s, { t: 'answerOffer', offer: o.id, option: i });
          return (
          <button type="button" class="option" disabled={!!why} onClick={() => act({ t: 'answerOffer', offer: o.id, option: i })}>
            <strong>{x.label}</strong><span class="note">{why ?? x.note}</span>
            {x.fx.length > 0 && <span class="chips">{fxChips(x.fx, MODALITIES.lang.axes).map((c) => <Chip tone={c.tone}>{c.text}</Chip>)}</span>}
          </button>
          );
        })}
      </div>
    </Card>
  );
}

function RaidCard({ s }: { s: GameState }): JSX.Element | null {
  const d = s.deals.find((x) => x.target === s.labId && x.playerTenders === null);
  if (!d) return null;
  const who = s.actors[d.bidder]?.name ?? s.companies[d.bidder]?.name ?? 'Someone';
  const co = s.companies[s.labId];
  const mine = sharesOf(s, s.playerId, co.id);
  return (
    <Card title={`${who} is bidding for your lab`} tag={`Closes in ${d.closes - s.week} weeks`} color="var(--pink)" class="call pop">
      <div class="row"><Portrait name={who} style="follower" mood="smug" size={56} />
        <p class="lead">${d.offer.toFixed(2)} a share, {Math.round(d.premium * 100)}% over market, for control of {co.name}. You hold {Math.round((100 * mine) / co.shares)}%. If half the shares come in, you are out.</p></div>
      <div class="options">
        <button type="button" class="option" onClick={() => act({ t: 'defend', deal: d.id, choice: 'refuse' })}><strong>Refuse</strong><span class="note">Keep your shares and hope the public does the same.</span></button>
        <button type="button" class="option" onClick={() => act({ t: 'defend', deal: d.id, choice: 'tender' })}><strong>Sell them your shares</strong><span class="note">Walk away with about {money(mine * d.offer * 0.6)} or more, and without a lab.</span><span class="chips"><Chip tone="bad">You will be ousted</Chip></span></button>
        {s.helm && !co.pill && <button type="button" class="option" onClick={() => act({ t: 'defend', deal: d.id, choice: 'pill' })}><strong>Adopt a poison pill</strong><span class="note">Makes every future bid for the lab harder. The governance crowd hates it.</span><span class="chips"><Chip tone="good">Bids need a richer premium</Chip><Chip tone="bad">Brand down</Chip></span></button>}
      </div>
      <p class="muted small">You can also buy shares on the Street, or have the lab buy some back, before it closes.</p>
    </Card>
  );
}

function Coach({ s, go }: { s: GameState; go: (t: Tab | 'wizard') => void }): JSX.Element | null {
  const co = s.companies[s.labId];
  const run = handsOnRun(s);
  const mine = Object.values(s.models).filter((m) => m.lab === s.labId && !m.retired);
  const left = runway(s, co);
  let text: string, cta: { label: string; to: Tab | 'wizard' } | null = null;
  if (!s.helm) { text = 'You own shares but run nothing. Buy half of a lab on the Street to take its helm, or just get rich trading.'; cta = { label: 'Open the Street', to: 'street' }; }
  else if (left < 8) { text = `About ${Math.floor(left)} weeks of cash left. Sell shares, raise prices, or ship something.`; cta = { label: 'Open Empire', to: 'empire' }; }
  else if (run?.call) return null;
  else if (run) text = `${run.name} is training. End the week to see the next report.`;
  else if (!mine.length) { text = `You have ${money(co.cash)}, a slide deck and no product. Design your first model.`; cta = { label: 'Design a model', to: 'wizard' }; }
  else {
    const newest = mine.reduce((a, b) => (b.shipped > a.shipped ? b : a));
    const age = s.week - newest.shipped;
    const rival = Object.values(s.runs).find((r) => r.status === 'running' && r.lab !== s.labId);
    if (age < 4) { text = `${newest.name} is live. Customers take a few weeks to switch: watch the Market, and set its price in the Lab.`; cta = { label: 'See the Market', to: 'market' }; }
    else {
      text = `${newest.name} is ${age} weeks old${rival ? ` and ${s.companies[rival.lab].name} is training something` : ' and the frontier keeps moving'}. Time for the next one?`;
      cta = { label: 'Design a model', to: 'wizard' };
    }
  }
  return (
    <Card class="coach" color="var(--teal)">
      <div class="row"><Portrait name="you" mood={left < 8 ? 'panic' : 'happy'} size={44} /><p>{text}</p></div>
      {cta && <Btn kind="primary" onClick={() => go(cta!.to)}>{cta.label}</Btn>}
    </Card>
  );
}

function RaceCard({ s }: { s: GameState }): JSX.Element {
  const race = raceOf(s.week);
  const st = raceStandings(s, race);
  const rank = st.findIndex((x) => x.co === s.labId);
  const show = [...st.slice(0, 3), ...(rank > 2 ? [st[rank]] : [])];
  const fmt = (x: number): string => formatRace(race, x);
  return (
    <Card title={race.name} tag={`${YEAR - (s.week % YEAR)} weeks left · prize ${money(race.prize)}`} color="var(--yellow)">
      <p class="muted">{race.blurb}</p>
      <ol class="standings">
        {show.map((x) => (
          <li class={x.co === s.labId ? 'me' : ''}>
            <span class="rank">{st.indexOf(x) + 1}</span><Logo co={s.companies[x.co]} size={24} /><span class="grow">{coName(s, x.co)}</span><b>{fmt(x.score)}</b>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function Desk({ s, go }: { s: GameState; go: (t: Tab | 'wizard') => void }): JSX.Element {
  const run = handsOnRun(s);
  const news = s.log.filter((n) => n.week >= s.week - Math.max(1, lastSkip)).reverse();
  return (
    <div class="screen">
      <RaidCard s={s} />
      <Coach s={s} go={go} />
      {s.deals.filter((x) => x.bidder === s.playerId || (x.bidder === s.labId && s.helm)).map((x) => <Card color="var(--purple)"><p><b>Your bid for {s.companies[x.target]?.name}</b> closes in {x.closes - s.week} week{x.closes - s.week === 1 ? '' : 's'}. The shares decide.</p></Card>)}
      {run?.call && <CallCard key={run.id + run.weeksDone + run.call.def} s={s} run={run} />}
      {Object.values(s.chips).filter((c) => c.status === 'running').map((c) => <ChipCard key={c.id + c.weeksDone} s={s} c={c} />)}
      {run?.outcome && !run.call && <OutcomeCard key={run.id + run.seen.length} run={run} />}
      {s.offers.map((o) => <OfferCard key={o.id} s={s} o={o} />)}
      {s.projects.filter((p) => p.lab === s.labId).map((p) => <Card color="var(--purple)"><p><b>{p.kind === 'tune' ? 'Fine-tuning' : 'Distilling'} {s.models[p.model]?.name}</b>, ready in {p.done - s.week} week{p.done - s.week === 1 ? '' : 's'}.</p></Card>)}
      {run && !run.call && (
        <Card title={run.name} tag={`Week ${run.weeksDone} of ${run.weeksPlanned}`} color="var(--blue)" onClick={() => go('lab')}>
          <div class="progress"><span style={{ width: `${(100 * run.weeksDone) / run.weeksPlanned}%` }} /></div>
          <p class="muted">Tap to see the run report.</p>
        </Card>
      )}
      <RaceCard s={s} />
      <Card title="This week" tag={lastSkip > 1 ? `Last ${lastSkip} weeks` : undefined}>
        {news.length === 0 && <p class="muted">A quiet week. Suspiciously quiet.</p>}
        <ul class="news">
          {news.slice(0, 12).map((n) => (
            <li class={n.tone}>{n.co && s.companies[n.co] ? <Logo co={s.companies[n.co]} size={20} /> : <span class="dot" />}<span>{n.text}</span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
