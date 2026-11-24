// Empire: your own fortune, the lab's finances, and the compute market you depend on.
import type { JSX } from 'preact';
import type { GameState } from '../../sim/types';
import { BUYBACK, check, PAYOUTS } from '../../sim/apply';
import { canRaise, interest, marketCap, RAISE_COOLDOWN, runway } from '../../sim/books';
import { debtRoom } from '../../sim/deals';
import { CAMPAIGN_WEEKS } from '../../sim/goals';
import { netWorth, quote, richList, stake } from '../../sim/stock';
import { contractPrice, describeContract, labPrice, LAYER_NAME, LEAD, playerControls, suppliers } from '../../sim/supply';
import { Btn, Card, Chip, Logo, Seg, Spark } from '../kit';
import { act, quit } from '../store';
import { coName, money } from '../fmt';
import { DC_LEAD, dcCost, dcId } from '../../sim/chips';
import { SEGMENTS } from '../../sim/content/modalities';
import { segDef } from '../../sim/demand';

export function Empire({ s }: { s: GameState }): JSX.Element {
  const co = s.companies[s.labId];
  const me = s.actors[s.playerId];
  const st = stake(s, s.playerId, co.id);
  const left = runway(s, co);
  const wait = RAISE_COOLDOWN - (s.week - co.raisedAt);
  const sc = s.market.scarcity;
  const rank = richList(s).findIndex((r) => r.id === s.playerId) + 1;
  const mine = s.holdings.filter((h) => h.owner === s.playerId).sort((a, b) => b.shares * s.companies[b.company].price - a.shares * s.companies[a.company].price);
  const room = debtRoom(co);
  const chunk = Math.max(1e6, Math.round(room / 4 / 1e6) * 1e6);
  const repay = Math.min(co.debt, Math.max(0, co.cash));
  const deal = describeContract(s, co.id);
  return (
    <div class="screen">
      <Card title="Your fortune" tag={`#${rank} on the rich list`} color="var(--yellow)">
        <b class="huge">{money(netWorth(s, s.playerId))}</b>
        <ul class="news">
          <li><span class="dot" /><span>Cash in your own account: <b>{money(me.cash)}</b></span></li>
          {mine.map((h) => <li><Logo co={s.companies[h.company]} size={20} /><span>{s.companies[h.company].name}: {(100 * h.shares / s.companies[h.company].shares).toFixed(1)}%, worth <b>{money(h.shares * s.companies[h.company].price)}</b></span></li>)}
        </ul>
        {s.orders.filter((o) => o.owner === s.playerId || o.owner === co.id).map((o) => <p class="small muted">Filed: {o.owner === co.id ? 'buyback of' : o.shares > 0 ? 'buy' : 'sell'} {(Math.abs(o.shares) / 1e6).toFixed(2)}M {s.companies[o.company]?.name} shares, fills next week.</p>)}
        <p class="muted small">Dividends and share sales land here. Use it on the Street to buy into other companies, or to buy control of one.</p>
      </Card>

      <Card title={co.name} tag={s.helm ? `You run it and own ${Math.round(st * 100)}%` : `You own ${Math.round(st * 100)}% but do not run it`} color="var(--pink)">
        <div class="row"><Logo co={co} size={44} /><span class="grow"><b class="huge">{money(marketCap(co))}</b><br /><span class="muted small">market cap</span></span></div>
        <Spark data={co.hist} w={300} h={56} color={co.color} />
        <div class="stats">
          <div><span class="muted small">Cash</span><b class={co.cash < 0 ? 'bad' : ''}>{money(co.cash)}</b></div>
          <div><span class="muted small">In</span><b class="good">{money(co.rev)}/wk</b></div>
          <div><span class="muted small">Out</span><b class="bad">{money(co.cost)}/wk</b></div>
        </div>
        <p class="chips">
          <Chip tone={left < 8 ? 'bad' : left === Infinity ? 'good' : 'info'}>{left === Infinity ? 'Profitable' : `${Math.floor(left)} weeks of runway`}</Chip>
          {co.debt > 0 && <Chip tone="warn">Debt {money(co.debt)}, {money(interest(co))}/wk interest</Chip>}
          {s.week < co.integrationUntil && <Chip tone="warn">Digesting a merger for {co.integrationUntil - s.week} more weeks</Chip>}
          <Chip>Brand {Math.round(co.lab!.brand * 100)}</Chip><Chip>Hype {Math.round(co.lab!.hype * 100)}</Chip><Chip>Talent {Math.round(co.lab!.talent * 100)}</Chip>
        </p>
        {co.negWeeks > 0 && <p class="bad">Out of cash for {co.negWeeks} week{co.negWeeks === 1 ? '' : 's'}. At eight, the servers get repossessed.</p>}
        {s.helm && <>
          <h3>Raise money</h3>
          <Btn id="raise" class="wide" kind={left < 8 ? 'primary' : undefined} why={canRaise(s, co) ? null : `The bankers need ${wait} more week${wait === 1 ? '' : 's'}.`} onClick={() => act({ t: 'raise' })}>
            Sell new shares for about {money(co.shares * 0.1 * co.price * 0.9)}
          </Btn>
          <p class="muted small">Issues 10% more shares at a discount. Your stake shrinks to about {Math.round((st / 1.1) * 100)}%. Below half, raiders can take your lab. {canRaise(s, co) ? '' : `Available in ${wait} week${wait === 1 ? '' : 's'}.`}</p>
          <div class="row">
            <Btn class="grow" id="borrow" why={check(s, { t: 'borrow', amount: chunk })} onClick={() => act({ t: 'borrow', amount: Math.min(chunk, room) })}>Borrow {money(Math.min(chunk, room))}</Btn>
            <Btn class="grow" why={repay > 0 ? null : 'Nothing to repay.'} onClick={() => act({ t: 'borrow', amount: -repay })}>Repay {money(repay)}</Btn>
          </div>
          <p class="muted small">Lenders go to three years of profit ({money(room)} more). Interest starts at 6% a year and climbs with leverage. No dilution, but the bill comes every week.</p>
          <h3>Return money</h3>
          <Seg label="Dividend: share of weekly profit paid to shareholders" value={co.payout} options={PAYOUTS.map((v) => ({ v, label: v ? `${v * 100}% payout` : 'No dividend' }))} onChange={(rate) => act({ t: 'payout', rate })} />
          <p class="muted small">You get {Math.round(st * 100)}% of every dividend in your own account: about {money(co.payout * Math.max(0, co.ni8) * st)} a week now.</p>
          <Btn class="wide" id="buyback" why={check(s, { t: 'buyback' })} onClick={() => act({ t: 'buyback' })}>Buy back {BUYBACK * 100}% of the shares for about {money(quote(s, co.id, BUYBACK * co.shares))}</Btn>
          <p class="muted small">Shrinks the share count, so your stake grows without spending your own money. Filed now, fills next week.</p>
        </>}
        {!s.helm && <p class="muted">You were pushed out. Buy half of any lab on the Street and you can take its helm.</p>}
      </Card>

      {s.agreements.length > 0 && (
        <Card title="Agreements" color="var(--purple)">
          <ul class="news">
            {s.agreements.map((a) => (
              <li class={a.kind === 'supply' && !a.met && a.due! - s.week <= 3 ? 'bad' : ''}><span class="dot" /><span>
                {a.kind === 'supply' && (a.met ? `${a.account}: ${money(a.pay)} a week until week ${a.until + 1}.` : `${a.account}: score ${a.target} on ${segDef(s, a.seg!).bench} within ${a.due! - s.week} weeks, or pay ${money(4 * a.pay)}.`)}
                {a.kind === 'data' && `Exclusive ${a.data} data until week ${a.until + 1}.`}
                {a.kind === 'royalty' && `${coName(s, a.other)} pays you ${Math.round(a.pay * 100)}% of its revenue until week ${a.until + 1}.`}
              </span></li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Supply chain" tag={`Spot ${money(s.market.computePrice)} · you pay ${money(labPrice(s, co.id))}`} color="var(--teal)">
        <p class="muted">{sc > 1.8 ? 'A crunch. Whoever owns the bottleneck is printing money.' : sc < 0.8 ? 'A glut. A good week to start a big run: a run keeps the price it starts at.' : 'Normal trading.'} The tightest layer decides how much compute exists.</p>
        <ul class="chain">
          {(['cloud', 'chips', 'fab', 'power'] as const).map((layer) => {
            const cap = s.market.capacity[layer] ?? 0, tight = s.market.binding === layer;
            return (
              <li class={tight ? 'tight' : ''}>
                <div class="row"><b class="grow">{LAYER_NAME[layer]}</b>{tight && <Chip tone="bad">Bottleneck</Chip>}<span class="small muted">{LEAD[layer]} wk to build</span></div>
                <div class="gauge"><span style={{ width: `${Math.min(100, (100 * s.market.demand) / Math.max(1, cap))}%` }} class={s.market.demand > cap ? 'hot' : ''} /></div>
                <div class="chips">{suppliers(s, layer).map((c) => <Chip tone={playerControls(s, c.id) ? 'good' : 'info'}><Logo co={c} size={14} /> {c.name}</Chip>)}</div>
              </li>
            );
          })}
        </ul>
        {s.helm && <>
          <h3>Build your own datacenter</h3>
          <div class="row">{[0.5, 1].map((k) => { const units = Math.max(20, Math.round(co.lab!.cuUsed * k)); return <Btn class="grow" why={check(s, { t: 'datacenter', units })} onClick={() => act({ t: 'datacenter', units })}>{units} a week: {money(dcCost(s, units))}</Btn>; })}</div>
          <p class="muted small">Takes {DC_LEAD} weeks. Your lab then gets that capacity at cost, whatever the market does. {s.companies[dcId(co.id)] ? `You run ${Math.round(s.companies[dcId(co.id)].plant!.capacity)} a week already, with ${Math.round(s.companies[dcId(co.id)].plant!.queue.reduce((a, q) => a + q.add, 0))} more being built.` : ''}</p>
          {(co.lab!.hw.train < 1 || co.lab!.hw.infer < 1) && <p class="chips"><Chip tone="good">Own chips: training ×{co.lab!.hw.train.toFixed(2)}, serving ×{co.lab!.hw.infer.toFixed(2)}</Chip></p>}
        </>}
        {s.helm && (deal ? <p><b>Your contract:</b> {deal}.</p> : <>
          <h3>Lock in a year of compute</h3>
          <div class="row">{[0.5, 1].map((k) => { const units = Math.max(20, Math.round(co.lab!.cuUsed * k)); return <Btn class="grow" why={check(s, { t: 'contract', units })} onClick={() => act({ t: 'contract', units })}>{units} a week</Btn>; })}</div>
          <p class="muted small">{money(contractPrice(s))} per compute-week for 48 weeks, whatever the spot price does. You pay for it whether you use it or not. Last week you used {Math.round(co.lab!.cuUsed)}.</p>
        </>)}
        <p class="muted small">Buy a cloud outright on the Street and your lab gets its capacity at cost. Control any supplier and you set its prices, its building, and who it refuses to serve.</p>
      </Card>

      <Card title="Campaign">
        <p class="muted">{s.week < CAMPAIGN_WEEKS ? `${CAMPAIGN_WEEKS - s.week} weeks until the final standings, ranked by personal net worth.` : 'The campaign is over. You are playing on.'}</p>
        <Btn kind="danger" onClick={() => { if (confirm('Abandon this game and start over?')) quit(); }}>Start a new game</Btn>
      </Card>
    </div>
  );
}
