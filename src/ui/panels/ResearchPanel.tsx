// Research panel (v10 clarity pass, GAME_DESIGN 21.2): a timeline first, branch progress, the tree or list, and a short
// detail pane. Search, the ready/done filter and branch chips sit right above the list. Styles in research.css (rs- prefix). Tokens only.
import { useState } from 'preact/hooks';
import { dispatch, useGame } from '../store';
import { RESEARCH, trackStepOf } from '../../sim/data/research';
import { RESEARCH_BRANCHES } from '../../sim/types';
import type { Id, ResearchBranch, ResearchNode } from '../../sim/types';
import { RESEARCH_TUNING, backlogCap } from '../../sim/systems/research';
import { Card, Check, PanelHeader, PanelIntro, ProgressBar, Sheet, Tabs, useIsMobile } from '../components';
import type { TabDef } from '../components';
import { Banner, fmtPct } from './panelKit';
import { ViewFold } from './ViewFold';
import { ResearchQueueStrip, queuePositions } from './ResearchQueue';
import { Timeline } from './research/Timeline';
import { NodeDetail } from './research/Detail';
import { ResearchTree } from './research/Tree';
import { ResearchList } from './research/List';
import { ReadyCards } from './research/ReadyCards';
import { BRANCH_LABEL, BranchTab, NODE_BY_ID, NODES_BY_YEAR, branchOf, buildView, jokeName, topicName } from './research/model';
import { AdoptingStrip, RecommendedCard, TrackCards } from './research/Tracks';
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
/** The three parts of the screen: what to research next, the whole tree, and the year grid. */
type MainTab = 'tracks' | 'browse' | 'timeline';
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
  const [tab, setTab] = useState<MainTab>('tracks');

  const selected: ResearchNode | null = (picked ? NODE_BY_ID.get(picked) : undefined) ?? v.current ?? v.nextNode ?? null;

  // Idle: nothing running and nothing queued. The lab banks part of its output for the next topic, up to the cap.
  const idle = !v.current && (s.research.queue ?? []).length === 0;
  const cap = backlogCap(s);
  const banked = Math.min(cap, s.research.banked ?? 0);
  const idleText =
    v.perDay <= 0
      ? 'You have no researchers. Hire some in Staff to start research.'
      : v.rec
        ? `Your researchers are idle. Start ${v.rec.label} below${s.research.autoPick === false ? ', or turn on auto-pick' : ''}.`
        : `Nothing can start yet. Banking ${Math.round(RESEARCH_TUNING.BACKLOG_RATE * 100)}% of research into the backlog for the next topic.`;

  if (RESEARCH.length === 0) {
    return (
      <div class="panel rs">
        <PanelHeader title="Research" subtitle="The tree is still being drawn up." />
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
    if (!isPhone) setTab('browse'); // the details pane lives under Browse all
    if (branch !== 'all' && branchOf(n) !== branch) chooseBranch(branchOf(n));
  };
  /** Pick a node; a phone also opens its details sheet. */
  const pick = (n: ResearchNode) => {
    setPicked(n.id);
  };
  const open = (n: ResearchNode) => {
    setPicked(n.id);
    if (isPhone) setSheetOpen(true);
    else setTab('browse');
  };
  /** From the top cards: select the topic, then bring its details into view (the sheet on a phone). */
  const showTopic = (n: ResearchNode) => {
    jump(n.id);
    if (isPhone) setSheetOpen(true);
    else requestAnimationFrame(() => document.querySelector('.rs-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
      <PanelHeader title="Research" subtitle="Follow a track, or take the recommended topic. Switching keeps your progress." />
      <PanelIntro id="research">
        Five tracks lead to the things a small lab needs: a chat product, bigger models, paying developers, images and video, cheaper serving. Old ideas get
        cheaper as papers spread, and a published paper can be adopted for cash while your own researchers work on something else.
      </PanelIntro>

      {idle && (
        <Banner tone="warn">
          <div>{idleText}</div>
          {cap > 0 && (
            <ProgressBar
              value={banked}
              max={cap}
              height={6}
              label="Banked for the next topic"
              right={fmtPct(banked / cap)}
            />
          )}
        </Banner>
      )}

      {(v.current || (s.research.queue ?? []).length > 0) && <ResearchQueueStrip perDay={v.perDay} />}

      <ViewFold panel="research" defaultOpen={false}>
        <SceneView
          state={s}
          make={createLab}
          cam={LAB_CAM}
          camId="CAM-10"
          label="The research lab: one desk pod per branch, whiteboards fill as you finish topics, the projector shows what is being researched"
          onSelect={(hit) => {
            if (hit.id.startsWith('branch:')) {
              setQuery('');
              setTab('browse');
              chooseBranch(hit.id.slice(7) as BranchTab);
              requestAnimationFrame(() => document.querySelector('.rs-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            } else if (hit.id === 'current' && v.current) jump(v.current.id);
          }}
        />
      </ViewFold>

      <Tabs<MainTab>
        class="rs-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'tracks', label: 'Tracks' },
          { id: 'browse', label: 'Browse all' },
          { id: 'timeline', label: 'Timeline' },
        ]}
      />

      {tab === 'tracks' && (
        <>
          <Check checked={s.research.autoPick !== false} onChange={(on) => dispatch({ type: 'setResearchAutoPick', on })} label="Auto-pick next topic when idle" class="rs-autopick" />
          <AdoptingStrip s={s} onShow={showTopic} />

          <RecommendedCard s={s} view={v} onShow={showTopic} />
          <TrackCards s={s} view={v} onShow={showTopic} />

          <details class="disclosure rs-more-upgrades">
            <summary>
              More upgrades · {RESEARCH.filter((n) => !trackStepOf(n.id) && v.stateOf(n) === 'available').length} can start
            </summary>
            <ReadyCards view={v} onShow={showTopic} filter={(n) => !trackStepOf(n.id)} />
          </details>
        </>
      )}

      {tab === 'browse' && (
        <>
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
        </>
      )}

      {tab === 'timeline' && (
        <>
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
        </>
      )}

      {isPhone && (
        <Sheet
          open={sheetOpen && selected !== null}
          title={selected ? topicName(selected) : 'Research'}
          subtitle={selected ? [jokeName(selected), BRANCH_LABEL[branchOf(selected)]].filter(Boolean).join(' · ') : undefined}
          onClose={() => setSheetOpen(false)}
        >
          {selected && <NodeDetail s={s} view={v} node={selected} onPick={jump} onStop={stopResearch} />}
        </Sheet>
      )}
    </div>
  );
}
