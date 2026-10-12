// Data warehouse scene: the player's owned data as an isometric warehouse. Shelving has one aisle per data domain,
// filled with crates (tokens / unit, quality shades the crate), with warning tags for unverified or risky sets and a
// red "legal" sticker for high-risk scraped sets. Data ops: crawler (pipe in), refinery, job workers, startup streams
// (belts from outside), and a forklift that carries crates to the "training" door while a run is on.
//
// SceneHit ids:
//   domain:<domain>  a shelving aisle. Tip: sets, tokens, crates, average quality, warning and legal counts.
//   crawler          the crawler machine (only once one is built). Tip: tier, status, tokens per day, lifetime crawl.
//   refinery         the refinery. Tip: busy lines and their jobs.
//   jobs             the dock where bounty, archive and distillation jobs land. Tip: jobs in flight.
//   stream:<id>      a startup stream's belt. Tip: domain, tokens per day, days left, dataset.
// Not clickable: the training door (its pill lights up while a run is on).
import type { GameState } from '../../sim/types';
import { datasetById } from '../../sim/systems/data';
import { crawlBlocked, crawlYieldPerDayB, refineLevelDef } from '../../sim/systems/dataOps';
import { TILE_H, TILE_W, type Projector } from '../../office/iso';
import { C } from '../../office/palette';
import { Ctx } from '../../office/draw/prims';
import { WALL_H, drawFloor, drawNeonStrip, drawWalls } from '../../office/draw/room';
import type { Scene, SceneHit } from '../types';
import { MIN_X, buildLayout, DOMAIN_NAME, fmtTokens, type HitBox, type Layout, type SetView } from './layout';
import { boxContains, buildMovers, buildStatics, drawFloorLayer, drawOverlay, type Item } from './draw';

const FLOOR_A = '#2b2a27';
const FLOOR_B = '#262522';
const TRIM = '#34312c';
const SIG_EVERY = 0.25;

