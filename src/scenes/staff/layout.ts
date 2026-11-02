// Staff floor plan: a pure function of GameState and the frame. Five department rooms and an open-seat room, each
// sized by its headcount, laid out across the frame as a pod row (src/office/kit/frame.ts). One desk per seat; past
// about 100 desks each desk stands for `unit` people so big offices stay readable.
import type { GameState, RoleId, Star } from '../../sim/types';
import { headcount, officeCapacity } from '../../sim/systems/staff';
import { type Box2, arrangePods } from '../../office/kit/frame';

export const ZONE_IDS: RoleId[] = ['researcher', 'engineer', 'safety', 'sales', 'marketing'];
export type ZoneId = RoleId | 'open';
export type Band = 'high' | 'mid' | 'low';

/** Desk pitch in floor units: the same grid as the HQ office. */
export const PITCH_X = 1.8;
export const PITCH_Y = 2.6;
const DESK_FOOT = 1.3;
const MARGIN = 0.6;
/** Depth of the prop band behind the desks (back wall side of each zone). */
const PROP_BAND = 2.4;
const MAX_DESKS = 72;
const UNITS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
/** Wall height of a department room, and the tallest prop in one (whiteboards, racks). */
export const ROOM_WALL = 30;
const ROOM_TOP = 46;

export type Prop =
  | { k: 'whiteboard'; x: number; y: number; seed: number }
  | { k: 'rack'; x: number; y: number; seed: number }
  | { k: 'redteam'; x: number; y: number; w: number; d: number }
  | { k: 'shield'; x: number; y: number }
  | { k: 'screen'; x: number; y: number; w: number; seed: number }
  | { k: 'phone'; x: number; y: number }
  | { k: 'poster'; x: number; y: number; seed: number }
  | { k: 'tripod'; x: number; y: number };

export interface DeskSpot {
  /** Stable key: `star:<id>`, `<role>:<k>` or `open:<k>`. People keep their key across rebuilds. */
  key: string;
  /** Desk top-left, floor units. */
  x: number;
  y: number;
  /** Team colour and accessory. Null for open seats. */
  role: RoleId | null;
  kind: 'staff' | 'star' | 'empty';
  /** Share of a seat this desk stands for (1 for a one-to-one desk). */
  fill: number;
  star: Star | null;
  zone: ZoneId;
}

export interface Zone {
  id: ZoneId;
  /** Footprint top-left (back corner) and size, floor units, margins included. */
  x: number;
  y: number;
  w: number;
  d: number;
  cols: number;
  rows: number;
  /** Row of the pod layout this room sits in. */
  row: number;
  /** Team headcount, stars included. For the open zone: free seats. */
  heads: number;
  /** Ordinary people (no stars). */
  count: number;
  stars: Star[];
  desks: DeskSpot[];
  props: Prop[];
}

export interface Plant {
  x: number;
  y: number;
  size: number;
}

export interface Layout {
  /** Changes only when the drawn plan changes. */
  sig: string;
  cap: number;
  unit: number;
  headcount: number;
  free: number;
  over: number;
  band: Band;
  /** Scale-1 screen box of all the rooms, for the camera fit. */
  box: Box2;
  rows: number;
  zones: Zone[];
  plants: Plant[];
  hiring: boolean;
}

export function moraleBand(m: number): Band {
  return m >= 60 ? 'high' : m >= 40 ? 'mid' : 'low';
}

