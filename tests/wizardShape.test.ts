// v18 wizard: the shape knob deepens or widens a network at the same parameter count, and the MoE top-k reaches the drawing.
import { describe, expect, it } from 'vitest';
import { depthWidth, netSpecOfText } from '../src/ui/components/netSpec';
import { defaultConfig } from '../src/sim/data/trainingOptions';
import { createInitialState } from '../src/sim/state';

describe('wizard shape and expert top-k', () => {
  it('shape -1..+1 keeps the parameter count and moves depth the other way', () => {
    const at = (shape: number) => depthWidth(10, shape);
    for (const shape of [-1, -0.5, 0, 0.5, 1]) {
      const { layers, width } = at(shape);
      const params = 12 * layers * width * width;
      expect(Math.abs(params / 1e10 - 1)).toBeLessThan(0.1); // width rounds to 64s, so not exact
    }
    expect(at(1).layers).toBeGreaterThan(at(0).layers);
    expect(at(-1).layers).toBeLessThan(at(0).layers);
    expect(at(1).width).toBeLessThan(at(0).width);
  });

  it('the run sheet shape and MoE top-k reach the network spec', () => {
    const s = createInitialState(1);
    const cfg = { ...defaultConfig(s), arch: 'moe', moeExperts: 16, shape: 1, moeTopK: 4 as const };
    const spec = netSpecOfText(10, cfg, 3);
    expect(spec.topK).toBe(4);
    expect(spec.layers).toBe(depthWidth(3, 1).layers);
    expect(netSpecOfText(10, { ...cfg, moeTopK: undefined }).topK).toBe(2);
  });
});
