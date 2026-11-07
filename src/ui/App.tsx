// OWNER: UI polish agent (shell + juice). Panel ids/paths are fixed so the panels drop in.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Suspense, type ComponentType } from 'preact/compat';
import { TopBar } from './shell/TopBar';
import { SideNav } from './shell/SideNav';
import { NewsTicker } from './shell/NewsTicker';
import { RunDock } from './shell/RunDock'; // v13: training, research, level and board on every screen
import { EventModal } from './shell/EventModal';
import { IncidentModal } from './shell/IncidentModal';
import { EvalReveal } from './shell/EvalReveal';
import { MomentTakeover } from './shell/MomentTakeover';
import { Toasts } from './shell/Toasts';
import { NoticeLog } from './shell/NoticeLog';
import { DoctrinePicker } from './shell/DoctrinePicker';
import { Shortcuts, SHORTCUTS_EVENT } from './shell/Shortcuts';
import { DashboardPanel } from './panels/DashboardPanel';
import { useLobbyOpen } from './mp/lobbyState';
import { tutorialTarget } from './tutorial/steps';
import { useMissionRun } from './missions/missions';
import { lazyNamed } from './lazy';
import { FxDirector } from './fx/Director';
import { initSound } from './fx/sound';
import { onNavigate } from './nav';
import { getState, subscribe, useGameSelect, sameRecord } from './store';
import { isPanelVisible, markSeen, subscribeUnlocks, syncUnlocks, unlockPanel, unseenPanels } from './unlocks';
import { useIsMobile } from './components';
import { MobileNav } from './shell/MobileNav';
import { HubTabs } from './shell/HubTabs';
import { HubContext, hubOf, type Hub } from './shell/hubs';
import { applyTheme, readTheme } from './shell/theme';
import type { GameState } from '../sim/types';
import './shell/shell.css';
import './components/viz.css';
import './tutorial/tutorial.css';
import './fx/fx.css';
import './mp/mp.css';

// Saved theme applies before the first render (index.html also sets it before paint).
applyTheme(readTheme());

export type PanelId = 'dashboard' | 'lab' | 'models' | 'products' | 'compute' | 'data' | 'research' | 'benchmarks' | 'staff' | 'market' | 'contracts' | 'finance' | 'vs' | 'achievements' | 'marketing' | 'field';

// Everything below the first paint is loaded on demand (Vite splits each import() into its own chunk). The HQ panel,
// the shell and the advisor stay eager. Overlays that open from window events are mounted up front, so they hear the event.
const ModelsPanel = lazyNamed(() => import('./panels/ModelsPanel'), 'ModelsPanel');
const ProductsPanel = lazyNamed(() => import('./panels/ProductsPanel'), 'ProductsPanel');
const ComputePanel = lazyNamed(() => import('./panels/ComputePanel'), 'ComputePanel');
const DataPanel = lazyNamed(() => import('./panels/DataPanel'), 'DataPanel');
const ResearchPanel = lazyNamed(() => import('./panels/ResearchPanel'), 'ResearchPanel');
const BenchmarksPanel = lazyNamed(() => import('./panels/BenchmarksPanel'), 'BenchmarksPanel');
const StaffPanel = lazyNamed(() => import('./panels/StaffPanel'), 'StaffPanel');
const MarketPanel = lazyNamed(() => import('./panels/MarketPanel'), 'MarketPanel');
const MarketingPanel = lazyNamed(() => import('./panels/MarketingPanel'), 'MarketingPanel');
const FinancePanel = lazyNamed(() => import('./panels/FinancePanel'), 'FinancePanel');
const AchievementsPanel = lazyNamed(() => import('./panels/AchievementsPanel'), 'AchievementsPanel');
const ContractsPanel = lazyNamed(() => import('./panels/ContractsPanel'), 'ContractsPanel');
const LabPanel = lazyNamed(() => import('./panels/LabPanel'), 'LabPanel');
const FieldPanel = lazyNamed(() => import('./panels/FieldPanel'), 'FieldPanel');
const VsPanel = lazyNamed(() => import('./mp/VsPanel'), 'VsPanel');
const Lobby = lazyNamed(() => import('./mp/Lobby'), 'Lobby');
const MpOverlays = lazyNamed(() => import('./mp/MpOverlays'), 'MpOverlays');
const Tutorial = lazyNamed(() => import('./tutorial/Tutorial'), 'Tutorial');
const MissionCoach = lazyNamed(() => import('./missions/MissionCoach'), 'MissionCoach');
const GameOver = lazyNamed(() => import('./shell/GameOver'), 'GameOver');
const AnnualReport = lazyNamed(() => import('./shell/AnnualReport'), 'AnnualReport'); // v21 the year's filed report
const EndingModal = lazyNamed(() => import('./shell/EndingModal'), 'EndingModal');
const NewGame = lazyNamed(() => import('./shell/NewGame'), 'NewGame'); // v9 scenario: new-game setup screen
const SavesSheet = lazyNamed(() => import('./shell/SavesSheet'), 'SavesSheet'); // saves: every game in its own slot

