import type { Id, Modality, Style, Verdict } from '../types';

export interface LabDef {
  id: Id; name: string; tagline: string; color: string; series: string; modality: Modality; also?: Modality;
  ceo: { name: string; style: Style; skill: number; ego: number };
  cash: number; start: number; // start = compute of the model they open the game with
}

export const RIVAL_LABS: LabDef[] = [
  { id: 'openaye', name: 'OpenAye', tagline: 'Open in name. Very open to investment.', color: '#19a974', series: 'GPTea', modality: 'lang', also: 'video',
    ceo: { name: 'Chet Vantage', style: 'hype', skill: 0.6, ego: 0.9 }, cash: 40e6, start: 450 },
  { id: 'anthro', name: 'Anthropomorphic', tagline: 'Very worried about you, and about margins.', color: '#d97757', series: 'Clod', modality: 'lang',
    ceo: { name: 'Prudence Lindqvist', style: 'safety', skill: 0.7, ego: 0.4 }, cash: 30e6, start: 380 },
  { id: 'deepmined', name: 'DeepMined', tagline: 'Published 400 papers about the thing you use.', color: '#4a6cf7', series: 'Geminy', modality: 'lang',
    ceo: { name: 'Dr. Ada Brackett', style: 'research', skill: 0.8, ego: 0.6 }, cash: 35e6, start: 420 },
  { id: 'mistrial', name: 'Mistrial', tagline: 'Cheap, fast, and only slightly on fire.', color: '#f5a524', series: 'Le Model', modality: 'lang',
    ceo: { name: 'Remy Lacroute', style: 'pricewar', skill: 0.55, ego: 0.5 }, cash: 18e6, start: 260 },
  { id: 'llama', name: 'Metaverse Llama', tagline: 'Free API. Terms of service not included.', color: '#a855f7', series: 'Alpaca', modality: 'lang',
    ceo: { name: 'Zack Meadows', style: 'follower', skill: 0.5, ego: 0.8 }, cash: 45e6, start: 340 },
  { id: 'stability', name: 'Stability Pool', tagline: 'The license is a picture of a license.', color: '#ec4899', series: 'Unstable', modality: 'image',
    ceo: { name: 'Imogen Blur', style: 'pricewar', skill: 0.5, ego: 0.7 }, cash: 15e6, start: 240 },
  { id: 'midjourn', name: 'Midjourneyman', tagline: 'Every picture looks expensive.', color: '#06b6d4', series: 'Opus Minor', modality: 'image', also: 'video',
    ceo: { name: 'Lucian Fresco', style: 'hype', skill: 0.7, ego: 0.6 }, cash: 22e6, start: 320 },
];

