// Research lab geometry: one lab island per research branch (whiteboard, experiment rig, two rows of benches), plus
// islands for the projector (current topic), the "next up" board, the star bay and the coffee lounge. Islands sit on
// the kit's staggered lattice, so the lab fills the frame at any size. Pure data; nothing here draws.
import { RESEARCH_BRANCHES, type ResearchBranch } from '../../sim/types';
import { RESEARCH } from '../../sim/data/research';
import { lattice } from '../kit';

export const CELL = 4.4;
export const ISLE = 4.0;
/** Desk slots per branch island (3 across, 2 deep). */
export const SLOTS = 6;
export const DESK_W = 0.95;
export const DESK_D = 0.55;
export const DESK_TOP = 10;
export const WALL_H = 32;
export const BOARD_Z0 = 12;
export const BOARD_Z1 = 29;
export const STAR_MAX = 4;
/** People drawn in the lounge while idle. Everyone else is counted in a tag. */
export const LOUNGE_SHOW = 16;

export interface Pod {
  /** Index into RESEARCH_BRANCHES. */
  i: number;
  branch: ResearchBranch;
  px: number;
  py: number;
  line: number;
}

export interface Spot {
  x: number;
  y: number;
  line: number;
}

export interface Room {
  pods: Pod[];
  proj: Spot;
  queue: Spot;
  stars: Spot;
  lounge: Spot;
  lines: number;
}

/** Lay the lab out for a W x H canvas: the projector and the queue first, then the branches, the star bay, the lounge. */
export function buildRoom(W: number, H: number): Room {
  const n = RESEARCH_BRANCHES.length + 4;
  const cells = lattice(n, CELL, 0.4, WALL_H + 6, W, H);
  const at = (k: number): Spot => {
    const c = cells[k] ?? { x: 0, y: 0, line: 0 };
    return { x: c.x + (CELL - ISLE) / 2, y: c.y + (CELL - ISLE) / 2, line: c.line };
  };
  const proj = at(0);
  const queue = at(1);
  const pods = RESEARCH_BRANCHES.map((branch, i) => {
    const s = at(i + 2);
    return { i, branch, px: s.x, py: s.y, line: s.line };
  });
  const stars = at(n - 2);
  const lounge = at(n - 1);
  const lines = cells.length ? cells[cells.length - 1].line + 1 : 1;
  return { pods, proj, queue, stars, lounge, lines };
}

/** Top-left of desk slot k in a pod. Slots run left to right, then the second row. */
export function deskXY(pod: Pod, k: number): [number, number] {
  const col = k % 3;
  const row = Math.floor(k / 3);
  return [pod.px + 0.35 + col * 1.15, pod.py + 1.35 + row * 1.3];
}

/** Floor point where the person in desk slot k sits (the chair centre). */
export function seatXY(pod: Pod, k: number): [number, number] {
  const [dx, dy] = deskXY(pod, k);
  return [dx + DESK_W / 2, dy + DESK_D + 0.35];
}

export function starDeskXY(room: Room, j: number): [number, number] {
  return [room.stars.x + 0.5 + (j % 2) * 1.6, room.stars.y + 1.0 + Math.floor(j / 2) * 1.4];
}

export function starSeatXY(room: Room, j: number): [number, number] {
  const [dx, dy] = starDeskXY(room, j);
  return [dx + DESK_W / 2, dy + DESK_D + 0.35];
}

/** Standing spot in the coffee lounge: rings around the middle of the island. */
export function loungeSpot(room: Room, i: number): [number, number] {
  const ring = Math.floor(i / 8);
  const k = i % 8;
  const ang = (k / 8) * Math.PI * 2 + ring * 0.4;
  const r = 0.75 + ring * 0.7;
  return [room.lounge.x + 2.2 + Math.cos(ang) * r, room.lounge.y + 2.2 + Math.sin(ang) * r];
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
