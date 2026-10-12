// OWNER: UI polish agent (shell + juice). Panel ids/paths are fixed so the panels drop in.
import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar } from './shell/TopBar';
import { SideNav } from './shell/SideNav';
import { NewsTicker } from './shell/NewsTicker';
import { EventModal } from './shell/EventModal';
import { IncidentModal } from './shell/IncidentModal';
import { EvalReveal } from './shell/EvalReveal';
import { MomentTakeover } from './shell/MomentTakeover';
import { GameOver } from './shell/GameOver';
import { Toasts } from './shell/Toasts';
import { NoticeLog } from './shell/NoticeLog';
import { DoctrinePicker } from './shell/DoctrinePicker';
import { NewGame } from './shell/NewGame'; // v9 scenario: new-game setup screen
import { SavesSheet } from './shell/SavesSheet'; // saves: every game in its own slot
import { Shortcuts, SHORTCUTS_EVENT } from './shell/Shortcuts';
import { DashboardPanel } from './panels/DashboardPanel';
import { ModelsPanel } from './panels/ModelsPanel';
import { ProductsPanel } from './panels/ProductsPanel';
import { ComputePanel } from './panels/ComputePanel';
import { DataPanel } from './panels/DataPanel';
import { ResearchPanel } from './panels/ResearchPanel';
import { BenchmarksPanel } from './panels/BenchmarksPanel';
import { StaffPanel } from './panels/StaffPanel';
import { MarketPanel } from './panels/MarketPanel';
import { MarketingPanel } from './panels/MarketingPanel';
import { FinancePanel } from './panels/FinancePanel';
import { AchievementsPanel } from './panels/AchievementsPanel';
import { ContractsPanel } from './panels/ContractsPanel';
import { VsPanel } from './mp/VsPanel';
import { Lobby } from './mp/Lobby';
import { MpOverlays } from './mp/MpOverlays';
import { useLobbyOpen } from './mp/lobbyState';
import { Tutorial, tutorialTarget } from './tutorial/Tutorial';
import { FxDirector } from './fx/Director';
import { initSound } from './fx/sound';
import { onNavigate } from './nav';
import { getState, subscribe, useGameSelect, sameRecord } from './store';
import { isPanelVisible, markSeen, subscribeUnlocks, syncUnlocks, unlockPanel, unseenPanels } from './unlocks';
import { useIsMobile } from './components';
import { MobileNav } from './shell/MobileNav';
import { applyTheme, readTheme } from './shell/theme';
import type { GameState } from '../sim/types';
import './shell/shell.css';
import './components/viz.css';
import './tutorial/tutorial.css';
import './fx/fx.css';
import './mp/mp.css';

// Saved theme applies before the first render (index.html also sets it before paint).
applyTheme(readTheme());

export type PanelId = 'dashboard' | 'models' | 'products' | 'compute' | 'data' | 'research' | 'benchmarks' | 'staff' | 'market' | 'contracts' | 'finance' | 'vs' | 'achievements' | 'marketing';

export const PANELS: { id: PanelId; label: string; code: string; Component: () => any }[] = [
  { id: 'dashboard', label: 'Headquarters', code: 'HQ', Component: DashboardPanel },
  { id: 'models', label: 'Models', code: 'MDL', Component: ModelsPanel },
  { id: 'products', label: 'Products', code: 'PRD', Component: ProductsPanel },
  { id: 'compute', label: 'Compute', code: 'CMP', Component: ComputePanel },
  { id: 'data', label: 'Data', code: 'DAT', Component: DataPanel },
  { id: 'research', label: 'Research', code: 'RES', Component: ResearchPanel },
  { id: 'benchmarks', label: 'Benchmarks', code: 'BMK', Component: BenchmarksPanel },
  { id: 'staff', label: 'Staff', code: 'STF', Component: StaffPanel },
  { id: 'market', label: 'Market', code: 'MKT', Component: MarketPanel },
  { id: 'marketing', label: 'Marketing', code: 'MKG', Component: MarketingPanel },
  { id: 'contracts', label: 'Contracts', code: 'CON', Component: ContractsPanel },
  { id: 'finance', label: 'Finance', code: 'FIN', Component: FinancePanel },
  { id: 'vs', label: 'Versus', code: 'VS', Component: VsPanel },
  { id: 'achievements', label: 'Trophies', code: 'TRO', Component: AchievementsPanel },
];

/** Little dots on side-nav items that need the player's eye. */
function computeBadges(s: GameState): Partial<Record<PanelId, 'dot' | 'warn'>> {
  const out: Partial<Record<PanelId, 'dot' | 'warn'>> = {};
  if (s.models.some((m) => m.releasedDay === null)) out.models = 'dot';
  if (s.products.some((p) => p.active && p.servedFraction < 1)) out.products = 'warn';
  if (s.finance.pendingOffer) out.finance = 'warn';
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

  useEffect(() => onNavigate(select), []);

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
  const navItems = PANELS.filter((p) => (p.id === 'vs' ? inMatch : isPanelVisible(live, p.id))).map(({ id, label, code }) => ({ id, label, code }));
  const navBadges = withUnseen(badges, unseenPanels(live));

  return (
    <div class="app">
      <TopBar />
      <div class="app-body">
        {!isPhone && <SideNav items={navItems} active={tab} onSelect={select} badges={navBadges} highlight={tutorialTarget(tutStep)} />}
        <main class="app-main" ref={mainRef}>
          {/* keyed so each tab change remounts the panel (resets panel-local state) */}
          <div key={tab} class="panel-host">
            <Active />
          </div>
        </main>
      </div>
      <NewsTicker />
      {isPhone && <MobileNav items={navItems} active={tab} onSelect={select} badges={navBadges} highlight={tutorialTarget(tutStep)} />}
      <EventModal />
      <IncidentModal />
      <EvalReveal />
      <MomentTakeover />
      <DoctrinePicker />
      <NewGame />
      <SavesSheet />
      {/* In a match, bankruptcy is reported by the match result modal (MpOverlays), so the single-player game-over window stays out. */}
      {!inMatch && <GameOver />}
      <MpOverlays />
      {lobbyOpen && <Lobby />}
      <Toasts />
      <NoticeLog />
      <Tutorial />
      <FxDirector />
      <Shortcuts open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
