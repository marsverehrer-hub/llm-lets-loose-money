// Research lab scene (camera "Research lab").
//
// Hit ids (SceneHit.id):
//   branch:<branch id>  one desk pod per research branch (architecture, scaling, infra, data, posttraining, reasoning,
//                       agents, multimodal, inference, safety, product). Tip: done/total topics, what is being researched
//                       there, queued topics, and the researchers seated at that pod.
//   current             the projector: the topic being researched, its progress, RP/day and ETA. Tip says "No topic
//                       running" when idle.
//   queue               the "next up" board: queued topics in order.
//   stars               the star bay: hired star researchers.
//
// Usage: createScene() once, then SceneView draws it with the live GameState and calls hitTest for tips and clicks.
import type { Scene } from '../types';
import { ResearchScene } from './scene';

export const CAM = 'Research lab';

export function createScene(): Scene {
  return new ResearchScene();
}