export const PANELS: { id: PanelId; label: string; Component: ComponentType<any> }[] = [
  { id: 'dashboard', label: 'Headquarters', Component: DashboardPanel },
  { id: 'lab', label: 'Level & perks', Component: LabPanel }, // v13 progression
  { id: 'models', label: 'Models', Component: ModelsPanel },
  { id: 'products', label: 'Products', Component: ProductsPanel },
  { id: 'compute', label: 'Compute', Component: ComputePanel },
  { id: 'data', label: 'Data', Component: DataPanel },
  { id: 'research', label: 'Research', Component: ResearchPanel },
  { id: 'benchmarks', label: 'Benchmarks', Component: BenchmarksPanel },
  { id: 'staff', label: 'Staff', Component: StaffPanel },
  { id: 'market', label: 'Market', Component: MarketPanel },
  { id: 'field', label: 'The field', Component: FieldPanel },
  { id: 'marketing', label: 'Marketing', Component: MarketingPanel },
  { id: 'contracts', label: 'Contracts', Component: ContractsPanel },
  { id: 'finance', label: 'Finance', Component: FinancePanel },
  { id: 'vs', label: 'Versus', Component: VsPanel },
  { id: 'achievements', label: 'Trophies', Component: AchievementsPanel },
];

/** Little dots on side-nav items that need the player's eye. */
function computeBadges(s: GameState): Partial<Record<PanelId, 'dot' | 'warn'>> {
  const out: Partial<Record<PanelId, 'dot' | 'warn'>> = {};
  if (s.models.some((m) => m.releasedDay === null)) out.models = 'dot';
  if (s.products.some((p) => p.active && p.servedFraction < 1)) out.products = 'warn';
  if (s.finance.pendingOffer) out.finance = 'warn';
  if ((s.progress?.perkPoints ?? 0) > 0) out.lab = 'dot';
  return out;
}

/** Adds the "new" dot to panels that opened and were not visited yet. A warning already on the item wins. */
function withUnseen(badges: Partial<Record<PanelId, 'dot' | 'warn'>>, unseen: PanelId[]): Partial<Record<PanelId, 'dot' | 'warn'>> {
  const out = { ...badges };
  for (const id of unseen) if (!out[id]) out[id] = 'dot';
  return out;
}

