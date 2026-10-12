// Treasury room plan: fixed floor geometry (x, y on the grid; z = height) and the layout derived from GameState.
// buildLayout is pure. Its `sig` says when the static parts must be rebuilt.
import type { GameState } from '../../sim/types';
import { clamp } from '../../sim/util';
import { expenseRows, vaultFill } from './model';

export const W = 16;
export const D = 11;

export type Pt = [number, number];

export interface Path {
  pts: Pt[];
  cum: number[];
  len: number;
}

export function makePath(pts: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

/** Floor point at fraction u (0..1) of a path's length. */
export function pathAt(p: Path, u: number): Pt {
  const d = clamp(u, 0, 1) * p.len;
  const n = p.cum.length;
  let i = 1;
  while (i < n - 1 && p.cum[i] < d) i++;
  const span = p.cum[i] - p.cum[i - 1];
  const t = span > 0 ? clamp((d - p.cum[i - 1]) / span, 0, 1) : 0;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The vault: an open-fronted alcove against the back wall. */
export const VAULT = { x0: 4.6, x1: 9.5, y1: 3.9, h: 30 };
/** Gold pallets: 5 columns by 3 rows, each holding up to PER_SLOT bars. */
export const SLOT = { x0: 4.8, dx: 0.9, y0: 0.3, dy: 1.1, size: 0.75, cols: 5, count: 15, perSlot: 8 };
export const BAR_MAX = SLOT.count * SLOT.perSlot;
/** Cash stacks on the floor in front of the vault. */
export const CASH_SPOTS: Pt[] = [
  [6.4, 4.5],
  [7.1, 4.5],
  [6.4, 5.2],
  [7.1, 5.2],
  [6.4, 5.9],
  [7.1, 5.9],
];
export const STACK_MAX = CASH_SPOTS.length;

/** Revenue belt: enters through the left wall and runs into the vault. */
export const REV_PATH = makePath([
  [0, 6.2],
  [5.6, 6.2],
  [5.6, 3.95],
]);
/** Expense belt: out of the vault, along to the bus. */
export const EXP_MAIN: Pt[] = [
  [8.4, 3.95],
  [8.4, 6.2],
  [13.0, 6.2],
];
/** The bus runs along the room's right side and feeds one lane per expense category. */
export const BUS = { x: 13.0, y0: 0.7, y1: 10.3 };
export const LANE_GAP = 0.06;
export const BIN = { x0: 15.2, x1: 15.9, h: 8 };

/** Investors' table in the back corner, with up to six seats. */
export const TABLE = { x: 1.0, y: 0.9, w: 2.4, d: 1.6, z: 12 };
export const SEATS: Pt[] = [
  [1.2, 2.95],
  [2.2, 2.95],
  [3.1, 2.95],
  [3.95, 1.3],
  [3.95, 2.1],
  [0.45, 1.7],
];
export const MAX_SEATS = SEATS.length;

/** The front door on the left wall. The investor with a term sheet stands outside it, the collector inside. */
export const DOOR = { y0: 8.5, y1: 10.5 };
export const OFFER_AT: Pt = [-0.4, 9.3];
export const COLLECTOR_AT: Pt = [1.1, 9.7];

/** Debt safe, chained to a ring on the left wall. */
export const SAFE = { x: 2.7, y: 8.9, w: 1.2, d: 1.2, h: 9 };
export const CHAIN_ANCHOR: [number, number, number] = [0.05, 7.6, 10];

/** Stock ticker on the back wall, above the expense side of the room. */
export const BOARD = { x0: 11.3, x1: 15.5, z0: 25, z1: 50 };

export const PLANTS: Pt[] = [
  [0.5, 4.3],
  [7.0, 8.6],
  [11.4, 9.0],
];
export const CRATES: Pt = [9.8, 7.6];

export interface Lane {
  key: string;
  share: number;
  y0: number;
  y1: number;
  yc: number;
  path: Path;
}

export interface Layout {
  sig: string;
  fill: number;
  negative: boolean;
  bars: number;
  stacks: number;
  stackLayers: number;
  seats: number;
  moreSeats: number;
  offer: boolean;
  debtOn: boolean;
  chains: number;
  safe: number;
  lanes: Lane[];
}

/** Pure function of state: the static part of the room. */
export function buildLayout(s: GameState): Layout {
  const f = s.finance;
  const negative = f.cash < 0;
  const fill = vaultFill(f.cash);
  const bars = negative ? 0 : Math.round(fill * BAR_MAX);
  const stacks = negative ? 0 : Math.round(fill * STACK_MAX);
  const stackLayers = 1 + Math.round(fill * 4);

  const rounds = f.roundsRaised.length;
  const seats = Math.min(MAX_SEATS, rounds);
  const moreSeats = Math.max(0, rounds - MAX_SEATS);
  const offer = !!f.pendingOffer && !s.company.isPublic;

  const debtOn = f.debt > 0;
  const chains = debtOn ? (f.debt > 1e8 ? 2 : 1) : 0;
  const safe = debtOn ? clamp(0.9 + (Math.log10(f.debt) - 5) * 0.06, 0.9, 1.4) : 1;

  const rows = expenseRows(s);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const span = BUS.y1 - BUS.y0 - Math.max(0, rows.length - 1) * LANE_GAP;
  // Lane widths follow the money, with a floor so small categories stay clickable.
  const floor = rows.length ? 0.5 / rows.length : 0;
  const weights = rows.map((r) => Math.max(r.value / total, floor));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let y = BUS.y0;
  const lanes: Lane[] = rows.map((r, i) => {
    const w = (span * weights[i]) / wsum;
    const y0 = y;
    const y1 = y + w;
    y = y1 + LANE_GAP;
    const yc = (y0 + y1) / 2;
    return {
      key: r.key,
      share: r.value / total,
      y0,
      y1,
      yc,
      path: makePath([...EXP_MAIN, [BUS.x, yc], [BIN.x0 - 0.1, yc]]),
    };
  });

  const sig = [
    bars,
    stacks,
    stackLayers,
    negative ? 1 : 0,
    seats,
    moreSeats,
    offer ? 1 : 0,
    chains,
    safe.toFixed(1),
    lanes.map((l) => `${l.key}:${(l.y1 - l.y0).toFixed(2)}`).join(','),
  ].join('|');

  return { sig, fill, negative, bars, stacks, stackLayers, seats, moreSeats, offer, debtOn, chains, safe, lanes };
}
