// v16 media models (GAME_DESIGN §26.2): image and video training physics, presets, runs sharing compute, release,
// products and the media market, legal risk, rival lines, and old saves without a media book.
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch, tick } from '../src/sim/engine';
import type { GameState, MediaModel, MediaRunConfig } from '../src/sim/types';
import { MEDIA_DATASETS, MEDIA_PRESETS, MEDIA_TUNING, mediaArchById } from '../src/sim/data/imageModels';
import { MEDIA_RIVALS } from '../src/sim/data/imageRivals';
import {
  estimateMediaRun,
  mediaArena,
  mediaOf,
  mediaPhysics,
  mediaPresetConfig,
  mediaRivalsNow,
  mediaShare,
  validateMediaRun,
} from '../src/sim/systems/imageGen';
import { rawTrainingRate, trainingRatePerDay } from '../src/sim/systems/capabilities';
import { COMPETITORS } from '../src/sim/data/competitors';
import { loadGame, SAVE_KEY } from '../src/sim/save';

const DAY = (y: number) => Math.round(365 * (y - 2017));

/** A lab at a year, with research up to that year, a rented fleet, cash and every media set of that year. */
function lab(y: number, gpus = 256): GameState {
  const s = createInitialState(7, 'Pixel');
  s.day = DAY(y);
  s.research.completed.push('transformers', 'clip_contrastive', 'image_generation', 'video_understanding');
  s.compute.rented = { p100: gpus };
  s.finance.cash = 1e10;
  for (const c of s.competitors) c.active = true;
  mediaOf(s).owned = MEDIA_DATASETS.filter((d) => d.year <= y).map((d) => d.id);
  return s;
}

function sheet(s: GameState, patch: Partial<MediaRunConfig> = {}): MediaRunConfig {
  return { ...mediaPresetConfig(s, 'image', 'balanced')!, ...patch };
}

describe('media training physics', () => {
  it('more compute buys quality, up to the architecture ceiling', () => {
    const s = lab(2023);
    const small = mediaPhysics(s, sheet(s, { arch: 'diffusion_unet', paramsB: 0.5, samplesM: 500 }));
    const big = mediaPhysics(s, sheet(s, { arch: 'diffusion_unet', paramsB: 4, samplesM: 4000 }));
    expect(big.totalFlops).toBeGreaterThan(small.totalFlops * 50);
    expect(big.quality).toBeGreaterThan(small.quality);
    const gan = mediaPhysics(s, sheet(s, { arch: 'gan', paramsB: 4, samplesM: 4000 }));
    expect(gan.quality).toBeLessThanOrEqual(mediaArchById('gan')!.ceiling);
    expect(gan.hitCeiling).toBe(true);
  });

  it('undertraining costs points, video costs far more compute than images', () => {
    const s = lab(2025);
    const ok = mediaPhysics(s, sheet(s, { paramsB: 1, samplesM: 2000 }));
    const starved = mediaPhysics(s, sheet(s, { paramsB: 1, samplesM: 100 }));
    expect(ok.underPenalty).toBe(0);
    expect(starved.underPenalty).toBeGreaterThan(5);
    const vid = mediaPresetConfig(s, 'video', 'balanced')!;
    const sameAsImage = mediaPhysics(s, { ...vid, kind: 'image', arch: 'dit', datasetIds: sheet(s).datasetIds });
    expect(mediaPhysics(s, vid).totalFlops).toBeGreaterThan(sameAsImage.totalFlops * 5);
  });

  it('distillation trades quality for speed, opt-outs trade aesthetics for legal risk', () => {
    const s = lab(2023);
    const base = mediaPhysics(s, sheet(s));
    const fast = mediaPhysics(s, sheet(s, { distill: true }));
    expect(fast.caps.speed).toBeGreaterThan(base.caps.speed);
    expect(fast.caps.aesthetics).toBeLessThan(base.caps.aesthetics);
    expect(base.legalRisk).toBeGreaterThan(0.5); // the art scrape is in the mix
    const safe = mediaPhysics(s, sheet(s, { optOut: true }));
    expect(safe.legalRisk).toBeLessThan(base.legalRisk * 0.5);
    expect(safe.caps.aesthetics).toBeLessThan(base.caps.aesthetics);
  });
});

