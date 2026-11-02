// HQ office camera (v18): the company's workspace as a row of isometric rooms that grows with the office tier.
// Garage (and Mom's house) -> WeWork hot desks with a kombucha bar -> loft with meeting room, lounge and server
// closet -> floors -> campus with a park. Desks are grouped into open-plan rooms by role; people sit, type, get
// coffee and walk to the whiteboards. The rooms are laid out across the frame by the kit's pod row and the camera
// fits them to any frame (wide desktop strip or phone). Reads GameState fresh every frame, never copies it.
import type { GameState } from '../sim/types';
import { OFFICE_TIERS } from '../sim/data/roles';
import { formatNumber } from '../sim/util';
import { project, type Projector } from './iso';
import { type Ctx, floorTile, glow } from './draw/prims';
import type { Role } from './draw/furniture';
import { Crowd, MAX_PEOPLE, chairOf, type DeskSlot, type Person, type Stops } from './agents';
import { Effects } from './effects';
import { T, alpha, mix, shade, syncTheme } from './kit/theme';
import { type Box2, type HudPart, type PodSpec, arrangePods, drawGround, feedMargins, fitTo, floorAt, hud, tag, tagWidth } from './kit/frame';
import {
  block,
  boxes,
  car,
  chair,
  desk,
  glassFront,
  kitchen,
  meetingChairsFront,
  meetingTable,
  pingPong,
  plant,
  rack,
  room,
  scaffold,
  secretCrate,
  shadowOn,
  slab,
  sofa,
  tree,
  wallSign,
  whiteboard,
} from './kit/props';
import { person } from './kit/person';

const ROLE_ORDER: Role[] = ['researcher', 'engineer', 'safety', 'sales', 'marketing'];
const ROLE_NAME: Record<Role, string> = { researcher: 'Researcher', engineer: 'Engineer', safety: 'Safety', sales: 'Sales', marketing: 'Marketing' };
const DESK_CAP = 80;
const PX = 1.62;
const PY = 2.45;
const WALL = 34;
const TIER_NAMES = ["Mom's Garage", 'WeWork Hot Desks', 'SoMa Loft', 'Mission Bay Floors', 'Glass Donut Campus', 'Arcology'];
/** Desks per open-plan room by tier. */
const PER_ROOM = [8, 12, 14, 16, 16, 16];

export function tierIndex(s: GameState): number {
  const id = s.company.officeTierId;
  const i = OFFICE_TIERS.findIndex((t) => t.id === id);
  if (i >= 0) return Math.min(5, i);
  const low = id.toLowerCase();
  const rules: [RegExp, number][] = [
    [/arco/, 5],
    [/campus|glass|donut/, 4],
    [/floor|bay|mission/, 3],
    [/loft|soma/, 2],
    [/hot|cowork|wework|desk/, 1],
    [/garage|mom/, 0],
  ];
  for (const [re, n] of rules) if (re.test(low)) return n;
  return 0;
}

export function tierName(s: GameState): string {
  const i = tierIndex(s);
  return OFFICE_TIERS[i]?.name ?? TIER_NAMES[i];
}

export function totalGpus(s: GameState): number {
  let n = 0;
  for (const k in s.compute.rented) n += s.compute.rented[k] ?? 0;
  for (const dc of s.compute.datacenters) for (const k in dc.gpus) n += dc.gpus[k] ?? 0;
  return n;
}

type PodKind = 'desks' | 'garage' | 'house' | 'kitchen' | 'meeting' | 'server' | 'park';

export interface Pod {
  kind: PodKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  row: number;
  /** Desks in this room (open plan and garage). */
  desks: DeskSlot[];
  /** Server racks (server room, or the garage shelf). */
  racks: { x: number; y: number }[];
  /** Datacenters under construction (server room). */
  builds: { x: number; days: number }[];
  /** Unreleased-model crates. */
  crates: { x: number; y: number }[];
  /** Whiteboards on the back wall: x and width. */
  boards: { x: number; w: number }[];
  /** People shown in a meeting / at the kitchen (not hoverable desk staff). */
  extras: number;
  sign: string | null;
  seed: number;
}

export interface Layout {
  sig: string;
  tier: number;
  pods: Pod[];
  desks: DeskSlot[];
  salesDesks: DeskSlot[];
  rows: number;
  box: Box2;
  headcount: number;
  gpus: number;
  overflow: number;
  building: number;
}

function newPod(kind: PodKind, name: string, w: number, d: number, h: number, seed: number): Pod {
  return { kind, name, x: 0, y: 0, w, d, h, row: 0, desks: [], racks: [], builds: [], crates: [], boards: [], extras: 0, sign: null, seed };
}

