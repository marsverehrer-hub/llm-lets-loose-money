// v19 C2: the open hub's UI reads (hubList.ts): open models, published sets, and "already in your lab".
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { rivalLabs } from '../src/sim/systems/rivals';
import { hubDatasets, hubModels, downloadedModel } from '../src/ui/panels/model/hubList';
import type { GameState, RivalModel } from '../src/sim/types';

/** A game with two labs made active, one open and one closed model each, and one published set. */
function withHub(): GameState {
  const s = createInitialState(7, 'Hub Test');
  rivalLabs(s);
  const [a, b] = s.rivals!;
  a.status = 'active';
  b.status = 'acquired';
  const model = (id: string, open: boolean, day: number): RivalModel => ({
    id,
    name: `Model ${id}`,
    paramsB: 8,
    tokensB: 100,
    dataQuality: 0.5,
    arch: 'dense',
    caps: {} as RivalModel['caps'],
    overall: 50,
    elo: 1200,
    trainedDay: day - 5,
    releasedDay: day,
    open,
    license: open ? 'permissive' : null,
  });
  a.models = [model('old', true, 100), model('closed', false, 300), model('new', true, 200)];
  b.models = [model('other', true, 150)];
  a.publishedData = [{ id: 'set-1', name: 'Open set', tokensB: 5, quality: 0.6, kind: 'web', day: 10, license: 'permissive' }];
  return s;
}

describe('open hub UI reads', () => {
  it('lists only open models from labs that exist, newest first', () => {
    const s = withHub();
    const ids = hubModels(s).map((r) => r.model.id);
    expect(ids).toEqual(['new', 'other', 'old']);
    expect(hubModels(s)[0].lab).toBeTruthy();
  });

  it('lists published sets with their lab', () => {
    const s = withHub();
    const rows = hubDatasets(s);
    expect(rows.map((r) => r.data.id)).toEqual(['set-1']);
    expect(rows[0].labId).toBe(s.rivals![0].id);
  });

  it('knows a downloaded model by its origin', () => {
    const s = withHub();
    const lab = s.rivals![0];
    expect(downloadedModel(s, lab.id, 'new')).toBe(false);
    s.models.push({ id: 'mine', origin: { labId: lab.id, modelId: 'new', license: 'permissive' } } as unknown as GameState['models'][number]);
    expect(downloadedModel(s, lab.id, 'new')).toBe(true);
  });
});
