import type { Id, Modality, Vec } from '../types';

export interface DataKind { id: Id; name: string; blurb: string; A: Vec; q: number; unique: number; cost: number }
export interface SegmentDef {
  id: Id; modality: Modality; name: string; bench: string; blurb: string;
  w: Vec; size: number; pRef: number; load: number;
  priceSens: number; speedSens: number; trustSens: number; inertia: number;
  accounts: string[];
}
export interface ModalityDef {
  id: Modality; name: string; noun: string; axes: string[];
  /** Capability shift per unit of size bias: big models reason, token-heavy models know. */
  sizeTilt: Vec;
  data: DataKind[]; segments: SegmentDef[]; unlockWeek: number;
}

// A rows sum to 1: where a token of this data kind goes. `unique` is tokens available at week 0.
export const MODALITIES: Record<string, ModalityDef> = {
  lang: {
    id: 'lang', name: 'Language', noun: 'chatbot', unlockWeek: 0,
    axes: ['Reasoning', 'Coding', 'Chat', 'Knowledge'],
    sizeTilt: [2.5, 1, -1, -2.5],
    data: [
      { id: 'web', name: 'The open web', blurb: 'Everything, including the comments.', A: [0.15, 0.05, 0.35, 0.45], q: 0.55, unique: 2e11, cost: 2e6 },
      { id: 'code', name: 'Code repos', blurb: 'Ten million TODOs.', A: [0.3, 0.6, 0.05, 0.05], q: 0.7, unique: 3e10, cost: 3e6 },
      { id: 'books', name: 'Books', blurb: 'Lawyers sold separately.', A: [0.25, 0, 0.25, 0.5], q: 0.8, unique: 2e10, cost: 4e6 },
      { id: 'dialogue', name: 'Chat logs', blurb: 'People being people.', A: [0.1, 0.05, 0.75, 0.1], q: 0.6, unique: 2e10, cost: 2.5e6 },
      { id: 'science', name: 'Papers', blurb: 'Peer reviewed, mostly.', A: [0.55, 0.1, 0, 0.35], q: 0.85, unique: 1e10, cost: 3.5e6 },
    ],
    segments: [
      { id: 'lang.consumer', modality: 'lang', name: 'Consumers', bench: 'VibeCheck Arena', blurb: 'Wants a friend that is cheap and quick.',
        w: [0.2, 0, 0.6, 0.2], size: 3000, pRef: 400, load: 1, priceSens: 2, speedSens: 0.5, trustSens: 0.5, inertia: 0.5,
        accounts: ['Homework Inc', 'Grandma', 'Dating App', 'Meme Lords', 'Recipe Blog', 'Night Owls'] },
      { id: 'lang.dev', modality: 'lang', name: 'Developers', bench: 'SWE-Bunch', blurb: 'Wants working code, fast.',
        w: [0.3, 0.6, 0, 0.1], size: 1500, pRef: 800, load: 2, priceSens: 1.5, speedSens: 1, trustSens: 0.3, inertia: 0.6,
        accounts: ['Cursory', 'Replicant', 'Tabnein', 'YAML Farm', 'Stack Underflow', 'Vibe Coders'] },
      { id: 'lang.ent', modality: 'lang', name: 'Enterprise', bench: 'Compliance-QA', blurb: 'Wants nobody fired.',
        w: [0.3, 0.2, 0.2, 0.3], size: 800, pRef: 2500, load: 4, priceSens: 1, speedSens: 0.2, trustSens: 2.5, inertia: 0.85,
        accounts: ['Megabank', 'Consultancy LLP', 'InsureCo', 'Big Pharma', 'Gov Dept', 'Airline'] },
      { id: 'lang.frontier', modality: 'lang', name: 'Research & agents', bench: "Humanity's Penultimate Exam", blurb: 'Wants the smartest thing, at any price.',
        w: [0.6, 0.2, 0, 0.2], size: 200, pRef: 6000, load: 10, priceSens: 0.8, speedSens: 0, trustSens: 1, inertia: 0.7,
        accounts: ['Hedge Fund', 'Drug Discovery', 'Agent Startup', 'Math Olympiad', 'Think Tank', 'Chip Designer'] },
    ],
  },
  image: {
    id: 'image', name: 'Image', noun: 'image model', unlockWeek: 0,
    axes: ['Fidelity', 'Prompt following', 'Text in image', 'Style range'],
    sizeTilt: [2.5, 1, -1, -2.5],
    data: [
      { id: 'photos', name: 'Stock photos', blurb: 'Watermarks included.', A: [0.6, 0.2, 0.05, 0.15], q: 0.8, unique: 3e10, cost: 3e6 },
      { id: 'art', name: 'Art sites', blurb: 'The artists have opinions.', A: [0.2, 0.05, 0, 0.75], q: 0.7, unique: 2e10, cost: 3e6 },
      { id: 'captions', name: 'Web captions', blurb: 'Alt text, when anyone bothered.', A: [0.2, 0.55, 0.15, 0.1], q: 0.5, unique: 2e11, cost: 2e6 },
      { id: 'design', name: 'Posters & UI', blurb: 'Kerning as far as the eye can see.', A: [0.1, 0.25, 0.55, 0.1], q: 0.75, unique: 1e10, cost: 3.5e6 },
      { id: 'renders', name: 'Synthetic renders', blurb: 'Perfect, and slightly dead inside.', A: [0.4, 0.45, 0.1, 0.05], q: 0.65, unique: 5e10, cost: 2e6 },
    ],
    segments: [
      { id: 'image.consumer', modality: 'image', name: 'Meme makers', bench: 'Cat Fidelity Index', blurb: 'Wants it funny, free and now.',
        w: [0.3, 0.2, 0.1, 0.4], size: 2500, pRef: 250, load: 1, priceSens: 2.2, speedSens: 1, trustSens: 0.2, inertia: 0.45,
        accounts: ['Profile Pics', 'Group Chat', 'Fan Artists', 'Wallpaper Guy', 'D&D Table', 'Aunt Carol'] },
      { id: 'image.ads', modality: 'image', name: 'Advertisers', bench: 'BrandSafe-1K', blurb: 'Wants the logo spelled right.',
        w: [0.25, 0.3, 0.4, 0.05], size: 900, pRef: 1500, load: 3, priceSens: 1, speedSens: 0.4, trustSens: 2, inertia: 0.75,
        accounts: ['Soda Brand', 'Car Maker', 'Ad Agency', 'Fast Fashion', 'Telco', 'Burger Chain'] },
      { id: 'image.studio', modality: 'image', name: 'Studios', bench: 'Art Director Says No', blurb: 'Wants exactly what was asked for.',
        w: [0.3, 0.5, 0.05, 0.15], size: 500, pRef: 3000, load: 6, priceSens: 0.9, speedSens: 0.1, trustSens: 1, inertia: 0.7,
        accounts: ['Game Studio', 'Film VFX', 'Architects', 'Toy Company', 'Publisher', 'Animation House'] },
      { id: 'image.stock', modality: 'image', name: 'Stock libraries', bench: 'Photo-or-Not', blurb: 'Wants photos nobody can sue over.',
        w: [0.7, 0.2, 0.05, 0.05], size: 700, pRef: 900, load: 2, priceSens: 1.4, speedSens: 0.6, trustSens: 1.5, inertia: 0.6,
        accounts: ['Shuttershock', 'Getty-ish', 'News Wire', 'Slide Decks', 'Textbooks', 'Real Estate'] },
    ],
  },
};

export const SEGMENTS: Record<Id, SegmentDef> = Object.fromEntries(
  Object.values(MODALITIES).flatMap((m) => m.segments.map((s) => [s.id, s])),
);
export const segmentsOf = (m: Modality): SegmentDef[] => MODALITIES[m].segments;
export const dataKind = (m: Modality, id: Id): DataKind => MODALITIES[m].data.find((d) => d.id === id)!;
