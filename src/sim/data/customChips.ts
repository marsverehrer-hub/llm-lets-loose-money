// v19: the custom chips your silicon programme can produce (class 'custom', never sold by vendors). Package D4.
// buyPrice is the unit cost before yield: the price you pay is buyPrice / yieldRate (systems/chipRnd.ts customChipPrice).
// Each one costs about 40% of the vendor card of its era, which is why you build them at all. unlockYear is far away;
// the programme's tape-out and fab are what make them buyable.
// rentPerDay keeps the v14 rule buyPrice = 300 x rentPerDay (tests/production.test.ts and tests/hardware.test.ts pin it).
// It is not 0: cloudMarket.rentFromProvider does not check availability, so a zero rent would be free compute.
// shortcut: cloud rental of custom chips is priced, not refused; refuse it in cloudMarket once that file is free.
import type { GpuDef } from '../types';

export const CUSTOM_CHIPS: GpuDef[] = [
  {
    id: 'lll_inferentia_1',
    name: 'LLL Inferentia-ish 1',
    unlockYear: 9999,
    class: 'custom',
    pflops: 0.6,            // B-2OO-class speed at about 40% of the price: good per dollar, for serving
    buyPrice: 42_000,
    rentPerDay: 140,
    powerKw: 0.5,
    memGB: 64,
    formats: ['bf16', 'fp8'],
    flavor: 'Built to serve answers, not to dream them up. Your own customers will call it "the cheap one" in meetings.',
  },
  {
    id: 'lll_trainium_2',
    name: 'LLL Trainium-ish 2',
    unlockYear: 9999,
    class: 'custom',
    pflops: 1.1,            // B-3OO-class speed, at about 40% of the price
    buyPrice: 54_000,
    rentPerDay: 180,
    powerKw: 1.1,
    memGB: 128,
    formats: ['bf16', 'fp8'],
    flavor: 'Trains models the way your team always wanted to. The compiler is still on its first coffee.',
  },
  {
    id: 'lll_wafer_3',
    name: 'LLL Wafer 3',
    unlockYear: 9999,
    class: 'custom',
    pflops: 2.0,            // R-3OO-class speed, at about 40% of the price
    buyPrice: 72_000,
    rentPerDay: 240,
    powerKw: 1.5,
    memGB: 256,
    formats: ['bf16', 'fp8', 'fp4'],
    flavor: 'One wafer, one board, one very expensive reason to hire a cooling engineer.',
  },
];