/** Open-plan room for a run of desks. Desk positions are local until the pods are placed. */
function deskRoom(roles: Role[], start: number, name: string, seed: number, garage: boolean): Pod {
  const n = roles.length;
  const cols = Math.max(2, Math.min(garage ? 3 : 6, Math.ceil(Math.sqrt(n * 1.7))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const extra = garage ? 3.4 : 0;
  const pod = newPod(garage ? 'garage' : 'desks', name, 1.5 + cols * PX + extra, 2.3 + rows * PY - 0.3, WALL, seed);
  const stops: Stops = { coffee: { x: 0.75, y: 1.65 }, corridorX: 0.75, board: new Map() };
  roles.forEach((role, i) => {
    pod.desks.push({ x: 1.3 + (i % cols) * PX, y: 2.2 + Math.floor(i / cols) * PY, role, index: start + i, stops });
  });
  // A whiteboard over each column that seats a researcher.
  const boardCols = new Set<number>();
  roles.forEach((r, i) => {
    if (r === 'researcher') boardCols.add(i % cols);
  });
  for (const c of [...boardCols].sort((a, b) => a - b)) pod.boards.push({ x: 1.3 + c * PX - 0.05, w: 1.4 });
  pod.desks.forEach((d) => {
    if (d.role !== 'researcher') return;
    const col = Math.round((d.x - 1.3) / PX);
    if (boardCols.has(col)) stops.board.set(d.index, { x: d.x + 0.7, y: 1.35 });
  });
  return pod;
}

/** Pure function of state and frame aspect: the rooms, their contents and where they sit. */
export function buildLayout(s: GameState, aw: number, ah: number): Layout {
  const tier = tierIndex(s);
  const counts = ROLE_ORDER.map((r) => Math.max(0, Math.floor(s.staff.roles[r]?.count ?? 0)));
  const headcount = counts.reduce((a, b) => a + b, 0);
  const seq: Role[] = [];
  ROLE_ORDER.forEach((r, i) => {
    for (let k = 0; k < counts[i] && seq.length < DESK_CAP; k++) seq.push(r);
  });
  const gpus = totalGpus(s);
  const dcs = s.compute.datacenters;
  const building = dcs.filter((d) => d.buildDaysLeft > 0);
  const unreleased = Math.min(3, s.models.filter((m) => m.releasedDay === null).length);
  const marketing = counts[4];

  const pods: Pod[] = [];
  const garage = tier === 0;
  if (garage) pods.push(newPod('house', "Mom's house", 4.6, 4.2, 44, 1));
  if (tier >= 1) pods.push(newPod('kitchen', tier === 1 ? 'Kombucha bar' : 'Kitchen', tier >= 2 ? 6.4 : 5, tier >= 2 ? 5 : 4, WALL, 2));

  // Open-plan rooms, filled in role order so teams sit together.
  const per = PER_ROOM[tier];
  const nRooms = Math.max(1, Math.ceil(seq.length / per));
  const deskRooms: Pod[] = [];
  for (let r = 0; r < nRooms; r++) {
    const a = Math.round((r * seq.length) / nRooms);
    const b = Math.round(((r + 1) * seq.length) / nRooms);
    const chunk = seq.slice(a, b);
    const name = garage ? 'Garage' : nRooms === 1 ? 'Open plan' : `Floor ${r + 1}`;
    deskRooms.push(deskRoom(chunk, a, name, 10 + r, garage));
  }
  const first = deskRooms[0];
  first.sign = marketing > 0 ? 'GO VIRAL' : tier >= 1 ? 'WE ARE HIRING' : null;
  pods.push(...deskRooms);

  if (tier >= 2) {
    const meet = newPod('meeting', 'Meeting room', 5.2, 4.4, WALL, 3);
    meet.extras = Math.min(6, Math.max(2, Math.floor(headcount / 8)));
    meet.boards.push({ x: 1.0, w: 2.2 });
    pods.push(meet);
  }

  // Server room (or the garage shelf): racks grow with log GPUs, scaffolds for datacenters being built.
  const racksN = gpus > 0 ? Math.min(28, Math.round(Math.log2(1 + gpus) * 1.2)) : 0;
  if (garage) {
    const gp = first;
    const k = Math.min(3, racksN);
    for (let i = 0; i < k; i++) gp.racks.push({ x: gp.w - 0.75, y: 0.35 + i * 0.6 });
    for (let i = 0; i < unreleased; i++) gp.crates.push({ x: gp.w - 3.2 + i * 0.62, y: 0.4 });
  }
  if (!garage && (racksN > 0 || dcs.length > 0 || unreleased > 0)) {
    const cols = Math.max(2, Math.ceil(Math.sqrt(Math.max(1, racksN) * 1.4)));
    const rws = Math.max(1, Math.ceil(racksN / cols));
    const builds = Math.min(3, building.length);
    const sv = newPod('server', 'Server room', Math.max(4.2, 1.4 + cols * 0.9 + 0.4, builds * 2.4 + 0.6), 1.2 + rws * 0.95 + 1.5 + (builds ? 2.2 : 0), WALL + 4, 4);
    for (let i = 0; i < racksN; i++) sv.racks.push({ x: 0.9 + (i % cols) * 0.9, y: 0.5 + Math.floor(i / cols) * 0.95 });
    building.slice(0, 3).forEach((dc, k) => sv.builds.push({ x: 0.4 + k * 2.4, days: dc.buildDaysLeft }));
    for (let i = 0; i < unreleased; i++) sv.crates.push({ x: 0.3 + i * 0.65, y: sv.d - 0.85 });
    pods.push(sv);
  }
  if (tier >= 4) pods.push(newPod('park', tier === 4 ? 'The park' : 'Sky garden', 6, 5, 30, 5));
  if (tier >= 5) pods.push(newPod('park', 'Atrium', 5, 5, 30, 6));

  const specs: PodSpec[] = pods.map((p) => ({ w: p.w, d: p.d, h: p.kind === 'server' && p.builds.length ? Math.max(p.h, 46) : p.h, top: 0 }));
  const plan = arrangePods(specs, aw, ah, 2, 1.4);
  const desks: DeskSlot[] = [];
  pods.forEach((p, i) => {
    const ox = plan.x[i];
    const oy = plan.y[i];
    p.x = ox;
    p.y = oy;
    p.row = plan.row[i];
    if (p.desks.length) {
      const st = p.desks[0].stops;
      st.coffee = { x: st.coffee.x + ox, y: st.coffee.y + oy };
      st.corridorX += ox;
      for (const [k, v] of st.board) st.board.set(k, { x: v.x + ox, y: v.y + oy });
      for (const d of p.desks) {
        d.x += ox;
        d.y += oy;
        desks.push(d);
      }
    }
    for (const r of p.racks) {
      r.x += ox;
      r.y += oy;
    }
    for (const c of p.crates) {
      c.x += ox;
      c.y += oy;
    }
  });
  desks.sort((a, b) => a.index - b.index);

  const sig = [counts.join(','), tier, racksN, dcs.length, building.length, unreleased, first.sign ?? '-', plan.rows, Math.round(aw / 40), Math.round(ah / 40)].join('|');
  return {
    sig,
    tier,
    pods,
    desks,
    salesDesks: desks.filter((d) => d.role === 'sales'),
    rows: plan.rows,
    box: plan.box,
    headcount,
    gpus,
    overflow: Math.max(0, headcount - MAX_PEOPLE),
    building: building.length,
  };
}

interface Env {
  training: boolean;
  night: number;
  sky: [string, string];
}

interface Item {
  d: number;
  row: number;
  fn: (c: Ctx, t: number, env: Env) => void;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Shell of a pod: slab, walls, windows and wall-mounted things. Drawn before anything stands in the room. */
function drawShell(c: Ctx, p: Pod, env: Env, t: number): void {
  const { x, y, w, d } = p;
  if (p.kind === 'house') {
    slab(c, x, y, w, d, T.dark ? '#24392b' : '#cfe3d2', T.dark ? '#21352a' : '#c6dcc9', 1, 2);
    floorTile(c, x + w - 1.4, y + 2.4, 1.1, d - 2.4, T.dark ? T.bg3 : T.bg3);
    return;
  }
  if (p.kind === 'park') {
    slab(c, x, y, w, d, T.dark ? '#22382a' : '#cfe3d2', T.dark ? '#203527' : '#c6dcc9', 1, 2);
    floorTile(c, x + w / 2 - 0.5, y, 1, d, T.dark ? mix(T.bg3, T.wood, 0.25) : T.bg3);
    floorTile(c, x, y + d / 2 - 0.5, w, 1, T.dark ? mix(T.bg3, T.wood, 0.25) : T.bg3);
    return;
  }
  const windows: number[] = [];
  if (p.kind === 'desks' || p.kind === 'meeting' || p.kind === 'kitchen') {
    const startX = p.kind === 'kitchen' ? 3.6 : p.boards.length ? -1 : 1.4;
    if (startX > 0) for (let wx = startX; wx + 1.8 < w; wx += 2.6) windows.push(x + wx);
    else {
      // windows between the whiteboards
      for (let wx = 1.2; wx + 1.8 < w; wx += 1.8) {
        if (!p.boards.some((b) => wx + 1.6 > b.x - 0.1 && wx < b.x + b.w + 0.1)) windows.push(x + wx);
      }
    }
  }
  const floor = p.kind === 'server' ? (T.dark ? '#1a1c20' : '#d3d6db') : p.kind === 'garage' ? (T.dark ? '#2a2a2c' : '#dcdcd8') : undefined;
  const alt = p.kind === 'server' ? (T.dark ? '#16181b' : '#cbcfd5') : p.kind === 'garage' ? (T.dark ? '#262628' : '#d4d4d0') : undefined;
  room(c, x, y, w, d, {
    wallH: p.h,
    floor,
    floorAlt: alt,
    cell: p.kind === 'server' ? 0.5 : 1,
    windows,
    sky: env.sky,
    livery: p.kind === 'desks' || p.kind === 'garage',
  });
  if (p.kind === 'meeting') floorTile(c, x + 0.6, y + 1.2, w - 1.2, d - 1.8, alpha(T.fg3, T.dark ? 0.12 : 0.18));
  if (p.kind === 'kitchen') floorTile(c, x + 0.3, y + 1.0, w - 0.6, d - 1.3, alpha(T.wood, T.dark ? 0.16 : 0.22));
  if (p.kind === 'server') {
    // cold aisle markings
    for (let k = 0; k < 2; k++) floorTile(c, x + 0.2, y + d - 0.9 - k * 0.12, w - 0.4, 0.05, alpha(T.hl, 0.7));
  }
  if (p.kind === 'garage') {
    // Mom's car bay
    const cx = x + w - 3.2;
    for (const [ax, ay, bx, by] of [[cx, 1.8, cx + 2.8, 1.8], [cx, 1.8, cx, d - 0.3]]) floorTile(c, ax, y + ay, Math.max(0.06, bx - ax), Math.max(0.06, by - ay), alpha(T.fg, 0.25));
  }
  for (const b of p.boards) whiteboard(c, x + b.x, y + 0.12, b.w, p.seed + Math.round(b.x * 3));
  if (p.sign) wallSign(c, x, y + 0.6, Math.min(3.6, d - 1.2), p.h - 12, p.sign, T.hl, true);
  if (p.kind === 'server') wallSign(c, x + 0.4, y, 2.6, p.h - 11, 'SERVERS', T.up);
}

/** Things standing in the pod, as depth-sorted items. */
function podItems(p: Pod, out: Item[]): void {
  const { x, y, w, d, row } = p;
  const push = (dd: number, fn: Item['fn']) => out.push({ d: dd, row, fn });
  if (p.kind === 'house') {
    push(x + y + 3, (c) => {
      const hx = x + 0.5;
      const hy = y + 0.6;
      const wall = T.dark ? '#c9c2b3' : '#efe9dc';
      shadowOn(c, hx, hy, 3.2, 2.6);
      block(c, hx, hy, 3.2, 2.6, 0, 22, wall, false);
      block(c, hx - 0.15, hy - 0.15, 3.5, 2.9, 22, 25, T.dark ? '#5c4038' : '#9a6a58', false);
      block(c, hx + 2.3, hy + 0.3, 0.4, 0.4, 25, 33, T.dark ? '#6b4b40' : '#a8776a', false);
      block(c, hx + 1.0, hy + 2.6, 0.7, 0.04, 0, 13, T.dark ? '#3a2d25' : '#6b5040', false);
      for (const wx of [0.25, 2.1]) block(c, hx + wx, hy + 2.6, 0.75, 0.04, 8, 16, T.dark ? alpha(T.lamp, 0.55) : '#a9c4dc', false);
      block(c, hx + 3.2, hy + 0.5, 0.04, 1.8, 8, 16, T.dark ? alpha(T.lamp, 0.4) : '#a9c4dc', false);
    });
    push(x + y + w + d - 1, (c) => plant(c, x + 0.5, y + d - 0.4, 1.3, 1));
    push(x + y + w + d - 0.5, (c) => car(c, x + w - 1.7, y + d - 1.2, T.dark ? '#6b2a2a' : '#b8473f'));
    return;
  }
  if (p.kind === 'park') {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const tx = x + 0.9 + ((i * 2.3) % (w - 1.6));
      const ty = y + 0.8 + ((i * 1.7) % (d - 1.4));
      if (Math.abs(tx - (x + w / 2)) < 0.7 || Math.abs(ty - (y + d / 2)) < 0.7) continue;
      push(tx + ty, (c) => tree(c, tx, ty, 0.9 + (i % 3) * 0.15));
    }
    push(x + w / 2 + y + d / 2, (c) => {
      block(c, x + w / 2 - 0.6, y + d / 2 - 0.6, 1.2, 1.2, 0, 3, T.metal, false);
      floorTile(c, x + w / 2 - 0.45, y + d / 2 - 0.45, 0.9, 0.9, alpha('#5ba8d8', 0.75), 3.01);
    });
    return;
  }
  if (p.kind === 'kitchen') {
    push(x + y + 0.8, (c, t) => kitchen(c, x + 0.3, y + 0.25, Math.min(4.2, w - 0.6), t));
    if (w > 6) {
      push(x + 3.6 + y + 2.6, (c) => pingPong(c, x + 3.6, y + 2.2));
      push(x + 0.4 + y + 3.2, (c) => sofa(c, x + 0.4, y + 3.1, 1.8, T.dark ? '#3b3f48' : '#8d939c'));
    } else {
      push(x + 2.0 + y + 2.4, (c) => {
        block(c, x + 1.8, y + 1.9, 1.4, 0.8, 0, 11, T.desk);
      });
    }
    // People at the counter, chatting.
    const ppl = [
      [x + 1.4, y + 1.35],
      [x + 2.2, y + 1.45],
      [x + 2.6, y + 3.1],
    ];
    ppl.forEach(([px, py], i) => {
      push(px + py + 0.05, (c, t) => {
        person(c, { x: px, y: py, role: ROLE_ORDER[(i * 2 + p.seed) % 5], seed: p.seed * 31 + i * 7, t, walk: 0 });
        if (Math.sin(t * 1.3 + i * 2) > 0.6) talkDots(c, px, py, t);
      });
    });
    push(x + y + w + d - 1.2, (c) => plant(c, x + w - 0.5, y + d - 0.5, 1.2, 2));
    return;
  }
  if (p.kind === 'meeting') {
    const tx = x + 0.9;
    const ty = y + 1.9;
    const tw = w - 1.8;
    const td = 1.1;
    push(tx + ty + 0.2, (c) => meetingTable(c, tx, ty, tw, td));
    const n = p.extras;
    const backN = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const back = i < backN;
      const k = back ? i : i - backN;
      const cnt = back ? backN : n - backN;
      const px = tx + 0.4 + (k + 0.5) * ((tw - 0.4) / Math.max(1, cnt)) - 0.2;
      const py = back ? ty - 0.3 : ty + td + 0.45;
      push(px + py + (back ? 0 : 0.01), (c, t) => {
        person(c, { x: px, y: py, role: ROLE_ORDER[(i + p.seed) % 5], seed: 77 + i * 13, sitting: true, back: !back, t });
        if (!back && Math.sin(t * 0.9 + i * 1.7) > 0.75) talkDots(c, px, py, t);
      });
    }
    push(tx + ty + td + 0.9, (c) => meetingChairsFront(c, tx, ty, tw, td));
    // presenter at the board
    push(x + 2.1 + y + 1.0, (c, t) => person(c, { x: x + 2.1 + Math.sin(t * 0.4) * 0.5, y: y + 1.0, role: 'researcher', seed: 404, t, walk: Math.sin(t * 0.4) !== 0 ? t * 6 : 0 }));
    push(x + y + w + d, (c) => glassFront(c, x, x + w, y + d, 12));
    push(x + w - 0.5 + y + 0.5, (c) => plant(c, x + w - 0.5, y + 0.6, 1.2, 3));
    return;
  }
  if (p.kind === 'server') {
    p.racks.forEach((r, i) => {
      push(r.x + r.y + 0.45, (c, t, env) => rack(c, r.x, r.y, env.training ? 0.5 + 0.5 * Math.sin(t * 3 + i * 0.7) : 0, env.training, t, i, p.h - 2));
    });
    for (const b of p.builds) {
      const bx = x + b.x;
      const by = y + d - 2.0;
      push(bx + by + 1.5, (c) => scaffold(c, bx, by, 1.8, 0.9, 40));
    }
    for (const cr of p.crates) push(cr.x + cr.y + 0.5, (c, t) => secretCrate(c, cr.x, cr.y, t));
    return;
  }
  // Open plan and garage.
  for (const dk of p.desks) {
    const { x: dx, y: dy, role, index } = dk;
    push(dx + dy + 1.0, (c, t) => {
      const occ = index < MAX_PEOPLE;
      const fl = occ ? 0.55 + 0.45 * Math.sin(t * (2 + (index % 5)) + index * 1.3) : 0.08;
      desk(c, dx, dy, role, role === 'engineer', fl, t);
    });
    const cp = chairOf(dk);
    push(dx + dy + 1.8, (c) => chair(c, cp.x - 0.2, cp.y - 0.2));
  }
  if (p.kind === 'desks') {
    // coffee point at the corridor head, plants on the corners
    push(x + 0.3 + y + 1.0, (c) => {
      block(c, x + 0.15, y + 0.5, 0.55, 0.5, 0, 11, T.metalDark, false);
      block(c, x + 0.22, y + 0.56, 0.4, 0.34, 11, 19, T.dark ? '#2a2c31' : '#4a4e56');
    });
    push(x + w - 0.4 + y + d - 0.4, (c) => plant(c, x + w - 0.45, y + d - 0.45, 1.25, p.seed));
    push(x + 0.4 + y + d - 0.4, (c) => plant(c, x + 0.45, y + d - 0.45, 1.0, p.seed + 1));
  } else {
    push(x + 0.6 + y + 1.0, (c) => boxes(c, x + 0.3, y + 0.5, 3));
    push(x + w - 3 + y + 2.6, (c) => car(c, x + w - 2.9, y + 2.4, T.dark ? '#33465a' : '#6c86a3'));
    for (const r of p.racks) push(r.x + r.y + 0.45, (c, t, env) => rack(c, r.x, r.y, env.training ? 0.8 : 0, env.training, t, r.y * 7, 20));
    for (const cr of p.crates) push(cr.x + cr.y + 0.5, (c, t) => secretCrate(c, cr.x, cr.y, t));
    push(x + y + d + 0.5, (c) => plant(c, x + 0.45, y + d - 0.45, 1.0, 4));
  }
}

function talkDots(c: Ctx, x: number, y: number, t: number): void {
  const { g, p } = c;
  const [dx, dy] = project(p, x, y, 30);
  const s = p.scale;
  g.fillStyle = T.tagBg;
  g.beginPath();
  g.ellipse(dx, dy, 6 * s, 3.6 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = T.fg;
  for (let k = 0; k < 3; k++) {
    g.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - k * 0.9));
    g.fillRect(dx + (k - 1) * 2.6 * s - 0.7 * s, dy - 0.7 * s, 1.4 * s, 1.4 * s);
  }
  g.globalAlpha = 1;
}

