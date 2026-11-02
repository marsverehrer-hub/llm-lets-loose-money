// v16 (GAME_DESIGN §28.2): image and video generation models. Architectures, datasets, styles, quirks, benchmarks,
// market curves and tunables. Pure data; the rules live in systems/imageGen.ts.
import type { Id, MediaCapId, MediaCaps, MediaChannel, MediaKind } from '../types';

export const MEDIA_CAP_IDS: MediaCapId[] = ['adherence', 'aesthetics', 'realism', 'text', 'speed', 'motion'];

export const MEDIA_TUNING = {
  /** Share of the training compute a media run takes while a language-model run is also training. */
  SHARED_COMPUTE_SHARE: 0.4,
  /** FLOPs per sample = 6 x params x SAMPLE_TOKENS x resolution factor x arch factor. Video clips cost VIDEO_SAMPLE_MULT more. */
  SAMPLE_TOKENS: 1024,
  VIDEO_SAMPLE_MULT: 12,
  /** Quality = 100 x (1 - exp(-(log10(effective compute) - Q_C0) / Q_K)), then the arch ceiling. */
  Q_C0: 18,
  Q_K: 4.2,
  /** Undertraining: below one sample per parameter, lose UNDER_K points per halving (max UNDER_MAX). */
  UNDER_K: 5,
  UNDER_MAX: 20,
  MIN_PARAMS_B: 0.01,
  MAX_PARAMS_B: 200,
  /** Seed luck (overall points): N(0, LUCK_SD); golden and cursed runs in the tails. */
  LUCK_SD: 3.5,
  GOLDEN_CHANCE: 0.05,
  GOLDEN_MEAN: 7,
  CURSED_CHANCE: 0.05,
  CURSED_MEAN: -8,
  QUIRK_CHANCE: 0.45,
  VIBES_SD: 35,
  /** Forecast band SD (overall points); x FIRST_ARCH_FACTOR for an architecture the lab never trained. */
  BAND_SD: 4,
  FIRST_ARCH_FACTOR: 1.4,
  Z80: 1.28,
  ELO_BASE: 1000,
  ELO_PER_POINT: 8,
  /** Market: logit temperature in overall points, price elasticities, how fast users move each day. */
  MARKET_T: 6,
  PRICE_ELASTICITY: { app: 1.4, api: 2.2 } as Record<MediaChannel, number>,
  USER_DRIFT: { app: 0.04, api: 0.08 } as Record<MediaChannel, number>,
  /** Open weights: the player's own product keeps this share of its appeal (anyone can host the model). */
  OPEN_OWN_APPEAL: 0.6,
  /** Weight of the "run it yourself" option per point the best open model is within the leader. */
  DIY_WEIGHT: 0.35,
  /** App users generate this many images (or clips) a day. */
  APP_GENERATIONS_PER_USER: 6,
  /** Serving: $ per image for a 2B model in 2022, falling DECLINE per year; video x VIDEO_COST_MULT. */
  COST_PER_IMAGE_2022: 0.004,
  COST_DECLINE: 0.8,
  VIDEO_COST_MULT: 25,
  /** Launch fees (2022 dollars, x 1.15 per year after). */
  LAUNCH_FEE: { app: 250_000, api: 100_000 } as Record<MediaChannel, number>,
  /** Release rewards. */
  RELEASE_TOP: { brand: 2, hype: 6 },
  RELEASE_OTHER: { brand: 0.5, hype: 2 },
  OPEN_RELEASE: { brand: 1, reputation: 1 },
  /** Lawsuits: daily chance per risky set behind a released model = legal risk x LAWSUIT_RATE, cooldown per set. */
  LAWSUIT_RATE: 0.0015,
  LAWSUIT_COOLDOWN: 240,
  LAWSUIT_BASE: 400_000,
  LAWSUIT_REP: 4,
  OPT_OUT_RISK: 0.25,
  OPT_OUT_AESTHETICS: -3,
  DISTILL_SPEED: 25,
  DISTILL_COST: { aesthetics: -3, adherence: -3 } as Partial<MediaCaps>,
};

export interface MediaArchDef {
  id: Id;
  kind: MediaKind;
  name: string;
  description: string;
  minYear: number;
  requiresResearch?: Id;
  /** Multiplies effective compute (how much quality each FLOP buys). */
  eff: number;
  /** Most quality points this architecture can reach. */
  ceiling: number;
  /** Cap profile multipliers on base quality. */
  adherence: number;
  text: number;
  /** Base serving speed score (before size and distillation). */
  speed: number;
}

