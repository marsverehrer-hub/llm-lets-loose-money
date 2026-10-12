// The hero of the Compute screen: the server room, drawn as blocks of GPU cells (GAME_DESIGN §21.5).
import { Card, Tooltip, useIsMobile } from '../../components';
import { formatMoney } from '../../../sim/util';
import type { GameState } from '../../../sim/types';
import { fmtRate } from '../panelKit';
import { summaryParts, type RoomBlock, type ServerRoom as Room } from './roomModel';

const CELL = 12;
const PITCH = 15;
/** Shade per live product: the first product is full blue, later ones fade. */
const SHADES = [1, 0.62, 0.38, 0.22];

function num(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

function blockSvg(b: RoomBlock, label: string) {
  const w = Math.max(0, b.cols * PITCH - (PITCH - CELL));
  const h = Math.max(0, b.rows * PITCH - (PITCH - CELL));
  return (
    <svg class="cc-grid" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      {b.cells.map((c, i) => {
        const x = (i % b.cols) * PITCH;
        const y = Math.floor(i / b.cols) * PITCH;
        const op = c.job === 'serving' ? SHADES[Math.min(c.shade, SHADES.length - 1)] : 1;
        return <rect key={i} x={x} y={y} width={CELL} height={CELL} class={`cc-cell cc-${c.job}`} style={c.job === 'serving' ? `fill-opacity:${op}` : undefined} />;
      })}
    </svg>
  );
}

/** Plain words for what a block is doing right now. */
function jobLine(b: RoomBlock): string {
  if (b.kind === 'burst') return b.cells.length > 0 ? `${num(b.installed)} GPU-eq bought` : 'Nothing bought';
  if (b.building) return `Building, ${b.buildDaysLeft} day${b.buildDaysLeft === 1 ? '' : 's'} left`;
  const bits: string[] = [];
  if (b.training > 0) bits.push(`${num(b.training)} training`);
  if (b.serving > 0) bits.push(`${num(b.serving)} serving`);
  if (b.idle > 0) bits.push(`${num(b.idle)} idle`);
  return bits.length > 0 ? bits.join(' · ') : b.kind === 'rental' ? 'None rented' : 'Empty';
}

function BlockTip({ b, burstCost }: { b: RoomBlock; burstCost: number }) {
  if (b.kind === 'burst') {
    return (
      <span class="cc-tip-body">
        <b>{b.name}</b>
        <span>{fmtRate(b.pflops)} PF/s bought</span>
        <span>{num(b.installed)} GPU-equivalents</span>
        <span>{burstCost > 0 ? `${formatMoney(burstCost)}/day` : 'Not in use today'}</span>
      </span>
    );
  }
  return (
    <span class="cc-tip-body">
      <b>{b.name}</b>
      {b.gpuMix.length === 0 ? <span>No GPUs installed</span> : b.gpuMix.map((g) => <span key={g.gpuId}>{num(g.count)} × {g.name}</span>)}
      <span>{fmtRate(b.pflops)} PF/s</span>
      {b.kind === 'dc' && <span>Upkeep {formatMoney(b.upkeepPerDay)}/day · Power {formatMoney(b.powerPerDay)}/day</span>}
      {b.kind === 'rental' && <span>Billed by the day</span>}
      <span>{jobLine(b)}</span>
    </span>
  );
}

function RoomBlockButton({ b, onOpen, tip, burstCost }: { b: RoomBlock; onOpen: (key: string) => void; tip: boolean; burstCost: number }) {
  const label = `${b.name}. ${jobLine(b)}. Open to manage.`;
  const body = (
    <button type="button" class={`cc-block cc-block-${b.kind} ${b.building ? 'is-building' : ''}`} aria-label={label} onClick={() => onOpen(b.key)}>
      <span class="cc-block-head">
        <span class="cc-block-name">{b.name}</span>
        <span class="cc-block-sub">{b.sub}</span>
      </span>
      {b.cells.length > 0 ? (
        blockSvg(b, label)
      ) : (
        <span class="cc-block-none">{b.kind === 'burst' ? 'No burst needed' : b.kind === 'rental' ? 'Nothing rented' : 'Empty'}</span>
      )}
      <span class="cc-block-foot">{jobLine(b)}</span>
      {b.building && (
        <span class="cc-build" aria-hidden="true">
          <i style={`width:${(b.buildProgress * 100).toFixed(1)}%`} />
        </span>
      )}
    </button>
  );
  return tip ? (
    <Tooltip content={<BlockTip b={b} burstCost={burstCost} />} class="cc-tip">
      {body}
    </Tooltip>
  ) : (
    body
  );
}

export function ServerRoom({ s, room, onOpen }: { s: GameState; room: Room; onOpen: (key: string) => void }) {
  const phone = useIsMobile();
  const parts = summaryParts(s, room);
  const cellLine = room.gpusPerCell > 1 ? `1 square = ${num(room.gpusPerCell)} GPUs` : '1 square = 1 GPU';
  return (
    <Card code="RM" title="Server room" subtitle={cellLine} class="cc-room-card">
      <p class="cc-summary">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span class="cc-sep"> · </span>}
            {p}
          </span>
        ))}
      </p>
      <div class="cc-room">
        {room.blocks.map((b) => (
          <RoomBlockButton key={b.key} b={b} onOpen={onOpen} tip={!phone} burstCost={room.burstCostPerDay} />
        ))}
      </div>
      <div class="cc-legend" aria-label="Legend">
        <span><i class="cc-swatch cc-training" /> Training</span>
        <span><i class="cc-swatch cc-serving" /> Serving (one shade per product)</span>
        <span><i class="cc-swatch cc-idle" /> Idle</span>
        <span><i class="cc-swatch cc-empty" /> Free slot</span>
        <span><i class="cc-swatch cc-burst" /> Cloud burst</span>
      </div>
    </Card>
  );
}
