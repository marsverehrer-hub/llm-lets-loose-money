// v19 C1: the open hub. Downloads, the license gate on products, and the hub notice.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { rivalLabs } from '../src/sim/systems/rivals';
import { datasetById } from '../src/sim/systems/data';
import { hubDatasets, hubModels, hubTick, licenseAllows } from '../src/sim/systems/hub';
import { emptyCaps } from '../src/sim/systems/capabilities';
import type { GameState, HubLicense, RivalModel } from '../src/sim/types';

function openModel(id: string, overall: number, license: HubLicense): RivalModel {
  return {
    id, name: `Model ${id}`, paramsB: 7, tokensB: 100, dataQuality: 0.5, arch: 'dense', caps: emptyCaps(),
    overall, elo: 1200, trainedDay: 0, releasedDay: 0, open: true, license, datasetIds: [],
  };
}

/** A fresh game with one active rival lab that has shipped one open model. */
function withHub(license: HubLicense = 'noncommercial', overall = 60): { s: GameState; labId: string } {
  const s = createInitialState(42, 'Hub Co');
  s.finance.cash = 1e12;
  const lab = rivalLabs(s)[0];
  lab.status = 'active';
  lab.models = [openModel('open1', overall, license)];
  return { s, labId: lab.id };
}

describe('licenses', () => {
  it('permissive allows everything; noncommercial only releases; research allows nothing', () => {
    for (const u of ['product', 'contract', 'release'] as const) expect(licenseAllows('permissive', u)).toBe(true);
    expect(licenseAllows('noncommercial', 'release')).toBe(true);
    expect(licenseAllows('noncommercial', 'product')).toBe(false);
    expect(licenseAllows('noncommercial', 'contract')).toBe(false);
    for (const u of ['product', 'contract', 'release'] as const) expect(licenseAllows('research', u)).toBe(false);
    expect(licenseAllows(undefined, 'product')).toBe(true);
  });
});

describe('downloadHubModel', () => {
  it('creates a model with an origin', () => {
    const { s, labId } = withHub('permissive');
    expect(hubModels(s).map((h) => h.model.id)).toEqual(['open1']);
    dispatch(s, { type: 'downloadHubModel', labId, modelId: 'open1' });
    const m = s.models.find((x) => x.origin);
    expect(m).toBeDefined();
    expect(m!.origin).toEqual({ labId, modelId: 'open1', license: 'permissive' });
    expect(m!.name).toContain('Model open1');
    expect(m!.releasedDay).toBeNull();
    expect(m!.datasetIds).toEqual([]);
    expect(m!.trainedDay).toBe(s.day);
  });

  it('refuses a duplicate download', () => {
    const { s, labId } = withHub('permissive');
    dispatch(s, { type: 'downloadHubModel', labId, modelId: 'open1' });
    dispatch(s, { type: 'downloadHubModel', labId, modelId: 'open1' });
    expect(s.models.filter((m) => m.origin?.modelId === 'open1')).toHaveLength(1);
  });

  it('refuses a model that is not on the hub', () => {
    const { s, labId } = withHub('permissive');
    dispatch(s, { type: 'downloadHubModel', labId, modelId: 'nope' });
    expect(s.models.some((m) => m.origin)).toBe(false);
  });
});

describe('products and the license gate', () => {
  it('a noncommercial model cannot be put on a product', () => {
    const { s, labId } = withHub('noncommercial');
    dispatch(s, { type: 'downloadHubModel', labId, modelId: 'open1' });
    const m = s.models.find((x) => x.origin)!;
    m.releasedDay = s.day; // as if released through the release gate
    dispatch(s, { type: 'launchProduct', kind: 'api', name: 'Hub API', modelId: m.id, price: 10 });
    expect(s.products).toHaveLength(0);
    expect(s.noticeLog?.some((n) => n.text.includes("noncommercial weights can't be sold"))).toBe(true);
  });

  it('a permissive model can be put on a product', () => {
    const { s, labId } = withHub('permissive');
    dispatch(s, { type: 'downloadHubModel', labId, modelId: 'open1' });
    const m = s.models.find((x) => x.origin)!;
    m.releasedDay = s.day;
    dispatch(s, { type: 'launchProduct', kind: 'api', name: 'Hub API', modelId: m.id, price: 10 });
    expect(s.products).toHaveLength(1);
  });
});

describe('downloadHubDataset', () => {
  it('makes a hub dataset owned and usable', () => {
    const { s, labId } = withHub();
    rivalLabs(s)[0].publishedData.push({ id: 'pub-2030', name: 'Open Crawl 2030', tokensB: 50, quality: 0.6, kind: 'web', day: s.day, license: 'noncommercial' });
    expect(hubDatasets(s)).toHaveLength(1);
    dispatch(s, { type: 'downloadHubDataset', labId, datasetId: 'pub-2030' });
    expect(s.data.owned).toContain('pub-2030');
    const d = datasetById(s, 'pub-2030');
    expect(d).toBeDefined();
    expect(d!.tokensB).toBe(50);
    expect(d!.legalRisk).toBe(0.3);
    expect(d!.cost).toBe(0);
  });

  it('refuses a duplicate dataset download', () => {
    const { s, labId } = withHub();
    rivalLabs(s)[0].publishedData.push({ id: 'pub-2030', name: 'Open Crawl', tokensB: 5, quality: 0.5, kind: 'code', day: s.day, license: 'research' });
    dispatch(s, { type: 'downloadHubDataset', labId, datasetId: 'pub-2030' });
    dispatch(s, { type: 'downloadHubDataset', labId, datasetId: 'pub-2030' });
    expect(s.data.owned.filter((id) => id === 'pub-2030')).toHaveLength(1);
    expect(s.data.custom?.filter((d) => d.id === 'pub-2030')).toHaveLength(1);
  });
});

describe('hubTick', () => {
  it('notices a rival open release that beats the best model, once per lab per month', () => {
    const { s } = withHub('permissive', 80);
    hubTick(s);
    hubTick(s);
    const hits = (s.noticeLog ?? []).filter((n) => n.text.includes('beats your best'));
    expect(hits).toHaveLength(1);
  });
});
