// Data warehouse scene: the player's owned data as shelving islands, one per data domain, filled with crates
// (tokens / unit, quality shades the cardboard), with yellow warning tags for unverified or risky sets and a red
// "legal" sticker for high-risk scraped sets. Data ops are islands of their own: the crawler mast, the refinery and the
// loading bay (job dock plus the training gate, where a forklift feeds the run). Startup streams are conveyors on their
// domain's island; job deliveries are workers carrying boxes to the shelf. Islands fill the frame (kit.lattice).
//
// SceneHit ids:
//   domain:<domain>  a shelving island. Tip: sets, tokens, crates, average quality, warning and legal counts.
//   crawler          the crawler mast (only once one is built). Tip: tier, status, tokens per day, lifetime crawl.
//   refinery         the refinery. Tip: busy lines and their jobs.
//   jobs             the dock where bounty, archive and distillation jobs land. Tip: jobs in flight.
//   stream:<id>      a startup stream's conveyor. Tip: domain, tokens per day, days left, dataset.
// Not clickable: the training gate (it glows and its tag lights up while a run is on).
import type { GameState } from '../../sim/types';
import { datasetById } from '../../sim/systems/data';
import { crawlBlocked, crawlYieldPerDayB, refineLevelDef } from '../../sim/systems/dataOps';
import type { Scene, SceneHit } from '../types';
import { Tags, background, fitIso, hitBox, hud, iso, outline, palette, type Box3, type Ctx, type Proj } from '../kit';
import { ISLE, RACK_TOP, buildLayout, DOMAIN_NAME, fmtTokens, type HitBox, type Layout, type SetView } from './layout';
import { drawAisle, drawBay, drawCrawler, drawRefinery } from './draw';

const SIG_EVERY = 0.25;

class DataScene implements Scene {
  private L: Layout | null = null;
  private sigTimer = 0;
  private time = 0;
  private cssW = 0;
  private cssH = 0;
  private proj: Proj = { ox: 0, oy: 0, s: 1 };
  private s: GameState | null = null;
  private hover: string | null = null;
  private readonly tags = new Tags();
  /** Static layer: islands, racking, crates, machines. Redrawn on a new layout, size, pixel ratio or theme. */
  private staticCv: HTMLCanvasElement | null = null;
  private staticKey = '';

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.sigTimer = 0;
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

