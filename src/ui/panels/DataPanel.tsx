// DAT: the Data screen. Leads with "Your tokens" (a treemap of what you own) and two numbers training reads. The
// catalogue has its filters in one row; a set's detail opens in a sheet; the make-your-own-data tools are tabs on the page.
import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { calendarYear } from '../../sim/util';
import { DATA_TUNING, availableDatasetsV2, collapsePenalty, dataStats, syntheticShare, type DatasetRow } from '../../sim/systems/data';
import type { GameState, Id } from '../../sim/types';
import { Card, HelpTip, PanelHeader, PanelIntro, Tabs, useIsMobile } from '../components';
import './panels.css';
import './data.css';
import { GetDataArea } from './DataOpsArea';
import { Catalogue } from './data/Catalogue';
import { SetSheet } from './data/SetSheet';
import { TokenMap } from './data/TokenMap';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createWarehouse, CAM as WAREHOUSE_CAM } from '../../scenes/data';
import { CommissionBody, LicenceBody, SyntheticBody, TOOL_TITLE, UserDataBody, licenceTotals, type ToolId } from './data/tools';
import { DEFAULT_VIEW, heroNumbers, ownedItems, type CatalogueView } from './data/model';
import { fmtTok, pct, plural, usd } from './data/labels';

export function DataPanel() {
  const s = useGame();
  const rows: DatasetRow[] = availableDatasetsV2(s);
  const year = calendarYear(s.day);
  const hero = heroNumbers(s);
  const items = ownedItems(s);
  const [view, setView] = useState<CatalogueView>(DEFAULT_VIEW);
  const [selId, setSelId] = useState<Id | null>(null);
  const [tool, setTool] = useState<ToolId>('commission');
  const openTool = (t: ToolId) => {
    setTool(t);
    document.getElementById('dt-make')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const phone = useIsMobile();
  const selRow = selId ? rows.find((r) => r.def.id === selId) : undefined;
  const patch = (p: Partial<CatalogueView>) => setView((v) => ({ ...v, ...p }));

  return (
    <div class="panel pn pn-data">
      <div class="dt">
        <PanelIntro
          id="data"
          steps={phone ? undefined : [
            'Pick a block in the map, or a row in the catalogue, to open a set.',
            'Audit a set to learn its real quality. Until then it is the seller\'s claim.',
            'Train on the sets you own in the Train wizard.',
          ]}
        >
          Models learn from data. Buy, licence, crawl or make it, then train on what you own.
        </PanelIntro>
        <PanelHeader code="DAT" title="Data" subtitle="What models learn from. Buy it, crawl it or make it." />

        <SceneView
          state={s}
          make={createWarehouse}
          cam={WAREHOUSE_CAM}
          camId="CAM-04"
          label="Your data warehouse: shelves of datasets by domain, the crawler, the refinery and jobs in flight"
          onSelect={(hit) => {
            if (hit.id.startsWith('domain:')) {
              patch({ domain: hit.id.slice(7) as CatalogueView['domain'], status: 'owned' as CatalogueView['status'] });
              document.querySelector('.dt-filter-inline')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
        />

        <section class="dt-hero" aria-label="Your tokens">
          <Card title="Your tokens" subtitle={`${hero.owned} ${hero.owned === 1 ? 'set' : 'sets'}`} class="dt-hero-map">
            <TokenMap items={items} onOpen={setSelId} />
          </Card>
          <div class="dt-nums">
            <BigNumber
              label="Unique tokens"
              help="Every token in the sets you own, counted once. Training can read them up to four times over (epochs), so this sets how big a run can be."
              value={fmtTok(hero.uniqueTokensB)}
              hint={hero.owned === 0 ? 'Nothing owned yet' : `Across ${plural(hero.owned, 'set')}`}
            />
            <BigNumber
              label="Average quality"
              help="How good the data is for training, before research bonuses. It is the sets you own, averaged the way the Train wizard does by default. Unverified sets count at the seller's claim."
              value={hero.avgQuality === null ? '—' : pct(hero.avgQuality)}
              hint={hero.unverified > 0 ? `${plural(hero.unverified, 'set')} unverified, a gamble` : hero.owned > 0 ? 'Every owned set is verified' : 'Buy a set to start'}
              tone={hero.unverified > 0 ? 'warn' : undefined}
            />
            <DataFacts s={s} onTool={openTool} />
          </div>
        </section>

        <GetDataArea
          s={s}
          market={
            <>
              <Catalogue s={s} rows={rows} view={view} patch={patch} selId={selId} onOpen={setSelId} />
              <MakeData s={s} tool={tool} onTool={setTool} />
            </>
          }
        />
      </div>

      <SetSheet s={s} row={selRow} year={year} onClose={() => setSelId(null)} />

    </div>
  );
}

function BigNumber({ label, help, value, hint, tone }: { label: string; help: string; value: string; hint: string; tone?: 'warn' }) {
  return (
    <div class="dt-big">
      <div class="dt-big-label">
        {label}
        <HelpTip>{help}</HelpTip>
      </div>
      <div class={`dt-big-value num ${tone === 'warn' ? 'warn' : ''}`}>{value}</div>
      <div class="dt-big-hint">{hint}</div>
    </div>
  );
}

/** The secondary numbers, shown inline. Each one is something the player can act on, so each has a button that does it. */
function DataFacts({ s, onTool }: { s: GameState; onTool: (t: ToolId) => void }) {
  const T = DATA_TUNING;
  const stats = dataStats(s);
  const synth = syntheticShare(s.data.owned, s);
  const penalty = collapsePenalty(s, s.data.owned);
  const lic = licenceTotals(s);
  const on = !!s.data.userDataOptIn;
  const heat = Math.round(s.flags[T.PRIVACY_HEAT_KEY] ?? 0);
  return (
    <div class="dt-details dt-details-inline">
            <DetailRow
              k="Licence fees"
              help="A licence is a yearly fee for better data. It is paid daily once the first year has run out, and it drains cash all year."
              v={lic.perYear > 0 ? `${usd(lic.perYear)} a year` : 'None'}
              sub={`${lic.count} active ${lic.count === 1 ? 'licence' : 'licences'}`}
              action="Manage"
              onAction={() => onTool('licences')}
            />
            <DetailRow
              k="Synthetic share"
              help={`Share of your data that your own models wrote. Past ${pct(T.COLLAPSE_SHARE_START)}, the next run loses quality.`}
              v={pct(synth)}
              sub={synth > T.COLLAPSE_SHARE_START ? 'Past the collapse line' : `Collapse line at ${pct(T.COLLAPSE_SHARE_START)}`}
              bad={synth > T.COLLAPSE_SHARE_START}
              action="Generate"
              onAction={() => onTool('synthetic')}
            />
            <DetailRow
              k="Collapse penalty"
              help="What a training run keeps of its data quality after model collapse. None means the data is clean."
              v={penalty >= 1 ? 'None' : `${Math.round((1 - penalty) * 100)}% lost`}
              sub={penalty >= 1 ? 'Quality intact' : 'Quality lost to synthetic data'}
              bad={penalty < 1}
            />
            <DetailRow
              k="Users' chats"
              help="Your products' chats can become training data. Harvesting keeps the tokens, but privacy heat rises every day you do it."
              v={fmtTok(stats.userChatsTokensB)}
              sub={on ? `Harvesting, heat ${heat}` : 'Not harvesting'}
              bad={on}
              action="Manage"
              onAction={() => onTool('users')}
            />
    </div>
  );
}

function DetailRow({
  k,
  help,
  v,
  sub,
  bad,
  action,
  onAction,
}: {
  k: string;
  help: string;
  v: string;
  sub: string;
  bad?: boolean;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div class="dt-detail-row-item">
      <div class="dt-detail-row-main">
        <span class="dt-detail-row-k">
          {k}
          <HelpTip>{help}</HelpTip>
        </span>
        <span class={`dt-detail-row-v num ${bad ? 'bad' : ''}`}>{v}</span>
        <span class="dt-detail-row-sub">{sub}</span>
      </div>
      {action && onAction && (
        <button type="button" class="btn btn-sm" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Make and manage your own data: the four tools as tabs, right on the screen. */
function MakeData({ s, tool, onTool }: { s: GameState; tool: ToolId; onTool: (t: ToolId) => void }) {
  const lic = licenceTotals(s);
  const on = !!s.data.userDataOptIn;
  const sub: Record<ToolId, string> = {
    commission: 'Paid humans, slow and careful',
    synthetic: 'Your own models write it',
    users: on ? 'Harvesting from your products' : 'Off',
    licences: lic.count > 0 ? `${lic.count} active, ${usd(lic.perYear)} a year` : 'None active',
  };
  const ids: ToolId[] = ['commission', 'synthetic', 'users', 'licences'];
  return (
    <Card title="Make your own data" subtitle={sub[tool]} class="dt-make">
      <div id="dt-make" />
      <Tabs<ToolId> variant="segmented" value={tool} onChange={onTool} tabs={ids.map((id) => ({ id, label: TOOL_TITLE[id] }))} />
      <div class="dt-make-body">
        {tool === 'commission' && <CommissionBody s={s} />}
        {tool === 'synthetic' && <SyntheticBody s={s} />}
        {tool === 'users' && <UserDataBody s={s} />}
        {tool === 'licences' && <LicenceBody s={s} />}
      </div>
    </Card>
  );
}
