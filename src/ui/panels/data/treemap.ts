// Squarified treemap layout (Bruls, Huijsmans, van Wijk). Pure geometry: no DOM, no state.
// Two levels: domains are laid out by their total tokens, then each domain's sets inside its own box.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst aspect ratio of a row of areas laid along a side of length `side`. Lower is squarer. */
function worstRatio(areas: number[], side: number): number {
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  if (sum <= 0 || min <= 0 || side <= 0) return Infinity;
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/**
 * Rectangles for `values` (in the given order) packed into `box`, with areas proportional to the values. Values of
 * zero or less get a zero-area rectangle. Put the largest values first for the best shapes.
 */
export function squarify(values: number[], box: Rect): Rect[] {
  const n = values.length;
  const out: Rect[] = values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (n === 0 || total <= 0 || box.w <= 0 || box.h <= 0) return out;

  const scale = (box.w * box.h) / total;
  const areas = values.map((v) => Math.max(0, v) * scale);
  let rect: Rect = { ...box };
  let i = 0;
  while (i < n) {
    // Skip zero-area values so they never end up in a row.
    if (areas[i] <= 0) {
      i += 1;
      continue;
    }
    const side = Math.min(rect.w, rect.h);
    let end = i + 1;
    let row = [areas[i]];
    while (end < n && areas[end] > 0) {
      const cand = [...row, areas[end]];
      if (worstRatio(cand, side) <= worstRatio(row, side)) {
        row = cand;
        end += 1;
      } else {
        break;
      }
    }
    const sum = row.reduce((a, b) => a + b, 0);
    if (rect.w >= rect.h) {
      // A column on the left, as wide as the row needs to be.
      const colW = sum / rect.h;
      let y = rect.y;
      for (let k = i; k < end; k += 1) {
        const h = areas[k] / colW;
        out[k] = { x: rect.x, y, w: colW, h };
        y += h;
      }
      rect = { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
    } else {
      // A row across the top, as tall as the row needs to be.
      const rowH = sum / rect.w;
      let x = rect.x;
      for (let k = i; k < end; k += 1) {
        const w = areas[k] / rowH;
        out[k] = { x, y: rect.y, w, h: rowH };
        x += w;
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
    }
    i = end;
  }
  return out;
}

export interface TileLayout<T> {
  item: T;
  rect: Rect;
}

export interface GroupLayout<T> {
  key: string;
  /** Total of the (floored) values in the group. */
  value: number;
  rect: Rect;
  /** Height of the label strip at the top of the group. 0 when the group is too small for a label. */
  head: number;
  tiles: TileLayout<T>[];
}

export interface TokenMapOptions {
  /** Smallest share of the whole a set is drawn at, so tiny sets stay visible and clickable. */
  minShare: number;
  /** Label strip height for groups tall enough to carry one. */
  head: number;
  /** Space between tiles, in px. */
  gap: number;
}

/**
 * Two-level token map: one group per key (domain), each holding its items. Area follows `value` (floored at
 * `minShare` of the whole). Groups and items come back largest first.
 */
export function layoutGroups<T extends { value: number; group: string }>(
  items: T[],
  box: Rect,
  opts: TokenMapOptions,
): GroupLayout<T & { shown: number }>[] {
  if (items.length === 0 || box.w <= 0 || box.h <= 0) return [];
  const total = items.reduce((a, it) => a + Math.max(0, it.value), 0);
  const floor = total * opts.minShare;
  const shown = items.map((it) => ({ ...it, shown: Math.max(it.value, floor) }));

  const byGroup = new Map<string, (T & { shown: number })[]>();
  for (const it of shown) {
    const list = byGroup.get(it.group) ?? [];
    list.push(it);
    byGroup.set(it.group, list);
  }
  const groups = [...byGroup.entries()]
    .map(([key, list]) => ({
      key,
      list: [...list].sort((a, b) => b.shown - a.shown),
      value: list.reduce((a, it) => a + it.shown, 0),
    }))
    .sort((a, b) => b.value - a.value);

  const groupRects = squarify(
    groups.map((g) => g.value),
    box,
  );

  return groups.map((g, gi) => {
    const r = groupRects[gi];
    const head = r.h >= opts.head * 2.5 ? opts.head : 0;
    const inner: Rect = {
      x: r.x + 1,
      y: r.y + head + 1,
      w: Math.max(0, r.w - 2),
      h: Math.max(0, r.h - head - 2),
    };
    const tileRects = squarify(
      g.list.map((it) => it.shown),
      inner,
    );
    return {
      key: g.key,
      value: g.value,
      rect: r,
      head,
      tiles: g.list.map((it, ti) => ({ item: it, rect: tileRects[ti] })),
    };
  });
}
