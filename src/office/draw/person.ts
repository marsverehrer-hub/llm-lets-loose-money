import { project } from '../iso';
import { C, ROLE_COLOR, shade } from '../palette';
import { Ctx } from './prims';

const SKIN = ['#f1c7a5', '#d9a57c', '#b07a52', '#8d5a3b', '#f6d7bd'];
const HAIR = ['#1a1a1a', '#4b2e1e', '#c7a15a', '#2a2a2a', '#8a6a3a'];

export interface PersonPose {
  x: number;
  y: number;
  role: string;
  seed: number;
  sitting: boolean;
  typing: boolean;
  walkPhase: number; // >0 while walking (radians advance); 0 when standing/sitting
  highlight: boolean;
  t: number;
}

/** Small iso character drawn in screen space at the projected floor point. Head, torso in role color, legs. */
export function drawPerson(c: Ctx, q: PersonPose): void {
  const { g, p } = c;
  const [bx, by] = project(p, q.x, q.y, 0);
  const s = p.scale;
  const skin = SKIN[q.seed % SKIN.length];
  const hair = HAIR[(q.seed >> 2) % HAIR.length];
  const body = ROLE_COLOR[q.role] ?? C.amber;
  const bob = q.walkPhase > 0 ? Math.abs(Math.sin(q.walkPhase)) * 1.2 * s : 0;
  const swing = q.walkPhase > 0 ? Math.sin(q.walkPhase) * 2.2 * s : 0;

  // ground shadow
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(bx, by, 4.2 * s, 1.8 * s, 0, 0, Math.PI * 2);
  g.fill();

  if (q.sitting) {
    // legs forward, seat hides hips
    g.fillStyle = shade(body, 0.45);
    g.fillRect(bx - 3.2 * s, by - 6 * s, 6.4 * s, 2.6 * s);
    // torso
    const ty = by - 16 * s;
    g.fillStyle = body;
    rr(g, bx - 3.4 * s, ty, 6.8 * s, 9.5 * s, 1.6 * s);
    g.fill();
    // typing arms
    const ph = q.typing ? Math.sin(q.t * 14 + q.seed) : 0;
    g.strokeStyle = shade(body, 0.8);
    g.lineWidth = 1.8 * s;
    g.beginPath();
    g.moveTo(bx - 3 * s, ty + 4 * s);
    g.lineTo(bx - 4.5 * s, by - 7 * s + ph * 1.2 * s);
    g.moveTo(bx + 3 * s, ty + 4 * s);
    g.lineTo(bx + 4.5 * s, by - 7 * s - ph * 1.2 * s);
    g.stroke();
    head(c, bx, by - 21 * s, skin, hair, q.seed);
  } else {
    const legA = Math.sin(q.walkPhase) * 2.2 * s;
    g.fillStyle = '#1c1c1c';
    g.fillRect(bx - 2.6 * s - legA * 0.3, by - 6 * s - bob, 2 * s, 6 * s);
    g.fillRect(bx + 0.6 * s + legA * 0.3, by - 6 * s - bob, 2 * s, 6 * s);
    const ty = by - 15 * s - bob;
    g.fillStyle = body;
    rr(g, bx - 3.4 * s, ty, 6.8 * s, 9.2 * s, 1.6 * s);
    g.fill();
    g.strokeStyle = shade(body, 0.8);
    g.lineWidth = 1.6 * s;
    g.beginPath();
    g.moveTo(bx - 3.2 * s, ty + 2 * s);
    g.lineTo(bx - 3.2 * s - swing, ty + 8 * s);
    g.moveTo(bx + 3.2 * s, ty + 2 * s);
    g.lineTo(bx + 3.2 * s + swing, ty + 8 * s);
    g.stroke();
    head(c, bx, by - 20 * s - bob, skin, hair, q.seed);
  }

  if (q.highlight) {
    g.strokeStyle = C.blue;
    g.lineWidth = 1 * s;
    g.beginPath();
    g.ellipse(bx, by - 12 * s, 7 * s, 15 * s, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

function head(c: Ctx, x: number, y: number, skin: string, hair: string, seed: number): void {
  const { g, p } = c;
  const s = p.scale;
  // hair behind the face
  g.fillStyle = hair;
  g.beginPath();
  g.arc(x, y - 0.4 * s, seed % 3 === 0 ? 3.5 * s : 3.9 * s, 0, Math.PI * 2);
  g.fill();
  // face
  g.fillStyle = skin;
  g.beginPath();
  g.arc(x, y + 0.5 * s, 3.1 * s, 0, Math.PI * 2);
  g.fill();
  // fringe across the top of the face
  g.fillStyle = hair;
  g.beginPath();
  g.arc(x, y - 0.2 * s, 3.2 * s, Math.PI * 1.1, Math.PI * 1.9);
  g.fill();
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
