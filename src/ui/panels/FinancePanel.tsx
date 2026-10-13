import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { BALANCE } from '../../sim/balance';
import { SECONDARY_TUNING, canIpo, canSecondary, computeValuation, maxLoan, runwayDays } from '../../sim/systems/finance';
import type { FinanceSample, GameState } from '../../sim/types';
import { dayToDate, formatMoney } from '../../sim/util';
import { Button, Card, Donut, EmptyState, HelpTip, LineChart, Modal, PanelHeader, PanelIntro, Pill, ProgressBar, SERIES, Slider, Stat, Tabs, Waterfall, clamp, formatDays, formatPct, signedMoney } from '../components';
import type { LineSeries, WaterfallStep } from '../components';
import { liveHistory } from '../components/derive';
import { dispatch, useGame } from '../store';
import './panels-a.css';
import './finance.css';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createTreasury, CAM as TREASURY_CAM } from '../../scenes/finance';

type Metric = 'cash' | 'valuation' | 'flow';

const METRIC_TITLE_FIN: Record<Metric, string> = { cash: 'Cash', flow: 'Revenue vs burn', valuation: 'Valuation' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 MAR 2019" from a day number. */
function dateTag(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Revenue lines, in the order the waterfall shows them. The sim books revenue by buyer kind. */
const REV_ORDER = ['api', 'chat', 'enterprise', 'other'] as const;
const REV_LABEL: Record<string, string> = { api: 'API', chat: 'Chat', enterprise: 'Enterprise', other: 'Other' };
const REV_COLOR: Record<string, string> = { api: SERIES.amber, chat: SERIES.blue, enterprise: SERIES.fg, other: SERIES.dim };

const EXP_LABEL: Record<string, string> = {
  compute: 'Rent',
  office: 'Rent',
  power: 'Power',
  hardware: 'Hardware ops',
  serving: 'Serving (cloud)',
  payroll: 'Payroll',
  data: 'Data',
  research: 'Research',
  marketing: 'Marketing',
  interest: 'Interest',
  capex: 'Capex',
  events: 'Events',
  legal: 'Legal',
  contracts: 'Contracts',
  staff: 'Staff',
  other: 'Other',
};
const EXP_COLOR: Record<string, string> = {
  compute: SERIES.amber,
  payroll: SERIES.fg,
  power: SERIES.blue,
  hardware: SERIES.down,
  serving: SERIES.yellow,
  marketing: SERIES.up,
  research: SERIES.yellow,
  data: SERIES.down,
  office: SERIES.dim,
  interest: SERIES.dim,
  capex: SERIES.dim,
  events: SERIES.dim,
  legal: SERIES.dim,
  contracts: SERIES.dim,
  staff: SERIES.dim,
  other: SERIES.dim,
};

/**
 * The waterfall's cost lines. Each group takes the sim's expense keys; keys that are not in a group fall into Other.
 * Rent is the GPUs you pay for plus the office lease. Serving (cloud) is the burst capacity that serves products.
 */
const COST_GROUPS: { id: string; label: string; help: ComponentChildren; keys: string[] }[] = [
  { id: 'rent', label: 'Rent', help: 'GPUs you pay for in your datacenters, plus the office lease.', keys: ['compute', 'office'] },
  { id: 'power', label: 'Power and hardware', help: 'Electricity and cooling for your datacenters, building upkeep, and the maintenance, networking and spares every owned GPU needs.', keys: ['power', 'hardware'] },
  {
    id: 'serving',
    label: 'Serving (cloud)',
    help: 'Cloud GPUs that serve your products when your own GPUs are busy training. Zero while your own GPUs cover serving.',
    keys: ['serving'],
  },
  { id: 'payroll', label: 'Payroll', help: 'Salaries and recruiting fees.', keys: ['payroll'] },
];
const GROUPED_KEYS = new Set(COST_GROUPS.flatMap((g) => g.keys));

/** Expense label with a HelpTip, used wherever an expense key is named. */
function expenseName(key: string, help?: ComponentChildren): ComponentChildren {
  const label = EXP_LABEL[key] ?? key;
  if (!help) return label;
  return (
    <>
      {label}
      <HelpTip>{help}</HelpTip>
    </>
  );
}

/** Share count from millions, e.g. 1000 -> "1,000M". */
function shareCount(millions: number): string {
  return `${Math.round(millions).toLocaleString('en-US')}M`;
}

/** Ticker symbol from the company name, e.g. "Garage Labs" -> "GRGL". */
function tickerOf(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length === 0) return 'LLM';
  if (letters.length <= 4) return letters;
  const consonants = letters.replace(/[AEIOU]/g, '');
  return (consonants.length >= 3 ? consonants : letters).slice(0, 4);
}

/**
 * Share prices seen on earlier days, so the stock card can show a daily move even when
 * the weekly history has no sample from yesterday. UI-only; reset when the game changes.
 */
const priceMemo: { seed: number; prices: Map<number, number> } = { seed: -1, prices: new Map() };

/** Move since the most recent earlier day with a price (null if there is none yet). */
function dailyMove(s: GameState, hist: FinanceSample[]): { pct: number; days: number } | null {
  const now = s.company.stockPrice;
  if (!(now > 0)) return null;
  if (priceMemo.seed !== s.seed) {
    priceMemo.seed = s.seed;
    priceMemo.prices.clear();
  }
  priceMemo.prices.set(s.day, now);
  if (priceMemo.prices.size > 90) {
    const oldest = Math.min(...Array.from(priceMemo.prices.keys()));
    priceMemo.prices.delete(oldest);
  }
  let ref: { day: number; price: number } | null = null;
  for (const [day, price] of priceMemo.prices) {
    if (day < s.day && price > 0 && (!ref || day > ref.day)) ref = { day, price };
  }
  for (const h of hist) {
    if (h.day < s.day && h.stockPrice > 0 && (!ref || h.day > ref.day)) ref = { day: h.day, price: h.stockPrice };
  }
  if (!ref) return null;
  return { pct: now / ref.price - 1, days: s.day - ref.day };
}

/** One key/value row. Tone colours the value. */
function Kv({ k, v, tone }: { k: string; v: any; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div class="kv-row">
      <span class="kv-k">{k}</span>
      <span class={`kv-v num ${tone ?? ''}`}>{v}</span>
    </div>
  );
}

/** Ticker-style card shown once the company is public, in place of the funding card. */
function StockCard({ s, hist }: { s: GameState; hist: FinanceSample[] }) {
  const price = s.company.stockPrice;
  const sharesM = s.company.sharesOutstanding;
  const cap = price * sharesM * 1e6;
  const founder = clamp(s.company.founderEquity, 0, 1);
  const move = dailyMove(s, hist);
  const ticker = tickerOf(s.company.name);
  const points = hist.filter((h) => h.stockPrice > 0).map((h) => ({ x: h.day, y: h.stockPrice }));
  return (
    <Card title="Stock" code={ticker} subtitle={move ? `${move.days <= 1 ? 'Today' : `Over ${move.days} days`}` : 'No earlier price yet'}>
      <div class="stack">
        <div class="pa-stock-head">
          <span class="pa-stock-px num" aria-label={`Share price ${price.toFixed(2)} dollars`}>
            ${price.toFixed(2)}
          </span>
          {move ? (
            <span class={`pa-stock-chg num ${move.pct >= 0 ? 'good' : 'bad'}`}>
              {move.pct >= 0 ? '▲' : '▼'} {formatPct(Math.abs(move.pct), 2)}
            </span>
          ) : (
            <span class="pa-stock-chg faint">—</span>
          )}
        </div>
        <div class="pa-kv kv">
          <Kv k="Shares" v={shareCount(sharesM)} />
          <Kv k="Market cap" v={formatMoney(cap, 1)} />
          <Kv k="Your stake" v={formatMoney(cap * founder, 1)} />
        </div>
        <LineChart
          series={[{ name: 'Share price', color: SERIES.amber, points }]}
          height={200}
          yFormat={(v) => `$${v.toFixed(2)}`}
          emptyText="No trades yet. First price lands with the next weekly sample."
        />
      </div>
    </Card>
  );
}

/**
 * Day of each funding round from the news log. The sim keeps round names in order, not their days, so a round whose
 * news has scrolled out of the log shows no date.
 */
function roundDay(s: GameState, round: string): number | null {
  const want = round === 'IPO' ? 'lists on the exchange' : `in a ${round} led by`;
  for (let i = s.news.length - 1; i >= 0; i--) {
    if (s.news[i].text.includes(want)) return s.news[i].day;
  }
  return null;
}

/** Funding rounds as a timeline, oldest first. A round with no date left in the news log shows a dash. */
function RoundsTimeline({ s }: { s: GameState }) {
  const rounds = s.finance.roundsRaised;
  if (rounds.length === 0) {
    return <div class="small muted">No rounds yet.</div>;
  }
  return (
    <ol class="fin-tl" aria-label="Funding rounds">
      {rounds.map((r, i) => {
        const nth = rounds.slice(0, i).filter((y) => y === r).length;
        const logged = (s.finance.roundLog ?? []).filter((x) => x.name === r)[nth];
        const day = logged?.day ?? roundDay(s, r);
        return (
          <li key={`${r}-${i}`} class={`fin-tl-node ${r === 'IPO' ? 'ipo' : ''}`} title={logged ? `${formatMoney(logged.amount)} raised at ${formatMoney(logged.postMoney)} post-money` : undefined}>
            <span class="fin-tl-dot" aria-hidden="true" />
            <span class="fin-tl-name">{r}</span>
            <span class="fin-tl-date num">{day !== null ? dateTag(day) : '—'}</span>
            {logged && <span class="fin-tl-date num">{formatMoney(logged.amount)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The day's books as plain tables, behind "Details". */
function BooksTables({ s }: { s: GameState }) {
  const fin = s.finance;
  const revRows = Object.keys(fin.revenueBreakdown)
    .map((k) => ({ key: k, label: REV_LABEL[k] ?? k, value: fin.revenueBreakdown[k] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const expRows = Object.keys(fin.expenseBreakdown)
    .map((k) => ({ key: k, label: EXP_LABEL[k] ?? k, value: fin.expenseBreakdown[k] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const revTotal = revRows.reduce((a, r) => a + r.value, 0);
  const expTotal = expRows.reduce((a, r) => a + r.value, 0);
  return (
    <div class="pa-two">
      <div class="stack">
        <div class="pa-lbl">Revenue by source</div>
        {revRows.length === 0 ? (
          <div class="small muted">No revenue booked today.</div>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th class="num">Per day</th>
                  <th class="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {revRows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <span class="swatch" style={{ '--c': REV_COLOR[r.key] ?? SERIES.dim } as any} /> {r.label}
                    </td>
                    <td class="num">{formatMoney(r.value, 1)}</td>
                    <td class="num">{formatPct(revTotal > 0 ? r.value / revTotal : 0, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div class="stack">
        <div class="pa-lbl">Expenses by category</div>
        {expRows.length === 0 ? (
          <div class="small muted">No expenses booked today.</div>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="num">Per day</th>
                  <th class="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {expRows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <span class="swatch" style={{ '--c': EXP_COLOR[r.key] ?? SERIES.dim } as any} />{' '}
                      {r.key === 'serving' ? expenseName(r.key, COST_GROUPS[2].help) : r.label}
                    </td>
                    <td class="num">{formatMoney(r.value, 1)}</td>
                    <td class="num">{formatPct(expTotal > 0 ? r.value / expTotal : 0, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Revenue to profit for one day: each revenue line up to a revenue subtotal, then each cost group down to the profit.
 * Costs are negative steps. The profit is the running total, so it matches revenue minus every expense.
 */
function dailyWaterfall(s: GameState): { steps: WaterfallStep[]; profit: number } {
  const fin = s.finance;
  const steps: WaterfallStep[] = [];
  for (const k of REV_ORDER) {
    const v = fin.revenueBreakdown[k] ?? 0;
    steps.push({ id: `rev-${k}`, label: REV_LABEL[k], value: v, detail: `${REV_LABEL[k]} revenue today` });
  }
  steps.push({ id: 'revenue', label: 'Revenue', value: 0, kind: 'subtotal' });
  for (const g of COST_GROUPS) {
    const v = g.keys.reduce((a, k) => a + (fin.expenseBreakdown[k] ?? 0), 0);
    steps.push({ id: `cost-${g.id}`, label: expenseName(g.keys[0], g.help), value: -v, detail: g.help });
  }
  const other = Object.keys(fin.expenseBreakdown)
    .filter((k) => !GROUPED_KEYS.has(k))
    .reduce((a, k) => a + (fin.expenseBreakdown[k] ?? 0), 0);
  steps.push({ id: 'cost-other', label: 'Other', value: -other, detail: 'Data, research, marketing, legal, interest, capex and events.' });
  const revenue = REV_ORDER.reduce((a, k) => a + (fin.revenueBreakdown[k] ?? 0), 0);
  const costs = COST_GROUPS.reduce((a, g) => a + g.keys.reduce((b, k) => b + (fin.expenseBreakdown[k] ?? 0), 0), 0) + other;
  return { steps, profit: revenue - costs };
}

/** Money, funding, ownership, loans and the IPO. */
export function FinancePanel() {
  const s: GameState = useGame();
  const [metric, setMetric] = useState<Metric>('cash');
  const [loanAmt, setLoanAmt] = useState(1_000_000);
  const [confirmIpo, setConfirmIpo] = useState(false);
  const [showBooks, setShowBooks] = useState(false);

  const fin = s.finance;
  const hist = liveHistory(s);
  const money = (v: number) => formatMoney(v, 1);
  const runway = runwayDays(s);
  const maxL = Math.max(0, maxLoan(s));
  const ipo = canIpo(s);
  const sec = canSecondary(s);
  const annualRevenue = fin.dailyRevenue * 365;
  const offer = fin.pendingOffer;
  const founder = clamp(s.company.founderEquity, 0, 1);
  const amt = clamp(loanAmt, 0, maxL);
  const sliderMax = Math.max(maxL, 1);
  const net = fin.dailyRevenue - fin.dailyExpenses;
  const runwayTone = !isFinite(runway) ? 'good' : runway < 180 ? 'bad' : runway < 540 ? 'warn' : 'good';
  const circling = fin.nextOfferDay <= s.day;
  const valuationLabel = s.company.isPublic ? 'Market cap' : 'Valuation';
  const wf = dailyWaterfall(s);

  const tabs: { id: Metric; label: string }[] = [
    { id: 'cash', label: 'Cash' },
    { id: 'flow', label: 'Rev vs burn' },
    { id: 'valuation', label: s.company.isPublic ? 'Mkt cap' : 'Valuation' },
  ];

  const pts = (pick: (h: FinanceSample) => number) => hist.map((h) => ({ x: h.day, y: pick(h) }));
  const series: LineSeries[] =
    metric === 'cash'
      ? [{ name: 'Cash', color: SERIES.amber, points: pts((h) => h.cash) }]
      : metric === 'valuation'
        ? [{ name: valuationLabel, color: SERIES.amber, points: pts((h) => h.valuation) }]
        : [
            { name: 'Revenue / day', color: SERIES.amber, points: pts((h) => h.revenue) },
            { name: 'Expenses / day', color: SERIES.fg, points: pts((h) => h.expenses) },
          ];

  const postMoney = offer ? offer.preMoney + offer.amount : 0;
  const dilution = offer && postMoney > 0 ? offer.amount / postMoney : 0;
  const founderAfter = offer && postMoney > 0 ? founder * (offer.preMoney / postMoney) : founder;

  const accept = () => dispatch({ type: 'acceptOffer' });
  const decline = () => dispatch({ type: 'declineOffer' });

  const fundingCard = (
    <Card
      title={offer ? `${offer.roundName} term sheet` : 'Funding'}
      subtitle={offer ? `From ${offer.investor}` : circling ? 'Investors circling' : `Next check-in ~${dateTag(fin.nextOfferDay)}`}
      glow={!!offer}
      actions={offer && <Pill tone="warn">Expires {formatDays(offer.expiresDay - s.day)}</Pill>}
    >
      {offer ? (
        <div class="stack">
          <div class="pa-kv kv">
            <Kv k="Amount" v={formatMoney(offer.amount, 2)} />
            <Kv k="Pre-money" v={money(offer.preMoney)} />
            <Kv k="Post-money" v={money(postMoney)} />
            <Kv k="Dilution" v={formatPct(dilution, 1)} tone="bad" />
            <Kv k="Founder equity" v={`${formatPct(founder, 1)} → ${formatPct(founderAfter, 1)}`} />
            <Kv k="Expires" v={dateTag(offer.expiresDay)} />
          </div>
          <div class="row-wrap">
            <Button variant="primary" title="Take the cash and the dilution" onClick={accept}>
              Accept
            </Button>
            <Button title="Keep your equity and see who calls next" onClick={decline}>
              Decline
            </Button>
          </div>
        </div>
      ) : (
        <EmptyState title={circling ? 'Investors circling' : 'No term sheets'} text="Investors call when runway shrinks or growth gets loud." />
      )}
    </Card>
  );

  return (
    <div class="panel fin-panel">
      <PanelHeader code="FIN" title="Finance" subtitle={`${s.company.isPublic ? 'Public' : 'Private'} · ${dateTag(s.day)}`} />
      <PanelIntro id="finance">Where the money comes from and goes. Cash and runway tell you how long you can keep going.</PanelIntro>
      <SceneView
        state={s}
        make={createTreasury}
        cam={TREASURY_CAM}
        camId="CAM-09"
        label="The treasury: your cash in the vault, money flowing in and out by category, investors at the table and the stock board"
      />

      <Card flush>
        <div class="pa-strip pa-strip--5">
          <div class="pa-cell">
            <Stat label={valuationLabel} value={fin.valuation} format={money} hint={s.company.isPublic ? 'Price × shares' : `Model estimate ${money(computeValuation(s))}`} />
          </div>
          <div class="pa-cell">
            <Stat
              label="Cash"
              value={fin.cash}
              format={money}
              tone={fin.cash < 0 ? 'bad' : 'default'}
              deltaText={`${signedMoney(net)}/d`}
              delta={net}
            />
          </div>
          <div class="pa-cell">
            <Stat
              label="Runway"
              value={isFinite(runway) ? formatDays(runway) : 'Profit'}
              tone={runwayTone}
              hint={fin.negativeCashDays > 0 ? `${fin.negativeCashDays} day(s) in the red` : 'At current burn'}
            />
          </div>
          <div class="pa-cell">
            <Stat label="Raised" value={fin.totalRaised} format={money} hint={`${fin.roundsRaised.length} round${fin.roundsRaised.length === 1 ? '' : 's'}`} />
          </div>
          <div class="pa-cell">
            <Stat label="Debt" value={fin.debt} format={money} hint={`${formatPct(fin.loanRatePerYear)} a year`} />
          </div>
        </div>
      </Card>

      <div class="grid-split fin-row-funding">
        {s.company.isPublic ? <StockCard s={s} hist={hist} /> : fundingCard}

        <Card title="Ownership">
          <div class="stack">
            <Donut
              items={[
                { label: 'Founders', value: founder, color: SERIES.amber },
                { label: 'Investors & staff', value: 1 - founder, color: SERIES.fg },
              ]}
              centerValue={formatPct(founder, 1)}
              centerLabel="Founders"
            />
            <div class="pa-kv kv">
              <Kv k="Your stake" v={money(fin.valuation * founder)} />
            </div>
          </div>
        </Card>
      </div>

      <div class="grid-split fin-row-chart">
        <Card
          title={METRIC_TITLE_FIN[metric]}
          subtitle="Weekly samples, hover or tap"
          actions={<Tabs<Metric> variant="segmented" value={metric} onChange={setMetric} tabs={tabs} />}
        >
          <LineChart series={series} height={270} yFormat={money} emptyText="Not enough history. First point lands after a week." />
        </Card>

        <div class="stack">
          <Card title="Loans" subtitle={`Up to ${money(maxL)} at ${formatPct(fin.loanRatePerYear, 0)} a year`}>
            <div class="stack">
              <div class="pa-kv kv">
                <Kv k="Outstanding" v={money(fin.debt)} />
                <Kv k="Amount" v={money(amt)} />
              </div>
              <Slider
                label="Loan amount"
                min={0}
                max={sliderMax}
                step={Math.max(1000, Math.round(sliderMax / 200))}
                value={amt}
                disabled={maxL <= 0}
                onChange={setLoanAmt}
              />
              <div class="row-wrap">
                <Button
                  variant="primary"
                  disabled={amt <= 0 || amt > maxL}
                  title={maxL <= 0 ? 'Banks want revenue before they lend' : amt <= 0 ? 'Pick an amount first' : `Borrow ${money(amt)}`}
                  onClick={() => dispatch({ type: 'takeLoan', amount: amt })}
                >
                  Borrow
                </Button>
                <Button
                  disabled={fin.debt <= 0 || amt <= 0}
                  title={fin.debt <= 0 ? 'No debt to repay' : amt <= 0 ? 'Pick an amount first' : `Repay ${money(Math.min(amt, fin.debt))}`}
                  onClick={() => dispatch({ type: 'repayLoan', amount: Math.min(amt, fin.debt) })}
                >
                  Repay
                </Button>
              </div>
              {maxL <= 0 && <div class="pa-note">Banks want revenue before they lend. Sell something first.</div>}
            </div>
          </Card>

          <Card
            title={s.company.isPublic ? 'Investor relations' : 'Go public'}
            glow={!s.company.isPublic && ipo.ok}
            subtitle={s.company.isPublic ? 'Shareholders watching' : 'Listing thresholds'}
          >
            {s.company.isPublic ? (
              <div class="stack">
                <div class="pa-kv kv">
                  <Kv k="Founder stake" v={`${(founder * 100).toFixed(1)}%`} />
                  <Kv k="Public float" v={`${((1 - founder) * 100).toFixed(1)}%`} />
                </div>
                <Button
                  size="sm"
                  block
                  disabled={!sec.ok}
                  title={sec.ok ? `Sell ${(SECONDARY_TUNING.SHARE_FRACTION * 100).toFixed(0)}% new shares` : sec.reason}
                  onClick={() => dispatch({ type: 'secondaryOffering' })}
                >
                  Secondary offering
                </Button>
                <div class="small muted">
                  Sells {(SECONDARY_TUNING.SHARE_FRACTION * 100).toFixed(0)}% new shares at a {(SECONDARY_TUNING.PRICE_DISCOUNT * 100).toFixed(0)}% discount.
                </div>
                {!sec.ok && <div class="small muted">{sec.reason}</div>}
              </div>
            ) : (
              <div class="stack">
                <ProgressBar
                  label="Valuation"
                  value={fin.valuation}
                  max={BALANCE.IPO_MIN_VALUATION}
                  tone={fin.valuation >= BALANCE.IPO_MIN_VALUATION ? 'good' : 'accent'}
                  right={`${money(fin.valuation)} / ${money(BALANCE.IPO_MIN_VALUATION)}`}
                />
                <ProgressBar
                  label="Annual revenue"
                  value={annualRevenue}
                  max={BALANCE.IPO_MIN_ANNUAL_REVENUE}
                  tone={annualRevenue >= BALANCE.IPO_MIN_ANNUAL_REVENUE ? 'good' : 'accent'}
                  right={`${money(annualRevenue)} / ${money(BALANCE.IPO_MIN_ANNUAL_REVENUE)}`}
                />
                <div class={`small ${ipo.ok ? 'good' : 'muted'}`}>{ipo.ok ? 'Ready. Roadshow can be booked.' : ipo.reason}</div>
                <Button variant="primary" block disabled={!ipo.ok} title={ipo.ok ? 'Ring the IPO bell' : ipo.reason} onClick={() => setConfirmIpo(true)}>
                  Ring the bell
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card class="fin-rounds-card" title="Funding rounds" subtitle={`${fin.roundsRaised.length} closed`}>
        <RoundsTimeline s={s} />
      </Card>

      <Card
        class="fin-books-card"
        title="Revenue to profit"
        subtitle="Per day"
        actions={
          <button type="button" class="btn btn-sm btn-ghost" aria-expanded={showBooks} onClick={() => setShowBooks(!showBooks)}>
            {showBooks ? 'Hide details' : 'Details'}
          </button>
        }
      >
        <div class="stack">
          <Waterfall steps={wf.steps} end={{ label: 'Profit per day' }} format={money} />
          {showBooks && <BooksTables s={s} />}
        </div>
      </Card>

      <Modal
        open={confirmIpo}
        title="Ring the IPO bell?"
        subtitle="Shares trade daily. Quarterly earnings calls start immediately."
        onClose={() => setConfirmIpo(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmIpo(false)}>
              Not yet
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                dispatch({ type: 'ipo' });
                setConfirmIpo(false);
              }}
            >
              Go public
            </Button>
          </>
        }
      >
        <p class="small muted">Raises roughly 15% of your valuation. You stop being able to call it a garage startup.</p>
      </Modal>
    </div>
  );
}
