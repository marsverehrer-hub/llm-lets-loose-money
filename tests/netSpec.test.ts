// The network drawing follows the real proportions: bigger models are deeper and wider, MoE draws its active part.
import { describe, expect, it } from 'vitest';
import { depthWidth, netSpecOfMedia, netSpecOfText, weightsSize } from '../src/ui/components/netSpec';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { createInitialState } from '../src/sim/state';
import { activeParamsFor } from '../src/sim/systems/trainingMath';

describe('netSpec', () => {
  it('a 175B dense model comes out near GPT-3 proportions, a 7B one near Llama-7B', () => {
    const big = depthWidth(175);
    expect(big.layers).toBeGreaterThanOrEqual(90);
    expect(big.layers).toBeLessThanOrEqual(100);
    expect(big.width).toBeGreaterThan(11000);
    const small = depthWidth(7);
    expect(small.layers).toBeGreaterThanOrEqual(30);
    expect(small.layers).toBeLessThanOrEqual(36);
  });

  it('size grows depth and width monotonically', () => {
    let prev = depthWidth(0.1);
    for (const p of [1, 10, 100, 1000, 10000]) {
      const cur = depthWidth(p);
      expect(cur.layers).toBeGreaterThanOrEqual(prev.layers);
      expect(cur.width).toBeGreaterThanOrEqual(prev.width);
      prev = cur;
    }
  });

  it('MoE draws its active parameters and its experts', () => {
    const s = createInitialState(1);
    const cfg = { ...defaultConfig(s), arch: 'moe', moeExperts: 64 };
    const spec = netSpecOfText(1000, cfg, activeParamsFor(1000, cfg));
    expect(spec.family).toBe('moe');
    expect(spec.experts).toBe(64);
    expect(spec.activeParamsB).toBeLessThan(spec.paramsB);
    expect(spec.layers).toBeLessThan(depthWidth(1000).layers);
  });

  it('image architectures pick their shapes', () => {
    expect(netSpecOfMedia({ arch: 'gan', paramsB: 0.1, kind: 'image' }).family).toBe('gan');
    expect(netSpecOfMedia({ arch: 'diffusion_unet', paramsB: 1, kind: 'image' }).family).toBe('unet');
    expect(netSpecOfMedia({ arch: 'video_dit', paramsB: 5, kind: 'video' }).output).toBe('video');
  });

  it('weights read as bf16 bytes', () => {
    expect(weightsSize(7)).toBe('14 GB');
    expect(weightsSize(1000)).toBe('2 TB');
    expect(weightsSize(0.1)).toBe('200 MB');
  });
});