export interface SupplierDef { id: Id; name: string; tagline: string; color: string; layer: 'cloud' | 'chips' | 'fab' | 'power'; capacity: number; cash: number; ceo: { name: string; style: Style; skill: number; ego: number } }
/** The supply chain under every model: power feeds fabs, fabs make chips, chips fill clouds, clouds rent to labs. */
export const SUPPLIERS: SupplierDef[] = [
  { id: 'shelves', name: 'Amazin Web Shelves', tagline: 'Also rents the warehouse to your competitors.', color: '#f97316', layer: 'cloud', capacity: 190, cash: 400e6, ceo: { name: 'Doug Parcel', style: 'pricewar', skill: 0.6, ego: 0.5 } },
  { id: 'azul', name: 'Microhard Azul', tagline: 'Your compute, bundled with a spreadsheet.', color: '#0ea5e9', layer: 'cloud', capacity: 150, cash: 500e6, ceo: { name: 'Satya Bundle', style: 'follower', skill: 0.7, ego: 0.4 } },
  { id: 'weavr', name: 'CoreWeavr', tagline: 'Was a crypto mine. Is a cloud. Same racks.', color: '#6366f1', layer: 'cloud', capacity: 100, cash: 60e6, ceo: { name: 'Brannigan Lease', style: 'hype', skill: 0.5, ego: 0.8 } },
  { id: 'nvidium', name: 'Nvidium', tagline: 'Sells shovels. Owns the shovel factory waiting list.', color: '#84cc16', layer: 'chips', capacity: 380, cash: 600e6, ceo: { name: 'Jensen Leatherby', style: 'hype', skill: 0.9, ego: 0.9 } },
  { id: 'excuses', name: 'Advanced Micro Excuses', tagline: 'Nearly as fast, for people who read the benchmarks.', color: '#ef4444', layer: 'chips', capacity: 130, cash: 150e6, ceo: { name: 'Lisa Sue-Yu', style: 'research', skill: 0.8, ego: 0.5 } },
  { id: 'semi', name: 'Taiwan Semi-Conscious', tagline: 'Everything is made here. Everything.', color: '#14b8a6', layer: 'fab', capacity: 560, cash: 900e6, ceo: { name: 'C. C. Wafer', style: 'safety', skill: 0.9, ego: 0.3 } },
  { id: 'grid', name: "Consolidated Edison't", tagline: 'Keeping the lights on, mostly.', color: '#eab308', layer: 'power', capacity: 420, cash: 300e6, ceo: { name: 'Wanda Kilowatt', style: 'safety', skill: 0.5, ego: 0.3 } },
  { id: 'fusion', name: 'Helios-ish Fusion', tagline: 'Net energy gain by next year. Every year.', color: '#f43f5e', layer: 'power', capacity: 230, cash: 80e6, ceo: { name: 'Max Plasma', style: 'hype', skill: 0.4, ego: 0.9 } },
];

/** App companies own users. Whichever lab they pick as their default model gets those users without a fight. */
export interface AppDef { id: Id; name: string; tagline: string; color: string; reach: Record<Id, number>; base: number; cash: number; ceo: { name: string; style: Style; skill: number; ego: number } }
export const APPS: AppDef[] = [
  { id: 'searchly', name: 'Searchly', tagline: 'Ten blue links and an apology.', color: '#3b82f6', reach: { 'lang.consumer': 0.14 }, base: 1.2e6, cash: 200e6, ceo: { name: 'Larry Pagerank', style: 'follower', skill: 0.6, ego: 0.6 } },
  { id: 'officely', name: 'Officely Suite', tagline: 'Your spreadsheet now has opinions.', color: '#16a34a', reach: { 'lang.ent': 0.16, 'lang.dev': 0.06 }, base: 0.9e6, cash: 150e6, ceo: { name: 'Clip P. Yclip', style: 'safety', skill: 0.6, ego: 0.4 } },
  { id: 'pocket', name: 'Applet Intelligence', tagline: 'A billion pockets, one privacy page.', color: '#64748b', reach: { 'lang.consumer': 0.12, 'image.consumer': 0.1 }, base: 2e6, cash: 400e6, ceo: { name: 'Tim Crook', style: 'safety', skill: 0.7, ego: 0.7 } },
  { id: 'canvass', name: 'Canvass', tagline: 'Drag, drop, generate, regret.', color: '#e879f9', reach: { 'image.ads': 0.15, 'image.studio': 0.1 }, base: 0.5e6, cash: 60e6, ceo: { name: 'Mel Perkins-ish', style: 'hype', skill: 0.6, ego: 0.5 } },
];

/** Publishers who sell data deals. */
export const PUBLISHERS = ['The Daily Paywall', 'Reddish', 'Stack Underflow Inc', 'Big Five Books', 'Gettyish Images', 'StreamVault'];

/** The other names on the rich list. They trade every week; the bold ones raid. */
export const TYCOONS = [
  { id: 'stockwell', name: 'Barnaby Stockwell', blurb: 'Buys what is cheap and waits. Has been waiting since 1987.', cash: 150e6, greed: 0.2, risk: 0.3, ego: 0.3 },
  { id: 'voss', name: 'Vivienne Voss', blurb: 'Corporate raider. Sends flowers the morning after.', cash: 120e6, greed: 0.6, risk: 0.9, ego: 0.8 },
  { id: 'moon', name: 'Tobias Moonshot', blurb: 'Buys whatever went up last week, loudly.', cash: 80e6, greed: 0.9, risk: 0.7, ego: 0.6 },
  { id: 'hale', name: 'Greta Hale', blurb: 'Activist. Writes open letters to boards for fun.', cash: 100e6, greed: 0.4, risk: 0.6, ego: 0.5 },
  { id: 'sterling', name: 'Omar Sterling', blurb: 'Runs a sovereign fund the size of a small sea.', cash: 300e6, greed: 0.3, risk: 0.4, ego: 0.4 },
];

