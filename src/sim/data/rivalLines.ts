// OWNER: CLASSES. Rival small and medium lines (GAME_DESIGN §19.2): which labs ship which class and from when, and
// each lab's house style for line names. Names are built from the flagship's name, so a line always reads as the
// same lab's product.
import type { Id, WeightClass } from '../types';

export type LineClass = Exclude<WeightClass, 'open'>;

/** First year each lab ships a line in each class. Labs with no entry get no lines. */
export const LINE_SCHEDULE: Record<Id, Partial<Record<LineClass, number>>> = {
  metaverse_llama: { small: 2022, medium: 2022 },
  mistrial: { small: 2023, medium: 2023, nano: 2025 },
  deepseekers: { small: 2024, medium: 2024 },
  openaye: { small: 2023, nano: 2024 },
  deepmined: { medium: 2023, nano: 2024 },
  anthropomorphic: { small: 2024, nano: 2026 },
};

/** Tier words stripped from a flagship name to get its family ("Gemineye 3.5 Flash" -> "Gemineye 3.5"). */
const TIER_WORDS = /\s+(Pro|Ultra|Flash|Nano|Lite|Turbo|Large|Maverick|Epic|Sonnet|Limerick|Instant)$/;

function familyOf(flagship: string): string {
  let out = flagship;
  for (let i = 0; i < 3 && TIER_WORDS.test(out); i++) out = out.replace(TIER_WORDS, '');
  return out.trim();
}

/** The first version number in a name ("GPTee-6" -> "6", "Llamaish 3.1 405B" -> "3.1"). Defaults to "1". */
function generationOf(flagship: string): string {
  const m = flagship.match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '1';
}

function sizeLabel(activeParamsB: number): string {
  return String(Math.max(1, Math.round(activeParamsB)));
}

/**
 * Name of a rival line in its lab's house style. `flagship` is the lab's current flagship name, `activeParamsB` the
 * line's active size (used where the house style puts a size in the name).
 */
export function lineName(labId: Id, cls: LineClass, flagship: string, activeParamsB: number): string {
  const gen = generationOf(flagship);
  switch (labId) {
    case 'openaye':
      return cls === 'nano' ? `${flagship} nano` : `${flagship} mini`;
    case 'deepmined':
      return cls === 'nano' ? `${familyOf(flagship)} Nano` : `${familyOf(flagship)} Flash`;
    case 'anthropomorphic':
      return cls === 'nano' ? `Clawed Instant ${gen}` : `Clawed ${gen} Haiku`;
    case 'metaverse_llama':
      return `Llamaish ${gen} ${sizeLabel(activeParamsB)}B`;
    case 'mistrial':
      if (cls === 'nano') return `Ministrial ${sizeLabel(activeParamsB)}B`;
      return cls === 'medium' ? `Mistrial Medium ${gen}` : `Mistrial Small ${gen}`;
    case 'deepseekers': {
      const base = flagship.replace(/-Lite$/, '');
      return cls === 'medium' ? `${base}-Distill` : `${base}-Lite`;
    }
    default:
      return `${flagship} ${cls === 'nano' ? 'Nano' : 'Small'}`;
  }
}

/** Launch headlines for a new line. Placeholders: {lab}, {model}, {flagship}. Sometimes snarky, always short. */
export const LINE_NEWS: Record<LineClass, string[]> = {
  nano: [
    '{lab} ships {model}, which fits in a phone and is less embarrassed about it than you would expect.',
    '{lab} ships {model}. It is tiny, cheap, and slightly smug about being the only thing in the room that runs without a datacenter.',
    '{model} is out. {lab} calls it "a step change for people who cannot afford {flagship}".',
  ],
  small: [
    '{lab} ships {model}, a small model that embarrasses everyone\'s {flagship}.',
    '{lab} ships {model}. It is small enough to run on a laptop and good enough to make {flagship} look expensive.',
    'Nobody asked for {model}. It is good anyway, which is the problem for {flagship}.',
  ],
  medium: [
    '{lab} ships {model}, a medium model with a flagship-shaped price and a flagship-shaped sense of entitlement.',
    '{model} lands from {lab}. Its benchmarks are close enough to {flagship} that the two teams are not speaking.',
  ],
};
