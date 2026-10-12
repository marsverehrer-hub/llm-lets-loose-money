// OWNER: DATAOPS. The "Get data" area inside the DAT panel (GAME_DESIGN.md §20.2 and §20.3). Eight tabs: the catalogue
// (passed in), then the seven ways to get data. Each tab opens with one plain line, shows its state as a picture (bars,
// slots, meters), keeps one primary action visible, with its settings right above it.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { dispatch } from '../store';
import { Card, FlowBar, Pill, Tabs } from '../components';
import type { PillTone, TabDef } from '../components';
import type { CrawlPolicy, DataDomain, DataJob, DatasetDef, GameState, Id } from '../../sim/types';
import { datasetById } from '../../sim/systems/data';
import { labName } from '../../sim/systems/labs';
import {
  ARCHIVE_DEFS,
  CRAWLER_TIERS,
  DATA_DOMAIN_KEYS,
  DATAOPS_TUNING,
  REFINE_LEVELS,
  archiveById,
  archiveQuote,
  archiveSetId,
  bountyQuote,
  costEra,
  crawlBlocked,
  crawlQuality,
  crawlSetId,
  crawlYieldPerDayB,
  crawlerCapex,
  crawlerTierById,
  crawlerUpkeep,
  distillQuote,
  listingFor,
  listingValue,
  refineQuote,
  saleChance,
  startupAskPrice,
  yieldEra,
} from '../../sim/systems/dataOps';
import { calendarYear, clamp, formatDate, formatMoney } from '../../sim/util';
import './dataops.css';

export type GetDataTab = 'market' | 'crawl' | 'refine' | 'bounties' | 'archives' | 'sell' | 'apis' | 'startups';

const TAB_LABELS: Record<GetDataTab, string> = {
  market: 'Market',
  crawl: 'Crawl',
  refine: 'Refine',
  bounties: 'Bounties',
  archives: 'Archives',
  sell: 'Sell',
  apis: 'Rival APIs',
  startups: 'Startups',
};
const TAB_ORDER: GetDataTab[] = ['market', 'crawl', 'refine', 'bounties', 'archives', 'sell', 'apis', 'startups'];

/** The one plain line under each tab's name. Says what the tab is for, without jargon. */
const TAB_INTRO: Record<GetDataTab, string> = {
  market: 'Buy, licence or sign sets that already exist. A rival may get there first.',
  crawl: 'A crawler reads the open web every day and banks fresh tokens, a new set each year.',
  refine: 'Clean a set you own to raise its quality. Each pass gains less than the last.',
  bounties: 'Pay strangers to submit text. You only learn its quality when it lands.',
  archives: 'Scan old libraries once. Very good data, slow to scan, sometimes legally grey.',
  sell: 'Sell a set you made to rival labs. Each one buys by chance, each week.',
  apis: 'Copy a rival model\'s answers into your data. Cheap and quick, and the lawyers notice.',
  startups: 'Buy a small data company and its token stream for two years.',
};

const BOUNTY_BUDGETS = [100_000, 500_000, 1_000_000, 2_500_000, 5_000_000];
const BOUNTY_WINDOWS = [14, 30, 45];
const LIST_MULTIPLES = [0.5, 1, 2, 3];
const DISTILL_BATCHES = [10, 50, 100, 300];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const usd = (v: number): string => formatMoney(v, 1).replace(/\.0(?=[KMBT]|$)/, '');
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const plural = (n: number, word: string): string => `${Math.max(0, Math.round(n))} ${word}${Math.round(n) === 1 ? '' : 's'}`;
const titleCase = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** Token counts. Inputs are billions. */
function tok(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0';
  const a = Math.abs(b);
  if (a >= 1000) return `${(b / 1000).toFixed(a >= 10_000 ? 0 : 1)}T`;
  if (a >= 10) return `${b.toFixed(0)}B`;
  if (a >= 1) return `${b.toFixed(1)}B`;
  return `${b.toFixed(2)}B`;
}

function riskOf(v: number): { label: string; tone: PillTone } {
  if (v >= 0.35) return { label: 'High legal risk', tone: 'bad' };
  if (v >= 0.15) return { label: 'Medium legal risk', tone: 'warn' };
  return { label: 'Low legal risk', tone: 'good' };
}

function jobTitle(s: GameState, j: DataJob): string {
  switch (j.kind) {
    case 'bounty':
      return `${titleCase(j.domain)} bounty, about ${tok(j.tokensB)} usable`;
    case 'archive':
      return `Scanning ${archiveById(j.archiveId)?.name ?? j.archiveId}`;
    case 'distill':
      return `Copying ${tok(j.tokensB)} from ${j.modelName}`;
    case 'refine':
      return `Refining ${datasetById(s, j.datasetId)?.name ?? j.datasetId} to ${pct(j.quality)}`;
  }
}

