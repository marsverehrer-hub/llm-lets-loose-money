// OWNER: ONBOARD. Headquarters: the first screen. It answers "what is going on and what should I do next":
// the advisor (./hq/NextCard), goals, key numbers with trends, the live run, money, products, rivals and the office.
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
import { ChapterBanner } from './hq/ChapterBanner'; // v17
import { KpiStrip } from './hq/KpiStrip';
import { ProductsCard } from './hq/ProductsCard';
import { RaceCard } from './hq/RaceCard';
import { TrainingCard } from './hq/TrainingCard';
import { BoardCard } from './lab/BoardCard'; // v13
import { LevelCard } from './lab/LevelCard'; // v13
import './lab/lab.css';
import './panels-a.css';
import './hq/hq.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar 2019" from a day number. */
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
      <PanelHeader title={s.company.name} subtitle={`${dateTag(s.day)} · ${office?.name ?? 'Unknown office'}`} />
      <PanelIntro id="hq">
        Your lab at a glance. The advisor lists what to do next, most urgent first. Every number links to the screen where you change it.
      </PanelIntro>

      <ChapterBanner s={s} />

      <div class="hq-top">
        <NextCard s={s} />
        <div class="hq-goals">
          <BoardCard s={s} />
          <GoalsCard />
        </div>
      </div>

      <KpiStrip s={s} />

      {/* The loop on one row: the live run (with its tempo) and the lab level. */}
      <div class="hq-hero">
        <TrainingCard s={s} />
        <LevelCard s={s} />
      </div>

      <div class="grid-3 hq-numbers">
        <MoneyCard s={s} />
        <ProductsCard s={s} />
        <RaceCard s={s} />
      </div>

      <Card title="Office" class="hq-office" subtitle={`${office?.name ?? 'Unknown office'} · ${heads}/${seats} seats · ${datacenters} datacenter${datacenters === 1 ? '' : 's'}`} flush>
        <OfficeView state={s} height={isPhone ? 190 : 260} />
      </Card>

      <DetailsSection s={s} />
    </div>
  );
}
