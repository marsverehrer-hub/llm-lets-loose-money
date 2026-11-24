// The Street: every listed company, who owns it, and the tools to buy it: shares, control, or the whole thing.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { Company, GameState } from '../../sim/types';
import { check } from '../../sim/apply';
import { marketCap } from '../../sim/books';
import { blockChance, PREMIUMS, tenderTerms } from '../../sim/deals';
import { crowns, segDef } from '../../sim/demand';
import { floatOf, quote, richList, sharesOf, stake } from '../../sim/stock';
import { LAYER_NAME, LEAD, playerControls } from '../../sim/supply';
import { ChipWizard } from './ChipWizard';
import { SEGMENTS } from '../../sim/content/modalities';
import { Btn, Card, Chip, Crown, Logo, Portrait, Seg, Sheet, Spark, type Mood } from '../kit';
import { act } from '../store';
import { money, pct } from '../fmt';

const change = (co: Company, weeks: number): number => {
  const old = co.hist[Math.max(0, co.hist.length - 1 - weeks)] ?? co.price;
  return co.price / old - 1;
};
export const moodOf = (co: Company): Mood => { const c = change(co, 4); return c > 0.15 ? 'smug' : c > 0.03 ? 'happy' : c < -0.15 ? 'panic' : c < -0.03 ? 'angry' : 'neutral'; };
const STYLE: Record<string, string> = { hype: 'Ships loud and early', research: 'Bets on new ideas', safety: 'Slow, careful, trusted', follower: 'Copies what works', pricewar: 'Cheaper than you' };
const LOTS = [0.005, 0.01, 0.02, 0.05];

