// Stateless randomness: every draw is a hash of (seed, week, entity, purpose).
// Adding a company or reordering phases never reshuffles other outcomes.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform in [0, 1). */
export function rand(seed: number, week: number, id: string, purpose: string): number {
  return hash(`${seed}|${week}|${id}|${purpose}`) / 4294967296;
}

/** Standard normal. */
export function randn(seed: number, week: number, id: string, purpose: string): number {
  const u = Math.max(1e-9, rand(seed, week, id, purpose));
  const v = rand(seed, week, id, purpose + '~');
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(arr: readonly T[], u: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
export const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
