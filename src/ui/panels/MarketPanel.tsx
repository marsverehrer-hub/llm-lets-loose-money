// OWNER: v10 MARKETING agent (GAME_DESIGN §21.5). Market: who holds what share, by segment, buyer tier and lab.
// Campaigns live on the Marketing screen now.
import { useState } from 'preact/hooks';
import { COMPETITORS } from '../../sim/data/competitors';
import { bestPlayerModel, primaryProduct, segmentShares, tierBreakdown } from '../../sim/systems/market';
import { provisionalElo } from '../../sim/systems/lab';
import { arenaLeaderboard } from '../../sim/systems/competitors';
import type { ArenaRow } from '../../sim/systems/competitors';
import { labInfo } from '../../sim/systems/labs';
import { MP_RIVAL_ID } from '../../sim/types';
import type { BuyerTier, GameState, Segment } from '../../sim/types';
import { formatNumber } from '../../sim/util';
import { BarList, Card, EmptyState, HelpTip, Meter, PanelHeader, PanelIntro, Stat, Tooltip, clamp, formatInt, formatPct, hypeLabel, monthYear } from '../components';
import type { BarRow } from '../components';
import { useGame } from '../store';
import { SEGMENT_NAME } from './marketing/campaignCopy';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createTown, CAM as TOWN_CAM } from '../../scenes/market';
import './panels-a.css';
import './nt-tiers.css';

const TIER_LABEL: Record<BuyerTier, string> = { premium: 'Premium', mainstream: 'Mainstream', budget: 'Budget' };
const TIER_SUB: Record<BuyerTier, string> = { premium: 'Wants the best', mainstream: 'Balanced', budget: 'Cheapest that works' };
const TIERS: BuyerTier[] = ['premium', 'mainstream', 'budget'];

const SEGMENTS: { id: Segment; code: string; unit: string }[] = [
  { id: 'consumer', code: 'CHAT', unit: '/mo' },
  { id: 'developer', code: 'API', unit: '/Mtok' },
  { id: 'enterprise', code: 'ENT', unit: '/seat/mo' },
];

/** The id a row uses for "you", in both the share bars and the arena, so one selection highlights both. */
const ME = 'me';

function priceLabel(v: number): string {
  if (!isFinite(v)) return '—';
  return `$${v < 10 ? v.toFixed(2) : v.toFixed(0)}`;
}

/** The human rival joins the arena board when the sim's arena helper does not list it. */
function arenaWithRival(s: GameState, rows: ArenaRow[]): ArenaRow[] {
  const rival = s.mp?.rival;
  if (!s.mp || !rival?.model || rows.some((r) => r.id === MP_RIVAL_ID)) return rows;
  const info = labInfo(s, MP_RIVAL_ID);
  const row: ArenaRow = {
    id: MP_RIVAL_ID,
    name: info?.name ?? rival.companyName,
    modelName: rival.model.name,
    elo: rival.model.elo,
    overall: rival.model.overall,
    color: info?.color ?? rival.color,
    isPlayer: false,
  };
  return [...rows, row].sort((a, b) => b.elo - a.elo);
}

interface ShareItem {
  id: string;
  label: string;
  color: string;
  /** Share of users in the segment, 0..1. */
  value: number;
}

/**
 * You are drawn in the text colour, not amber: lab colours are data, and one of them (OpenAye) is amber-yellow.
 * Your rows are labelled with the company name, because the share rows are named after your products.
 */
const ME_COLOR = 'var(--fg)';