export const MEDIA_ARCHS: MediaArchDef[] = [
  { id: 'gan', kind: 'image', name: 'GAN', description: 'Two networks arguing until one of them draws a face. Beautiful faces, zero idea what you asked for.', minYear: 2017, eff: 2, ceiling: 42, adherence: 0.35, text: 0, speed: 95 },
  { id: 'ar_tokens', kind: 'image', name: 'Autoregressive tokens', description: 'Turns the picture into tokens and writes it left to right. Follows the prompt, slowly.', minYear: 2020, requiresResearch: 'transformers', eff: 0.6, ceiling: 74, adherence: 1.05, text: 0.5, speed: 30 },
  { id: 'diffusion_unet', kind: 'image', name: 'Latent diffusion (UNet)', description: 'Start with noise, remove it fifty times. The workhorse that launched a thousand Discord servers.', minYear: 2021, requiresResearch: 'clip_contrastive', eff: 1, ceiling: 84, adherence: 0.9, text: 0.3, speed: 60 },
  { id: 'dit', kind: 'image', name: 'Diffusion transformer', description: 'Diffusion, but the denoiser is a transformer. Scales like one too.', minYear: 2023, requiresResearch: 'image_generation', eff: 1.6, ceiling: 93, adherence: 0.95, text: 0.7, speed: 60 },
  { id: 'flow', kind: 'image', name: 'Flow matching', description: 'Learns straight paths from noise to picture. Fewer steps, better text, smug researchers.', minYear: 2024, requiresResearch: 'image_generation', eff: 2.4, ceiling: 97, adherence: 1, text: 0.85, speed: 72 },
  { id: 'video_unet', kind: 'video', name: 'Video diffusion (UNet)', description: 'An image model taught to flip pages. People melt between frames.', minYear: 2023, requiresResearch: 'video_understanding', eff: 0.8, ceiling: 72, adherence: 0.85, text: 0.2, speed: 40 },
  { id: 'video_dit', kind: 'video', name: 'Spacetime transformer', description: 'Patches of space and time. The cat stays a cat for almost the whole clip.', minYear: 2024, requiresResearch: 'video_understanding', eff: 1.5, ceiling: 92, adherence: 0.95, text: 0.5, speed: 45 },
  { id: 'world_sim', kind: 'video', name: 'World simulator', description: 'Learns physics from watching everything. Mostly right about gravity.', minYear: 2026, requiresResearch: 'world_models', eff: 2.3, ceiling: 98, adherence: 1, text: 0.7, speed: 50 },
];

export interface MediaDatasetDef {
  id: Id;
  kind: MediaKind;
  name: string;
  description: string;
  year: number;
  /** Millions of image-text pairs (or clips). */
  samplesM: number;
  quality: number;
  price: number;
  /** 0..1: how likely it is to end in court once a model trained on it is public. */
  legalRisk: number;
  capAdd?: Partial<MediaCaps>;
}

export const MEDIA_DATASETS: MediaDatasetDef[] = [
  { id: 'img_faces', kind: 'image', name: 'CelebFaces-ish', description: 'Two hundred thousand famous faces, cropped. Great for faces, useless for anything else.', year: 2017, samplesM: 0.2, quality: 0.55, price: 15_000, legalRisk: 0.05, capAdd: { realism: 4, adherence: -6 } },
  { id: 'img_imagenot', kind: 'image', name: 'ImageNot', description: 'Fourteen million labelled photos, ninety of them of the same dog breed.', year: 2017, samplesM: 14, quality: 0.5, price: 40_000, legalRisk: 0.05 },
  { id: 'img_coconut', kind: 'image', name: 'COCOnut Captions', description: 'Pictures with five careful human captions each. Small, clean, beloved.', year: 2017, samplesM: 0.6, quality: 0.72, price: 25_000, legalRisk: 0, capAdd: { adherence: 4 } },
  { id: 'img_stock', kind: 'image', name: 'Shutterstuck licensed library', description: 'Three hundred million stock photos, fully licensed. Everyone is smiling at a salad.', year: 2019, samplesM: 300, quality: 0.78, price: 12_000_000, legalRisk: 0, capAdd: { realism: 6 } },
  { id: 'img_laion_400m', kind: 'image', name: 'LAION-ish 400M', description: 'Four hundred million alt-text pairs off the open web. Free, enormous, and a bit of a crime scene.', year: 2021, samplesM: 400, quality: 0.38, price: 0, legalRisk: 0.3 },
  { id: 'img_art_scrape', kind: 'image', name: 'ArtStation-ish scrape (allegedly)', description: 'Every portfolio on the site, signatures included. The aesthetics are incredible. So are the lawyers.', year: 2021, samplesM: 120, quality: 0.72, price: 150_000, legalRisk: 0.9, capAdd: { aesthetics: 8 } },
  { id: 'img_laion_5b', kind: 'image', name: 'LAION-ish 5B', description: 'Five billion pairs. Somewhere in here is every meme ever made.', year: 2022, samplesM: 5000, quality: 0.33, price: 0, legalRisk: 0.4 },
  { id: 'img_recaption', kind: 'image', name: 'Synthetic recaptions', description: 'Your old pictures, recaptioned by a language model in loving detail. Prompt adherence goes way up.', year: 2023, samplesM: 800, quality: 0.7, price: 2_500_000, legalRisk: 0.1, capAdd: { adherence: 8 } },
  { id: 'img_typography', kind: 'image', name: 'Typography synth', description: 'Sixty million renders of words on signs, mugs and cakes. Teaches spelling, eventually.', year: 2024, samplesM: 60, quality: 0.65, price: 800_000, legalRisk: 0, capAdd: { text: 14 } },
  { id: 'vid_scrape', kind: 'video', name: 'TubeTube scrape', description: 'Nine hundred million clips, mostly unboxings. Terms of service were skimmed.', year: 2023, samplesM: 900, quality: 0.45, price: 300_000, legalRisk: 0.8, capAdd: { motion: 4 } },
  { id: 'vid_stock', kind: 'video', name: 'Stock footage licence', description: 'Forty million licensed clips of drones over coastlines and people laughing at laptops.', year: 2023, samplesM: 40, quality: 0.76, price: 20_000_000, legalRisk: 0, capAdd: { realism: 5 } },
  { id: 'vid_engine', kind: 'video', name: 'Game-engine renders', description: 'Thirty million synthetic clips with perfect physics and suspiciously clean floors.', year: 2025, samplesM: 30, quality: 0.7, price: 4_000_000, legalRisk: 0, capAdd: { motion: 8, realism: -3 } },
];