function Dossier({ s, co, onClose, onChip }: { s: GameState; co: Company; onClose: () => void; onChip: (id: string) => void }): JSX.Element {
  const [lot, setLot] = useState(0.01);
  const [premium, setPremium] = useState(0.35);
  const models = Object.values(s.models).filter((m) => m.lab === co.id && !m.retired).sort((a, b) => b.shipped - a.shipped);
  const run = Object.values(s.runs).find((r) => r.lab === co.id && r.status === 'running');
  const mine = co.id === s.labId && s.helm;
  const n = Math.round(lot * co.shares);
  const own = sharesOf(s, s.playerId, co.id);
  const buyWhy = check(s, { t: 'trade', company: co.id, shares: n });
  const sellWhy = check(s, { t: 'trade', company: co.id, shares: -Math.min(n, own) });
  const owners = s.holdings.filter((h) => h.company === co.id).sort((a, b) => b.shares - a.shares);
  const deal = s.deals.find((d) => d.target === co.id);
  const labBid = tenderTerms(s, s.labId, true, co.id, premium), meBid = tenderTerms(s, s.playerId, false, co.id, premium);
  const labWhy = check(s, { t: 'tender', target: co.id, premium, as: 'lab' }), meWhy = check(s, { t: 'tender', target: co.id, premium, as: 'me' });
  const helmWhy = check(s, { t: 'helm', company: co.id });
  return (
    <Sheet title={co.name} onClose={onClose}>
      <div class="row"><Portrait name={mine ? 'you' : co.ceo.name} style={co.ceo.style} mood={moodOf(co)} size={72} />
        <div><b>{co.ceo.name}</b><br /><span class="muted">{mine ? 'That is you.' : co.lab ? STYLE[co.ceo.style] : LAYER_NAME[co.layer]}</span><br /><span class="small muted">"{co.tagline}"</span></div></div>
      <div class="stats">
        <div><span class="muted small">Market cap</span><b>{money(marketCap(co))}</b></div>
        <div><span class="muted small">Revenue</span><b>{money(co.rev)}/wk</b></div>
        <div><span class="muted small">Cash less debt</span><b>{money(co.cash - co.debt)}</b></div>
      </div>
      <Spark data={co.hist} w={300} h={60} color={co.color} />
      <p class="chips">{crowns(s, co.id).map((id) => <Chip tone="good"><Crown /> {segDef(s, id).bench}</Chip>)}{run && !mine && <Chip tone="warn">Training something, about {Math.max(1, run.weeksPlanned - run.weeksDone)} weeks out</Chip>}
        {co.pill && <Chip tone="warn">Poison pill</Chip>}{deal && <Chip tone="bad">Bid on the table, closes in {deal.closes - s.week} wk</Chip>}</p>

      {co.plant && <>
        <h3>{LAYER_NAME[co.layer]}</h3>
        <p class="muted small">Supports {Math.round(co.plant.capacity)} compute-weeks a week, {Math.round((100 * co.plant.capacity) / Math.max(1, s.market.capacity[co.layer] ?? 1))}% of its layer{co.plant.queue.length ? `, with ${Math.round(co.plant.queue.reduce((a, q) => a + q.add, 0))} more being built` : ''}.
          {s.market.binding === co.layer ? ' Its layer is the bottleneck right now, so it collects the scarcity premium.' : ''}</p>
        {playerControls(s, co.id) ? <>
          <Seg label="Pricing" value={co.plant.posture} options={[{ v: -1, label: 'Undercut' }, { v: 0, label: 'Market price' }, { v: 1, label: 'Premium' }]} onChange={(posture) => act({ t: 'lever', company: co.id, posture })} />
          <Seg label="Building" value={co.plant.capex} options={[{ v: 0, label: 'Coast' }, { v: 1, label: 'Build steadily' }, { v: 2, label: 'Build flat out' }]} onChange={(capex) => act({ t: 'lever', company: co.id, capex })} />
          <p class="muted small">Undercutting wins share at thinner margins. Building takes {LEAD[co.layer]} weeks to arrive and costs cash now. Refuse a rival lab and it pays more for compute while you lose its business; regulators notice if your lab is big.</p>
          <div class="chips">{Object.values(s.companies).filter((x) => x.lab && x.id !== s.labId).map((x) => (
            <button type="button" class={`chip ${co.plant!.blocked.includes(x.id) ? 'bad' : ''}`} disabled={!!check(s, { t: 'lever', company: co.id, block: x.id })} onClick={() => act({ t: 'lever', company: co.id, block: x.id })}>{co.plant!.blocked.includes(x.id) ? 'Refusing' : 'Serving'} {x.name}</button>
          ))}</div>
        </> : <p class="muted small">Control it and you set its prices, its building, and who it refuses to serve.</p>}
      </>}

      <h3>Who owns it</h3>
      <ul class="news">
        {owners.map((h) => <li class={h.owner === s.playerId ? 'good' : ''}><span class="dot" /><span>{s.actors[h.owner]?.name ?? s.companies[h.owner]?.name ?? h.owner}: <b>{(100 * h.shares / co.shares).toFixed(1)}%</b></span></li>)}
        <li><span class="dot" /><span>The public: <b>{(100 * floatOf(s, co.id) / co.shares).toFixed(1)}%</b></span></li>
      </ul>

      <h3>Trade with your own money</h3>
      <Seg label="Lot size" value={lot} options={LOTS.map((v) => ({ v, label: `${v * 100}%` }))} onChange={setLot} />
      <div class="row">
        <Btn class="grow" kind="primary" id="buy" why={buyWhy} onClick={() => act({ t: 'trade', company: co.id, shares: n })}>Buy for {money(quote(s, co.id, n))}</Btn>
        <Btn class="grow" why={own > 0 ? sellWhy : 'You own none.'} onClick={() => act({ t: 'trade', company: co.id, shares: -Math.min(n, own) })}>Sell for {money(-quote(s, co.id, -Math.min(n, own)))}</Btn>
      </div>
      <p class="muted small">You hold {(stake(s, s.playerId, co.id) * 100).toFixed(1)}% and have {money(s.actors[s.playerId].cash)} of your own. Big orders move the price against you; 5% of a company a week at most.
        {mine ? ' Trades in the lab you run are filed and fill next week.' : ''}{buyWhy && buyWhy !== sellWhy ? ` ${buyWhy}` : ''}</p>
      {co.layer === 'chips' && playerControls(s, co.id) && <Btn kind="primary" class="wide" id="design-chip" why={Object.values(s.chips).some((c) => c.company === co.id && c.status === 'running') ? 'A chip is already in design here.' : null} onClick={() => onChip(co.id)}>Design a chip</Btn>}
      {stake(s, s.playerId, co.id) >= 0.5 && !mine && co.lab && <Btn kind="primary" id="helm" why={helmWhy} onClick={() => act({ t: 'helm', company: co.id })}>Take the helm</Btn>}

      {co.id !== s.labId && <>
        <h3>Take it over</h3>
        <Seg label="Premium over market" value={premium} options={PREMIUMS.map((v) => ({ v, label: `+${Math.round(v * 100)}%` }))} onChange={setPremium} />
        <Btn kind="primary" id="bid-lab" class="wide" why={labWhy} onClick={() => act({ t: 'tender', target: co.id, premium, as: 'lab' })}>Your lab buys all of it: {money(labBid.cost)}</Btn>
        <p class="muted small">{co.lab ? 'Merges its models, data, techniques and customers into yours.' : co.layer === 'cloud' ? 'It becomes a subsidiary: your lab gets its capacity at cost and all of its profit.' : 'It becomes a subsidiary: your lab gets all of its profit and its levers.'} Paid from the lab's cash, then debt. Regulators block it {Math.round(blockChance(s, s.labId, co.id) * 100)}% of the time at your size. {labWhy ?? ''}</p>
        <Btn class="wide" id="bid-me" why={meWhy} onClick={() => act({ t: 'tender', target: co.id, premium, as: 'me' })}>You buy control: {money(meBid.cost)}</Btn>
        <p class="muted small">You personally end up with 51% and {co.lab ? 'can take the helm' : 'set its levers'}. {meWhy ?? ''}</p>
        <p class="muted small">A bid stays open two weeks. The public sells if the premium is rich enough; tycoons sell if it beats their pride. Fall short of half and you pay a 1% break fee.</p>
      </>}

      {co.lab && <h3>On sale</h3>}
      {co.lab && models.length === 0 && <p class="muted">Nothing yet.</p>}
      <ul class="news">{models.map((m) => <li><span class="dot" /><span><b>{m.name}</b> · {m.cap.map((c) => Math.round(c)).join(' / ')} · ×{m.price} · {s.week - m.shipped} weeks old</span></li>)}</ul>
    </Sheet>
  );
}

