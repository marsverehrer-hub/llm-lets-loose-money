// Pure logic behind the Data screen: treemap geometry, catalogue filters and sort, the merged risk reading, and the
// hero numbers. The sim is read through its own helpers, so these tests also check the numbers match training's.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../../sim/state';
import { DATASETS } from '../../../sim/data/datasets';
import { dataStats, type DatasetRow } from '../../../sim/systems/data';
import type { GameState } from '../../../sim/types';
import { squarify, layoutGroups } from './treemap';
import {
  DEFAULT_VIEW,
  activeFilterCount,
  clearedView,
  filterRows,
  hasSomethingToClear,
  heroNumbers,
  mergedRisk,
  ownedItems,
  qualityShade,
  sortRows,
  type CatalogueView,
} from './model';

function fresh(): GameState {
  const s = createInitialState(12345, 'Test Co');
  s.finance.cash = 1e12;
  return s;
}

function rowsOf(ids: string[], status: DatasetRow['status']): DatasetRow[] {
  return ids.map((id) => ({ def: DATASETS.find((d) => d.id === id)!, status }));
}

describe('squarify', () => {
  it('packs rectangles whose areas follow the values and stay inside the box', () => {
    const box = { x: 0, y: 0, w: 300, h: 200 };
    const values = [50, 30, 10, 5, 5];
    const total = values.reduce((a, b) => a + b, 0);
    const rects = squarify(values, box);
    rects.forEach((r, i) => {
      expect(r.w * r.h).toBeCloseTo((values[i] / total) * box.w * box.h, 4);
      expect(r.x).toBeGreaterThanOrEqual(box.x - 1e-9);
      expect(r.y).toBeGreaterThanOrEqual(box.y - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
    });
  });

  it('gives zero-size rectangles to zero values and copes with an empty list', () => {
    expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    const rects = squarify([0, 4, 0], { x: 0, y: 0, w: 10, h: 10 });
    expect(rects[0].w * rects[0].h).toBe(0);
    expect(rects[1].w * rects[1].h).toBeCloseTo(100, 6);
    expect(rects[2].w * rects[2].h).toBe(0);
  });
});

describe('layoutGroups', () => {
  const items = [
    { id: 'a', value: 500, group: 'web' },
    { id: 'b', value: 300, group: 'web' },
    { id: 'c', value: 200, group: 'code' },
    { id: 'tiny', value: 0.001, group: 'code' },
  ];

  it('keeps every tile inside its own domain group, largest domain first', () => {
    const groups = layoutGroups(items, { x: 0, y: 0, w: 400, h: 240 }, { minShare: 0, head: 0, gap: 0 });
    expect(groups.map((g) => g.key)).toEqual(['web', 'code']);
    for (const g of groups) {
      for (const t of g.tiles) {
        expect(t.rect.x).toBeGreaterThanOrEqual(g.rect.x - 1e-6);
        expect(t.rect.y).toBeGreaterThanOrEqual(g.rect.y - 1e-6);
        expect(t.rect.x + t.rect.w).toBeLessThanOrEqual(g.rect.x + g.rect.w + 1e-6);
        expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(g.rect.y + g.rect.h + 1e-6);
      }
    }
  });

  it('draws a tiny set at a visible floor so it stays clickable', () => {
    const groups = layoutGroups(items, { x: 0, y: 0, w: 400, h: 240 }, { minShare: 0.05, head: 0, gap: 0 });
    const tiny = groups.flatMap((g) => g.tiles).find((t) => t.item.id === 'tiny')!;
    expect(tiny.rect.w * tiny.rect.h).toBeGreaterThan(0.04 * 400 * 240);
  });

  it('gives no label strip to a group too short for one', () => {
    const groups = layoutGroups(items, { x: 0, y: 0, w: 400, h: 20 }, { minShare: 0, head: 18, gap: 0 });
    expect(groups.every((g) => g.head === 0)).toBe(true);
  });
});

describe('catalogue view', () => {
  it('starts with no active filters and nothing to clear', () => {
    expect(activeFilterCount(DEFAULT_VIEW)).toBe(0);
    expect(hasSomethingToClear(DEFAULT_VIEW)).toBe(false);
  });

  it('counts only filters set away from their default, not sort or search', () => {
    const v: CatalogueView = { ...DEFAULT_VIEW, status: 'all', kind: 'web', sort: 'cost', desc: false, query: '' };
    expect(activeFilterCount(v)).toBe(2);
    expect(activeFilterCount({ ...DEFAULT_VIEW, query: 'books' })).toBe(0);
    expect(hasSomethingToClear({ ...DEFAULT_VIEW, query: 'books' })).toBe(true);
  });

  it('clears filters and search but keeps the sort the player chose', () => {
    const v: CatalogueView = { ...DEFAULT_VIEW, status: 'lost', query: 'x', sort: 'quality', desc: false };
    const c = clearedView(v);
    expect(c).toEqual({ ...DEFAULT_VIEW, sort: 'quality', desc: false });
  });

  it('defaults to what you own plus what you can buy now', () => {
    const rows = [...rowsOf(['scrawl_sample'], 'owned'), ...rowsOf(['wikipediaish'], 'available'), ...rowsOf(['bookcorpse'], 'locked'), ...rowsOf(['reddit_dump'], 'lost')];
    const kept = filterRows(fresh(), rows, DEFAULT_VIEW).map((r) => r.status);
    expect(kept.sort()).toEqual(['available', 'owned']);
  });

  it('search matches the set name, its domain and its kind, case-insensitively', () => {
    const rows = rowsOf(['scrawl_sample', 'wikipediaish', 'bookcorpse'], 'available');
    const hits = filterRows(fresh(), rows, { ...DEFAULT_VIEW, status: 'all', query: 'BOOK' });
    expect(hits.map((r) => r.def.id)).toEqual(['bookcorpse']);
  });

  it('sorts by tokens, largest first by default, and keeps the input untouched', () => {
    const s = fresh();
    const rows = rowsOf(['scrawl_sample', 'wikipediaish', 'bookcorpse'], 'available');
    const before = rows.map((r) => r.def.id);
    const sorted = sortRows(s, rows, 'tokens', true).map((r) => r.def.tokensB);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
    expect(rows.map((r) => r.def.id)).toEqual(before);
  });
});

describe('merged risk', () => {
  it('shows the worse of legal and reputation risk, with both in the tooltip', () => {
    const base = DATASETS[0];
    const high = mergedRisk({ ...base, legalRisk: 0.6, reputationRisk: 0.1 });
    expect(high.label).toBe('High risk');
    expect(high.tone).toBe('bad');
    expect(high.legal).toMatch(/^High/);
    expect(high.reputation).toMatch(/^Low/);

    const mid = mergedRisk({ ...base, legalRisk: 0.1, reputationRisk: 0.3 });
    expect(mid.label).toBe('Medium risk');
  });
});

describe('hero numbers', () => {
  it('reads zero owned sets as no tokens and no quality', () => {
    const s = fresh();
    s.data.owned = [];
    const h = heroNumbers(s);
    expect(h.owned).toBe(0);
    expect(h.uniqueTokensB).toBe(0);
    expect(h.avgQuality).toBeNull();
  });

  it('unique tokens match the sim total, and average quality is a fraction of 0..1', () => {
    const s = fresh();
    s.data.owned = ['scrawl_sample', 'wikipediaish', 'bookcorpse'];
    const h = heroNumbers(s);
    expect(h.uniqueTokensB).toBeCloseTo(dataStats(s).totalTokensB, 9);
    expect(h.owned).toBe(3);
    expect(h.avgQuality).not.toBeNull();
    expect(h.avgQuality!).toBeGreaterThanOrEqual(0);
    expect(h.avgQuality!).toBeLessThanOrEqual(1);
  });

  it('counts unverified owned sets, and the treemap lists every owned set', () => {
    const s = fresh();
    s.data.owned = ['scrawl_sample', 'wikipediaish'];
    s.lab = { ...(s.lab ?? {}), verifiedData: ['wikipediaish'] } as GameState['lab'];
    expect(heroNumbers(s).unverified).toBe(1);
    const items = ownedItems(s);
    expect(items.map((i) => i.id).sort()).toEqual(['scrawl_sample', 'wikipediaish']);
    expect(items.find((i) => i.id === 'wikipediaish')!.verified).toBe(true);
  });
});

describe('quality shade', () => {
  it('is a token mix that gets bluer as quality rises', () => {
    expect(qualityShade(0.1)).toMatch(/^color-mix\(in srgb, var\(--blue\) \d+%, var\(--bg-3\)\)$/);
    const pctOf = (css: string) => Number(/var\(--blue\) (\d+)%/.exec(css)![1]);
    expect(pctOf(qualityShade(0.9))).toBeGreaterThan(pctOf(qualityShade(0.2)));
  });
});
