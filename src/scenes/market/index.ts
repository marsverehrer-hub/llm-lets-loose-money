// Market scene: the AI market as an isometric town (Consumers, Developers, Enterprise districts), with a lab HQ tower
// per lab on the rim and the sky set by AI hype.
//
// SceneHit ids:
//   segment:consumer | segment:developer | segment:enterprise
//       A district's ground, or a lot with no lab serving it yet. Tip: market size, your share, the leader.
//   lab:<competitor id>   e.g. lab:deepmined, lab:openaye
//       A lab's HQ tower or a building in its territory. Tip: Arena Elo and place, users, share in that district
//       (or valuation on the HQ).
//   lab:player
//       Your HQ tower or your buildings (you are drawn in the text colour, as in the Market panel).
//   hype
//       Anything else, i.e. the sky. Tip: AI hype and its mood.
import type { Scene } from '../types';
import { MarketScene } from './scene';

export const CAM = 'Market';

export function createScene(): Scene {
  return new MarketScene();
}
