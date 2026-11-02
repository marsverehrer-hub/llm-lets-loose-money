// v16 (GAME_DESIGN §26.1): parody cloud providers. Logic lives in systems/cloudMarket.ts.
// Prices are multiples of each GPU's `rentPerDay` (data/gpus.ts), so a GPU rebalance moves every provider with it.
import type { CloudTerm, Id } from '../types';

export type CloudKind = 'hyperscaler' | 'neocloud' | 'spot' | 'sovereign';

export interface CloudProviderDef {
  id: Id;
  name: string;
  kind: CloudKind;
  /** On-demand price = GPU rentPerDay × this. */
  priceMult: number;
  /** First calendar year the provider takes customers. */
  openYear: number;
  /** Years after a GPU's unlockYear before this provider stocks it. */
  stockLag: number;
  /** Stops stocking a generation this many years after its launch. Missing = keeps every generation. */
  retireAfter?: number;
  /** The player's quota in GPUs at openYear, and its growth per year. */
  quotaBase: number;
  quotaGrowth: number;
  /** False for a marketplace that only sells spot. */
  onDemand: boolean;
  /** Reserved discount by term. Missing term = not offered. */
  reserved: Partial<Record<CloudTerm, number>>;
  /** Spot: price as a multiple of the on-demand price, and the chance per day that a spot lease is preempted. */
  spot?: { priceMult: number; preemptPerDay: number };
  /** Chance per day that an availability crunch starts. 0 = never. */
  crunchPerDay: number;
  flavor: string;
}

/** The provider the legacy `rentGpus` action rents from. Its on-demand pool is `compute.rented`. */
export const DEFAULT_PROVIDER_ID = 'amazomb';

export const CLOUD_PROVIDERS: CloudProviderDef[] = [
  {
    id: 'amazomb',
    name: 'Amazomb Web Services',
    kind: 'hyperscaler',
    priceMult: 1,
    openYear: 2017,
    stockLag: 0,
    quotaBase: 3_000,
    quotaGrowth: 1.75,
    onDemand: true,
    reserved: { 12: 0.3, 36: 0.5 },
    spot: { priceMult: 0.4, preemptPerDay: 0.04 },
    crunchPerDay: 1 / 700,
    flavor: 'Prime members get free shipping on H-1OOs. Shipping takes nine months.',
  },
  {
    id: 'microsquash',
    name: 'Microsquash Azzure',
    kind: 'hyperscaler',
    priceMult: 1.08,
    openYear: 2017,
    stockLag: 0.25,
    quotaBase: 2_000,
    quotaGrowth: 1.8,
    onDemand: true,
    reserved: { 12: 0.33, 36: 0.52 },
    crunchPerDay: 1 / 700,
    flavor: 'Comes with a free spreadsheet licence and a mandatory chatbot in the spreadsheet.',
  },
  {
    id: 'gargle',
    name: 'Gargle Cloud',
    kind: 'hyperscaler',
    priceMult: 0.97,
    openYear: 2017,
    stockLag: 0.5,
    quotaBase: 1_500,
    quotaGrowth: 1.75,
    onDemand: true,
    reserved: { 12: 0.28, 36: 0.46 },
    spot: { priceMult: 0.35, preemptPerDay: 0.06 },
    crunchPerDay: 1 / 700,
    flavor: 'Will deprecate your instance type in eighteen months. Lovingly.',
  },
  {
    id: 'corewheeze',
    name: 'CoreWheeze',
    kind: 'neocloud',
    priceMult: 0.78,
    openYear: 2019,
    stockLag: 0,
    retireAfter: 4,
    quotaBase: 400,
    quotaGrowth: 2.4,
    onDemand: true,
    reserved: { 12: 0.2, 36: 0.35 },
    crunchPerDay: 1 / 350,
    flavor: 'Used to mine crypto. Still has the vibe, and the debt.',
  },
  {
    id: 'lambada',
    name: 'Lambada Labs',
    kind: 'neocloud',
    priceMult: 0.85,
    openYear: 2018,
    stockLag: 0.25,
    retireAfter: 5,
    quotaBase: 300,
    quotaGrowth: 2,
    onDemand: true,
    reserved: { 12: 0.18 },
    crunchPerDay: 1 / 400,
    flavor: 'One-click clusters. The click takes three weeks.',
  },
  {
    id: 'bazaar',
    name: 'GPU Bazaar',
    kind: 'spot',
    priceMult: 1,
    openYear: 2017,
    stockLag: 1,
    quotaBase: 800,
    quotaGrowth: 1.6,
    onDemand: false,
    reserved: {},
    spot: { priceMult: 0.45, preemptPerDay: 0.08 },
    crunchPerDay: 1 / 500,
    flavor: "Somebody's gaming rig in Ohio. Uptime depends on their homework.",
  },
  {
    id: 'eurostack',
    name: 'EuroStack Sovereign Cloud',
    kind: 'sovereign',
    priceMult: 1.35,
    openYear: 2019,
    stockLag: 1,
    quotaBase: 600,
    quotaGrowth: 1.6,
    onDemand: true,
    reserved: { 12: 0.25, 36: 0.4 },
    crunchPerDay: 0,
    flavor: 'Your data never leaves the continent. Neither does the support team.',
  },
];

export function providerById(id: Id): CloudProviderDef | undefined {
  return CLOUD_PROVIDERS.find((p) => p.id === id);
}
