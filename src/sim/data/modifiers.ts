// Run modifiers (New Game screen). Each one is a single multiplier on an existing rule, read through modifierMult.
import type { ModifierId } from '../types';

export interface ModifierDef {
  id: ModifierId;
  name: string;
  pitch: string;
  /** The multiplier applied while the modifier is on. */
  mult: number;
}

export const MODIFIERS: ModifierDef[] = [
  { id: 'gpu_drought', name: 'GPU drought', pitch: 'Vendors run dry. GPU buy prices run 35% hotter.', mult: 1.35 },
  { id: 'tight_money', name: 'Tight money', pitch: 'Funding rounds come in a quarter smaller.', mult: 0.75 },
  { id: 'hype_cycle', name: 'Hype cycle', pitch: 'The AI hype cycle swings twice as hard.', mult: 2 },
];
