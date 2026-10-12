// Research panel (v10 clarity pass, GAME_DESIGN 21.2): a timeline first, branch progress, the tree or list, and a short
// detail pane. Search, the ready/done filter and branch chips sit right above the list. Styles in research.css (rs- prefix). Tokens only.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../store';
import { RESEARCH } from '../../sim/data/research';
import { RESEARCH_BRANCHES } from '../../sim/types';
import type { Id, ResearchBranch, ResearchNode } from '../../sim/types';
import { Card, PanelHeader, PanelIntro, Sheet, Tabs, useIsMobile } from '../components';
import type { TabDef } from '../components';
import { fmtCount, fmtPct } from './panelKit';
import { ResearchQueueStrip, queuePositions } from './ResearchQueue';
import { Timeline } from './research/Timeline';
import { NodeDetail } from './research/Detail';
import { ResearchTree } from './research/Tree';
import { ResearchList } from './research/List';
import { ReadyCards } from './research/ReadyCards';
import { BRANCH_LABEL, BranchTab, NODE_BY_ID, NODES_BY_YEAR, branchOf, buildView } from './research/model';
import './research.css';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createLab, CAM as LAB_CAM } from '../../scenes/research';

// ---------------------------------------------------------------- branch memory

const BRANCH_KEY = 'llm-lets-loose-money/research-branch';

function readBranch(): BranchTab | null {
  try {
    const v = globalThis.localStorage?.getItem(BRANCH_KEY);
    if (v === 'all' || (v && (RESEARCH_BRANCHES as string[]).includes(v))) return v as BranchTab;
  } catch {
    /* storage blocked: fall through to the default */
  }
  return null;
}

function writeBranch(v: BranchTab): void {
  try {
    globalThis.localStorage?.setItem(BRANCH_KEY, v);
  } catch {
    /* storage blocked: the choice simply is not remembered */
  }
}

type ViewMode = 'tree' | 'list';
const STATE_ORDER = { active: 0, available: 1, early: 2, locked: 3, done: 4 } as const;
/** Which nodes the list shows. */
type Show = 'all' | 'ready' | 'done';

// ---------------------------------------------------------------- panel