export function App() {
  const [tab, setTab] = useState<PanelId>('dashboard');
  const [helpOpen, setHelpOpen] = useState(false);
  // App does not subscribe to the whole store. It re-renders only when the match, the nav badges or the tutorial step change.
  const inMatch = useGameSelect((s) => !!s.mp);
  const badges = useGameSelect(computeBadges, sameRecord);
  const tutStep = useGameSelect((s) => s.tutorialStep);
  const mission = useMissionRun();
  const isPhone = useIsMobile();
  const lobbyOpen = useLobbyOpen();
  const mainRef = useRef<HTMLElement>(null);
  // Progressive disclosure (ui/unlocks.ts): unlock flags are written on every store change; a change re-renders the nav.
  const [, setUnlockTick] = useState(0);
  // The VS panel exists only while a multiplayer match does.

  // Switching tabs always starts at the top of the new panel. Navigating to a hidden panel opens it.
  const select = (id: PanelId) => {
    const s = getState();
    unlockPanel(s, id);
    markSeen(s, id);
    setTab(id);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  };

  // Each hub reopens on the panel last visited there.
  const lastInHub = useRef<Partial<Record<string, PanelId>>>({});
  lastInHub.current[hubOf(tab).id] = tab;
  const openHub = (hub: Hub) => {
    const live = getState();
    const visible = hub.ids.filter((id) => (id === 'vs' ? !!live.mp : isPanelVisible(live, id)));
    const last = lastInHub.current[hub.id];
    const id = last && visible.includes(last) ? last : visible[0];
    if (id) select(id);
  };

  useEffect(() => onNavigate(select), []);
  // Dev-only hook for screenshot scripts.
  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__nav = select;
  }, []);

  useEffect(() => {
    const check = () => {
      syncUnlocks(getState());
    };
    check();
    const offStore = subscribe(check);
    const offUnlocks = subscribeUnlocks(() => setUnlockTick((n) => n + 1));
    return () => {
      offStore();
      offUnlocks();
    };
  }, []);

  useEffect(() => {
    if (!inMatch && tab === 'vs') select('dashboard');
  }, [inMatch, tab]);

  // Sound unlocks on the first gesture and UI clicks get a tick. Idempotent.
  useEffect(() => initSound(), []);

  // "?" toggles the shortcuts overlay; the MENU opens it through a window event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      // Don't stack the overlay on top of another dialog (but let it close itself).
      if (!helpOpen && document.querySelector('.modal-backdrop')) return;
      e.preventDefault();
      setHelpOpen((o) => !o);
    };
    const onOpen = () => setHelpOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SHORTCUTS_EVENT, onOpen);
    };
  }, [helpOpen]);

  const Active = PANELS.find((p) => p.id === tab)!.Component;
  // Read at render: the unlock tick above re-renders this component whenever the visible set changes.
  const live = getState();
  const navItems = PANELS.filter((p) => (p.id === 'vs' ? inMatch : isPanelVisible(live, p.id))).map(({ id, label }) => ({ id, label }));
  const navBadges = withUnseen(badges, unseenPanels(live));

  const hub = hubOf(tab);
  const highlight = tutorialTarget(tutStep);

  return (
    <div class={`app hub-${hub.id}`}>
      <TopBar />
      {/* v17 Pit Wall: the hubs are the main nav bar across the top, like a team principal's menu. */}
      {!isPhone && <SideNav items={navItems} active={tab} onHub={openHub} badges={navBadges} highlight={highlight} />}
      <RunDock />
      <div class="app-body">
        <main class="app-main" ref={mainRef}>
          <HubTabs items={navItems} active={tab} onSelect={select} badges={navBadges} highlight={highlight} />
          {/* keyed so each tab change remounts the panel (resets panel-local state) */}
          <HubContext.Provider value={hub}>
            <div key={tab} class="panel-host">
              <Suspense fallback={null}>
                <Active />
              </Suspense>
            </div>
          </HubContext.Provider>
        </main>
      </div>
      <NewsTicker />
      {isPhone && <MobileNav items={navItems} active={tab} onHub={openHub} badges={navBadges} highlight={highlight} />}
      <EventModal />
      <IncidentModal />
      <EvalReveal />
      <MomentTakeover />
      <DoctrinePicker />
      <Suspense fallback={null}><NewGame /></Suspense>
      <Suspense fallback={null}><SavesSheet /></Suspense>
      {/* In a match, bankruptcy is reported by the match result modal (MpOverlays), so the single-player game-over window stays out. */}
      {!inMatch && <Suspense fallback={null}><GameOver /></Suspense>}
      <Suspense fallback={null}><EndingModal /></Suspense>
      <Suspense fallback={null}><MpOverlays /></Suspense>
      {lobbyOpen && <Suspense fallback={null}><Lobby /></Suspense>}
      <Suspense fallback={null}><AnnualReport /></Suspense>
      <Toasts />
      <NoticeLog />
      <Suspense fallback={null}><Tutorial /></Suspense>
      {mission && <Suspense fallback={null}><MissionCoach /></Suspense>}
      <FxDirector />
      <Shortcuts open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