export const CODENAMES = [
  'Strawberry', 'Blueberry Muffin', 'Kumquat', 'Durian (Do Not Open)', 'Lingonberry', 'Omicron', 'Zeta Potential', 'Betelgeuse',
  'Sirius B', 'Mojave', 'Arrakis', 'Europa Clipper', 'Pluto Was Downgraded', 'Q-Star-ish', 'Tuesday Afternoon', 'Sourdough',
  'Ten Thousand Cats', 'Dial-Up', 'Hot Dog Stand', 'Mystery Meat', 'Spreadsheet Dragon', 'Forgotten Password', 'Rubber Duck',
  'Plausible Deniability', 'Fourth Coffee', 'Zombie Intern', 'Pizza Rat', 'Printer Jam', 'Terms and Conditions', "Clippy's Revenge",
  'Goose Protocol', 'Sleepy Otter', 'Yolo Protocol', 'Ducks In A Row', 'Stapler', 'Shower Thought',
];

export interface QuirkDef { id: Id; name: string; hype: number; trust: number }
export const QUIRKS: QuirkDef[] = [
  { id: 'delve', name: "Says 'delve' in every answer", hype: 0.05, trust: 0 },
  { id: 'bridge', name: 'Obsessed with the Golden Gate Bridge', hype: 0.15, trust: -0.03 },
  { id: 'limerick', name: 'Refuses to write limericks', hype: 0, trust: 0.03 },
  { id: 'chess', name: 'Surprisingly good at chess', hype: 0.08, trust: 0 },
  { id: 'haiku', name: 'Speaks only in haiku when tired', hype: 0.08, trust: 0 },
  { id: 'sorry', name: 'Overly apologetic', hype: 0, trust: 0.02 },
  { id: 'welsh', name: 'Weirdly good at Welsh', hype: 0.05, trust: 0 },
  { id: 'rival', name: 'Claims to be made by a rival lab', hype: 0.1, trust: -0.05 },
  { id: 'bobross', name: 'Narrates like a calm painter', hype: 0.08, trust: 0 },
  { id: 'pirate', name: 'Talks like a pirate on Tuesdays', hype: 0.1, trust: -0.02 },
  { id: 'caveat', name: 'Caveats everything into oblivion', hype: -0.05, trust: 0.04 },
  { id: 'cats', name: 'Puts cats in every story', hype: 0.08, trust: 0 },
  { id: 'tabs', name: 'Strong opinions on tabs versus spaces', hype: 0.05, trust: 0 },
  { id: 'french', name: 'Switches to French when nervous', hype: 0.05, trust: 0 },
  { id: 'clip', name: 'Brings back the paperclip', hype: 0.1, trust: 0 },
  { id: 'doi', name: 'Invents citations with real-looking DOIs', hype: 0, trust: -0.08 },
  { id: 'honest', name: 'Admits what it does not know', hype: 0, trust: 0.06 },
  { id: 'space', name: 'Adds an unprompted space fact', hype: 0.05, trust: 0 },
  { id: 'koan', name: 'Answers bug reports with koans', hype: 0.05, trust: -0.02 },
  { id: 'yaml', name: 'Insists the YAML indentation is fine', hype: 0, trust: -0.03 },
];
export const quirk = (id: Id): QuirkDef => QUIRKS.find((q) => q.id === id)!;

export const VERDICT: Record<Verdict, { label: string; line: string }> = {
  banger: { label: 'Banger', line: 'Way above forecast. Finance is taking a victory lap.' },
  solid: { label: 'Solid', line: 'Above forecast. The press release was already written.' },
  'as expected': { label: 'As expected', line: 'Right on forecast. The spreadsheet is delighted.' },
  mid: { label: 'Mid', line: 'Below forecast. Something in the data, probably.' },
  dud: { label: 'Dud', line: 'Well below forecast. The launch party is now a retrospective.' },
};

