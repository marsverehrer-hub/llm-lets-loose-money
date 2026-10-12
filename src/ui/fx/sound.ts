import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------------------
// Tiny WebAudio synth. Every sound is generated on the fly: no audio files.
// The AudioContext is created on the first user gesture (browsers require it).
// ---------------------------------------------------------------------------

export type Sfx = 'click' | 'cash' | 'bonk' | 'sting' | 'fanfare';

const MUTE_KEY = 'llm-lets-loose-money/muted';
const MASTER_VOLUME = 0.2;
/** Minimum gap between two plays of the same sound, in ms. Stops pile-ups. */
const MIN_GAP: Record<Sfx, number> = { click: 45, cash: 260, bonk: 260, sting: 900, fanfare: 900 };

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false; // storage blocked: default to sound on
  }
}

function writeMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // storage blocked: the setting simply lasts for this page view
  }
}

let muted = readMuted();
const muteListeners = new Set<(m: boolean) => void>();
let gestured = false;
let inited = false;
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const lastPlayed = new Map<Sfx, number>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  writeMuted(m);
  for (const l of muteListeners) l(m);
}

export function toggleMuted(): void {
  setMuted(!muted);
}

/** Re-renders the component whenever the mute setting changes. */
export function useMuted(): boolean {
  const [m, setM] = useState(muted);
  useEffect(() => {
    muteListeners.add(setM);
    return () => {
      muteListeners.delete(setM);
    };
  }, []);
  return m;
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = MASTER_VOLUME;
    out.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function unlock(): void {
  gestured = true;
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** One oscillator blip with an exponential envelope. `to` slides the pitch over the duration. */
function tone(f0: number, at: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number } = {}): void {
  const c = ctx!;
  const t0 = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(f0, t0);
  if (opts.to !== undefined) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  const vol = opts.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(out!);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** Short band-passed noise burst, used for the "cha" of the cash register and the bonk's thump. */
function noise(at: number, dur: number, vol: number, freq: number): void {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out!);
  src.start(t0, Math.random() * 0.3);
  src.stop(t0 + dur + 0.02);
}

const SOUNDS: Record<Sfx, () => void> = {
  // Very quiet tick for every button press.
  click: () => tone(1320, 0, 0.035, { type: 'triangle', vol: 0.05 }),
  // "cha-ching": a clack, then a bright two-note ring.
  cash: () => {
    noise(0, 0.05, 0.22, 3200);
    tone(1318.5, 0.05, 0.55, { vol: 0.2 });
    tone(1975.5, 0.05, 0.6, { vol: 0.14 });
    tone(2637, 0.11, 0.7, { type: 'triangle', vol: 0.09 });
  },
  // Low "bonk": a falling triangle plus a thump.
  bonk: () => {
    tone(330, 0, 0.24, { type: 'triangle', vol: 0.3, to: 110 });
    noise(0, 0.06, 0.1, 280);
  },
  // Dramatic sting for an event decision: a falling low drone, then a rising stab.
  sting: () => {
    tone(98, 0, 0.9, { type: 'sawtooth', vol: 0.08, to: 73 });
    tone(146.8, 0, 0.9, { type: 'square', vol: 0.035 });
    tone(155.6, 0.35, 0.55, { type: 'triangle', vol: 0.12 });
    tone(207.7, 0.7, 0.75, { type: 'triangle', vol: 0.12 });
  },
  // Release / IPO fanfare: a rising arpeggio that lands on a held chord.
  fanfare: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.22, { type: 'triangle', vol: 0.2 }));
    [1046.5, 1318.5, 1567.98].forEach((f) => tone(f, 0.46, 0.95, { type: 'triangle', vol: 0.12 }));
    tone(523.25, 0.46, 0.95, { type: 'sine', vol: 0.09 });
  },
};

/** Play a sound effect. Silent when muted, before the first user gesture, or when audio is unavailable. */
export function playSfx(name: Sfx): void {
  if (muted || !gestured) return;
  if (!audio()) return;
  const now = performance.now();
  const last = lastPlayed.get(name) ?? -Infinity;
  if (now - last < MIN_GAP[name]) return;
  lastPlayed.set(name, now);
  try {
    SOUNDS[name]();
  } catch {
    // a failed synth call must never break the game
  }
}

/**
 * Wire up unlocking and the UI click blip. Safe to call more than once.
 * Clicks on any <button> (including disabled-looking ones) get the tick; disabled buttons are skipped.
 */
export function initSound(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  const onGesture = () => unlock();
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onGesture, { capture: true });
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target instanceof Element ? e.target.closest('button') : null;
      if (target && !target.disabled) playSfx('click');
    },
    true,
  );
}
