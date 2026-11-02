// v11 compute scene: the player's compute as an isometric datacenter (camera "Datacenter"). v18: every hall, the
// training cluster, the cloud and the product edge stand on their own slab, fitted to the frame (see ../kit.ts).
//
// Hit ids (SceneHit.id):
//   dc:<datacenter id>  one hall per datacenter. Finished halls show rows of racks: yellow LEDs are training, green
//                       serving, dim idle (purple: leased to neocloud customers). Liquid-cooled halls have CDUs and a
//                       teal coolant main instead of CRAH fans and hot aisles; InfiniBand halls show orange fibre.
//                       Tip: GPUs in the hall and its slots, GPU models, PFLOP/s, the fleet's training/serving/idle
//                       mix applied to the hall, upkeep and power per day. Halls still under
//                       construction show scaffolding and days left, with an upkeep line in the tip.
//   cloud:rented        the floating cloud rental platform (only while GPUs are rented). Tip: rented GPUs by model,
//                       PFLOP/s, rent per day.
//   cloud:burst         the dashed cloud above the platform (only while cloud burst serves products). Tip: burst
//                       PFLOP/s, cost per day and the price per PFLOP/s-day.
//   training            the yellow training cluster (only while a run is active). Tip: run name, progress, GPUs, PFLOP/s.
import type { Scene } from '../types';
import { ComputeScene } from './scene';

export const CAM = 'Datacenter';

export function createScene(): Scene {
  return new ComputeScene();
}
