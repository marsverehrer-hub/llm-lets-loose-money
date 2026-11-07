// OWNER: ONBOARD. Headquarters: the first screen. It answers "what is going on and what should I do next":
// the advisor (./hq/AdvisorCard), the live run and research, key numbers, money, products, rivals, the office, charts.
import { useState } from 'preact/hooks';
import { OfficeView } from '../../office/OfficeView';
import { OFFICE_TIERS } from '../../sim/data/roles';
import type { GameState } from '../../sim/types';
import { dayToDate } from '../../sim/util';
import { Card, PanelHeader, useIsMobile } from '../components';
import { headcount } from '../components/derive';
import { useGame } from '../store';
import { AdvisorCard } from './hq/AdvisorCard';
import { DetailsSection } from './hq/DetailsSection';
import { KpiStrip } from './hq/KpiStrip';
import { MoneyCard } from './hq/MoneyCard';
import { ProductsCard } from './hq/ProductsCard';
import { RaceCard } from './hq/RaceCard';
import { ResearchLine } from './hq/ResearchLine';
import { TrainingCard } from './hq/TrainingCard';
import './lab/lab.css';
import './panels-a.css';
import './hq/hq.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Remembers whether the office picture is open. */
const OFFICE_KEY = 'llm-lets-loose-money/hq-office-open';

/** "14 Mar 2019" from a day number. */
function dateTag(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The saved choice, else closed: the office is a picture, so v18 keeps Headquarters short by default.
 * Storage can be blocked, so every access is guarded.
 */
function readOfficeOpen(): boolean {
  try {
    return localStorage.getItem(OFFICE_KEY) === '1';
  } catch {
    return false;
  }
}

function OfficeDisclosure({ s, subtitle }: { s: GameState; subtitle: string }) {
  const [open, setOpen] = useState(readOfficeOpen);
  const isPhone = useIsMobile();
  const onToggle = (e: Event) => {
    const next = (e.currentTarget as HTMLDetailsElement).open;
    setOpen(next);
    try {
      localStorage.setItem(OFFICE_KEY, next ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  return (
    <details class="disclosure hq-office" open={open} onToggle={onToggle}>
      <summary>
        Office <span class="hq-office-sub">{subtitle}</span>
      </summary>
      {open && (
        <Card flush>
          <OfficeView state={s} height={isPhone ? 190 : 260} />
        </Card>
      )}
    </details>
  );
}

export function DashboardPanel() {
  const s: GameState = useGame();
  const office = OFFICE_TIERS.find((t) => t.id === s.company.officeTierId);
  const seats = office?.capacity ?? 0;
  const heads = headcount(s);
  const datacenters = s.compute.datacenters.length;

  return (
    <div class="panel hq">
      <PanelHeader title={s.company.name} subtitle={`${dateTag(s.day)} · ${office?.name ?? 'Unknown office'}`} />

      <AdvisorCard s={s} />

      {/* The loop on one row: the live run (with its tempo) and the research topic. */}
      <div class="hq-live">
        <TrainingCard s={s} />
        <ResearchLine s={s} />
      </div>

      <KpiStrip s={s} />

      <div class="grid-3 hq-numbers">
        <MoneyCard s={s} />
        <ProductsCard s={s} />
        <RaceCard s={s} />
      </div>

      <OfficeDisclosure s={s} subtitle={`${office?.name ?? 'Unknown office'} · ${heads}/${seats} seats · ${datacenters} datacenter${datacenters === 1 ? '' : 's'}`} />

      <DetailsSection s={s} />
    </div>
  );
}
