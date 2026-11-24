import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { play } from '../scripts/bot';
import { apply, check, handsOnRun } from '../src/sim/apply';
import { blocker, endWeek, fastForward } from '../src/sim/endWeek';
import { projectRevenue } from '../src/sim/demand';
import { defaultBlueprint } from '../src/sim/resolve';
import { newGame } from '../src/sim/state';
import { forecast } from '../src/sim/view';
import { CALLS, emergenceCall, finalCall, midCall, smokeCall, type CallCtx } from '../src/sim/content/calls';
import { EMERGENCES } from '../src/sim/content/tech';
import { MODALITIES } from '../src/sim/content/modalities';

const started = (seed = 3) => {
  const s0 = newGame(seed);
  const s = apply(s0, { t: 'startRun', bp: defaultBlueprint(s0, s0.labId, 'lang', 300), name: 'Test' });
  return { s, run: handsOnRun(s)! };
};

describe('turn loop', () => {
  it('is deterministic: same seed and policy give the same game', () => {
    expect(play(7, 'greedy', 40).s).toEqual(play(7, 'greedy', 40).s);
  });

  it('survives a save round-trip mid-run', () => {
    const { s } = started();
    const mid = endWeek(s);
    const loaded = JSON.parse(JSON.stringify(mid));
    expect(loaded).toEqual(mid);
    const answer = (x: typeof mid) => endWeek(apply(x, { t: 'answerCall', run: handsOnRun(x)!.id, option: 0 }));
    expect(answer(loaded)).toEqual(answer(mid));
  });

  it('will not end the week while a call is open, and gives the reason', () => {
    const { s } = started();
    const s1 = endWeek(s);
    expect(handsOnRun(s1)!.call?.def).toBe('beat.smoke');
    expect(blocker(s1)).toMatch(/needs a decision/);
    expect(endWeek(s1)).toBe(s1);
  });

  it('returns the same state object for an invalid action', () => {
    const { s } = started();
    expect(check(s, { t: 'startRun', bp: defaultBlueprint(s, s.labId, 'lang', 300), name: 'Two' })).toMatch(/one model/);
    expect(apply(s, { t: 'setPrice', model: 'nope', price: 1 })).toBe(s);
  });

  it('fast-forward stops when the player is needed', () => {
    const { s } = started();
    const r = fastForward(s);
    expect(r.weeks).toBe(1);
    expect(blocker(r.s)).not.toBeNull();
  });

  it('a first model earns money and the launch moment says so', () => {
    let { s } = started(5);
    for (let i = 0; i < 20 && !s.moments.length; i++) {
      const run = handsOnRun(s);
      if (run?.call) s = apply(s, { t: 'answerCall', run: run.id, option: 0 });
      else s = endWeek(s);
    }
    const m = s.moments[0];
    expect(m?.kind).toBe('launch');
    if (m?.kind === 'launch') expect(m.rev).toBeGreaterThan(0);
    expect(projectRevenue(s, s.labId).rev).toBeGreaterThan(0);
  });
});

describe('calls', () => {
  const { s, run } = started();
  const ctx: CallCtx = {
    s, run, wk: 1e6, u: () => 0.5, rivalSoon: { lab: 'openaye', weeks: 2 }, pivots: MODALITIES.lang.segments.slice(0, 2), reading: 0, bestAxis: 0,
  };

  it('every option of every drawn call does something', () => {
    for (const def of CALLS) {
      const call = def.make(ctx);
      expect(call.options.length, def.id).toBeGreaterThanOrEqual(3);
      for (const o of call.options) expect(o.fx.length, `${def.id}: ${o.label}`).toBeGreaterThan(0);
    }
  });

  it('beats offer at least two real alternatives', () => {
    for (const call of [smokeCall(ctx), midCall(ctx), finalCall(ctx), ...EMERGENCES.map((e) => emergenceCall(ctx, e))]) {
      expect(call.options.filter((o) => o.fx.length > 0).length, call.title).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('blueprints', () => {
  it('rejects a bad split and accepts the default', () => {
    const s = newGame(1);
    const bp = defaultBlueprint(s, s.labId, 'lang', 300);
    expect(forecast(s, bp).error).toBeNull();
    expect(forecast(s, { ...bp, split: { scale: 0.3, exp: 0.6, post: 0.1 } }).error).toMatch(/split/);
  });

  it('a bigger model costs more to serve and specialising moves the benchmarks', () => {
    const s = newGame(1);
    const bp = defaultBlueprint(s, s.labId, 'lang', 300);
    expect(forecast(s, { ...bp, sizeBias: 0.8 }).attrs.cost).toBeGreaterThan(forecast(s, { ...bp, sizeBias: -0.8 }).attrs.cost);
    const coder = forecast(s, { ...bp, mix: { web: 0.1, code: 0.7, books: 0.05, dialogue: 0.05, science: 0.1 } });
    const base = forecast(s, bp);
    const dev = (f: typeof base) => f.rows.find((r) => r.seg === 'lang.dev')!.mid;
    const chat = (f: typeof base) => f.rows.find((r) => r.seg === 'lang.consumer')!.mid;
    expect(dev(coder)).toBeGreaterThan(dev(base));
    expect(chat(coder)).toBeLessThan(chat(base));
  });
});

describe('image models', () => {
  it('run through the same engine and sell into their own segments', () => {
    const s0 = newGame(4);
    let s = apply(s0, { t: 'startRun', bp: defaultBlueprint(s0, s0.labId, 'image', 300), name: 'Pixels' });
    for (let i = 0; i < 20 && !s.moments.length; i++) {
      const run = handsOnRun(s);
      if (run?.call) s = apply(s, { t: 'answerCall', run: run.id, option: 0 });
      else s = endWeek(s);
    }
    const m = s.moments[0];
    expect(m?.kind).toBe('launch');
    if (m?.kind === 'launch') expect(m.rows.every((r) => r.seg.startsWith('image.'))).toBe(true);
  });
});

describe('hidden truth stays hidden', () => {
  it('no UI file reads run.truth or trueCap', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const bad = walk('src/ui').filter((p) => /\.tsx?$/.test(p) && /\.truth\b|trueCap|\bworld\(/.test(readFileSync(p, 'utf8')));
    expect(bad).toEqual([]);
  });
});