export function pickUnit(cap: number): number {
  for (const u of UNITS) if (Math.ceil(cap / u) <= MAX_DESKS) return u;
  return UNITS[UNITS.length - 1];
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

interface Spot {
  key: string;
  role: RoleId | null;
  kind: 'staff' | 'star' | 'empty';
  fill: number;
  star: Star | null;
}

function teamSpots(role: RoleId, count: number, stars: Star[], unit: number): Spot[] {
  const out: Spot[] = stars.map((st) => ({ key: `star:${st.id}`, role, kind: 'star', fill: 1, star: st }));
  const n = Math.ceil(count / unit);
  for (let k = 0; k < n; k++) {
    const share = Math.min(unit, count - k * unit) / unit;
    const seated = share >= 0.5 || n === 1;
    out.push({ key: `${role}:${k}`, role, kind: seated ? 'staff' : 'empty', fill: seated ? share : 0, star: null });
  }
  if (out.length === 0) out.push({ key: `${role}:0`, role, kind: 'empty', fill: 0, star: null });
  return out;
}

function openSpots(free: number, unit: number): Spot[] {
  const out: Spot[] = [];
  const n = Math.ceil(free / unit);
  for (let k = 0; k < n; k++) out.push({ key: `open:${k}`, role: null, kind: 'empty', fill: 0, star: null });
  return out;
}

/** Props on the back band of a zone, in zone-local coordinates, and the width they need. */
function propsFor(id: ZoneId, heads: number): { props: Prop[]; width: number } {
  const props: Prop[] = [];
  let width = 0;
  if (id === 'researcher') {
    const n = clamp(1 + Math.floor(heads / 6), 1, 4);
    for (let i = 0; i < n; i++) props.push({ k: 'whiteboard', x: MARGIN + i * 1.9, y: 0.45, seed: i });
    width = n * 1.9 - 0.5;
  } else if (id === 'engineer') {
    const n = clamp(1 + Math.floor(heads / 4), 1, 6);
    for (let i = 0; i < n; i++) props.push({ k: 'rack', x: MARGIN + i * 0.9, y: 0.35, seed: i });
    width = n * 0.9;
  } else if (id === 'safety') {
    props.push({ k: 'redteam', x: MARGIN, y: 0.4, w: 2.0, d: 1.8 });
    props.push({ k: 'shield', x: MARGIN + 0.55, y: 0.4 });
    width = 2.0;
  } else if (id === 'sales') {
    props.push({ k: 'screen', x: MARGIN, y: 0.35, w: 2.6, seed: 1 });
    props.push({ k: 'phone', x: MARGIN + 2.9, y: 0.5 });
    width = 4.0;
  } else if (id === 'marketing') {
    const n = clamp(2 + Math.floor(heads / 5), 2, 5);
    for (let i = 0; i < n; i++) {
      props.push({ k: 'poster', x: MARGIN + i * 1.25, y: 0.35, seed: i });
    }
    props.push({ k: 'tripod', x: MARGIN + n * 1.25 + 0.3, y: 1.0 });
    width = n * 1.25 + 0.9;
  }
  return { props, width };
}

interface Draft {
  id: ZoneId;
  heads: number;
  count: number;
  stars: Star[];
  cols: number;
  rows: number;
  w: number;
  d: number;
  desks: { spot: Spot; lx: number; ly: number }[];
  props: Prop[];
}

function draftZone(id: ZoneId, spots: Spot[], heads: number, count: number, stars: Star[], props: Prop[], propW: number): Draft {
  const n = spots.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const gridW = (cols - 1) * PITCH_X + DESK_FOOT;
  const contentW = Math.max(gridW, propW, DESK_FOOT);
  const gridX = MARGIN + (contentW - gridW) / 2;
  return {
    id,
    heads,
    count,
    stars,
    cols,
    rows,
    w: contentW + MARGIN * 2,
    d: PROP_BAND + (rows - 1) * PITCH_Y + 2.0,
    desks: spots.map((spot, i) => ({
      spot,
      lx: gridX + (i % cols) * PITCH_X,
      ly: PROP_BAND + Math.floor(i / cols) * PITCH_Y,
    })),
    props,
  };
}

function place(dr: Draft, ox: number, oy: number, row: number): Zone {
  return {
    id: dr.id,
    x: ox,
    y: oy,
    w: dr.w,
    d: dr.d,
    cols: dr.cols,
    rows: dr.rows,
    row,
    heads: dr.heads,
    count: dr.count,
    stars: dr.stars,
    desks: dr.desks.map(({ spot, lx, ly }) => ({
      key: spot.key,
      x: ox + lx,
      y: oy + ly,
      role: spot.role,
      kind: spot.kind,
      fill: spot.fill,
      star: spot.star,
      zone: dr.id,
    })),
    props: dr.props.map((p) => ({ ...p, x: ox + p.x, y: oy + p.y }) as Prop),
  };
}

/** Pure function of state and the frame (available CSS px): the whole staff floor plan. */
export function buildLayout(s: GameState, aw = 1200, ah = 200): Layout {
  const cap = officeCapacity(s);
  const hc = headcount(s);
  const free = Math.max(0, cap - hc);
  const over = Math.max(0, hc - cap);
  const band = moraleBand(s.staff.morale);
  const unit = pickUnit(cap);
  const hired = s.staff.stars.filter((st) => st.hiredDay !== null);

  const drafts = new Map<ZoneId, Draft>();
  for (const role of ZONE_IDS) {
    const count = Math.max(0, Math.floor(s.staff.roles[role]?.count ?? 0));
    const stars = hired.filter((st) => st.role === role);
    const heads = count + stars.length;
    const pr = propsFor(role, heads);
    drafts.set(role, draftZone(role, teamSpots(role, count, stars, unit), heads, count, stars, pr.props, pr.width));
  }
  drafts.set('open', draftZone('open', openSpots(free, unit), free, 0, [], [], 0));

  const order: ZoneId[] = [...ZONE_IDS, 'open'];
  const ds = order.map((id) => drafts.get(id)!);
  const plan = arrangePods(
    ds.map((dr) => ({ w: dr.w, d: dr.d, h: ROOM_TOP })),
    aw,
    ah,
    1.6,
    1.4,
  );
  const zones: Zone[] = ds.map((dr, i) => place(dr, plan.x[i], plan.y[i], plan.row[i]));

  // Fewer plants as morale falls: none at all when it is low.
  const plants: Plant[] = [];
  for (const z of zones) {
    if (band !== 'low') plants.push({ x: z.x + 0.3, y: z.y + z.d - 0.35, size: 1 });
    if (band === 'high') plants.push({ x: z.x + z.w - 0.3, y: z.y + z.d - 0.35, size: 1.1 });
  }

  const sig = [
    plan.rows,
    cap,
    unit,
    band,
    free,
    over,
    zones
      .map((z) => `${z.id}:${z.cols}x${z.rows}:${z.heads}:${z.count}:${z.stars.map((st) => st.id).join('+')}:${z.x.toFixed(2)}:${z.y.toFixed(2)}`)
      .join(';'),
  ].join('|');

  return {
    sig,
    cap,
    unit,
    headcount: hc,
    free,
    over,
    band,
    box: plan.box,
    rows: plan.rows,
    zones,
    plants,
    hiring: band === 'low',
  };
}
