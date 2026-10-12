// OWNER: ONBOARD (v10 agent 7). Headquarters: the first screen. A calm overview that leads with pictures.
// Parts live in ./hq/: the next-step card, money, training, products, the rival race and the Details drawer.
import { OfficeView } from '../../office/OfficeView';
import { OFFICE_TIERS } from '../../sim/data/roles';
import type { GameState } from '../../sim/types';
import { dayToDate } from '../../sim/util';
import { Card, PanelHeader, PanelIntro, useIsMobile } from '../components';
import { headcount } from '../components/derive';
import { useGame } from '../store';
import { GoalsCard } from './GoalsCard'; // v9 scenario: renders only when the scenario has goals
import { DetailsSection } from './hq/DetailsSection';
import { MoneyCard } from './hq/MoneyCard';
import { NextCard } from './hq/NextCard';
import { ProductsCard } from './hq/ProductsCard';
import { RaceCard } from './hq/RaceCard';
import { TrainingCard } from './hq/TrainingCard';
import './panels-a.css';
import './hq/hq.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 MAR 2019" from a day number. */
function dateTag(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function DashboardPanel() {
  const s: GameState = useGame();
  const isPhone = useIsMobile();
  const office = OFFICE_TIERS.find((t) => t.id === s.company.officeTierId);
  const seats = office?.capacity ?? 0;
  const heads = headcount(s);
  const datacenters = s.compute.datacenters.length;

  return (
    <div class="panel hq">
      <PanelHeader code="HQ" title="Headquarters" subtitle={`${s.company.name} · ${dateTag(s.day)}`} />
      <PanelIntro id="hq">Your lab on one screen. The top card always names the next useful move, and Details holds the charts.</PanelIntro>

      <div class="hq-top">
        <NextCard s={s} />
        <GoalsCard />
      </div>

      <div class="grid-split">
        <Card title="Office" subtitle={`${office?.name ?? 'Unknown office'} · ${heads}/${seats} seats · ${datacenters} DC`} flush>
          <OfficeView state={s} height={isPhone ? 220 : 300} />
        </Card>
        <MoneyCard s={s} />
      </div>

      <div class="grid-3">
        <TrainingCard s={s} />
        <ProductsCard s={s} />
        <RaceCard s={s} />
      </div>

      <DetailsSection s={s} />
    </div>
  );
}

