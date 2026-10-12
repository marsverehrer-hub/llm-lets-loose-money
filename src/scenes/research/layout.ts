// Research lab geometry: room constants, pod and desk positions, and how researchers are spread over the branches.
// Pure data. Nothing here draws or reads GameState except the allocation helper.
import { RESEARCH_BRANCHES, type ResearchBranch } from '../../sim/types';
import { RESEARCH } from '../../sim/data/research';

export const WALL_H = 60;

/** Desk slots per branch pod (3 across, 2 deep). */
export const SLOTS = 6;

// Pods: 4 columns x 3 rows. 11 branches fill the first 11 cells; the last cell is the coffee nook.
const COLS = 4;
const ROWS = 3;
const PW = 4.2; // pod width along x
const PD = 3.4; // pod depth along y (whiteboard at the back, two desk rows)
const AISLE_X = 0.5;
const AISLE_Y = 0.6;
const PX0 = 0.8;
const PY0 = 2.6;
export const ROOM_W = PX0 + COLS * PW + (COLS - 1) * AISLE_X + 0.8;
export const ROOM_D = PY0 + ROWS * PD + (ROWS - 1) * AISLE_Y + 0.8;

export const POD_W = PW;
export const POD_D = PD;
export const DESK_W = 1.2;
export const DESK_D = 0.7;
export const DESK_TOP = 12;

export const BOARD_Z0 = 24;
export const BOARD_Z1 = 44;

/** Central projector on the back wall (y = 0). */
export const PROJ_X0 = ROOM_W / 2 - 3.2;
export const PROJ_X1 = ROOM_W / 2 + 3.2;
export const PROJ_Z0 = 18;
export const PROJ_Z1 = 48;

/** "Next up" board on the left wall (x = 0). */
export const QUEUE_Y0 = 3.2;
export const QUEUE_Y1 = 9.0;
export const QUEUE_Z0 = 15;
export const QUEUE_Z1 = 50;

/** Star bay: a row of highlighted desks along the back wall, right of the projector. */
export const STAR_Y = 0.7;
export const STAR_X0 = 14.3;
export const STAR_STEP = 1.4;
export const STAR_MAX = 4;
export const STAR_BAY_X1 = STAR_X0 + STAR_STEP * (STAR_MAX - 1) + DESK_W + 0.2;

export const COFFEE = { x: 15.2, y: 10.9 };
export const PLANT = { x: 18.9, y: 13.4 };
export const LOUNGE = { x: 16.9, y: 12.3 };
/** People drawn in the lounge while idle. Everyone else is counted in a pill. */
export const LOUNGE_SHOW = 16;

export interface Pod {
  /** Index into RESEARCH_BRANCHES. */
  i: number;
  branch: ResearchBranch;
  px: number;
  py: number;
}

export const PODS: Pod[] = RESEARCH_BRANCHES.map((branch, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return { i, branch, px: PX0 + col * (PW + AISLE_X), py: PY0 + row * (PD + AISLE_Y) };
});

/** Top-left of desk slot k in a pod. Slots run left to right, then the second row. */
export function deskXY(pod: Pod, k: number): [number, number] {
  const col = k % 3;
  const row = Math.floor(k / 3);
  return [pod.px + 0.15 + col * 1.35, pod.py + 0.95 + row * 1.5];
}

/** Floor point where the person in desk slot k sits (the chair centre). */
export function seatXY(pod: Pod, k: number): [number, number] {
  const [dx, dy] = deskXY(pod, k);
  return [dx + 0.6, dy + 0.98];
}

export function starDeskXY(j: number): [number, number] {
  return [STAR_X0 + j * STAR_STEP, STAR_Y];
}

export function starSeatXY(j: number): [number, number] {
  const [dx, dy] = starDeskXY(j);
  return [dx + 0.6, dy + 0.98];
}

/** Standing spot in the coffee lounge: an arc in front of the machine, ring by ring. */
export function loungeSpot(i: number): [number, number] {
  const ring = Math.floor(i / 8);
  const k = i % 8;
  const ang = Math.PI * (0.15 + (k / 7) * 0.7);
  const r = 1.0 + ring * 0.9;
  return [LOUNGE.x + Math.cos(ang) * r * 1.1, LOUNGE.y + Math.sin(ang) * r];
}

/** Research nodes per branch: the lab's desks follow the size of the tree. */
const NODES_PER_BRANCH: number[] = RESEARCH_BRANCHES.map(
  (b) => RESEARCH.filter((n) => (n.branch ?? RESEARCH_BRANCHES[0]) === b).length,
);

/**
 * Split `total` researchers over the pods by largest remainder, weighted by how many topics each branch holds.
 * Returns one count per pod, in RESEARCH_BRANCHES order, summing to `total`.
 */
export function allocateResearchers(total: number): number[] {
  const W = NODES_PER_BRANCH.reduce((a, b) => a + b, 0) || 1;
  const quota = NODES_PER_BRANCH.map((w) => (total * w) / W);
  const out = quota.map((q) => Math.floor(q));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = quota.map((_, i) => i).sort((a, b) => quota[b] - out[b] - (quota[a] - out[a]));
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k]]++;
  return out;
}

/** Number of topics in each branch, in RESEARCH_BRANCHES order. */
export const TOPICS_PER_BRANCH: number[] = NODES_PER_BRANCH;

/** Convex hull of flat [x0,y0,x1,y1,...] points, flat output in counter-clockwise order. */
export function convexHull(flat: number[]): number[] {
  const P: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) P.push([flat[i], flat[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const out: number[] = [];
  for (const [x, y] of lower.concat(upper)) out.push(x, y);
  return out;
}

/** True when (x, y) is inside a convex polygon from convexHull. */
export function inHull(h: number[], x: number, y: number): boolean {
  const n = h.length / 2;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = (h[2 * j] - h[2 * i]) * (y - h[2 * i + 1]) - (h[2 * j + 1] - h[2 * i + 1]) * (x - h[2 * i]);
    if (c === 0) continue;
    const sg = c > 0 ? 1 : -1;
    if (sign === 0) sign = sg;
    else if (sign !== sg) return false;
  }
  return true;
}
