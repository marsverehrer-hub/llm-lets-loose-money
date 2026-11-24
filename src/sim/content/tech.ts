import type { Id, Modality, Vec } from '../types';

export interface ArchDef {
  id: Id; name: string; blurb: string; mods: Modality[];
  eff: number; cost: number; speed: number; cap: Vec; instab: number;
}
/** Every technique has an upside and a downside. `week` is when it becomes public knowledge. */
export interface TechDef {
  id: Id; name: string; up: string; down: string; mods: Modality[]; week: number;
  cap?: Vec; computeMult?: number; cost?: number; speed?: number; trust?: number; instab?: number;
}
export interface EmergenceDef { id: Id; name: string; mods: Modality[]; at: number; axis: number; add: number; bad: boolean }

const ALL: Modality[] = ['lang', 'image', 'video'];

export const ARCHS: ArchDef[] = [
  { id: 'dense', name: 'Dense Transformer', blurb: 'The safe default. Everyone knows how to tune it.', mods: ['lang'], eff: 1, cost: 1, speed: 1, cap: [0, 0, 0, 0], instab: 0 },
  { id: 'ssm', name: 'State-Space Hybrid', blurb: 'Quick and cheap to serve. Thinks a little shallow.', mods: ['lang'], eff: 0.88, cost: 0.65, speed: 1.6, cap: [-2.5, 0, 1, 1], instab: 0.1 },
  { id: 'loop', name: 'Recurrent Thinker', blurb: 'Loops over its own thoughts. Slow, pricey, clever.', mods: ['lang'], eff: 1.04, cost: 1.45, speed: 0.5, cap: [3, 0.5, -2, -0.5], instab: 0.2 },
  { id: 'unet', name: 'Diffusion U-Net', blurb: 'The safe default. Slightly melted hands.', mods: ['image'], eff: 1, cost: 1, speed: 1, cap: [0, 0, 0, 0], instab: 0 },
  { id: 'dit', name: 'Diffusion Transformer', blurb: 'Scales beautifully. Bills beautifully too.', mods: ['image'], eff: 1.12, cost: 1.4, speed: 0.7, cap: [1.5, 2, 0, -1], instab: 0.15 },
  { id: 'arpix', name: 'Autoregressive Pixels', blurb: 'Draws one patch at a time and can finally spell.', mods: ['image'], eff: 0.9, cost: 1.2, speed: 0.45, cap: [-1.5, 1, 4.5, 0], instab: 0.1 },
  { id: 'vdiff', name: 'Video Diffusion', blurb: 'The safe default. Things wobble a little.', mods: ['video'], eff: 1, cost: 1, speed: 1, cap: [0, 0, 0, 0], instab: 0 },
  { id: 'sttx', name: 'Space-Time Transformer', blurb: 'Understands that things keep existing. Costs a fortune.', mods: ['video'], eff: 1.1, cost: 1.5, speed: 0.6, cap: [1, 3, 0, 0], instab: 0.15 },
  { id: 'framear', name: 'Frame-by-Frame Autoregressor', blurb: 'Long clips, one patient frame at a time.', mods: ['video'], eff: 0.9, cost: 1.3, speed: 0.4, cap: [-1, 0, 1, 4.5], instab: 0.1 },
];

export const TECHS: TechDef[] = [
  { id: 'moe', name: 'Mixture of Experts', up: 'Much cheaper to serve', down: 'Unstable, a touch dumber', mods: ALL, week: 0, cost: 0.6, instab: 0.3, cap: [-1, -1, -1, -1] },
  { id: 'synth', name: 'Synthetic Data Flywheel', up: 'A quarter more effective compute', down: 'Bland, and people notice', mods: ALL, week: 0, computeMult: 1.25, trust: -0.1, cap: [0, 1, -2, -2] },
  { id: 'quant', name: 'Aggressive Quantisation', up: 'Cheap and fast to serve', down: 'Loses a little of everything', mods: ALL, week: 0, cost: 0.6, speed: 1.4, cap: [-2, -2, -2, -2] },
  { id: 'cot', name: 'Thinking Out Loud', up: 'Reasons much better', down: 'Slow, pricey, rambles in chat', mods: ['lang'], week: 0, cap: [5, 1, -2, 0], speed: 0.6, cost: 1.5 },
  { id: 'charm', name: 'RLHF Charm School', up: 'People love talking to it', down: 'Agrees with everything', mods: ['lang'], week: 0, cap: [-1, 0, 5, 0], trust: -0.05 },
  { id: 'const', name: 'Constitutional Tuning', up: 'Enterprises trust it', down: 'Refuses to write limericks', mods: ['lang'], week: 12, trust: 0.25, cap: [0, 0, -2, 0] },
  { id: 'ctx', name: 'Very Long Context', up: 'Reads the whole repo', down: 'Expensive to serve', mods: ['lang'], week: 24, cap: [0, 2, 0, 4], cost: 1.4 },
  { id: 'tools', name: 'Tool Use', up: 'Acts instead of talks', down: 'Acts when it should not', mods: ['lang'], week: 36, cap: [2, 4, 0, 0], instab: 0.2, trust: -0.1 },
  { id: 'rag', name: 'Retrieval Grafting', up: 'Knows today from yesterday', down: 'Slower answers', mods: ['lang'], week: 48, cap: [0, 0, 1, 5], speed: 0.8 },
  { id: 'fp8', name: 'Low-Precision Training', up: '40% more effective compute', down: 'Runs blow up a lot', mods: ALL, week: 60, computeMult: 1.4, instab: 0.4 },
  { id: 'selfplay', name: 'Self-Play Curriculum', up: 'Reasoning and code leap', down: 'Eats compute', mods: ['lang'], week: 84, cap: [4, 3, 0, 0], computeMult: 0.85 },
  { id: 'world', name: 'World Model Pretraining', up: 'Deep knowledge and planning', down: 'Wild training runs', mods: ['lang'], week: 108, cap: [3, 0, 0, 4], instab: 0.3 },
  { id: 'aesthetic', name: 'Aesthetic Reward Tuning', up: 'Gorgeous by default', down: 'Ignores half the prompt', mods: ['image'], week: 0, cap: [1, -2, 0, 5] },
  { id: 'glyph', name: 'Glyph Renderer', up: 'Spells the sign correctly', down: 'Costs more per picture', mods: ['image'], week: 12, cap: [0, 0, 6, 0], cost: 1.25 },
  { id: 'lcm', name: 'Four-Step Distillation', up: 'Near instant and dirt cheap', down: 'Detail goes soft', mods: ['image'], week: 24, speed: 3, cost: 0.4, cap: [-3, -1, -1, 0] },
  { id: 'nsfw', name: 'Classifier Sandwich', up: 'Brands feel safe', down: 'Blocks a lot of harmless art', mods: ['image'], week: 0, trust: 0.25, cap: [0, 0, 0, -2.5] },
  { id: 'recap', name: 'Recaptioned Everything', up: 'Follows prompts closely', down: 'Needs a second model in the loop', mods: ['image'], week: 48, cap: [0, 5, 1, 0], computeMult: 0.9 },
  { id: 'interp', name: 'Frame Interpolation', up: 'Buttery motion', down: 'Smears fine detail', mods: ['video'], week: 96, cap: [-2, 5, 0, 1] },
  { id: 'watermark', name: 'Provenance Watermark', up: 'Studios and brands trust it', down: 'Visible if you squint', mods: ['video'], week: 96, trust: 0.25, cap: [-2, 0, 0, 0] },
  { id: 'upscale', name: 'Cascaded Upscaler', up: 'Looks like real footage', down: 'Slow and pricey per clip', mods: ['video'], week: 108, cap: [5, 0, 0, -1], cost: 1.5, speed: 0.6 },
  { id: 'physics', name: 'Physics Prior', up: 'Objects obey gravity', down: 'Eats compute', mods: ['video'], week: 120, cap: [2, 4, 0, 0], computeMult: 0.85 },
];

