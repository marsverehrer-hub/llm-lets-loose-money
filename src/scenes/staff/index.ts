// Staff scene: the company's people as an isometric floor plan split into five department zones, plus open seats.
// Zone sizes follow headcount, empty desks show the free seats of the current office, morale changes how people
// move (chatting at high morale, slumped at low), and hired stars stand out at their desks.
//
// Hit ids (SceneHit.id):
//   team:<roleId>   a department zone: team:researcher, team:engineer, team:safety, team:sales, team:marketing
//   star:<starId>   a hired star at their desk
//   office          the open-seat zone, or the bare floor (the office as a whole)
//
// Tips: headcount, skill, payroll per day and the effect line, from teamStats and teamEffect (ui/panels/staff/model).
import type { GameState, RoleId } from '../../sim/types';
import { officeTier } from '../../sim/systems/staff';
import { formatMoney } from '../../sim/util';
import { tdate } from '../../ui/shell/fmt';
import { pct, teamEffect, teamStats } from '../../ui/panels/staff/model';
import { TILE_H, TILE_W, hashStr, project, type Projector } from '../../office/iso';
import { C, ROLE_COLOR, ROLE_LABEL } from '../../office/palette';
import { Ctx, floorLine, floorTile, glow, withAlpha } from '../../office/draw/prims';
import { drawNeonSign, drawPlant, drawRack, drawWhiteboard } from '../../office/draw/furniture';
import { WALL_H, drawFloor, drawNeonStrip, drawWalls } from '../../office/draw/room';
import { drawPerson } from '../../office/draw/person';
import type { Scene, SceneHit } from '../types';
import { buildLayout, type Band, type Layout, type Prop, type Zone, type ZoneId } from './layout';
import { Crowd, type Person } from './crowd';
import { DeskSprites } from './sprites';
import { drawPhoneDesk, drawPill, drawPoster, drawRedTeam, drawScreen, drawShield, drawSlumped, drawTripod } from './draw';

export const CAM = 'Departments';

const ZONE_NAME: Record<ZoneId, string> = {
  researcher: 'RESEARCH',
  engineer: 'ENGINEERING',
  safety: 'SAFETY',
  sales: 'SALES',
  marketing: 'MARKETING',
  open: 'OPEN SEATS',
};

interface StaticItem {
  /** Depth key: anything further down-screen draws later. */
  d: number;
  fn: (c: Ctx, t: number, training: boolean) => void;
}

function propStatic(pr: Prop): StaticItem {
  switch (pr.k) {
    case 'whiteboard': {
      const { x, y, seed } = pr;
      return { d: x + y + 0.6, fn: (c) => drawWhiteboard(c, x, y, 1.4, seed) };
    }
    case 'rack': {
      const { x, y, seed } = pr;
      return {
        d: x + y + 0.5,
        fn: (c, t, training) => {
          const lit = training ? 0.5 + 0.5 * Math.sin(t * 3 + seed * 0.7) : 0;
          drawRack(c, x, y, lit, training, t, seed);
        },
      };
    }
    case 'redteam': {
      const { x, y, w, d } = pr;
      return { d: x + y + 0.1, fn: (c) => drawRedTeam(c, x, y, w, d) };
    }
    case 'shield': {
      const { x, y } = pr;
      return { d: x + y + 0.3, fn: (c) => drawShield(c, x, y, ROLE_COLOR.safety) };
    }
    case 'screen': {
      const { x, y, w, seed } = pr;
      return { d: x + y + 0.4, fn: (c, t) => drawScreen(c, x, y, w, seed, t) };
    }
    case 'phone': {
      const { x, y } = pr;
      return { d: x + y + 0.9, fn: (c, t) => drawPhoneDesk(c, x, y, t) };
    }
    case 'poster': {
      const { x, y, color, seed } = pr;
      return { d: x + y + 0.3, fn: (c) => drawPoster(c, x, y, color, seed) };
    }
    case 'tripod': {
      const { x, y } = pr;
      return { d: x + y + 0.6, fn: (c, t) => drawTripod(c, x, y, t) };
    }
  }
}

