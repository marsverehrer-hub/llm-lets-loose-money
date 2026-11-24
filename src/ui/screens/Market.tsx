// The Market: one lane per customer segment. Who buys from whom, and why.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { GameState, Id, Modality } from '../../sim/types';
import { leader, liveSegs, segDef, shareOf, targets } from '../../sim/demand';
import { MODALITIES, SEGMENTS } from '../../sim/content/modalities';
import { Card, Chip, Crown, Logo, Seg, ShareBar } from '../kit';
import { coName, money } from '../fmt';

function Lane({ s, id }: { s: GameState; id: Id }): JSX.Element {
  const [open, setOpen] = useState(false);
  const def = segDef(s, id), seg = s.segments[id];
  const share = shareOf(s, id);
  const apps = Object.values(s.companies).filter((c) => c.app?.reach[id] && c.app.partner);
  const parts = Object.entries(share).sort((a, b) => b[1] - a[1]).map(([lab, share]) => ({ key: lab, share, color: s.companies[lab].color, label: s.companies[lab].name }));
  const lead = leader(s, id);
  const t = targets(s, id);
  const mine = share[s.labId] ?? 0;
  return (
    <Card title={def.name} tag={`${money(seg.size * def.pRef)}/wk market`} color={lead.lab ? s.companies[lead.lab].color : undefined}>
      <p class="muted">{def.blurb}</p>
      <ShareBar parts={parts} />
      <div class="row small"><span class="grow">You: <b>{Math.round(mine * 100)}%</b></span>
        <span><Crown /> {def.bench}: {lead.lab ? `${coName(s, lead.lab)} (${Math.round(lead.fit)})` : 'open'}</span></div>
      {apps.map((c) => <p class="small muted"><Logo co={c} size={16} /> {c.name} sends {Math.round(100 * c.app!.reach[id] * (c.app!.exclusive ? 1 : 0.5))}% of this market to {coName(s, c.app!.partner)}{c.app!.exclusive ? ' exclusively' : ''} until week {c.app!.until + 1}.</p>)}
      <ul class="accounts">
        {def.accounts.map((name, i) => {
          const lab = seg.accounts[i];
          return <li class={lab === s.labId ? 'me' : ''}>{lab ? <Logo co={s.companies[lab]} size={18} /> : <span class="logo none" />}<span>{name}</span></li>;
        })}
      </ul>
      <button type="button" class="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Why they buy'}</button>
      {open && (
        <table class="why">
          <thead><tr><th>Lab</th><th>Score</th><th>Price</th><th>Speed</th><th>Trust</th><th>Pull</th></tr></thead>
          <tbody>
            {t.offers.sort((a, b) => b.u - a.u).map((o) => (
              <tr class={o.lab === s.labId ? 'me' : ''}>
                <td>{o.model.name}</td><td>{Math.round(o.fit)}</td><td>×{o.model.price}</td><td>×{o.model.attrs.speed.toFixed(1)}</td><td>{Math.round(o.model.attrs.trust * 100)}</td>
                <td><b>{Math.round((t.share[o.lab] ?? 0) * 100)}%</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <p class="muted small">Weights here: {MODALITIES[def.modality].axes.map((a, i) => (def.w[i] ? `${a} ${Math.round(def.w[i] * 100)}%` : null)).filter(Boolean).join(', ')}.
        {' '}Price matters {def.priceSens >= 1.5 ? 'a lot' : def.priceSens >= 1 ? 'somewhat' : 'little'}, trust {def.trustSens >= 1.5 ? 'a lot' : def.trustSens >= 1 ? 'somewhat' : 'little'}, speed {def.speedSens >= 1 ? 'a lot' : def.speedSens >= 0.4 ? 'somewhat' : 'little'}. A lab only sells here if its model makes money at this segment's prices.</p>}
    </Card>
  );
}

export function Market({ s }: { s: GameState }): JSX.Element {
  const [m, setM] = useState<Modality>('lang');
  return (
    <div class="screen">
      <Seg label="Kind of model" value={m} options={Object.values(MODALITIES).filter((x) => x.unlockWeek <= s.week).map((x) => ({ v: x.id, label: x.name }))} onChange={setM} />
      <p class="chips">{Object.values(s.companies).filter((c) => Object.values(s.models).some((x) => x.lab === c.id && x.modality === m && !x.retired)).map((c) => <Chip><Logo co={c} size={14} /> {c.name}</Chip>)}</p>
      {liveSegs(s, m).map((g) => <Lane key={g.id} s={s} id={g.id} />)}
    </div>
  );
}
