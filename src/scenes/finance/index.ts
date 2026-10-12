// Finance scene: the company's money as an isometric treasury room (src/scenes/types.ts is the contract).
//
// SceneHit ids and what they mean:
//   cash           the vault (gold bars and cash stacks, log scale, x N when huge). Negative cash: an empty, locked
//                  vault with red lights, and the debt collector at the door.
//   revenue        the revenue belt that runs in from the left wall into the vault (s.finance.dailyRevenue).
//   expense:<key>  one labelled chute per expenseBreakdown key (payroll, compute, serving, power, office...),
//                  sized by its share of today's expenses.
//   investors      the investors' table in the back corner, one seat per round raised (s.finance.roundsRaised).
//   offer          the investor at the door waving a pending term sheet (s.finance.pendingOffer).
//   stock          the stock ticker on the back wall: "private" before the IPO, then price and a mini chart.
//   debt           the chained safe (s.finance.debt). Open and empty once the debt is cleared.
import type { Scene } from '../types';
import { TreasuryScene } from './scene';

export const CAM = 'Treasury';

export function createScene(): Scene {
  return new TreasuryScene();
}
