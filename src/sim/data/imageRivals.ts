// v16 (GAME_DESIGN §26.2): rival image and video lines. Parody names only. A line with `labId` belongs to that lab in
// competitors.ts and only ships while the lab is active; the rest are independent studios. Releases are scripted by
// fractional year so the media arena follows history; `overall` is the line's arena strength (0..100).
import type { Id, MediaCaps, MediaChannel, MediaKind } from '../types';

export interface MediaRelease {
  year: number;
  name: string;
  overall: number;
  /** Ticker line on release. */
  news?: string;
}

export interface MediaRivalDef {
  id: Id;
  name: string;
  /** Optional link to a lab in competitors.ts (by id). */
  labId?: Id;
  kind: MediaKind;
  /** Brand when not linked to a lab (linked lines use the lab's brand). */
  brand: number;
  /** Weights are public: feeds the "run it yourself" option and drags prices down. */
  open?: boolean;
  channels: MediaChannel[];
  /** Price relative to the market reference price. */
  priceMult: number;
  /** Cap profile offsets from the release's overall. */
  profile: Partial<MediaCaps>;
  releases: MediaRelease[];
}

export const MEDIA_RIVALS: MediaRivalDef[] = [
  {
    id: 'gan_lab',
    name: 'ThisFaceDoesNotExist',
    kind: 'image',
    brand: 10,
    channels: ['app'],
    priceMult: 0.5,
    profile: { realism: 10, adherence: -25, text: -30 },
    releases: [
      { year: 2018.9, name: 'StyleGANish', overall: 28, news: 'ThisFaceDoesNotExist goes viral. None of these people exist, and all of them look tired.' },
      { year: 2020.0, name: 'StyleGANish 2', overall: 33 },
    ],
  },
  {
    id: 'imagine_n',
    name: 'Imagine-n',
    labId: 'deepmined',
    kind: 'image',
    brand: 30,
    channels: ['api'],
    priceMult: 1.1,
    profile: { adherence: 4, text: 2 },
    releases: [
      { year: 2018.75, name: 'BigGANish', overall: 24 },
      { year: 2022.4, name: 'Imagine-n', overall: 58, news: 'DeepMined unveils Imagine-n in a paper. You may not use it. You may read about it.' },
      { year: 2023.9, name: 'Imagine-n 2', overall: 72 },
      { year: 2024.6, name: 'Imagine-n 3', overall: 80 },
      { year: 2025.4, name: 'Imagine-n 4', overall: 87 },
      { year: 2025.65, name: 'Nano Bananas', overall: 90, news: 'DeepMined ships Nano Bananas. Everyone edits their holiday photos into figurines.' },
      { year: 2027.2, name: 'Imagine-n 6', overall: 93 },
      { year: 2029.5, name: 'Imagine-n 8', overall: 96 },
    ],
  },
  {
    id: 'dall_eh',
    name: 'DALL-Eh',
    labId: 'openaye',
    kind: 'image',
    brand: 40,
    channels: ['app', 'api'],
    priceMult: 1.2,
    profile: { adherence: 5, aesthetics: -2 },
    releases: [
      { year: 2021.0, name: 'DALL-Eh', overall: 38, news: 'OpenAye shows DALL-Eh: an avocado armchair. The furniture industry is on notice.' },
      { year: 2022.3, name: 'DALL-Eh 2', overall: 61 },
      { year: 2023.75, name: 'DALL-Eh 3', overall: 75 },
      { year: 2025.25, name: 'GPTee Image', overall: 88, news: 'OpenAye launches GPTee Image. The servers melt under a billion cartoon selfies.' },
      { year: 2027.0, name: 'GPTee Image 2', overall: 92 },
      { year: 2029.0, name: 'GPTee Image 3', overall: 96 },
    ],
  },
  {
    id: 'midjourmey',
    name: 'Midjourmey',
    kind: 'image',
    brand: 35,
    channels: ['app'],
    priceMult: 1,
    profile: { aesthetics: 8, text: -8, adherence: -2 },
    releases: [
      { year: 2022.15, name: 'Midjourmey v1', overall: 45, news: 'Midjourmey opens a Discord. Ten people, then ten million.' },
      { year: 2022.6, name: 'Midjourmey v3', overall: 58 },
      { year: 2022.9, name: 'Midjourmey v4', overall: 66 },
      { year: 2023.2, name: 'Midjourmey v5', overall: 75, news: 'Midjourmey v5: hands now have five fingers. Mostly.' },
      { year: 2023.95, name: 'Midjourmey v6', overall: 81 },
      { year: 2025.3, name: 'Midjourmey v7', overall: 86 },
      { year: 2027.0, name: 'Midjourmey v8', overall: 90 },
      { year: 2029.0, name: 'Midjourmey v9', overall: 93 },
    ],
  },
  {
    id: 'instability',
    name: 'Instability AI',
    kind: 'image',
    brand: 25,
    open: true,
    channels: ['api'],
    priceMult: 0.5,
    profile: { aesthetics: -2 },
    releases: [
      { year: 2022.6, name: 'Stable-ish Diffusion 1.4', overall: 56, news: 'Instability AI releases Stable-ish Diffusion with open weights. Every laptop is now an art studio.' },
      { year: 2022.9, name: 'Stable-ish Diffusion 2.0', overall: 55, news: 'Stable-ish Diffusion 2.0 is somehow worse. The forums take it personally.' },
      { year: 2023.55, name: 'Stable-ish XL', overall: 67 },
      { year: 2024.45, name: 'Stable-ish 3 Medium', overall: 66 },
      { year: 2024.8, name: 'Stable-ish 3.5', overall: 72, news: 'Instability AI ships 3.5 and a new CEO. Both are fine.' },
    ],
  },
  {
    id: 'black_forest',
    name: 'Black Forest Gateau',
    kind: 'image',
    brand: 20,
    open: true,
    channels: ['api'],
    priceMult: 0.8,
    profile: { text: 6, realism: 3 },
    releases: [
      { year: 2024.6, name: 'Flux Capacitor 1', overall: 80, news: 'Black Forest Gateau drops Flux Capacitor with open weights. The open models are now the good ones.' },
      { year: 2024.85, name: 'Flux Capacitor 1.1 Pro', overall: 83 },
      { year: 2025.4, name: 'Flux Kontextual', overall: 86 },
      { year: 2026.0, name: 'Flux Capacitor 2', overall: 89 },
      { year: 2028.0, name: 'Flux Capacitor 3', overall: 93 },
    ],
  },
  {
    id: 'ideogramme',
    name: 'Ideogramme',
    kind: 'image',
    brand: 12,
    channels: ['app', 'api'],
    priceMult: 0.9,
    profile: { text: 15, aesthetics: -2 },
    releases: [
      { year: 2023.6, name: 'Ideogramme 0.1', overall: 64, news: 'Ideogramme can spell. The design world gasps, then checks the kerning.' },
      { year: 2024.2, name: 'Ideogramme 1.0', overall: 74 },
      { year: 2025.2, name: 'Ideogramme 3.0', overall: 83 },
    ],
  },
  {
    id: 'sorta',
    name: 'Sorta',
    labId: 'openaye',
    kind: 'video',
    brand: 40,
    channels: ['app', 'api'],
    priceMult: 1.2,
    profile: { realism: 4 },
    releases: [
      { year: 2024.95, name: 'Sorta', overall: 72, news: 'OpenAye ships Sorta. A woman walks through Tokyo; her legs swap sides twice.' },
      { year: 2025.75, name: 'Sorta 2', overall: 84, news: 'Sorta 2 adds sound and a social feed. Everyone is a cameo now.' },
      { year: 2027.3, name: 'Sorta 3', overall: 90 },
      { year: 2029.5, name: 'Sorta 4', overall: 95 },
    ],
  },
  {
    id: 'vee_oh',
    name: 'Vee-Oh',
    labId: 'deepmined',
    kind: 'video',
    brand: 30,
    channels: ['api'],
    priceMult: 1.1,
    profile: { motion: 4, adherence: 2 },
    releases: [
      { year: 2024.4, name: 'Vee-Oh', overall: 66 },
      { year: 2024.95, name: 'Vee-Oh 2', overall: 78 },
      { year: 2025.4, name: 'Vee-Oh 3', overall: 86, news: 'Vee-Oh 3 generates sound. The ASMR channels are worried.' },
      { year: 2027.0, name: 'Vee-Oh 4', overall: 91 },
      { year: 2029.0, name: 'Vee-Oh 5', overall: 95 },
    ],
  },
  {
    id: 'runaway',
    name: 'Runaway',
    kind: 'video',
    brand: 18,
    channels: ['app'],
    priceMult: 1,
    profile: { aesthetics: 4, adherence: -2 },
    releases: [
      { year: 2023.1, name: 'Gen-1ish', overall: 35, news: 'Runaway turns your video into a slightly different video. Hollywood takes notes.' },
      { year: 2023.5, name: 'Gen-2ish', overall: 46 },
      { year: 2024.5, name: 'Gen-3ish Alpha', overall: 65 },
      { year: 2025.25, name: 'Gen-4ish', overall: 78 },
      { year: 2027.0, name: 'Gen-5ish', overall: 86 },
    ],
  },
  {
    id: 'kling_kong',
    name: 'Kling Kong',
    kind: 'video',
    brand: 15,
    channels: ['app', 'api'],
    priceMult: 0.6,
    profile: { motion: 5, text: -4 },
    releases: [
      { year: 2024.45, name: 'Kling Kong 1', overall: 68, news: 'Kling Kong ships a video model that eats noodles properly. Western labs are embarrassed.' },
      { year: 2025.5, name: 'Kling Kong 2', overall: 82 },
      { year: 2027.5, name: 'Kling Kong 3', overall: 89 },
    ],
  },
];