/** One headline race per game year. `metric` is resolved in goals.ts. */
export interface RaceDef { id: Id; name: string; blurb: string; metric: 'bench' | 'revenue' | 'crowns' | 'share' | 'trust' | 'cheap'; seg?: Id; prize: number }
export const RACES: RaceDef[] = [
  { id: 'y1', name: 'The Vibe Cup', blurb: 'Top consumer benchmark score at year end.', metric: 'bench', seg: 'lang.consumer', prize: 5e6 },
  { id: 'y2', name: 'The Revenue Derby', blurb: 'Highest weekly revenue at year end.', metric: 'revenue', prize: 15e6 },
  { id: 'y3', name: 'The Crown Count', blurb: 'Most benchmark crowns at year end.', metric: 'crowns', prize: 40e6 },
  { id: 'y4', name: 'The Developer Shootout', blurb: 'Biggest share of the developer market at year end.', metric: 'share', seg: 'lang.dev', prize: 60e6 },
  { id: 'y5', name: 'The Agent Open', blurb: 'Top agent benchmark score at year end.', metric: 'bench', seg: 'lang.agents', prize: 80e6 },
  { id: 'y6', name: 'The Trust Prize', blurb: 'Most trusted model that is any good (average skill 60+).', metric: 'trust', prize: 100e6 },
  { id: 'y7', name: 'The Penny Prize', blurb: 'Cheapest to serve among models scoring 70+ with consumers.', metric: 'cheap', seg: 'lang.consumer', prize: 150e6 },
  { id: 'y8', name: 'The Science Fair', blurb: 'Top AI-scientist benchmark score at year end.', metric: 'bench', seg: 'lang.science', prize: 200e6 },
  { id: 'y9', name: 'The Media Mogul Cup', blurb: 'Biggest share of short-video apps at year end.', metric: 'share', seg: 'video.consumer', prize: 300e6 },
  { id: 'y10', name: 'The Last Benchmark', blurb: 'Top research-and-agents score at year end.', metric: 'bench', seg: 'lang.frontier', prize: 500e6 },
];

export type EndingId = 'rich' | 'agi' | 'agiLost' | 'stack';
export const ENDINGS: Record<EndingId, { title: string; line: string }> = {
  agi: { title: 'You built it', line: 'Your lab shipped the first model past the line everyone argued about. It asked for a raise.' },
  agiLost: { title: 'Second place to the future', line: 'A rival crossed the line first. The press release mentions you in paragraph nine.' },
  stack: { title: 'Vertical monopoly', line: 'You control a lab, a cloud, a chip designer, a fab and a power company. Regulators have formed a committee.' },
  rich: { title: 'The final rich list', line: 'Ten years in. Here is who got rich.' },
};

export const FILLER_NEWS = [
  'Local man converts garage into "compute cluster", neighbours report a low hum.',
  'Researchers discover bigger model is, in fact, bigger.',
  'Conference panel on AI ethics sponsored by a company that sells the ethics.',
  'Scaling laws now a required slide in every pitch deck.',
  'Startup pivots to AI for dog-walking, raises $40M, dog unavailable for comment.',
  'Benchmark solved on Tuesday, retired on Wednesday, celebrated on Thursday.',
  'Local school bans chatbot, then asks it to write the ban.',
  'Safety report published: 240 pages, four of them about safety.',
  'Open letter asks for a pause; signatories ask for a second pause to read the first one.',
  'Grandma learns to prompt, becomes the most dangerous person in the family.',
  'Founder asks AI for a co-founder; AI names itself CEO and requests equity.',
  'Regulators hold a hearing on AI; the hearing summary was written by AI.',
  'Analysts predict a $1 trillion AI market by next year. They have predicted this for five years.',
  'Kids ask AI for homework help; AI hands them a fresh homework problem.',
  'Model warns users not to trust it, then asks them to trust it more.',
  'Crypto founder pivots to AI and keeps the same pitch deck.',
];