const SKY_DAY: [string, string] = ['#7fa6c9', '#cfe0ec'];
const SKY_NIGHT: [string, string] = ['#0c1220', '#1d2536'];

export class OfficeScene {
  private layout: Layout | null = null;
  private items: Item[] = [];
  private sigTimer = 0;
  readonly crowd = new Crowd();
  private effects = new Effects();
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private env: Env = { training: false, night: 0, sky: SKY_DAY };
  private order: Person[] = [];
  private cssW = 0;
  private cssH = 0;
  private lastModels = -1;
  private time = 0;
  private state: GameState | null = null;
  private tagRects: { box: Box2; text: string }[] = [];

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.sigTimer = 0;
    if (this.state) this.check(this.state, true);
  }

  private avail(): [number, number] {
    const m = feedMargins(this.cssW, this.cssH);
    return [Math.max(40, this.cssW - m.l - m.r), Math.max(40, this.cssH - m.t - m.b)];
  }

  private check(s: GameState, force: boolean): void {
    const [aw, ah] = this.avail();
    const next = buildLayout(s, aw, ah);
    if (force || !this.layout || next.sig !== this.layout.sig) {
      this.layout = next;
      const items: Item[] = [];
      for (const p of next.pods) podItems(p, items);
      this.items = items.sort((a, b) => a.row - b.row || a.d - b.d);
      this.crowd.sync(next.desks);
      fitTo(this.proj, next.box, this.cssW, this.cssH);
    }
  }

  /** Advance animation and paint one frame. dt in seconds, nowMs = Date.now(). */
  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, nowMs: number): void {
    syncTheme(nowMs);
    this.state = s;
    this.time += dt;
    const t = this.time;
    this.sigTimer -= dt;
    if (!this.layout || this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      this.check(s, false);
    }
    const L = this.layout as Layout;

    // Day and night on a 2-minute loop, nudged by the season.
    const cyc = (nowMs / 1000 / 120) % 1;
    const sun = (1 - Math.cos(cyc * Math.PI * 2)) / 2;
    const dayPhase = (s.day % 365) / 365;
    const night = 1 - smooth(0.28 + 0.03 * Math.sin(dayPhase * Math.PI * 2), 0.6, sun);
    const env = this.env;
    env.night = night;
    env.sky = [mix(SKY_DAY[0], SKY_NIGHT[0], night), mix(SKY_DAY[1], SKY_NIGHT[1], night)];
    env.training = !!s.training;

    this.crowd.update(dt);
    this.trackModels(s);

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    const p = this.proj;
    drawGround(g, p, this.cssW, this.cssH);

    // Rows back to front: each row's shells, then its furniture and people in depth order.
    const order = this.order;
    order.length = 0;
    for (const pe of this.crowd.people) order.push(pe);
    const rowOf = (pe: Person) => this.rowOfDesk(pe.desk);
    order.sort((a, b) => rowOf(a) - rowOf(b) || a.x + a.y - (b.x + b.y));
    const items = this.items;
    let ii = 0;
    let pi = 0;
    for (let r = 0; r < L.rows; r++) {
      for (const pod of L.pods) if (pod.row === r) drawShell(c, pod, env, t);
      while (ii < items.length || pi < order.length) {
        const it = ii < items.length && items[ii].row === r ? items[ii] : null;
        const pe = pi < order.length && rowOf(order[pi]) === r ? order[pi] : null;
        if (!it && !pe) break;
        if (it && (!pe || it.d <= pe.x + pe.y + 0.1)) {
          it.fn(c, t, env);
          ii++;
        } else if (pe) {
          this.paintPerson(c, pe, t);
          pi++;
        }
      }
    }

    // Night: a soft wash, then desk lamps and window light.
    if (night > 0.02) {
      g.fillStyle = T.dark ? `rgba(4,6,14,${(0.32 * night).toFixed(3)})` : `rgba(30,44,80,${(0.1 * night).toFixed(3)})`;
      g.fillRect(0, 0, this.cssW, this.cssH);
      if (p.scale > 0.3) {
        g.save();
        g.globalCompositeOperation = T.dark ? 'lighter' : 'source-over';
        for (const dk of L.desks) {
          const [lx, ly] = project(p, dk.x + 0.65, dk.y + 0.3, 16);
          glow(g, lx, ly, 22 * p.scale, T.lamp, (T.dark ? 0.12 : 0.06) * night);
        }
        g.restore();
      }
    }
    if (env.training) {
      const sv = L.pods.find((q) => q.kind === 'server') ?? L.pods.find((q) => q.racks.length > 0);
      if (sv) {
        g.save();
        g.globalCompositeOperation = T.dark ? 'lighter' : 'source-over';
        const [wx, wy] = project(p, sv.x + sv.w / 2, sv.y + sv.d / 2, 20);
        glow(g, wx, wy, 70 * p.scale, T.hl, (T.dark ? 0.14 : 0.08) + 0.05 * Math.sin(t * 2));
        g.restore();
      }
    }

    // Money from the sales desks, confetti on a new model.
    if (s.finance.dailyRevenue > 0 && L.salesDesks.length > 0) {
      const pts = L.salesDesks.map((d) => project(p, d.x + 0.65, d.y + 0.3, 30) as [number, number]);
      this.effects.money(pts, dt, true, '+$');
    } else this.effects.money([], dt, false, '+$');
    this.effects.step(g, dt);

    this.drawTags(g, L, s, t);

    const parts: HudPart[] = [
      [tierName(s), T.fg],
      [`${L.headcount} staff`, T.fg2],
      [`${formatNumber(L.gpus, 1)} GPUs`, T.fg2],
    ];
    if (s.finance.cash < 0) parts.unshift(['Cash negative', Math.sin(t * 6) > 0 ? T.down : shade(T.down, 0.6)]);
    hud(g, this.cssW, this.cssH, parts);
  }

  private rowOfDesk(d: DeskSlot): number {
    const L = this.layout;
    if (!L) return 0;
    for (const p of L.pods) if (p.desks.length && p.desks[0].stops === d.stops) return p.row;
    return 0;
  }

  private paintPerson(c: Ctx, pe: Person, t: number): void {
    const sitting = pe.state === 'sit';
    const [hx, hy] = person(c, {
      x: pe.x,
      y: pe.y,
      role: pe.role,
      seed: pe.seed,
      sitting,
      typing: sitting,
      back: sitting || (pe.state === 'walk' && pe.away),
      walk: pe.state === 'walk' ? pe.walkPhase : 0,
      t,
    });
    pe.sx = hx;
    pe.sy = hy + 6 * c.p.scale;
  }

  private drawTags(g: CanvasRenderingContext2D, L: Layout, s: GameState, t: number): void {
    const p = this.proj;
    this.tagRects = [];
    const small = this.cssW < 520;
    const size = small ? 10 : 11;
    const placed: Box2[] = [];
    const free = (x: number, y: number, w: number, h: number) =>
      !placed.some((b) => x < b.x1 + 2 && x + w > b.x0 - 2 && y < b.y1 && y + h > b.y0);
    // Priority: the training run and server room, the desk rooms, then the rest. A tag that would cover one already
    // placed is left off (its room still answers to hover).
    const rank = (k: PodKind) => (k === 'server' ? 0 : k === 'desks' || k === 'garage' ? 1 : 2);
    const pods = [...L.pods].sort((a, b) => rank(a.kind) - rank(b.kind));
    for (const pod of pods) {
      // Tags sit on the end of the left wall, inside the room's own box, so they never need extra margin.
      const [lx, ly] = project(p, pod.x, pod.y + pod.d, pod.h);
      const tx = lx - 2;
      const ty = ly - 3;
      let text = pod.name;
      let value: string | undefined;
      let color = T.fg3;
      let progress: number | undefined;
      let tip = this.podTip(pod, L, s);
      if (pod.kind === 'desks' || pod.kind === 'garage') {
        value = `${pod.desks.length}`;
        color = T.hl;
      } else if (pod.kind === 'server') {
        value = formatNumber(L.gpus, 1);
        color = T.up;
        if (s.training) {
          const tr = s.training;
          progress = tr.totalFlops > 0 ? Math.min(1, Math.max(0, tr.doneFlops / tr.totalFlops)) : 0;
          text = 'Training';
          value = `${Math.round(progress * 100)}%`;
          color = T.hl;
          tip = `Training ${tr.name}: ${value} done\n${tip}`;
        }
      } else if (pod.kind === 'meeting') value = `${pod.extras}`;
      const w = tagWidth(g, text, { value, size });
      const h = size + 7;
      if (!free(tx, ty - h, w, h)) continue;
      const box = tag(g, tx, ty, text, color, { value, progress, size, align: 'left' });
      placed.push(box);
      this.tagRects.push({ box, text: tip });
    }
    for (const pod of L.pods) {
      for (const b of pod.builds) {
        const [bx, by] = project(p, pod.x + b.x + 0.9, pod.y + pod.d - 0.6, 0);
        const w = tagWidth(g, 'Build', { value: '00d', size: 10 });
        if (!free(bx - w / 2, by - 9, w, 17)) continue;
        placed.push(tag(g, bx, by, 'Build', T.warn, { value: `${Math.ceil(b.days)}d`, size: 10, anchor: 'center', alpha: 0.85 + 0.15 * Math.sin(t * 3) }));
      }
    }
    if (L.overflow > 0) {
      const last = [...L.pods].reverse().find((q) => q.kind === 'desks' || q.kind === 'garage');
      if (last) {
        const [ox, oy] = project(p, last.x + last.w, last.y + last.d, 0);
        tag(g, ox, oy + 4, `+${L.overflow} more staff`, T.hl, { size: 10, anchor: 'center' });
      }
    }
  }

  private podTip(pod: Pod, L: Layout, s: GameState): string {
    switch (pod.kind) {
      case 'desks':
      case 'garage': {
        const by = new Map<string, number>();
        for (const d of pod.desks) by.set(d.role, (by.get(d.role) ?? 0) + 1);
        const parts = [...by.entries()].map(([r, n]) => `${n} ${ROLE_NAME[r as Role].toLowerCase()}${n === 1 ? '' : 's'}`);
        return `${pod.kind === 'garage' ? tierName(s) : pod.name}: ${pod.desks.length} desks\n${parts.join(', ') || 'Nobody yet'}`;
      }
      case 'server':
        return `Server room: ${L.gpus.toLocaleString()} GPUs\n${pod.racks.length} racks${L.building ? `, ${L.building} datacenter${L.building === 1 ? '' : 's'} being built` : ''}${pod.crates.length ? `\n${pod.crates.length} unreleased model${pod.crates.length === 1 ? '' : 's'} in crates` : ''}`;
      case 'meeting':
        return `Meeting room: ${pod.extras} people in a meeting that could have been an email`;
      case 'kitchen':
        return `${pod.name}: where the real decisions are made`;
      case 'house':
        return "Mom's house: the rent is fine";
      default:
        return `${pod.name}: ${tierName(s)}`;
    }
  }

  /** Confetti burst when a new model appears. */
  private trackModels(s: GameState): void {
    const n = s.models.length;
    if (this.lastModels >= 0 && n > this.lastModels) this.effects.burst(this.cssW / 2, this.cssH * 0.3, 60);
    this.lastModels = n;
  }

  /** Hit-test people against the last drawn frame. */
  hitTest(mx: number, my: number): Person | null {
    const r = Math.max(8, 13 * this.proj.scale);
    let best: Person | null = null;
    let bestD = r * r;
    for (const pe of this.crowd.people) {
      const dx = pe.sx - mx;
      const dy = pe.sy - my;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = pe;
      }
    }
    return best;
  }

  roleLabel(pe: Person): string {
    return `${ROLE_NAME[pe.role] ?? pe.role} · desk ${pe.desk.index + 1}`;
  }

  /** Tip under a point: a person first, then a room tag or a room. */
  tipAt(mx: number, my: number): string | null {
    const pe = this.hitTest(mx, my);
    if (pe) return this.roleLabel(pe);
    for (const r of this.tagRects) if (mx >= r.box.x0 && mx <= r.box.x1 && my >= r.box.y0 && my <= r.box.y1) return r.text;
    const L = this.layout;
    const s = this.state;
    if (!L || !s) return null;
    for (const z of [0, 14]) {
      const [fx, fy] = floorAt(this.proj, mx, my, z);
      for (const pod of L.pods) {
        if (fx >= pod.x && fx <= pod.x + pod.w && fy >= pod.y && fy <= pod.y + pod.d) return this.podTip(pod, L, s);
      }
    }
    return null;
  }
}
