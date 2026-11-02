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
import { project, type Projector } from '../../office/iso';
import { ROLE_LABEL } from '../../office/palette';
import { Ctx, glow } from '../../office/draw/prims';
import { T, alpha, roleColor, syncTheme } from '../../office/kit/theme';
import { type Box2, type HudPart, drawGround, feedMargins, fitTo, floorAt, hud, tag } from '../../office/kit/frame';
import { plant, rack, room, wallSign, whiteboard } from '../../office/kit/props';
import { person } from '../../office/kit/person';
import type { Scene, SceneHit } from '../types';
import { ROOM_WALL, buildLayout, type Band, type Layout, type Prop, type Zone, type ZoneId } from './layout';
import { Crowd, type Person } from './crowd';
import { DeskSprites } from './sprites';
import { drawPhoneDesk, drawPoster, drawRedTeam, drawScreen, drawShield, drawTripod } from './draw';

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
      return { d: x + y + 0.6, fn: (c) => whiteboard(c, x, y, 1.4, seed) };
    }
    case 'rack': {
      const { x, y, seed } = pr;
      return {
        d: x + y + 0.5,
        fn: (c, t, training) => {
          const lit = training ? 0.5 + 0.5 * Math.sin(t * 3 + seed * 0.7) : 0;
          rack(c, x, y, lit, training, t, seed, 32);
        },
      };
    }
    case 'redteam': {
      const { x, y, w, d } = pr;
      return { d: x + y + 0.1, fn: (c) => drawRedTeam(c, x, y, w, d) };
    }
    case 'shield': {
      const { x, y } = pr;
      return { d: x + y + 0.3, fn: (c) => drawShield(c, x, y, roleColor('safety')) };
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
      const { x, y, seed } = pr;
      return { d: x + y + 0.3, fn: (c) => drawPoster(c, x, y, seed) };
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
            glow(c.g, gx, gy, 26 * c.p.scale, T.hl, 0.14 + 0.06 * Math.sin(t * 2));
            c.g.restore();
          },
        });
      }
    }
  }
  L.plants.forEach((pl, i) => out.push({ d: pl.x + pl.y + 0.5, fn: (c) => plant(c, pl.x, pl.y, pl.size, i) }));
  return out.sort((a, b) => a.d - b.d);
}

const ZONE_ACCENT = (id: ZoneId): string => (id === 'open' ? T.fg3 : roleColor(id));

