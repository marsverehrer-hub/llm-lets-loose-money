import type { GpuDef, DatacenterTier, HwFormat } from '../types';
import { CUSTOM_CHIPS } from './customChips';

/** Hardware number formats a GPU runs natively. Other formats are emulated at the bf16/fp16 speed (systems/scaleLimits.ts). */
export type { HwFormat } from '../types';
/** A GPU with its native formats (a GpuDef field once types.ts carries it). */
/** The contract's GpuDef already carries `formats` (v18); kept as an alias for existing imports. */
export type GpuSpec = GpuDef;

/** Speed of each precision on hardware that runs it natively (the fp32 baseline is 1). Emulated formats run slower. */
export const PRECISION_SPEED = { fp16: 1.7, bf16: 1.8, fp8: 2.6, fp4: 3.6 } as const;

/** Native formats of a GPU; a GPU without a list gets them by release year. */
export function gpuFormats(g: GpuSpec): HwFormat[] {
  if (g.formats) return g.formats;
  if (g.unlockYear < 2020) return [];
  if (g.unlockYear < 2022) return ['bf16'];
  if (g.unlockYear < 2024) return ['bf16', 'fp8'];
  return ['bf16', 'fp8', 'fp4'];
}
// OWNER: Agent A. Parody GPUs 2017 -> 2034: Nvidiot's flagship line, its refreshes and budget cards, plus rival vendors
// (AMDeez, Gaudy, Ascend-ish) that trade software pain for price and memory. Kept in unlock order.
// Order matters: the first GPU unlocked in 2017 is the starter fleet (see state.ts).
// pflops are effective PFLOP/s per GPU (MFU already folded in).
// v14 (GAME_DESIGN §24): buyPrice is 300 days of rent for every generation. With power, cooling, hardware ops and
// wear (systems/compute.ts) a purchase pays itself back in about a year, as §1 always intended. Before v14 the ratio
// slid from 300 days (2017) to 50 days (2034), so late-game hardware paid for itself in weeks and then ran for free.
// memGB (v16) is HBM per GPU: it caps how big a model a cluster can hold (systems/scaleLimits.ts).
export const GPUS: GpuSpec[] = [
  { id: 'p100', memGB: 16, name: 'Pascal P-100ish', unlockYear: 2017, pflops: 0.012, buyPrice: 9_000, rentPerDay: 30, powerKw: 0.3, flavor: 'It can render Doom. Mostly.', formats: [] },
  { id: 'gtx1080', memGB: 11, name: 'GeForce 1O80 Tie', unlockYear: 2017, pflops: 0.006, buyPrice: 4_500, rentPerDay: 15, powerKw: 0.25, flavor: 'A gaming card in a lab coat. Loud, cheap, and short on memory.', formats: [] },
  { id: 'v1000', memGB: 32, name: 'Volta V-1000', unlockYear: 2018, pflops: 0.03, buyPrice: 16_500, rentPerDay: 55, powerKw: 0.3, flavor: '40% more tensor cores, 0% more fan noise.', formats: [] },
  { id: 't4', memGB: 16, name: 'Turing T-4ish', unlockYear: 2019, pflops: 0.02, buyPrice: 9_000, rentPerDay: 30, powerKw: 0.07, flavor: 'Sips seventy watts and apologises for it. Built for serving, not for heroics.', formats: [] },
  { id: 'a100', memGB: 80, name: 'Ampere A-1OO', unlockYear: 2020, pflops: 0.09, buyPrice: 27_000, rentPerDay: 90, powerKw: 0.4, flavor: 'The one everyone quietly rented in 2020.', formats: ['bf16'] },
  { id: 'rtx30', memGB: 24, name: 'RTX 30-ish 24GB', unlockYear: 2020, pflops: 0.012, buyPrice: 3_900, rentPerDay: 13, powerKw: 0.45, flavor: 'Runs every game and one small model, very slowly, with fans you can hear from the next building.', formats: [], class: 'consumer' },
  { id: 'mi250', memGB: 128, name: 'AMDeez MI-250X', unlockYear: 2021, pflops: 0.07, buyPrice: 18_000, rentPerDay: 60, powerKw: 0.5, flavor: 'Twice the memory, half the software. The drivers are a choose-your-own-adventure.', formats: ['bf16'] },
  { id: 'a6000', memGB: 48, name: 'A6000-ish 48GB', unlockYear: 2021, pflops: 0.035, buyPrice: 10_500, rentPerDay: 35, powerKw: 0.3, flavor: 'Quiet and dependable, and sold to everyone who was told the datacenter card was sold out.', formats: ['bf16'], class: 'workstation' },
  { id: 'h100', memGB: 80, name: 'Hopper H-1OO', unlockYear: 2022, pflops: 0.3, buyPrice: 60_000, rentPerDay: 200, powerKw: 0.7, flavor: 'Sold out until 2027. Also sold out in 2026.', formats: ['bf16', 'fp8'] },
  { id: 'rtx40', memGB: 24, name: 'RTX 40-ish 24GB', unlockYear: 2022, pflops: 0.02, buyPrice: 4_500, rentPerDay: 15, powerKw: 0.45, flavor: 'Frame generation is now a training technique. Nobody has checked.', formats: ['bf16'], class: 'consumer' },
  { id: 'ascend', memGB: 64, name: 'Ascend-ish 910B', unlockYear: 2023, pflops: 0.2, buyPrice: 33_000, rentPerDay: 110, powerKw: 0.4, flavor: 'Made at home. Available exactly where the other one is not.', formats: ['bf16'] },
  { id: 'mi300', memGB: 192, name: 'AMDeez MI-300X', unlockYear: 2023, pflops: 0.28, buyPrice: 51_000, rentPerDay: 170, powerKw: 0.75, flavor: 'More memory than anything else on sale, for less. You will write some kernels yourself.', formats: ['bf16', 'fp8'] },
  { id: 'h200', memGB: 141, name: 'Hopper H-2OO', unlockYear: 2023, pflops: 0.33, buyPrice: 72_000, rentPerDay: 240, powerKw: 0.7, flavor: 'An H-1OO that went to the memory gym.', formats: ['bf16', 'fp8'] },
  { id: 'mi210i', memGB: 64, name: 'AMDeez MI-210 Inference', unlockYear: 2023, pflops: 0.12, buyPrice: 21_000, rentPerDay: 70, powerKw: 0.4, flavor: 'Cheap per FLOP. The FLOPs arrive with a driver that needs its own driver.', formats: ['bf16'], class: 'datacenter' },
  { id: 'b200', memGB: 192, name: 'Blackwell B-2OO', unlockYear: 2024, pflops: 0.7, buyPrice: 105_000, rentPerDay: 350, powerKw: 1.0, flavor: 'Heats the office. Doubles as a space heater.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'gaudy3', memGB: 128, name: 'Gaudy 3', unlockYear: 2024, pflops: 0.4, buyPrice: 60_000, rentPerDay: 200, powerKw: 0.9, flavor: 'Great price per FLOP, if you can find the FLOPs.', formats: ['bf16', 'fp8'] },
  { id: 'b300', memGB: 288, name: 'Blackwell Ultra B-3OO', unlockYear: 2025, pflops: 1.0, buyPrice: 135_000, rentPerDay: 450, powerKw: 1.2, flavor: 'A B-2OO with more of everything, including the electricity bill.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'rtx50', memGB: 32, name: 'RTX 50-ish 32GB', unlockYear: 2025, pflops: 0.035, buyPrice: 6_000, rentPerDay: 20, powerKw: 0.575, flavor: 'Thirty-two gigabytes: enough for the model, not for the spreadsheet about the model.', formats: ['bf16', 'fp8'], class: 'consumer' },
  { id: 'gaudy_lite', memGB: 96, name: 'Gaudy Lite 2', unlockYear: 2025, pflops: 0.22, buyPrice: 33_000, rentPerDay: 110, powerKw: 0.6, flavor: 'The budget Gaudy. Budget in the sense that the invoice is shorter.', formats: ['bf16'], class: 'datacenter' },
  { id: 'rtx6000', memGB: 96, name: 'RTX 6000-ish 96GB', unlockYear: 2025, pflops: 0.09, buyPrice: 18_000, rentPerDay: 60, powerKw: 0.6, flavor: 'For people who own a workstation, a deadline, and a second deadline.', formats: ['bf16', 'fp8'], class: 'workstation' },
  { id: 'mi400', memGB: 432, name: 'AMDeez MI-400', unlockYear: 2026, pflops: 1.4, buyPrice: 144_000, rentPerDay: 480, powerKw: 1.4, flavor: 'Finally, a software stack. It is mostly a compatibility layer for the other one.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'r300', memGB: 288, name: 'Rubin R-3OO', unlockYear: 2026, pflops: 1.6, buyPrice: 180_000, rentPerDay: 600, powerKw: 1.4, flavor: 'Comes with a 4-page liquid cooling manual.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'r300u', memGB: 576, name: 'Rubin Ultra R-3OO-U', unlockYear: 2027, pflops: 2.6, buyPrice: 255_000, rentPerDay: 850, powerKw: 1.8, flavor: 'Four dies, one rack, and a cooling loop with its own maintenance team.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'f500', memGB: 432, name: 'Feynman F-5OO', unlockYear: 2028, pflops: 4, buyPrice: 300_000, rentPerDay: 1_000, powerKw: 1.8, flavor: 'Named after a physicist. Nobody asked his opinion.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'h1000', memGB: 768, name: 'H1000 Hypernova', unlockYear: 2031, pflops: 12, buyPrice: 600_000, rentPerDay: 2_000, powerKw: 2.5, flavor: 'Needs its own zip code and a small utility company.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'd1', memGB: 1536, name: 'Dyson D-1', unlockYear: 2034, pflops: 40, buyPrice: 1_200_000, rentPerDay: 4_000, powerKw: 3.5, flavor: 'Surrounds the star. Lowers the electricity bill for everyone else.', formats: ['bf16', 'fp8', 'fp4'] },
];
// v19: your own silicon joins the list (class 'custom', unlockYear far away; compute.ts gates it on the programme).
GPUS.push(...CUSTOM_CHIPS);

/** v19 D2: consumer and workstation cards sell over the counter, outside the vendor's datacenter allocation. */
export function allocationExempt(g: GpuSpec): boolean {
  return g.class === 'consumer' || g.class === 'workstation';
}

// Datacenter tiers. Power is billed per GPU kW; upkeep is a fixed daily cost once the building is online.
export const DATACENTER_TIERS: DatacenterTier[] = [
  {
    id: 'closet',
    name: 'Server Closet',
    maxGpus: 64,
    buildCost: 60_000,
    buildDays: 10,
    upkeepPerDay: 100,
    powerPricePerKwh: 0.12,
    unlockYear: 2017,
    flavor: 'A converted supply closet. The mop now has a fan.',
  },
  {
    id: 'colo',
    name: 'Colo Cage',
    maxGpus: 512,
    buildCost: 2_000_000,
    buildDays: 45,
    upkeepPerDay: 1_500,
    powerPricePerKwh: 0.1,
    unlockYear: 2018,
    flavor: 'A cage in someone else\'s building. They have opinions about your fans.',
  },
  {
    id: 'hyperscale',
    name: 'Hyperscale Campus',
    maxGpus: 8_192,
    buildCost: 80_000_000,
    buildDays: 180,
    upkeepPerDay: 40_000,
    powerPricePerKwh: 0.07,
    unlockYear: 2021,
    flavor: 'Forty buildings, one logo, and a cafeteria that is somehow the main cost.',
  },
  {
    id: 'cathedral',
    name: 'Gigawatt Cathedral',
    maxGpus: 131_072,
    buildCost: 3_000_000_000,
    buildDays: 365,
    upkeepPerDay: 600_000,
    powerPricePerKwh: 0.05,
    unlockYear: 2027,
    requiresResearch: 'nuclear_power',
    flavor: 'Visible from orbit. Investors ask if it is visible from the SEC.',
  },
];
