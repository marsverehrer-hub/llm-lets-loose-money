// v19 (Phase D3): where a datacenter is built. The site sets the power price, how long construction takes, how many
// megawatts a hall may draw, and how often the grid drops it. Grid is the default and is always open.
import type { SiteId } from '../types';

export interface SiteDef {
  name: string;
  /** Multiplier on the tier's power price per kWh. */
  powerPriceMult: number;
  /** Multiplier on the tier's build days. */
  buildDaysMult: number;
  /** Most megawatts one hall may draw (GPUs x kW x PUE). */
  mwCap: number;
  /** Chance per day that a hall with GPUs goes dark for 1-2 days. */
  outagePerDay: number;
  unlockYear: number;
  requiresResearch?: string;
  flavor: string;
}

export const SITES: Record<SiteId, SiteDef> = {
  grid: {
    name: 'Municipal Grid',
    powerPriceMult: 1,
    buildDaysMult: 1,
    mwCap: 50,
    outagePerDay: 0.0005,
    unlockYear: 2000,
    flavor: 'Plugs into the city. The city plugs back in when it feels like it.',
  },
  hydro: {
    name: 'Hydro Valley',
    powerPriceMult: 0.55,
    buildDaysMult: 1.4,
    mwCap: 120,
    outagePerDay: 0.001,
    unlockYear: 2017,
    flavor: 'A dam nobody asked permission to build. The river is very cheap and very cold.',
  },
  solar: {
    name: 'Solar Field',
    powerPriceMult: 0.7,
    buildDaysMult: 0.9,
    mwCap: 60,
    outagePerDay: 0.004,
    unlockYear: 2020,
    flavor: 'Fast to build and cheap in daylight. Clouds are a scheduling problem now.',
  },
  nuclear: {
    name: 'Reactor Campus',
    powerPriceMult: 0.8,
    buildDaysMult: 2.5,
    mwCap: 2000,
    outagePerDay: 0.0002,
    unlockYear: 2000,
    requiresResearch: 'nuclear_power',
    flavor: 'Two years of permits for a reactor that will outlive the company. Very few outages, many meetings.',
  },
};

export const DEFAULT_SITE: SiteId = 'grid';