function zoneLabel(z: Zone): [string, string | undefined] {
  const name = ZONE_NAME[z.id];
  if (z.id === 'open') return z.heads === 0 ? ['OFFICE FULL', undefined] : [name, `${z.heads}`];
  return [name, `${z.heads}`];
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
  private theme = 0;
  private tags: { box: Box2; z: Zone }[] = [];

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.sigTimer = 0;
    this.fit();
  }

  private avail(): [number, number] {
    const m = feedMargins(this.cssW, this.cssH);
    return [Math.max(40, this.cssW - m.l - m.r), Math.max(40, this.cssH - m.t - m.b)];
  }

  /** Auto-fit camera on the rooms. */
  private fit(): void {
    if (this.layout) fitTo(this.proj, this.layout.box, this.cssW, this.cssH);
  }

  private rebuild(L: Layout): void {
    this.layout = L;
    this.sprites.reset();
    this.statics = buildStatics(L, this.sprites);
    this.crowd.sync(L);
    this.fit();
  }

  draw(g: CanvasRenderingContext2D, s: GameState, dt: number, nowMs: number): void {
    this.theme = syncTheme(nowMs);
    this.state = s;
    this.training = !!s.training;
    this.time += dt;
    const t = this.time;

    this.sigTimer -= dt;
    if (!this.layout || this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      const [aw, ah] = this.avail();
      const next = buildLayout(s, aw, ah);
      if (!this.layout || next.sig !== this.layout.sig) this.rebuild(next);
    }
    const L = this.layout as Layout;
    this.crowd.update(dt, L.band as Band);

    const dpr = g.getTransform().a || 1;
    this.sprites.frame(this.proj, dpr, this.theme);
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

  /** Ground, rooms and their walls: static for a given layout, framing and theme, so painted once. */
  private blitBase(g: CanvasRenderingContext2D, L: Layout, dpr: number): void {
    const p = this.proj;
    const key = `${L.sig}|${this.cssW}x${this.cssH}|${dpr}|${p.scale.toFixed(4)}|${p.ox.toFixed(1)}|${p.oy.toFixed(1)}|${this.theme}`;
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
    drawGround(g, this.proj, this.cssW, this.cssH);
    // Back rows first, so a front row's walls cover what is behind them.
    const zs = [...L.zones].sort((a, b) => a.row - b.row || a.x + a.y - (b.x + b.y));
    for (const z of zs) {
      const col = ZONE_ACCENT(z.id);
      room(c, z.x, z.y, z.w, z.d, { wallH: ROOM_WALL, tint: alpha(col, z.heads > 0 ? 0.1 : 0.03), livery: z.id !== 'open' });
      if (z.id !== 'open') {
        // the department's colour along the top of its back wall
        const a0 = project(this.proj, z.x, z.y, ROOM_WALL);
        const a1 = project(this.proj, z.x + z.w, z.y, ROOM_WALL);
        g.strokeStyle = col;
        g.lineWidth = Math.max(1.5, 2.2 * this.proj.scale);
        g.beginPath();
        g.moveTo(a0[0], a0[1]);
        g.lineTo(a1[0], a1[1]);
        g.stroke();
      }
      if (z.id === 'open' && L.hiring) wallSign(c, z.x, z.y + 0.4, Math.min(3.4, z.d - 0.8), ROOM_WALL - 12, 'NOW HIRING', T.hl, true);
    }
  }

  private paintPerson(c: Ctx, pe: Person, t: number, band: Band): void {
    const sitting = pe.mode === 'sit';
    const [hx, hy] = person(c, {
      x: pe.x,
      y: pe.y,
      role: pe.role,
      seed: pe.seed,
      sitting,
      typing: sitting && pe.talk <= 0 && band !== 'low',
      slump: sitting && band === 'low',
      back: sitting,
      walk: pe.mode === 'walk' ? pe.walkPhase : 0,
      ring: pe.star,
      t,
    });
    pe.sx = hx;
    pe.sy = hy + 4 * c.p.scale;
    const s = c.p.scale;
    if (pe.talk > 0) {
      const [dx, dy] = project(c.p, pe.x, pe.y, 32);
      c.g.fillStyle = T.fg;
      for (let k = 0; k < 3; k++) {
        c.g.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - k * 0.9));
        c.g.fillRect(dx + (k - 1) * 3 * s - 0.8 * s, dy - 0.8 * s, 1.6 * s, 1.6 * s);
      }
      c.g.globalAlpha = 1;
    }
    if (pe.star) {
      const [kx, ky] = project(c.p, pe.x, pe.y, 30);
      const r = Math.max(2.5, 3.2 * s);
      c.g.fillStyle = T.hl;
      c.g.beginPath();
      c.g.moveTo(kx, ky - r);
      c.g.lineTo(kx + r * 0.7, ky);
      c.g.lineTo(kx, ky + r);
      c.g.lineTo(kx - r * 0.7, ky);
      c.g.closePath();
      c.g.fill();
    }
  }

  /** Room tags and the HUD line. Drawn last so nothing covers them. */
  private overlay(g: CanvasRenderingContext2D, L: Layout, s: GameState): void {
    const p = this.proj;
    const size = this.cssW < 520 ? 10 : 11;
    this.tags = [];
    for (const z of L.zones) {
      const [lx, ly] = project(p, z.x, z.y + z.d, ROOM_WALL);
      const [text, value] = zoneLabel(z);
      const box = tag(g, lx - 2, ly - 3, text, ZONE_ACCENT(z.id), { value, size, align: 'left' });
      this.tags.push({ box, z });
    }
    const parts: HudPart[] = [];
    if (L.over > 0) parts.push([`+${L.over} over capacity`, T.down]);
    parts.push([`${L.headcount}/${L.cap} seats`, T.fg]);
    parts.push([`Morale ${Math.round(s.staff.morale)}`, L.band === 'low' ? T.down : L.band === 'mid' ? T.warn : T.up]);
    if (L.unit > 1) parts.push([`1 desk = ${L.unit}`, T.fg3]);
    hud(g, this.cssW, this.cssH, parts);
  }

  hitTest(x: number, y: number): SceneHit | null {
    const L = this.layout;
    const s = this.state;
    if (!L || !s) return null;
    const p = this.proj;
    const zoneHit = (z: Zone): SceneHit => (z.id === 'open' ? { id: 'office', label: officeTip(s, L) } : { id: `team:${z.id}`, label: teamTip(s, z.id) });

    // Stars first: their head is small, so a direct hit on the figure wins over the zone under it.
    for (const pe of this.crowd.people) {
      if (!pe.star) continue;
      if (Math.hypot(pe.sx - x, pe.sy - y) <= 9 * p.scale + 4) {
        return { id: pe.key, label: starTip(s, pe.key.slice('star:'.length)) };
      }
    }
    for (const tg of this.tags) if (x >= tg.box.x0 && x <= tg.box.x1 && y >= tg.box.y0 && y <= tg.box.y1) return zoneHit(tg.z);

    // Rooms: the ground footprint first, then the height of the tallest props (about 30 px up).
    for (const z0 of [0, 30]) {
      const [fx, fy] = floorAt(p, x, y, z0);
      for (const z of L.zones) {
        if (fx >= z.x && fx < z.x + z.w && fy >= z.y && fy < z.y + z.d) return zoneHit(z);
      }
    }
    return null;
  }
}

export function createScene(): Scene {
  return new StaffScene();
}
