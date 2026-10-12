// Marketing scene: an isometric city block at street level ("Downtown" camera), in the HQ office style.
// Everything is read from the live GameState each frame. Static geometry is built once in the constructor.
//
// SceneHit ids:
//   campaign:<defId>      a running campaign on a billboard, bus, blimp or stadium screen (tip: days left, cost, per-day gains)
//   brand                 a storefront or a house-ad screen that shows your company (tip: brand, how many show it)
//   hype                  the street crowd on the sidewalk and plaza (tip: hype, crowd size, AI hype cycle)
//   rival:<competitorId>  a rival lab's ad on a free screen (tip: name, latest model, brand)
//   team                  the marketing team office (tip: staff, campaigns live)
import type { Scene } from '../types';
import { MarketingScene } from './MarketingScene';

export const CAM = 'Downtown';

export function createScene(): Scene {
  return new MarketingScene();
}
