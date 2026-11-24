// The whole look of the game: sticker cards, procedural portraits and logos, small charts, and the motion hooks.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Company } from '../sim/types';

const hash = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; return h; };
const reduced = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const FAST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fast');
if (FAST) document.documentElement.classList.add('fast');

// --- Motion --------------------------------------------------------------------------------------------------------

/** Counts 0..n, one step every `ms`. Tapping can call `finish` to jump to the end. */
export function useSteps(n: number, ms: number): [number, () => void] {
  const instant = FAST || reduced();
  const [step, setStep] = useState(instant ? n : 0);
  useEffect(() => {
    if (step >= n) return;
    const t = setTimeout(() => setStep((x) => x + 1), ms);
    return () => clearTimeout(t);
  }, [step, n, ms]);
  return [step, () => setStep(n)];
}

/** Animates a number toward its target. */
export function useCountUp(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (FAST || reduced() || from.current === target) { from.current = target; setV(target); return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const tick = (t: number): void => {
      const k = Math.min(1, (t - t0) / ms);
      setV(a + (target - a) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return v;
}

// --- Building blocks -----------------------------------------------------------------------------------------------

export type Tone = 'good' | 'bad' | 'info' | 'warn';

export function Card(p: { title?: string; tag?: string; color?: string; class?: string; children: ComponentChildren; onClick?: () => void }): JSX.Element {
  return (
    <section class={`card ${p.class ?? ''} ${p.onClick ? 'tap' : ''}`} style={p.color ? { '--band': p.color } : undefined} onClick={p.onClick}>
      {p.title && <header class="card-head"><h2>{p.title}</h2>{p.tag && <span class="tag">{p.tag}</span>}</header>}
      <div class="card-body">{p.children}</div>
    </section>
  );
}

export function Btn(p: { children: ComponentChildren; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; why?: string | null; class?: string; id?: string }): JSX.Element {
  const off = p.disabled || !!p.why;
  return (
    <button id={p.id} type="button" class={`btn ${p.kind ?? ''} ${p.class ?? ''}`} disabled={off} title={p.why ?? undefined} onClick={p.onClick}>
      {p.children}
    </button>
  );
}

export const Chip = (p: { tone?: Tone; children: ComponentChildren }): JSX.Element => <span class={`chip ${p.tone ?? 'info'}`}>{p.children}</span>;

export function Seg<T extends string | number>(p: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }): JSX.Element {
  return (
    <div class="seg" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button type="button" role="radio" aria-checked={o.v === p.value} class={o.v === p.value ? 'on' : ''} onClick={() => p.onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Stepper(p: { value: string; onDown: () => void; onUp: () => void; label: string; canDown?: boolean; canUp?: boolean }): JSX.Element {
  return (
    <div class="stepper">
      <button type="button" aria-label={`Less ${p.label}`} disabled={p.canDown === false} onClick={p.onDown}>−</button>
      <output>{p.value}</output>
      <button type="button" aria-label={`More ${p.label}`} disabled={p.canUp === false} onClick={p.onUp}>+</button>
    </div>
  );
}

export function Sheet(p: { title: string; onClose: () => void; children: ComponentChildren; foot?: ComponentChildren }): JSX.Element {
  return (
    <div class="sheet-wrap" role="dialog" aria-label={p.title}>
      <div class="sheet">
        <header class="sheet-head"><h2>{p.title}</h2><button type="button" class="x" aria-label="Close" onClick={p.onClose}>×</button></header>
        <div class="sheet-body">{p.children}</div>
        {p.foot && <footer class="sheet-foot">{p.foot}</footer>}
      </div>
    </div>
  );
}

// --- Procedural art ------------------------------------------------------------------------------------------------

export type Mood = 'neutral' | 'happy' | 'smug' | 'angry' | 'panic';
const SKIN = ['#ffd9b3', '#f2c097', '#d9a273', '#b97a4e', '#8a5a3b', '#ffe3cf'];
const HAIR = ['#2b2140', '#5a3a22', '#c98b2b', '#d94f30', '#8a8fa3', '#111827'];
const BG = ['#ffd23f', '#2ec4b6', '#ff8fa3', '#a5b4fc', '#86efac', '#fdba74', '#c4b5fd'];

/** A face from a name. The same name always gives the same face; mood moves the brows and mouth. */
export function Portrait(p: { name: string; style?: string; mood?: Mood; size?: number }): JSX.Element {
  const h = hash(p.name), pick = <T,>(arr: T[], shift: number): T => arr[(h >>> shift) % arr.length];
  const skin = pick(SKIN, 0), hair = pick(HAIR, 3), bg = pick(BG, 6), hairStyle = (h >>> 9) % 5, glasses = (h >>> 12) % 3 === 0;
  const mood = p.mood ?? 'neutral';
  const outfit = { hype: '#1d1b2f', research: '#ffffff', safety: '#7c5c3b', follower: '#3b4a6b', pricewar: '#e11d48' }[p.style ?? 'hype'] ?? '#1d1b2f';
  const brows = { neutral: ['M22 26h8', 'M34 26h8'], happy: ['M22 25q4-2 8 0', 'M34 25q4-2 8 0'], smug: ['M22 27l8-3', 'M34 25h8'], angry: ['M22 24l8 3', 'M42 24l-8 3'], panic: ['M22 23q4-3 8 0', 'M34 23q4-3 8 0'] }[mood];
  const mouth = { neutral: 'M27 41h10', happy: 'M26 39q6 6 12 0', smug: 'M27 41q6 3 11-2', angry: 'M27 42q5-4 10 0', panic: 'M28 39h8v5h-8z' }[mood];
  const eye = mood === 'panic' ? 3 : 2;
  return (
    <svg class="portrait" width={p.size ?? 48} height={p.size ?? 48} viewBox="0 0 64 64" role="img" aria-label={p.name}>
      <circle cx="32" cy="32" r="31" fill={bg} stroke="#1d1b2f" stroke-width="2" />
      <clipPath id={`c${h}`}><circle cx="32" cy="32" r="30" /></clipPath>
      <g clip-path={`url(#c${h})`}>
        <path d="M10 66q0-18 22-18t22 18z" fill={outfit} stroke="#1d1b2f" stroke-width="2" />
        {p.style === 'research' && <path d="M32 48v18" stroke="#1d1b2f" stroke-width="2" />}
        {p.style === 'follower' && <path d="M32 49l-3 6 3 10 3-10z" fill="#ef4444" />}
        <rect x="27" y="42" width="10" height="9" fill={skin} stroke="#1d1b2f" stroke-width="2" />
        <ellipse cx="32" cy="31" rx="14" ry="16" fill={skin} stroke="#1d1b2f" stroke-width="2" />
        {hairStyle === 0 && <path d="M17 28q0-16 15-16t15 16q-6-8-15-8t-15 8z" fill={hair} stroke="#1d1b2f" stroke-width="2" />}
        {hairStyle === 1 && <path d="M16 34q-3-24 16-24t16 24q-3-12-7-14-9 5-18 0-2 4-3 14z" fill={hair} stroke="#1d1b2f" stroke-width="2" />}
        {hairStyle === 2 && <path d="M18 24q2-13 14-13t14 13q-7-5-14-5t-14 5z" fill={hair} stroke="#1d1b2f" stroke-width="2" />}
        {hairStyle === 3 && <path d="M15 40q-4-30 17-30t17 30l-4-2q2-18-13-18t-13 18z" fill={hair} stroke="#1d1b2f" stroke-width="2" />}
        {hairStyle === 4 && <path d="M20 20q4-9 12-9t12 9" fill="none" stroke={hair} stroke-width="3" stroke-linecap="round" />}
        <circle cx="26" cy="31" r={eye} fill="#1d1b2f" /><circle cx="38" cy="31" r={eye} fill="#1d1b2f" />
        {glasses && <path d="M20 31a6 6 0 1 0 12 0a6 6 0 1 0-12 0m12 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0" fill="none" stroke="#1d1b2f" stroke-width="1.5" />}
        {brows.map((d) => <path d={d} fill="none" stroke="#1d1b2f" stroke-width="2" stroke-linecap="round" />)}
        <path d={mouth} fill={mood === 'panic' ? '#1d1b2f' : 'none'} stroke="#1d1b2f" stroke-width="2" stroke-linecap="round" />
      </g>
    </svg>
  );
}

export function Logo(p: { co: Pick<Company, 'name' | 'color'>; size?: number }): JSX.Element {
  const words = p.co.name.split(/\s+/);
  const mono = (words.length > 1 ? words[0][0] + words[1][0] : p.co.name.slice(0, 2)).toUpperCase();
  const size = p.size ?? 32;
  return <span class="logo" style={{ background: p.co.color, width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{mono}</span>;
}

// --- Charts --------------------------------------------------------------------------------------------------------

export function Spark(p: { data: number[]; color?: string; w?: number; h?: number }): JSX.Element {
  const w = p.w ?? 72, h = p.h ?? 24, d = p.data.length > 1 ? p.data : [p.data[0] ?? 0, p.data[0] ?? 0];
  const lo = Math.min(...d), hi = Math.max(...d), span = hi - lo || 1;
  const pts = d.map((v, i) => `${(i / (d.length - 1)) * w},${h - 2 - ((v - lo) / span) * (h - 4)}`).join(' ');
  return <svg class="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={p.color ?? '#1d1b2f'} stroke-width="2" stroke-linejoin="round" /></svg>;
}

/** A score band on a 0..100 track: shaded lo..hi, a marker at mid, a flag at the leader, optionally the real result. */
export function Band(p: { lo: number; mid: number; hi: number; leader: number; actual?: number; max?: number; min?: number }): JSX.Element {
  // Zoom on what matters: the forecast, the leader and the result, with some air either side.
  const vals = [p.lo, p.hi, ...(p.leader > 0 ? [p.leader] : []), ...(p.actual != null ? [p.actual] : [])];
  const min = p.min ?? Math.floor((Math.min(...vals) - 6) / 5) * 5, max = p.max ?? Math.ceil((Math.max(...vals) + 6) / 5) * 5;
  const x = (v: number): string => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  const w = (a: number, b: number): string => `${Math.max(1, ((Math.min(max, b) - Math.max(min, a)) / (max - min)) * 100)}%`;
  return (
    <div class="band" role="img" aria-label={`Forecast ${Math.round(p.lo)} to ${Math.round(p.hi)}, leader at ${Math.round(p.leader)}`}>
      <span class="band-fill" style={{ left: x(p.lo), width: w(p.lo, p.hi) }} />
      {p.actual == null && <span class="band-mid" style={{ left: x(p.mid) }} />}
      {p.leader > 0 && <span class="band-leader" style={{ left: x(p.leader) }} />}
      {p.actual != null && <span class={`band-actual ${p.actual > p.leader ? 'win' : ''}`} style={{ left: x(p.actual) }} />}
    </div>
  );
}

export function ShareBar(p: { parts: { key: string; share: number; color: string; label: string }[] }): JSX.Element {
  const used = p.parts.reduce((a, b) => a + b.share, 0);
  return (
    <div class="sharebar" role="img" aria-label={p.parts.map((x) => `${x.label} ${Math.round(x.share * 100)}%`).join(', ')}>
      {p.parts.map((x) => <span key={x.key} style={{ width: `${x.share * 100}%`, background: x.color }} title={`${x.label} ${Math.round(x.share * 100)}%`} />)}
      <span class="unserved" style={{ width: `${Math.max(0, 1 - used) * 100}%` }} title="Nobody yet" />
    </div>
  );
}

export function Confetti(): JSX.Element | null {
  if (FAST || reduced()) return null;
  return <div class="confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 6) * 0.12}s`, '--c': BG[i % BG.length] }} />)}</div>;
}

const ICONS: Record<string, string> = {
  desk: 'M4 13h5l1 3h4l1-3h5v6H4zM6 5h12l2 8H4z',
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8',
  market: 'M5 20V10M12 20V4M19 20v-7',
  street: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  empire: 'M4 18h16M5 18l-1-9 5 4 3-7 3 7 5-4-1 9',
  crown: 'M3 18h18l1-11-6 5-4-8-4 8-6-5z',
};
export const Icon = (p: { name: string; size?: number }): JSX.Element => (
  <svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[p.name]} /></svg>
);
export const Crown = (): JSX.Element => <svg class="crown" width="18" height="18" viewBox="0 0 24 24" aria-label="Crown"><path d={ICONS.crown} fill="#ffd23f" stroke="#1d1b2f" stroke-width="2" stroke-linejoin="round" /></svg>;