/** Everything drawn per frame that is not a person, sorted by depth. Rebuilt only when the layout changes. */
function buildStatics(L: Layout, sprites: DeskSprites): StaticItem[] {
  const out: StaticItem[] = [];
  for (const z of L.zones) {
    for (const pr of z.props) out.push(propStatic(pr));
    for (const d of z.desks) {
      const { x, y, kind } = d;
      out.push({ d: x + y + 1.0, fn: (c) => sprites.draw(c, d) });
      if (kind === 'star') {
        out.push({
          d: x + y + 1.05,
          fn: (c, t) => {
            const [gx, gy] = project(c.p, x + 0.65, y + 0.3, 20);
            c.g.save();
            c.g.globalCompositeOperation = 'lighter';
            glow(c.g, gx, gy, 26 * c.p.scale, C.amber, 0.14 + 0.06 * Math.sin(t * 2));
            c.g.restore();
          },
        });
      }
    }
  }
  for (const pl of L.plants) out.push({ d: pl.x + pl.y + 0.5, fn: (c) => drawPlant(c, pl.x, pl.y, pl.size) });
  return out.sort((a, b) => a.d - b.d);
}

const ZONE_ACCENT = (id: ZoneId): string => (id === 'open' ? C.textDim : ROLE_COLOR[id]);

function zoneLabel(z: Zone): string {
  const name = ZONE_NAME[z.id];
  if (z.id === 'open') return z.heads === 0 ? 'OFFICE FULL' : `${name} ×${z.heads}`;
  return z.heads >= 10 ? `${name} ×${z.heads}` : name;
}

function teamTip(s: GameState, id: RoleId): string {
  const t = teamStats(s).find((x) => x.id === id);
  if (!t) return id;
  const eff = teamEffect(s, id);
  const lines = [
    t.role.plural,
    `${t.heads} ${t.heads === 1 ? 'person' : 'people'}: ${t.count} staff, ${t.stars.length} star${t.stars.length === 1 ? '' : 's'}`,
    `Skill ${t.skill.toFixed(2)}, pay ${pct(t.level)} of market`,
    `Payroll ${formatMoney(t.payDay)} a day`,
    eff.line,
  ];
  if (eff.extra) lines.push(eff.extra);
  return lines.join('\n');
}

function officeTip(s: GameState, L: Layout): string {
  const mood = L.band === 'high' ? 'people are chatting' : L.band === 'mid' ? 'steady' : 'slumped, hiring';
  const lines = [
    officeTier(s).name,
    `${L.headcount} of ${L.cap} seats filled${L.over ? ` (${L.over} over capacity)` : ''}`,
    `${L.free} empty seat${L.free === 1 ? '' : 's'}`,
    `Morale ${Math.round(s.staff.morale)}: ${mood}`,
  ];
  if (L.unit > 1) lines.push(`1 desk = ${L.unit} seats`);
  return lines.join('\n');
}

