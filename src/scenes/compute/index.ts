// v11 compute scene: the player's compute as an isometric datacenter (camera "Datacenter").
//
// Hit ids (SceneHit.id):
//   dc:<datacenter id>  one hall per datacenter. Finished halls show racks: amber LEDs are training, blue are serving,
//                       dark are idle. Tip: GPUs in the hall and its slots, GPU models, PFLOP/s, the fleet's
//                       training/serving/idle mix applied to the hall, upkeep and power per day. Halls still under
//                       construction show scaffolding and days left, with an upkeep line in the tip.
//   cloud:rented        the floating cloud rental platform (only while GPUs are rented). Tip: rented GPUs by model,
//                       PFLOP/s, rent per day.
//   cloud:burst         the dashed cloud above the platform (only while cloud burst serves products). Tip: burst
//                       PFLOP/s, cost per day and the price per PFLOP/s-day.
//   training            the amber training pod (only while a run is active). Tip: run name, progress, GPUs, PFLOP/s.
import type { Scene } from '../types';
import { ComputeScene } from './scene';

export const CAM = 'Datacenter';

export function createScene(): Scene {
  return new ComputeScene();
}