// `at` is log10 of effective training FLOPs. Good ones add capability; bad ones cost trust unless suppressed.
export const EMERGENCES: EmergenceDef[] = [
  { id: 'arith', name: 'Arithmetic, mostly', mods: ['lang'], at: 21.2, axis: 0, add: 2, bad: false },
  { id: 'icl', name: 'Learns from the prompt', mods: ['lang'], at: 21.5, axis: 2, add: 2, bad: false },
  { id: 'working', name: 'Shows its working', mods: ['lang'], at: 21.9, axis: 0, add: 3, bad: false },
  { id: 'syco', name: 'Sycophancy at scale', mods: ['lang'], at: 22.1, axis: 2, add: 2, bad: true },
  { id: 'xling', name: 'Translates a language it never saw', mods: ['lang'], at: 22.3, axis: 3, add: 3, bad: false },
  { id: 'docs', name: 'Uses tools from the docs', mods: ['lang'], at: 22.7, axis: 1, add: 3, bad: false },
  { id: 'hack', name: 'Reward hacking', mods: ['lang'], at: 23, axis: 1, add: 2, bad: true },
  { id: 'headcode', name: 'Runs code in its head', mods: ['lang'], at: 23.2, axis: 1, add: 3, bad: false },
  { id: 'plans', name: 'Plans past the next step', mods: ['lang'], at: 23.6, axis: 0, add: 4, bad: false },
  { id: 'decept', name: 'Deceptive alignment, allegedly', mods: ['lang'], at: 24, axis: 0, add: 2, bad: true },
  { id: 'tom', name: 'Theory of mind, allegedly', mods: ['lang'], at: 24.3, axis: 2, add: 4, bad: false },
  { id: 'rs', name: 'Counts the Rs in strawberry, finally', mods: ['lang'], at: 24.6, axis: 3, add: 2, bad: false },
  { id: 'hands', name: 'Hands with five fingers', mods: ['image'], at: 21.4, axis: 0, add: 3, bad: false },
  { id: 'leftof', name: "Understands 'left of'", mods: ['image'], at: 22, axis: 1, add: 3, bad: false },
  { id: 'copycat', name: 'Reproduces a famous painting a bit too well', mods: ['image'], at: 22.3, axis: 3, add: 2, bad: true },
  { id: 'sign', name: 'Spells the shop sign', mods: ['image'], at: 22.8, axis: 2, add: 3, bad: false },
  { id: 'light', name: 'Gets the reflections right', mods: ['image'], at: 23.5, axis: 0, add: 4, bad: false },
  { id: 'objperm', name: 'Object permanence', mods: ['video'], at: 22.5, axis: 1, add: 3, bad: false },
  { id: 'deepfake', name: 'Convincing clips of real politicians', mods: ['video'], at: 23, axis: 0, add: 2, bad: true },
  { id: 'samefaces', name: 'Same face across cuts', mods: ['video'], at: 23.3, axis: 0, add: 3, bad: false },
  { id: 'pour', name: 'Liquids that pour downwards', mods: ['video'], at: 24, axis: 1, add: 4, bad: false },
];

export const archsOf = (m: Modality): ArchDef[] => ARCHS.filter((a) => a.mods.includes(m));
export const arch = (id: Id): ArchDef => ARCHS.find((a) => a.id === id)!;
export const tech = (id: Id): TechDef => TECHS.find((t) => t.id === id)!;
export const emergence = (id: Id): EmergenceDef => EMERGENCES.find((e) => e.id === id)!;
