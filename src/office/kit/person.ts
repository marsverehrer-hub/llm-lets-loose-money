// Scene kit, people: small characters in their role colour. Seated people face their monitors, so the camera sees
// their backs; walkers face the way they go. About 22 px tall at scale 1, lit from the upper left like the props.
import { project } from '../iso';
import type { Ctx } from '../draw/prims';
import { T, roleColor, shade } from './theme';

const SKIN = ['#f1c7a5', '#d9a57c', '#b07a52', '#8d5a3b', '#f6d7bd', '#c68e64'];
const HAIR = ['#1b1b1d', '#4b2e1e', '#c7a15a', '#2c2c30', '#8a6a3a', '#5a2f22', '#d9d4c8'];
const LEGS = ['#25272c', '#2f3540', '#3b3a36', '#1d2129'];

export interface Pose {
  x: number;
  y: number;
  role: string;
  seed: number;
  sitting?: boolean;
  /** Arms moving on the keyboard (sitting only). */
  typing?: boolean;
  /** Advancing phase while walking, 0 when still. */
  walk?: number;
  /** Seen from behind (seated at a desk, or walking away). */
  back?: boolean;
  /** Ring in the team colour: a star hire, or the selection. */
  ring?: boolean;
  /** Override shirt colour. */
  shirt?: string;
  t: number;
  /** Slumped (low morale). */
  slump?: boolean;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h);
  g.lineTo(x, y + h);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Draw a person standing (or sitting) on floor point (x, y). Returns the head's screen position. */
export function person(c: Ctx, q: Pose): [number, number] {
  const { g, p } = c;
  const [bx, by] = project(p, q.x, q.y, 0);
  const s = p.scale;
  const seed = Math.abs(q.seed | 0);
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed >> 3) % HAIR.length];
  const legs = LEGS[(seed >> 5) % LEGS.length];
  const shirt = q.shirt ?? roleColor(q.role);
  const shirtDark = shade(shirt, 0.72);
  const walk = q.walk ?? 0;
  const bob = walk > 0 ? Math.abs(Math.sin(walk)) * 1.1 * s : 0;
  const swing = walk > 0 ? Math.sin(walk) : 0;

  g.fillStyle = T.shadow;
  g.beginPath();
  g.ellipse(bx, by, 4.4 * s, 1.9 * s, 0, 0, Math.PI * 2);
  g.fill();

  let headY: number;
  if (q.sitting) {
    const slump = q.slump ? 2.2 * s : 0;
    // thighs on the seat, shins down
    g.fillStyle = legs;
    g.fillRect(bx - 3 * s, by - 7.5 * s, 6 * s, 2.4 * s);
    const ty = by - 16.5 * s + slump;
    g.fillStyle = shirt;
    rr(g, bx - 3.5 * s, ty, 7 * s, 9.5 * s - slump, 2 * s);
    g.fill();
    g.fillStyle = shirtDark;
    g.fillRect(bx + 0.6 * s, ty + 1.2 * s, 2.9 * s, 8.3 * s - slump);
    if (!q.back) {
      const ph = q.typing ? Math.sin(q.t * 14 + seed) : 0;
      g.strokeStyle = shirtDark;
      g.lineWidth = 1.7 * s;
      g.beginPath();
      g.moveTo(bx - 3.2 * s, ty + 3.5 * s);
      g.lineTo(bx - 4.4 * s, by - 8 * s + ph * s);
      g.moveTo(bx + 3.2 * s, ty + 3.5 * s);
      g.lineTo(bx + 4.4 * s, by - 8 * s - ph * s);
      g.stroke();
    } else if (q.typing) {
      // elbows twitch as they type
      const ph = Math.sin(q.t * 14 + seed) * 0.6 * s;
      g.fillStyle = shirtDark;
      g.fillRect(bx - 4.6 * s, ty + 3.4 * s + ph, 1.4 * s, 3.2 * s);
      g.fillRect(bx + 3.2 * s, ty + 3.4 * s - ph, 1.4 * s, 3.2 * s);
    }
    headY = by - 20.5 * s + slump * 1.3;
  } else {
    const la = swing * 1.6 * s;
    g.fillStyle = legs;
    g.fillRect(bx - 2.6 * s + la * 0.4, by - 7 * s - bob, 2.1 * s, 7 * s);
    g.fillRect(bx + 0.5 * s - la * 0.4, by - 7 * s - bob, 2.1 * s, 7 * s);
    g.fillStyle = '#121316';
    g.fillRect(bx - 2.8 * s + la * 0.4, by - 1.1 * s - bob, 2.5 * s, 1.2 * s);
    g.fillRect(bx + 0.4 * s - la * 0.4, by - 1.1 * s - bob, 2.5 * s, 1.2 * s);
    const ty = by - 16 * s - bob;
    g.fillStyle = shirt;
    rr(g, bx - 3.5 * s, ty, 7 * s, 9.6 * s, 2 * s);
    g.fill();
    g.fillStyle = shirtDark;
    g.fillRect(bx + 0.6 * s, ty + 1.2 * s, 2.9 * s, 8.4 * s);
    g.strokeStyle = shirtDark;
    g.lineWidth = 1.6 * s;
    g.beginPath();
    g.moveTo(bx - 3.3 * s, ty + 2 * s);
    g.lineTo(bx - 3.6 * s - swing * 1.8 * s, ty + 8.4 * s);
    g.moveTo(bx + 3.3 * s, ty + 2 * s);
    g.lineTo(bx + 3.6 * s + swing * 1.8 * s, ty + 8.4 * s);
    g.stroke();
    headY = by - 20 * s - bob;
  }

  // head
  const hr = 3.2 * s;
  if (q.back) {
    g.fillStyle = skin;
    g.fillRect(bx - 1 * s, headY + 2.4 * s, 2 * s, 1.6 * s);
    g.fillStyle = hair;
    g.beginPath();
    g.arc(bx, headY, hr + 0.3 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shade(hair, 1.35);
    g.beginPath();
    g.arc(bx - 1.1 * s, headY - 1.3 * s, 1.2 * s, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = hair;
    g.beginPath();
    g.arc(bx, headY - 0.5 * s, hr + (seed % 3 === 0 ? 0.9 * s : 0.4 * s), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = skin;
    g.beginPath();
    g.arc(bx, headY + 0.5 * s, hr - 0.2 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hair;
    g.beginPath();
    g.arc(bx, headY - 0.2 * s, hr, Math.PI * 1.08, Math.PI * 1.92);
    g.fill();
    if (s > 0.7) {
      g.fillStyle = '#16171a';
      g.fillRect(bx - 1.4 * s, headY + 0.6 * s, 0.8 * s, 0.9 * s);
      g.fillRect(bx + 0.7 * s, headY + 0.6 * s, 0.8 * s, 0.9 * s);
    }
  }

  if (q.ring) {
    g.strokeStyle = T.hl;
    g.lineWidth = Math.max(1, 1.2 * s);
    g.beginPath();
    g.ellipse(bx, by, 6.5 * s, 2.9 * s, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return [bx, headY];
}
