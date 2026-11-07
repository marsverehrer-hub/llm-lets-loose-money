// The shape of a model as a network you can draw (NetView). Pure: derives layers, width, heads and experts from the
// parameter count with the usual transformer proportions (params ≈ 12 · layers · width², width ≈ 128 · layers), so a
// bigger model really is deeper and wider on screen. Imports nothing from the sim at runtime (the components index loads
// before the sim, and the sim's data modules have import cycles that must start from the engine).
import type { MediaRunConfig, TrainingConfig } from '../../sim/types';

export type NetFamily = 'transformer' | 'moe' | 'lstm' | 'ssm' | 'recurrent' | 'diffusion_lm' | 'unet' | 'dit' | 'gan';

export interface NetSpec {
  family: NetFamily;
  /** Total parameters, billions. */
  paramsB: number;
  /** Parameters used per token, billions (MoE: the active experts). */
  activeParamsB: number;
  layers: number;
  /** Hidden width (d_model). */
  width: number;
  heads: number;
  /** MoE experts per layer (1 for dense). */
  experts: number;
  /** Experts each token visits. */
  topK: number;
  /** Context window in thousands of tokens (text models). */
  contextK: number;
  /** What goes in and what comes out, for the labels. */
  input: 'tokens' | 'noise' | 'patches';
  output: 'tokens' | 'image' | 'video';
}

/** Width per layer at the usual aspect ratio. */
const ASPECT = 128;
/** Layers grow by 1.6^shape at shape +1 (deep and narrow) and shrink by the same at -1 (wide and shallow). */
const SHAPE_DEPTH = 1.6;

/**
 * Layers and width for a dense stack of `paramsB` billion parameters. `shape` (-1 wide .. +1 deep) scales the layer
 * count; the width follows so the parameter count stays the same (params ≈ 12 · layers · width²).
 */
export function depthWidth(paramsB: number, shape = 0): { layers: number; width: number } {
  const p = Math.max(1e6, paramsB * 1e9);
  const layers = Math.max(2, Math.round(Math.cbrt(p / (12 * ASPECT * ASPECT)) * SHAPE_DEPTH ** shape));
  const width = Math.max(64, Math.round(Math.sqrt(p / (12 * layers)) / 64) * 64);
  return { layers, width };
}

function base(family: NetFamily, paramsB: number, activeParamsB: number, shape = 0): NetSpec {
  const { layers, width } = depthWidth(activeParamsB, shape);
  return {
    family,
    paramsB,
    activeParamsB,
    layers,
    width,
    heads: Math.max(1, Math.round(width / 128)),
    experts: 1,
    topK: 1,
    contextK: 2,
    input: 'tokens',
    output: 'tokens',
  };
}

const TEXT_FAMILY: Record<string, NetFamily> = {
  lstm: 'lstm',
  dense: 'transformer',
  moe: 'moe',
  ssm_hybrid: 'ssm',
  diffusion_lm: 'diffusion_lm',
  recurrent_depth: 'recurrent',
};

/**
 * A language model's network from its size and run sheet. `activeParamsB` is what one token uses (MoE: the active
 * experts; the sim's `activeParamsFor`), `contextK` the window in thousands of tokens.
 */
export function netSpecOfText(paramsB: number, cfg: TrainingConfig | undefined, activeParamsB = paramsB, contextK = 2): NetSpec {
  const family = TEXT_FAMILY[cfg?.arch ?? 'dense'] ?? 'transformer';
  const spec = base(family, paramsB, Math.min(paramsB, activeParamsB), cfg?.shape ?? 0);
  spec.experts = family === 'moe' ? (cfg?.moeExperts ?? 16) : 1;
  spec.topK = family === 'moe' ? (cfg?.moeTopK ?? 2) : 1;
  spec.contextK = contextK;
  if (family === 'lstm') spec.heads = 0;
  return spec;
}

const MEDIA_FAMILY: Record<string, NetFamily> = {
  gan: 'gan',
  ar_tokens: 'dit',
  diffusion_unet: 'unet',
  dit: 'dit',
  flow: 'dit',
  video_unet: 'unet',
  video_dit: 'dit',
  world_sim: 'dit',
};

/** An image or video model's network from its run sheet. */
export function netSpecOfMedia(cfg: Pick<MediaRunConfig, 'arch' | 'paramsB' | 'kind'>): NetSpec {
  const family = MEDIA_FAMILY[cfg.arch] ?? 'dit';
  const spec = base(family, cfg.paramsB, cfg.paramsB);
  spec.input = family === 'dit' && cfg.arch === 'ar_tokens' ? 'tokens' : family === 'dit' ? 'patches' : 'noise';
  spec.output = cfg.kind === 'video' ? 'video' : 'image';
  return spec;
}

/** Bytes of weights at bf16, as a readable size. */
export function weightsSize(paramsB: number): string {
  const gb = paramsB * 2;
  if (gb >= 1000) return `${+(gb / 1000).toFixed(1)} TB`;
  if (gb >= 1) return `${+gb.toFixed(gb < 10 ? 1 : 0)} GB`;
  return `${Math.max(1, Math.round(gb * 1000))} MB`;
}