export function ResearchPanel() {
  const s = useGame();
  const v = buildView(s);
  const isPhone = useIsMobile();
  const [branch, setBranch] = useState<BranchTab>(
    () => readBranch() ?? (v.current ? branchOf(v.current) : v.nextNode ? branchOf(v.nextNode) : RESEARCH_BRANCHES[0]),
  );
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [picked, setPicked] = useState<Id | null>(null);
  const [mode, setMode] = useState<ViewMode>(isPhone ? 'list' : 'tree');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [yearSel, setYearSel] = useState<number>(v.year);

  const selected: ResearchNode | null = (picked ? NODE_BY_ID.get(picked) : undefined) ?? v.current ?? v.nextNode ?? null;

  if (RESEARCH.length === 0) {
    return (
      <div class="panel rs">
        <PanelHeader code="RES" title="Research" subtitle="The tree is still being drawn up." />
      </div>
    );
  }

  const chooseBranch = (b: BranchTab) => {
    setBranch(b);
    writeBranch(b);
  };
  /** Select a node from anywhere (timeline, details links, next up). Switches branch and clears the search so it shows. */
  const jump = (id: Id) => {
    const n = NODE_BY_ID.get(id);
    if (!n) return;
    setPicked(id);
    setQuery('');
    if (branch !== 'all' && branchOf(n) !== branch) chooseBranch(branchOf(n));
  };
  /** Pick a node; a phone also opens its details sheet. */
  const pick = (n: ResearchNode) => {
    setPicked(n.id);
  };
  const open = (n: ResearchNode) => {
    setPicked(n.id);
    if (isPhone) setSheetOpen(true);
  };
  const start = (n: ResearchNode) => {
    if (v.stateOf(n) === 'available') dispatch({ type: 'setResearch', nodeId: n.id });
  };
  /** Stop the current topic by hand; a queue that would start the next topic at once is paused. */
  const stopResearch = () => {
    dispatch({ type: 'setResearch', nodeId: null });
    if ((s.research.queue ?? []).length > 0) dispatch({ type: 'setResearchQueuePaused', paused: true });
  };

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const treeBranch: ResearchBranch | null = branch === 'all' ? null : branch;
  const filtering = searching || show !== 'all';
  const useTree = treeBranch !== null && mode === 'tree' && !filtering;
  const showOk = (n: ResearchNode) => {
    const st = v.stateOf(n);
    return show === 'all' || (show === 'done' ? st === 'done' : st === 'available' || st === 'active');
  };
  // A search looks through every branch so nothing is hidden by the branch you happen to be on.
  const scope = treeBranch && !searching ? RESEARCH.filter((n) => branchOf(n) === treeBranch) : RESEARCH;
  const bIdx = (n: ResearchNode) => RESEARCH_BRANCHES.indexOf(branchOf(n));
  const rows = useTree
    ? []
    : scope
        .filter((n) => {
          const hay = `${n.name} ${n.description} ${n.effectText ?? ''} ${BRANCH_LABEL[branchOf(n)]}`.toLowerCase();
          return terms.every((t) => hay.includes(t)) && showOk(n);
        })
        // Things you can act on first: researching, can start, opens soon, needs something, done last.
        .sort((a, b) => STATE_ORDER[v.stateOf(a)] - STATE_ORDER[v.stateOf(b)] || v.costOf(a) - v.costOf(b) || bIdx(a) - bIdx(b));
  const queuePos = queuePositions(s.research.queue);
  const stat = v.stats.get(branch)!;
  const selectedId = selected?.id ?? null;

  const viewTabs: TabDef<ViewMode>[] = [
    { id: 'tree', label: 'Tree', disabled: !treeBranch || filtering },
    { id: 'list', label: 'List' },
  ];

  const showTabs: TabDef<Show>[] = [
    { id: 'all', label: 'All' },
    { id: 'ready', label: 'Can start' },
    { id: 'done', label: 'Done' },
  ];
  const branchChips: { id: BranchTab; label: string; pct: number }[] = [
    { id: 'all', label: 'All', pct: v.stats.get('all')!.done / v.stats.get('all')!.total },
    ...RESEARCH_BRANCHES.map((b) => {
      const st = v.stats.get(b)!;
      return { id: b as BranchTab, label: BRANCH_LABEL[b], pct: st.total ? st.done / st.total : 0 };
    }),
  ];

  return (
    <div class="panel rs">
      <PanelHeader code="RES" title="Research" subtitle="Pick a topic and press Start. Queued topics start one after another." />
      <PanelIntro
        id="research"
        steps={[
          'Pick a card under "Ready to research" and press Start.',
          'Press Queue on more topics: they start one after another, so your researchers never sit idle.',
          'Looking for something specific? Type it into the search under "Browse all research". Locked topics show what they need first.',
        ]}
      >
        Research unlocks new techniques, model sizes and products. Old ideas get cheaper every year as papers spread.
      </PanelIntro>

      <SceneView
        state={s}
        make={createLab}
        cam={LAB_CAM}
        camId="CAM-10"
        label="The research lab: one desk pod per branch, whiteboards fill as you finish topics, the projector shows what is being researched"
        onSelect={(hit) => {
          if (hit.id.startsWith('branch:')) {
            setQuery('');
            chooseBranch(hit.id.slice(7) as BranchTab);
            document.querySelector('.rs-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else if (hit.id === 'current' && v.current) jump(v.current.id);
        }}
      />

      {!v.current && (s.research.queue ?? []).length === 0 && (
        <div class="rs-idle" role="alert">
          {v.perDay > 0
            ? 'Your researchers are idle. Start a topic below.'
            : 'You have no researchers. Hire some in Staff to start research.'}
        </div>
      )}

      <ResearchQueueStrip perDay={v.perDay} />

      <Card
        class="rs-ready-card-wrap"
        title="Ready to research"
        subtitle={`${fmtCount(v.perDay)} research points a day${v.behind > 0 ? ` · ${v.behind} year${v.behind === 1 ? '' : 's'} behind the field` : ' · up to date'}`}
      >
        <ReadyCards view={v} onShow={(n) => jump(n.id)} />
      </Card>

      <h2 class="rs-section">Browse all research</h2>
      <div class="rs-toolbar" role="search">
        <input
          type="search"
          class="rs-search"
          value={query}
          placeholder="Find research: name, effect or description"
          aria-label="Search research"
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
        />
        <Tabs tabs={showTabs} value={show} onChange={setShow} variant="segmented" class="rs-show" />
      </div>
      <div class="rs-chips" role="tablist" aria-label="Branches">
        {branchChips.map((c) => (
          <button
            type="button"
            key={c.id}
            role="tab"
            aria-selected={branch === c.id && !searching}
            class={`rs-chip-btn${branch === c.id && !searching ? ' on' : ''}`}
            onClick={() => {
              setQuery('');
              chooseBranch(c.id);
            }}
          >
            <span class="rs-chip-name">{c.label}</span>
            <span class="rs-chip-pct num">{fmtPct(c.pct)}</span>
            <span class="rs-chip-bar" style={{ width: `${Math.round(c.pct * 100)}%` }} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div class="rs-body">
        <Card
          flush
          class="rs-card rs-main"
          title={searching ? 'Search results' : treeBranch ? BRANCH_LABEL[treeBranch] : 'All branches'}
          subtitle={
            searching
              ? `${rows.length} matching "${query.trim()}" in every branch`
              : show !== 'all'
                ? `${rows.length} ${show === 'done' ? 'done' : 'you can start now'}`
              : treeBranch
                ? `${fmtPct(stat.total ? stat.done / stat.total : 0)} done`
                : `${fmtPct(v.stats.get('all')!.done / v.stats.get('all')!.total)} done overall`
          }
          actions={
            <>
              <Tabs tabs={viewTabs} value={useTree ? 'tree' : 'list'} onChange={setMode} variant="segmented" class="rs-view" />
            </>
          }
        >
          {useTree && treeBranch ? (
            <ResearchTree
              key={treeBranch}
              branch={treeBranch}
              view={v}
              selected={selected}
              isPhone={isPhone}
              queuePos={queuePos}
              onPick={pick}
              onStart={start}
              onOpen={open}
            />
          ) : (
            <ResearchList
              rows={rows}
              view={v}
              selected={selectedId}
              isPhone={isPhone}
              showBranch={treeBranch === null || searching}
              onPick={pick}
              onStart={start}
              onOpen={open}
              emptyText={searching ? 'No matches. Try fewer words.' : show === 'ready' ? 'Nothing to start here. Try another branch or All.' : 'Nothing here yet.'}
            />
          )}
        </Card>

        {!isPhone && (
          <aside class="rs-side">
            <Card title="Details" class="rs-card rs-detail-card">
              {selected ? (
                <NodeDetail s={s} view={v} node={selected} onPick={jump} onStop={stopResearch} />
              ) : (
                <div class="rs-empty">Select a node to see what it does and what it costs.</div>
              )}
            </Card>
          </aside>
        )}
      </div>

      <Card class="rs-timeline" title="Timeline" subtitle="One cell per idea, by year it came out">
        <Timeline view={v} selected={selectedId} yearSel={yearSel} onPick={open} onYear={setYearSel} />
      </Card>

      {isPhone && (
        <Card flush class="rs-year-card" title={`Ideas from ${yearSel}`}>
          <ResearchList
            rows={NODES_BY_YEAR.get(yearSel) ?? []}
            view={v}
            selected={selectedId}
            isPhone
            showBranch
            onPick={pick}
            onStart={start}
            onOpen={open}
            emptyText={`No ideas came out in ${yearSel}.`}
          />
        </Card>
      )}

      {isPhone && (
        <Sheet
          open={sheetOpen && selected !== null}
          title={selected?.name ?? 'Research'}
          subtitle={selected ? BRANCH_LABEL[branchOf(selected)] : undefined}
          onClose={() => setSheetOpen(false)}
        >
          {selected && <NodeDetail s={s} view={v} node={selected} onPick={jump} onStop={stopResearch} />}
        </Sheet>
      )}
    </div>
  );
}
