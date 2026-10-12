import type { GameState, Model, Rng } from '../types';
// OWNER: Agent NAMES. Codenames, the player's public naming schemes (GAME_DESIGN.md §17.1) and company stems.
// Everything here is deterministic for a given rng state.

// ---------------------------------------------------------------------------
// Codenames: the internal name a run starts with.
// ---------------------------------------------------------------------------
const CODENAMES: string[] = [
  // Fruits and berries
  'Strawberry', 'Blueberry Muffin', 'Gooseberry', 'Blackberry', 'Mulberry', 'Lingonberry', 'Cranberry Sauce',
  'Kumquat', 'Persimmon', 'Dragonfruit', 'Lychee', 'Mangosteen', 'Quince', 'Rambutan', 'Starfruit', 'Pomelo',
  'Huckleberry', 'Elderberry', 'Boysenberry', 'Cloudberry', 'Tamarillo', 'Durian (Do Not Open)',
  // Greek letters
  'Omicron', 'Sigma', 'Kappa', 'Theta', 'Lambda Nine', 'Epsilon Minor', 'Zeta Potential', 'Omega Minus', 'Iota', 'Upsilon',
  // Stars
  'Betelgeuse', 'Vega Nova', 'Sirius B', 'Antares', 'Rigel Kent', 'Aldebaran', 'Canopus', 'Polaris Drift', 'Deneb',
  'Altair', 'Procyon', 'Arcturus', 'Mizar', 'Capella',
  // Deserts
  'Sahara Sleeper', 'Mojave', 'Gobi', 'Atacama', 'Namib', 'Kalahari', 'Negev', 'Taklamakan', 'Painted Desert', 'Dune Sea', 'Arrakis',
  // Planets and space
  'Europa Clipper', 'Titan Lake', 'Ganymede', 'Callisto', 'Kepler Nine', 'Proxima', 'Oort Cloud', 'Pluto Was Downgraded',
  'Ceres', 'Vesta', 'Triton', 'Q-Star-ish',
  // Internal jokes
  'Big Lebowski', 'Tuesday', 'Tuesday Afternoon', 'Chihuahua', 'Sourdough', 'Ten Thousand Cats', 'Dial-Up', 'Hot Dog Stand',
  'Mystery Meat', 'Spreadsheet Dragon', 'Forgotten Password', 'Lunch Break', 'Rubber Duck', 'Monday Standup',
  'Plausible Deniability', 'Fourth Coffee', 'Zombie Intern', 'Pizza Rat', 'Printer Jam', 'Terms and Conditions',
  'Infinite Scroll', "Clippy's Revenge", 'Goose Protocol', 'Beige Bullet', 'Sleepy Otter', 'Bonsai Kitten',
  'Yolo Protocol', 'Ducks In A Row', 'Sandwich Artist', 'Stapler', 'Shower Thought',
];

/** A fun internal codename for a new run. Mostly bare ("Gobi"), sometimes "Project Gobi". */
export function suggestCodename(rng: Rng): string {
  const word = rng.pick(CODENAMES);
  return rng.chance(0.25) ? `Project ${word}` : word;
}

/** Legacy entry point for the training wizard. The generation argument is ignored; names are codenames now. */
export function suggestModelName(rng: Rng, _generation: number): string {
  return suggestCodename(rng);
}

// ---------------------------------------------------------------------------
// Player naming schemes. `company.namingScheme` picks one; `suggestPublicName` builds a name that fits the model.
// ---------------------------------------------------------------------------
export interface NamingScheme {
  id: string;
  name: string;            // sentence case, e.g. "Tiered poetry"
  description: string;     // one line
  example: string;         // e.g. "Loosey Haiku 2, Loosey Sonnet 2, Loosey Epic 2"
}

export const NAMING_SCHEMES: NamingScheme[] = [
  { id: 'versioned', name: 'Versioned', description: 'Numbers go up.', example: 'Loosey 1, Loosey 2 Coder, Loosey 3 Pro' },
  { id: 'tiered_poetry', name: 'Tiered poetry', description: 'Sized like verse: small is a haiku, large is an epic.', example: 'Loosey Haiku 2, Loosey Sonnet 2, Loosey Epic 2' },
  { id: 'big_number', name: 'Big number', description: 'The parameter count goes in the name, like a spec sheet.', example: 'Loosey-70B-Instruct, Loosey-7B-Coder' },
  { id: 'mythic', name: 'Mythic', description: 'Gods and titans, ranked by how much they can carry.', example: 'Loosey Hermes, Loosey Atlas II Oracle, Loosey Prometheus III' },
  { id: 'weather', name: 'Weather', description: 'Forecasts from drizzle up to monsoon.', example: 'Loosey Drizzle, Loosey Squall 2 Think, Loosey Monsoon' },
  { id: 'marketing', name: 'Marketing', description: 'Adjectives stacked until the copywriter gives up.', example: 'Loosey Turbo Max Ultra 2, Loosey Nano 2 Coder' },
  { id: 'animals', name: 'Animals', description: 'Small creatures at the bottom, leviathans at the top.', example: 'Loosey Lemur, Loosey Lynx 2, Loosey Leviathan' },
];