class DataScene implements Scene {
  private L: Layout | null = null;
  private statics: Item[] = [];
  private sigTimer = 0;
  private time = 0;
  private cssW = 0;
  private cssH = 0;
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private s: GameState | null = null;

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
  }

  /** Fit the warehouse (x from MIN_X to W, y from 0 to D, height WALL_H) into the canvas. */
  private fit(): void {
    const L = this.L;
    if (!L) return;
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const X = L.W - MIN_X;
    const Y = L.D;
    const cx = (MIN_X + L.W) / 2;
    const cy = L.D / 2;
    const s = Math.min(availW / ((X + Y) * TILE_W / 2), availH / ((X + Y) * TILE_H / 2 + WALL_H), 2.6);
    const sc = Math.max(0.3, s);
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - ((cx - cy) * TILE_W / 2) * sc;
    this.proj.oy = this.cssH / 2 - ((cx + cy) * TILE_H / 2 - WALL_H / 2) * sc;
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.time += dt;
    const t = this.time;
    this.s = s;

    // Layout only changes when its signature does; check a few times a second.
    this.sigTimer -= dt;
    if (!this.L || this.sigTimer <= 0) {
      this.sigTimer = SIG_EVERY;
      const next = buildLayout(s);
      if (!this.L || next.sig !== this.L.sig) {
        this.L = next;
        this.statics = buildStatics(next);
        this.fit();
      }
    }
    const L = this.L as Layout;

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;

    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    drawFloor(c, L.W, L.D, 2, FLOOR_A, FLOOR_B);
    drawWalls(c, L.W, L.D, WALL_H, TRIM);
    drawNeonStrip(c, L.W, L.D, WALL_H, t);
    drawFloorLayer(c, L, s);

    // Statics and movers, merged by depth so workers and the forklift pass in front of and behind the shelves.
    const movers = buildMovers(L, s, t);
    movers.sort((a, b) => a.d - b.d);
    const st = this.statics;
    let si = 0;
    for (const m of movers) {
      while (si < st.length && st[si].d <= m.d) {
        st[si].fn(c, t);
        si++;
      }
      m.fn(c, t);
    }
    for (; si < st.length; si++) st[si].fn(c, t);

    drawOverlay(c, L, s, t);

    // HUD, bottom right (same place as the office HUD).
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(
      `${L.sets.length} SETS · ${fmtTokens(L.totalTokensB)} TOKENS · ${L.totalCrates} CRATES`.toUpperCase(),
      this.cssW - 10,
      this.cssH - 8,
    );
    g.restore();

  }

  hitTest(x: number, y: number): SceneHit | null {
    const L = this.L;
    const s = this.s;
    if (!L || !s) return null;
    let best: HitBox | null = null;
    let bestDepth = -Infinity;
    for (const h of L.hits) {
      if (!boxContains(this.proj, h, x, y)) continue;
      const depth = h.x1 + h.y1;
      if (depth > bestDepth) {
        best = h;
        bestDepth = depth;
      }
    }
    if (!best) return null;
    return { id: best.id, label: tipFor(best.id, L, s) };
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Tip text for a hit id, from the live state. */
function tipFor(id: string, L: Layout, s: GameState): string {
  const day = s.day;
  if (id.startsWith('domain:')) {
    const dom = id.slice('domain:'.length) as keyof typeof DOMAIN_NAME;
    const a = L.aisles.find((x) => x.domain === dom);
    const name = DOMAIN_NAME[dom] ?? dom;
    if (!a || a.sets.length === 0) {
      const streams = L.belts.filter((b) => b.domain === dom).length;
      const jobs = L.jobs.filter((j) => j.domain === dom).length;
      return `${name} shelf\nNo sets yet\nInbound: ${streams} stream${streams === 1 ? '' : 's'}, ${jobs} job${jobs === 1 ? '' : 's'}`;
    }
    const sets: SetView[] = a.sets;
    const tokens = sets.reduce((acc, v) => acc + v.tokensB, 0);
    const avgQ = Math.round((sets.reduce((acc, v) => acc + v.q, 0) / sets.length) * 100);
    const unverified = sets.filter((v) => !v.verified).length;
    const risky = sets.filter((v) => v.risky).length;
    const legal = sets.filter((v) => v.legal).length;
    const largest = sets.reduce((best, v) => (v.tokensB > best.tokensB ? v : best), sets[0]);
    const lines = [
      `${name} shelf`,
      `${plural(sets.length, 'set')} · ${fmtTokens(tokens)} tokens · ${plural(a.total, 'crate')}`,
      `Average quality ${avgQ}%`,
      `Largest: ${largest.name} (${fmtTokens(largest.tokensB)})`,
    ];
    if (unverified > 0) lines.push(`${unverified} unverified (yellow tag)`);
    if (risky > 0) lines.push(`${risky} risky`);
    if (legal > 0) lines.push(`${legal} high legal risk (red sticker)`);
    if (a.overflow > 0) lines.push(`${a.overflow} more crates on the pallet stack`);
    return lines.join('\n');
  }

  if (id === 'crawler') {
    const c = s.dataOps?.crawler;
    if (!c) return 'Crawler: not built';
    const building = day < c.onlineDay;
    const status = building
      ? `Building, online in ${Math.ceil(c.onlineDay - day)} days`
      : crawlBlocked(s)
        ? `Blocked by a bot wall, ${Math.ceil((s.dataOps?.blockedUntil ?? day) - day)} days left`
        : crawlYieldPerDayB(s) > 0
          ? 'Online and pulling tokens'
          : 'Online, no yield';
    return [
      `${L.crawler?.name ?? c.tier} crawler (${c.policy} policy)`,
      status,
      `+${crawlYieldPerDayB(s).toFixed(2)}B tokens per day`,
      `${(s.dataOps?.crawledB ?? 0).toFixed(1)}B crawled to date`,
    ].join('\n');
  }

  if (id === 'refinery') {
    const lines = ['Refinery'];
    if (L.refines.length === 0) {
      lines.push('Idle, both lines free');
    } else {
      lines.push(`${L.refines.length} of 2 lines busy`);
      for (const r of L.refines) {
        const lvl = refineLevelDef(r.level)?.label ?? `Level ${r.level}`;
        lines.push(`${r.name}: ${lvl}, ${Math.ceil(r.doneDay - day)} days left`);
      }
    }
    return lines.join('\n');
  }

  if (id === 'jobs') {
    if (L.jobs.length === 0) return 'Dock: no jobs in flight';
    const lines = [`Dock: ${plural(L.jobs.length, 'job')} in flight`];
    for (const j of L.jobs.slice(0, 5)) lines.push(`${j.label}, ${Math.ceil(j.doneDay - day)} days left`);
    if (L.jobs.length > 5) lines.push(`+${L.jobs.length - 5} more`);
    return lines.join('\n');
  }

  if (id.startsWith('stream:')) {
    const sid = id.slice('stream:'.length);
    const st = (s.dataOps?.streams ?? []).find((x) => x.id === sid);
    if (!st) return 'Startup stream (ended)';
    const dsName = datasetById(s, st.datasetId)?.name ?? st.name;
    return [
      `${st.name} stream`,
      `${DOMAIN_NAME[st.domain] ?? st.domain} · +${st.tokensPerDayB.toFixed(2)}B tokens per day`,
      `${Math.ceil(st.endDay - day)} days left`,
      `Feeds ${dsName}`,
    ].join('\n');
  }

  return '';
}

export function createScene(): Scene {
  return new DataScene();
}

export const CAM = 'Data warehouse';
