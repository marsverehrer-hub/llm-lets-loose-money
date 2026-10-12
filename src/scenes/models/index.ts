// Model vault scene: the player's models as server-core monoliths on pedestals, with a construction bay and
// the best rival model across a rope line. Mounted by the panel through createScene() and the CAM label.
//
// Hit ids (SceneHit.id):
//   model:<id>  a model on the grid (the newest 12). Tip: name, params, overall, Elo if released, status.
//   training    the construction bay. Tip: run name, kind, params, progress, decisions or stalls.
//   rival       the best rival model across the rope. Tip: lab name, model, overall, Elo, release date.
//   shelf       the storage shelf of older models (x N). Tip: count and deprecated count.
import type { Scene } from '../types';
import { ModelsScene } from './ModelsScene';

export const CAM = 'Model vault';

export function createScene(): Scene {
  return new ModelsScene();
}