/** Why a whole tab is closed. One line, or null when it is open. The sim does not gate tabs by research, so only years lock them. */
function tabLock(s: GameState, tab: GetDataTab): string | null {
  const year = calendarYear(s.day);
  if (tab === 'startups' && year < DATAOPS_TUNING.STARTUP_FIRST_YEAR) {
    return `Opens in ${DATAOPS_TUNING.STARTUP_FIRST_YEAR}. Data startups come up for sale from then.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Kv({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) {
  const numeric = /\d/.test(v);
  return (
    <div class="do-kv">
      <span class="do-k">{k}</span>
      <span class={`do-v ${numeric ? 'num' : ''} ${tone ?? ''}`}>{v}</span>
    </div>
  );
}

/** Thin bar, flat. `value` is 0..1. */
function Bar({ value, label, tone }: { value: number; label: string; tone?: 'good' | 'bad' }) {
  const v = clamp(value, 0, 1);
  return (
    <div class="do-bar do-bar-tall" role="img" aria-label={label}>
      <span class={tone ?? ''} style={{ width: `${(v * 100).toFixed(1)}%` }} />
    </div>
  );
}

/** The primary action of a tab. When `blocked` has text, the button is disabled and the text says why. */
function Action({ label, onClick, blocked }: { label: string; onClick: () => void; blocked?: string }) {
  return (
    <div class="do-actions">
      <button type="button" class="btn btn-primary" disabled={!!blocked} onClick={onClick}>
        {label}
      </button>
      {blocked ? (
        <span class="do-blocker" role="status">
          {blocked}
        </span>
      ) : null}
    </div>
  );
}

/** A labelled knob group. */
function Knob({ label, id, children }: { label: string; id?: string; children: ComponentChildren }) {
  return (
    <div class="do-field">
      <span class="do-label" id={id}>
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Running jobs as slots: one row per production line, each either busy (a bar and the days left) or free. The
 * picture of "how full is this place" that a list of jobs does not give.
 */
function SlotBoard({ s, kinds, slots, word }: { s: GameState; kinds: DataJob['kind'][]; slots: number; word: string }) {
  const jobs = (s.dataOps?.jobs ?? []).filter((j) => kinds.includes(j.kind));
  const busy = Math.min(jobs.length, slots);
  return (
    <div class="do-slots">
      <div class="do-slots-head">
        <span class="num">
          {busy} of {slots}
        </span>
        <span class="do-note">{busy === slots ? 'Every line is busy.' : `${slots - busy} free`}</span>
      </div>
      <ul class="do-slot-list" aria-label={`${word}s`}>
        {Array.from({ length: slots }, (_, i) => {
          const j = jobs[i];
          if (!j) {
            return (
              <li class="do-slot free" key={`free-${i}`}>
                <span class="do-slot-name">{word} {i + 1}</span>
                <span class="do-note">Free</span>
              </li>
            );
          }
          const span = Math.max(1, j.doneDay - j.startDay);
          const done = clamp((s.day - j.startDay) / span, 0, 1);
          return (
            <li class="do-slot" key={j.id}>
              <div class="do-slot-main">
                <span class="do-slot-name">{jobTitle(s, j)}</span>
                <Bar value={done} label={`${Math.round(done * 100)}% done`} />
              </div>
              <div class="do-slot-side">
                <span class="num">{plural(j.doneDay - s.day, 'day')} left</span>
                <span class="do-note">Lands {formatDate(j.doneDay)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActivityCard({ s }: { s: GameState }) {
  const log = (s.dataOps?.log ?? []).slice(-8).reverse();
  return (
    <details class="do-details">
      <summary>Recent activity ({log.length})</summary>
      {log.length === 0 ? (
        <p class="do-note">Nothing yet. Deliveries, sales and bidding wars show up here.</p>
      ) : (
        <ul class="do-list">
          {log.map((e, i) => (
            <li class="do-row" key={`${e.day}-${i}`}>
              <span class="do-row-meta num">{formatDate(e.day)}</span>
              <span class="do-row-name">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

/**
 * Yield per day against the most the best rig available this year can make, aggressive crawling included. A full bar
 * is the ceiling, so a polite crawler sits at half.
 */
function CrawlGauge({ s }: { s: GameState }) {
  const year = calendarYear(s.day);
  const c = s.dataOps?.crawler ?? null;
  const online = !!c && s.day >= c.onlineDay;
  const now = crawlYieldPerDayB(s);
  const topBase = Math.max(0, ...CRAWLER_TIERS.filter((t) => year >= t.unlockYear).map((t) => t.tokensPerDayB * yieldEra(year)));
  const cap = topBase * DATAOPS_TUNING.AGGRESSIVE_YIELD_MULT;
  const blocked = crawlBlocked(s);
  return (
    <div class="do-gauge">
      <div class="do-gauge-head">
        <span class="num do-gauge-value">{online ? `${tok(now)} a day` : '0 a day'}</span>
        <span class="do-note">{cap > 0 ? `Full bar: ${tok(cap)} a day, the top rig with aggressive crawling` : 'No rig can run yet'}</span>
      </div>
      <Bar value={cap > 0 ? now / cap : 0} label={`Yield ${tok(now)} a day of ${tok(cap)} a day ceiling`} tone={blocked ? 'bad' : undefined} />
    </div>
  );
}

function CrawlTab({ s }: { s: GameState }) {
  const year = calendarYear(s.day);
  const c = s.dataOps?.crawler ?? null;
  const cur = c ? crawlerTierById(c.tier) : undefined;
  const set = s.data.custom?.find((d) => d.id === crawlSetId(year));
  const online = !!c && s.day >= c.onlineDay;
  const blocked = crawlBlocked(s);
  const cash = s.finance.cash;

  return (
    <>
      <Card
        title="Your crawler"
        subtitle={c ? (online ? 'Running' : `Racking, online in ${plural(c.onlineDay - s.day, 'day')}`) : 'Not built'}
      >
        {c && cur && <div class="do-opts">
              <div class="do-field">
                <span class="do-label" id="do-crawl-policy">
                  Crawl policy
                </span>
                <div class="do-chips" role="group" aria-labelledby="do-crawl-policy">
                  {(['polite', 'aggressive'] as CrawlPolicy[]).map((p) => (
                    <button key={p} type="button" class="do-chip" aria-pressed={c.policy === p} onClick={() => dispatch({ type: 'setCrawlerPolicy', policy: p })}>
                      {titleCase(p)}
                    </button>
                  ))}
                </div>
                <p class="do-note">
                  {c.policy === 'aggressive'
                    ? `Aggressive: double yield. Legal risk on this year's set climbs ${pct(DATAOPS_TUNING.AGGRESSIVE_LEGAL_PER_DAY)} a day, up to ${pct(DATAOPS_TUNING.AGGRESSIVE_LEGAL_CAP)}. Each day there is a ${pct(DATAOPS_TUNING.BLOCK_CHANCE_PER_DAY)} chance of a bot wall that halves yield for ${DATAOPS_TUNING.BLOCK_DAYS} days.`
                    : 'Polite: normal yield and flat legal risk. The crawler reads robots.txt, which is more than most crawlers do.'}
                </p>
              </div>
            </div>}
        {c && cur ? (
          <>
            <CrawlGauge s={s} />
            <div class="do-kvs">
              <Kv k="Tier" v={cur.name} />
              <Kv k="Policy" v={titleCase(c.policy)} />
              <Kv k="This year's set" v={tok(set?.tokensB ?? 0)} />
              <Kv k="Lifetime crawled" v={tok(s.dataOps?.crawledB ?? 0)} />
              <Kv k="Upkeep per day" v={usd(crawlerUpkeep(s, cur))} />
              <Kv k="Legal risk this year" v={pct(set?.legalRisk ?? DATAOPS_TUNING.CRAWL_LEGAL_BASE)} tone={(set?.legalRisk ?? 0) >= 0.4 ? 'bad' : undefined} />
            </div>
            {blocked && s.dataOps?.blockedUntil !== undefined ? (
              <p class="do-blocker" role="status">
                Bot wall in place until {formatDate(s.dataOps.blockedUntil)}. Yield is halved.
              </p>
            ) : null}
          </>
        ) : (
          <p class="do-note">
            No crawler yet. Starting quality is {pct(crawlQuality(s))}, lifted by deduplication and filtering research.
          </p>
        )}
      </Card>

      <Card title="Crawler tiers" subtitle="Upgrades only">
        <div class="do-grid">
          {CRAWLER_TIERS.map((t) => {
            const capex = crawlerCapex(s, t);
            const yieldDay = t.tokensPerDayB * yieldEra(year);
            const isCurrent = c?.tier === t.id;
            const locked = year < t.unlockYear;
            let blocker = '';
            if (locked) blocker = `Opens in ${t.unlockYear}.`;
            else if (cur && cur.rank >= t.rank && !isCurrent) blocker = 'You already run a bigger crawler.';
            else if (!isCurrent && cash < capex) blocker = `Needs ${usd(capex)} in cash.`;
            return (
              <div class={`do-item ${locked ? 'do-item-locked' : ''}`} key={t.id}>
                <div class="do-item-head">
                  <span class="do-row-name">{t.name}</span>
                  <Pill tone={isCurrent ? 'good' : 'default'}>{isCurrent ? 'Running' : locked ? `From ${t.unlockYear}` : 'Open'}</Pill>
                </div>
                <p class="do-note">{t.flavor}</p>
                <div class="do-kvs">
                  <Kv k="Build" v={usd(capex)} />
                  <Kv k="Upkeep per day" v={usd(crawlerUpkeep(s, t))} />
                  <Kv k="Yield per day" v={tok(yieldDay)} />
                  <Kv k="Yield per year" v={tok(yieldDay * 365)} />
                </div>
                {!isCurrent ? (
                  <Action label={c ? `Upgrade to ${t.name}` : `Order ${t.name}`} blocked={blocker} onClick={() => dispatch({ type: 'buildCrawler', tier: t.id })} />
                ) : null}
              </div>
            );
          })}
        </div>
        <p class="do-note">
          Racking takes {CRAWLER_TIERS[0].buildDays} days for {CRAWLER_TIERS[0].name}, {CRAWLER_TIERS[1].buildDays} for {CRAWLER_TIERS[1].name} and {CRAWLER_TIERS[2].buildDays} for {CRAWLER_TIERS[2].name}.
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Refine
// ---------------------------------------------------------------------------