export interface MediaStyleDef {
  id: Id;
  name: string;
  description: string;
  minYear?: number;
  capAdd: Partial<MediaCaps>;
}

/** The training "recipe" of a media run: what the captions and the final fine-tune optimise for. */
export const MEDIA_STYLES: MediaStyleDef[] = [
  { id: 'balanced', name: 'Balanced', description: 'A bit of everything. The safe first run.', capAdd: {} },
  { id: 'aesthetic', name: 'Artsy', description: 'Tuned on the prettiest tenth. Gorgeous, sometimes ignores the prompt.', capAdd: { aesthetics: 7, adherence: -3, realism: -2 } },
  { id: 'photoreal', name: 'Photoreal', description: 'Tuned on photographs. Looks real, looks a little like stock.', capAdd: { realism: 7, aesthetics: -3 } },
  { id: 'typography', name: 'Typography', description: 'Tuned on signs and posters. Spells the word, mostly.', minYear: 2023, capAdd: { text: 10, aesthetics: -3, realism: -1 } },
];

export interface MediaQuirkDef {
  id: Id;
  name: string;
  capAdd: Partial<MediaCaps>;
  /** Positive: the internet loves it (hype on release). Negative: it costs reputation. */
  virality: number;
  kind?: MediaKind;
}

export const MEDIA_QUIRKS: MediaQuirkDef[] = [
  { id: 'six_fingers', name: 'Draws six fingers', capAdd: { realism: -4 }, virality: -1 },
  { id: 'orange_teal', name: 'Everything is orange and teal', capAdd: { aesthetics: -2, realism: -1 }, virality: 0 },
  { id: 'same_face', name: 'Every face is the same person', capAdd: { realism: -3 }, virality: -1 },
  { id: 'elvish_text', name: 'Writes text in what looks like Elvish', capAdd: { text: -6 }, virality: 1 },
  { id: 'wine_glass', name: 'Cannot draw a full wine glass', capAdd: { adherence: -2 }, virality: 1 },
  { id: 'lens_flare', name: 'Adds lens flare to everything', capAdd: { aesthetics: 2, realism: -2 }, virality: 1 },
  { id: 'cat_everywhere', name: 'A cat appears in the background', capAdd: { adherence: -1, aesthetics: 1 }, virality: 3 },
  { id: 'perfect_hands', name: 'Unusually good at hands', capAdd: { realism: 5 }, virality: 3 },
  { id: 'moonwalk', name: 'People walk backwards', capAdd: { motion: -5 }, virality: 2, kind: 'video' },
  { id: 'spaghetti', name: 'Eats spaghetti convincingly', capAdd: { motion: 4, realism: 2 }, virality: 4, kind: 'video' },
];

export interface MediaBenchmarkDef {
  id: Id;
  kind: MediaKind;
  name: string;
  year: number;
  weights: Partial<MediaCaps>;
  difficulty: number;
}