describe('media presets', () => {
  it('every preset gives a valid sheet that fits its time budget, for images and (from 2024) video', () => {
    for (const y of [2018, 2022, 2025]) {
      const s = lab(y);
      for (const kind of ['image', 'video'] as const) {
        for (const p of MEDIA_PRESETS) {
          const cfg = mediaPresetConfig(s, kind, p.id);
          if (kind === 'video' && y < 2024) {
            expect(cfg).toBeNull();
            continue;
          }
          expect(cfg, `${y} ${kind} ${p.id}`).not.toBeNull();
          expect(validateMediaRun(s, cfg!)).toBeNull();
          expect(estimateMediaRun(s, cfg!).days).toBeLessThanOrEqual(p.days + 1);
        }
      }
    }
  });

  it('a preset needs owned data', () => {
    const s = lab(2023);
    mediaOf(s).owned = [];
    expect(mediaPresetConfig(s, 'image', 'balanced')).toBeNull();
  });

  it('picks the architecture that does best, not just the newest', () => {
    const s = lab(2020, 16);
    s.research.completed = ['transformers']; // autoregressive tokens open, diffusion not yet
    mediaOf(s).owned = ['img_imagenot', 'img_coconut'];
    expect(mediaPresetConfig(s, 'image', 'balanced')!.arch).toBe('gan');
  });
});

describe('media runs', () => {
  it('a run shares the training compute, finishes into a model with notes, and gives the compute back', () => {
    const s = lab(2023);
    const full = trainingRatePerDay(s);
    dispatch(s, { type: 'startMediaRun', name: 'Brushstroke', config: sheet(s) });
    expect(s.media!.run).not.toBeNull();
    expect(trainingRatePerDay(s)).toBeCloseTo(full * (1 - MEDIA_TUNING.SHARED_COMPUTE_SHARE));
    expect(rawTrainingRate(s)).toBeCloseTo(full);
    for (let i = 0; i < 400 && s.media!.run; i++) {
      s.events.pending = null;
      tick(s);
    }
    expect(s.media!.run).toBeNull();
    const m = s.media!.models[0];
    expect(m.name).toBe('Brushstroke');
    expect(m.notes.length).toBeGreaterThan(0);
    expect(m.overall).toBeGreaterThan(0);
    expect(trainingRatePerDay(s)).toBe(rawTrainingRate(s));
  });

  it('rejects bad sheets: unowned data, locked architectures, too many passes', () => {
    const s = lab(2019);
    expect(validateMediaRun(s, sheet(s, { arch: 'dit' }))).toMatch(/Not until|research/);
    expect(validateMediaRun(s, sheet(s, { datasetIds: ['img_stock_nope'] }))).not.toBeNull();
    expect(validateMediaRun(s, sheet(s, { samplesM: 1e9 }))).toMatch(/passes/);
    mediaOf(s).owned = [];
    expect(validateMediaRun(s, { ...sheet(lab(2019)) })).toMatch(/own/);
  });

  it('cancelling throws the run away', () => {
    const s = lab(2023);
    dispatch(s, { type: 'startMediaRun', name: 'Oops', config: sheet(s) });
    dispatch(s, { type: 'cancelMediaRun' });
    expect(s.media!.run).toBeNull();
  });
});

function trained(s: GameState, overall: number, patch: Partial<MediaModel> = {}): MediaModel {
  const cfg = sheet(s);
  const m: MediaModel = {
    id: `mm-${overall}`,
    name: `Pix ${overall}`,
    kind: 'image',
    config: cfg,
    caps: { adherence: overall, aesthetics: overall, realism: overall, text: overall, speed: 60, motion: 0 },
    overall,
    elo: 1000 + 8 * overall,
    trainedDay: s.day,
    releasedDay: null,
    notes: [],
    forecastMid: overall,
    legalRisk: 0,
    ...patch,
  };
  mediaOf(s).models.push(m);
  return m;
}

