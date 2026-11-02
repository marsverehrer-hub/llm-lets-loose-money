// A model drawn as the network it is (DESIGN.md "Visuals per screen"). Depth and width follow the parameter count
// (netSpec.ts), the architecture picks the shape (transformer blocks, MoE experts behind a router, LSTM loops, state-space
// blocks, a diffusion U-Net with skip connections, a GAN's generator arguing with its discriminator) and signal pulses
// run through it: attention reaches back to earlier tokens, a router lights two experts, the output distribution
// flickers or a picture denoises. While a model trains, layers past the progress mark are a wireframe being drawn.
// Canvas, token colours read at draw time, paused off-screen, a still frame under prefers-reduced-motion.
import { useEffect, useRef } from 'preact/hooks';
import { formatParams } from '../../sim/util';
import type { NetSpec } from './netSpec';
import { weightsSize } from './netSpec';

export interface NetViewProps {
  spec: NetSpec;
  /** 0..1 while training: layers past it are still being built. Omit for a finished model. */
  progress?: number;
  height?: number;
  /** Stable seed so the same model always draws the same wiring. */
  seed?: string;
  /** Hide the stat line under the drawing. */
  bare?: boolean;
}

interface Col {
  x: number;
  ys: number[];
  kind: 'in' | 'attn' | 'mlp' | 'expert' | 'state' | 'lstm' | 'conv' | 'gen' | 'disc' | 'out';
  /** Transformer block this column belongs to (-1 for in/out). */
  block: number;
  /** MoE: expert index of each neuron. */
  group?: number[];
}

interface Pulse {
  path: number[]; // neuron index per column
  t: number; // columns travelled (fractional)
  experts?: Set<number>;
}

