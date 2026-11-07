// v18 precision on real hardware. Kept apart from scaleLimits.ts and trainingOptions.ts on purpose: both of those sit in an
// import cycle with the training systems, and this file must load without them (its own deps are data and cloud leases).
import type { GameState, Id } from '../types';
import { GPUS, PRECISION_SPEED, gpuFormats, type GpuSpec, type HwFormat } from '../data/gpus';
import { cloudGpusByType } from './cloudMarket';

/** The lab's own GPUs (rented and installed, skipping neocloud-dedicated halls) with their counts. */
export function trainingFleet(s: GameState): { g: GpuSpec | undefined; k: number }[] {
  const out: { g: GpuSpec | undefined; k: number }[] = [];
  const add = (gid: string, k: number) => out.push({ g: GPUS.find((x) => x.id === gid), k });
  for (const [gid, k] of Object.entries(cloudGpusByType(s))) if (k > 0) add(gid, k); // every cloud provider
  const sold = s.neocloud?.dedicated ?? []; // halls dedicated to the neocloud do not train
  for (const dc of s.compute.datacenters) {
    if (dc.buildDaysLeft > 0 || sold.includes(dc.id)) continue;
    for (const [gid, k] of Object.entries(dc.gpus)) if (k > 0) add(gid, k);
  }
  return out;
}

/**
 * Speed of one precision on one GPU (1 = fp32). A format the chip runs natively gets its full speed; otherwise it is
 * emulated at the speed of the nearest format the chip does have (fp8 falls back to bf16 or fp16, fp4 to fp8).
 */
export function hwSpeed(g: GpuSpec | undefined, precisionId: Id): number {
  const native = (f: HwFormat) => !!g && gpuFormats(g).includes(f);
  switch (precisionId) {
    case 'fp16':
      return PRECISION_SPEED.fp16;
    case 'bf16':
      return native('bf16') ? PRECISION_SPEED.bf16 : 1;
    case 'fp8':
      return native('fp8') ? PRECISION_SPEED.fp8 : Math.max(PRECISION_SPEED.fp16, hwSpeed(g, 'bf16'));
    case 'fp4':
      return native('fp4') ? PRECISION_SPEED.fp4 : hwSpeed(g, 'fp8');
    default:
      return 1; // fp32, and anything unknown
  }
}

/** Throughput factor of a precision on this lab's fleet: the PFLOPS-weighted mean of hwSpeed. Starter GPU with no fleet. */
export function fleetFormatSpeed(s: GameState, precisionId: Id): number {
  let weight = 0;
  let sum = 0;
  for (const { g, k } of trainingFleet(s)) {
    const w = k * (g?.pflops ?? 0);
    weight += w;
    sum += w * hwSpeed(g, precisionId);
  }
  return weight > 0 ? sum / weight : hwSpeed(GPUS[0], precisionId);
}