/** Score = 100 x sigmoid((sum of weight x cap - difficulty) / 8). */
export const MEDIA_BENCHMARKS: MediaBenchmarkDef[] = [
  { id: 'drawbench', kind: 'image', name: 'DrawBench', year: 2022, weights: { adherence: 0.6, aesthetics: 0.4 }, difficulty: 55 },
  { id: 'geneval', kind: 'image', name: 'GenEval', year: 2023, weights: { adherence: 1 }, difficulty: 66 },
  { id: 'handcount', kind: 'image', name: 'HandCount-5', year: 2023, weights: { realism: 1 }, difficulty: 70 },
  { id: 'can_it_spell', kind: 'image', name: 'Can-It-Spell', year: 2024, weights: { text: 1 }, difficulty: 62 },
  { id: 'vbench', kind: 'video', name: 'VBench', year: 2024, weights: { motion: 0.6, realism: 0.4 }, difficulty: 62 },
  { id: 'physics_iq', kind: 'video', name: 'Does-It-Fall-Down', year: 2025, weights: { motion: 1 }, difficulty: 74 },
];

/** Overall score weights per kind. */
export const MEDIA_OVERALL: Record<MediaKind, Partial<MediaCaps>> = {
  image: { adherence: 0.3, aesthetics: 0.3, realism: 0.2, text: 0.1, speed: 0.1 },
  video: { adherence: 0.25, aesthetics: 0.2, realism: 0.15, motion: 0.3, speed: 0.1 },
};

/** [fractional year, value] points, linear in between, flat outside. */
export type Curve = [number, number][];

/**
 * Market size per kind and channel. app: paying subscribers. api: generations per day. The image market opens early
 * and small; video arrives in 2023. Reference prices fall every year (commoditisation).
 */
export const MEDIA_DEMAND: Record<MediaKind, Record<MediaChannel, Curve>> = {
  image: {
    app: [[2017, 1_000], [2019, 20_000], [2020, 60_000], [2021, 250_000], [2022, 1_500_000], [2023, 5_000_000], [2025, 12_000_000], [2030, 25_000_000]],
    api: [[2017, 3_000], [2019, 40_000], [2020, 150_000], [2021, 800_000], [2022, 4_000_000], [2023, 15_000_000], [2025, 60_000_000], [2030, 200_000_000]],
  },
  video: {
    app: [[2022.5, 0], [2023, 50_000], [2024, 1_000_000], [2025, 6_000_000], [2027, 15_000_000], [2030, 30_000_000]],
    api: [[2022.5, 0], [2023, 5_000], [2024, 200_000], [2025, 2_000_000], [2027, 8_000_000], [2030, 25_000_000]],
  },
};

export const MEDIA_REF_PRICE: Record<MediaKind, Record<MediaChannel, Curve>> = {
  image: {
    app: [[2017, 15], [2022, 10], [2025, 8], [2030, 5]],
    api: [[2017, 0.12], [2021, 0.06], [2023, 0.03], [2025, 0.02], [2030, 0.004]],
  },
  video: {
    app: [[2023, 30], [2025, 25], [2030, 12]],
    api: [[2023, 2], [2025, 0.5], [2030, 0.1]],
  },
};

export function curveAt(c: Curve, x: number): number {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = c[i];
    const [x0, y0] = c[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return c[c.length - 1][1];
}

export const mediaArchById = (id: Id) => MEDIA_ARCHS.find((a) => a.id === id);
export const mediaDatasetById = (id: Id) => MEDIA_DATASETS.find((d) => d.id === id);
export const mediaStyleById = (id: Id) => MEDIA_STYLES.find((x) => x.id === id);
export const mediaQuirkById = (id: Id) => MEDIA_QUIRKS.find((q) => q.id === id);

/** Media run presets for the quick start: one click picks style, resolution, distillation and a time budget. */
export interface MediaPresetDef {
  id: Id;
  name: string;
  blurb: string;
  style: Id;
  resolution: 256 | 512 | 1024;
  distill: boolean;
  days: number;
}

export const MEDIA_PRESETS: MediaPresetDef[] = [
  { id: 'balanced', name: 'Balanced', blurb: 'Good at most prompts. The default.', style: 'balanced', resolution: 512, distill: false, days: 14 },
  { id: 'artsy', name: 'Artsy', blurb: 'The pretty one. Wins arena votes, ignores some prompts.', style: 'aesthetic', resolution: 1024, distill: false, days: 21 },
  { id: 'photoreal', name: 'Photoreal', blurb: 'Product shots and fake holiday photos.', style: 'photoreal', resolution: 1024, distill: false, days: 21 },
  { id: 'turbo', name: 'Turbo', blurb: 'Distilled to a few steps. Cheap to serve, good for the API.', style: 'balanced', resolution: 512, distill: true, days: 10 },
  { id: 'cheap', name: 'Cheap and fast', blurb: 'Small, low-res and quick. A first product for a small lab.', style: 'balanced', resolution: 256, distill: false, days: 5 },
];
