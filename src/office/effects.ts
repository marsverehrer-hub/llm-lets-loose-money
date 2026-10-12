// Screen-space particles: floating "+$" text and a short square-flake burst on model release.

interface Particle {
  kind: 'text' | 'confetti';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  text?: string;
  color: string;
  size: number;
  rot: number;
  vr: number;
}

const MAX_PARTICLES = 160;
const CONFETTI = ['#ffa630', '#ffe14d', '#e8e4dc', '#b8741a'];

export class Effects {
  private parts: Particle[] = [];
  private moneyTimer = 0;

  /** Spawn "+$" floaters at the given screen points while revenue is positive. */
  money(points: [number, number][], dt: number, active: boolean, label: string): void {
    if (!active || points.length === 0) return;
    this.moneyTimer -= dt;
    if (this.moneyTimer > 0) return;
    this.moneyTimer = 0.6 + Math.random() * 0.8;
    const [x, y] = points[Math.floor(Math.random() * points.length)];
    this.push({
      kind: 'text',
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -22 - Math.random() * 10,
      life: 0,
      max: 1.8,
      text: label,
      color: '#3fd47f',
      size: 11,
      rot: 0,
      vr: 0,
    });
  }

  burst(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      this.push({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0,
        max: 0.5 + Math.random() * 0.3,
        color: CONFETTI[i % CONFETTI.length],
        size: 3 + Math.random() * 3,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  /** Advance and draw. Coordinates are CSS px; g already has the DPR transform. */
  step(g: CanvasRenderingContext2D, dt: number): void {
    let w = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy += (p.kind === 'confetti' ? 180 : 0) * dt; // gravity for confetti only
      p.vx *= p.kind === 'confetti' ? 0.985 : 1;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      this.parts[w++] = p;
      const k = p.life / p.max;
      g.save();
      g.globalAlpha = Math.max(0, 1 - k * k);
      if (p.kind === 'text') {
        g.font = `800 ${p.size}px IBM Plex Mono, monospace`;
        g.textAlign = 'center';
        g.fillStyle = p.color;
        g.fillText(p.text ?? '', p.x, p.y);
      } else {
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      g.restore();
    }
    this.parts.length = w;
  }

  private push(p: Particle): void {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push(p);
  }
}
