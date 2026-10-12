// OWNER: v10 MARKETING agent. "Start a campaign": the campaign shop, behind one button.
import { useState } from 'preact/hooks';
import { CAMPAIGNS } from '../../../sim/data/campaigns';
import type { CampaignDef, GameState } from '../../../sim/types';
import { formatMoney } from '../../../sim/util';
import { Button, Sheet } from '../../components';
import { dispatch } from '../../store';
import { MAX_RUNNING_CAMPAIGNS, campaignEffects, campaignNote, launchBlock, targetLabel } from './campaignCopy';

/** v10.1: the campaign shop, shown right on the Marketing screen (no sheet). Phones show three campaigns, then "Show all". */
export function CampaignShop({ s }: { s: GameState }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <div class={`mk-camp-list mk-shop ${more ? 'is-open' : ''}`}>
        {CAMPAIGNS.map((def) => (
          <CampaignCard key={def.id} def={def} s={s} />
        ))}
      </div>
      <button type="button" class="btn mk-shop-more" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? 'Show fewer campaigns' : `Show all ${CAMPAIGNS.length} campaigns`}
      </button>
    </>
  );
}

export function CampaignSheet({ s, open, onClose }: { s: GameState; open: boolean; onClose: () => void }) {
  const used = s.market.campaigns.length;
  return (
    <Sheet
      open={open}
      title="Start a campaign"
      subtitle={`${used} of ${MAX_RUNNING_CAMPAIGNS} slots in use · cash ${formatMoney(s.finance.cash, 1)}`}
      onClose={onClose}
      width={760}
    >
      <div class="mk-camp-list">
        {CAMPAIGNS.map((def) => (
          <CampaignCard key={def.id} def={def} s={s} />
        ))}
      </div>
    </Sheet>
  );
}

function CampaignCard({ def, s }: { def: CampaignDef; s: GameState }) {
  const running = s.market.campaigns.find((c) => c.defId === def.id);
  const block = launchBlock(s, def);
  const note = campaignNote(s, def);
  const status = running ? `Running, ${running.daysLeft} ${running.daysLeft === 1 ? 'day' : 'days'} left` : block ?? note ?? 'Ready to launch';
  return (
    <article class={`mk-camp ${running ? 'is-running' : ''}`}>
      <div class="mk-camp-head">
        <div class="mk-camp-title">
          <div class="mk-camp-name">{def.name}</div>
          <div class="mk-camp-meta">
            {targetLabel(def)} · {def.days} days
          </div>
        </div>
        <div class="mk-camp-cost num">{formatMoney(def.cost, 1)}</div>
      </div>
      <ul class="mk-camp-fx">
        {campaignEffects(def).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div class="mk-camp-flavor">{def.flavor}</div>
      <div class="mk-camp-foot">
        <span class={`mk-camp-status ${block && !running ? 'is-blocked' : ''}`}>{status}</span>
        <Button
          variant="primary"
          size="sm"
          disabled={!!running || !!block}
          title={block ?? `Pay ${formatMoney(def.cost, 1)} for ${def.days} days`}
          onClick={() => dispatch({ type: 'launchCampaign', campaignId: def.id })}
        >
          {running ? 'Running' : 'Launch'}
        </Button>
      </div>
    </article>
  );
}
