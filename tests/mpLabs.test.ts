import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { tick } from '../src/sim/engine';
import { applyRivalSnapshot, buildSnapshot, mpSetConnected, startMpState } from '../src/sim/systems/multiplayer';
import type { GameState } from '../src/sim/types';

// v12: the host's AI labs are the reference world. The guest copies them from the host's snapshots instead of
// simulating its own, so both players see the same LLM Arena.
function pair(): { hs: GameState; gs: GameState } {
  const hs = createInitialState(42, 'Alpha');
  const gs = createInitialState(42, 'Beta');
  startMpState(hs, { role: 'host', room: 'ABCDEF', settings: { lengthYears: 5 }, myColor: '#5fb3f0' });
  startMpState(gs, { role: 'guest', room: 'ABCDEF', settings: { lengthYears: 5 }, myColor: '#e46fd0' });
  mpSetConnected(hs, true);
  mpSetConnected(gs, true);
  return { hs, gs };
}

const labsOf = (s: GameState) =>
  s.competitors.filter((c) => !c.human).map((c) => ({ id: c.id, active: c.active, model: c.model?.name ?? null, elo: c.model?.elo ?? null, released: c.modelsReleased, api: c.prices.api }));

describe('shared AI labs (v12)', () => {
  it('a host snapshot carries its AI labs and the guest copies them', () => {
    const { hs, gs } = pair();
    for (let i = 0; i < 700; i++) tick(hs);
    const lab = hs.competitors.find((c) => !c.human && c.model)!;
    lab.model!.elo = 1337;
    applyRivalSnapshot(gs, buildSnapshot(hs));
    expect(labsOf(gs)).toEqual(labsOf(hs));
    const copy = gs.competitors.find((c) => c.id === lab.id)!;
    expect(copy.model).not.toBe(lab.model);
  });

  it('a guest snapshot does not carry labs, so the host keeps its own', () => {
    const { hs, gs } = pair();
    expect(buildSnapshot(gs).labs).toBeUndefined();
    const before = labsOf(hs);
    applyRivalSnapshot(hs, buildSnapshot(gs));
    expect(labsOf(hs)).toEqual(before);
  });

  it("the guest's own sim does not move AI labs between snapshots", () => {
    const { hs, gs } = pair();
    for (let i = 0; i < 300; i++) tick(hs);
    applyRivalSnapshot(gs, buildSnapshot(hs));
    const synced = labsOf(gs);
    for (let i = 0; i < 300; i++) tick(gs);
    expect(labsOf(gs).map(({ api, ...rest }) => rest)).toEqual(synced.map(({ api, ...rest }) => rest));
  });
});