function starTip(s: GameState, starId: string): string {
  const st = s.staff.stars.find((x) => x.id === starId);
  if (!st) return 'Star';
  const bonuses = Object.entries(st.bonuses)
    .filter(([, v]) => typeof v === 'number' && v !== 1)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ×${(v as number).toFixed(2)}`);
  const lines = [
    st.name,
    st.title,
    ROLE_LABEL[st.role] ?? st.role,
    `Salary ${formatMoney(st.salary)} a year, ${formatMoney(st.salary / 365)} a day`,
    `Loyalty ${Math.round(st.loyalty)}`,
  ];
  if (st.hiredDay !== null) lines.push(`Joined ${tdate(st.hiredDay)}`);
  lines.push(...bonuses);
  return lines.join('\n');
}

/** Floor coordinates under a screen point, assuming the point sits on height z (screen px). */
function floorAt(p: Projector, sx: number, sy: number, z: number): [number, number] {
  const u = (sx - p.ox) / ((TILE_W / 2) * p.scale);
  const v = (sy - p.oy + z * p.scale) / ((TILE_H / 2) * p.scale);
  return [(u + v) / 2, (v - u) / 2];
}

class StaffScene implements Scene {
  private layout: Layout | null = null;
  private statics: StaticItem[] = [];
  private sigTimer = 0;
  private crowd = new Crowd();
  private sprites = new DeskSprites();
  private proj: Projector = { ox: 0, oy: 0, scale: 1 };
  private ctx: Ctx = { g: null as unknown as CanvasRenderingContext2D, p: this.proj };
  private cssW = 0;
  private cssH = 0;
  private time = 0;
  private state: GameState | null = null;
  private training = false;
  private base: HTMLCanvasElement | null = null;
  private baseKey = '';
  private order: Person[] = [];

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.fit();
  }

  /** Fit the floor plate into the canvas (CSS px), the same framing as the HQ office. */
  private fit(): void {
    const L = this.layout;
    if (!L) return;
    const pad = 14;
    const availW = Math.max(40, this.cssW - pad * 2);
    const availH = Math.max(40, this.cssH - pad * 2);
    const X = L.W;
    const Y = L.D;
    const s = Math.min(availW / (((X + Y) * TILE_W) / 2), availH / (((X + Y) * TILE_H) / 2 + WALL_H), 2.6);
    const sc = Math.max(0.35, s);
    this.proj.scale = sc;
    this.proj.ox = this.cssW / 2 - (((X - Y) * TILE_W) / 4) * sc;
    this.proj.oy = this.cssH / 2 - (((X + Y) * TILE_H) / 4 - WALL_H / 2) * sc;
  }

  private rebuild(L: Layout): void {
    this.layout = L;
    this.sprites.reset();
    this.statics = buildStatics(L, this.sprites);
    this.crowd.sync(L);
    this.fit();
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, _nowMs: number): void {
    this.state = s;
    this.training = !!s.training;
    this.time += dt;
    const t = this.time;

    this.sigTimer -= dt;
    if (!this.layout || this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      const next = buildLayout(s);
      if (!this.layout || next.sig !== this.layout.sig) this.rebuild(next);
    }
    const L = this.layout as Layout;
    this.crowd.update(dt, L.band as Band);

    const dpr = g.getTransform().a || 1;
    this.sprites.frame(this.proj, dpr);
    this.blitBase(g, L, dpr);

    const c = this.ctx;
    c.g = g;
    c.p = this.proj;
    const order = this.order;
    order.length = 0;
    for (const pe of this.crowd.people) order.push(pe);
    order.sort((a, b) => a.x + a.y - (b.x + b.y));

    const st = this.statics;
    let si = 0;
    for (const pe of order) {
      const key = pe.x + pe.y + 0.1;
      while (si < st.length && st[si].d <= key) {
        st[si].fn(c, t, this.training);
        si++;
      }
      this.paintPerson(c, pe, t, L.band);
    }
    for (; si < st.length; si++) st[si].fn(c, t, this.training);

    this.overlay(g, L, s);
  }

  /** Floor, zone tints, walls and the hiring sign: static for a given layout and framing, so painted once. */
  private blitBase(g: CanvasRenderingContext2D, L: Layout, dpr: number): void {
    const p = this.proj;
    const key = `${L.sig}|${this.cssW}x${this.cssH}|${dpr}|${p.scale.toFixed(4)}|${p.ox.toFixed(1)}|${p.oy.toFixed(1)}`;
    if (!this.base) this.base = document.createElement('canvas');
    if (key !== this.baseKey) {
      this.baseKey = key;
      const cv = this.base;
      cv.width = Math.max(1, Math.round(this.cssW * dpr));
      cv.height = Math.max(1, Math.round(this.cssH * dpr));
      const cg = cv.getContext('2d');
      if (!cg) return;
      cg.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.paintBase(cg, L);
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.base, 0, 0);
    g.restore();
  }

  private paintBase(g: CanvasRenderingContext2D, L: Layout): void {
    const c: Ctx = { g, p: this.proj };
    const bg = g.createLinearGradient(0, 0, 0, this.cssH);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    drawFloor(c, L.W, L.D, 1, '#2b2824', '#26231f');
    for (const z of L.zones) {
      const col = ZONE_ACCENT(z.id);
      floorTile(c, z.x, z.y, z.w, z.d, withAlpha(col, z.heads > 0 ? 0.13 : 0.05));
      const x1 = z.x + z.w;
      const y1 = z.y + z.d;
      const edge = withAlpha(col, 0.55);
      floorLine(c, z.x, z.y, x1, z.y, 0.2, edge, 1);
      floorLine(c, x1, z.y, x1, y1, 0.2, edge, 1);
      floorLine(c, z.x, y1, x1, y1, 0.2, edge, 1);
      floorLine(c, z.x, z.y, z.x, y1, 0.2, edge, 1);
    }
    drawWalls(c, L.W, L.D, WALL_H, '#34312c');
    if (L.hiring) drawNeonSign(c, 0.8, 0.04, 3.4, "WE'RE HIRING", C.amber, 0);
    drawNeonStrip(c, L.W, L.D, WALL_H, 0);
  }

  private paintPerson(c: Ctx, pe: Person, t: number, band: Band): void {
    const body = ROLE_COLOR[pe.role] ?? C.amber;
    if (pe.mode === 'sit') {
      if (band === 'low') drawSlumped(c, pe.x, pe.y, body, pe.seed);
      else
        drawPerson(c, {
          x: pe.x,
          y: pe.y,
          role: pe.role,
          seed: pe.seed,
          sitting: true,
          typing: pe.talk <= 0,
          walkPhase: 0,
          highlight: pe.star,
          t,
        });
    } else {
      drawPerson(c, {
        x: pe.x,
        y: pe.y,
        role: pe.role,
        seed: pe.seed,
        sitting: false,
        typing: false,
        walkPhase: pe.mode === 'walk' ? pe.walkPhase : 0,
        highlight: pe.star,
        t,
      });
    }
    const [hx, hy] = project(c.p, pe.x, pe.y, 16);
    pe.sx = hx;
    pe.sy = hy;
    const s = c.p.scale;
    if (pe.talk > 0) {
      const [dx, dy] = project(c.p, pe.x, pe.y, 34);
      c.g.fillStyle = C.fg;
      for (let k = 0; k < 3; k++) {
        c.g.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - k * 0.9));
        c.g.beginPath();
        c.g.arc(dx + (k - 1) * 3 * s, dy, 1.1 * s, 0, Math.PI * 2);
        c.g.fill();
      }
      c.g.globalAlpha = 1;
    }
    if (pe.star) {
      const [kx, ky] = project(c.p, pe.x, pe.y, 44);
      const r = 3 * s;
      c.g.fillStyle = C.amber;
      c.g.beginPath();
      c.g.moveTo(kx, ky - r);
      c.g.lineTo(kx + r * 0.7, ky);
      c.g.lineTo(kx, ky + r);
      c.g.lineTo(kx - r * 0.7, ky);
      c.g.closePath();
      c.g.fill();
    }
  }

  /** Zone labels, the over-capacity note and the HUD line. Drawn last so nothing covers them. */
  private overlay(g: CanvasRenderingContext2D, L: Layout, s: GameState): void {
    const p = this.proj;
    const labelSize = p.scale < 0.6 ? 9 : 11;
    for (const z of L.zones) {
      const [lx, ly] = project(p, z.x + z.w / 2, z.y + z.d + 0.7, 0);
      drawPill(g, lx, ly, zoneLabel(z), ZONE_ACCENT(z.id), labelSize);
    }
    g.save();
    g.font = '10px IBM Plex Mono, monospace';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.textDim;
    g.fillText(`${L.headcount}/${L.cap} SEATS · MORALE ${Math.round(s.staff.morale)}`, this.cssW - 10, this.cssH - 8);
    if (L.over > 0) {
      g.fillStyle = C.red;
      g.fillText(`+${L.over} OVER CAPACITY`, this.cssW - 10, this.cssH - 24);
    }
    g.restore();
  }

  hitTest(x: number, y: number): SceneHit | null {
    const L = this.layout;
    const s = this.state;
    if (!L || !s) return null;
    const p = this.proj;

    // Stars first: their head is small, so a direct hit on the figure wins over the zone under it.
    for (const pe of this.crowd.people) {
      if (!pe.star) continue;
      if (Math.hypot(pe.sx - x, pe.sy - y) <= 9 * p.scale + 4) {
        return { id: pe.key, label: starTip(s, pe.key.slice('star:'.length)) };
      }
    }

    // Zones: the ground footprint first, then the height of the tallest props (about 30 px up).
    for (const z0 of [0, 30]) {
      const [fx, fy] = floorAt(p, x, y, z0);
      for (const z of L.zones) {
        if (fx >= z.x && fx < z.x + z.w && fy >= z.y && fy < z.y + z.d) {
          if (z.id === 'open') return { id: 'office', label: officeTip(s, L) };
          return { id: `team:${z.id}`, label: teamTip(s, z.id) };
        }
      }
    }

    const [fx, fy] = floorAt(p, x, y, 0);
    if (fx >= 0 && fx <= L.W && fy >= 0 && fy <= L.D) return { id: 'office', label: officeTip(s, L) };
    return null;
  }
}

export function createScene(): Scene {
  return new StaffScene();
}
