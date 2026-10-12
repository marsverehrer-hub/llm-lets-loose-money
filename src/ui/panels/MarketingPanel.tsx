// OWNER: v10 MARKETING agent (GAME_DESIGN §21.5). The Marketing screen: brand and hype, campaigns, the funnel, the team.
import { Card, HelpTip, LineChart, PanelHeader, PanelIntro, Stat, clamp, monthYear } from '../components';
import type { LineSeries } from '../components';
import { useGame } from '../store';
import { CampaignShop } from './marketing/CampaignSheet';
import { CampaignTimeline } from './marketing/CampaignTimeline';
import { Funnel } from './marketing/Funnel';
import { MarketingTeam } from './marketing/MarketingTeam';
import { MAX_RUNNING_CAMPAIGNS } from './marketing/campaignCopy';
import type { GameState } from '../../sim/types';
import { formatMoney } from '../../sim/util';
import './marketing/marketing.css';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createCity, CAM as CITY_CAM } from '../../scenes/marketing';
import { navigate } from '../nav';

/** One weekly sample of the company's brand and hype. The sim does not record these yet (see the report). */
interface BrandSample {
  day: number;
  brand: number;
  hype: number;
}

/** Brand and hype history, sampled weekly by the market system (older saves start empty). */
function brandHistory(s: GameState): BrandSample[] {
  return s.market.history ?? [];
}

const BRAND_TIP = 'How well people know your name. It multiplies how much of every market you win, and it fades over years, not weeks.';
const HYPE_TIP = 'Buzz around your company right now. It adds a smaller boost to demand than brand. It fades within a month or two, and campaigns and launches refill it.';

export function MarketingPanel() {
  const s = useGame();
  const brand = clamp(s.company.brand, 0, 100);
  const hype = clamp(s.company.hype, 0, 100);
  const running = s.market.campaigns.length;
  const history = brandHistory(s);

  const series: LineSeries[] = [
    { name: 'Brand', color: 'var(--blue)', points: history.map((h) => ({ x: h.day, y: h.brand })) },
    { name: 'Hype', color: 'var(--amber)', points: history.map((h) => ({ x: h.day, y: h.hype })) },
  ];

  return (
    <div class="panel mk">
      <PanelHeader code="MKG" title="Marketing" subtitle={`${monthYear(s.day)} · ${running} of ${MAX_RUNNING_CAMPAIGNS} campaigns running`} />
      <PanelIntro id="marketing">Campaigns buy brand and hype. Brand and hype help you win customers in every market.</PanelIntro>
      <SceneView
        state={s}
        make={createCity}
        cam={CITY_CAM}
        camId="CAM-07"
        label="Downtown: your campaigns on billboards, your name on storefronts as brand grows, crowds as hype rises, and rival ads on the rest"
        onSelect={(hit) => {
          if (hit.id === 'team') navigate('staff');
          else if (hit.id.startsWith('campaign:') || hit.id === 'brand' || hit.id === 'hype')
            document.querySelector('.mk-camp-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      <Card class="mk-hero-card" title="Brand and hype" subtitle="Your company, not the whole market">
        <div class="mk-hero">
          <div class="mk-hero-nums">
            <div class="mk-big">
              <Stat label={<>Brand <HelpTip>{BRAND_TIP}</HelpTip></>} value={Math.round(brand)} hint="Out of 100" size="lg" />
              <div class="mk-meter" style={{ '--c': 'var(--blue)' } as any}>
                <span style={{ width: `${brand}%` }} />
              </div>
            </div>
            <div class="mk-big">
              <Stat label={<>Hype <HelpTip>{HYPE_TIP}</HelpTip></>} value={Math.round(hype)} hint="Out of 100" size="lg" />
              <div class="mk-meter" style={{ '--c': 'var(--amber)' } as any}>
                <span style={{ width: `${hype}%` }} />
              </div>
            </div>
          </div>
          <div class="mk-hero-chart">
            {history.length > 0 ? (
              <LineChart series={series} height={190} yFormat={(v) => String(Math.round(v))} />
            ) : (
              <div class="mk-nohist">
                <span>Trend history is not recorded yet.</span>
                <span class="mk-nohist-sub">Today's values are shown on the left.</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        class="mk-timeline-card"
        title="Campaigns"
        subtitle={`${running} of ${MAX_RUNNING_CAMPAIGNS} running`}
>
        <CampaignTimeline s={s} />
      </Card>

      <Card class="mk-shop-card" title="Start a campaign" subtitle={`${MAX_RUNNING_CAMPAIGNS - running} slot${MAX_RUNNING_CAMPAIGNS - running === 1 ? '' : 's'} free · cash ${formatMoney(s.finance.cash, 1)}`}>
        <CampaignShop s={s} />
      </Card>

      <div class="mk-lower">
        <Card title="Funnel" subtitle="Market size to your users, per segment">
          <Funnel s={s} />
        </Card>
        <MarketingTeam s={s} />
      </div>

    </div>
  );
}