describe('media market', () => {
  it('release, launch an app, gain users and book media revenue', () => {
    const s = lab(2022.2);
    const m = trained(s, 60);
    dispatch(s, { type: 'launchMediaProduct', kind: 'image', channel: 'app', modelId: m.id });
    expect(s.media!.products.length).toBe(0); // must be released first
    dispatch(s, { type: 'releaseMediaModel', modelId: m.id });
    expect(m.releasedDay).toBe(s.day);
    dispatch(s, { type: 'launchMediaProduct', kind: 'image', channel: 'app', modelId: m.id });
    const p = s.media!.products[0];
    expect(p.active).toBe(true);
    let media = 0;
    for (let i = 0; i < 60; i++) {
      s.events.pending = null;
      tick(s);
      media += s.finance.today.revenue['media'] ?? 0;
    }
    expect(p.users).toBeGreaterThan(1000);
    expect(media).toBeGreaterThan(0);
    expect(p.costPerDay).toBeLessThan(p.revenuePerDay);
  });

  it('the market commoditises: the same model wins far less once rivals and open weights catch up', () => {
    const early = lab(2022.1);
    const late = lab(2026);
    const a = trained(early, 60);
    const b = trained(late, 60);
    expect(mediaShare(early, 'image', 'api', a, 0.04)).toBeGreaterThan(mediaShare(late, 'image', 'api', b, 0.04) * 5);
  });

  it('a better model and a lower price both win share', () => {
    const s = lab(2024);
    const weak = trained(s, 60);
    const strong = trained(s, 85);
    expect(mediaShare(s, 'image', 'app', strong, 8)).toBeGreaterThan(mediaShare(s, 'image', 'app', weak, 8));
    expect(mediaShare(s, 'image', 'app', weak, 4)).toBeGreaterThan(mediaShare(s, 'image', 'app', weak, 8));
  });

  it('rejects silly prices and a second product of the same kind', () => {
    const s = lab(2023);
    const m = trained(s, 60, { releasedDay: 1 });
    dispatch(s, { type: 'launchMediaProduct', kind: 'image', channel: 'api', modelId: m.id, price: 1000 });
    expect(s.media!.products.length).toBe(0);
    dispatch(s, { type: 'launchMediaProduct', kind: 'image', channel: 'api', modelId: m.id });
    dispatch(s, { type: 'launchMediaProduct', kind: 'image', channel: 'api', modelId: m.id });
    expect(s.media!.products.length).toBe(1);
    dispatch(s, { type: 'shutdownMediaProduct', productId: s.media!.products[0].id });
    expect(s.media!.products[0].active).toBe(false);
  });
});

describe('media rivals and arena', () => {
  it('rival lines link to real labs or are independent, and release in order', () => {
    const labs = new Set(COMPETITORS.map((c) => c.id));
    for (const r of MEDIA_RIVALS) {
      if (r.labId) expect(labs.has(r.labId)).toBe(true);
      for (let i = 1; i < r.releases.length; i++) expect(r.releases[i].year).toBeGreaterThan(r.releases[i - 1].year);
    }
  });

  it('the arena ranks rivals and the player, and a linked line ships only while its lab is active', () => {
    const s = lab(2024);
    const m = trained(s, 95, { releasedDay: 1, elo: 1000 + 8 * 95 });
    const rows = mediaArena(s, 'image');
    expect(rows[0].name).toBe(m.name);
    expect(rows.some((r) => r.name.startsWith('DALL-Eh'))).toBe(true);
    for (const c of s.competitors) if (c.id === 'openaye') c.active = false;
    expect(mediaRivalsNow(s, 'image').some((r) => r.def.id === 'dall_eh')).toBe(false);
  });

  it('rival releases make news once the player has a media book', () => {
    const s = lab(2023.1);
    mediaOf(s);
    const before = s.news.length;
    s.day = DAY(2023.3); // Midjourmey v5 lands
    tick(s);
    expect(s.news.slice(before).some((n) => n.text.includes('Midjourmey'))).toBe(true);
  });
});

describe('old saves and idle labs', () => {
  const realLs = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (realLs) Object.defineProperty(globalThis, 'localStorage', realLs);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('a lab that never touches media has no media book and its training rate is unchanged', () => {
    const s = createInitialState(3, 'Plain');
    for (let i = 0; i < 30; i++) tick(s);
    expect(s.media).toBeUndefined();
    expect(trainingRatePerDay(s)).toBe(rawTrainingRate(s));
  });

  it('a save without a media book loads, plays, and can start an image business', () => {
    const s = createInitialState(5, 'Legacy');
    for (let i = 0; i < 10; i++) tick(s);
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.media;
    const store = new Map<string, string>([[SAVE_KEY, JSON.stringify(raw)]]);
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: () => null, length: 0 },
      configurable: true,
      writable: true,
    });
    const loaded = loadGame()!;
    expect(loaded).not.toBeNull();
    expect(loaded.media).toBeUndefined();
    for (let i = 0; i < 5; i++) tick(loaded);
    dispatch(loaded, { type: 'buyMediaDataset', datasetId: 'img_coconut' });
    expect(loaded.media!.owned).toContain('img_coconut');
    const cfg = mediaPresetConfig(loaded, 'image', 'cheap')!;
    expect(validateMediaRun(loaded, cfg)).toBeNull();
  });

  it('a half-filled media book from a save is repaired lazily', () => {
    const s = createInitialState(9, 'Half');
    (s as { media?: unknown }).media = { models: [], owned: ['img_faces'] };
    const ms = mediaOf(s);
    expect(ms.products).toEqual([]);
    expect(ms.run).toBeNull();
    for (let i = 0; i < 3; i++) tick(s);
  });
});