type Tier = 'small' | 'mid' | 'large';
type SpecKind = 'coder' | 'reasoning' | 'chat' | 'vision';

/** Everything a scheme needs to build a name. Built once per call so the rng is consumed in a fixed order. */
interface NameCtx {
  stem: string;
  version: number;
  tier: Tier;
  spec: SpecKind | null;
  derived: 'distill' | 'merge' | null;
  paramsB: number;
  rng: Rng;
}
type Builder = (c: NameCtx) => string;

/** Spec ids (src/sim/data/specializations.ts) grouped by the kind of word they earn in a name. */
const SPEC_KIND: Record<string, SpecKind> = {
  coder: 'coder', agentic_coder: 'coder', autonomous_swe: 'coder',
  reasoner: 'reasoning', math_olympian: 'reasoning', deep_researcher: 'reasoning',
  instruct: 'chat', companion: 'chat', safe_assistant: 'chat',
  vision: 'vision', omni: 'vision',
};
const SPEC_WORDS: Record<SpecKind, string[]> = {
  coder: ['Coder', 'Code'],
  reasoning: ['Think', 'R'],
  chat: ['Instruct', 'Chat'],
  vision: ['Vision'],
};
const DERIVED_WORDS: Record<'distill' | 'merge', string[]> = {
  distill: ['mini', 'Flash', 'Lite'],
  merge: ['Merge', 'Soup'],
};
const POEM: Record<Tier, string> = { small: 'Haiku', mid: 'Sonnet', large: 'Epic' };
const MYTHIC: Record<Tier, string[]> = {
  small: ['Hermes', 'Iris', 'Pan', 'Psyche', 'Eos', 'Hebe'],
  mid: ['Atlas', 'Orion', 'Apollo', 'Perseus', 'Jason', 'Odin'],
  large: ['Prometheus', 'Zeus', 'Titan', 'Olympus', 'Gaia', 'Ragnarok'],
};
const MYTH_SPEC: Record<SpecKind, string> = { coder: 'Forge', reasoning: 'Oracle', chat: 'Herald', vision: 'Seer' };
const WEATHER: Record<Tier, string[]> = {
  small: ['Drizzle', 'Breeze', 'Mist', 'Sprinkle'],
  mid: ['Squall', 'Gale', 'Cold Front', 'Haze'],
  large: ['Monsoon', 'Hurricane', 'Typhoon', 'Blizzard'],
};
const MARKET_SMALL = ['Nano', 'Go', 'Swift'];
const MARKET_MID = ['Turbo', 'Hyper', 'Super', 'Neo'];
const ANIMALS: Record<Tier, string[]> = {
  small: ['Lemur', 'Gecko', 'Otter', 'Ferret', 'Hamster'],
  mid: ['Lynx', 'Heron', 'Falcon', 'Wolf', 'Jaguar'],
  large: ['Leviathan', 'Mammoth', 'Kraken', 'Behemoth', 'Thunderbird'],
};

