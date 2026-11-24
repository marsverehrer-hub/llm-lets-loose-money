import type { Id, Modality, Vec } from '../types';

export interface DataKind { id: Id; name: string; blurb: string; A: Vec; q: number; unique: number; cost: number }
export interface SegmentDef {
  id: Id; modality: Modality; name: string; bench: string; blurb: string;
  w: Vec; size: number; pRef: number; load: number;
  priceSens: number; speedSens: number; trustSens: number; inertia: number;
  accounts: string[];
  /** Later benchmarks: when the best score here passes `at`, the next one replaces the current. */
  gens?: { name: string; w: Vec; at: number }[];
  unlockWeek?: number;
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
        accounts: ['Homework Inc', 'Grandma', 'Dating App', 'Meme Lords', 'Recipe Blog', 'Night Owls'], gens: [{ name: 'Companion Index', w: [0.25, 0.05, 0.5, 0.2], at: 72 }, { name: 'Feels-Like-Human Test', w: [0.35, 0.05, 0.45, 0.15], at: 88 }] },
      { id: 'lang.dev', modality: 'lang', name: 'Developers', bench: 'SWE-Bunch', blurb: 'Wants working code, fast.',
        w: [0.3, 0.6, 0, 0.1], size: 1500, pRef: 800, load: 2, priceSens: 1.5, speedSens: 1, trustSens: 0.3, inertia: 0.6,
        accounts: ['Cursory', 'Replicant', 'Tabnein', 'YAML Farm', 'Stack Underflow', 'Vibe Coders'], gens: [{ name: 'SWE-Bunch Verified', w: [0.35, 0.55, 0, 0.1], at: 72 }, { name: 'Ship-A-Feature', w: [0.45, 0.45, 0, 0.1], at: 88 }] },
      { id: 'lang.ent', modality: 'lang', name: 'Enterprise', bench: 'Compliance-QA', blurb: 'Wants nobody fired.',
        w: [0.3, 0.2, 0.2, 0.3], size: 800, pRef: 2500, load: 4, priceSens: 1, speedSens: 0.2, trustSens: 2.5, inertia: 0.85,
        accounts: ['Megabank', 'Consultancy LLP', 'InsureCo', 'Big Pharma', 'Gov Dept', 'Airline'], gens: [{ name: 'Compliance-QA Pro', w: [0.35, 0.2, 0.15, 0.3], at: 72 }, { name: 'Audit Gauntlet', w: [0.4, 0.2, 0.1, 0.3], at: 88 }] },
      { id: 'lang.frontier', modality: 'lang', name: 'Research & agents', bench: "Humanity's Penultimate Exam", blurb: 'Wants the smartest thing, at any price.',
        w: [0.6, 0.2, 0, 0.2], size: 200, pRef: 6000, load: 10, priceSens: 0.8, speedSens: 0, trustSens: 1, inertia: 0.7,
        accounts: ['Hedge Fund', 'Drug Discovery', 'Agent Startup', 'Math Olympiad', 'Think Tank', 'Chip Designer'], gens: [{ name: "Humanity's Last-Last Exam", w: [0.7, 0.15, 0, 0.15], at: 72 }, { name: 'Frontier Math Olympiad', w: [0.8, 0.1, 0, 0.1], at: 88 }] },
      { id: 'lang.agents', modality: 'lang', name: 'Agents', bench: 'Do-My-Job Bench', blurb: 'Wants a model that finishes the task without a babysitter.', unlockWeek: 192,
        w: [0.4, 0.35, 0, 0.25], size: 1200, pRef: 3000, load: 12, priceSens: 0.9, speedSens: 0.3, trustSens: 2, inertia: 0.6,
        accounts: ['Travel Agent Co', 'Inbox Zero', 'Tax Robot', 'Sales Desk', 'IT Helpdesk', 'Paralegal Inc'],
        gens: [{ name: 'Do-My-Job Bench Hard', w: [0.45, 0.35, 0, 0.2], at: 88 }] },
      { id: 'lang.science', modality: 'lang', name: 'AI scientists', bench: 'Novel Result Rate', blurb: 'Wants a model that discovers something nobody knew.', unlockWeek: 288,
        w: [0.7, 0.1, 0, 0.2], size: 300, pRef: 15000, load: 30, priceSens: 0.5, speedSens: 0, trustSens: 1.2, inertia: 0.7,
        accounts: ['Pharma R&D', 'Materials Lab', 'Fusion Startup', 'National Lab', 'Protein Folders', 'Climate Model Co'] },
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
        accounts: ['Profile Pics', 'Group Chat', 'Fan Artists', 'Wallpaper Guy', 'D&D Table', 'Aunt Carol'], gens: [{ name: 'Cat Fidelity Index 2', w: [0.35, 0.25, 0.1, 0.3], at: 70 }, { name: 'Meme Turing Test', w: [0.3, 0.35, 0.15, 0.2], at: 85 }] },
      { id: 'image.ads', modality: 'image', name: 'Advertisers', bench: 'BrandSafe-1K', blurb: 'Wants the logo spelled right.',
        w: [0.25, 0.3, 0.4, 0.05], size: 900, pRef: 1500, load: 3, priceSens: 1, speedSens: 0.4, trustSens: 2, inertia: 0.75,
        accounts: ['Soda Brand', 'Car Maker', 'Ad Agency', 'Fast Fashion', 'Telco', 'Burger Chain'], gens: [{ name: 'BrandSafe-10K', w: [0.2, 0.35, 0.4, 0.05], at: 70 }, { name: 'Legal Says Yes', w: [0.2, 0.4, 0.35, 0.05], at: 85 }] },
      { id: 'image.studio', modality: 'image', name: 'Studios', bench: 'Art Director Says No', blurb: 'Wants exactly what was asked for.',
        w: [0.3, 0.5, 0.05, 0.15], size: 500, pRef: 3000, load: 6, priceSens: 0.9, speedSens: 0.1, trustSens: 1, inertia: 0.7,
        accounts: ['Game Studio', 'Film VFX', 'Architects', 'Toy Company', 'Publisher', 'Animation House'], gens: [{ name: 'Art Director Says Maybe', w: [0.3, 0.55, 0.05, 0.1], at: 70 }, { name: 'Pixel-Perfect Brief', w: [0.25, 0.6, 0.1, 0.05], at: 85 }] },
      { id: 'image.stock', modality: 'image', name: 'Stock libraries', bench: 'Photo-or-Not', blurb: 'Wants photos nobody can sue over.',
        w: [0.7, 0.2, 0.05, 0.05], size: 700, pRef: 900, load: 2, priceSens: 1.4, speedSens: 0.6, trustSens: 1.5, inertia: 0.6,
        accounts: ['Shuttershock', 'Getty-ish', 'News Wire', 'Slide Decks', 'Textbooks', 'Real Estate'], gens: [{ name: 'Photo-or-Not 2', w: [0.65, 0.25, 0.05, 0.05], at: 70 }, { name: 'Forensic Lab Fooled', w: [0.7, 0.2, 0.05, 0.05], at: 85 }] },
    ],
  },
  video: {
    id: 'video', name: 'Video', noun: 'video model', unlockWeek: 96,
    axes: ['Realism', 'Motion', 'Prompt following', 'Clip length'],
    sizeTilt: [2.5, 1, -1, -2.5],
    data: [
      { id: 'footage', name: 'Stock footage', blurb: 'Slow pans over office handshakes.', A: [0.55, 0.25, 0.1, 0.1], q: 0.8, unique: 4e10, cost: 6e6 },
      { id: 'films', name: 'Films & TV', blurb: 'The studios have noticed.', A: [0.35, 0.2, 0.1, 0.35], q: 0.85, unique: 3e10, cost: 9e6 },
      { id: 'streams', name: 'Game streams', blurb: 'Ten thousand hours of someone saying "chat".', A: [0.05, 0.5, 0.1, 0.35], q: 0.55, unique: 3e11, cost: 4e6 },
      { id: 'howto', name: 'How-to videos', blurb: 'Narrated, captioned and oddly soothing.', A: [0.15, 0.15, 0.6, 0.1], q: 0.7, unique: 6e10, cost: 5e6 },
      { id: 'sims', name: 'Physics sims', blurb: 'Perfect liquids, no soul.', A: [0.2, 0.6, 0.15, 0.05], q: 0.65, unique: 8e10, cost: 4e6 },
    ],
    segments: [
      { id: 'video.consumer', modality: 'video', name: 'Short-video apps', bench: 'Scroll-Stopper Score', blurb: 'Wants six seconds nobody can look away from.',
        w: [0.2, 0.45, 0.2, 0.15], size: 2200, pRef: 500, load: 4, priceSens: 2, speedSens: 1, trustSens: 0.3, inertia: 0.45,
        accounts: ['TickTock', 'Reel Farm', 'Meme Studio', 'Fan Edits', 'Pet Channel', 'Prank Bros'], gens: [{ name: 'Watch-Time Index', w: [0.2, 0.4, 0.2, 0.2], at: 75 }] },
      { id: 'video.ads', modality: 'video', name: 'Ad studios', bench: 'BrandSafe Reel', blurb: 'Wants the product in frame and nobody with six fingers.',
        w: [0.35, 0.15, 0.45, 0.05], size: 800, pRef: 3000, load: 10, priceSens: 1, speedSens: 0.3, trustSens: 2, inertia: 0.75,
        accounts: ['Super Bowl Spot', 'Perfume House', 'Car Launch', 'Snack Brand', 'Bank Ad', 'Sneaker Drop'], gens: [{ name: 'BrandSafe Reel 2', w: [0.35, 0.15, 0.45, 0.05], at: 75 }] },
      { id: 'video.film', modality: 'video', name: 'Film & TV', bench: 'Uncanny Valley Depth', blurb: 'Wants two minutes that hold together.',
        w: [0.4, 0.15, 0.1, 0.35], size: 350, pRef: 9000, load: 30, priceSens: 0.7, speedSens: 0, trustSens: 1.2, inertia: 0.7,
        accounts: ['Streamer Originals', 'Indie Studio', 'Trailer House', 'Soap Opera', 'Documentary Unit', 'Anime Studio'], gens: [{ name: 'Feature-Length Test', w: [0.35, 0.15, 0.1, 0.4], at: 75 }] },
      { id: 'video.sim', modality: 'video', name: 'Robotics & sims', bench: 'Physics Sanity Check', blurb: 'Wants water that pours downwards.',
        w: [0.15, 0.6, 0.15, 0.1], size: 300, pRef: 6000, load: 20, priceSens: 0.8, speedSens: 0.4, trustSens: 0.8, inertia: 0.65,
        accounts: ['Robot Arm Co', 'Self-Driving Lab', 'Game Engine', 'Warehouse Bots', 'Drone Maker', 'Crash Tester'], gens: [{ name: 'Physics Sanity Check Hard', w: [0.1, 0.65, 0.15, 0.1], at: 75 }] },
    ],
  },
};

export const SEGMENTS: Record<Id, SegmentDef> = Object.fromEntries(
  Object.values(MODALITIES).flatMap((m) => m.segments.map((s) => [s.id, s])),
);
export const segmentsOf = (m: Modality): SegmentDef[] => MODALITIES[m].segments;
export const dataKind = (m: Modality, id: Id): DataKind => MODALITIES[m].data.find((d) => d.id === id)!;