interface Arc {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  age: number;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rngFrom(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Neurons drawn per column for a hidden width. */
function neuronsFor(width: number): number {
  return clamp(Math.round(1.6 * Math.log2(width / 32)), 3, 12);
}

/** Lay out the columns for a spec in a W × H box. Returns the columns and where the "×N more" break goes. */
function layout(spec: NetSpec, W: number, H: number): { cols: Col[]; breakX: number | null; shownBlocks: number } {
  const top = 26;
  const bottom = H - 16;
  const mid = (top + bottom) / 2;
  const colY = (n: number, maxSpan = bottom - top) => {
    const gap = Math.min(15, maxSpan / Math.max(1, n));
    const span = gap * (n - 1);
    return Array.from({ length: n }, (_, i) => mid - span / 2 + i * gap);
  };
  const n = neuronsFor(spec.width);
  const x0 = 40;
  const x1 = W - 52;
  const cols: Col[] = [];
  let breakX: number | null = null;

  if (spec.family === 'unet') {
    const depth = clamp(Math.round(Math.log2(spec.layers)) , 2, 4);
    const sizes: number[] = [];
    for (let i = 0; i <= depth; i++) sizes.push(Math.max(2, n - i * 2));
    for (let i = depth - 1; i >= 0; i--) sizes.push(Math.max(2, n - i * 2));
    const step = (x1 - x0) / (sizes.length + 1);
    cols.push({ x: x0, ys: colY(5), kind: 'in', block: -1 });
    sizes.forEach((k, i) => cols.push({ x: x0 + step * (i + 1), ys: colY(k), kind: 'conv', block: i }));
    cols.push({ x: x1, ys: colY(5), kind: 'out', block: -1 });
    return { cols, breakX, shownBlocks: sizes.length };
  }

  if (spec.family === 'gan') {
    const gen = [3, Math.max(4, n - 4), Math.max(5, n - 2), n];
    const disc = [n, Math.max(4, n - 3), Math.max(3, n - 6), 1];
    const span = x1 - x0;
    const imgX = x0 + span * 0.5;
    cols.push({ x: x0, ys: colY(3), kind: 'in', block: -1 });
    gen.forEach((k, i) => cols.push({ x: x0 + (span * 0.42 * (i + 1)) / (gen.length + 0.4), ys: colY(k), kind: 'gen', block: i }));
    cols.push({ x: imgX, ys: colY(5), kind: 'out', block: -2 }); // the generated picture sits in the middle
    disc.forEach((k, i) => cols.push({ x: imgX + (span * 0.46 * (i + 1)) / disc.length, ys: colY(k), kind: 'disc', block: 10 + i }));
    return { cols, breakX, shownBlocks: gen.length + disc.length };
  }

  const perBlock = spec.family === 'lstm' || spec.family === 'recurrent' ? 1 : 2;
  const maxBlocks = clamp(Math.floor((x1 - x0 - 40) / (perBlock * 22)), 2, 20);
  const shown = Math.min(spec.layers, maxBlocks);
  const truncated = spec.layers > shown;
  const slots = shown * perBlock + (truncated ? 1 : 0);
  const step = (x1 - x0) / (slots + 1);
  let slot = 1;
  const inN = spec.input === 'tokens' ? Math.min(8, Math.max(4, n - 2)) : 5;
  cols.push({ x: x0, ys: colY(inN), kind: 'in', block: -1 });
  const breakAt = truncated ? Math.ceil(shown / 2) : -1;
  for (let b = 0; b < shown; b++) {
    if (b === breakAt) {
      breakX = x0 + step * slot;
      slot += 1;
    }
    const x = () => x0 + step * slot++;
    if (spec.family === 'lstm' || spec.family === 'recurrent') {
      cols.push({ x: x(), ys: colY(n), kind: 'lstm', block: b });
      continue;
    }
    const stateBlock = spec.family === 'ssm' && b % 3 !== 2; // hybrids: two state-space blocks per attention block
    cols.push({ x: x(), ys: colY(n), kind: stateBlock ? 'state' : 'attn', block: b });
    if (spec.family === 'moe') {
      const e = Math.min(spec.experts, 6);
      const per = 2;
      const ys = colY(e * per, bottom - top);
      cols.push({ x: x(), ys, kind: 'expert', block: b, group: ys.map((_, i) => Math.floor(i / per)) });
    } else {
      cols.push({ x: x(), ys: colY(n), kind: 'mlp', block: b });
    }
  }
  cols.push({ x: x1, ys: colY(spec.output === 'tokens' ? 6 : 5), kind: 'out', block: -1 });
  return { cols, breakX, shownBlocks: shown };
}

/** Each neuron's next-column targets (2 or 3 each), deterministic for a seed. */
function wiring(cols: Col[], rnd: () => number): number[][][] {
  return cols.slice(0, -1).map((c, ci) => {
    const next = cols[ci + 1];
    return c.ys.map(() => {
      const k = Math.min(next.ys.length, 2 + Math.floor(rnd() * 2));
      const set = new Set<number>();
      while (set.size < k) set.add(Math.floor(rnd() * next.ys.length));
      return [...set];
    });
  });
}

function readTokens(el: Element) {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    fg: v('--fg', '#eee'),
    fg2: v('--fg-2', '#bbb'),
    fg3: v('--fg-3', '#888'),
    line: v('--line', '#333'),
    line2: v('--line-2', '#555'),
    bg: v('--bg-1', '#111'),
    hl: v('--hl', '#ffd84a'),
    blue: v('--blue', '#8cf'),
    up: v('--up', '#7e9'),
    down: v('--down', '#f76'),
    hub: [v('--hub-lab', '#8cf'), v('--hub-infra', '#f95'), v('--hub-business', '#7e9'), v('--hub-company', '#c9f'), v('--hl', '#fd4')],
    code: v('--code', 'monospace'),
  };
}

export function NetView({ spec, progress, height = 210, seed = 'net', bare = false }: NetViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const key = `${spec.family}|${spec.layers}|${spec.width}|${spec.experts}|${spec.output}|${seed}`;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = height;
    let cols: Col[] = [];
    let edges: number[][][] = [];
    let breakX: number | null = null;
    let glow: number[][] = [];
    let pulses: Pulse[] = [];
    let arcs: Arc[] = [];
    let colors = readTokens(wrap);
    let raf = 0;
    let visible = true;
    let last = 0;
    let spawn = 0;
    let phase = 0; // 0..1, denoising and the GAN verdict cycle
    let outPick = 0;
    let frames = 0;
    const rnd = rngFrom(hash(key));
    const live = rngFrom(hash(key) ^ 0x9e3779b9);
    // Pixel targets for a picture output: a small landscape in the hub colours.
    const target = Array.from({ length: 36 }, (_, i) => {
      const r = Math.floor(i / 6);
      const c = i % 6;
      const sun = Math.hypot(r - 1.2, c - 4) < 1.3;
      return sun ? 4 : r < 3 ? (c + r) % 2 : r === 3 ? 3 : 2;
    });
    const noise = Array.from({ length: 36 }, () => live());

    const build = () => {
      W = Math.max(240, wrap.clientWidth);
      H = height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const l = layout(spec, W, H);
      cols = l.cols;
      breakX = l.breakX;
      edges = wiring(cols, rngFrom(hash(key)));
      glow = cols.map((c) => c.ys.map(() => 0));
      pulses = [];
      arcs = [];
      colors = readTokens(wrap);
    };

    /** Columns that exist yet (training builds the network left to right). */
    const builtCols = () => {
      const p = progressRef.current;
      if (p === undefined) return cols.length;
      const blocks = cols.filter((c) => c.block >= 0);
      const lastBlock = Math.max(0, ...blocks.map((c) => c.block));
      const upto = Math.floor(clamp(p, 0, 1) * (lastBlock + 1));
      let k = 1;
      while (k < cols.length - 1 && cols[k].block < upto) k++;
      return p >= 0.999 ? cols.length : k;
    };

    const spawnPulse = () => {
      const path: number[] = [Math.floor(live() * cols[0].ys.length)];
      let experts: Set<number> | undefined;
      for (let ci = 0; ci < cols.length - 1; ci++) {
        const opts = edges[ci][path[ci]];
        let pick = opts[Math.floor(live() * opts.length)];
        const next = cols[ci + 1];
        if (next.kind === 'expert' && next.group) {
          // The router sends this token to two experts.
          const groups = Math.max(...next.group) + 1;
          experts = new Set<number>();
          while (experts.size < Math.min(2, groups)) experts.add(Math.floor(live() * groups));
          const allowed = next.ys.map((_, i) => i).filter((i) => experts!.has(next.group![i]));
          pick = allowed[Math.floor(live() * allowed.length)];
        }
        path.push(pick);
      }
      pulses.push({ path, t: 0, experts });
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, W, H);
      const built = builtCols();
      const c = colors;
      // Block frames: a faint box per transformer block, dashed while still being trained.
      const byBlock = new Map<number, Col[]>();
      for (const col of cols) if (col.block >= 0) byBlock.set(col.block, [...(byBlock.get(col.block) ?? []), col]);
      ctx.lineWidth = 1;
      for (const [, group] of byBlock) {
        const xs = group.map((g) => g.x);
        const ys = group.flatMap((g) => g.ys);
        const isBuilt = cols.indexOf(group[group.length - 1]) < built;
        ctx.strokeStyle = c.line;
        ctx.setLineDash(isBuilt ? [] : [3, 3]);
        ctx.strokeRect(Math.min(...xs) - 9, Math.min(...ys) - 9, Math.max(...xs) - Math.min(...xs) + 18, Math.max(...ys) - Math.min(...ys) + 18);
      }
      ctx.setLineDash([]);

      // Edges.
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = c.line2;
      ctx.beginPath();
      for (let ci = 0; ci < cols.length - 1; ci++) {
        if (ci + 1 >= built) break;
        const a = cols[ci];
        const b = cols[ci + 1];
        if (breakX !== null && a.x < breakX && b.x > breakX) continue;
        edges[ci].forEach((targets, i) => {
          for (const j of targets) {
            ctx.moveTo(a.x, a.ys[i]);
            ctx.lineTo(b.x, b.ys[j]);
          }
        });
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // The "more layers" break: two slashes and a count.
      if (breakX !== null) {
        const hidden = spec.layers - cols.filter((col) => col.kind === 'attn' || col.kind === 'state' || col.kind === 'lstm').length;
        ctx.strokeStyle = c.fg3;
        ctx.lineWidth = 1.5;
        for (const dx of [-4, 4]) {
          ctx.beginPath();
          ctx.moveTo(breakX + dx - 4, H / 2 + 10);
          ctx.lineTo(breakX + dx + 4, H / 2 - 10);
          ctx.stroke();
        }
        ctx.fillStyle = c.fg3;
        ctx.font = `10px ${c.code}`;
        ctx.textAlign = 'center';
        ctx.fillText(`+${hidden}`, breakX, H / 2 + 26);
        ctx.lineWidth = 1;
      }

      // U-Net skip connections arch over the top.
      if (spec.family === 'unet') {
        const conv = cols.filter((col) => col.kind === 'conv');
        ctx.strokeStyle = c.blue;
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < Math.floor(conv.length / 2); i++) {
          const a = conv[i];
          const b = conv[conv.length - 1 - i];
          const y = Math.min(a.ys[0], b.ys[0]) - 4;
          ctx.beginPath();
          ctx.moveTo(a.x, y);
          ctx.quadraticCurveTo((a.x + b.x) / 2, y - 22 + i * 5, b.x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Recurrence: LSTM cells loop on themselves; recurrent-depth models loop the whole stack.
      if (spec.family === 'lstm') {
        ctx.strokeStyle = c.blue;
        for (const col of cols.filter((x) => x.kind === 'lstm')) {
          ctx.beginPath();
          ctx.arc(col.x, col.ys[0] - 10, 6, Math.PI * 0.1, Math.PI * 1.9);
          ctx.stroke();
        }
      }
      if (spec.family === 'recurrent' || spec.family === 'diffusion_lm') {
        const first = cols[1];
        const lastCol = cols[cols.length - 2];
        const y = H - 8;
        ctx.strokeStyle = c.blue;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(lastCol.x, lastCol.ys[lastCol.ys.length - 1] + 6);
        ctx.quadraticCurveTo((first.x + lastCol.x) / 2, y + 6, first.x, first.ys[first.ys.length - 1] + 6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = c.blue;
        ctx.font = `10px ${c.code}`;
        ctx.textAlign = 'center';
        ctx.fillText(spec.family === 'recurrent' ? 'loops x4' : 'refine', (first.x + lastCol.x) / 2, y);
      }

      // Attention arcs reaching back to earlier tokens.
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        a.age += dt;
        if (a.age > 0.7) {
          arcs.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 0.65 * (1 - a.age / 0.7);
        ctx.strokeStyle = c.blue;
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.quadraticCurveTo((a.x1 + a.x2) / 2, Math.min(a.y1, a.y2) - 40, a.x2, a.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Neurons.
      cols.forEach((col, ci) => {
        if (col.kind === 'in' || col.kind === 'out') return;
        const isBuilt = ci < built;
        const r = col.kind === 'expert' ? 3 : 3.6;
        col.ys.forEach((y, i) => {
          const g = glow[ci][i];
          glow[ci][i] = Math.max(0, g - dt * 2.2);
          ctx.beginPath();
          if (col.kind === 'state') ctx.rect(col.x - 3.5, y - 3.5, 7, 7);
          else ctx.arc(col.x, y, r, 0, Math.PI * 2);
          if (!isBuilt) {
            ctx.strokeStyle = c.line2;
            ctx.setLineDash([2, 2]);
            ctx.stroke();
            ctx.setLineDash([]);
            return;
          }
          ctx.fillStyle = c.bg;
          ctx.fill();
          ctx.strokeStyle = col.kind === 'attn' ? c.blue : col.kind === 'expert' ? c.up : col.kind === 'disc' ? c.down : c.fg3;
          ctx.stroke();
          if (g > 0.02) {
            ctx.globalAlpha = Math.min(1, g);
            ctx.fillStyle = c.hl;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        });
        // MoE: a box around each expert, the router diamond in front.
        if (col.kind === 'expert' && col.group) {
          const groups = Math.max(...col.group) + 1;
          ctx.strokeStyle = c.line2;
          for (let gi = 0; gi < groups; gi++) {
            const ys = col.ys.filter((_, i) => col.group![i] === gi);
            const lit = ys.some((_, k) => glow[ci][col.group!.indexOf(gi) + k] > 0.05);
            ctx.strokeStyle = lit ? c.up : c.line2;
            ctx.strokeRect(col.x - 7, Math.min(...ys) - 6, 14, Math.max(...ys) - Math.min(...ys) + 12);
          }
          const rx = col.x - 13;
          ctx.fillStyle = c.bg;
          ctx.strokeStyle = c.up;
          ctx.beginPath();
          ctx.moveTo(rx, 14);
          ctx.lineTo(rx + 4, 18);
          ctx.lineTo(rx, 22);
          ctx.lineTo(rx - 4, 18);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          if (spec.experts > groups) {
            ctx.fillStyle = c.fg3;
            ctx.font = `9px ${c.code}`;
            ctx.textAlign = 'center';
            ctx.fillText(`/${spec.experts}`, col.x, H - 4);
          }
        }
      });

      // Input: tokens, noise or patches.
      const inCol = cols[0];
      inCol.ys.forEach((y, i) => {
        const g = glow[0][i];
        glow[0][i] = Math.max(0, g - dt * 2);
        const s = spec.input === 'tokens' ? 9 : 10;
        if (spec.input === 'noise') ctx.fillStyle = `rgba(128,128,128,${0.25 + 0.5 * noise[(i * 7) % 36]})`;
        else if (spec.input === 'patches') ctx.fillStyle = c.hub[i % c.hub.length];
        else ctx.fillStyle = c.bg;
        ctx.fillRect(inCol.x - s / 2 - 8, y - s / 2, s, s);
        ctx.strokeStyle = g > 0.05 ? c.hl : c.fg3;
        ctx.strokeRect(inCol.x - s / 2 - 8, y - s / 2, s, s);
      });

      // Output: a token distribution, or a picture that denoises.
      const out = cols[cols.length - 1];
      const outBuilt = cols.length - 1 < built || spec.family === 'gan';
      if (spec.output === 'tokens') {
        out.ys.forEach((y, i) => {
          const base = 0.18 + 0.6 * Math.abs(Math.sin(i * 1.7 + hash(key) % 7));
          const w = i === outPick ? 26 : 26 * base * 0.6;
          ctx.fillStyle = i === outPick && outBuilt ? c.hl : c.line2;
          ctx.fillRect(out.x - 6, y - 3, w, 6);
        });
      } else {
        const frames = spec.output === 'video' ? 3 : 1;
        const cell = spec.family === 'gan' ? 5 : 6;
        const gridW = cell * 6;
        for (let f = 0; f < frames; f++) {
          const ox = out.x - gridW / 2 + (frames > 1 ? (f - 1) * 6 : 0) + (spec.family === 'gan' ? 0 : 8);
          const oy = H / 2 - gridW / 2 + (frames > 1 ? (f - 1) * 6 : 0);
          const clarity = spec.family === 'unet' || spec.family === 'dit' ? clamp(phase * 1.25, 0, 1) : spec.family === 'gan' ? 0.75 : 1;
          for (let p = 0; p < 36; p++) {
            const show = outBuilt && live() < 0.995 ? clarity : 0;
            ctx.globalAlpha = 1;
            ctx.fillStyle = `rgba(128,128,128,${0.2 + 0.6 * noise[(p + f * 5) % 36]})`;
            ctx.fillRect(ox + (p % 6) * cell, oy + Math.floor(p / 6) * cell, cell, cell);
            if (show > 0) {
              ctx.globalAlpha = show;
              ctx.fillStyle = c.hub[target[p]];
              ctx.fillRect(ox + (p % 6) * cell, oy + Math.floor(p / 6) * cell, cell, cell);
              ctx.globalAlpha = 1;
            }
          }
          ctx.strokeStyle = c.fg3;
          ctx.strokeRect(ox, oy, gridW, gridW);
        }
      }

      // GAN verdict.
      if (spec.family === 'gan') {
        const last = cols[cols.length - 1];
        ctx.font = `10px ${c.code}`;
        ctx.textAlign = 'left';
        const real = phase > 0.5;
        ctx.fillStyle = real ? c.up : c.down;
        ctx.fillText(real ? 'REAL?' : 'FAKE', last.x + 8, H / 2 + 4);
      }

      // Pulses.
      ctx.fillStyle = c.hl;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += (dt * cols.length) / 2.5; // a signal crosses the whole network in about 2.5 s
        const ci = Math.floor(p.t);
        if (ci >= built - 1 || ci >= cols.length - 1) {
          if (ci >= cols.length - 1) outPick = Math.floor(live() * out.ys.length);
          pulses.splice(i, 1);
          continue;
        }
        const f = p.t - ci;
        const a = cols[ci];
        const b = cols[ci + 1];
        const ya = a.ys[p.path[ci]];
        const yb = b.ys[p.path[ci + 1]];
        if (breakX !== null && a.x < breakX && b.x > breakX) continue;
        const x = a.x + (b.x - a.x) * f;
        const y = ya + (yb - ya) * f;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        if (f > 0.9 && glow[ci + 1][p.path[ci + 1]] < 0.9) {
          glow[ci + 1][p.path[ci + 1]] = 1;
          if (b.kind === 'attn' && live() < 0.5) {
            const t = Math.floor(live() * inCol.ys.length);
            arcs.push({ x1: b.x, y1: yb, x2: inCol.x - 8, y2: inCol.ys[t], age: 0 });
            glow[0][t] = 1;
          }
        }
        if (f < 0.1) glow[ci][p.path[ci]] = Math.max(glow[ci][p.path[ci]], 0.8);
      }

      // Training label.
      const prog = progressRef.current;
      if (prog !== undefined && prog < 0.999) {
        ctx.fillStyle = c.hl;
        ctx.font = `10px ${c.code}`;
        ctx.textAlign = 'left';
        ctx.fillText(`TRAINING ${Math.round(prog * 100)}%`, 8, 12);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      spawn -= dt;
      phase = (phase + dt / 4) % 1;
      if (spawn <= 0 && pulses.length < 24) {
        spawnPulse();
        spawn = 0.12 + live() * 0.18;
      }
      if (++frames % 90 === 0) colors = readTokens(wrap); // themes switch rarely; re-read now and then
      draw(dt);
      raf = requestAnimationFrame(frame);
    };

    build();
    if (still) {
      for (let k = 0; k < 6; k++) spawnPulse();
      for (const p of pulses) p.t = 2 + live() * 6;
      phase = 1;
      draw(0.016);
    } else raf = requestAnimationFrame(frame);

    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      build();
      if (still) draw(0.016);
    }) : null;
    ro?.observe(wrap);
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      last = 0;
      if (visible && !still && !raf) raf = requestAnimationFrame(frame);
    }) : null;
    io?.observe(wrap);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [key, height]);

  const moe = spec.experts > 1;
  const kind = spec.output === 'tokens' ? '' : spec.family === 'unet' ? 'U-Net denoiser · ' : spec.family === 'gan' ? 'Generator vs discriminator · ' : 'Transformer denoiser · ';
  return (
    <div class="netview" ref={wrapRef}>
      <canvas ref={canvasRef} class="netview-canvas" role="img" aria-label={`Network diagram: ${spec.layers} layers, ${spec.width} wide, ${formatParams(spec.paramsB)} parameters`} />
      {!bare && <SizeRuler paramsB={spec.paramsB} marks={LANDMARKS[spec.output]} />}
      {!bare && (
        <div class="netview-stats num">
          <span>{kind}{spec.layers} layers × {spec.width.toLocaleString('en-US')} wide</span>
          {spec.heads > 0 && spec.output === 'tokens' && <span>{spec.heads} attention heads</span>}
          {moe && <span>{spec.experts} experts, {spec.topK} per token</span>}
          <span>{moe ? `${formatParams(spec.activeParamsB)} active of ${formatParams(spec.paramsB)}` : `${formatParams(spec.paramsB)} params`}</span>
          <span>{weightsSize(spec.paramsB)} of weights</span>
          {spec.output === 'tokens' && <span>{spec.contextK >= 1000 ? `${spec.contextK / 1000}M` : `${spec.contextK}K`} context</span>}
        </div>
      )}
    </div>
  );
}

/** Landmarks on the size ruler: parody models everyone measures against (sizes are rumours, as is tradition). */
const LANDMARKS: Record<NetSpec['output'], [number, string][]> = {
  tokens: [
    [0.117, 'GPTee-1'],
    [1.5, 'GPTee-2'],
    [175, 'GPTee-3'],
    [405, 'Llamaish 405B'],
    [1800, 'frontier rumours'],
  ],
  image: [
    [0.1, 'StyleGANish'],
    [0.9, 'Instability 1.5'],
    [3.5, 'DALL-Eh 2'],
    [12, 'Flux Capacitor'],
  ],
  video: [
    [1.5, 'early video'],
    [14, 'Sorta'],
    [30, 'world sims'],
  ],
};
const RULER_MIN = 0.1;
const RULER_MAX = 10_000;
const rulerPct = (p: number) => (100 * Math.log10(clamp(p, RULER_MIN, RULER_MAX) / RULER_MIN)) / Math.log10(RULER_MAX / RULER_MIN);

/** Where this model sits on a log scale of model sizes, from 100M to 10T parameters. */
function SizeRuler({ paramsB, marks }: { paramsB: number; marks: [number, string][] }) {
  return (
    <div class="netruler" aria-label={`Size: ${formatParams(paramsB)} parameters on a scale from 100M to 10T`}>
      <div class="netruler-track">
        {[0.1, 1, 10, 100, 1000, 10000].map((p) => (
          <span key={p} class="netruler-tick num" style={{ left: `${rulerPct(p)}%` }}>
            {formatParams(p)}
          </span>
        ))}
        {marks.map(([p, name], k) => (
          <span key={name} class="netruler-mark" style={{ left: `${rulerPct(p)}%` }} title={`${name}: ${formatParams(p)}`}>
            {/* Alternate rows so neighbours on the log scale (175B, 405B, 1.8T) never overlap. */}
            <span class={`netruler-mark-label ${k % 2 ? 'high' : ''}`}>{name}</span>
          </span>
        ))}
        <span class="netruler-fill" style={{ width: `${rulerPct(paramsB)}%` }} />
        <span class="netruler-you" style={{ left: `${rulerPct(paramsB)}%` }}>
          <span class="netruler-you-label num">{formatParams(paramsB)}</span>
        </span>
      </div>
    </div>
  );
}