function RefineTab({ s }: { s: GameState }) {
  const [pick, setPick] = useState<Id>('');
  const owned = s.data.owned
    .map((id) => datasetById(s, id))
    .filter((d): d is DatasetDef => d !== undefined)
    .sort((a, b) => b.tokensB - a.tokensB);
  const chosen = owned.find((d) => d.id === pick) ?? owned[0];
  const cash = s.finance.cash;

  if (!chosen) {
    return (
      <Card title="Refinery" subtitle="Dedupe, filter, clean">
        <p class="do-note">You do not own any sets to refine yet. Buy one, crawl one or digitise an archive first.</p>
      </Card>
    );
  }
  const passes = s.data.refined?.[chosen.id]?.passes ?? 0;

  return (
    <>
      <Card title="Refinery" subtitle={`${DATAOPS_TUNING.REFINE_SLOTS} lines`}>
        <SlotBoard s={s} kinds={['refine']} slots={DATAOPS_TUNING.REFINE_SLOTS} word="Line" />
      </Card>

      <Card title="Refine a set" subtitle={`Next pass gains ${pct(0.5 ** passes)} of the usual`}>
        <div class="do-field">
          <label class="do-label" for="do-refine-set">
            Set
          </label>
          <select id="do-refine-set" class="select" value={chosen.id} onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}>
            {owned.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({tok(d.tokensB)}, {pct(d.quality)})
              </option>
            ))}
          </select>
        </div>
        <div class="do-kvs">
          <Kv k="Quality" v={pct(chosen.quality)} />
          <Kv k="Tokens" v={tok(chosen.tokensB)} />
          <Kv k="Times refined" v={String(passes)} />
        </div>
        <div class="do-grid">
          {REFINE_LEVELS.map((l) => {
            const q = refineQuote(s, chosen.id, l.level);
            return (
              <div class="do-item" key={l.level}>
                <div class="do-item-head">
                  <span class="do-row-name">{l.label}</span>
                  <span class="do-row-meta num">{plural(l.days, 'day')}</span>
                </div>
                {q.ok ? (
                  <>
                    <div class="do-kvs">
                      <Kv k="Quality" v={`${pct(q.from)} to ${pct(q.quality)}`} />
                      <Kv k="Gain" v={`+${(q.gain * 100).toFixed(1)} points`} />
                      <Kv k="Tokens after" v={`${tok(q.tokensB)} (-${Math.round(l.shrink * 100)}%)`} />
                      <Kv k="Cost" v={usd(q.cost)} />
                    </div>
                    <Action
                      label={`Refine ${l.label.toLowerCase()}`}
                      blocked={cash < q.cost ? `Needs ${usd(q.cost)} in cash.` : ''}
                      onClick={() => dispatch({ type: 'refineDataset', datasetId: chosen.id, level: l.level })}
                    />
                  </>
                ) : (
                  <p class="do-blocker" role="status">
                    {q.reason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {Object.keys(s.data.refined ?? {}).length > 0 && (
        <Card title="Refined sets">
          <ul class="do-list">
            {Object.entries(s.data.refined ?? {}).map(([id, r]) => (
              <li class="do-row" key={id}>
                <div class="do-row-main">
                  <span class="do-row-name">{datasetById(s, id)?.name ?? id}</span>
                  <span class="do-row-meta">
                    {r.passes} {r.passes === 1 ? 'pass' : 'passes'}, {tok(r.tokensB)} tokens
                  </span>
                </div>
                <span class="num">{pct(r.quality)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bounties
// ---------------------------------------------------------------------------

function BountiesTab({ s }: { s: GameState }) {
  const [domain, setDomain] = useState<DataDomain>('general');
  const [budget, setBudget] = useState(1_000_000);
  const [windowDays, setWindowDays] = useState(30);
  const q = bountyQuote(s, domain, budget, windowDays);
  const blocked = !q.ok ? q.reason : s.finance.cash < budget ? `Needs ${usd(budget)} in cash.` : '';
  const spamTok = q.ok && q.spamShare < 1 ? (q.tokensB * q.spamShare) / (1 - q.spamShare) : 0;
  const usable = q.ok ? q.tokensB : 0;
  const total = usable + spamTok;

  return (
    <>
      <Card title="Community bounty" subtitle={`${usd(budget)} over ${plural(windowDays, 'day')}, ${titleCase(domain)}`}>
        <BountyKnobs domain={domain} setDomain={setDomain} budget={budget} setBudget={setBudget} windowDays={windowDays} setWindowDays={setWindowDays} />
        {q.ok && total > 0 ? (
          <div class="do-split">
            <div class="do-split-head">
              <span>
                <span class="num">{tok(usable)}</span> usable
              </span>
              <span>
                <span class="num">{tok(spamTok)}</span> spam, thrown out
              </span>
            </div>
            <FlowBar
              height={10}
              legend={false}
              format={(v) => tok(v)}
              segments={[
                { id: 'usable', label: 'Usable', value: usable, color: 'var(--up)' },
                { id: 'spam', label: 'Spam', value: spamTok, color: 'var(--bg-3)', hatched: true },
              ]}
            />
          </div>
        ) : (
          <p class="do-blocker" role="status">
            {!q.ok ? q.reason : 'Pick a budget and a window.'}
          </p>
        )}
        <p class="do-note">
          Quality is between {pct(DATAOPS_TUNING.BOUNTY_QUALITY_MIN)} and {pct(DATAOPS_TUNING.BOUNTY_QUALITY_MAX)}, and only shows when the batch lands.
          {q.ok && q.spamShare > 0 ? ` Spam is ${pct(q.spamShare)} until data filtering is researched.` : ''}
        </p>
        <Action label={`Run bounty for ${usd(budget)}`} blocked={blocked} onClick={() => dispatch({ type: 'runDataBounty', domain, budget, days: windowDays })} />
      </Card>

      <Card title="Open bounties" subtitle={`${DATAOPS_TUNING.BOUNTY_MAX_JOBS} slots`}>
        <SlotBoard s={s} kinds={['bounty']} slots={DATAOPS_TUNING.BOUNTY_MAX_JOBS} word="Slot" />
      </Card>
    </>
  );
}

/** Budget, window and domain live here. The button on the card always shows what it will spend. */
function BountyKnobs({
  domain,
  setDomain,
  budget,
  setBudget,
  windowDays,
  setWindowDays,
}: {
  domain: DataDomain;
  setDomain: (d: DataDomain) => void;
  budget: number;
  setBudget: (b: number) => void;
  windowDays: number;
  setWindowDays: (d: number) => void;
}) {
  return (
    <div class="do-opts">
      <Knob label="Domain" id="do-bounty-domain">
        <select id="do-bounty-domain" class="select" value={domain} onChange={(e) => setDomain((e.currentTarget as HTMLSelectElement).value as DataDomain)}>
          {DATA_DOMAIN_KEYS.map((d) => (
            <option key={d} value={d}>
              {titleCase(d)}
            </option>
          ))}
        </select>
      </Knob>
      <Knob label="Budget" id="do-bounty-budget">
        <div class="do-chips" role="group" aria-labelledby="do-bounty-budget">
          {BOUNTY_BUDGETS.map((b) => (
            <button key={b} type="button" class="do-chip" aria-pressed={budget === b} onClick={() => setBudget(b)}>
              {usd(b)}
            </button>
          ))}
        </div>
      </Knob>
      <Knob label="Window" id="do-bounty-window">
        <div class="do-chips" role="group" aria-labelledby="do-bounty-window">
          {BOUNTY_WINDOWS.map((d) => (
            <button key={d} type="button" class="do-chip" aria-pressed={windowDays === d} onClick={() => setWindowDays(d)}>
              {plural(d, 'day')}
            </button>
          ))}
        </div>
      </Knob>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

function ArchivesTab({ s }: { s: GameState }) {
  const year = calendarYear(s.day);
  return (
    <>
      <Card title="Archives" subtitle="Very good data, slow to scan">
        <div class="do-grid">
          {ARCHIVE_DEFS.map((def) => {
            const digitised = !!s.data.custom?.some((c) => c.id === archiveSetId(def.id));
            const running = (s.dataOps?.jobs ?? []).find((j) => j.kind === 'archive' && j.archiveId === def.id);
            const q = archiveQuote(s, def.id);
            const cost = def.cost * costEra(year);
            const risk = riskOf(def.legalRisk);
            return (
              <div class="do-item" key={def.id}>
                <div class="do-item-head">
                  <span class="do-row-name">{def.name}</span>
                  <Pill tone={risk.tone}>{risk.label}</Pill>
                </div>
                <p class="do-note">{def.flavor}</p>
                <div class="do-kvs">
                  <Kv k="Tokens" v={tok(def.tokensB)} />
                  <Kv k="Cost" v={usd(cost)} />
                  <Kv k="Days to scan" v={String(def.days)} />
                  <Kv k="Quality" v={pct(DATAOPS_TUNING.ARCHIVE_QUALITY)} />
                </div>
                {digitised ? (
                  <Pill tone="good">Digitised</Pill>
                ) : running ? (
                  <Bar value={1 - (running.doneDay - s.day) / Math.max(1, running.doneDay - running.startDay)} label="Scan progress" />
                ) : (
                  <Action
                    label="Digitise"
                    blocked={!q.ok ? q.reason : s.finance.cash < cost ? `Needs ${usd(cost)} in cash.` : ''}
                    onClick={() => dispatch({ type: 'digitizeArchive', archiveId: def.id })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Scanning now" subtitle={`${DATAOPS_TUNING.ARCHIVE_MAX_JOBS} rigs`}>
        <SlotBoard s={s} kinds={['archive']} slots={DATAOPS_TUNING.ARCHIVE_MAX_JOBS} word="Rig" />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sell (marketplace)
// ---------------------------------------------------------------------------

function SellTab({ s }: { s: GameState }) {
  const [pick, setPick] = useState<Id>('');
  const [multiple, setMultiple] = useState(1);
  const [exclusive, setExclusive] = useState(false);
  const sets = (s.data.custom ?? []).filter((c) => s.data.owned.includes(c.id) && !listingFor(s, c.id));
  const chosen = sets.find((c) => c.id === pick) ?? sets[0];
  const rivals = s.competitors.filter((c) => c.active && !c.human);
  const listings = s.dataOps?.listings ?? [];
  const value = chosen ? listingValue(s, chosen) : 0;
  const price = value * multiple;
  const chance = saleChance(value, price, exclusive);
  const blocked = !chosen ? 'Nothing to sell yet. Crawl, commission or digitise a set first.' : value <= 0 ? 'That set has no tokens yet.' : '';

  return (
    <>
      <Card
        title="List a set"
        subtitle="Only sets you made yourself"
      >
        {chosen && <div class="do-opts">
              <Knob label="Set" id="do-sell-set">
                <select id="do-sell-set" class="select" value={chosen.id} onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}>
                  {sets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({tok(d.tokensB)})
                    </option>
                  ))}
                </select>
              </Knob>
              <Knob label="Price, as a multiple of value" id="do-sell-price">
                <div class="do-chips" role="group" aria-labelledby="do-sell-price">
                  {LIST_MULTIPLES.map((m) => (
                    <button key={m} type="button" class="do-chip" aria-pressed={multiple === m} onClick={() => setMultiple(m)}>
                      {m}x
                    </button>
                  ))}
                </div>
              </Knob>
              <label class="do-check">
                <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive((e.currentTarget as HTMLInputElement).checked)} />
                <span>Exclusive: one buyer, who pays {DATAOPS_TUNING.EXCLUSIVE_MULT}x the price. Odds per week are halved.</span>
              </label>
            </div>}
        {chosen ? (
          <>
            <div class="do-kvs">
              <Kv k="Set" v={chosen.name} />
              <Kv k="Estimated value" v={usd(value)} />
              <Kv k="Price" v={exclusive ? `${usd(price)}, exclusive` : usd(price)} />
              <Kv k="Odds per lab per week" v={pct(chance)} />
            </div>
            {chosen.source === 'userdata' ? (
              <p class="do-blocker" role="status">
                Selling your users&apos; chats starts a privacy scandal. Each sale adds privacy heat and costs reputation.
              </p>
            ) : null}
            <Action label={`List at ${usd(price)}`} blocked={blocked} onClick={() => dispatch({ type: 'listDataset', datasetId: chosen.id, price, exclusive })} />
          </>
        ) : (
          <p class="do-note">{blocked}</p>
        )}
      </Card>

      <Card title="On the market" subtitle={`${usd(s.dataOps?.soldTotal ?? 0)} sold so far`}>
        {listings.length === 0 ? (
          <p class="do-note">Nothing listed. Rivals buy by chance each week, at the price you name.</p>
        ) : (
          <ul class="do-list" aria-label="Listings">
            {listings.map((l) => {
              const name = datasetById(s, l.datasetId)?.name ?? l.datasetId;
              const share = rivals.length > 0 ? l.buyers.length / rivals.length : 0;
              return (
                <li class="do-row" key={`${l.datasetId}-${l.listedDay}`}>
                  <div class="do-row-main">
                    <span class="do-row-name">{name}</span>
                    <span class="do-row-meta">
                      {usd(l.price)}
                      {l.exclusive ? ', exclusive' : ''}
                    </span>
                    {l.closed ? (
                      <span class="do-row-meta">Sold exclusively for {usd(l.revenue)}</span>
                    ) : (
                      <>
                        <Bar value={share} label={`${l.buyers.length} of ${rivals.length} labs bought`} />
                        <span class="do-row-meta">
                          {l.buyers.length} of {rivals.length} labs bought, {usd(l.revenue)} so far
                        </span>
                      </>
                    )}
                  </div>
                  {!l.closed ? (
                    <button type="button" class="btn" onClick={() => dispatch({ type: 'unlistDataset', datasetId: l.datasetId })}>
                      Unlist
                    </button>
                  ) : (
                    <Pill tone="info">Closed</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rival APIs
// ---------------------------------------------------------------------------

/** Strikes so far in the current cycle, as boxes. The last box is the lawsuit: every third strike goes to court. */
function StrikeMeter({ strikes }: { strikes: number }) {
  const per = DATAOPS_TUNING.TOS_LAWSUIT_EVERY;
  const inCycle = strikes % per;
  return (
    <div class="do-strikes" role="img" aria-label={`${inCycle} of ${per} strikes before a lawsuit`}>
      {Array.from({ length: per }, (_, i) => (
        <span key={i} class={`do-strike ${i < inCycle ? 'on' : ''} ${i === per - 1 ? 'court' : ''}`}>
          {i === per - 1 ? 'Court' : `Strike ${i + 1}`}
        </span>
      ))}
    </div>
  );
}

function ApisTab({ s }: { s: GameState }) {
  const [labId, setLabId] = useState<Id>('');
  const [batch, setBatch] = useState(50);
  const rivals = s.competitors.filter((c) => c.active && !c.human && c.model);
  const chosen = rivals.find((c) => c.id === labId) ?? rivals[0];
  const q = chosen ? distillQuote(s, chosen.id, batch) : undefined;
  const o = s.dataOps;
  const strikes = s.flags.tosStrikes ?? 0;
  const exposure = o?.tosExposure ?? 0;
  const weekly = Math.min(DATAOPS_TUNING.TOS_CHANCE_CAP, DATAOPS_TUNING.TOS_CHANCE_PER_ORDER * exposure);
  const bannedFor = (o?.distillBannedUntil ?? 0) - s.day;

  return (
    <>
      <Card title="Terms of service" subtitle="Every order is noticed">
        <p class="do-note">
          Each strike costs {Math.abs(DATAOPS_TUNING.TOS_STRIKE_REP)} reputation. The third goes to court.
        </p>
        <StrikeMeter strikes={strikes} />
        <div class="do-kvs">
          <Kv k="Orders since last letter" v={String(exposure)} />
          <Kv k="Letter odds this week" v={pct(weekly)} tone={weekly >= 0.2 ? 'bad' : undefined} />
          <Kv k="Distilling" v={bannedFor > 0 ? `Banned for ${plural(bannedFor, 'day')}` : 'Allowed'} tone={bannedFor > 0 ? 'bad' : undefined} />
        </div>
        <Bar value={weekly / DATAOPS_TUNING.TOS_CHANCE_CAP} label={`Letter odds this week ${pct(weekly)}`} tone={weekly >= 0.2 ? 'bad' : undefined} />
        {o?.tosPending ? (
          <p class="do-blocker" role="status">
            A cease and desist letter is waiting for an answer.
          </p>
        ) : null}
      </Card>

      <Card
        title="Copy a rival"
        subtitle="Their outputs, your training run"
      >
        {rivals.length > 0 && <div class="do-opts">
              <Knob label="Batch" id="do-api-batch">
                <div class="do-chips" role="group" aria-labelledby="do-api-batch">
                  {DISTILL_BATCHES.map((b) => (
                    <button key={b} type="button" class="do-chip" aria-pressed={batch === b} onClick={() => setBatch(b)}>
                      {b}B tokens
                    </button>
                  ))}
                </div>
              </Knob>
            </div>}
        {rivals.length === 0 ? (
          <p class="do-note">No rival has a released model to copy yet.</p>
        ) : (
          <>
            <Knob label="Lab" id="do-api-lab">
              <div class="do-chips" role="group" aria-labelledby="do-api-lab">
                {rivals.map((c) => (
                  <button key={c.id} type="button" class="do-chip" aria-pressed={chosen?.id === c.id} onClick={() => setLabId(c.id)}>
                    {labName(s, c.id)}, {c.model ? Math.round(c.model.overall) : 0}
                  </button>
                ))}
              </div>
            </Knob>
            {q && q.ok ? (
              <>
                <div class="do-kvs">
                  <Kv k="Model" v={q.modelName} />
                  <Kv k="Batch" v={`${batch}B tokens`} />
                  <Kv k="Copy quality" v={pct(q.quality)} />
                  <Kv k="Batch cost" v={usd(q.cost)} />
                  <Kv k="Delivered in" v={plural(q.days, 'day')} />
                  <Kv k="Collapse risk" v={pct(q.collapseRisk)} tone={q.collapseRisk >= 0.5 ? 'bad' : undefined} />
                </div>
                <Action
                  label={`Copy ${batch}B tokens from ${q.labName}`}
                  blocked={s.finance.cash < q.cost ? `Needs ${usd(q.cost)} in cash.` : ''}
                  onClick={() => dispatch({ type: 'distillRivalApi', labId: q.labId, tokensB: batch })}
                />
              </>
            ) : (
              <p class="do-blocker" role="status">
                {q && !q.ok ? q.reason : 'Pick a lab.'}
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="Copying now" subtitle={`${DATAOPS_TUNING.DISTILL_MAX_JOBS} jobs`}>
        <SlotBoard s={s} kinds={['distill']} slots={DATAOPS_TUNING.DISTILL_MAX_JOBS} word="Job" />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Startups
// ---------------------------------------------------------------------------

function StartupsTab({ s }: { s: GameState }) {
  const offer = s.dataOps?.startup ?? null;
  const streams = (s.dataOps?.streams ?? []).filter((st) => st.endDay > s.day);
  const ask = offer ? startupAskPrice(offer) : 0;
  const next = s.dataOps?.nextStartupDay ?? 0;

  return (
    <>
      <Card title="For sale" subtitle="Data startups, one at a time">
        {offer ? (
          <>
            <div class="do-item-head">
              <span class="do-row-name">{offer.name}</span>
              <Pill tone={offer.war ? 'bad' : 'info'}>{offer.war ? 'Bidding war' : 'For sale'}</Pill>
            </div>
            <div class="do-kvs">
              <Kv k="Domain" v={titleCase(offer.domain)} />
              <Kv k="Tokens per day" v={tok(offer.tokensPerDayB)} />
              <Kv k="Quality" v={pct(offer.quality)} />
              <Kv k="Price" v={offer.war ? `${usd(ask)} to outbid` : usd(offer.price)} />
            </div>
            <p class="do-note">
              Offer ends in {plural(offer.expiresDay - s.day, 'day')}. Buying hires {DATAOPS_TUNING.STARTUP_ENGINEERS} engineers and streams its tokens for two years.
            </p>
            {offer.war && offer.warDeadline !== null ? (
              <p class="do-blocker" role="status">
                {offer.rivalId ? labName(s, offer.rivalId) : 'A rival'} is bidding. Answer within {plural(offer.warDeadline - s.day, 'day')}, or they take it.
              </p>
            ) : null}
            <Action label={offer.war ? `Outbid for ${usd(ask)}` : `Buy for ${usd(ask)}`} blocked={s.finance.cash < ask ? `Needs ${usd(ask)} in cash.` : ''} onClick={() => dispatch({ type: 'buyDataStartup', startupId: offer.id })} />
          </>
        ) : (
          <p class="do-note">Nothing for sale right now. The next one is expected around {formatDate(Math.max(next, s.day))}.</p>
        )}
      </Card>

      <Card title="Streams running" subtitle={streams.length ? `${streams.length} feeding in` : 'None yet'}>
        {streams.length === 0 ? (
          <p class="do-note">No startup streams yet. A bought startup feeds its tokens in every day.</p>
        ) : (
          <ul class="do-list">
            {streams.map((st) => {
              const left = Math.max(0, st.endDay - s.day);
              return (
                <li class="do-row" key={st.id}>
                  <div class="do-row-main">
                    <span class="do-row-name">{st.name}</span>
                    <span class="do-row-meta">
                      {titleCase(st.domain)}, {tok(st.tokensPerDayB)} a day, {plural(left, 'day')} left
                    </span>
                    <Bar value={left / DATAOPS_TUNING.STARTUP_STREAM_DAYS} label={`${plural(left, 'day')} left of two years`} />
                  </div>
                  <span class="num">{tok(s.data.custom?.find((c) => c.id === st.datasetId)?.tokensB ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Market tab uses the catalogue passed in. Running-job counts sit on the tabs.
// ---------------------------------------------------------------------------

/** Running jobs per tab, shown as a count on the tab. */
function tabCount(s: GameState, tab: GetDataTab): number | undefined {
  const jobs = s.dataOps?.jobs ?? [];
  const n = (kinds: DataJob['kind'][]) => jobs.filter((j) => kinds.includes(j.kind)).length;
  let count = 0;
  switch (tab) {
    case 'refine':
      count = n(['refine']);
      break;
    case 'bounties':
      count = n(['bounty']);
      break;
    case 'archives':
      count = n(['archive']);
      break;
    case 'apis':
      count = n(['distill']);
      break;
    case 'sell':
      count = (s.dataOps?.listings ?? []).filter((l) => !l.closed).length;
      break;
    case 'startups':
      count = (s.dataOps?.streams ?? []).filter((st) => st.endDay > s.day).length;
      break;
    default:
      return undefined;
  }
  return count > 0 ? count : undefined;
}

export function GetDataArea({ s, market }: { s: GameState; market: ComponentChildren }) {
  const [tab, setTab] = useState<GetDataTab>('market');
  const tabs: TabDef<GetDataTab>[] = TAB_ORDER.map((id) => ({ id, label: TAB_LABELS[id], count: tabCount(s, id) }));
  const lock = tabLock(s, tab);

  let body: ComponentChildren;
  if (lock) {
    body = null;
  } else {
    switch (tab) {
      case 'market':
        body = market;
        break;
      case 'crawl':
        body = <CrawlTab s={s} />;
        break;
      case 'refine':
        body = <RefineTab s={s} />;
        break;
      case 'bounties':
        body = <BountiesTab s={s} />;
        break;
      case 'archives':
        body = <ArchivesTab s={s} />;
        break;
      case 'sell':
        body = <SellTab s={s} />;
        break;
      case 'apis':
        body = <ApisTab s={s} />;
        break;
      case 'startups':
        body = <StartupsTab s={s} />;
        break;
    }
  }

  return (
    <section class="do-area" aria-label="Get data">
      <header class="do-head">
        <span class="do-head-title">Get data</span>
        <span class="do-head-sub">Eight ways in</span>
      </header>
      <Tabs tabs={tabs} value={tab} onChange={setTab} class="do-tabs" />
      <div class="do-body">
        <p class={`do-intro ${lock ? 'do-lock' : ''}`} role={lock ? 'status' : undefined}>
          {lock ?? TAB_INTRO[tab]}
        </p>
        {body}
        {!lock && tab !== 'market' ? <ActivityCard s={s} /> : null}
      </div>
    </section>
  );
}
