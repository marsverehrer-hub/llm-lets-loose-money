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
  { id: 'p100', memGB: 16, name: 'NVidiot P100', unlockYear: 2017, pflops: 0.012, buyPrice: 9_000, rentPerDay: 30, powerKw: 0.3, flavor: 'It can render Doom. Mostly.', formats: [] },
  { id: 'gtx1080', memGB: 11, name: 'NVidiot GTX 1080 Tie', unlockYear: 2017, pflops: 0.006, buyPrice: 4_500, rentPerDay: 15, powerKw: 0.25, flavor: 'A gaming card in a lab coat. Loud, cheap, and short on memory.', formats: [] },
  { id: 'k80', memGB: 24, name: 'NVidiot K80', unlockYear: 2017, pflops: 0.004, buyPrice: 3_600, rentPerDay: 12, powerKw: 0.3, flavor: 'Two GPUs glued together in 2014. The glue is the fastest part.', formats: [], class: 'datacenter' },
  { id: 'p40', memGB: 24, name: 'NVidiot P40', unlockYear: 2017, pflops: 0.01, buyPrice: 8_400, rentPerDay: 28, powerKw: 0.25, flavor: 'Built for inference before anyone knew what to infer.', formats: [], class: 'datacenter' },
  { id: 'v1000', memGB: 32, name: 'NVidiot V100', unlockYear: 2018, pflops: 0.03, buyPrice: 16_500, rentPerDay: 55, powerKw: 0.3, flavor: '40% more tensor cores, 0% more fan noise.', formats: [] },
  { id: 'titanv', memGB: 12, name: 'NVidiot Titan V', unlockYear: 2018, pflops: 0.025, buyPrice: 15_000, rentPerDay: 50, powerKw: 0.25, flavor: 'A workstation card with a supercomputer\'s price and a gamer\'s cooling.', formats: [], class: 'workstation' },
  { id: 't4', memGB: 16, name: 'NVidiot T4', unlockYear: 2019, pflops: 0.02, buyPrice: 9_000, rentPerDay: 30, powerKw: 0.07, flavor: 'Sips seventy watts and apologises for it. Built for serving, not for heroics.', formats: [] },
  { id: 'v100s', memGB: 32, name: 'NVidiot V100S 32GB', unlockYear: 2019, pflops: 0.032, buyPrice: 18_600, rentPerDay: 62, powerKw: 0.25, flavor: 'The V100 with the S for "still".', formats: [], class: 'datacenter' },
  { id: 'mi50', memGB: 32, name: 'AMDeez MI50', unlockYear: 2019, pflops: 0.022, buyPrice: 13_500, rentPerDay: 45, powerKw: 0.3, flavor: 'Fast on paper. The paper has a compiler error.', formats: [], class: 'datacenter' },
  { id: 'tpu3', memGB: 32, name: 'Googol TPU v3', unlockYear: 2019, pflops: 0.035, buyPrice: 21_000, rentPerDay: 70, powerKw: 0.45, flavor: 'Only rentable from the company that made it, which also reads your logs.', formats: [], class: 'datacenter' },
  { id: 'a100', memGB: 80, name: 'NVidiot A100 80GB', unlockYear: 2020, pflops: 0.09, buyPrice: 27_000, rentPerDay: 90, powerKw: 0.4, flavor: 'The one everyone quietly rented in 2020.', formats: ['bf16'] },
  { id: 'rtx30', memGB: 24, name: 'NVidiot RTX 3090', unlockYear: 2020, pflops: 0.012, buyPrice: 3_900, rentPerDay: 13, powerKw: 0.45, flavor: 'Runs every game and one small model, very slowly, with fans you can hear from the next building.', formats: [], class: 'consumer' },
  { id: 'mi100', memGB: 32, name: 'AMDeez MI100', unlockYear: 2020, pflops: 0.06, buyPrice: 21_000, rentPerDay: 70, powerKw: 0.3, flavor: 'No graphics output, which it describes as focus.', formats: [], class: 'datacenter' },
  { id: 'mi250', memGB: 128, name: 'AMDeez MI250X', unlockYear: 2021, pflops: 0.07, buyPrice: 18_000, rentPerDay: 60, powerKw: 0.5, flavor: 'Twice the memory, half the software. The drivers are a choose-your-own-adventure.', formats: ['bf16'] },
  { id: 'a6000', memGB: 48, name: 'NVidiot RTX A6000', unlockYear: 2021, pflops: 0.035, buyPrice: 10_500, rentPerDay: 35, powerKw: 0.3, flavor: 'Quiet and dependable, and sold to everyone who was told the datacenter card was sold out.', formats: ['bf16'], class: 'workstation' },
  { id: 'a30', memGB: 24, name: 'NVidiot A30', unlockYear: 2021, pflops: 0.06, buyPrice: 19_800, rentPerDay: 66, powerKw: 0.165, flavor: 'An A100 that took the train instead of flying.', formats: ['bf16'], class: 'datacenter' },
  { id: 'a10', memGB: 24, name: 'NVidiot A10', unlockYear: 2021, pflops: 0.03, buyPrice: 10_800, rentPerDay: 36, powerKw: 0.15, flavor: 'Serves a chatbot to a mid-sized city, politely.', formats: ['bf16'], class: 'datacenter' },
  { id: 'tpu4', memGB: 32, name: 'Googol TPU v4', unlockYear: 2021, pflops: 0.08, buyPrice: 27_000, rentPerDay: 90, powerKw: 0.2, flavor: 'Arrives in pods of four thousand. You may not take one home.', formats: ['bf16'], class: 'datacenter' },
  { id: 'h100', memGB: 80, name: 'NVidiot H100', unlockYear: 2022, pflops: 0.3, buyPrice: 60_000, rentPerDay: 200, powerKw: 0.7, flavor: 'Sold out until 2027. Also sold out in 2026.', formats: ['bf16', 'fp8'] },
  { id: 'rtx40', memGB: 24, name: 'NVidiot RTX 4090', unlockYear: 2022, pflops: 0.02, buyPrice: 4_500, rentPerDay: 15, powerKw: 0.45, flavor: 'Frame generation is now a training technique. Nobody has checked.', formats: ['bf16'], class: 'consumer' },
  { id: 'a800', memGB: 80, name: 'NVidiot A800', unlockYear: 2022, pflops: 0.085, buyPrice: 28_500, rentPerDay: 95, powerKw: 0.4, flavor: 'An A100 with its interconnect politely trimmed for export.', formats: ['bf16'], class: 'datacenter' },
  { id: 'ascend', memGB: 64, name: 'Huawhey Ascend 910B', unlockYear: 2023, pflops: 0.2, buyPrice: 33_000, rentPerDay: 110, powerKw: 0.4, flavor: 'Made at home. Available exactly where the other one is not.', formats: ['bf16'] },
  { id: 'mi300', memGB: 192, name: 'AMDeez MI300X', unlockYear: 2023, pflops: 0.28, buyPrice: 51_000, rentPerDay: 170, powerKw: 0.75, flavor: 'More memory than anything else on sale, for less. You will write some kernels yourself.', formats: ['bf16', 'fp8'] },
  { id: 'h200', memGB: 141, name: 'NVidiot H200', unlockYear: 2023, pflops: 0.33, buyPrice: 72_000, rentPerDay: 240, powerKw: 0.7, flavor: 'An H-1OO that went to the memory gym.', formats: ['bf16', 'fp8'] },
  { id: 'mi210i', memGB: 64, name: 'AMDeez MI210', unlockYear: 2023, pflops: 0.12, buyPrice: 21_000, rentPerDay: 70, powerKw: 0.4, flavor: 'Cheap per FLOP. The FLOPs arrive with a driver that needs its own driver.', formats: ['bf16'], class: 'datacenter' },
  { id: 'h800', memGB: 80, name: 'NVidiot H800', unlockYear: 2023, pflops: 0.27, buyPrice: 57_000, rentPerDay: 190, powerKw: 0.7, flavor: 'An H100 that passed customs by slowing down its handshake.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'l40s', memGB: 48, name: 'NVidiot L40S', unlockYear: 2023, pflops: 0.18, buyPrice: 34_500, rentPerDay: 115, powerKw: 0.35, flavor: 'Half graphics card, half AI card, fully back-ordered.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'l4', memGB: 24, name: 'NVidiot L4', unlockYear: 2023, pflops: 0.06, buyPrice: 13_500, rentPerDay: 45, powerKw: 0.072, flavor: 'Seventy-two watts. The serving bill thanks you.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'tpu5e', memGB: 16, name: 'Googol TPU v5e', unlockYear: 2023, pflops: 0.2, buyPrice: 36_000, rentPerDay: 120, powerKw: 0.25, flavor: 'The e stands for efficient, or for the email asking you to commit to three years.', formats: ['bf16'], class: 'datacenter' },
  { id: 'gaudy2', memGB: 96, name: 'Intell Gaudy 2', unlockYear: 2023, pflops: 0.2, buyPrice: 37_500, rentPerDay: 125, powerKw: 0.6, flavor: 'Benchmarks beautifully against the card it is not compared with.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'b200', memGB: 192, name: 'NVidiot B200', unlockYear: 2024, pflops: 0.7, buyPrice: 105_000, rentPerDay: 350, powerKw: 1.0, flavor: 'Heats the office. Doubles as a space heater.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'gaudy3', memGB: 128, name: 'Intell Gaudy 3', unlockYear: 2024, pflops: 0.4, buyPrice: 60_000, rentPerDay: 200, powerKw: 0.9, flavor: 'Great price per FLOP, if you can find the FLOPs.', formats: ['bf16', 'fp8'] },
  { id: 'h20', memGB: 96, name: 'NVidiot H20', unlockYear: 2024, pflops: 0.15, buyPrice: 30_000, rentPerDay: 100, powerKw: 0.4, flavor: 'The legal-to-sell-everywhere edition: lots of memory, fewer FLOPs, one lawyer.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'gh200', memGB: 144, name: 'NVidiot GH200', unlockYear: 2024, pflops: 0.35, buyPrice: 69_000, rentPerDay: 230, powerKw: 0.9, flavor: 'A GPU and a CPU sharing one memory and two opinions.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'mi325', memGB: 256, name: 'AMDeez MI325X', unlockYear: 2024, pflops: 0.32, buyPrice: 54_000, rentPerDay: 180, powerKw: 0.75, flavor: 'More memory than your model. Possibly more than your company.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'tpu5p', memGB: 95, name: 'Googol TPU v5p', unlockYear: 2024, pflops: 0.46, buyPrice: 78_000, rentPerDay: 260, powerKw: 0.6, flavor: 'The p stands for performance, and for the price.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'trn2', memGB: 96, name: 'Amazin Trainium 2', unlockYear: 2024, pflops: 0.33, buyPrice: 57_000, rentPerDay: 190, powerKw: 0.5, flavor: 'A bookshop\'s chip. Ships in two days, trains in two months.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'b300', memGB: 288, name: 'NVidiot B300 Ultra', unlockYear: 2025, pflops: 1.0, buyPrice: 135_000, rentPerDay: 450, powerKw: 1.2, flavor: 'A B-2OO with more of everything, including the electricity bill.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'rtx50', memGB: 32, name: 'NVidiot RTX 5090', unlockYear: 2025, pflops: 0.035, buyPrice: 6_000, rentPerDay: 20, powerKw: 0.575, flavor: 'Thirty-two gigabytes: enough for the model, not for the spreadsheet about the model.', formats: ['bf16', 'fp8'], class: 'consumer' },
  { id: 'gaudy_lite', memGB: 96, name: 'Intell Gaudy 3E', unlockYear: 2025, pflops: 0.22, buyPrice: 33_000, rentPerDay: 110, powerKw: 0.6, flavor: 'The budget Gaudy. Budget in the sense that the invoice is shorter.', formats: ['bf16'], class: 'datacenter' },
  { id: 'rtx6000', memGB: 96, name: 'NVidiot RTX Pro 6000', unlockYear: 2025, pflops: 0.09, buyPrice: 18_000, rentPerDay: 60, powerKw: 0.6, flavor: 'For people who own a workstation, a deadline, and a second deadline.', formats: ['bf16', 'fp8'], class: 'workstation' },
  { id: 'm4ultra', memGB: 192, name: 'Fruit Studio M4 Ultra', unlockYear: 2025, pflops: 0.008, buyPrice: 6_000, rentPerDay: 20, powerKw: 0.27, flavor: '192 GB of unified memory on a desk. Runs a 70B model and a podcast at the same time.', formats: ['bf16'], class: 'workstation' },
  { id: 'spark', memGB: 128, name: 'NVidiot DGX Spark', unlockYear: 2025, pflops: 0.01, buyPrice: 4_500, rentPerDay: 15, powerKw: 0.17, flavor: 'A supercomputer the size of a sandwich, priced like several sandwich shops.', formats: ['bf16', 'fp8', 'fp4'], class: 'workstation' },
  { id: 'gb200', memGB: 192, name: 'NVidiot GB200', unlockYear: 2025, pflops: 0.9, buyPrice: 126_000, rentPerDay: 420, powerKw: 1.2, flavor: 'Two B200s and a CPU in a rack the weight of a small car.', formats: ['bf16', 'fp8', 'fp4'], class: 'datacenter' },
  { id: 'mi355', memGB: 288, name: 'AMDeez MI355X', unlockYear: 2025, pflops: 0.9, buyPrice: 129_000, rentPerDay: 430, powerKw: 1.4, flavor: 'Finally faster than the card it was announced against last year.', formats: ['bf16', 'fp8', 'fp4'], class: 'datacenter' },
  { id: 'tpu6', memGB: 32, name: 'Googol TPU v6', unlockYear: 2025, pflops: 0.6, buyPrice: 87_000, rentPerDay: 290, powerKw: 0.6, flavor: 'Codenamed after a flower. Priced after a bouquet.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'mi400', memGB: 432, name: 'AMDeez MI400', unlockYear: 2026, pflops: 1.4, buyPrice: 144_000, rentPerDay: 480, powerKw: 1.4, flavor: 'Finally, a software stack. It is mostly a compatibility layer for the other one.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'r300', memGB: 288, name: 'NVidiot Rubin', unlockYear: 2026, pflops: 1.6, buyPrice: 180_000, rentPerDay: 600, powerKw: 1.4, flavor: 'Comes with a 4-page liquid cooling manual.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'tpu7', memGB: 192, name: 'Googol TPU v7', unlockYear: 2026, pflops: 1.3, buyPrice: 150_000, rentPerDay: 500, powerKw: 1.0, flavor: 'Built for inference, which is now most of the bill.', formats: ['bf16', 'fp8', 'fp4'], class: 'datacenter' },
  { id: 'ascend950', memGB: 128, name: 'Huawhey Ascend 950', unlockYear: 2026, pflops: 1.0, buyPrice: 120_000, rentPerDay: 400, powerKw: 1.0, flavor: 'Made with tools nobody would sell them. Works anyway.', formats: ['bf16', 'fp8'], class: 'datacenter' },
  { id: 'r300u', memGB: 576, name: 'NVidiot Rubin Ultra', unlockYear: 2027, pflops: 2.6, buyPrice: 255_000, rentPerDay: 850, powerKw: 1.8, flavor: 'Four dies, one rack, and a cooling loop with its own maintenance team.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'mi450', memGB: 432, name: 'AMDeez MI450', unlockYear: 2027, pflops: 2.0, buyPrice: 210_000, rentPerDay: 700, powerKw: 1.6, flavor: 'Rack-scale at last. The rack has opinions about your power supply.', formats: ['bf16', 'fp8', 'fp4'], class: 'datacenter' },
  { id: 'f500', memGB: 432, name: 'NVidiot Feynman', unlockYear: 2028, pflops: 4, buyPrice: 300_000, rentPerDay: 1_000, powerKw: 1.8, flavor: 'Named after a physicist. Nobody asked his opinion.', formats: ['bf16', 'fp8', 'fp4'] },
  { id: 'f500u', memGB: 576, name: 'NVidiot Feynman Ultra', unlockYear: 2029, pflops: 6, buyPrice: 465_000, rentPerDay: 1_550, powerKw: 2.2, flavor: 'The keynote called it a new era. The invoice agreed.', formats: ['bf16', 'fp8', 'fp4'], class: 'datacenter' },
  { id: 'h1000', memGB: 768, name: 'NVidiot H1000 Hypernova', unlockYear: 2031, pflops: 12, buyPrice: 600_000, rentPerDay: 2_000, powerKw: 2.5, flavor: 'Needs its own zip code and a small utility company.', formats: ['bf16', 'fp8', 'fp4'] },
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