function specWord(c: NameCtx): string | null {
  return c.spec ? c.rng.pick(SPEC_WORDS[c.spec]) : null;
}
function derivedWord(c: NameCtx): string | null {
  return c.derived ? c.rng.pick(DERIVED_WORDS[c.derived]) : null;
}
function words(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' ');
}
function paramsTag(b: number): string {
  if (b >= 1000) return `${Math.round(b / 1000)}T`;
  if (b >= 1) return `${Math.round(b)}B`;
  return `${Math.max(1, Math.round(b * 1000))}M`;
}
function roman(n: number): string {
  const table: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let v = n;
  for (const [val, sym] of table) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

const SCHEME_BUILDERS: Record<string, Builder> = {
  // Loosey 1, Loosey 2 Coder, Loosey 3 Pro. Small models get "mini", large ones "Pro"; derived models get their own word.
  versioned: (c) => {
    const tag = c.derived ? derivedWord(c) : c.tier === 'small' ? 'mini' : c.tier === 'large' ? 'Pro' : null;
    return words(c.stem, String(c.version), specWord(c), tag);
  },
  // Loosey Haiku 2, Loosey Sonnet 2, Loosey Epic 2.
  tiered_poetry: (c) => words(c.stem, POEM[c.tier], String(c.version), specWord(c), derivedWord(c)),
  // Loosey-70B-Instruct. The size is the total parameter count, so the tag reads like a spec sheet.
  big_number: (c) => {
    const tail = [specWord(c), derivedWord(c)].filter((w): w is string => !!w);
    return [`${c.stem}-${paramsTag(c.paramsB)}`, ...tail].join('-');
  },
  // Loosey Hermes, Loosey Atlas II Oracle, Loosey Prometheus III.
  mythic: (c) => {
    const god = c.rng.pick(MYTHIC[c.tier]);
    return words(c.stem, god, c.version > 1 ? roman(c.version) : null, c.spec ? MYTH_SPEC[c.spec] : null, derivedWord(c));
  },
  // Loosey Drizzle, Loosey Squall 2 Think, Loosey Monsoon.
  weather: (c) => words(c.stem, c.rng.pick(WEATHER[c.tier]), c.version > 1 ? String(c.version) : null, specWord(c), derivedWord(c)),
  // Loosey Turbo Max Ultra 2, Loosey Nano 2 Coder.
  marketing: (c) => {
    const adj = c.tier === 'small' ? c.rng.pick(MARKET_SMALL) : c.tier === 'large' ? 'Turbo Max Ultra' : c.rng.pick(MARKET_MID);
    return words(c.stem, adj, String(c.version), specWord(c), derivedWord(c));
  },
  // Loosey Lemur, Loosey Lynx 2, Loosey Leviathan.
  animals: (c) => words(c.stem, c.rng.pick(ANIMALS[c.tier]), c.version > 1 ? String(c.version) : null, specWord(c), derivedWord(c)),
};

/**
 * Company stem from the company name. Filler words (Labs, AI, Inc, Corp, Technologies...) are dropped:
 * "Lets Loose Labs" -> "Lets Loose", "Acme AI" -> "Acme". A long multi-word stem falls back to its first word.
 */
const FILLER = new Set([
  'labs', 'lab', 'ai', 'inc', 'corp', 'corporation', 'co', 'llc', 'ltd', 'technologies', 'technology',
  'systems', 'intelligence', 'research', 'group', 'company', 'the',
]);
export function companyStem(name: string): string {
  const all = name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, '')).filter((w) => w.length > 0);
  const kept = all.filter((w) => !FILLER.has(w.toLowerCase()));
  const pool = kept.length > 0 ? kept : all;
  let stem = pool.join(' ');
  if (stem.length > 14) stem = pool[0];
  return stem || 'Frontier';
}

function isBaseModel(m: Model): boolean {
  return !m.specId && !m.parentId && !m.derivedFrom;
}

/**
 * The version a model answers to: one more than the count of released base models that came out earlier.
 * Fine-tunes and derived models take their parent's version.
 */
function baseVersion(s: GameState, model: Model, depth = 0): number {
  const parentId = model.parentId ?? model.derivedFrom?.ids[0] ?? null;
  const parent = parentId ? s.models.find((m) => m.id === parentId) : undefined;
  if (parent && parent.id !== model.id && depth < 4) return baseVersion(s, parent, depth + 1);
  const when = model.releasedDay ?? Infinity;
  const earlier = s.models.filter((m) => m.id !== model.id && isBaseModel(m) && m.releasedDay !== null && m.releasedDay < when).length;
  return earlier + 1;
}

/** Small, mid or large, relative to the player's other models (median active params). Absolute bands if alone. */
function sizeTier(s: GameState, model: Model): Tier {
  const p = model.activeParamsB ?? model.paramsB;
  const others = s.models
    .filter((m) => m.id !== model.id)
    .map((m) => m.activeParamsB ?? m.paramsB)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  if (others.length === 0) return p <= 13 ? 'small' : p >= 100 ? 'large' : 'mid';
  const mid = Math.floor(others.length / 2);
  const median = others.length % 2 ? others[mid] : (others[mid - 1] + others[mid]) / 2;
  const ratio = p / median;
  return ratio <= 0.5 ? 'small' : ratio >= 2 ? 'large' : 'mid';
}

function specKindOf(m: Model): SpecKind | null {
  const id = m.specId ?? m.lineage?.[m.lineage.length - 1] ?? null;
  return id ? SPEC_KIND[id] ?? null : null;
}

/** Appends " (rev 2)", " (rev 3)"... if the name is already taken by another model. */
function uniqueAmong(s: GameState, model: Model, base: string): string {
  const taken = new Set(s.models.filter((m) => m.id !== model.id).map((m) => m.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (rev ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * A public name for `model` under the company's scheme. Version comes from the released base count, size tier from
 * the model's params relative to the player's other models, the spec suffix from its spec, and "mini"/"Flash"/"Lite"
 * or "Merge"/"Soup" from how it was derived. Deterministic for a given rng state; never duplicates another model.
 */
export function suggestPublicName(
  s: GameState,
  model: Model,
  schemeId: string,
  rng: Rng,
): string {
  const scheme = NAMING_SCHEMES.find((x) => x.id === schemeId) ?? NAMING_SCHEMES[0];
  const build = SCHEME_BUILDERS[scheme.id] ?? SCHEME_BUILDERS.versioned;
  const ctx: NameCtx = {
    stem: companyStem(s.company.name),
    version: baseVersion(s, model),
    tier: sizeTier(s, model),
    spec: specKindOf(model),
    derived: model.derivedFrom?.kind ?? null,
    paramsB: model.paramsB,
    rng,
  };
  return uniqueAmong(s, model, build(ctx).trim());
}
