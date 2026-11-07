// v18 memory-wall terms per option. Kept apart from trainingOptions.ts so systems/scaleLimits.ts can read them without an
// import cycle into the training systems (which would read RUN_TUNING before trainingOptions finishes loading).
// Bytes per parameter are multiplied by these; 1 = baseline. Options not listed are 1.
import type { Id, TrainingConfig } from '../types';

export const OPTION_MEMORY_MULT: Record<Id, number> = {
  adam: 1,
  adamw: 1,
  sgd: 0.75,
  lion: 0.75,
  shampoo: 1.3,
  muon: 0.875,
  fp32: 1.25,
  fp16: 1,
  bf16: 1,
  fp8: 0.85,
  fp4: 0.75,
};

/** Memory-wall multiplier of a sheet: the product of memoryMult over every option it picks (1 = baseline). */
export function sheetMemoryMult(cfg: TrainingConfig): number {
  const ids = [cfg.arch, cfg.tokenizer, cfg.context, cfg.optimizer, cfg.precision, cfg.schedule, ...cfg.filters, ...(cfg.post ?? []), ...(cfg.anneal ? [cfg.anneal] : [])];
  let m = 1;
  for (const id of ids) m *= OPTION_MEMORY_MULT[id] ?? 1;
  return m;
}