export function Street({ s }: { s: GameState }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'cos' | 'rich'>('cos');
  const [chip, setChip] = useState<string | null>(null);
  const list = Object.values(s.companies).sort((a, b) => marketCap(b) - marketCap(a));
  const rich = richList(s);
  return (
    <div class="screen">
      <Seg label="View" value={view} options={[{ v: 'cos', label: 'Companies' }, { v: 'rich', label: 'Rich list' }]} onChange={setView} />
      {view === 'cos' && (
        <Card title="The Street" tag="Tap a company to trade or bid">
          <ul class="tickers">
            {list.map((co, i) => {
              const c = change(co, 1), mine = co.id === s.labId && s.helm, st = stake(s, s.playerId, co.id);
              return (
                <li class={mine ? 'me' : ''}>
                  <button type="button" onClick={() => setOpen(co.id)} aria-label={`Open ${co.name}`}>
                    <span class="rank">{i + 1}</span>
                    <Portrait name={mine ? 'you' : co.ceo.name} style={co.ceo.style} mood={moodOf(co)} size={40} />
                    <span class="grow"><b>{co.name}</b><br /><span class="muted small">{money(marketCap(co))}{st > 0 ? ` · you own ${(st * 100).toFixed(0)}%` : co.lab ? ` · ${money(co.rev)}/wk` : ` · ${LAYER_NAME[co.layer]}`}</span></span>
                    <Spark data={co.hist.slice(-24)} color={co.color} />
                    <span class={`px ${c >= 0 ? 'good' : 'bad'}`}>${co.price.toFixed(2)}<br /><span class="small">{pct(c, 1)}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {view === 'rich' && (
        <Card title="The rich list" tag="Personal net worth" color="var(--yellow)">
          <ol class="standings big">
            {rich.map((r, i) => {
              const a = s.actors[r.id];
              const top = s.holdings.filter((h) => h.owner === r.id).sort((x, y) => y.shares * s.companies[y.company].price - x.shares * s.companies[x.company].price)[0];
              return (
                <li class={a.isPlayer ? 'me' : ''}>
                  <span class="rank">{i + 1}</span><Portrait name={a.isPlayer ? 'you' : a.name} style="follower" mood={i === 0 ? 'smug' : 'neutral'} size={40} />
                  <span class="grow">{a.name}<br /><span class="muted small">{a.persona?.blurb ?? 'Founder. Slide-deck visionary.'}{top ? ` Biggest bet: ${s.companies[top.company].name}.` : ''}</span></span>
                  <b>{money(r.worth)}</b>
                </li>
              );
            })}
          </ol>
          <p class="muted small">Your net worth is your own cash plus your shares at today's prices. The final standings rank this list.</p>
        </Card>
      )}
      {open && s.companies[open] && <Dossier s={s} co={s.companies[open]} onClose={() => setOpen(null)} onChip={(id) => { setOpen(null); setChip(id); }} />}
      {chip && s.companies[chip] && <ChipWizard s={s} company={chip} onClose={() => setChip(null)} />}
    </div>
  );
}