/** Each lab's share of the segment's users (you included), largest first. */
function shareItems(s: GameState, seg: Segment): ShareItem[] {
  const rows = segmentShares(s, seg);
  const totalUsers = rows.reduce((a, r) => a + Math.max(0, r.users), 0);
  // The player can appear once per product: merge those rows into one "you" slice so keys stay unique.
  const byId = new Map<string, ShareItem>();
  for (const r of rows) {
    const id = r.isPlayer ? ME : r.id;
    const value = totalUsers > 0 ? Math.max(0, r.users) / totalUsers : Math.max(0, r.share);
    const prev = byId.get(id);
    if (prev) prev.value += value;
    else byId.set(id, { id, label: r.isPlayer ? `${s.company.name} (you)` : r.name, color: r.isPlayer ? ME_COLOR : r.color, value });
  }
  return [...byId.values()].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
}

export function MarketPanel() {
  const s: GameState = useGame();
  const [sel, setSel] = useState<string | null>(null);
  const toggle = (id: string) => setSel((cur) => (cur === id ? null : id));
  const hype = clamp(s.market.aiHype, 0, 100);
  const arena = arenaWithRival(s, arenaLeaderboard(s));
  const playerRank = arena.findIndex((r) => r.isPlayer);
  const playerUsers = SEGMENTS.reduce((a, seg) => a + (s.market.segments[seg.id]?.playerUsers ?? 0), 0);
  // The public sees the player's provisional Elo for a few weeks after release. Rivals show their settled Elo.
  const playerBest = bestPlayerModel(s);
  const playerProv = playerBest ? provisionalElo(s, playerBest) : null;
  const playerElo = playerProv?.elo ?? arena.find((r) => r.isPlayer)?.elo;
  // Several lines can run per kind. The board shows the primary (most-used) API line.
  const playerApi = primaryProduct(s, 'api')?.price;

  const segItems = SEGMENTS.map((seg) => ({ seg, items: shareItems(s, seg.id) }));
  const selected = sel ? segItems.flatMap((x) => x.items).find((i) => i.id === sel) : undefined;

  // Arena bars start at a round number below the lowest Elo, so gaps between labs show.
  const lowElo = arena.length > 0 ? Math.min(...arena.map((r) => r.elo)) : 0;
  const base = Math.max(0, Math.floor((lowElo - 100) / 100) * 100);
  const arenaRows: BarRow[] = arena.map((r) => {
    const info = labInfo(s, r.id);
    const elo = r.isPlayer && playerProv ? playerProv.elo : r.elo;
    const st = s.competitors.find((c) => c.id === r.id);
    const api = r.isPlayer ? playerApi : st?.prices.api;
    const d = r.isPlayer || playerElo === undefined ? null : Math.round(r.elo - playerElo);
    const id = r.isPlayer ? ME : r.id;
    return {
      id,
      label: r.name,
      sub: [r.modelName, info?.human ? 'human' : null, api !== undefined ? `API ${priceLabel(api)}/Mtok` : null].filter(Boolean).join(' · '),
      value: Math.round(elo) - base,
      color: r.isPlayer ? ME_COLOR : info?.color ?? r.color,
      me: r.isPlayer,
      extra:
        d === null ? undefined : (
          <span class={d > 0 ? 'bad' : d < 0 ? 'good' : 'muted'} title="Elo difference to your best model">
            {d > 0 ? '+' : ''}
            {d}
          </span>
        ),
    };
  });
  const stealth = COMPETITORS.filter((def) => !arena.some((r) => r.id === def.id));

  return (
    <div class="panel mkt">
      <PanelHeader code="MKT" title="Market" subtitle={`${monthYear(s.day)} · AI hype ${Math.round(hype)} (${hypeLabel(hype)})`} />
      <PanelIntro id="market">Who holds what share of each market, and where you win or lose by buyer tier. Campaigns to grow your share live in Marketing.</PanelIntro>
      <SceneView
        state={s}
        make={createTown}
        cam={TOWN_CAM}
        camId="CAM-05"
        height={360}
        label="The market as a town: consumer, developer and enterprise districts coloured by which lab serves them, and each lab's tower"
        onSelect={(hit) => {
          if (hit.id.startsWith('lab:')) setSel(hit.id.slice(4) === 'player' ? null : hit.id.slice(4));
        }}
      />

      <div class="grid-split-rev">
        <Card title={<>AI hype <HelpTip>The whole market's buzz. Higher hype means more customers adopt AI, for every lab, you included.</HelpTip></>} subtitle="Whole market">
          <Meter label="AI hype" value={hype} caption={hypeLabel(hype)} />
        </Card>

        <Card title="Position" flush>
          <div class="nt-strip">
            <div class="nt-cell">
              <Stat label="Arena rank" value={playerRank >= 0 ? `#${playerRank + 1}` : '—'} tone={playerRank === 0 ? 'accent' : 'default'} hint={`of ${arena.length} labs`} />
            </div>
            <div class="nt-cell">
              <Stat label="Users" value={playerUsers} format={(v) => formatNumber(v, 1)} hint="All your products" />
            </div>
            <div class="nt-cell">
              <Stat label="Brand" value={Math.round(s.company.brand)} hint="Helps you win every market" />
            </div>
            <div class="nt-cell">
              <Stat label="Reputation" value={Math.round(s.company.reputation)} hint="Outages and incidents lower it" />
            </div>
          </div>
        </Card>
      </div>

      <div class="grid-3">
        {segItems.map(({ seg, items }, i) => {
          const st = s.market.segments[seg.id];
          const playerShare = items.find((r) => r.id === ME)?.value ?? 0;
          return (
            <Card
              key={seg.id}
              class={i === SEGMENTS.length - 1 ? 'pa-wide-when-narrow' : ''}
              title={SEGMENT_NAME[seg.id]}
              code={seg.code}
              subtitle={`Market ${formatNumber(st?.tam ?? 0, 1)}`}
            >
              <div class="stack">
                {items.length === 0 ? (
                  <EmptyState title="Nobody selling" text="No labs in this segment yet." />
                ) : (
                  <ShareBar items={items} sel={sel} onPick={toggle} />
                )}
                <div class="kv">
                  <div class="kv-row">
                    <span class="kv-k">Your share</span>
                    <span class="kv-v num">{formatPct(playerShare, 1)}</span>
                  </div>
                  <div class="kv-row">
                    <span class="kv-k">Your users</span>
                    <span class="kv-v num">{formatNumber(st?.playerUsers ?? 0, 1)}</span>
                  </div>
                  <div class="kv-row">
                    <span class="kv-k">Reference price</span>
                    <span class="kv-v num">{`${priceLabel(st?.refPrice ?? 0)}${seg.unit}`}</span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {selected && (
        <div class="nt-sel-note" role="status">
          <span class="swatch" style={{ '--c': selected.color } as any} /> {selected.label}:{' '}
          {segItems.map(({ seg, items }) => `${SEGMENT_NAME[seg.id]} ${formatPct(items.find((i) => i.id === sel)?.value ?? 0, 1)}`).join(' · ')}
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => setSel(null)}>
            Clear
          </button>
        </div>
      )}

      <Card
        class="mkt-tiers"
        title={<>Your share by buyer tier <HelpTip>Buyers split into three tiers. Premium buyers want the best model, budget buyers want the cheapest one that works. Hover a cell for the top rival there.</HelpTip></>}
        subtitle="Darker: bigger share"
        flush
      >
        <TierHeat s={s} />
      </Card>

      <Card class="mkt-arena" title="LLM Arena" subtitle={`Best released model per lab · ${arena.length} ranked`}>
        {arenaRows.length === 0 ? (
          <EmptyState title="No models ranked" text="Release one from MDL to enter the board." />
        ) : (
          <>
            <BarList rows={arenaRows} format={(v) => formatInt(v + base)} sort onSelect={toggle} selected={sel} class="nt-arena" />
            <div class="nt-note">Bars start at {formatInt(base)} Elo so the gaps show. The +/− figure is the gap to your best model.</div>
          </>
        )}
        {stealth.length > 0 && <div class="nt-note">Not in the arena yet: {stealth.map((d) => d.name).join(', ')}.</div>}
      </Card>
    </div>
  );
}

/** One segment's users as a single bar in lab colours. Hover a slice for numbers; click to select that lab everywhere. */
function ShareBar({ items, sel, onPick }: { items: ShareItem[]; sel: string | null; onPick: (id: string) => void }) {
  const total = items.reduce((a, r) => a + r.value, 0) || 1;
  const shown = items.slice(0, 4);
  const more = items.length - shown.length;
  return (
    <div class="mk-share">
      <div class="mk-share-bar" role="group" aria-label="Share of users">
        {items.map((it) => (
          <div
            key={it.id}
            class={`mk-share-seg ${sel && sel !== it.id ? 'dim' : ''}`}
            style={{ width: `${((it.value / total) * 100).toFixed(2)}%`, '--c': it.color } as any}
          >
            <Tooltip class="mk-share-tip" content={<span>{`${it.label}: ${formatPct(it.value, 1)} of users`}</span>}>
              <button type="button" class="mk-share-btn" aria-pressed={sel === it.id} aria-label={`${it.label} ${formatPct(it.value, 1)}`} onClick={() => onPick(it.id)} />
            </Tooltip>
          </div>
        ))}
      </div>
      <div class="mk-share-legend">
        {shown.map((it) => (
          <button key={it.id} type="button" class={`mk-key ${sel === it.id ? 'on' : ''}`} aria-pressed={sel === it.id} onClick={() => onPick(it.id)}>
            <span class="swatch" style={{ '--c': it.color } as any} />
            <span class="mk-key-name">{it.label}</span>
            <span class="num">{formatPct(it.value, 0)}</span>
          </button>
        ))}
        {more > 0 && <span class="mk-key-more">+{more} more</span>}
      </div>
    </div>
  );
}

/** Segments down, buyer tiers across. Cell shade = your share of that tier's buyers; hover names the top rival there. */
function TierHeat({ s }: { s: GameState }) {
  const rows = SEGMENTS.map((seg) => ({ seg, rows: tierBreakdown(s, seg.id) }));
  // Tier weights are the same in every segment, so the first segment's weights label the columns.
  const weights = rows[0] ? Object.fromEntries(rows[0].rows.map((r) => [r.tier, r.weight])) : {};
  return (
    <div class="table-wrap">
      <table class="nt-heat">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            {TIERS.map((t) => (
              <th scope="col" key={t}>
                <span class="nt-heat-head">{TIER_LABEL[t]}</span>
                <span class="nt-heat-sub">
                  {formatPct(weights[t] ?? 0, 0)} of buyers · {TIER_SUB[t]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ seg, rows: tiers }) => (
            <tr key={seg.id}>
              <th scope="row" class="nt-heat-seg">
                {SEGMENT_NAME[seg.id]}
              </th>
              {TIERS.map((t) => {
                const cell = tiers.find((r) => r.tier === t);
                const share = clamp(cell?.playerShare ?? 0, 0, 1);
                const top = cell?.top;
                return (
                  <td key={t}>
                    <Tooltip
                      class="nt-heat-tip"
                      content={
                        <span class="nt-heat-tiptext">
                          {top ? (
                            <>
                              Top rival: <b>{top.name}</b> ({top.model}), {formatPct(top.share, 1)} of these buyers. You have {formatPct(share, 1)}.
                            </>
                          ) : (
                            <>Nobody else sells to these buyers. You have {formatPct(share, 1)}.</>
                          )}
                        </span>
                      }
                    >
                      <span class="nt-heat-cell" style={{ '--s': share } as any} tabIndex={0} aria-label={`${SEGMENT_NAME[seg.id]}, ${TIER_LABEL[t]}: your share ${formatPct(share, 0)}`}>
                        {formatPct(share, 0)}
                      </span>
                    </Tooltip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