  private fit(L: Layout): void {
    const b: Box3[] = [];
    const add = (x: number, y: number, z1: number) => b.push({ x0: x, y0: y, x1: x + ISLE, y1: y + ISLE, z0: -2, z1 });
    for (const a of L.aisles) add(a.x, a.y, RACK_TOP + 12);
    if (L.crawlerIsle) add(L.crawlerIsle.x, L.crawlerIsle.y, (L.crawler?.h ?? 22) + 24);
    add(L.refineryIsle.x, L.refineryIsle.y, 46);
    add(L.bayIsle.x, L.bayIsle.y, 40);
    fitIso(this.proj, b, this.cssW, this.cssH);
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.time += dt;
    const t = this.time;
    this.s = s;

    // Layout only changes when its signature (or the canvas size) does; check a few times a second.
    this.sigTimer -= dt;
    if (!this.L || this.sigTimer <= 0) {
      this.sigTimer = SIG_EVERY;
      const next = buildLayout(s, this.cssW, this.cssH);
      if (!this.L || next.sig !== this.L.sig) {
        this.L = next;
        this.fit(next);
      }
    }
    const L = this.L as Layout;
    const pal = palette();
    const c: Ctx = { g, p: this.proj, pal };
    const training = !!s.training;
    const dpr = g.getTransform().a || 1;
    const key = `${L.sig}|${this.cssW}x${this.cssH}@${dpr}|${pal.bg}`;
    if (!this.staticCv || key !== this.staticKey) {
      const cv = this.staticCv ?? document.createElement('canvas');
      cv.width = Math.max(1, Math.round(this.cssW * dpr));
      cv.height = Math.max(1, Math.round(this.cssH * dpr));
      const sg = cv.getContext('2d');
      if (sg) {
        sg.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sc: Ctx = { g: sg, p: this.proj, pal };
        background(sc, this.cssW, this.cssH);
        this.drawIslands(sc, L, training, t, false);
      }
      this.staticCv = cv;
      this.staticKey = key;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.staticCv, 0, 0);
    g.restore();
    this.drawIslands(c, L, training, t, true);

    if (this.hover) {
      const h = L.hits.find((x) => x.id === this.hover);
      if (h) outline(c, { x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1, z0: 0, z1: h.z1 });
    }

    // Tags.
    const p = this.proj;
    const small = p.s < 0.42;
    const tags = this.tags;
    for (const a of L.aisles) {
      const [x, y] = iso(p, a.sx + 0.2, a.sy + 0.2, RACK_TOP + 2);
      const tokens = a.sets.reduce((acc, v) => acc + v.tokensB, 0);
      const warn = a.sets.some((v) => v.legal) ? pal.down : a.sets.some((v) => v.warn) ? pal.warn : pal.hl;
      tags.add(x, y, DOMAIN_NAME[a.domain], { tone: a.total > 0 ? warn : pal.fg4, sub: a.total > 0 ? `${fmtTokens(tokens)}${a.overflow > 0 ? ` · ×${a.total}` : ''}` : 'empty', small, leader: 4 }, this.hover === `domain:${a.domain}` ? 20 : 3);
    }
    if (L.crawler && L.crawlerIsle) {
      const cw = L.crawler;
      const [x, y] = iso(p, L.crawlerIsle.x + 3.15, L.crawlerIsle.y + 1.05, cw.h + 22);
      const status = cw.blocked ? 'Blocked' : cw.building ? 'Building' : cw.flowing ? `+${crawlYieldPerDayB(s).toFixed(1)}B/day` : 'Idle';
      tags.add(x, y, 'Crawler', { tone: cw.blocked ? pal.down : cw.flowing ? pal.up : pal.warn, sub: status, small }, 6);
    }
    {
      const [x, y] = iso(p, L.refineryIsle.x + 0.6, L.refineryIsle.y + 0.6, 38);
      tags.add(x, y, 'Refinery', { tone: L.refines.length ? pal.hl : pal.fg4, sub: `${L.refines.length}/2 busy`, small, leader: 4 }, 5);
    }
    {
      const [x, y] = iso(p, L.bayIsle.x + 2.6, L.bayIsle.y + 0.35, 32);
      tags.add(x, y, 'Training gate', training ? { solid: true, sub: s.training?.name, small } : { tone: pal.fg4, sub: 'idle', small }, training ? 12 : 4);
      const [jx, jy] = iso(p, L.bayIsle.x + 0.8, L.bayIsle.y + 2.6, 22);
      if (L.jobs.length) tags.add(jx, jy, 'Dock', { tone: pal.warn, sub: `${L.jobs.length} jobs`, small }, 2);
    }
    tags.flush(g, pal, this.cssW, this.cssH);

    hud(g, pal, this.cssW, this.cssH, `${L.sets.length} sets · ${fmtTokens(L.totalTokensB)} tokens · ${L.totalCrates} crates`);
  }

  private drawIslands(c: Ctx, L: Layout, training: boolean, t: number, live: boolean): void {
    for (let line = 0; line < L.lines; line++) {
      if (L.crawler && L.crawlerIsle && L.crawlerIsle.line === line) drawCrawler(c, L.crawlerIsle, L.crawler, t, live);
      if (L.refineryIsle.line === line) drawRefinery(c, L.refineryIsle, L.refines.length, t, live);
      if (L.bayIsle.line === line) drawBay(c, L, training, t, live);
      for (const a of L.aisles) if (a.line === line) drawAisle(c, a, t, live);
    }
  }

  hitTest(x: number, y: number): SceneHit | null {
    const L = this.L;
    const s = this.s;
    if (!L || !s) return null;
    let best: HitBox | null = null;
    for (const h of L.hits) {
      if (hitBox(this.proj, { x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1, z0: 0, z1: h.z1 }, x, y)) best = h;
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
      const streams = L.aisles.reduce((n, x) => n + x.belts.filter((b) => b.domain === dom).length, 0);
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
