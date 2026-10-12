// Products scene (v11): the player's live products as isometric storefronts on one street.
// Chat is a consumer app store kiosk with a queue. API is a developer terminal booth with cables to racks.
// Enterprise is a corporate tower lobby with suits arriving by car. Locked kinds are "coming soon" lots and unlocked
// kinds without a product are empty lots. Serving pipes run from each till to the datacenter hall at the back.
//
// SceneHit ids:
//   product:<id>  a live product's storefront. Tip: name, model, users, price, revenue/day, serving cost/day, margin/day,
//                 satisfaction (happy, mixed or grumpy), and an OUTAGE line while servedFraction < 1.
//   lot:<kind>    an empty lot for a kind: "chat" | "api" | "enterprise". Locked lots name the research that unlocks them.
//                 A second empty lot of a kind shares the id and says it is the second line.
//
// Usage: <SceneView state={s} make={createScene} cam={CAM} label="Storefronts" onSelect={...} />
import type { Scene } from '../types';
import { ProductsScene } from './scene';

export const CAM = 'Storefronts';

export function createScene(): Scene {
  return new ProductsScene();
}
