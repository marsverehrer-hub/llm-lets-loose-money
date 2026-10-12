import type { GpuDef, DatacenterTier } from '../types';
// OWNER: Agent A. Parody GPU generations 2017 -> 2034. Sold by "Nvidiot".
// Order matters: the first GPU unlocked in 2017 is the starter fleet (see state.ts).
// pflops are effective PFLOP/s per GPU (MFU already folded in).
export const GPUS: GpuDef[] = [
  { id: 'p100', name: 'Pascal P-100ish', unlockYear: 2017, pflops: 0.012, buyPrice: 9_000, rentPerDay: 30, powerKw: 0.3, flavor: 'It can render Doom. Mostly.' },
  { id: 'v1000', name: 'Volta V-1000', unlockYear: 2018, pflops: 0.03, buyPrice: 11_000, rentPerDay: 55, powerKw: 0.3, flavor: '40% more tensor cores, 0% more fan noise.' },
  { id: 'a100', name: 'Ampere A-1OO', unlockYear: 2020, pflops: 0.09, buyPrice: 15_000, rentPerDay: 90, powerKw: 0.4, flavor: 'The one everyone quietly rented in 2020.' },
  { id: 'h100', name: 'Hopper H-1OO', unlockYear: 2022, pflops: 0.3, buyPrice: 30_000, rentPerDay: 200, powerKw: 0.7, flavor: 'Sold out until 2027. Also sold out in 2026.' },
  { id: 'b200', name: 'Blackwell B-2OO', unlockYear: 2024, pflops: 0.7, buyPrice: 45_000, rentPerDay: 350, powerKw: 1.0, flavor: 'Heats the office. Doubles as a space heater.' },
  { id: 'r300', name: 'Rubin R-3OO', unlockYear: 2026, pflops: 1.6, buyPrice: 60_000, rentPerDay: 600, powerKw: 1.4, flavor: 'Comes with a 4-page liquid cooling manual.' },
  { id: 'f500', name: 'Feynman F-5OO', unlockYear: 2028, pflops: 4, buyPrice: 80_000, rentPerDay: 1_000, powerKw: 1.8, flavor: 'Named after a physicist. Nobody asked his opinion.' },
  { id: 'h1000', name: 'H1000 Hypernova', unlockYear: 2031, pflops: 12, buyPrice: 120_000, rentPerDay: 2_000, powerKw: 2.5, flavor: 'Needs its own zip code and a small utility company.' },
  { id: 'd1', name: 'Dyson D-1', unlockYear: 2034, pflops: 40, buyPrice: 200_000, rentPerDay: 4_000, powerKw: 3.5, flavor: 'Surrounds the star. Lowers the electricity bill for everyone else.' },
];

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
